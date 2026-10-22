# Felt cat renderer for Cosy Cats. Builds a needle-felt style cat in Blender, poses it frame by
# frame from the rig poses written by export-poses.mjs, and renders RGBA PNG frames to the
# ASSETS.md spec (512×448, feet at pixel 256,416, 1.5 px per rig unit, facing right).
#
#   blender -b --factory-startup --python tools/blender/felt_cat.py -- --poses poses.json --out frames/
#       [--clips walk,sit] [--frames 0,12] [--samples 48] [--save cat.blend]
#
# Rig units are used throughout: a root empty scaled 0.01 turns them into metres. Rig x is
# forward, rig y points down, so a rig point (x, y) sits at local (x, depth, -y). Depth is
# negative toward the camera (the cat's near side).
import bpy
import json
import math
import os
import sys
from mathutils import Vector, Quaternion, Euler, Matrix

K = 0.575            # metaball surface radius ÷ element radius (threshold 0.6, stiffness 2)
CAM_YAW = math.radians(18)   # slight 3/4 view: the camera sits a little in front of the cat
CAM_PITCH = math.radians(7)
FUZZ = 1.6           # felt halo thickness, rig units
# longhair ruff lumps round the chest front: (rig angle, y down; depth toward the camera; size ÷ chest)
RUFF = [(a * math.pi, dz, k) for a, dz, k in ((-0.3, -0.45, 0.36), (-0.1, -0.6, 0.42), (0.1, -0.55, 0.42),
                                               (0.3, -0.45, 0.38), (0.0, 0.1, 0.4), (0.25, 0.1, 0.36))]


def args():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    o = {'samples': 48}
    for i in range(0, len(a), 2):
        o[a[i].lstrip('-')] = a[i + 1]
    return o


def lin(hex_or_rgb):
    """sRGB hex → linear RGBA for shader inputs."""
    if isinstance(hex_or_rgb, str):
        h = hex_or_rgb.lstrip('#')
        rgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    else:
        rgb = [c / 255 for c in hex_or_rgb]
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (*[f(c) for c in rgb], 1.0)


def shade(hex_, amt):
    h = hex_.lstrip('#')
    rgb = [int(h[i:i + 2], 16) for i in (0, 2, 4)]
    return [round(c + (255 - c) * amt) if amt >= 0 else round(c * (1 + amt)) for c in rgb]


# ---------------------------------------------------------------------------------- materials
def principled(nt):
    return next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')


def setin(node, name, value):
    if name in node.inputs:
        node.inputs[name].default_value = value


def lum(hex_):
    h = hex_.lstrip('#')
    r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def hexof(rgb):
    return '#' + ''.join(f'{max(0, min(255, round(c))):02x}' for c in rgb)


def lighten(hex_, amt):
    return hexof(shade(hex_, amt))


class Patch:
    """A soft colour region: the unit sphere of an empty. Materials read it through a texture
    coordinate pointed at the empty, so a patch rides on its body part from pose to pose instead
    of swimming through the wool. `place(cat)` → (location, scale, y-rotation), or None if static."""

    def __init__(self, name, parent, color, *, amt=1.0, soft=0.3, wobble=0.25, place=None,
                 loc=(0, 0, 0), scale=(1, 1, 1), rot=0.0):
        self.ob = empty(name, parent)
        self.color, self.amt, self.soft, self.wobble, self.place = color, amt, soft, wobble, place
        self.set(Vector(loc), scale, rot)

    def set(self, loc, scale, rot):
        self.ob.location = loc
        self.ob.scale = [max(1e-3, s) for s in scale]
        self.ob.rotation_euler = (0, rot, 0)

    def lit(self, amt):
        """The same region in a lighter wool, for the fuzz shell over it."""
        p = object.__new__(Patch)
        p.__dict__.update(self.__dict__)
        p.color = lighten(self.color, amt)
        return p


