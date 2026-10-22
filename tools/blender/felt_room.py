# Felt room renderer for Cosy Cats. Builds the library as a needle-felt diorama in Blender, to the
# same plan as the canvas room in js/scene.js (LAYOUT, dumped by room.mjs), and renders it as the
# game's depth plates: sky, back wall, midground, one cut-out per prop (with its own contact
# shadow), light layers for the lamp shade and the logs in front of the fire, a blurred
# foreground, and a small light map that tints the cats.
#
#   blender -b --factory-startup --python tools/blender/felt_room.py -- --layout layout.json
#       --work tmp/ --out assets/room/ [--scale 1] [--samples 64] [--passes back,mid] [--beauty 1]
#       [--save room.blend]
#
# Camera: orthographic, pitched down 7° like the cats' camera (felt_cat.py CAM_PITCH) but square
# on to the room (yaw 0), so horizontals stay level and the cats read as turned slightly toward
# us. One Blender unit is 100 logical px across the frame. A world point (x, y, z), with y going
# into the room and z up, lands on pixel
#     px = 100 x,   py = PY0 - 100 (y sin 7° + z cos 7°).
# Every surface a cat sits on is placed so its top, at the depth the cat sits, is on the SPOT
# pixel. The materials are the cats' felt (felt_cat.py), but textured in world space in pixel
# units, so the wool grain is the same size on screen everywhere.
import bpy
import bmesh
import json
import math
import os
import random
import sys
import numpy as np
from mathutils import Vector, Euler, Matrix

PITCH = math.radians(7)
SP, CP = math.sin(PITCH), math.cos(PITCH)
U = 100.0                 # logical px per Blender unit
PY0 = 1120.0              # pixel row of the floor's front edge (y = 0, z = 0), just below the frame
W, H = 1920, 1080


def X(px):
    return px / U


def Yfl(py):
    """Depth of the floor point that lands on pixel row py."""
    return (PY0 - py) / U / SP


def Zp(py, y):
    """Height at depth y that lands on pixel row py."""
    return ((PY0 - py) / U - y * SP) / CP


def proj(p):
    return p[0] * U, PY0 - U * (p[1] * SP + p[2] * CP)


def args():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    o = {'samples': '64', 'scale': '1'}
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
    out = [round(c + (255 - c) * amt) if amt >= 0 else round(c * (1 + amt)) for c in rgb]
    return '#' + ''.join(f'{max(0, min(255, c)):02x}' for c in out)


# ---------------------------------------------------------------------------------- layers
# Every object is tagged with the plate it belongs to. A pass shows some layers to the camera,
# keeps others as shadow casters only, and hides the rest.
CUR = ['none']


class layer:
    def __init__(self, name):
        self.name = name

    def __enter__(self):
        self.prev = CUR[0]
        CUR[0] = self.name

    def __exit__(self, *a):
        CUR[0] = self.prev


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    ob['layer'] = CUR[0]
    return ob