def felt_material(name, base, *, belly=None, stripe=None, stripe_period=17.0, stripe_amt=0.85, rough=1.0,
                  sheen=0.8, bump=0.55, alpha_noise=None, paws=None, patches=(), sheen_tint=(1, 0.97, 0.92, 1)):
    """Matte wool: sheen for the soft fibre rim, fine noise bump for the felted surface.
    Colour regions come from object-space normals and position, so they stay put on each part;
    patches (see Patch) are layered on top in order."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bsdf = principled(nt)
    setin(bsdf, 'Roughness', rough)
    setin(bsdf, 'Sheen Weight', sheen)
    setin(bsdf, 'Sheen Roughness', 0.6)
    setin(bsdf, 'Sheen Tint', sheen_tint)
    setin(bsdf, 'Subsurface Weight', 0.12)
    setin(bsdf, 'Subsurface Radius', (0.8, 0.5, 0.35))
    setin(bsdf, 'Subsurface Scale', 0.02)
    setin(bsdf, 'Specular IOR Level', 0.25)
    tc = N.new('ShaderNodeTexCoord')

    # wool is never one flat colour: blotchy light/dark variation like teased fibres
    mot = N.new('ShaderNodeTexNoise')
    mot.inputs['Scale'].default_value = 0.12
    mot.inputs['Detail'].default_value = 6
    L.new(tc.outputs['Object'], mot.inputs['Vector'])
    mramp = N.new('ShaderNodeValToRGB')
    mramp.color_ramp.elements[0].position = 0.3
    mramp.color_ramp.elements[0].color = lin(shade(base, -0.1) if isinstance(base, str) else base)
    mramp.color_ramp.elements[1].position = 0.7
    mramp.color_ramp.elements[1].color = lin(shade(base, 0.1) if isinstance(base, str) else base)
    L.new(mot.outputs['Fac'], mramp.inputs['Fac'])
    out = mramp.outputs['Color']

    sep_n = N.new('ShaderNodeSeparateXYZ')
    L.new(tc.outputs['Normal'], sep_n.inputs[0])
    sep_p = N.new('ShaderNodeSeparateXYZ')
    L.new(tc.outputs['Object'], sep_p.inputs[0])

    def map_range(src, a, b, c=0.0, d=1.0):
        mr = N.new('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value = a
        mr.inputs['From Max'].default_value = b
        mr.inputs['To Min'].default_value = c
        mr.inputs['To Max'].default_value = d
        L.new(src, mr.inputs['Value'])
        return mr.outputs['Result']

    def mix(a_out, b_hex, fac):
        mx = N.new('ShaderNodeMix')
        mx.data_type = 'RGBA'
        L.new(fac, mx.inputs['Factor'])
        L.new(a_out, mx.inputs['A'])
        mx.inputs['B'].default_value = lin(b_hex)
        return mx.outputs['Result']

    if stripe:
        # soft tabby bands across the body, broken up with noise, only on the top and sides
        noise = N.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 0.035
        noise.inputs['Detail'].default_value = 3
        L.new(tc.outputs['Object'], noise.inputs['Vector'])
        warp = N.new('ShaderNodeMath'); warp.operation = 'MULTIPLY_ADD'
        L.new(noise.outputs['Fac'], warp.inputs[0]); warp.inputs[1].default_value = 14.0
        L.new(sep_p.outputs['X'], warp.inputs[2])
        ph = N.new('ShaderNodeMath'); ph.operation = 'MULTIPLY'
        L.new(warp.outputs[0], ph.inputs[0]); ph.inputs[1].default_value = 2 * math.pi / stripe_period
        sn = N.new('ShaderNodeMath'); sn.operation = 'SINE'
        L.new(ph.outputs[0], sn.inputs[0])
        band = map_range(sn.outputs[0], 0.15, 0.75)
        top = map_range(sep_n.outputs['Z'], -0.25, 0.25)
        fac = N.new('ShaderNodeMath'); fac.operation = 'MULTIPLY'
        L.new(band, fac.inputs[0]); L.new(top, fac.inputs[1])
        fac2 = N.new('ShaderNodeMath'); fac2.operation = 'MULTIPLY'
        L.new(fac.outputs[0], fac2.inputs[0]); fac2.inputs[1].default_value = stripe_amt
        out = mix(out, stripe, fac2.outputs[0])
    if belly:
        under = map_range(sep_n.outputs['Z'], -0.15, -0.7, 0, 0.85)
        out = mix(out, belly, under)
    if paws:
        low = map_range(sep_p.outputs['Z'], 9, 3, 0, 0.7)
        out = mix(out, paws, low)
    for pt in patches:
        # distance from the patch centre in its own unit sphere, with a ragged felted edge
        tcp = N.new('ShaderNodeTexCoord')
        tcp.object = pt.ob
        ln = N.new('ShaderNodeVectorMath'); ln.operation = 'LENGTH'
        L.new(tcp.outputs['Object'], ln.inputs[0])
        d = ln.outputs['Value']
        if pt.wobble:
            nz = N.new('ShaderNodeTexNoise')
            nz.inputs['Scale'].default_value = 2.2
            nz.inputs['Detail'].default_value = 3
            L.new(tcp.outputs['Object'], nz.inputs['Vector'])
            w = N.new('ShaderNodeMath'); w.operation = 'MULTIPLY_ADD'
            L.new(nz.outputs['Fac'], w.inputs[0]); w.inputs[1].default_value = pt.wobble
            w2 = N.new('ShaderNodeMath'); w2.operation = 'ADD'
            L.new(w.outputs[0], w2.inputs[0]); w2.inputs[1].default_value = -0.5 * pt.wobble
            L.new(d, w.inputs[2])
            d = w2.outputs[0]
        out = mix(out, pt.color, map_range(d, 1.0, 1.0 - pt.soft, 0, pt.amt))
    L.new(out, bsdf.inputs['Base Color'])

    # felted surface: fine fibrous noise into a bump
    fib = N.new('ShaderNodeTexNoise')
    fib.inputs['Scale'].default_value = 1.6
    fib.inputs['Detail'].default_value = 12
    fib.inputs['Roughness'].default_value = 0.75
    fib.inputs['Distortion'].default_value = 1.5
    L.new(tc.outputs['Object'], fib.inputs['Vector'])
    lump = N.new('ShaderNodeTexNoise')
    lump.inputs['Scale'].default_value = 0.25
    lump.inputs['Detail'].default_value = 4
    L.new(tc.outputs['Object'], lump.inputs['Vector'])
    hsum = N.new('ShaderNodeMath'); hsum.operation = 'MULTIPLY_ADD'
    L.new(lump.outputs['Fac'], hsum.inputs[0]); hsum.inputs[1].default_value = 0.6
    L.new(fib.outputs['Fac'], hsum.inputs[2])
    bmp = N.new('ShaderNodeBump')
    bmp.inputs['Strength'].default_value = bump
    bmp.inputs['Distance'].default_value = 0.006
    L.new(hsum.outputs[0], bmp.inputs['Height'])
    L.new(bmp.outputs['Normal'], bsdf.inputs['Normal'])

    if alpha_noise is not None:
        # the fuzz shell: sparse speckle of fibres, dithered so the edge renders soft
        sp = N.new('ShaderNodeTexNoise')
        sp.inputs['Scale'].default_value = 1.6
        sp.inputs['Detail'].default_value = 6
        L.new(tc.outputs['Object'], sp.inputs['Vector'])
        a = map_range(sp.outputs['Fac'], 0.5, 0.72, 0, alpha_noise)
        L.new(a, bsdf.inputs['Alpha'])
        m.surface_render_method = 'DITHERED'
        m.use_backface_culling = True   # the shell's inside would show through its gaps as dark grit
    return m


def flat_material(name, color, *, rough=0.9, emission=0.0, alpha=1.0, coat=0.0, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = principled(m.node_tree)
    b.inputs['Base Color'].default_value = lin(color)
    setin(b, 'Roughness', rough)
    setin(b, 'Metallic', metallic)
    setin(b, 'Sheen Weight', 0.4 if rough > 0.5 else 0)
    setin(b, 'Coat Weight', coat)
    setin(b, 'Coat Roughness', 0.05)
    if emission:
        setin(b, 'Emission Color', lin(color))
        setin(b, 'Emission Strength', emission)
    if alpha < 1:
        setin(b, 'Alpha', alpha)
    return m


def eye_material(iris_hex, rim=(0.02, 0.012, 0.01, 1), glow=0.0):
    """Glossy felt-toy eye: radial pupil / iris / rim from the eye's own local coordinates.
    Dark coats get a little iris glow so the eyes still read against black wool."""
    m = bpy.data.materials.new('Eye')
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    b = principled(nt)
    setin(b, 'Roughness', 0.15)
    setin(b, 'Coat Weight', 1.0)
    setin(b, 'Coat Roughness', 0.03)
    tc = N.new('ShaderNodeTexCoord')
    sep = N.new('ShaderNodeSeparateXYZ')
    L.new(tc.outputs['Object'], sep.inputs[0])
    comb = N.new('ShaderNodeCombineXYZ')
    L.new(sep.outputs['X'], comb.inputs['X'])
    L.new(sep.outputs['Z'], comb.inputs['Y'])
    ln = N.new('ShaderNodeVectorMath'); ln.operation = 'LENGTH'
    L.new(comb.outputs[0], ln.inputs[0])
    ramp = N.new('ShaderNodeValToRGB')
    r = ramp.color_ramp
    r.interpolation = 'EASE'
    r.elements[0].position = 0.0; r.elements[0].color = (0.012, 0.008, 0.008, 1)
    r.elements[1].position = 0.42; r.elements[1].color = (0.012, 0.008, 0.008, 1)
    for pos, c in ((0.5, lin(shade(iris_hex, -0.35))), (0.72, lin(iris_hex)), (0.86, lin(shade(iris_hex, 0.3))),
                   (0.93, rim)):
        e = r.elements.new(pos); e.color = c
    L.new(ln.outputs['Value'], ramp.inputs['Fac'])
    L.new(ramp.outputs['Color'], b.inputs['Base Color'])
    if glow:
        L.new(ramp.outputs['Color'], b.inputs['Emission Color'])
        setin(b, 'Emission Strength', glow)
    return m


# ---------------------------------------------------------------------------------- geometry
def link(ob, parent=None):
    bpy.context.scene.collection.objects.link(ob)
    if parent:
        ob.parent = parent
    return ob


def empty(name, parent=None):
    return link(bpy.data.objects.new(name, None), parent)


def sphere(name, mat, parent, loc=(0, 0, 0), scale=(1, 1, 1), rot=(0, 0, 0), seg=40):
    me = bpy.data.meshes.new(name)
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=1.0)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    ob = link(bpy.data.objects.new(name, me), parent)
    ob.location = loc
    ob.scale = scale
    ob.rotation_euler = rot
    return ob


def cone(name, mat, parent, r1, depth, loc=(0, 0, 0), scale=(1, 1, 1)):
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=r1, radius2=0.02, depth=depth)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, depth / 2))  # base at the origin
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    ob = link(bpy.data.objects.new(name, me), parent)
    ob.location = loc
    ob.scale = scale
    mod = ob.modifiers.new('round', 'SUBSURF')
    mod.levels = mod.render_levels = 2
    return ob


def torus(name, mat, parent, minor):
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    segs, rings = 48, 16
    verts = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        row = []
        for j in range(rings):
            b = 2 * math.pi * j / rings
            rr = 1 + minor * math.cos(b)
            row.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), minor * math.sin(b))))
        verts.append(row)
    for i in range(segs):
        for j in range(rings):
            bm.faces.new((verts[i][j], verts[(i + 1) % segs][j], verts[(i + 1) % segs][(j + 1) % rings], verts[i][(j + 1) % rings]))
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    return link(bpy.data.objects.new(name, me), parent)


def metaball(name, mat, parent, n_ell=0, n_cap=0, n_ball=0):
    mb = bpy.data.metaballs.new(name)
    mb.resolution = 2.0
    mb.render_resolution = 0.9
    mb.threshold = 0.6
    mb.update_method = 'UPDATE_ALWAYS'
    mb.materials.append(mat)
    ob = link(bpy.data.objects.new(name, mb), parent)
    els = {'ell': [], 'cap': [], 'ball': []}
    for kind, n, key in (('ELLIPSOID', n_ell, 'ell'), ('CAPSULE', n_cap, 'cap'), ('BALL', n_ball, 'ball')):
        for _ in range(n):
            e = mb.elements.new(type=kind)
            e.stiffness = 2.0
            e.radius = 1.0
            els[key].append(e)
    return ob, els


def curve_line(name, mat, parent, width):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = width
    cu.bevel_resolution = 4
    cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(1)
    for bp in sp.bezier_points:
        bp.handle_left_type = bp.handle_right_type = 'FREE'
    cu.materials.append(mat)
    return link(bpy.data.objects.new(name, cu), parent), sp


def poly_line(name, mat, parent, pts, width):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = width
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for p, co in zip(sp.points, pts):
        p.co = (*co, 1)
    cu.materials.append(mat)
    return link(bpy.data.objects.new(name, cu), parent)


def mesh_from(name, mat, parent, verts, faces, *, thick=0.0, subsurf=0):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    ob = link(bpy.data.objects.new(name, me), parent)
    if thick:
        s = ob.modifiers.new('felt', 'SOLIDIFY')
        s.thickness = thick
        s.offset = 0
    if subsurf:
        s = ob.modifiers.new('round', 'SUBSURF')
        s.levels = s.render_levels = subsurf
    return ob


# ---------------------------------------------------------------------------------- the cat
def skull_y(x, z, lift=0.02):
    """Depth of the skull's front surface (head units) at (x, z), pushed out by lift."""
    q = 1 - (x / 1.08) ** 2 - ((z - 0.04) / 0.9) ** 2
    return -0.95 * math.sqrt(max(0.0, q)) - lift


class FeltCat:
    def __init__(self, d):
        self.d = d
        pat = d['pattern']
        tabby = pat.startswith('tabby')
        self.long = long_ = pat in ('longhair', 'tabbyLong')
        self.dark = dark = lum(d['fur']) < 0.3
        fur, belly = d['fur'], d['belly']
        stripe = d.get('stripe') if tabby else None
        stripe_amt = 0.6 if pat == 'tabbyLong' else 0.85
        self.fuzz_grow = 3.0 if long_ else FUZZ
        self.root = empty('Cat')
        self.root.scale = (0.01, 0.01, 0.01)
        H = self.head = empty('Head', self.root)
        self.parts, self.pts = None, {}
        body_p, leg_p, head_p, tail_p, look = self.markings(d, H)
        self.patches = [p for p in body_p + leg_p + head_p + tail_p if p.place]

        # dark wool: a deeper base, almost no sheen and a fuzz halo barely lighter; the white
        # sheen alone turns black wool mid grey
        lift = 0.05 if dark else 0.2
        dk = dict(sheen=0.1, sheen_tint=(0.75, 0.75, 0.82, 1)) if dark else {}
        wool = (lambda c: lighten(c, -0.3) if lum(c) < 0.3 else c) if dark else (lambda c: c)

        def fuzz(name, base, patches, alpha=0.6, under=True):
            return felt_material(name, lighten(wool(base), lift), alpha_noise=alpha, bump=0.0, sheen=0.2 if dark else 1.0,
                                 belly=lighten(belly, lift) if under else None,
                                 patches=[p.lit(lift) for p in patches])

        m_body = felt_material('Fur', wool(fur), belly=belly, stripe=stripe, stripe_amt=stripe_amt, patches=body_p, **dk)
        m_legs = felt_material('Legs', wool(look['legs']), paws=look['paws'], belly=belly if look['legs'] == fur else None,
                               patches=leg_p, **dk)
        m_fuzz = fuzz('Fuzz', fur, body_p)
        m_legfuzz = fuzz('LegFuzz', look['legs'], leg_p, under=look['legs'] == fur)
        m_head = felt_material('Head', wool(fur), belly=belly, patches=head_p, **dk)
        m_headfuzz = fuzz('HeadFuzz', fur, head_p)
        m_muzzle = felt_material('Muzzle', wool(look['muzzle']), patches=head_p, **(dk or dict(sheen=0.9)))
        m_stripe = felt_material('Stripe', stripe or shade(fur, -0.3), sheen=0.5)
        m_tail = felt_material('Tail', wool(look['tail']), stripe=stripe, stripe_period=13.0, stripe_amt=stripe_amt,
                               patches=tail_p, **dk)
        m_nose = flat_material('Nose', '#c98090' if dark and pat != 'tux' else '#e88a8a', rough=0.6)
        m_inner = flat_material('EarInner', look['inner'], rough=1.0)
        m_blush = flat_material('Blush', (230, 120, 140) if dark else (240, 140, 140), rough=1.0, alpha=0.4 if dark else 0.55)
        m_mouth = flat_material('Mouth', '#7a3a3e', rough=0.7)
        m_white = flat_material('Glint', '#ffffff', rough=0.1, emission=4.0)
        m_whisker = flat_material('Whisker', '#fff6e8', rough=0.6)
        # closed eyes are a thread line: dark on light wool, a pale line on black wool so it still reads
        m_lid = flat_material('Lid', lighten(fur, 0.38) if dark else '#3a2620', rough=0.8)
        eye_kw = dict(rim=lin(lighten(fur, 0.12)), glow=0.35) if dark else {}
        m_eyes = {-1: eye_material(d.get('eye2') or d['eye'], **eye_kw), 1: eye_material(d['eye'], **eye_kw)}
        ear_mats = {s: (m_head if c is None else felt_material(f'EarFur{s}', wool(c), **dk))
                    for s, c in zip((-1, 1), look['ears'])}

        # body: haunch, belly, chest and neck blend into one felted mass; legs are their own family
        self.body, self.be = metaball('Body', m_body, self.root, n_ell=3, n_ball=1)
        self.legs, self.le = metaball('Legs', m_legs, self.root, n_ell=4, n_cap=4)
        self.fuzz, self.fe = metaball('Fuzz', m_fuzz, self.root, n_ell=3, n_ball=1)
        self.legfuzz, self.lfe = metaball('LegFuzz', m_legfuzz, self.root, n_ell=4, n_cap=4)
        self.fluff = None
        if long_:
            # longhair: a second, wider and sparser halo outside the first
            self.fluff, self.ffe = metaball('Fluff', fuzz('Fluff', fur, body_p, alpha=0.42), self.root, n_ell=3, n_ball=1)

        # head, built at radius 1 and scaled by the pose's head radius
        self.skull = sphere('Skull', m_head, H, (0, 0, 0.04), (1.08, 0.95, 0.9))
        k = 1.12 if long_ else 1.037
        sphere('SkullFuzz', m_headfuzz, H, (0, 0, 0.04), (1.08 * k, 0.95 * k + 0.005, 0.9 * k + 0.005))
        for s in (-1, 1):
            sphere(f'Cheek{s}', m_head, H, (s * 0.5, -0.32, -0.26), (0.56, 0.48, 0.44))
            if long_:
                # fluffy cheek ruffs, as the rig's jagged head sides
                for j in range(3):
                    sphere(f'CheekTuft{s}{j}', m_head, H, (s * (0.92 + 0.05 * j), -0.22 + 0.06 * j, -0.1 - 0.17 * j),
                           (0.3, 0.16, 0.11), (0, s * (0.3 + 0.3 * j), 0), seg=24)
                    sphere(f'CheekTuftFuzz{s}{j}', m_headfuzz, H, (s * (0.95 + 0.05 * j), -0.22 + 0.06 * j, -0.1 - 0.17 * j),
                           (0.36, 0.2, 0.15), (0, s * (0.3 + 0.3 * j), 0), seg=24)
        sphere('Muzzle', m_muzzle, H, (0, -0.74, -0.38), (0.44, 0.26, 0.28))
        sphere('Chin', m_muzzle, H, (0, -0.62, -0.58), (0.3, 0.2, 0.16))
        sphere('Nose', m_nose, H, (0, -0.99, -0.22), (0.12, 0.07, 0.075))
        self.mouth = sphere('Mouth', m_mouth, H, (0, -0.9, -0.5), (0.1, 0.06, 0.1))
        self.eyes, self.glints, self.lids = [], [], []
        for s in (-1, 1):
            e = sphere(f'Eye{s}', m_eyes[s], H, (s * 0.38, -0.8, 0.06), (0.19, 0.1, 0.22), (0, 0, s * 0.35))
            self.eyes.append(e)
            g = sphere(f'Glint{s}', m_white, H, (s * 0.38 - 0.06, -0.9, 0.15), (0.055, 0.03, 0.055), seg=16)
            self.glints.append(g)
            sphere(f'Blush{s}', m_blush, H, (s * 0.64, -0.64, -0.3), (0.17, 0.06, 0.1), (0, 0, s * 0.5), seg=24)
            # content closed eye: the rig's lower arc, laid on the skull
            arc = []
            for j in range(9):
                a = math.pi * (0.15 + 0.7 * j / 8)
                x, z = s * 0.38 + 0.16 * math.cos(a), 0.1 - 0.16 * math.sin(a)
                arc.append((x, skull_y(x, z, 0.03), z))
            lid = poly_line(f'Lid{s}', m_lid, H, arc, 0.034)
            lid.hide_render = True
            self.lids.append(lid)
        if tabby:
            for k in (-1, 0, 1):
                sphere(f'Brow{k}', m_stripe, H, (k * 0.2, -0.62, 0.62 - abs(k) * 0.05), (0.05, 0.07, 0.17),
                       (-0.75, 0, k * 0.15), seg=16)
            for s in (-1, 1):
                for k in (0, 1):
                    sphere(f'CheekStripe{s}{k}', m_stripe, H, (s * 0.98, -0.3, 0.02 - k * 0.2),
                           (0.17, 0.05, 0.035), (0, 0, s * 0.9), seg=16)
        self.ears = []
        for s in (-1, 1):
            piv = empty(f'Ear{s}', H)
            piv.location = (s * 0.5, -0.05, 0.48)
            cone(f'EarOuter{s}', ear_mats[s], piv, 0.4, 0.82, scale=(1, 0.5, 1))
            cone(f'EarInner{s}', m_inner, piv, 0.25, 0.6, loc=(0, -0.13, 0.06), scale=(1, 0.3, 1))
            self.ears.append((s, piv))
        for s in (-1, 1):
            for k in range(3):
                ob, sp = curve_line(f'Whisker{s}{k}', m_whisker, H, 0.012)
                a, b = sp.bezier_points
                a.co = (s * 0.32, -0.94, -0.3 - k * 0.06)
                b.co = (s * 1.28, -0.8, -0.28 + (k - 1) * 0.14)
                a.handle_left = a.co
                a.handle_right = (s * 0.8, -0.95, -0.24 - k * 0.04)
                b.handle_left = (s * 1.0, -0.86, -0.26 + (k - 1) * 0.1)
                b.handle_right = b.co

        # tail: tapered bezier, the same curve the rig draws (1.6× thicker and haloed on longhairs)
        self.tail_w = 1.6 if long_ else 1.0
        self.tails = []
        layers = [('Tail', m_tail, 1.0)]
        if long_:
            layers.append(('TailFuzz', fuzz('TailFuzz', look['tail'], tail_p, alpha=0.55, under=False), 1.3))
        for name, mat, k in layers:
            ob, sp = curve_line(name, mat, self.root, 1.0)
            ob.data.bevel_resolution = 6
            sp.bezier_points[1].radius = 0.62
            self.tails.append((ob, sp, k))
        self.tail, self.tsp = self.tails[0][:2]

        # longhair chest ruff: a pale felted bib of lumps round the front of the chest (the rig's
        # jagged fan), as its own metaball family with a deep halo
        self.ruff = None
        if long_:
            self.ruff, self.re = metaball('Ruff', felt_material('Ruff', lighten(belly, 0.1), sheen=1.0, bump=0.8),
                                          self.root, n_ell=len(RUFF))
            self.rufffuzz, self.rfe = metaball('RuffFuzz', fuzz('RuffFuzz', lighten(belly, 0.1), (), alpha=0.6, under=False),
                                               self.root, n_ell=len(RUFF))

        self.accessory(d.get('acc') or {}, H)

    # -- markings ----------------------------------------------------------------------------
    def markings(self, d, H):
        """The coat pattern as patches per region (body, legs, head, tail), translated from the
        rig's 2D markings in catArt.js, plus per-part base colours."""
        pat, fur, belly = d['pattern'], d['fur'], d['belly']
        R = self.root
        body, legs, head, tail = [], [], [], []
        # the rig only pales the muzzle on tabbies (and a tux's blaze); other coats keep the head wool
        muzzle = belly if pat.startswith('tabby') or pat == 'tux' else fur
        look = {'legs': fur, 'tail': fur, 'ears': (None, None), 'muzzle': muzzle, 'paws': belly,
                'inner': hexof((240, 166, 160))}

        def proj(name, color, fn, depth=40, **kw):
            # a rig 2D ellipse (x, y, rx, ry, rot) from the pose's parts, pushed through the body's depth
            def place(cat):
                x, y, rx, ry, rot = fn(*cat.parts)
                return Vector((x, 0, -y)), (rx, depth, ry), rot
            return Patch(name, R, color, place=place, **kw)

        def face(name, color, x, y, rx, ry, rot=0.0, **kw):
            # a rig head ellipse in head radii (y down), pushed through the head front to back
            return Patch(name, H, color, loc=(x, 0, -y), scale=(rx, 1.5, ry), rot=rot, **kw)

        def feet(name, color, reach, **kw):
            # a sphere round each paw reaching `reach` of the way up the leg
            def at(i):
                def place(cat):
                    paw, length, w = cat.pts['feet'][i]
                    r = length * reach + w * 0.4
                    return paw, (r, r, r), 0.0
                return place
            return [Patch(f'{name}{i}', R, color, place=at(i), **kw) for i in range(4)]

        def tip(name, color, **kw):
            def place(cat):
                c, r = cat.pts['tail_tip']
                return c, (r, r, r), 0.0
            return Patch(name, R, color, place=place, **kw)

        if pat == 'tux':
            body += [proj('Bib', belly, lambda Hh, B, C: (C[0] + C[2] * 0.42, C[1] + C[3] * 0.2, C[2] * 0.62, C[3] * 0.95, 0.1), soft=0.2),
                     proj('BellyPatch', belly, lambda Hh, B, C: (B[0] + B[2] * 0.2, B[1] + B[3] * 0.7, B[2] * 0.55, B[3] * 0.42, B[4]), soft=0.2)]
            # white muzzle and chin rising to a point between the eyes
            head += [Patch('Blaze', H, belly, loc=(0, -0.8, -0.55), scale=(0.72, 0.75, 0.44), soft=0.2, wobble=0.12),
                     Patch('BlazeNose', H, belly, loc=(0, -0.95, -0.12), scale=(0.17, 0.5, 0.45), soft=0.25, wobble=0.1)]
            legs += feet('Sock', belly, 0.36, soft=0.15, wobble=0.15)
            tail.append(tip('TailTip', belly, soft=0.2, wobble=0.1))
        elif pat == 'calico':
            A, B_ = d['patchA'], d['patchB']
            body += [proj('PatchA1', A, lambda Hh, B, C: (Hh[0] - 8, Hh[1] - Hh[3] * 0.4, Hh[2] * 0.75, Hh[3] * 0.6, 0.3)),
                     proj('PatchB1', B_, lambda Hh, B, C: (B[0] + B[2] * 0.1, B[1] - B[3] * 0.6, B[2] * 0.5, B[3] * 0.42, B[4] + 0.4)),
                     proj('PatchB2', B_, lambda Hh, B, C: (Hh[0] + Hh[2] * 0.4, Hh[1] - Hh[3] * 0.7, Hh[2] * 0.28, Hh[3] * 0.22, 0)),
                     proj('PatchA2', A, lambda Hh, B, C: (B[0] - B[2] * 0.4, B[1] - B[3] * 0.7, B[2] * 0.3, B[3] * 0.3, 0))]
            head += [face('HeadA', A, -0.7, -0.55, 0.6, 0.5, 0.4), face('HeadB', B_, 0.75, -0.6, 0.5, 0.42, -0.4)]
            look.update(tail=A, ears=(A, B_))
            tail.append(tip('TailTip', B_, soft=0.2, wobble=0.1))
        elif pat == 'tortie':
            A, B_ = d['patchA'], d['patchB']
            # the rig's seeded blobs, fixed in the cat's own space just as the rig draws them
            for i, (x, y, rx, ry, c, alt) in enumerate(d.get('mottle', [])):
                body.append(Patch(f'Mottle{i}', R, B_ if alt else A, amt=0.85, soft=0.3, wobble=0.35,
                                  loc=(x, 0, -y), scale=(rx, 40, ry), rot=c * 3))
            head += [face('HeadA', A, -0.55, -0.3, 0.55, 0.7, 0.2, amt=0.9),
                     face('HeadB', B_, 0.6, 0.3, 0.3, 0.25, amt=0.7),
                     face('HeadBlaze', A, 0.05, -0.6, 0.08, 0.35, amt=0.85, wobble=0.08, soft=0.4)]
            tail += [Patch('TailFleck', R, A, amt=0.8, wobble=0.3,
                           place=lambda cat: (cat.pts['tail_mid'], (9, 9, 9), 0.0))]
        elif pat == 'siamese':
            P = d['points']
            look.update(tail=P, ears=(P, P), muzzle=fur, paws=None, inner=lighten(P, 0.25))
            # darker points: a face mask round the nose, legs shading down to dark feet, a dusky rump
            head.append(Patch('Mask', H, P, loc=(0, -0.95, -0.28), scale=(0.98, 0.62, 0.9), amt=0.95, soft=0.6, wobble=0.12))
            legs += feet('Point', P, 0.8, soft=0.55, wobble=0.1)
            body.append(proj('Rump', P, lambda Hh, B, C: (Hh[0] - Hh[2] * 0.5, Hh[1] + Hh[3] * 0.3, Hh[2] * 1.4, Hh[2] * 1.4, 0),
                             amt=0.55, soft=1.0, wobble=0.1))
        return body, legs, head, tail, look

    # -- accessories -------------------------------------------------------------------------
    def accessory(self, acc, H):
        self.acc = acc
        self.scarf = self.scarf_end = self.hang = None
        t = acc.get('type')
        if t in ('scarf', 'collar', 'bandana'):
            knit = felt_material('Knit', acc['color'], sheen=0.35 if t == 'bandana' else 0.6, bump=0.6)
            self.minor = 0.28 if t == 'scarf' else 0.14
            self.scarf = torus('Scarf', knit, self.root, self.minor)
            if t == 'scarf':
                self.scarf_end = sphere('ScarfEnd', knit, self.root, scale=(6.5, 2.6, 15))
                band = felt_material('KnitBand', acc.get('color2', '#ffffff'), sheen=0.6)
                self.bands = [sphere(f'ScarfBand{i}', band, self.scarf_end, (0, -0.25, z), (1.03, 0.9, 0.13), seg=24)
                              for i, z in enumerate((-0.2, -0.55))]
            if t == 'bandana' or acc.get('bell') or acc.get('flower'):
                # things hanging at the front of the collar, built in head radii: local -y points out
                # from the neck, z up the neck, x round it
                hang = self.hang = empty('Hang', self.root)
                hang.rotation_mode = 'QUATERNION'
                if t == 'bandana':
                    self.bandana(hang, knit)
                elif acc.get('bell'):
                    gold = flat_material('Bell', '#e2b04a', rough=0.28, metallic=0.85, coat=0.6)
                    slot = flat_material('BellSlot', '#5a3c18', rough=0.6)
                    sphere('Bell', gold, hang, (0, -0.12, -0.2), (0.18, 0.18, 0.18))
                    sphere('BellBand', slot, hang, (0, -0.12, -0.2), (0.186, 0.186, 0.022))
                    sphere('BellSlit', slot, hang, (0, -0.29, -0.27), (0.07, 0.02, 0.025), seg=16)
                    loop = torus('BellLoop', gold, hang, 0.3)
                    loop.location = (0, -0.1, -0.02)
                    loop.scale = (0.05, 0.05, 0.05)
                    loop.rotation_euler = (0, math.pi / 2, 0)
                else:
                    petal = felt_material('Petal', '#fff6e6', sheen=0.9, bump=0.4)
                    middle = felt_material('FlowerCentre', '#f2c46d', sheen=0.6)
                    for k in range(5):
                        a = k / 5 * 2 * math.pi + 0.3
                        sphere(f'Petal{k}', petal, hang, (math.cos(a) * 0.14, -0.12, -0.13 + math.sin(a) * 0.14),
                               (0.105, 0.045, 0.105), (0, -a, 0), seg=20)
                    sphere('FlowerCentre', middle, hang, (0, -0.16, -0.13), (0.075, 0.05, 0.075), seg=20)
        elif t == 'bow':
            # a felt bow on top of the head by the left ear, facing forward and up like the rig's
            m_bow = felt_material('Bow', acc['color'], sheen=0.7, bump=0.5)
            m_knot = felt_material('BowKnot', lighten(acc['color'], 0.3), sheen=0.7, bump=0.5)
            bow = empty('Bow', H)
            bow.location = (-0.52, -0.4, 0.74)
            bow.rotation_euler = (-0.75, 0.15, 0.3)
            bow.scale = (1.3, 1.3, 1.3)
            for s in (-1, 1):
                sphere(f'BowLoop{s}', m_bow, bow, (s * 0.25, 0, 0), (0.26, 0.09, 0.17), (0, -s * 0.18, 0), seg=28)
            sphere('BowKnot', m_knot, bow, (0, -0.05, 0), (0.1, 0.08, 0.11), seg=20)

    def bandana(self, hang, knit):
        """A felt triangle hanging off the collar, curving round the chest, with three dots."""
        rows, cols = 4, 7
        verts, faces = [], []
        surf = lambda x, t: 0.32 * x * x - 0.1 - 0.06 * t
        for j in range(rows):
            t = j / rows
            hw = 0.6 * (1 - t)
            for c in range(cols):
                x = hw * (2 * c / (cols - 1) - 1)
                verts.append((x, surf(x, t), -0.08 - 0.8 * t))
        verts.append((0, surf(0, 1), -0.88))
        for j in range(rows - 1):
            for c in range(cols - 1):
                a = j * cols + c
                faces.append((a, a + 1, a + cols + 1, a + cols))
        apex = len(verts) - 1
        last = (rows - 1) * cols
        for c in range(cols - 1):
            faces.append((last + c, last + c + 1, apex))
        mesh_from('Bandana', knit, hang, verts, faces, thick=0.05, subsurf=2)
        dot = flat_material('BandanaDot', '#fff0dc', rough=0.9)
        for x, z in ((-0.22, -0.24), (0.2, -0.28), (0, -0.52)):
            sphere(f'BandanaDot{x}', dot, hang, (x, surf(x, (-z - 0.08) / 0.8) - 0.035, z), (0.06, 0.02, 0.06), seg=16)

    # -- posing ------------------------------------------------------------------------------
    def pose(self, fr):
        p = fr['p']
        yaw = fr['yaw']
        dsign = max(-1.0, min(1.0, math.cos(yaw) * 3))  # near/far sides swap as it faces the camera
        self.root.rotation_euler = (0, 0, yaw)
        V = lambda x, y, depth=0.0: Vector((x, depth, -y))

        def ell(e, co, a, b, c, rot=0.0, grow=0.0):
            # Blender caps element size at 20, so the radius carries the scale and sizes stay ≤ 1
            a, b, c = a + grow, b + grow, c + grow
            m = max(a, b, c)
            e.co = co
            e.radius = m / K
            e.size_x, e.size_y, e.size_z = a / m, b / m, c / m
            e.rotation = Quaternion((0, 1, 0), rot)

        def cap(e, a, b, w, grow=0.0):
            v = b - a
            e.co = (a + b) / 2
            e.size_x = max(0.01, v.length / 2)
            e.radius = (w / 2 + grow) / K
            e.rotation = Vector((1, 0, 0)).rotation_difference(v.normalized()) if v.length > 1e-6 else Quaternion()

        def depth_of(rx, ry):
            return 0.82 * min(rx, ry) + 0.1 * max(rx, ry)

        Hh, Bd, C, Hd = p['haunch'], p['body'], p['chest'], p['head']
        self.parts = (Hh, Bd, C)
        parts = [
            (V(Hh[0], Hh[1]), Hh[2], depth_of(Hh[2], Hh[3]) + 2, Hh[3], 0.0),
            (V(Bd[0], Bd[1]), Bd[2], depth_of(Bd[2], Bd[3]), Bd[3], Bd[4]),
            (V(C[0], C[1]), C[2], depth_of(C[2], C[3]), C[3], 0.0),
        ]
        shells = [(self.fe, self.fuzz_grow)] + ([(self.ffe, self.fuzz_grow + 2.4)] if self.fluff else [])
        for i, part in enumerate(parts):
            ell(self.be['ell'][i], *part)
            for els, grow in shells:
                ell(els['ell'][i], *part, grow=grow)
        r = Hd[2]
        neck = V(C[0], C[1]).lerp(V(Hd[0], Hd[1]), 0.45)
        nb = self.be['ball'][0]
        nb.co = neck
        nb.radius = min(C[3], r) * 0.62 / K
        for els, grow in shells:
            els['ball'][0].co = neck
            els['ball'][0].radius = (min(C[3], r) * 0.62 + grow) / K

        feet = []
        for i, l in enumerate(p['legs']):
            hx, hy, fx, fy, w, vis = l
            dy = (14 if i < 2 else -14) * dsign
            w *= 0.82 + 0.18 * min(1, max(0, vis))
            a, b = V(hx, hy, dy * 0.7), V(fx, fy - 3, dy)
            cap(self.le['cap'][i], a, b, w)
            cap(self.lfe['cap'][i], a, b, w, grow=self.fuzz_grow)
            paw = V(fx + w * 0.18, fy - 2.5, dy)
            ell(self.le['ell'][i], paw, w * 0.68, w * 0.55, w * 0.42)
            ell(self.lfe['ell'][i], paw, w * 0.68, w * 0.55, w * 0.42, grow=self.fuzz_grow)
            feet.append((paw, (b - a).length, w))
        self.pts['feet'] = feet

        # head: faces the camera, turned toward where the cat is going by the pose's face turn
        turn = max(-1.0, min(1.0, p['face'][0] + fr['lookX']))
        world_yaw = CAM_YAW + turn * math.radians(42) * math.cos(yaw)
        self.head.location = V(Hd[0], Hd[1], -4 * dsign)
        self.head.scale = (r, r, r)
        self.head.rotation_mode = 'XYZ'
        self.head.rotation_euler = Euler((0, Hd[3], world_yaw - yaw))

        open_ = min(p['face'][1], fr['blink'])
        for eye, glint, lid in zip(self.eyes, self.glints, self.lids):
            closed = open_ < 0.18
            eye.scale = (0.19, 0.1, 0.22 * max(open_, 0.25))
            eye.hide_render = closed
            lid.hide_render = not closed
            glint.hide_render = closed or open_ < 0.45
        m = p['face'][2]
        self.mouth.hide_render = m < 0.12
        self.mouth.scale = (0.08 + 0.12 * m, 0.06, 0.06 + 0.2 * m)
        self.mouth.location = (0, -0.88, -0.48 - 0.12 * m)

        flick = math.sin(min(1, max(0, fr['earFlick'])) * math.pi)
        perk = fr['alert']
        for s, piv in self.ears:
            out = 0.38 - perk * 0.14 + (flick * 0.55 if s > 0 else 0)   # tip away from the centre line
            fwd = -0.12 + perk * 0.22 - (flick * 0.35 if s > 0 else 0)     # + tips toward the face
            piv.rotation_euler = Euler((fwd, s * out, 0))

        T = p['tail']
        f = min(1, max(0, T[9]))
        p0, p3 = V(T[0], T[1], 0), V(T[6], T[7], (16 + (-36 - 16) * f) * dsign)
        p1 = V(T[2], T[3], (14 + (-26 - 14) * f) * dsign)
        p2 = V(T[4], T[5], (16 + (-34 - 16) * f) * dsign)
        for ob, sp, k in self.tails:
            a, b = sp.bezier_points
            a.co, a.handle_left, a.handle_right = p0, p0, p1
            b.handle_left, b.co, b.handle_right = p2, p3, p3
            ob.data.bevel_depth = T[8] * 0.55 * self.tail_w * k
        self.pts['tail_tip'] = (p3, (p3 - p0).length * 0.2 + T[8] * 0.3)
        self.pts['tail_mid'] = (p0 + p1 * 3 + p2 * 3 + p3) / 8

        if self.ruff:
            cd = depth_of(C[2], C[3])
            for e, f, (a, dz, k) in zip(self.re['ell'], self.rfe['ell'], RUFF):
                co = V(C[0] + 4 + math.cos(a) * C[2] * 0.72, C[1] - C[3] * 0.3 + math.sin(a) * C[3] * 0.72, dz * cd * 0.72)
                rr = min(C[2], C[3]) * k
                ell(e, co, rr, rr * 0.8, rr * 0.8)
                ell(f, co, rr, rr * 0.8, rr * 0.8, grow=self.fuzz_grow + 1.2)

        if self.scarf:
            head_c, chest_c = V(Hd[0], Hd[1]), V(C[0], C[1])
            axis = (head_c - chest_c).normalized()
            centre = chest_c.lerp(head_c, 0.5) + Vector((-0.05 * r, 0, -0.12 * r))
            self.scarf.location = centre
            self.scarf.rotation_mode = 'QUATERNION'
            self.scarf.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(axis)
            ring = 0.74 * r if self.acc['type'] == 'scarf' else 0.66 * r
            self.scarf.scale = (ring, ring * 0.92, ring)
            if self.scarf_end:
                self.scarf_end.location = centre + Vector((0.05 * r, -0.62 * r * dsign, -0.3 * r - 15))
                self.scarf_end.rotation_euler = Euler((0, 0.15, 0))
            if self.hang:
                # the front of the collar: forward and toward the camera, across the neck
                cam = Vector((math.sin(CAM_YAW), -math.cos(CAM_YAW), 0))
                cam.rotate(Euler((0, 0, -yaw)))
                want = Vector((0.55, 0, -0.4)) + cam * 0.8
                w = (want - axis * want.dot(axis)).normalized()
                x = axis.cross(w).normalized()
                self.hang.location = centre + w * ring * (1 + self.minor * 0.6)
                self.hang.rotation_quaternion = Matrix((x, -w, axis)).transposed().to_quaternion()
                self.hang.scale = (r, r, r)

        for pt in self.patches:
            pt.set(*pt.place(self))