# ---------------------------------------------------------------------------------- materials
class NB:
    """Small node-tree builder: sockets or constants in, sockets out."""

    def __init__(self, mat):
        self.nt = mat.node_tree
        self.N, self.L = self.nt.nodes, self.nt.links

    def put(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.L.new(v, sock)
        elif isinstance(v, str):
            sock.default_value = lin(v)
        else:
            sock.default_value = v

    def node(self, t, ins=None, **props):
        n = self.N.new(t)
        for k, v in props.items():
            setattr(n, k, v)
        for k, v in (ins or {}).items():
            self.put(n.inputs[k], v)
        return n

    def m(self, op, a, b=0.0, c=0.0, clamp=False):
        n = self.N.new('ShaderNodeMath')
        n.operation = op
        n.use_clamp = clamp
        for i, v in enumerate((a, b, c)):
            self.put(n.inputs[i], v)
        return n.outputs[0]

    def add(self, a, b):
        return self.m('ADD', a, b)

    def mul(self, a, b):
        return self.m('MULTIPLY', a, b)

    def sep(self, v):
        n = self.node('ShaderNodeSeparateXYZ')
        self.put(n.inputs[0], v)
        return n.outputs[0], n.outputs[1], n.outputs[2]

    def comb(self, x, y, z):
        n = self.node('ShaderNodeCombineXYZ')
        for i, v in enumerate((x, y, z)):
            self.put(n.inputs[i], v)
        return n.outputs[0]

    def vmul(self, v, s):
        n = self.node('ShaderNodeVectorMath', operation='MULTIPLY')
        self.put(n.inputs[0], v)
        self.put(n.inputs[1], s if isinstance(s, bpy.types.NodeSocket) else (s, s, s) if isinstance(s, float) else s)
        return n.outputs[0]

    def mrange(self, v, a, b, c=0.0, d=1.0, interp='LINEAR'):
        n = self.node('ShaderNodeMapRange', interpolation_type=interp)
        n.clamp = True
        self.put(n.inputs['Value'], v)
        for k, x in (('From Min', a), ('From Max', b), ('To Min', c), ('To Max', d)):
            n.inputs[k].default_value = x
        return n.outputs['Result']

    def mix(self, a, b, fac, blend='MIX'):
        n = self.node('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        self.put(n.inputs['Factor'], fac)
        self.put(n.inputs['A'], a)
        self.put(n.inputs['B'], b)
        return n.outputs['Result']

    def noise(self, v, scale, detail=2.0, rough=0.5, dist=0.0):
        n = self.node('ShaderNodeTexNoise')
        self.put(n.inputs['Vector'], v)
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough
        n.inputs['Distortion'].default_value = dist
        return n.outputs[0]

    def ramp(self, fac, stops, interp='LINEAR'):
        n = self.node('ShaderNodeValToRGB')
        r = n.color_ramp
        r.interpolation = interp
        r.elements[0].position, r.elements[0].color = stops[0][0], lin(stops[0][1])
        r.elements[1].position, r.elements[1].color = stops[-1][0], lin(stops[-1][1])
        for pos, c in stops[1:-1]:
            e = r.elements.new(pos)
            e.color = lin(c)
        self.put(n.inputs[0], fac)
        return n.outputs[0]

    def px(self):
        """World position in logical pixels."""
        g = self.node('ShaderNodeNewGeometry')
        return self.vmul(g.outputs['Position'], (U, U, U))


def bsdf(mat):
    return next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')


def setin(node, name, value):
    if name in node.inputs:
        node.inputs[name].default_value = value


MATS = {}


def felt(name, base, *, var=0.12, sheen=0.8, rough=1.0, bump=0.45, sss=0.1, pattern=None, alpha=None,
         emission=0.0, emit_color=None, spec=0.25, metallic=0.0, coat=0.0, tex_scale=1.0, streak=0.0, streak_dir=(0.5, 0.5, 0.04),
         rough_var=0.0):
    """Matte wool as on the cats: sheen for the soft fibre rim, a fibre-and-lump bump, and blotchy
    mottling. `pattern(g, P, col)` returns a new colour socket from the pixel-space position P, or
    (colour, relief) to add its own relief (knit stitches, channels) to the bump.
    `streak` adds directional fibres (long along the axis with the small `streak_dir` factor), and
    `rough_var` lets the roughness wander so the fabric isn't one even sheen.
    `alpha` makes the sparse fuzz shell (dithered, back faces culled)."""
    key = name
    if key in MATS:
        return MATS[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    MATS[key] = m
    g = NB(m)
    b = bsdf(m)
    setin(b, 'Roughness', rough)
    setin(b, 'Sheen Weight', sheen)
    setin(b, 'Sheen Roughness', 0.6)
    setin(b, 'Sheen Tint', (1, 0.97, 0.92, 1))
    setin(b, 'Subsurface Weight', sss)
    setin(b, 'Subsurface Radius', (0.8, 0.5, 0.35))
    setin(b, 'Subsurface Scale', 0.02)
    setin(b, 'Specular IOR Level', spec)
    setin(b, 'Metallic', metallic)
    setin(b, 'Coat Weight', coat)
    setin(b, 'Coat Roughness', 0.08)
    P = g.px()
    if tex_scale != 1.0:
        P = g.vmul(P, (tex_scale,) * 3)
    col = base if isinstance(base, bpy.types.NodeSocket) else None
    if col is None:
        n = g.node('ShaderNodeRGB')
        n.outputs[0].default_value = lin(base)
        col = n.outputs[0]
    relief = None
    if pattern:
        col = pattern(g, P, col)
        if isinstance(col, tuple):
            col, relief = col
    st = None
    if streak:
        # brushed fibres: noise stretched along one direction
        st = g.noise(g.vmul(P, streak_dir), 1.0, 4, 0.6)
        k = g.mrange(st, 0.35, 0.65, 1 - streak, 1 + streak)
        col = g.mix(col, g.comb(k, k, k), 1.0, 'MULTIPLY')
    if rough_var:
        rv = g.noise(P, 0.03, 3)
        g.put(b.inputs['Roughness'], g.mrange(rv, 0.35, 0.65, rough - rough_var, rough))
    if var:
        # wool is never one flat colour: blotchy light/dark variation like teased fibres
        mot = g.noise(P, 0.06, 6, 0.55)
        k = g.mrange(mot, 0.3, 0.7, 1 - var, 1 + var)
        col = g.mix(col, g.comb(k, k, k), 1.0, 'MULTIPLY')
    g.put(b.inputs['Base Color'], col)
    if bump:
        fib = g.noise(P, 1.3, 10, 0.75, 1.5)
        lump = g.noise(P, 0.2, 4)
        h = g.m('MULTIPLY_ADD', lump, 0.6, fib)
        if st is not None:
            h = g.m('MULTIPLY_ADD', st, 0.8, h)
        if relief is not None:
            h = g.add(h, relief)
        bn = g.node('ShaderNodeBump')
        bn.inputs['Strength'].default_value = bump
        bn.inputs['Distance'].default_value = 0.008
        g.put(bn.inputs['Height'], h)
        g.put(b.inputs['Normal'], bn.outputs['Normal'])
    if emission:
        g.put(b.inputs['Emission Color'], emit_color if emit_color is not None else col)
        setin(b, 'Emission Strength', emission)
    if alpha is not None:
        sp = g.noise(P, 1.4, 6)
        g.put(b.inputs['Alpha'], g.mrange(sp, 0.5, 0.72, 0, alpha))
        m.surface_render_method = 'DITHERED'
        m.use_backface_culling = True
    return m


def fuzz_mat(color, alpha=0.55):
    return felt(f'Fuzz{color}', shade(color, 0.16), alpha=alpha, bump=0.0, sheen=1.0, var=0.1)


def wood(name, base, along='X', streak=0.3):
    """Felted wood: warm wool with soft grain streaks running along the board."""
    def grain(g, P, col):
        x, y, z = g.sep(P)
        a = {'X': x, 'Y': y, 'Z': z}[along]
        c = {'X': z, 'Y': x, 'Z': x}[along]
        w = g.noise(g.comb(g.mul(a, 0.012), g.mul(c, 0.25), 0.0), 2.0, 3, 0.6, 2.5)
        band = g.mrange(w, 0.42, 0.62)
        return g.mix(col, shade(base, -0.28), g.mul(band, streak))
    return felt(name, base, pattern=grain, sheen=0.35, var=0.08, bump=0.3, spec=0.3, rough=0.85)


def flat(name, color, *, rough=0.5, metallic=0.0, coat=0.0, emission=0.0, alpha=1.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    MATS[name] = m
    b = bsdf(m)
    b.inputs['Base Color'].default_value = lin(color)
    setin(b, 'Roughness', rough)
    setin(b, 'Metallic', metallic)
    setin(b, 'Coat Weight', coat)
    setin(b, 'Coat Roughness', 0.05)
    if emission:
        setin(b, 'Emission Color', lin(color))
        setin(b, 'Emission Strength', emission)
    if alpha < 1:
        setin(b, 'Alpha', alpha)
        m.surface_render_method = 'BLENDED'
    return m


def obj_color_felt(name, *, sheen=0.7, bump=0.4, var=0.1, deco=None):
    """Felt whose base colour is each object's own colour (books, leaves, yarn): one material."""
    if name in MATS:
        return MATS[name]

    def from_object(g, P, col):
        oi = g.node('ShaderNodeObjectInfo')
        c = oi.outputs['Color']
        return deco(g, P, c) if deco else c
    return felt(name, '#ffffff', pattern=from_object, sheen=sheen, bump=bump, var=var)


# ---------------------------------------------------------------------------------- geometry
def mesh_obj(name, mat, verts, faces, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    for p in me.polygons:
        p.use_smooth = smooth
    if mat:
        me.materials.append(mat)
    return link(bpy.data.objects.new(name, me))


def from_bm(name, mat, bm, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    if mat:
        me.materials.append(mat)
    return link(bpy.data.objects.new(name, me))


def bev(ob, w, segs=3):
    mod = ob.modifiers.new('bevel', 'BEVEL')
    mod.width = w
    mod.segments = segs
    mod.limit_method = 'ANGLE'
    mod.harden_normals = False
    return ob


def sub(ob, lv=1):
    mod = ob.modifiers.new('round', 'SUBSURF')
    mod.levels = mod.render_levels = lv
    return ob


def rbox(name, mat, x0, x1, y0, y1, z0, z1, bevel=0.03, segs=3):
    v = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    ob = mesh_obj(name, mat, v, f, smooth=bevel > 0)
    if bevel:
        bev(ob, min(bevel, (x1 - x0) / 2.01, (y1 - y0) / 2.01, (z1 - z0) / 2.01), segs)
    return ob


def prism(name, mat, poly, y0, y1, bevel=0.0, segs=2):
    """A 2D (x, z) outline extruded from depth y0 (front) to y1."""
    bm = bmesh.new()
    f = [bm.verts.new((x, y0, z)) for x, z in poly]
    b = [bm.verts.new((x, y1, z)) for x, z in poly]
    bm.faces.new(f)
    bm.faces.new(b[::-1])
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((f[i], f[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = from_bm(name, mat, bm, smooth=bevel > 0)
    if bevel:
        bev(ob, bevel, segs)
    return ob


def px_poly(pts, y):
    """Pixel outline → wall-plane (x, z) at depth y, so it lands on exactly those pixels."""
    return [(X(px), Zp(py, y)) for px, py in pts]


def lathe(name, mat, cx, cy, prof, segs=48, sx=1.0, sy=1.0, cap_bottom=True, cap_top=True):
    """Surface of revolution round a vertical axis at (cx, cy); prof = [(r, z), ...] bottom → top."""
    bm = bmesh.new()
    rings = []
    for r, z in prof:
        rings.append([bm.verts.new((cx + r * sx * math.cos(a), cy + r * sy * math.sin(a), z))
                      for a in (2 * math.pi * i / segs for i in range(segs))])
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap_bottom and prof[0][0] > 0:
        bm.faces.new(rings[0][::-1])
    if cap_top and prof[-1][0] > 0:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return from_bm(name, mat, bm)


def ell(name, mat, c, r, rot=(0, 0, 0), seg=32):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(8, seg // 2), radius=1.0)
    ob = from_bm(name, mat, bm)
    ob.location, ob.scale, ob.rotation_euler = c, r, rot
    return ob


def pillowbox(name, mat, c, half, e=0.25, seg=56, top=None):
    """A soft upholstered block: a superellipsoid (a box with pillowy rounded edges). `top(x, y)`
    gives a height change for the upper face (a plump middle, a sleep hollow), fading out down
    the sides."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=1.0)
    f = lambda t: math.copysign(abs(t) ** e, t)
    a, b, cc = half
    for v in bm.verts:
        nx, ny, nz = v.co
        x, y, z = c[0] + a * f(nx), c[1] + b * f(ny), c[2] + cc * f(nz)
        if top and nz > 0:
            w = min(1.0, max(0.0, (f(nz) - 0.55) / 0.35))
            z += top(x, y) * w * w * (3 - 2 * w)
        v.co = (x, y, z)
    ob = from_bm(name, mat, bm)
    sub(ob, 1)
    return ob


def tube(name, mat, pts, r, radii=None, res=3, smooth=True):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = res
    cu.use_fill_caps = True
    if smooth and len(pts) > 2:
        sp = cu.splines.new('BEZIER')
        sp.bezier_points.add(len(pts) - 1)
        for i, (bp, co) in enumerate(zip(sp.bezier_points, pts)):
            bp.co = co
            bp.handle_left_type = bp.handle_right_type = 'AUTO'
            bp.radius = radii[i] if radii else 1.0
        cu.resolution_u = 8
    else:
        sp = cu.splines.new('POLY')
        sp.points.add(len(pts) - 1)
        for i, (p, co) in enumerate(zip(sp.points, pts)):
            p.co = (*co, 1)
            p.radius = radii[i] if radii else 1.0
    cu.materials.append(mat)
    return link(bpy.data.objects.new(name, cu))


def arc_band(name, mat, cx, cy, r0, r1, a0, a1, y0, y1, n=24, bevel=0.01):
    """An annular band in pixel space (screen angles, y down), extruded y0 → y1."""
    outer = [(cx + r1 * math.cos(a), cy - r1 * math.sin(a)) for a in np.linspace(a0, a1, n)]
    inner = [(cx + r0 * math.cos(a), cy - r0 * math.sin(a)) for a in np.linspace(a1, a0, n)]
    return prism(name, mat, px_poly(outer + inner, (y0 + y1) / 2), y0, y1, bevel)


def fuzz(ob, thick=0.016, color=None, alpha=0.55):
    """The felt halo: a see-through speckled shell just outside the surface, as on the cats."""
    f = ob.copy()
    link(f)
    f['layer'] = ob['layer']
    d = f.modifiers.new('fuzz', 'DISPLACE')
    d.mid_level = 0.0
    d.strength = thick
    mat = fuzz_mat(color, alpha)
    for s in f.material_slots:
        s.link = 'OBJECT'
        s.material = mat
    return f


def leaf_shape(n=10):
    """The canvas room's pothos leaf: a heart from (0, 0) to (0, 1), as (u across, v along)."""
    def bez(p0, p1, p2, p3, t):
        return tuple((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d
                     for a, b, c, d in zip(p0, p1, p2, p3))
    right = [bez((0, 0), (0.7, -0.5), (0.9, 0.4), (0, 1), t) for t in np.linspace(0, 1, n)]
    left = [(-u, v) for u, v in right[::-1]][1:-1]
    return right + left


LEAF = leaf_shape()


def leaf(name, mat, base, tip_dir, size, *, curl=0.12, tilt=0.0, color=None, y_of=None):
    """A felt leaf in screen space: base pixel, tip direction (screen dx, dy), size in px. The leaf
    faces the camera with a fold along the midrib; y_of(px, py) gives the depth."""
    bx, by = base
    dx, dy = tip_dir
    ln = math.hypot(dx, dy) or 1
    dx, dy = dx / ln, dy / ln
    nx, ny = -dy, dx
    verts, faces = [], []
    ctr = (bx + dx * size * 0.45, by + dy * size * 0.45)
    pts = [(bx + (u * nx + v * dx) * size, by + (u * ny + v * dy) * size, abs(u)) for u, v in LEAF]
    yc = y_of(*ctr)
    for x, y, a in pts:
        yy = yc + a * curl * size / U + tilt * (x - ctr[0]) / U
        verts.append((X(x), yy, Zp(y, yy)))
    verts.append((X(ctr[0]), yc - 0.02, Zp(ctr[1], yc - 0.02)))
    c = len(verts) - 1
    for i in range(len(pts)):
        faces.append((i, (i + 1) % len(pts), c))
    ob = mesh_obj(name, mat, verts, faces)
    sol = ob.modifiers.new('felt', 'SOLIDIFY')
    sol.thickness = 0.012
    sub(ob, 2)
    if color:
        ob.color = (*lin(color)[:3], 1)
    return ob


GREENS = ['#79a65a', '#669a4c', '#8ab866', '#5a8a44']


def vine(name, pts_px, y_of, rng, *, leaf_size=(13, 18), every=0.14, stem='#557f40', leaf_mat=None):
    """A trailing pothos stem through pixel points, with leaves alternating along it."""
    pts = [(X(x), y_of(x, y), Zp(y, y_of(x, y))) for x, y in pts_px]
    tube(name + 'Stem', felt('Stem', stem, sheen=0.4, bump=0.2), pts, 0.016)
    # walk along the polyline
    seg = [math.dist(a, b) for a, b in zip(pts_px, pts_px[1:])]
    total = sum(seg)
    t, k = every * 0.6, 0
    while t < 1:
        d = t * total
        i = 0
        while i < len(seg) - 1 and d > seg[i]:
            d -= seg[i]
            i += 1
        f = d / seg[i] if seg[i] else 0
        (x0, y0), (x1, y1) = pts_px[i], pts_px[i + 1]
        x, y = x0 + (x1 - x0) * f, y0 + (y1 - y0) * f
        side = 1 if k % 2 else -1
        ang = math.atan2(y1 - y0, x1 - x0) + side * 1.0
        sz = rng.uniform(*leaf_size)
        leaf(f'{name}Leaf{k}', leaf_mat, (x, y), (math.cos(ang), math.sin(ang) + 0.25), sz,
             color=GREENS[rng.randrange(4)], y_of=lambda *_: y_of(x, y) - 0.03, tilt=rng.uniform(-0.3, 0.3))
        t += every * rng.uniform(0.8, 1.2)
        k += 1


# ---------------------------------------------------------------------------------- the room
PAL = {
    'wall': '#5a7096', 'wallMotif': '#9fb2cc', 'wood': '#9a6440', 'woodDark': '#6a4029', 'woodLight': '#b57d52',
    'cream': '#efe2c6', 'floor': '#a06a44', 'curtain': '#d6a347', 'sage': '#7d9a66', 'teal': '#74a6a0',
    'stone': '#e9d9bb', 'brick': '#a5603f', 'soot': '#5a3022',
}


class Room:
    def __init__(self, L):
        self.L = L
        self.rng = random.Random(5)
        self.Yw = Yfl(862)            # back wall; the wall meets the floor on pixel row 862
        self.view = tuple(L.get('VIEW', (0, 0, W, H)))   # the part of the room the game shows
        self.shapes = {}

    def build(self):
        with layer('back'):
            self.wall()
            self.window()
            self.curtains()
            self.fairy_wire()
            self.hanging_plant()
        with layer('mid'):
            self.floor()
            self.rug()
            self.bookshelf()
            self.fireplace()
        with layer('logs'):
            self.front_logs()
        with layer('prop:armchair'):
            self.armchair()
        with layer('prop:table'):
            self.side_table()
        with layer('shade'):
            self.lamp_shade()
        with layer('prop:pouf'):
            self.pouf()
        with layer('prop:basket'):
            self.basket()
        with layer('fore'):
            self.foreground()
        with layer('sky'):
            self.sky()

    # -- back wall ---------------------------------------------------------------------------
    def wall(self):
        Yw = self.Yw

        def paper(g, P, col):
            # felt wallpaper: soft vertical stripes and a little embroidered leaf every 64 × 74 px
            x, y, z = g.sep(P)
            s = g.m('SINE', g.mul(x, 2 * math.pi / 64))
            col = g.mix(col, shade(PAL['wall'], 0.07), g.mrange(s, 0.2, 0.6))
            row = g.m('FLOOR', g.mul(z, 1 / 74))
            off = g.mul(g.m('MODULO', row, 2.0), 0.5)
            fx = g.add(g.m('FRACT', g.add(g.mul(x, 1 / 64), off)), -0.5)
            fz = g.add(g.m('FRACT', g.mul(z, 1 / 74)), -0.5)
            d = g.add(g.m('POWER', g.mul(fx, 64 / 6.5), 2.0), g.m('POWER', g.mul(fz, 74 / 11), 2.0))
            return g.mix(col, PAL['wallMotif'], g.mrange(d, 1.0, 0.6, 0, 0.38))
        self.m_wall = felt('Wall', PAL['wall'], pattern=paper, var=0.1, sheen=0.6, bump=0.35)
        wall = rbox('Wall', self.m_wall, -2.0, 21.5, Yw, Yw + 0.3, -0.2, 20, bevel=0)
        # the window opening goes right through
        w = self.L['WIN']
        cut = self.window_outline(0)
        with layer('cutter'):
            cutter = prism('WindowCut', None, px_poly(cut, Yw), Yw - 1.0, Yw + 1.0)
        mod = wall.modifiers.new('window', 'BOOLEAN')
        mod.object = cutter
        mod.operation = 'DIFFERENCE'
        self.wainscot(Yw, -2.0, 21.5, w)
        # crown moulding along the top of the frame
        m_wood = wood('Wood', PAL['wood'])
        rbox('Crown', m_wood, -2.0, 21.5, Yw - 0.26, Yw, Zp(40, Yw - 0.26), 20, bevel=0.03)
        rbox('CrownLip', wood('WoodLight', PAL['woodLight']), -2.0, 21.5, Yw - 0.32, Yw - 0.2,
             Zp(44, Yw - 0.32), Zp(32, Yw - 0.32), bevel=0.02)

    def wainscot(self, y, x0, x1, w=None, panels=True):
        """Wood panelling below the dado rail, at the same heights as on the back wall."""
        Yw = self.Yw
        z = lambda py: Zp(py, Yw)
        m = wood('Panel', '#8f5a3a')
        m_rail = wood('Rail', '#a8714b')
        m_base = wood('Base', '#6e4329')
        rbox('Wainscot', m, x0, x1, y - 0.05, y + 0.01, 0, z(600), bevel=0)
        rbox('Rail', m_rail, x0, x1, y - 0.14, y, z(618), z(594), bevel=0.03)
        rbox('Baseboard', m_base, x0, x1, y - 0.12, y, 0, z(804), bevel=0.025)
        rbox('BaseLip', m_rail, x0, x1, y - 0.15, y - 0.08, z(810), z(802), bevel=0.015)
        if panels:
            for k, px in enumerate(range(20, 2100, 170)):
                if X(px + 140) < x0 or X(px) > x1:
                    continue
                rbox(f'PanelRaise{k}', m, max(x0, X(px + 6)), min(x1, X(px + 134)), y - 0.09, y - 0.04,
                     z(784), z(646), bevel=0.035)

    def window_outline(self, inset, n=40):
        w = self.L['WIN']
        cx = (w['x0'] + w['x1']) / 2
        r = w['r'] - inset
        pts = [(w['x0'] + inset, w['sill']), (w['x0'] + inset, w['archY'])]
        pts += [(cx + r * math.cos(a), w['archY'] - r * math.sin(a)) for a in np.linspace(math.pi, 0, n)[1:-1]]
        pts += [(w['x1'] - inset, w['archY']), (w['x1'] - inset, w['sill'])]
        return pts

    def window(self):
        Yw = self.Yw
        w = self.L['WIN']
        x0, x1, archY, r, sill = w['x0'], w['x1'], w['archY'], w['r'], w['sill']
        cx = (x0 + x1) / 2
        m = felt('Frame', PAL['cream'], sheen=0.5, var=0.06, bump=0.3)
        y0, y1 = Yw - 0.08, Yw + 0.12
        yf = (y0 + y1) / 2
        # sill: the sill cat sits on its top at the middle of its depth
        ys = Yw - 0.3
        zs = Zp(sill, ys)
        self.sill_z = zs
        rbox('Sill', felt('SillTop', '#d6c3a0', sheen=0.3, var=0.07, bump=0.35, spec=0.1),
             X(x0 - 34), X(x1 + 34), Yw - 0.6, Yw + 0.32, zs - 0.26 / CP, zs, bevel=0.05)
        rbox('Apron', m, X(x0 - 16), X(x1 + 16), Yw - 0.4, Yw, zs - 0.55, zs - 0.26, bevel=0.04)
        bot = (sill, )
        # frame: jambs, arch, mullions, transom and the fan bars in the arch
        za = Zp(archY, yf)
        rbox('JambL', m, X(x0 - 11), X(x0 + 11), y0, y1, zs - 0.02, za, bevel=0.02)
        rbox('JambR', m, X(x1 - 11), X(x1 + 11), y0, y1, zs - 0.02, za, bevel=0.02)
        arc_band('Arch', m, cx, archY, r - 11, r + 11, 0, math.pi, y0, y1, n=40)
        rbox('Mullion', m, X(cx - 5), X(cx + 5), y0 + 0.04, y1 - 0.04, zs - 0.02, Zp(archY - r + 4, yf), bevel=0.015)
        for py in (465, archY):
            rbox(f'Transom{py}', m, X(x0), X(x1), y0 + 0.04, y1 - 0.04, Zp(py + 5, yf), Zp(py - 5, yf), bevel=0.015)
        for a in (math.pi * 0.25, math.pi * 0.75):
            p0 = (cx, archY)
            p1 = (cx + math.cos(a) * r, archY - math.sin(a) * r)
            nx, ny = -math.sin(a) * 5, -math.cos(a) * 5
            poly = [(p0[0] + nx, p0[1] + ny), (p1[0] + nx, p1[1] + ny), (p1[0] - nx, p1[1] - ny), (p0[0] - nx, p0[1] - ny)]
            prism(f'Fan{a:.2f}', m, px_poly(poly, yf), y0 + 0.04, y1 - 0.04, 0.01)
        arc_band('Hub', m, cx, archY, 0, 26, 0, math.pi, y0 + 0.02, y1 - 0.02, n=16)
        # a succulent and a stack of books on the sill (clear of the sill cat at x 985)
        yy = Yw - 0.32
        lathe('SucculentPot', felt('PotCream', '#f4e9d6', sheen=0.5, var=0.05), X(x0 + 30), yy,
              [(0.17, zs), (0.2, zs + 0.06), (0.2, zs + 0.3), (0.16, zs + 0.3)], cap_top=False)
        rng = random.Random(3)
        m_succ = obj_color_felt('Succulent', sheen=0.5, bump=0.3)
        for i in range(9):
            a = -math.pi / 2 + (i - 4) * 0.34
            ln = 0.18 + (i % 2) * 0.04
            dx, dz = math.cos(a), -math.sin(a)
            o = ell(f'Succ{i}', m_succ, (X(x0 + 30) + dx * ln * 0.6, yy - 0.05 * (i % 3), zs + 0.3 + dz * ln * 0.6),
                    (0.07, 0.07, ln * 0.55), (0, math.atan2(dx, dz), 0), seg=16)
            o.color = (*lin(['#8fb585', '#7aa36f', '#a3c79a'][i % 3])[:3], 1)
        m_book = self.book_mat()
        z = zs
        for k, (bw, col) in enumerate(((64, '#7a4a6b'), (56, '#e2d2ad'))):
            bx = x1 - 70 + (64 - bw) / 2
            o = rbox(f'SillBook{k}', m_book, X(bx), X(bx + bw), yy - 0.22, yy + 0.18, z, z + 0.14, bevel=0.015, segs=2)
            o.color = (*lin(col)[:3], 1)
            o['style'] = 3.0
            z += 0.14

    def curtains(self):
        Yw = self.Yw
        w = self.L['WIN']
        x0, x1 = w['x0'], w['x1']
        m = felt('Velvet', PAL['curtain'], sheen=1.0, var=0.1, bump=0.25, sss=0.15)
        m_tie = felt('Tie', '#9c3a30', sheen=0.8)
        m_brass = flat('Brass', '#d9b46a', rough=0.32, metallic=0.75, coat=0.3)
        top, tie, bottom = 112, 480, 800
        sm = lambda t: t * t * (3 - 2 * t)
        for d in (1, -1):
            x = x0 - 96 if d == 1 else x1 + 96
            outer, inner = x - d * 30, x + d * 70

            def edges(py):
                if py <= tie:
                    t = sm((py - top) / (tie - top))
                    return outer + (outer + d * 8 - outer) * t, inner + (x + d * 4 - inner) * t
                t = (py - tie) / (bottom - tie)
                return outer + d * 8 + (outer - d * 10 - outer - d * 8) * sm(t), x + d * 4 + (66 * d) * math.sin(t * math.pi / 2)
            NR, NC = 48, 26
            verts, faces = [], []
            for j in range(NR):
                py = top + (bottom - top) * j / (NR - 1)
                a, b = edges(py)
                dist = abs(py - tie) / (tie - top)
                amp = 0.05 + 0.2 * min(1, dist)
                for i in range(NC):
                    u = i / (NC - 1)
                    px = a + (b - a) * u
                    yy = Yw - 0.24 - amp * (0.5 + 0.5 * math.sin(u * 2 * math.pi * 4.5 + j * 0.03))
                    verts.append((X(px), yy, Zp(py, yy)))
            for j in range(NR - 1):
                for i in range(NC - 1):
                    k = j * NC + i
                    faces.append((k, k + 1, k + NC + 1, k + NC))
            ob = mesh_obj(f'Curtain{d}', m, verts, faces)
            sol = ob.modifiers.new('felt', 'SOLIDIFY')
            sol.thickness = 0.04
            sub(ob, 1)
            # tie-back band and its brass knob
            ty = Yw - 0.52
            ell(f'TieBack{d}', m_tie, (X(x + d * 16), ty, Zp(tie, ty)), (0.46, 0.14, 0.085), (0, d * 0.15, 0))
            ell(f'TieKnob{d}', m_brass, (X(x + d * 46), ty - 0.12, Zp(tie, ty - 0.12)), (0.09, 0.09, 0.09))
        ry = Yw - 0.45
        rz = Zp(107, ry)
        tube('Rod', m_brass, [(X(x0 - 112), ry, rz), (X(x1 + 112), ry, rz)], 0.05, smooth=False)
        for fx in (x0 - 114, x1 + 114):
            ell(f'Finial{fx}', m_brass, (X(fx), ry, rz), (0.12, 0.12, 0.12))

    def fairy_wire(self):
        yw = self.Yw - 0.62
        pts = [(X(p['x']), yw, Zp(p['y'], yw)) for p in self.L['FAIRY']]
        tube('FairyWire', flat('Wire', '#3a3024', rough=0.6), pts, 0.011)
        m_cap = flat('BulbCap', '#3d4a35', rough=0.5)
        for i, p in enumerate(self.L['FAIRY']):
            # the bulbs themselves are drawn live (scene.js drawGlow) just below each cap
            lathe(f'BulbCap{i}', m_cap, X(p['x']), yw, [(0.026, Zp(p['y'] + 2.5, yw)), (0.03, Zp(p['y'] - 0.5, yw))], segs=12)

    def hanging_plant(self):
        Yw = self.Yw
        hx = 1240
        yh = Yw - 1.2
        y_of = lambda px, py: yh
        m_rope = felt('Rope', '#dcc8a4', sheen=0.6, bump=0.5)
        m_pot = felt('Terracotta', '#d4825c', sheen=0.4, var=0.1)
        zt, zb = Zp(223, yh), Zp(250, yh)
        lathe('HangPot', m_pot, X(hx), yh, [(0.2, zb), (0.25, zb + 0.15), (0.27, zt), (0.3, zt), (0.3, zt + 0.06), (0.25, zt + 0.06)],
              cap_top=False)
        hook = (X(hx), yh, Zp(38, yh))
        for k, a in enumerate((math.pi, 0.0, math.pi / 2)):
            end = (X(hx) + math.cos(a) * 0.29, yh + math.sin(a) * 0.29, zt + 0.04)
            mid = (X(hx) + math.cos(a) * 0.09, yh + math.sin(a) * 0.09, Zp(120, yh))
            tube(f'Rope{k}', m_rope, [hook, mid, end], 0.012)
        ell('Knot', m_rope, (X(hx), yh, Zp(120, yh)), (0.05, 0.05, 0.07))
        rng = random.Random(17)
        m_leaf = obj_color_felt('Leaf', sheen=0.6, bump=0.35)
        for k in range(9):
            leaf(f'HangTop{k}', m_leaf, (hx - 22 + k * 5.5, 226), (math.cos(-1.6 + k * 0.4 - math.pi / 2), math.sin(-1.6 + k * 0.4 - math.pi / 2)),
                 17, color=GREENS[k % 4], y_of=lambda *_: yh - 0.25 + (k % 3) * 0.1)
        for v in range(4):
            vx = hx - 26 + v * 15
            ln = 80 + rng.random() * 90
            pts = [(vx, 236), (vx + 10, 250 + ln * 0.25), (vx - 6, 236 + ln * 0.6), (vx + (v - 1.5) * 9, 236 + ln)]
            vine(f'HangVine{v}', pts, lambda px, py: yh - 0.3, rng, leaf_mat=m_leaf, leaf_size=(12, 16))

    # -- midground ---------------------------------------------------------------------------
    def floor(self):
        def planks(g, P, col):
            x, y, z = g.sep(P)
            br = g.node('ShaderNodeTexBrick', offset=0.37, offset_frequency=1, squash=1.0, squash_frequency=1)
            g.put(br.inputs['Vector'], g.comb(y, x, 0.0))
            br.inputs['Scale'].default_value = 1.0
            br.inputs['Brick Width'].default_value = 1500
            br.inputs['Row Height'].default_value = 64
            br.inputs['Mortar Size'].default_value = 2.2
            br.inputs['Mortar Smooth'].default_value = 0.4
            br.inputs['Bias'].default_value = 0.0
            g.put(br.inputs['Color1'], shade(PAL['floor'], 0.06))
            g.put(br.inputs['Color2'], shade(PAL['floor'], -0.1))
            g.put(br.inputs['Mortar'], '#4a2b1c')
            grain = g.noise(g.comb(g.mul(x, 0.3), g.mul(y, 0.01), 0.0), 1.5, 3, 0.6, 2.0)
            return g.mix(br.outputs['Color'], shade(PAL['floor'], -0.25), g.mul(g.mrange(grain, 0.45, 0.65), 0.35))
        m = felt('Floor', PAL['floor'], pattern=planks, sheen=0.05, var=0.08, bump=0.25, rough=0.9, spec=0.02)
        rbox('Floor', m, -2.0, 21.5, -3.0, self.Yw + 0.3, -0.3, 0.0, bevel=0)

    def rug(self):
        cx, cy = 10.0, Yfl(940)
        rx, ry = 4.7, 0.72 / SP
        self.rug_c = (cx, cy, rx, ry)

        def bands(g, P, col):
            x, y, z = g.sep(P)
            dx = g.mul(g.add(x, -cx * U), 1 / (rx * U))
            dy = g.mul(g.add(y, -cy * U), 1 / (ry * U))
            d = g.m('SQRT', g.add(g.mul(dx, dx), g.mul(dy, dy)))
            c = g.ramp(d, [(0.0, '#3f7f78'), (0.22, '#e0ad48'), (0.34, '#8f3a30'), (0.4, '#c9703f'),
                           (0.655, '#efdcb4'), (0.675, '#c9703f'), (0.72, '#b0523f'), (0.9, '#efdcb4'),
                           (0.95, '#8f3a30')], 'CONSTANT')
            th = g.m('ARCTAN2', dy, dx)
            ring = g.mrange(g.m('ABSOLUTE', g.add(d, -0.925)), 0.024, 0.012)
            dia = g.mrange(g.m('SINE', g.mul(th, 57)), 0.2, 0.6)
            c = g.mix(c, '#8f3a30', g.mul(ring, dia))
            fr = g.mrange(g.m('ABSOLUTE', g.add(d, -0.55)), 0.05, 0.03)
            fl = g.mrange(g.m('COSINE', g.mul(th, 12)), 0.86, 0.95)
            return g.mix(c, '#efdcb4', g.mul(fr, fl))
        m = felt('Rug', '#c9703f', pattern=bands, sheen=0.12, var=0.12, bump=0.9, spec=0.02, streak=0.06, streak_dir=(0.35, 0.05, 0.35), rough_var=0.15)
        prof = [(0.985, 0.0), (1.0, 0.012), (1.0, 0.035), (0.98, 0.045), (0.0, 0.045)]
        rug = lathe('Rug', m, cx, cy, [(r, z) for r, z in prof], segs=96, sx=rx, sy=ry)
        fuzz(rug, 0.018, '#c9703f', 0.6)
        m_fr = felt('Fringe', '#efdfbb', sheen=0.8, bump=0.3)
        for side in (-1, 1):
            for a in np.arange(-0.45, 0.4501, 0.035):
                bx = cx + side * math.cos(a) * rx
                by = cy + math.sin(a) * ry
                tube(f'Fringe{side}{a:.3f}', m_fr, [(bx, by, 0.02), (bx + side * 0.17, by, 0.012)], 0.012, smooth=False)

    def book_mat(self):
        if 'Book' in MATS:
            return MATS['Book']

        def deco(g, P, c):
            # spine bands / label / roundel from the object's own box (Generated coords)
            tc = g.node('ShaderNodeTexCoord')
            gx, gy, gz = g.sep(tc.outputs['Generated'])
            at = g.node('ShaderNodeAttribute', attribute_type='OBJECT', attribute_name='style')
            st = at.outputs['Factor']
            gold = g.mix(c, '#f4dc9a', 0.75)
            bands = g.m('MAXIMUM', g.mrange(g.m('ABSOLUTE', g.add(gz, -0.9)), 0.03, 0.015),
                        g.mrange(g.m('ABSOLUTE', g.add(gz, -0.1)), 0.03, 0.015))
            label = g.mul(g.mrange(g.m('ABSOLUTE', g.add(gz, -0.68)), 0.12, 0.1), g.mrange(g.m('ABSOLUTE', g.add(gx, -0.5)), 0.36, 0.3))
            dot = g.mrange(g.add(g.m('POWER', g.mul(g.add(gx, -0.5), 3.0), 2.0), g.m('POWER', g.mul(g.add(gz, -0.45), 9.0), 2.0)), 0.5, 0.3)
            is0 = g.mrange(st, 0.5, 0.4)
            is1 = g.mul(g.mrange(st, 0.5, 0.6), g.mrange(st, 1.5, 1.4))
            is2 = g.mul(g.mrange(st, 1.5, 1.6), g.mrange(st, 2.5, 2.4))
            c2 = g.mix(c, gold, g.mul(bands, is0))
            c2 = g.mix(c2, '#f3e8cf', g.mul(label, is1))
            c2 = g.mix(c2, gold, g.mul(dot, is2))
            # page block on the top face
            geo = g.node('ShaderNodeNewGeometry')
            nx, ny, nz = g.sep(geo.outputs['Normal'])
            c2 = g.mix(c2, '#f1e6cc', g.mul(g.mrange(nz, 0.6, 0.9), g.mrange(gy, 0.12, 0.2)))
            # worn: the corners and edges of the spine rubbed paler, more on some books than others
            wear = g.node('ShaderNodeAttribute', attribute_type='OBJECT', attribute_name='wear').outputs['Factor']
            edge = g.m('MAXIMUM', g.m('ABSOLUTE', g.add(gx, -0.5)), g.m('ABSOLUTE', g.add(gz, -0.5)))
            c2 = g.mix(c2, '#fff4e0', g.mul(g.mrange(edge, 0.4, 0.5), g.mul(wear, 0.22)))
            # book cloth: a fine woven relief
            x, y, z = g.sep(P)
            weave = g.mul(g.m('SINE', g.mul(x, 2.4)), g.m('SINE', g.mul(z, 2.4)))
            return c2, g.mul(weave, 0.35)
        return obj_color_felt('Book', sheen=0.55, bump=0.35, var=0.06, deco=deco)

    def bookshelf(self):
        S = self.L['SHELF']
        x0, x1, top, boards, post, bd = S['x0'], S['x1'], S['top'], S['boards'], S['post'], S['board']
        YB, YF = self.Yw - 0.02, self.Yw - 1.0
        YM = YF + 0.5                      # cats sit halfway into the shelf
        zb = lambda b: Zp(b, YM)
        bt = bd / U / CP
        m = wood('ShelfWood', PAL['wood'])
        m_edge = wood('ShelfEdge', '#a8714b')
        zt = Zp(top - 30, YM)
        crown_b = zt - 0.36 / CP
        rbox('ShelfTop', m_edge, X(x0 - 14), X(x1 + 14), YF - 0.12, YB, crown_b, zt, bevel=0.04)
        for side, (a, b) in enumerate(((x0, x0 + post), (x1 - post, x1))):
            rbox(f'Post{side}', m, X(a), X(b), YF, YB, 0, crown_b, bevel=0.025)
        rbox('Plinth', felt('ShelfDark', '#6a4029', sheen=0.3, var=0.06), X(x0 - 8), X(x1 + 8), YF - 0.04, YB, 0, zb(boards[3]) - bt, bevel=0.025)
        rbox('ShelfBack', felt('ShelfBack', '#6b4430', sheen=0.3, var=0.08, bump=0.3), X(x0 + post), X(x1 - post), YB - 0.05, YB,
             0.05, crown_b, bevel=0)
        for i, b in enumerate(boards):
            rbox(f'Board{i}', m_edge, X(x0 + post - 1), X(x1 - post + 1), YF, YB - 0.04, zb(b) - bt, zb(b), bevel=0.025)
        self.shelf = dict(YF=YF, YB=YB, YM=YM, zt=zt)

        # books, leaving a clear gap at each shelf spot
        gaps = {b: [] for b in boards}
        for s in self.L['SPOTS']:
            for b in boards:
                if abs(s['y'] - b) < 2 and x0 < s['x'] < x1:
                    gaps[b].append((s['x'] - 74, s['x'] + 74))
        m_book = self.book_mat()
        # colour families, so a shelf has runs of a series (same height and binding) between singles
        families = [['#c25e52', '#9e4646', '#b5534a'], ['#e4b04a', '#d27d45', '#ad6c44'], ['#4a948d', '#3d8080', '#2f6b6b'],
                    ['#4f6c9e', '#6a80a8', '#3d5582'], ['#6a9656', '#80a87c', '#5a7f4a'], ['#8d5a7e', '#7a4a6b', '#9a6b8c'],
                    ['#ece0c0', '#d89c78', '#e2d2ad']]
        cols = [c for f in families for c in f]
        r = random.Random(5)
        n = 0

        def book(name, x, w, h, zbase, yfr, depth, col, style, lean=0.0, yaw=0.0):
            bevel = r.choice((0.008, 0.012, 0.012, 0.018, 0.026))
            o = rbox(name, m_book, X(x), X(x + w - 1.5), yfr, yfr + depth, zbase, zbase + h, bevel=bevel, segs=3)
            o.color = (*lin(col)[:3], 1)
            o['style'] = float(style)
            o['wear'] = r.random()
            if lean or yaw:
                # tip it against its neighbour: pivot on the bottom right corner, plus a slight twist
                piv = Vector((X(x + w), yfr + depth / 2, zbase))
                o.data.transform(Matrix.Translation(piv) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(lean, 4, 'Y') @ Matrix.Translation(-piv))
            return o

        for ri, b in enumerate(boards):
            zbase = zb(b)
            ceil = crown_b if ri == 0 else zb(boards[ri - 1]) - bt
            avail = ceil - zbase
            x = x0 + post + 3
            end = x1 - post - 3
            series, run_left = None, 0
            while x < end - 14:
                gap = next((gp for gp in gaps[b] if gp[0] - 2 <= x < gp[1]), None)
                if gap:
                    x = gap[1] + 4
                    series, run_left = None, 0
                    continue
                nxt = next((gp[0] for gp in sorted(gaps[b]) if gp[0] > x), end)
                limit = min(nxt, end)
                roll = r.random()
                yfr = YF + 0.04 + r.random() * 0.09
                if roll < 0.08 and limit - x > 70:
                    # a lying stack, a little skewed, sometimes with a trinket on top
                    sw = r.uniform(62, 80)
                    z = zbase
                    for k in range(r.randint(2, 4)):
                        bh = r.uniform(0.11, 0.19)
                        bw = sw - r.uniform(0, 14)
                        o = rbox(f'Stack{n}_{k}', m_book, X(x + (sw - bw) / 2), X(x + (sw + bw) / 2), yfr, yfr + r.uniform(0.5, 0.65),
                                 z, z + bh, bevel=0.016, segs=2)
                        o.color = (*lin(r.choice(cols))[:3], 1)
                        o['style'] = 3.0
                        o['wear'] = r.random()
                        c = Vector((X(x + sw / 2), yfr + 0.3, z))
                        o.data.transform(Matrix.Translation(c) @ Matrix.Rotation(r.uniform(-0.08, 0.08), 4, 'Z') @ Matrix.Translation(-c))
                        z += bh
                    if r.random() > 0.35:
                        self.trinket(f'Trinket{n}', X(x + sw / 2), yfr + 0.3, z, r)
                    x += sw + 4
                    n += 1
                    series, run_left = None, 0
                    continue
                if run_left <= 0:
                    if r.random() < 0.45:
                        fam = r.choice(families)
                        series = dict(col=r.choice(fam), fam=fam, h=avail * r.uniform(0.62, 0.9), w=r.uniform(18, 28), style=r.choice((0, 1, 2)))
                        run_left = r.randint(2, 5)
                    else:
                        series, run_left = None, 1
                if series:
                    col = series['col'] if r.random() < 0.7 else r.choice(series['fam'])
                    h = series['h'] * r.uniform(0.98, 1.02)
                    wpx = series['w'] + r.uniform(-2, 2)
                    style = series['style']
                else:
                    col = r.choice(cols)
                    h = avail * r.uniform(0.55, 0.95)
                    wpx = r.uniform(14, 26) if r.random() < 0.75 else r.uniform(30, 42)
                    style = r.choice((0, 0, 1, 1, 2))
                run_left -= 1
                if x + wpx > limit:
                    wpx = limit - x
                if wpx < 10:
                    break
                lean = r.uniform(0.08, 0.2) if (roll > 0.92 and x + wpx + 26 < limit) else 0.0
                yaw = r.uniform(-0.05, 0.05)
                depth = r.uniform(0.5, 0.74)
                if r.random() < 0.06:
                    yfr -= 0.1        # one pulled half out, as if someone was about to read it
                book(f'Book{n}', x, wpx, h, zbase, yfr, depth, col, style, lean, yaw)
                if lean:
                    x += math.sin(lean) * h * U + 3
                    series, run_left = None, 0
                x += wpx
                n += 1
        # on top: a couple of flat books and a trailing pothos
        z = zt
        for k, (a, bw, col) in enumerate(((120, 90, '#3f7f7a'), (126, 78, '#d9a441'))):
            o = rbox(f'TopBook{k}', m_book, X(a), X(a + bw), YF + 0.15, YF + 0.75, z, z + 0.16, bevel=0.015, segs=2)
            o.color = (*lin(col)[:3], 1)
            o['style'] = 3.0
            z += 0.16
        self.top_plant(430, YF + 0.45, zt)

    def trinket(self, name, x, y, z, r):
        if r.random() > 0.5:
            lathe(name + 'Vase', felt('Vase', '#e8a890', sheen=0.4, var=0.06), x, y,
                  [(0.07, z), (0.12, z + 0.1), (0.1, z + 0.24), (0.05, z + 0.32), (0.06, z + 0.35)], cap_top=False)
            m_st = felt('Stem', '#557f40', sheen=0.4, bump=0.2)
            m_fl = felt('Flower', '#f4c870', sheen=0.6)
            for k, a in enumerate((-0.4, 0, 0.35)):
                tip = (x + math.sin(a) * 0.18, y - 0.04, z + 0.52)
                tube(f'{name}Stem{k}', m_st, [(x, y, z + 0.3), tip], 0.01, smooth=False)
                ell(f'{name}Bloom{k}', m_fl, tip, (0.035, 0.035, 0.035), seg=12)
        else:
            lathe(name + 'Jar', felt('Jar', '#f4e4c6', sheen=0.5, var=0.04), x, y,
                  [(0.08, z), (0.09, z + 0.03), (0.09, z + 0.2), (0.08, z + 0.21)])
            lathe(name + 'JarBand', felt('JarBand', '#cf7e48'), x, y, [(0.093, z + 0.08), (0.093, z + 0.13)])

    def top_plant(self, px, y, z):
        m_pot = felt('Terracotta', '#d4825c', sheen=0.4, var=0.1)
        lathe('TopPot', m_pot, X(px), y, [(0.22, z), (0.27, z + 0.24), (0.31, z + 0.26), (0.31, z + 0.32), (0.27, z + 0.32)],
              cap_top=False)
        py_top = proj((0, y, z + 0.32))[1]
        rng = random.Random(21)
        m_leaf = obj_color_felt('Leaf', sheen=0.6, bump=0.35)
        for k in range(9):
            a = -1.6 + k * 0.4 - math.pi / 2
            leaf(f'TopLeaf{k}', m_leaf, (px - 20 + k * 5, py_top + 4), (math.cos(a), math.sin(a)), 18,
                 color=GREENS[k % 4], y_of=lambda *_: y - 0.2 + (k % 3) * 0.12)
        # vines trail down over the front of the bookcase
        yv = self.shelf['YF'] - 0.16
        for v in range(4):
            vx = px - 24 + v * 16
            ln = 90 + rng.random() * 120
            pts = [(vx, py_top + 6), (vx + 16, py_top + 26), (vx - 8, py_top + ln * 0.5), (vx + (v - 1.5) * 10, py_top + ln)]
            vine(f'TopVine{v}', pts, lambda a, b: yv, rng, leaf_mat=m_leaf)

    def fireplace(self):
        F = self.L['FIRE']
        x0, x1, mantel, op = F['x0'], F['x1'], F['mantel'], F['open']
        Yw = self.Yw
        Ybr = Yfl(880)           # chimney breast face: the surround stands on the floor on row 880
        Ys = Ybr - 0.12          # surround face
        self.fire = dict(Ybr=Ybr, Ys=Ys)
        ocx, orr = (op['x0'] + op['x1']) / 2, (op['x1'] - op['x0']) / 2
        opening = [(op['x0'], op['bottom'] + 30), (op['x0'], op['top'] + orr)]
        opening += [(ocx + orr * math.cos(a), op['top'] + orr - orr * math.sin(a)) for a in np.linspace(math.pi, 0, 30)[1:-1]]
        opening += [(op['x1'], op['top'] + orr), (op['x1'], op['bottom'] + 30)]
        with layer('cutter'):
            cut = prism('FireCut', None, px_poly(opening, Ys), Ys - 0.5, Ys + 1.15)
        breast = rbox('Breast', self.m_wall, 15.0, 21.5, Ybr, Yw + 0.3, -0.2, 20, bevel=0)
        for ob in (breast,):
            mod = ob.modifiers.new('fire', 'BOOLEAN')
            mod.object = cut
            mod.operation = 'DIFFERENCE'
        m_wd = wood('Wood', PAL['wood'])
        rbox('BreastCrown', m_wd, 15.0, 21.5, Ybr - 0.26, Ybr, Zp(40, Ybr - 0.26), 20, bevel=0.03)
        rbox('BreastCrownLip', wood('WoodLight', PAL['woodLight']), 15.0, 21.5, Ybr - 0.32, Ybr - 0.2,
             Zp(44, Ybr - 0.32), Zp(32, Ybr - 0.32), bevel=0.02)
        self.wainscot(Ybr, 15.0, X(x0) + 0.05, panels=False)
        self.wainscot(Ybr, X(x1) - 0.05, 21.5, panels=False)
        m_stone = felt('Stone', PAL['stone'], sheen=0.5, var=0.07, bump=0.4)
        sur = rbox('Surround', m_stone, X(x0), X(x1), Ys, Ybr + 0.05, 0, Zp(mantel + 20, Ys), bevel=0.03)
        mod = sur.modifiers.new('fire', 'BOOLEAN')
        mod.object = cut
        mod.operation = 'DIFFERENCE'
        sur.modifiers.move(1, 0)
        m_pil = felt('Pilaster', '#f3e7cf', sheen=0.5, var=0.06, bump=0.4)
        for k, px in enumerate((x0 + 18, x1 - 68)):
            rbox(f'Pilaster{k}', m_pil, X(px), X(px + 50), Ys - 0.08, Ys + 0.01, 0.1, Zp(mantel + 40, Ys - 0.08), bevel=0.03)
            rbox(f'PilPanel{k}', felt('PilPanel', '#e4d3b2', sheen=0.4, var=0.05), X(px + 11), X(px + 39), Ys - 0.1, Ys - 0.07,
                 Zp(840, Ys - 0.1), Zp(mantel + 62, Ys - 0.1), bevel=0.015)
        # brick arch round the opening, in voussoirs with cream joints between
        m_brick = felt('Brick', PAL['brick'], sheen=0.5, var=0.12, bump=0.5)
        yb0, yb1 = Ys - 0.04, Ys + 0.02
        nv = 9
        for k in range(nv):
            a0 = math.pi * k / nv + 0.012
            a1 = math.pi * (k + 1) / nv - 0.012
            arc_band(f'Voussoir{k}', m_brick, ocx, op['top'] + orr, orr, orr + 18, a0, a1, yb0, yb1, n=6, bevel=0.008)
        for k, (a, b) in enumerate(((op['x0'] - 18, op['x0']), (op['x1'], op['x1'] + 18))):
            for j, (t0, t1) in enumerate(((op['top'] + orr, 790), (792, op['bottom']))):
                prism(f'Jamb{k}{j}', m_brick, px_poly([(a, t1), (a, t0 + 1), (b, t0 + 1), (b, t1)], Ys - 0.01), yb0, yb1, 0.008)
        ks = [(ocx - 16, op['top'] - 20), (ocx + 16, op['top'] - 20), (ocx + 11, op['top'] + 8), (ocx - 11, op['top'] + 8)]
        prism('Keystone', m_pil, px_poly(ks, Ys - 0.06), Ys - 0.08, Ys + 0.01, 0.01)
        # firebox: sooty brick back wall and an ash floor (the flames are drawn live)
        def soot(g, P, col):
            x, y, z = g.sep(P)
            br = g.node('ShaderNodeTexBrick', offset=0.5, offset_frequency=2)
            g.put(br.inputs['Vector'], g.comb(x, z, 0.0))
            br.inputs['Scale'].default_value = 1.0
            br.inputs['Brick Width'].default_value = 48
            br.inputs['Row Height'].default_value = 22
            br.inputs['Mortar Size'].default_value = 2.0
            g.put(br.inputs['Color1'], '#7a3c26')
            g.put(br.inputs['Color2'], '#653020')
            g.put(br.inputs['Mortar'], '#3c2016')
            return g.mix(br.outputs['Color'], '#2e1a14', g.mrange(z, 40, 160, 0, 0.75))
        m_soot = felt('FireBrick', PAL['soot'], pattern=soot, sheen=0.3, var=0.1, bump=0.4)
        rbox('FireBack', m_soot, X(op['x0'] - 20), X(op['x1'] + 20), Ys + 0.95, Ys + 1.2, -0.1, Zp(op['top'] - 30, Ys + 1.0), bevel=0)
        for k, xx in enumerate((op['x0'], op['x1'])):
            rbox(f'FireSide{k}', m_soot, X(xx) - 0.25 + k * 0.25, X(xx) + k * 0.25, Ys - 0.1, Ys + 1.0, -0.1, Zp(op['top'], Ys), bevel=0)
        rbox('Ash', felt('Ash', '#5e5048', sheen=0.4, var=0.15), X(op['x0']), X(op['x1']), Ys - 0.05, Ys + 1.0, -0.1, 0.03, bevel=0)
        self.log('BackLog', ocx - 6, op['bottom'] - 22, 130, 10, -0.06, Ys + 0.75, -0.25)
        # mantel shelf on corbels: the mantel cat sits halfway into it
        ym0, ym1 = Ybr - 0.5, Ybr + 0.02
        ymc = (ym0 + Ybr) / 2
        zm = Zp(mantel, ymc)
        self.mantel_z, self.mantel_y = zm, ymc
        m_wood = wood('Mantel', '#9a6040')
        rbox('Mantel', m_wood, X(x0 - 26), X(x1 + 26), ym0, ym1, zm - 0.28 / CP, zm, bevel=0.035)
        for k, px in enumerate((x0 + 30, x1 - 30)):
            o = rbox(f'Corbel{k}', m_wood, X(px - 16), X(px + 16), Ys - 0.3, Ys, Zp(mantel + 80, Ys - 0.3), zm - 0.27, bevel=0.1, segs=4)
        # hearth stone: in front of the opening, the hearth cat sits on the floor just in front of it
        rbox('Hearth', felt('Hearth', '#ab9d90', sheen=0.1, var=0.1, bump=0.5, spec=0.05), X(x0 - 30), X(x1 + 30), Yfl(906), Ys, 0, 0.12, bevel=0.04)
        # candles (flames drawn live) on a brass tray, and a little clock
        m_brass = flat('Brass', '#d9b46a', rough=0.32, metallic=0.75, coat=0.3)
        rbox('CandleTray', m_brass, X(1530), X(1592), ymc - 0.12, ymc + 0.12, zm, zm + 0.05, bevel=0.02)
        m_wax = felt('Wax', '#fff4e2', sheen=0.4, var=0.03, bump=0.1, sss=0.4)
        for i, c in enumerate(self.L['CANDLES']):
            ztop = Zp(mantel - c['h'], ymc)
            lathe(f'Candle{i}', m_wax, X(c['x']), ymc, [(0.07, zm + 0.05), (0.07, ztop - 0.01), (0.06, ztop)])
            tube(f'Wick{i}', flat('WickMat', '#3a2a20', rough=0.8), [(X(c['x']), ymc, ztop), (X(c['x']) + 0.01, ymc, ztop + 0.05)], 0.007, smooth=False)
        cx = 1820
        yc0 = ymc - 0.18
        case = [(cx - 30, mantel), (cx - 30, mantel - 44)]
        case += [(cx + 30 * math.cos(a), mantel - 44 - 30 * math.sin(a)) for a in np.linspace(math.pi, 0, 20)[1:-1]]
        case += [(cx + 30, mantel - 44), (cx + 30, mantel)]
        prism('ClockCase', wood('ClockWood', '#7a4a2e'), px_poly(case, yc0), yc0, ymc + 0.18, 0.03)
        yf = yc0 - 0.02
        face = lathe('ClockFace', felt('ClockFace', '#fbf1da', sheen=0.3, var=0.02, bump=0.1), 0, 0, [(0.21, 0), (0.21, 0.02)], segs=40)
        face.rotation_euler = (math.pi / 2, 0, 0)
        face.location = (X(cx), yf + 0.01, Zp(mantel - 46, yf))
        rim = tube('ClockRim', m_brass, [(X(cx) + 0.22 * math.cos(a), yf, Zp(mantel - 46, yf) + 0.22 * math.sin(a))
                                         for a in np.linspace(0, 2 * math.pi, 33)], 0.018, smooth=False)
        m_hand = flat('Hand', '#3a2a20', rough=0.6)
        zc = Zp(mantel - 46, yf)
        tube('HandH', m_hand, [(X(cx), yf - 0.02, zc), (X(cx + 7), yf - 0.02, zc + 0.06)], 0.012, smooth=False)
        tube('HandM', m_hand, [(X(cx), yf - 0.025, zc), (X(cx - 2), yf - 0.025, zc + 0.16)], 0.009, smooth=False)
        # the landscape painting over the mantel, on the chimney breast
        self.painting(1590, 210, 220, 200, Ybr)

    def log(self, name, cx, cy, ln, r, rot, y, yaw):
        """A felt log along x, centred on pixel (cx, cy) at depth y, yawed to show a cut end."""
        m_bark = felt('Bark', '#7a4a2e', sheen=0.4, var=0.15, bump=0.7)
        m_end = felt('LogEnd', '#d4a676', sheen=0.4, var=0.08, bump=0.3)
        L, R = ln / U, r / U
        z = Zp(cy, y)
        o = lathe(name, m_bark, 0, 0, [(R * 0.9, -L / 2), (R, -L / 2 + 0.03), (R, L / 2 - 0.03), (R * 0.92, L / 2)], segs=20)
        e = lathe(name + 'End', m_end, 0, 0, [(R * 0.86, L / 2 - 0.01), (R * 0.86, L / 2 + 0.004)], segs=20)
        for ob in (o, e):
            ob.rotation_euler = Euler((0, math.pi / 2 + rot, yaw), 'XYZ')
            ob.location = (X(cx), y, z)

    def front_logs(self):
        op = self.L['FIRE']['open']
        ocx = (op['x0'] + op['x1']) / 2
        y = self.fire['Ys'] + 0.2
        self.log('LogA', ocx - 30, op['bottom'] - 13, 112, 11, 0.12, y, -0.35)
        self.log('LogB', ocx + 34, op['bottom'] - 11, 100, 10, -0.16, y + 0.12, math.pi + 0.4)

    def painting(self, x, y, w, h, yb):
        m_gold = felt('Gilt', '#e4bb62', sheen=0.9, var=0.1, bump=0.3, metallic=0.35, rough=0.6)
        yf = yb - 0.08
        b = 16
        for k, (a0, a1, c0, c1) in enumerate(((x - b, x + w + b, y - b, y), (x - b, x + w + b, y + h, y + h + b),
                                               (x - b, x, y, y + h), (x + w, x + w + b, y, y + h))):
            rbox(f'Gilt{k}', m_gold, X(a0), X(a1), yf, yb, Zp(c1, yf), Zp(c0, yf), bevel=0.03)

        def dusk(g, P, col):
            x_, y_, z_ = g.sep(P)
            t = g.mrange(z_, Zp(y + h, yb) * U, Zp(y, yb) * U)
            return g.ramp(t, [(0.0, '#9cb58e'), (0.55, '#f5d6a8'), (1.0, '#f0b48a')])
        yc = yb - 0.02
        rbox('Canvas', felt('Canvas', '#f5d6a8', pattern=dusk, sheen=0.5, var=0.06), X(x), X(x + w), yc, yb, Zp(y + h, yc), Zp(y, yc), bevel=0)
        d = yc
        m_moon = felt('PaintMoon', '#fff3d6', sheen=0.4, var=0.03)
        mx, my = x + w * 0.72, y + h * 0.3
        prism('PaintMoon', m_moon, px_poly([(mx + 18 * math.cos(a), my + 18 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 24)[:-1]], d - 0.01),
              d - 0.02, d, 0.006)
        for k, (yy, col, amp, ph) in enumerate(((h * 0.6, '#8aa98a', 10, 1), (h * 0.72, '#6f9174', 12, 3), (h * 0.85, '#58785f', 8, 0.2))):
            pts = [(x + w * i / 20, y + yy + math.sin(i * 0.5 + ph) * amp) for i in range(21)]
            dd = d - 0.02 * (k + 1)
            prism(f'Hill{k}', felt(f'Hill{k}', col, sheen=0.5, var=0.08), px_poly(pts + [(x + w, y + h), (x, y + h)], dd), dd - 0.02, d, 0.006)
        hx, hy = x + w * 0.28, y + h * 0.6
        dd = d - 0.09
        prism('House', felt('House', '#efe3c6', sheen=0.4, var=0.04), px_poly([(hx, hy), (hx + 26, hy), (hx + 26, hy + 18), (hx, hy + 18)], dd), dd - 0.02, d, 0.005)
        prism('Roof', felt('Roof', '#b5534a', sheen=0.5), px_poly([(hx - 4, hy), (hx + 13, hy - 14), (hx + 30, hy)], dd - 0.01), dd - 0.03, d, 0.005)
        prism('HouseWin', felt('HouseWin', '#f5c35a', sheen=0.3, emission=0.4), px_poly([(hx + 9, hy + 5), (hx + 16, hy + 5), (hx + 16, hy + 12), (hx + 9, hy + 12)], dd - 0.03),
              dd - 0.04, d, 0)

    # -- props -------------------------------------------------------------------------------
    def armchair(self):
        cxp = self.L['CHAIR']['cx']
        cx = X(cxp)
        yf, yb = Yfl(908), Yfl(908) + 2.15     # front legs stand on row 908
        sage = PAL['sage']
        # brushed upholstery: fibres running down the fabric, a sheen that wanders
        up = dict(sheen=0.95, var=0.12, bump=0.65, streak=0.07, rough_var=0.25)
        m = felt('Sage', sage, **up)
        spot = {s['id']: s for s in self.L['SPOTS']}
        seat, back = spot['seat'], spot['chairBack']

        def channels(g, P, col):
            x, y, z = g.sep(P)
            c = g.m('COSINE', g.mul(g.add(x, -cxp), 2 * math.pi / 58))
            groove = g.mrange(c, 0.86, 1.0)
            return g.mix(col, shade(sage, -0.25), g.mul(groove, 0.6)), g.mul(groove, -1.2)
        m_back = felt('SageBack', sage, pattern=channels, **up)
        m_pipe = felt('SagePiping', shade(sage, -0.18), sheen=0.9, var=0.08, bump=0.4)
        m_leg = wood('LegWood', '#8a5636')
        for k, (lx, ly) in enumerate(((cx - 1.3, yf + 0.1), (cx + 1.3, yf + 0.1), (cx - 1.25, yb - 0.2), (cx + 1.25, yb - 0.2))):
            lathe(f'Leg{k}', m_leg, lx, ly, [(0.06, 0.0), (0.075, 0.05), (0.09, 0.33), (0.1, 0.36)], segs=16)
        parts = []
        parts.append(pillowbox('ChairBase', m, (cx, (yf + yb - 0.1) / 2, 0.7), (1.0, (yb - yf - 0.2) / 2, 0.4), e=0.3))
        # seat cushion: plump in the middle, with a soft hollow where cats sleep. The hollow's
        # floor, at the seat cat's depth, is on the seat spot's row.
        ys = Yfl(908) + 0.8
        zs = Zp(seat['y'], ys)
        sx = X(seat['x'])
        ycc, hb, a_, cc = (yf + 0.02 + yb - 0.5) / 2, (yb - 0.52 - yf) / 2, 0.97, 0.17

        def cushion_top(x, y):
            u, v = (x - cx) / a_, (y - ycc) / hb
            puff = 0.06 * max(0, 1 - u * u) * max(0, 1 - v * v)
            dent = 0.05 * math.exp(-((x - sx) ** 2 + (y - ys) ** 2) / 0.16)
            lumpy = 0.008 * math.sin(x * 7.1 + 1.3) * math.sin(y * 5.3)
            return puff - dent + lumpy
        cz = zs - 0.012 - cc - cushion_top(sx, ys)
        parts.append(pillowbox('Cushion', m, (cx, ycc, cz), (a_, hb, cc), e=0.22, top=cushion_top, seg=72))
        f = lambda t: math.copysign(abs(t) ** 0.22, t)
        pipe = [(cx + a_ * f(math.cos(t)), ycc + hb * f(math.sin(t)), cz + cc * 0.6) for t in np.linspace(0, 2 * math.pi, 73)]
        tube('CushionPiping', m_pipe, pipe, 0.022)
        # back with a rounded top: the back cat sits on its crest
        yb0, yb1 = yb - 0.55, yb - 0.05
        ybm = (yb0 + yb1) / 2
        zc = Zp(back['y'], ybm) - 0.012
        tb = (X(back['x']) - cx) / 1.16
        ztop_c = zc + 0.68 * tb * tb
        prof = [(cx - 1.16, 1.0), (cx + 1.16, 1.0)]
        prof += [(cx + 1.16 * t, ztop_c - 0.68 * t * t) for t in np.linspace(1, -1, 25)]
        parts.append(prism('ChairBack', m_back, prof, yb0, yb1, bevel=0.14, segs=5))
        welt = [(cx + 1.1 * t, yb0 + 0.035, ztop_c - 0.68 * t * t - 0.05) for t in np.linspace(-1, 1, 31)]
        welt = [(cx - 1.1, yb0 + 0.035, 1.3)] + welt + [(cx + 1.1, yb0 + 0.035, 1.3)]
        tube('BackPiping', m_pipe, welt, 0.02)
        # wings flare out toward the front
        for s in (-1, 1):
            poly = [(0.0, 1.9), (0.0, Zp(596, yb - 0.4) + 0.02), (-0.5, Zp(596, yb - 0.4) - 0.05), (-1.05, 2.45), (-1.35, 2.15), (-1.35, 1.9)]
            bm = bmesh.new()
            fr = [bm.verts.new((-0.14, yy, zz)) for yy, zz in poly]
            bk = [bm.verts.new((0.14, yy, zz)) for yy, zz in poly]
            bm.faces.new(fr)
            bm.faces.new(bk[::-1])
            for i in range(len(poly)):
                j = (i + 1) % len(poly)
                bm.faces.new((fr[i], fr[j], bk[j], bk[i]))
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            wng = from_bm(f'Wing{s}', m, bm)
            bev(wng, 0.12, 4)
            wng.location = (cx + s * 1.02, yb - 0.25, 0)
            wng.rotation_euler = (0, 0, s * math.radians(24))
            parts.append(wng)
        # rolled arms, a little flattened on top from years of elbows
        self.arms = {}
        for s in (-1, 1):
            ax = X(cxp - 108) if s < 0 else X(cxp + 108)
            parts.append(pillowbox(f'Arm{s}', m, (ax, (yf + yb - 0.26) / 2, 1.13), (0.38, (yb - 0.34 - yf) / 2, 0.83), e=0.25))
            bm = bmesh.new()
            ring = []
            for yy in (yf - 0.02, yb - 0.32):
                ring.append([bm.verts.new((ax + 0.46 * math.cos(a), yy, 1.96 + 0.27 * math.sin(a) - 0.03 * max(0, math.sin(a)) ** 4))
                             for a in np.linspace(0, 2 * math.pi, 33)[:-1]])
            for i in range(32):
                j = (i + 1) % 32
                bm.faces.new((ring[0][i], ring[0][j], ring[1][j], ring[1][i]))
            bm.faces.new(ring[0][::-1])
            bm.faces.new(ring[1])
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            roll = from_bm(f'Roll{s}', m, bm)
            bev(roll, 0.08, 4)
            parts.append(roll)
            sc = [(ax + (0.2 - 0.012 * t) * math.cos(t), yf - 0.035, 1.96 + (0.13 - 0.008 * t) * math.sin(t)) for t in np.linspace(0, 11, 40)]
            tube(f'Scroll{s}', felt('SageSeam', shade(sage, -0.3), sheen=0.6), sc, 0.012)
            self.arms[s] = ax
        for p in parts:
            fuzz(p, 0.02, sage, 0.6)
        self.pillow(X(1280), Zp(726, yb - 0.85), yb - 0.85)
        self.throw(self.arms[1], yf)

    def pillow(self, x, z, y):
        m = felt('PillowCream', '#f3e8d2', sheen=0.9, var=0.08, bump=0.55, streak=0.04, rough_var=0.2)
        root = link(bpy.data.objects.new('PillowRoot', None))
        root.location = (x, y, z)
        # slumped against the back, leaning into the arm
        root.rotation_euler = (-0.34, 0.2, 0.16)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=4, use_grid_fill=True)
        for v in bm.verts:
            # stuffed: fat in the middle, thin at the edges, so the corners poke out
            r = max(abs(v.co.x), abs(v.co.z)) * 2
            v.co.y *= 0.67 + 0.45 * (1 - r ** 2)
            v.co.x *= 1 + 0.06 * v.co.z
        p = from_bm('Pillow', m, bm)
        sub(p, 2)
        p.scale = (0.94, 0.42, 0.82)
        p.parent = root
        fuzz(p, 0.016, '#f3e8d2', 0.6)
        # embroidered blue vine on its face (pillow-local px, y down → z)
        m_emb = felt('Embroidery', '#4f72a0', sheen=0.6, bump=0.5)
        loc = lambda px_, py_: (px_ / U, -0.235, -py_ / U)
        stem = [loc(-30, 22), loc(-12, 6), loc(4, 10), loc(10, -6), loc(16, -20), loc(26, -18), loc(30, -28)]
        st = tube('PillowStem', m_emb, stem, 0.011)
        st.parent = root
        for k, (lx, ly, a) in enumerate(((-20, 12, -0.8), (-6, 6, 0.6), (6, -2, -0.9), (16, -14, 0.7), (26, -22, -0.5))):
            o = ell(f'PillowLeaf{k}', m_emb, loc(lx - math.sin(a) * 6, ly - math.cos(a) * 6), (0.04, 0.014, 0.07), (0, a, 0), seg=16)
            o.parent = root

    def throw(self, ax, yf):
        """The chunky cream and blue plaid knit throw, slung over the right arm: knit ribs in the
        geometry, irregular folds that open up toward the hem, and a fringe."""
        def stitch(u_px, v_px):
            c = abs((u_px / 12) % 1 - 0.5) * 2
            return 0.55 * math.cos(2 * math.pi * (v_px / 9 + c * 0.5)) * (1 - 0.5 * c) + 0.45 * math.cos(2 * math.pi * u_px / 12)

        def plaid(g, P, col):
            tc = g.node('ShaderNodeTexCoord')
            u, v, _ = g.sep(tc.outputs['UV'])

            def stripe(t, period, a, b):
                fr = g.m('FRACT', g.mul(t, 1 / period))
                return g.mul(g.mrange(fr, a - 0.03, a), g.mrange(fr, b, b + 0.03))
            bu = stripe(u, 36, 0.04, 0.36)
            bv = stripe(v, 36, 0.04, 0.32)
            ru = stripe(u, 36, 0.54, 0.585)
            rv = stripe(v, 36, 0.52, 0.565)
            c = g.mix(col, '#3f68a6', g.mul(g.m('MAXIMUM', bu, bv), 0.85))
            c = g.mix(c, '#2c4c80', g.mul(bu, bv))
            c = g.mix(c, '#c0584e', g.mul(g.m('MAXIMUM', ru, rv), 0.2))
            # stitches: little Vs in columns, darker in the gaps between them
            h = g.m('ABSOLUTE', g.add(g.m('FRACT', g.mul(u, 1 / 6)), -0.5))
            w = g.m('FRACT', g.add(g.mul(v, 1 / 4.5), h))
            gap = g.mrange(w, 0.7, 1.0)
            return g.mix(c, '#000000', g.mul(gap, 0.1)), g.mul(gap, -1.5)
        m = felt('Plaid', '#f2e9d4', pattern=plaid, sheen=0.95, var=0.08, bump=0.8, rough_var=0.2)
        x0, x1 = X(1392), X(1496)
        NU = 64
        rng = random.Random(12)
        ztop = lambda x: 2.27 - 0.9 * (x - ax) ** 2
        rows = []   # (y, z offset from the arm top, normal y, normal z, hang t or -1)
        for t in np.linspace(0, 1, 34):
            rows.append((yf + 1.25 - 1.15 * t, 0.0, 0.0, 1.0, -1))
        for t in np.linspace(0, math.pi / 2, 12)[1:]:
            rows.append((yf + 0.1 - 0.16 * math.sin(t), -0.16 * (1 - math.cos(t)), -math.sin(t), math.cos(t), -1))
        for t in np.linspace(0, 1, 74)[1:]:
            rows.append((yf - 0.06, -0.16 - t, -1.0, 0.0, t))
        ph = [rng.uniform(0, 6.3) for _ in range(4)]
        verts, faces, uvs = [], [], []
        s_acc = [0.0]
        for a, b in zip(rows, rows[1:]):
            s_acc.append(s_acc[-1] + math.hypot(a[0] - b[0], a[1] - b[1]))
        for j, (yy, dz, ny, nz, t) in enumerate(rows):
            vpx = s_acc[j] * U
            for i in range(NU):
                u = i / (NU - 1)
                x = x0 + (x1 - x0) * u
                zt = ztop(x)
                if t < 0:
                    # bunched over the arm
                    z = zt + dz + 0.02 * math.sin(yy * 9 + u * 4 + ph[0]) * (1 if dz == 0 else 0.5)
                    yv = yy
                else:
                    hem = 0.42 + 0.035 * math.sin(u * 7 + ph[1])
                    z = zt - 0.16 - t * (zt - 0.16 - hem)
                    fold = (0.03 + 0.1 * t) * (math.sin(2 * math.pi * 2.3 * u + ph[2]) + 0.55 * math.sin(2 * math.pi * 4.1 * u + ph[3] + t * 1.6))
                    yv = yy - 0.02 * t - fold
                    x += (u - 0.5) * 0.14 * t * t
                k = 0.009 * stitch(u * 104, vpx)
                verts.append((x, yv + ny * k, z + nz * k))
                uvs.append((u * 104, vpx))
        for j in range(len(rows) - 1):
            for i in range(NU - 1):
                kk = j * NU + i
                faces.append((kk, kk + 1, kk + NU + 1, kk + NU))
        ob = mesh_obj('Throw', m, verts, faces)
        uv = ob.data.uv_layers.new(name='UVMap')
        for poly in ob.data.polygons:
            for li, vi in zip(poly.loop_indices, poly.vertices):
                uv.data[li].uv = uvs[vi]
        sol = ob.modifiers.new('felt', 'SOLIDIFY')
        sol.thickness = 0.055
        sol.offset = 1.0
        fuzz(ob, 0.016, '#f2e9d4', 0.55)
        m_fr = felt('ThrowFringe', '#ece0c6', sheen=0.8, bump=0.3)
        last = len(rows) - 1
        for k, i in enumerate(range(1, NU - 1, 4)):
            bx, by, bz = verts[last * NU + i]
            sway = rng.uniform(-0.02, 0.02)
            tube(f'ThrowFringe{k}', m_fr, [(bx, by - 0.02, bz + 0.03), (bx + sway, by - 0.03, bz - 0.15 - rng.uniform(0, 0.04))], 0.014, smooth=False)

    def side_table(self):
        T = self.L['TABLE']
        cx, cy = X(T['cx']), 20.0
        zt = Zp(T['top'] - 2, cy)
        self.table = (cx, cy, zt)
        m = wood('TableWood', '#9a6040', along='X')
        lathe('TableTop', m, cx, cy, [(1.0, zt - 0.13), (1.04, zt - 0.1), (1.04, zt - 0.03), (1.01, zt)], segs=72)
        prof = [(0.12, 0.38), (0.15, 0.45), (0.1, 0.8), (0.13, 1.05), (0.17, 1.3), (0.11, zt - 0.3), (0.09, zt - 0.13)]
        lathe('Pedestal', m, cx, cy, prof, segs=32)
        for k, a in enumerate((math.pi / 2, math.pi / 2 + 2.1, math.pi / 2 - 2.1)):
            dx, dy = math.cos(a), math.sin(a)
            pts = [(cx + dx * 0.08, cy + dy * 0.08, 0.5), (cx + dx * 0.4, cy + dy * 0.4, 0.3), (cx + dx * 0.68, cy + dy * 0.68, 0.06),
                   (cx + dx * 0.76, cy + dy * 0.76, 0.04)]
            tube(f'TableLeg{k}', m, pts, 0.06, radii=[1.2, 1.0, 0.85, 0.85])
        # lamp: glossy teal ceramic body and brass stem; the shade is its own light layer
        lx, ly = X(590), cy - 0.2
        zl = lambda py: Zp(py, ly)
        body = [(0.13, zt), (0.2, zl(700)), (0.29, zl(684)), (0.32, zl(664)), (0.28, zl(646)), (0.17, zl(634)), (0.08, zl(627)), (0.07, zl(622))]
        lathe('LampBody', flat('Ceramic', '#5f968d', rough=0.3, coat=0.6), lx, ly, body, segs=40)
        lathe('LampStem', flat('Brass', '#d9b46a', rough=0.32, metallic=0.75, coat=0.3), lx, ly,
              [(0.03, zl(622)), (0.03, zl(598)), (0.05, zl(596)), (0.05, zl(592))], segs=16)
        self.lamp = (lx, ly, zl)
        # teacup on its saucer
        tx, ty = X(652), cy - 0.45
        zc = Zp(T['top'] - 4, ty)
        m_cer = flat('Cup', '#fbf2df', rough=0.35, coat=0.4)
        lathe('Saucer', m_cer, tx, ty, [(0.1, zc - 0.03), (0.24, zc - 0.01), (0.25, zc + 0.01), (0.12, zc)], segs=32)
        lathe('Cup', m_cer, tx, ty, [(0.09, zc), (0.13, zc + 0.04), (0.16, zc + 0.16), (0.165, zc + 0.27), (0.15, zc + 0.27), (0.14, zc + 0.12)],
              segs=32, cap_top=False)
        lathe('Tea', flat('Tea', '#7a4a2e', rough=0.2), tx, ty, [(0.15, zc + 0.24), (0.0, zc + 0.24)], segs=24)
        lathe('CupBand', flat('CupBand', '#b5534a', rough=0.4), tx, ty, [(0.162, zc + 0.17), (0.166, zc + 0.2)], segs=32, cap_bottom=False, cap_top=False)
        hd = [(tx + 0.16 + 0.07 * math.sin(a), ty, zc + 0.16 + 0.07 * math.cos(a)) for a in np.linspace(-0.2, math.pi + 0.2, 10)]
        tube('CupHandle', m_cer, hd, 0.022)
        for p in ('TableTop',):
            pass

    def lamp_shade(self):
        lx, ly, zl = self.lamp
        m = felt('Shade', '#f7e6c0', sheen=0.6, var=0.08, bump=0.3, sss=0.3, emission=1.15, emit_color=lin('#ffd89a'))
        o = lathe('LampShade', m, lx, ly, [(0.62, zl(632)), (0.34, zl(560))], segs=48, cap_bottom=False, cap_top=False)
        sol = o.modifiers.new('felt', 'SOLIDIFY')
        sol.thickness = 0.015
        lathe('ShadeTrim', felt('ShadeTrim', '#d4a868', sheen=0.6, emission=0.5), lx, ly,
              [(0.625, zl(633)), (0.64, zl(632)), (0.64, zl(628)), (0.61, zl(628))], segs=48, cap_bottom=False, cap_top=False)
        lathe('ShadeTrimTop', felt('ShadeTrim', '#d4a868', sheen=0.6, emission=0.5), lx, ly,
              [(0.335, zl(561)), (0.35, zl(561)), (0.35, zl(557)), (0.335, zl(557))], segs=48, cap_bottom=False, cap_top=False)

    def pouf(self):
        P = self.L['POUF']
        cy = Yfl(962) + 0.72
        cx = X(P['cx'])
        zt = Zp(P['top'], cy)
        self.pouf_c = (cx, cy, zt)

        def knit(g, P_, col):
            x, y, z = g.sep(P_)
            th = g.m('ARCTAN2', g.add(y, -cy * U), g.add(x, -cx * U))
            u = g.mul(th, 72 * 1.0)
            h = g.m('ABSOLUTE', g.add(g.m('FRACT', g.mul(u, 1 / 11)), -0.5))
            w = g.m('FRACT', g.add(g.mul(z, 1 / 8), h))
            return g.mix(col, shade(PAL['teal'], -0.22), g.mrange(w, 0.7, 1.0, 0, 0.7))
        m = felt('Pouf', PAL['teal'], pattern=knit, sheen=0.9, var=0.08, bump=0.7)
        prof = [(0.58, 0.0), (0.68, 0.06), (0.73, 0.18), (0.72, zt - 0.17), (0.66, zt - 0.06), (0.5, zt - 0.01), (0.2, zt), (0.0, zt)]
        o = lathe('Pouf', m, cx, cy, prof, segs=64)
        sub(o, 1)
        fuzz(o, 0.018, PAL['teal'])
        ell('PoufButton', felt('PoufButton', shade(PAL['teal'], -0.3), sheen=0.6), (cx, cy, zt - 0.005), (0.05, 0.05, 0.025), seg=16)

    def basket(self):
        cx, cy = X(1530), Yfl(960) + 0.58

        def weave(g, P, col):
            x, y, z = g.sep(P)
            th = g.m('ARCTAN2', g.add(y, -cy * U), g.add(x, -cx * U))
            br = g.node('ShaderNodeTexBrick', offset=0.5, offset_frequency=2)
            g.put(br.inputs['Vector'], g.comb(g.mul(th, 58), z, 0.0))
            br.inputs['Scale'].default_value = 1.0
            br.inputs['Brick Width'].default_value = 12
            br.inputs['Row Height'].default_value = 8
            br.inputs['Mortar Size'].default_value = 1.6
            br.inputs['Mortar Smooth'].default_value = 0.6
            g.put(br.inputs['Color1'], '#d4a96c')
            g.put(br.inputs['Color2'], '#bf9157')
            g.put(br.inputs['Mortar'], '#7d5a30')
            return br.outputs['Color']
        m = felt('Wicker', '#c99a5c', pattern=weave, sheen=0.4, var=0.08, bump=0.6)
        zt = 0.5
        lathe('Basket', m, cx, cy, [(0.46, 0.0), (0.5, 0.04), (0.58, zt), (0.53, zt), (0.45, 0.06), (0.0, 0.06)], segs=48)
        tube('BasketRim', felt('WickerRim', '#ddb67c', sheen=0.4, bump=0.6), [(cx + 0.585 * math.cos(a), cy + 0.585 * math.sin(a), zt)
                                                                              for a in np.linspace(0, 2 * math.pi, 49)], 0.055)
        def wound(g, P, c):
            oi = g.node('ShaderNodeObjectInfo')
            tc = g.node('ShaderNodeTexCoord')
            wv = g.node('ShaderNodeTexWave', wave_type='BANDS', bands_direction='DIAGONAL')
            g.put(wv.inputs['Vector'], tc.outputs['Object'])
            wv.inputs['Scale'].default_value = 3.0
            wv.inputs['Distortion'].default_value = 4.0
            wv.inputs['Detail'].default_value = 1.0
            return g.mix(oi.outputs['Color'], g.mix(oi.outputs['Color'], '#000000', 0.35), g.mul(wv.outputs[1], 0.6))
        m_yarn = felt('Yarn', '#ffffff', pattern=wound, sheen=0.9, var=0.05, bump=0.5)
        yb = cy + 0.1
        for k, (bx, by, br, col) in enumerate(((-22, -50, 22, '#ef9ea6'), (14, -54, 20, '#93bfe0'), (-2, -64, 18, '#f6c96f'))):
            o = ell(f'Yarn{k}', m_yarn, (X(1530 + bx), yb - 0.1 * k, Zp(960 + by, yb - 0.1 * k)), (br / U, br / U, br / U),
                    (k * 0.9, k * 0.4, k * 1.3), seg=32)
            o.color = (*lin(col)[:3], 1)
            fuzz(o, 0.012, col)

    def foreground(self):
        """Things right in front of the lens, framing the view's corners: trailing pothos at the
        top left and bottom left, a stack of books with a mug at the bottom right. Blurred
        heavily afterwards. Kept clear of the sit spots so they never hide a cat."""
        vx, vy, vw, vh = self.view
        rng = random.Random(9)
        m_leaf = obj_color_felt('ForeLeaf', sheen=0.6, bump=0.5)
        m_stem = felt('Stem', '#557f40', sheen=0.4, bump=0.2)
        bx0, by0 = vx, vy + vh          # bottom-left corner of the view
        fan = [(-10, 0, -0.2, 130), (60, 10, 0.35, 105), (-30, -90, -0.9, 115), (130, 20, 0.8, 95), (10, -150, -1.35, 92), (-60, -20, -0.6, 120)]
        for i, (x, y, a, sz) in enumerate(fan):
            x, y = bx0 + x, by0 + y
            yy = 0.9 + i * 0.08
            th = a + math.pi
            leaf(f'ForeLeaf{i}', m_leaf, (x, y), (-math.sin(th), math.cos(th)), sz, color=GREENS[i % 4], curl=0.15, y_of=lambda *_: yy)
            pts = [(bx0 - 40, by0 + 30), ((bx0 - 40 + x) / 2 - 10, (by0 + 30 + y) / 2 + 20), (x, y)]
            tube(f'ForeStem{i}', m_stem, [(X(px_), yy + 0.05, Zp(py_, yy + 0.05)) for px_, py_ in pts], 0.045)
        # top left: a pothos trailing down from somewhere above the lens
        for v in range(3):
            sx = vx + 30 + v * 55
            ln = 130 + rng.random() * 90
            pts = [(sx, vy - 30), (sx + 20, vy + ln * 0.3), (sx - 10, vy + ln * 0.65), (sx + 15 * (v - 1), vy + ln)]
            vine(f'ForeVine{v}', pts, lambda a, b: 1.5 + v * 0.1, rng, leaf_mat=m_leaf, leaf_size=(34, 48), every=0.22)
        # bottom right: a little stack of books and a mug of cocoa
        rx, ry = vx + vw, vy + vh
        m_book = self.book_mat()
        yb = 1.4
        z = Zp(ry + 25, yb)
        for k, (w, h, col, dx) in enumerate(((230, 34, '#b5534a', 0), (205, 30, '#d9a441', 12), (215, 28, '#c0703d', -6))):
            x0 = rx - 250 + dx
            o = rbox(f'ForeBook{k}', m_book, X(x0), X(x0 + w), yb - 0.9, yb + 0.9, z, z + h / U, bevel=0.03)
            o.color = (*lin(col)[:3], 1)
            o['style'] = 3.0
            o['wear'] = 0.6
            z += h / U
        mx = X(rx - 120)
        m_mug = flat('Mug', '#d97b55', rough=0.4, coat=0.3)
        with layer('forelight'):
            # the fire's warmth reaching the near corner (lights the foreground pass only)
            add_light('ForeWarm', 'POINT', energy=60, color=(1.0, 0.62, 0.32), loc=(X(rx - 60), yb - 2.5, Zp(ry - 160, yb - 2.5)), radius=0.8)
        lathe('ForeMug', m_mug, mx, yb, [(0.36, z), (0.4, z + 0.05), (0.4, z + 0.85), (0.36, z + 0.85), (0.34, z + 0.1)], segs=40, cap_top=False)
        lathe('ForeCocoa', flat('Cocoa', '#6e4630', rough=0.3), mx, yb, [(0.37, z + 0.75), (0.0, z + 0.75)], segs=24)
        hd = [(mx + 0.38 + 0.2 * math.sin(a), yb, z + 0.45 + 0.24 * math.cos(a)) for a in np.linspace(-0.2, math.pi + 0.2, 10)]
        tube('ForeMugHandle', m_mug, hd, 0.06)

    def sky(self):
        """Night sky, snowy hills, pines and a cottage, seen through the window."""
        w = self.L['WIN']
        x0, x1, sill = w['x0'], w['x1'], w['sill']
        yb = 60.0

        def grad(g, P, col):
            x, y, z = g.sep(P)
            t = g.mrange(z, Zp(sill, yb) * U, Zp(130, yb) * U)
            return g.ramp(t, [(0.0, '#7c8db2'), (0.45, '#3f5582'), (1.0, '#24345a')])
        m_bg = felt('SkyGrad', '#3f5582', pattern=grad, var=0.03, bump=0.0, sheen=0.0, emission=1.0)
        b = bsdf(m_bg)
        b.inputs['Base Color'].default_value = (0, 0, 0, 1)
        rbox('SkyBack', m_bg, X(x0 - 120), X(x1 + 120), yb, yb + 0.1, Zp(700, yb), Zp(40, yb), bevel=0)
        # move the gradient from base colour to emission: rewire
        for l in list(m_bg.node_tree.links):
            if l.to_socket == b.inputs['Base Color']:
                src = l.from_socket
                m_bg.node_tree.links.remove(l)
                m_bg.node_tree.links.new(src, b.inputs['Emission Color'])
        ym = 55.0
        mx, my = 1050, 230
        m_moon = felt('Moon', '#fff6dc', var=0.04, bump=0.2, emission=1.1, emit_color=lin('#fff4d6'))
        prism('Moon', m_moon, px_poly([(mx + 30 * math.cos(a), my + 30 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 40)[:-1]], ym), ym, ym + 0.1, 0.05)
        for k, (ox, oy, cr) in enumerate(((-8, -6, 6), (9, 6, 4), (4, -12, 3))):
            prism(f'Crater{k}', felt('Crater', '#e2d2a8', var=0.04, emission=0.9, emit_color=lin('#e8d8ae')),
                  px_poly([(mx + ox + cr * math.cos(a), my + oy + cr * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 16)[:-1]], ym - 0.02),
                  ym - 0.03, ym, 0.004)
        m_halo = bpy.data.materials.new('Halo')
        m_halo.use_nodes = True
        nt = m_halo.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = lin('#fff1cc')
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        mixs = nt.nodes.new('ShaderNodeMixShader')
        gb = NB(m_halo)
        P = gb.px()
        d = nt.nodes.new('ShaderNodeVectorMath')
        d.operation = 'DISTANCE'
        nt.links.new(P, d.inputs[0])
        d.inputs[1].default_value = (mx, 0, Zp(my, ym + 0.2) * U)
        fall = gb.m('POWER', gb.mrange(d.outputs['Value'], 30, 125, 1, 0), 2.0)
        nt.links.new(gb.mul(fall, 0.55), mixs.inputs[0])
        nt.links.new(tr.outputs[0], mixs.inputs[1])
        nt.links.new(em.outputs[0], mixs.inputs[2])
        nt.links.new(mixs.outputs[0], out.inputs['Surface'])
        m_halo.surface_render_method = 'BLENDED'
        rbox('MoonHalo', m_halo, X(mx - 130), X(mx + 130), ym + 0.2, ym + 0.21, Zp(my + 130, ym + 0.2), Zp(my - 130, ym + 0.2), bevel=0)

        def hill(name, base, amp, col, ph, y):
            pts = [(x, base + math.sin(x * 0.012 + ph) * amp + math.sin(x * 0.031 + ph) * amp * 0.4) for x in range(x0 - 60, x1 + 61, 10)]
            pts += [(x1 + 60, sill + 40), (x0 - 60, sill + 40)]
            return prism(name, felt(name, col, sheen=0.6, var=0.07, bump=0.4), px_poly(pts, y), y, y + 0.3, 0.04)
        hill('HillFar', 520, 22, '#9aa9c8', 1.3, 50)
        r = random.Random(31)
        m_pine = felt('Pine', '#34466a', sheen=0.5, var=0.1, bump=0.4)
        m_snow = felt('Snow', '#eef3ff', sheen=0.8, var=0.04, bump=0.3)
        for i in range(16):
            px_, py_, ph = x0 + r.random() * (x1 - x0), 540 + r.random() * 30, 28 + r.random() * 30
            yy = 48 - i * 0.05
            zb_, zt_ = Zp(py_, yy), Zp(py_ - ph, yy)
            lathe(f'Pine{i}', m_pine, X(px_), yy, [(ph * 0.32 / U, zb_), (0.005, zt_)], segs=12)
            lathe(f'PineSnow{i}', m_snow, X(px_), yy - 0.01, [(ph * 0.13 / U, zt_ - (zt_ - zb_) * 0.4), (0.005, zt_ + 0.003)], segs=12)
        hill('HillMid', 575, 12, '#c3cde3', 4.2, 46)
        yh = 45.0
        prism('Cottage', felt('Cottage', '#4a4566', sheen=0.4, var=0.05), px_poly([(860, 548), (904, 548), (904, 580), (860, 580)], yh), yh, yh + 0.4, 0.02)
        prism('CottageRoof', m_snow, px_poly([(854, 550), (882, 528), (910, 550)], yh - 0.02), yh - 0.04, yh + 0.4, 0.02)
        prism('CottageWin', felt('CottageWin', '#ffd27e', emission=1.6, var=0.0, bump=0.0), px_poly([(874, 558), (884, 558), (884, 568), (874, 568)], yh - 0.02),
              yh - 0.03, yh, 0)
        hill('HillNear', 600, 8, '#e3e9f5', 2.2, 44)


# ---------------------------------------------------------------------------------- lights
def add_light(name, kind, *, energy, color=(1, 1, 1), loc=(0, 0, 0), frm=None, radius=0.1, angle=10, shadow=True,
              at=None, size=None, cone=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if hasattr(ld, 'use_shadow'):
        ld.use_shadow = shadow
    if kind == 'SUN':
        ld.angle = math.radians(angle)
    elif kind == 'AREA':
        ld.shape = 'RECTANGLE'
        ld.size, ld.size_y = size
    else:
        ld.shadow_soft_size = radius
    if kind == 'SPOT':
        ld.spot_size = math.radians(cone)
        ld.spot_blend = 1.0
    if hasattr(ld, 'use_shadow_jitter'):
        ld.use_shadow_jitter = shadow
    ob = link(bpy.data.objects.new(name, ld))
    ob.location = loc
    if at is not None:
        frm = Vector(loc) - Vector(at)
    if frm is not None:
        ob.rotation_mode = 'QUATERNION'
        ob.rotation_quaternion = (-Vector(frm)).normalized().to_track_quat('-Z', 'Y')
    return ob


def lights(room):
    L = room.L
    with layer('room'):
        # key from the upper left and in front, like the cats' own key light, but a broad soft
        # panel aimed at the chair so it falls off toward the corners; a weak sun keeps the
        # edges from going black on a projector
        cxp = X(L['CHAIR']['cx'])
        add_light('Key', 'AREA', energy=650, color=(1.0, 0.88, 0.74), loc=(cxp - 7.5, 3.0, 9.0), at=(cxp - 1.5, 18.5, 1.2), size=(7, 7))
        add_light('Fill', 'SUN', energy=0.4, color=(0.82, 0.86, 1.0), frm=(-0.3, -1.0, 0.6), angle=40)
        # an amber pool on the chair, the safe warm place in the room
        add_light('Pool', 'SPOT', energy=700, color=(1.0, 0.66, 0.36), loc=(cxp + 0.2, 13.5, 8.0), at=(cxp + 0.1, 18.2, 1.3), radius=0.9, cone=58)
        # moonlight through the window: the wall shades everything but the window's patch
        add_light('Moon', 'SUN', energy=3.2, color=(0.6, 0.72, 1.0), frm=(-0.12, 1.0, 0.62), angle=3)
        lx, ly, zl = room.lamp
        add_light('Lamp', 'POINT', energy=650, color=(1.0, 0.72, 0.44), loc=(lx, ly, zl(582)), radius=0.08)
        Ys = room.fire['Ys']
        op = L['FIRE']['open']
        add_light('Fire', 'POINT', energy=200, color=(1.0, 0.5, 0.2), loc=(X((op['x0'] + op['x1']) / 2), Ys + 0.5, Zp(842, Ys + 0.5)), radius=0.3)
        # the fire's glow spilling out of the opening and wrapping round the chair and the rug
        add_light('FireGlow', 'AREA', energy=520, color=(1.0, 0.55, 0.26), loc=(X((op['x0'] + op['x1']) / 2), Ys - 0.15, 0.7),
                  at=(cxp - 0.5, 16.0, 1.2), size=(1.5, 1.0))
        for i, c in enumerate(L['CANDLES']):
            add_light(f'Candle{i}', 'POINT', energy=6, color=(1.0, 0.7, 0.4),
                      loc=(X(c['x']), room.mantel_y, Zp(L['FIRE']['mantel'] - c['h'] - 8, room.mantel_y)), radius=0.03)
        yw = room.Yw - 0.66
        for i, p in enumerate(L['FAIRY']):
            add_light(f'Fairy{i}', 'POINT', energy=4.0, color=(1.0, 0.8, 0.55), loc=(X(p['x']), yw, Zp(p['y'] + 5, yw)), radius=0.05, shadow=False)
    with layer('skylight'):
        add_light('SkyMoon', 'SUN', energy=2.0, color=(0.8, 0.86, 1.0), frm=(0.2, -1.0, 0.8), angle=30)


# ---------------------------------------------------------------------------------- render + post
def setup_scene(scale, samples):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = int(W * scale), int(H * scale)
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
    bg.inputs['Color'].default_value = lin('#6a7896')
    bg.inputs['Strength'].default_value = 0.3
    sc.world = world

    cam_data = bpy.data.cameras.new('Camera')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = W / U
    cam_data.clip_start = 0.1
    cam_data.clip_end = 200
    cam = bpy.data.objects.new('Camera', cam_data)
    sc.collection.objects.link(cam)
    d = Vector((0, CP, -SP))            # looking into the room, 7° down
    up = Vector((0, SP, CP))
    centre = Vector((W / 2 / U, 0, 0)) + up * ((PY0 - H / 2) / U)
    cam.location = centre - d * 60
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = d.to_track_quat('-Z', 'Y')
    sc.camera = cam


PASSES = {
    # name: (visible to camera, shadow casters only, lights)
    'sky': ({'sky'}, set(), {'skylight'}),
    'back': ({'back'}, {'mid', 'shade'}, {'room'}),
    'mid': ({'mid'}, {'back', 'shade'}, {'room'}),
    'bm': ({'back', 'mid'}, {'shade'}, {'room'}),
    'fore': ({'fore'}, set(), {'room', 'forelight'}),
    'shade': ({'shade'}, {'back', 'mid', 'prop:table'}, {'room'}),
    'logs': ({'logs'}, {'back', 'mid'}, {'room'}),
    'beauty': ({'back', 'mid', 'logs', 'shade', 'prop:armchair', 'prop:table', 'prop:pouf', 'prop:basket'}, set(), {'room'}),
    'light': ({'back', 'mid', 'shade', 'prop:armchair', 'prop:table', 'prop:pouf', 'prop:basket'}, set(), {'room'}),
}
PROPS = ['armchair', 'table', 'pouf', 'basket']
for p in PROPS:
    PASSES[p] = ({f'prop:{p}'}, {'back', 'mid', 'shade'}, {'room'})
    PASSES[f'shadow_{p}'] = ({'back', 'mid'}, {f'prop:{p}', 'shade'}, {'room'})


def configure(name):
    vis, cast, lit = PASSES[name]
    for ob in bpy.context.scene.objects:
        if ob.type == 'CAMERA':
            continue
        L = ob.get('layer', 'none')
        if ob.type == 'LIGHT':
            ob.hide_render = L not in lit
        elif L in vis:
            ob.hide_render, ob.visible_camera, ob.visible_shadow = False, True, True
        elif L in cast:
            ob.hide_render, ob.visible_camera, ob.visible_shadow = False, False, True
        else:
            ob.hide_render = True


def render(name, work, scale, *, border=None, res=None, samples=None, override=None, cfg=None):
    sc = bpy.context.scene
    configure(cfg or name)
    rx, ry = res or (int(W * scale), int(H * scale))
    sc.render.resolution_x, sc.render.resolution_y = rx, ry
    sc.render.use_border = border is not None
    sc.render.use_crop_to_border = False
    if border:
        x, y, w, h = border
        sc.render.border_min_x, sc.render.border_max_x = max(0, x / W), min(1, (x + w) / W)
        sc.render.border_min_y, sc.render.border_max_y = max(0, 1 - (y + h) / H), min(1, 1 - y / H)
    old = sc.eevee.taa_render_samples
    if samples:
        sc.eevee.taa_render_samples = samples
    bpy.context.view_layer.material_override = override
    path = os.path.join(work, f'{name}.png')
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    sc.eevee.taa_render_samples = old
    bpy.context.view_layer.material_override = None
    print(f'PASS {name}', flush=True)
    return load(path)


def load(path):
    im = bpy.data.images.load(path, check_existing=False)
    a = np.empty(im.size[0] * im.size[1] * 4, np.float32)
    im.pixels.foreach_get(a)
    a = a.reshape(im.size[1], im.size[0], 4)[::-1].copy()
    bpy.data.images.remove(im)
    return a


def save(path, a):
    h, w = a.shape[:2]
    im = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    im.pixels.foreach_set(np.ascontiguousarray(np.clip(a[::-1], 0, 1), dtype=np.float32).ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)
    print(f'WROTE {os.path.basename(path)} {w}x{h} {os.path.getsize(path) // 1024} KB', flush=True)


def over(top, bot):
    ta, ba = top[..., 3:4], bot[..., 3:4]
    oa = ta + ba * (1 - ta)
    rgb = (top[..., :3] * ta + bot[..., :3] * ba * (1 - ta)) / np.maximum(oa, 1e-6)
    return np.concatenate([rgb, oa], -1)


def box_blur(a, r, axis):
    if r < 1:
        return a
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode='edge'), axis=axis)
    n = a.shape[axis]
    hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return (hi - lo) / (2 * r + 1)


def blur(a, sigma):
    """Gaussian-ish blur of straight-alpha RGBA, done premultiplied so edges don't darken."""
    pm = np.concatenate([a[..., :3] * a[..., 3:4], a[..., 3:4]], -1)
    r = max(1, int(round(math.sqrt(12 * sigma * sigma / 3 + 1) / 2)))
    for _ in range(3):
        pm = box_blur(box_blur(pm, r, 0), r, 1)
    al = pm[..., 3:4]
    return np.concatenate([pm[..., :3] / np.maximum(al, 1e-6), al], -1)


def bbox(alpha, thresh=0.004, pad=3):
    ys, xs = np.nonzero(alpha > thresh)
    if not len(xs):
        return 0, 0, 1, 1
    return max(0, xs.min() - pad), max(0, ys.min() - pad), min(alpha.shape[1], xs.max() + pad + 1), min(alpha.shape[0], ys.max() + pad + 1)


def lum(a):
    return a[..., 0] * 0.3 + a[..., 1] * 0.55 + a[..., 2] * 0.15


def depth_material():
    """Emits each surface's depth into the room (world y / 40) for the depth-of-field pass."""
    m = bpy.data.materials.new('Depth')
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    g = NB(m)
    _, y, _ = g.sep(g.node('ShaderNodeNewGeometry').outputs['Position'])
    v = g.m('MULTIPLY', g.add(y, 2.0), 1 / 40, clamp=True)
    g.put(em.inputs['Color'], g.comb(v, v, v))
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    return m


def depth_of(name, work, scale, mat):
    z = render(f'{name}_z', work, scale, cfg=name, override=mat, samples=4)
    v = z[..., 0]
    lin_ = np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)
    return np.where(z[..., 3] > 0.01, lin_ * 40 - 2.0, 99.0)


def mix_pm(a, b, w):
    """Mix two straight-alpha images by weight w, premultiplied."""
    w = w[..., None]
    pa, pb = a[..., :3] * a[..., 3:4], b[..., :3] * b[..., 3:4]
    al = a[..., 3:4] * (1 - w) + b[..., 3:4] * w
    rgb = (pa * (1 - w) + pb * w) / np.maximum(al, 1e-6)
    return np.concatenate([rgb, al], -1)


FOCUS = {'far': (19.6, 21.0, 1.7), 'near': (9.5, 4.0, 4.0)}


def dof(img, Y, s):
    """A restrained miniature depth of field, focused on the chair: the back wall and the far
    side of the bookcase go softly out of focus, and so does the floor right in front of the
    lens. The middle band, where the cats sit, stays sharp."""
    (f0, f1, fs), (n0, n1, ns) = FOCUS['far'], FOCUS['near']
    wf = np.clip((Y - f0) / (f1 - f0), 0, 1)
    wf[Y > 90] = 1.0
    wn = np.clip((n0 - Y) / (n0 - n1), 0, 1)
    out = img
    if wf.max() > 0:
        out = mix_pm(out, blur(img, fs * s), wf)
    if wn.max() > 0:
        out = mix_pm(out, blur(img, ns * s), wn)
    return out


def mark_spots(img, L, scale):
    out = img.copy()
    for s in L['SPOTS']:
        x, y = int(s['x'] * scale), int(s['y'] * scale)
        out[max(0, y - 1):y + 2, max(0, x - 40):x + 41] = (1, 0.1, 0.4, 1)
        out[max(0, y - 30):y + 1, max(0, x - 1):x + 2] = (1, 0.1, 0.4, 1)
        for p in s['route'][:-1]:
            px_, py_ = int(p['x'] * scale), int(p['y'] * scale)
            out[max(0, py_ - 1):py_ + 2, max(0, px_ - 12):px_ + 13] = (0.2, 1, 1, 1)
    return out


def main():
    o = args()
    L = json.load(open(o['layout'], encoding='utf-8'))
    scale = float(o['scale'])
    samples = int(o['samples'])
    work, out = o['work'], o['out']
    os.makedirs(work, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    setup_scene(scale, samples)
    room = Room(L)
    room.build()
    lights(room)
    if 'save' in o:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(o['save']))

    if o.get('beauty'):
        img = render('beauty', work, scale, samples=min(samples, 24))
        bg = np.ones_like(img)
        bg[..., :3] = (0.11, 0.075, 0.06)
        img = over(img, bg)
        save(os.path.join(work, 'beauty.png'), img)
        save(os.path.join(work, 'beauty_spots.png'), mark_spots(img, L, scale))
        return

    want = o['passes'].split(',') if 'passes' in o else None
    do = lambda n: want is None or n in want
    os.makedirs(out, exist_ok=True)
    mpath = os.path.join(out, 'manifest.json')
    man = json.load(open(mpath)) if os.path.exists(mpath) else {}
    man.update({'version': 1, 'note': 'Rendered in Blender by tools/blender/felt_room.py (node tools/blender/room.mjs).',
                'frame': [W, H], 'scale': scale, 'camera': {'ortho': True, 'pitch': 7, 'yaw': 0, 'pxPerUnit': U}})
    man.setdefault('plates', {})
    man.setdefault('props', {})
    man.setdefault('lights', {})
    s = scale

    def crop_save(name, img, box_px=None):
        if box_px is None:
            x0, y0, x1, y1 = bbox(img[..., 3])
        else:
            x0, y0, x1, y1 = box_px
        # snap to whole logical pixels so the box is exact at every scale
        X0, Y0 = math.floor(x0 / s), math.floor(y0 / s)
        X1, Y1 = math.ceil(x1 / s), math.ceil(y1 / s)
        sub_ = img[int(Y0 * s):int(Y1 * s), int(X0 * s):int(X1 * s)]
        save(os.path.join(out, f'{name}.png'), sub_)
        return [X0, Y0, X1 - X0, Y1 - Y0]

    composite = {}
    if do('sky'):
        img = blur(render('sky', work, scale), 2.2 * s)
        w = L['WIN']
        box = [w['x0'] - 60, 90, w['x1'] - w['x0'] + 120, w['sill'] - 70]
        man['plates']['sky'] = {'file': 'sky.png', 'box': crop_save('sky', img, [box[0] * s, box[1] * s, (box[0] + box[2]) * s, (box[1] + box[3]) * s])}
        composite['sky'] = img
    zmat = depth_material()
    # full-frame plates are cropped to the game's view plus a margin for the parallax drift
    vx, vy, vw, vh = room.view
    M = 48
    vbox = [max(0, vx - M) * s, max(0, vy - M) * s, min(W, vx + vw + M) * s, min(H, vy + vh + M) * s]
    for name in ('back', 'mid'):
        if do(name):
            img = dof(render(name, work, scale), depth_of(name, work, scale, zmat), s)
            man['plates'][name] = {'file': f'{name}.png', 'box': crop_save(name, img, vbox)}
            composite[name] = img
    if do('fore'):
        img = render('fore', work, scale)
        img = blur(img, 9 * s)
        img[..., :3] *= 0.9
        man['plates']['fore'] = {'file': 'fore.png', 'box': crop_save('fore', img, vbox)}
        composite['fore'] = img
    base = None
    zs = {p['id']: p['z'] for p in L['PROPS']}
    for p in PROPS:
        if not do(p):
            continue
        if base is None:
            base = render('bm', work, scale)
        img = render(p, work, scale)
        img = dof(img, depth_of(p, work, scale, zmat), s)
        x0, y0, x1, y1 = bbox(img[..., 3], pad=int(60 * s))
        reg = (x0 / s, y0 / s, (x1 - x0) / s, (y1 - y0) / s + 40)
        shad = render(f'shadow_{p}', work, scale, border=reg)
        ratio = np.clip(lum(shad) / np.maximum(lum(base), 1e-3), 0, 1)
        k = np.where(base[..., 3] > 0.5, 1 - ratio, 0.0)
        k[k < 0.025] = 0
        ry0, ry1 = int(reg[1] * s), int((reg[1] + reg[3]) * s)
        rx0, rx1 = int(reg[0] * s), int((reg[0] + reg[2]) * s)
        mask = np.zeros_like(k)
        mask[ry0:ry1, rx0:rx1] = 1
        k = blur(np.dstack([np.zeros(k.shape + (3,), np.float32), (k * mask)[..., None]]), 1.0 * s)[..., 3]
        sh = np.zeros_like(img)
        sh[..., :3] = (0.09, 0.05, 0.035)
        sh[..., 3] = np.clip(k, 0, 0.85)
        cut = over(img, sh)
        man['props'][p] = {'file': f'{p}.png', 'z': zs.get(p, 900), 'box': crop_save(p, cut)}
        composite[p] = cut
    for name, key in (('shade', 'lampShade'), ('logs', 'fireLogs')):
        if do(name):
            img = render(name, work, scale)
            man['lights'][key] = {'file': f'{key}.png', 'box': crop_save(key, img)}
            composite[name] = img
    if do('light'):
        white = bpy.data.materials.new('White')
        white.use_nodes = True
        bsdf(white).inputs['Base Color'].default_value = (0.8, 0.8, 0.8, 1)
        setin(bsdf(white), 'Sheen Weight', 0.0)
        setin(bsdf(white), 'Specular IOR Level', 0.0)
        img = render('light', work, scale, res=(192, 108), samples=16, override=white)
        # the window is see-through in the render: the cats on the sill sample it, so fill it
        # with cool moonlight at the brightness of the lit wall round it
        cool = np.array([0.74, 0.8, 0.95], np.float32) * np.percentile(lum(img[img[..., 3] > 0.5]), 92)
        rgb = img[..., :3] * img[..., 3:4] + cool * (1 - img[..., 3:4])
        small = rgb.reshape(54, 2, 96, 2, 3).mean((1, 3))
        l = lum(small)
        # normalised so the lit room reads near full light and the shadows stay above half: the
        # game darkens a cat by up to 0.42 × (1 - light), and cats should stay brighter than the room
        ref = np.percentile(l, 85)
        v = np.clip(l / max(ref, 1e-3), 0.5, 1.0)
        tint = small / np.maximum(l[..., None], 1e-3)
        tint = tint / np.maximum(tint.max(-1, keepdims=True), 1.0)
        lm = np.clip(tint * v[..., None], 0, 1)
        save(os.path.join(out, 'lightmap.png'), np.dstack([lm, np.ones((54, 96), np.float32)]))
        man['lightmap'] = 'lightmap.png'
    with open(mpath, 'w') as f:
        json.dump(man, f, indent=2)
    print('WROTE manifest.json', flush=True)
    if {'back', 'mid'} <= composite.keys():
        img = composite['back']
        if 'sky' in composite:
            img = over(img, composite['sky'])
        img = over(composite['mid'], img)
        if 'logs' in composite:
            img = over(composite['logs'], img)
        for p in sorted((p for p in PROPS if p in composite), key=lambda p: zs.get(p, 900)):
            img = over(composite[p], img)
        if 'shade' in composite:
            img = over(composite['shade'], img)
        if 'fore' in composite:
            img = over(composite['fore'], img)
        bg = np.ones_like(img)
        bg[..., :3] = (0.11, 0.075, 0.06)
        img = over(img, bg)
        save(os.path.join(work, 'composite.png'), img)
        save(os.path.join(work, 'composite_spots.png'), mark_spots(img, L, s))
        vx, vy, vw, vh = room.view
        if (vw, vh) != (W, H):
            # what the game shows: the view, at the render's resolution
            crop = lambda a: a[int(vy * s):int((vy + vh) * s), int(vx * s):int((vx + vw) * s)]
            save(os.path.join(work, 'view.png'), crop(img))
            save(os.path.join(work, 'view_spots.png'), crop(mark_spots(img, L, s)))


main()