# ---------------------------------------------------------------------------------- scene
def setup_scene(spec, samples):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = spec['frame']
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    ee = sc.eevee
    for k, v in (('taa_render_samples', samples), ('use_raytracing', True), ('use_shadows', True),
                 ('shadow_ray_count', 2), ('shadow_step_count', 8), ('use_fast_gi', True)):
        if hasattr(ee, k):
            setattr(ee, k, v)

    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = lin('#c9bdb0')
    bg.inputs['Strength'].default_value = 0.55
    sc.world = world

    # orthographic camera; its centre is placed so the world origin (the feet) lands on the anchor
    ppu = spec['pxPerUnit']
    fw, fh = spec['frame']
    ax, ay = spec['anchor']
    cam_data = bpy.data.cameras.new('Camera')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = fw / ppu * 0.01
    cam = link(bpy.data.objects.new('Camera', cam_data))
    view_dir = Vector((-math.sin(CAM_YAW), math.cos(CAM_YAW), -math.tan(CAM_PITCH))).normalized()
    q = view_dir.to_track_quat('-Z', 'Y')
    right, up = q @ Vector((1, 0, 0)), q @ Vector((0, 1, 0))
    off_x = (ax - fw / 2) / ppu * 0.01
    off_y = (fh / 2 - ay) / ppu * 0.01   # anchor is below centre → negative
    cam.location = -view_dir * 10 - right * off_x - up * off_y
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = q
    sc.camera = cam

    def sun(name, direction, strength, angle, color=(1, 1, 1)):
        ld = bpy.data.lights.new(name, 'SUN')
        ld.energy = strength
        ld.angle = math.radians(angle)
        ld.color = color
        ob = link(bpy.data.objects.new(name, ld))
        ob.rotation_mode = 'QUATERNION'
        ob.rotation_quaternion = (-Vector(direction)).normalized().to_track_quat('-Z', 'Y')
        return ob

    # light travels from these directions toward the cat: key from upper left, cool fill, warm rim
    sun('Key', (-0.55, -0.7, 0.75), 3.2, 35, (1.0, 0.97, 0.92))
    sun('Fill', (0.8, -0.5, 0.15), 0.9, 60, (0.85, 0.9, 1.0))
    sun('Rim', (0.35, 0.85, 0.55), 2.6, 20, (1.0, 0.92, 0.82))


def main():
    o = args()
    spec = json.load(open(o['poses'], encoding='utf-8'))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    setup_scene(spec, int(o['samples']))
    cat = FeltCat(spec['def'])
    clips = o['clips'].split(',') if 'clips' in o else list(spec['clips'])
    pick = [int(x) for x in o['frames'].split(',')] if 'frames' in o else None
    sc = bpy.context.scene
    for name in clips:
        frames = spec['clips'][name]['frames']
        out_dir = os.path.join(o['out'], name)
        os.makedirs(out_dir, exist_ok=True)
        for i, fr in enumerate(frames):
            if pick is not None and i not in pick:
                continue
            cat.pose(fr)
            sc.render.filepath = os.path.join(out_dir, f'{i:04d}.png')
            bpy.ops.render.render(write_still=True)
        print(f'CLIP {name} {len(frames)} frames', flush=True)
    if 'save' in o:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(o['save']))


main()
