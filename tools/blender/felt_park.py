# Felt park renderer for Cosy Cats. Builds the sunny park as a needle-felt diorama in Blender, to
# the same plan as the canvas park in js/park.js (PARK_LAYOUT, dumped by park.mjs), with the
# library's camera, felt materials and render passes (felt_room.py), and renders it as the game's
# plates: the far hills and hedge, the lawn, one cut-out per prop (tree, bench, lamp post, play
# tower, bunting) with its own contact shadow, a blurred foreground, and a light map for the cats.
#
#   blender -b --factory-startup --python tools/blender/felt_park.py -- --layout layout.json
#       --work tmp/ --out assets/park/ [--scale 1.2] [--samples 64] [--passes far,mid] [--beauty 1]
#       [--save park.blend]
#
# The sky, sun, clouds, evening light, lamp glow and fireflies stay live in the game (js/park.js),
# because they keep the session's time. Everything solid is rendered here.
#
# The camera is orthographic, so nothing shrinks with distance. The lawn is a real deep lawn, and
# what lies beyond the hedge is a model-railway backdrop: small felt hills, trees and houses.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import felt_room as R  # noqa: E402
from felt_room import *  # noqa: E402,F401,F403

GREENS = ['#6fae5c', '#5c9c52', '#82bd68', '#4f8f4c']
BLOOMS = ['#f2a3b0', '#f6d36b', '#f7f1e1', '#e98a6b', '#c9a2dd']


# ---------------------------------------------------------------------------------- helpers
def lumpy(ob, strength, size):
    """Needle-felted lumpiness: the surface pushed in and out by soft noise."""
    tex = bpy.data.textures.new('lump', 'CLOUDS')
    tex.noise_scale = size
    d = ob.modifiers.new('lumpy', 'DISPLACE')
    d.texture = tex
    d.texture_coords = 'GLOBAL'
    d.strength = strength
    d.mid_level = 0.5
    return ob


def pom(name, mat, c, r, color=None, lump=0.2, squash=(1, 1, 1)):
    """A felt pom-pom: a lumpy ball."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0)
    ob = from_bm(name, mat, bm)
    ob.location = c
    ob.scale = (r * squash[0], r * squash[1], r * squash[2])
    lumpy(ob, r * lump, max(0.12, r * 0.5))
    if color:
        ob.color = (*lin(color)[:3], 1)
    return ob


def blobs(name, mat, items, subdiv=2):
    """Many small ellipsoids as one mesh: items are (x, y, z, rx, ry, rz)."""
    bm = bmesh.new()
    for x, y, z, rx, ry, rz in items:
        m = Matrix.Translation((x, y, z)) @ Matrix.Diagonal((rx, ry, rz, 1))
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0, matrix=m)
    return from_bm(name, mat, bm)


def blades(name, mat, items):
    """Many flat blades facing the camera as one mesh: items are (x, y, z0, height, lean, half_width)."""
    verts, faces = [], []
    for x, y, z0, h, lean, w in items:
        n = len(verts)
        verts += [(x - w, y, z0), (x + w, y, z0), (x + lean * 0.5 + w * 0.5, y, z0 + h * 0.6), (x + lean, y, z0 + h), (x + lean * 0.5 - w * 0.5, y, z0 + h * 0.6)]
        faces += [(n, n + 1, n + 2, n + 4), (n + 4, n + 2, n + 3)]
    return mesh_obj(name, mat, verts, faces, smooth=False)


def strip(name, mat, pts, z=0.012):
    """A flat ribbon on the ground through (x, y_near, y_far) stations."""
    verts, faces = [], []
    for x, y0, y1 in pts:
        verts += [(x, y0, z), (x, y1, z)]
    for i in range(len(pts) - 1):
        a = i * 2
        faces.append((a, a + 2, a + 3, a + 1))
    return mesh_obj(name, mat, verts, faces)


def solid(ob, t):
    m = ob.modifiers.new('solid', 'SOLIDIFY')
    m.thickness = t
    m.offset = 0
    return ob


def px_of(p):
    x, y = proj(p)
    return round(x, 1), round(y, 1)


# ---------------------------------------------------------------------------------- the park
class Park:
    def __init__(self, L):
        self.L = L
        self.rng = random.Random(8)
        self.view = tuple(L.get('VIEW', (0, 0, W, H)))
        self.spots = {s['id']: s for s in L['SPOTS']}
        self.fairy = []   # where the string lights' bulbs land on screen, for the game's glow
        self.notes = {}

    def build(self):
        with layer('far'):
            self.backdrop()
        with layer('mid'):
            self.lawn()
            self.path()
            self.blanket()
            self.sandpit()
            self.flowers()
        with layer('prop:tree'):
            self.tree()
        with layer('prop:bench'):
            self.bench()
        with layer('prop:lamp'):
            self.lamp()
        with layer('prop:tower'):
            self.tower()
        with layer('prop:bunting'):
            self.bunting()
        with layer('fore'):
            self.foreground()

    # -- beyond the hedge ----------------------------------------------------------------------
    def backdrop(self):
        r = random.Random(77)

        def hill(name, base, amp, col, ph, f, y):
            pts = [(x, base + math.sin(x * f + ph) * amp + math.sin(x * f * 2.7 + ph * 2) * amp * 0.35) for x in range(-200, W + 201, 12)]
            pts += [(W + 200, 760), (-200, 760)]
            return prism(name, felt(name, col, sheen=0.25, var=0.08, bump=0.4), px_poly(pts, y), y, y + 0.4, 0.05)
        hill('HillFar', 560, 46, '#b4d3c2', 0.6, 0.004, 46)
        # the village on the far hill
        yv = 45.4
        m_wall = [felt('Cot0', '#f3e7cc', sheen=0.4, var=0.05), felt('Cot1', '#ecd0a8', sheen=0.4, var=0.05)]
        m_roof = [felt('Roof0', '#cf6d52', sheen=0.4, var=0.06), felt('Roof1', '#bb5a44', sheen=0.4, var=0.06)]
        m_win = felt('CotWin', '#7d6a5c', sheen=0.2, var=0.0, bump=0.0)
        for i, (x, y, w) in enumerate([(1010, 548, 30), (1052, 556, 26), (1094, 552, 34), (1380, 560, 28), (1420, 566, 30), (640, 566, 30), (682, 572, 26)]):
            prism(f'Cottage{i}', m_wall[i % 2], px_poly([(x, y), (x + w, y), (x + w, y + 30), (x, y + 30)], yv), yv, yv + 0.3, 0.015)
            prism(f'CotRoof{i}', m_roof[i % 2], px_poly([(x - 5, y + 2), (x + w / 2, y - 17), (x + w + 5, y + 2)], yv - 0.03), yv - 0.06, yv + 0.3, 0.015)
            prism(f'CotWin{i}', m_win, px_poly([(x + w / 2 - 3, y + 10), (x + w / 2 + 3, y + 10), (x + w / 2 + 3, y + 18), (x + w / 2 - 3, y + 18)], yv - 0.01), yv - 0.02, yv, 0)
        prism('Church', m_wall[0], px_poly([(1140, 520), (1154, 520), (1154, 584), (1140, 584)], yv), yv, yv + 0.3, 0.015)
        prism('Spire', m_roof[1], px_poly([(1135, 523), (1147, 487), (1159, 523)], yv - 0.03), yv - 0.06, yv + 0.3, 0.01)
        hill('HillMid', 604, 30, '#99c7a2', 2.4, 0.005, 43)
        # far trees: little felt lollipops along the nearer hill
        yt = 41.5
        m_trunk = felt('FarTrunk', '#7a6248', sheen=0.3, var=0.05)
        m_leaf = obj_color_felt('FarLeaf', sheen=0.3, bump=0.5, var=0.12)
        for i in range(27):
            x, y, s = -60 + i * 80 + r.uniform(-24, 24), 632 + r.uniform(-10, 10), r.uniform(23, 38)
            rbox(f'FarTrunk{i}', m_trunk, X(x - 3), X(x + 3), yt, yt + 0.08, Zp(y + 24, yt), Zp(y - 6, yt), bevel=0.01)
            pom(f'FarTree{i}', m_leaf, (X(x), yt - 0.1, Zp(y - s * 0.5, yt - 0.1)), s / U, color=['#74ad70', '#66a068', '#84ba7a'][i % 3], lump=0.16)
        hill('HillNear', 652, 12, '#83b885', 4.1, 0.007, 40)
        # the hedge along the back of the lawn: a row of clipped felt cushions
        yh = Yfl(700) + 0.5
        m_hedge = obj_color_felt('Hedge', sheen=0.3, bump=0.55, var=0.14)
        x = -2.6
        k = 0
        while x < 22.5:
            w = r.uniform(0.42, 0.58)
            pom(f'Hedge{k}', m_hedge, (x + w, yh + r.uniform(-0.15, 0.15), 0.18), 1.0, color=['#4f8f58', '#47854f', '#58985e'][k % 3],
                lump=0.07, squash=(w * 1.15, 0.5, r.uniform(0.42, 0.52)))
            x += w * 1.75
            k += 1

    # -- the lawn ------------------------------------------------------------------------------
    def lawn(self):
        def mown(g, P, col):
            # stripes left by the mower, running away from us and a little across
            x, y, z = g.sep(P)
            s = g.m('SINE', g.mul(g.add(x, g.mul(y, 0.07)), 2 * math.pi / 300))
            col = g.mix(col, '#86c064', g.mrange(s, -0.25, 0.25, 0, 0.6, 'SMOOTHSTEP'))
            # sunnier toward the back, deeper green at our feet
            return g.mix(col, '#93c96e', g.mrange(y, 1500, 3600, 0, 0.3))
        m = felt('Lawn', '#6fae52', pattern=mown, var=0.16, sheen=0.12, bump=0.6, sss=0.05)
        rbox('Lawn', m, -3.0, 22.5, -2.0, Yfl(700) + 1.2, -0.3, 0.0, bevel=0)
        # tufts of longer grass, and daisies, scattered where nobody sits
        r = random.Random(4)
        keep_clear = [(s['x'], s['y']) for s in self.L['SPOTS'] if len(s['route']) == 1]

        def clear(px, py, rad=95):
            return all(abs(px - sx) > rad or abs(py - sy) > 34 for sx, sy in keep_clear)
        tufts = {0: [], 1: []}
        for _ in range(620):
            px, py = r.uniform(-150, W + 150), r.uniform(712, 1100)
            if not clear(px, py, 70):
                continue
            x, y = X(px), Yfl(py)
            n = r.randrange(3, 6)
            for b in range(n):
                tufts[r.randrange(2)].append((x + r.uniform(-0.07, 0.07), y + r.uniform(-0.1, 0.1), 0, r.uniform(0.09, 0.2), r.uniform(-0.07, 0.07), r.uniform(0.012, 0.02)))
        blades('TuftsLight', felt('TuftLight', '#a3d47c', sheen=0.6, var=0.1, bump=0.2), tufts[0])
        blades('TuftsDark', felt('TuftDark', '#5c9a4c', sheen=0.6, var=0.1, bump=0.2), tufts[1])
        petals, eyes, butter = [], [], []
        for _ in range(95):
            px, py = r.uniform(-120, W + 120), r.uniform(730, 1095)
            if not clear(px, py):
                continue
            x, y = X(px), Yfl(py)
            rad = r.uniform(0.035, 0.05)
            yellow = r.random() > 0.72
            for p in range(6):
                a = p * math.pi / 3
                (butter if yellow else petals).append((x + math.cos(a) * rad, y + math.sin(a) * rad * 2.2, 0.05, rad * 0.62, rad * 1.2, 0.015))
            eyes.append((x, y, 0.06, rad * 0.5, rad * 0.9, 0.02))
        blobs('Daisies', felt('Daisy', '#fbf6e8', sheen=0.6, var=0.03, bump=0.1), petals, 1)
        blobs('Buttercups', felt('Buttercup', '#f6d661', sheen=0.6, var=0.03, bump=0.1), butter, 1)
        blobs('DaisyEyes', felt('DaisyEye', '#eeb13c', sheen=0.4, var=0.03, bump=0.1), eyes, 1)

    def path(self):
        # a gravel path along the hedge, with a row of felt edging stones
        m = felt('Path', '#dcc797', var=0.12, sheen=0.12, bump=0.6)
        pts = []
        for px in range(-260, W + 261, 40):
            near = Yfl(742 + math.sin(px * 0.004 + 1.4) * 6)
            far = Yfl(712 + math.sin(px * 0.004 + 1) * 5)
            pts.append((X(px), near, far))
        strip('Path', m, pts)
        r = random.Random(12)
        stones = []
        for px in range(-240, W + 241, 46):
            near = Yfl(748 + math.sin(px * 0.004 + 1.4) * 6)
            stones.append((X(px + r.uniform(-8, 8)), near, 0.02, r.uniform(0.13, 0.18), r.uniform(0.3, 0.42), 0.05))
        blobs('PathStones', felt('PathStone', '#cdbfa6', var=0.1, sheen=0.4, bump=0.4), stones, 2)

    def blanket(self):
        """A gingham picnic blanket on the grass in front of the bench, where two cats settle."""
        def gingham(g, P, col):
            x, y, z = g.sep(P)
            sx = g.m('GREATER_THAN', g.m('FRACT', g.mul(x, 1 / 64)), 0.5)
            sy = g.m('GREATER_THAN', g.m('FRACT', g.mul(y, 1 / 170)), 0.5)
            both = g.mul(sx, sy)
            either = g.m('MAXIMUM', sx, sy)
            col = g.mix(col, '#9fbcd3', either)
            return g.mix(col, '#6f97b8', both)
        m = felt('Gingham', '#efe6d2', pattern=gingham, var=0.07, sheen=0.2, bump=0.5)
        a, b = self.spots['grassA'], self.spots['grassB']
        x0, x1 = X(a['x'] - 150), X(b['x'] + 150)
        y0, y1 = Yfl(992), Yfl(912)
        ob = rbox('Blanket', m, x0, x1, y0, y1, 0.0, 0.035, bevel=0.016)
        ob.rotation_euler = (0, 0, math.radians(-1.2))

    def sandpit(self):
        s = self.L['SAND']
        cx, cy = X(s['cx']), Yfl(s['cy'])
        sx, sy = s['rx'] / U, 2.5
        m_log = wood('SandRim', '#c79c6d', along='X', streak=0.25)
        lathe('SandRim', m_log, cx, cy, [(1.1, 0.0), (1.11, 0.14), (1.06, 0.21), (0.96, 0.21), (0.91, 0.15), (0.9, 0.02)], segs=72, sx=sx, sy=sy,
              cap_bottom=False, cap_top=False)
        m_sand = felt('Sand', '#e9d5a4', var=0.1, sheen=0.15, bump=0.75)
        sand = lathe('Sand', m_sand, cx, cy, [(0.92, 0.07), (0.6, 0.085), (0.0, 0.09)], segs=72, sx=sx, sy=sy, cap_bottom=False)
        sub(sand, 1)
        lumpy(sand, 0.05, 0.5)
        # a bucket, a spade and a little castle at the back of the sand, clear of the cat
        bx, by = cx - 1.02, cy + 1.0
        m_b = felt('Bucket', '#5f9fc4', sheen=0.5, var=0.06, bump=0.3)
        lathe('Bucket', m_b, bx, by, [(0.15, 0.08), (0.2, 0.4), (0.215, 0.42), (0.19, 0.42), (0.14, 0.12)], segs=28, cap_top=False)
        tube('BucketHandle', felt('BucketHandle', '#f0c75e', sheen=0.4, var=0.04, bump=0.2),
             [(bx + 0.2 * math.cos(a), by, 0.42 + 0.19 * math.sin(a)) for a in np.linspace(0, math.pi, 9)], 0.018)
        m_sp = felt('Spade', '#d0604a', sheen=0.4, var=0.05, bump=0.25)
        tube('SpadeHandle', m_sp, [(bx + 0.42, by + 0.2, 0.38), (bx + 0.52, by - 0.05, 0.1)], 0.028, smooth=False)
        ell('SpadeBlade', m_sp, (bx + 0.55, by - 0.12, 0.09), (0.1, 0.13, 0.03), (0.2, 0, 0.4), seg=16)
        m_castle = felt('Castle', '#e8d19c', var=0.08, sheen=0.4, bump=0.8)
        kx, ky = cx - 0.3, cy + 1.45
        lathe('Castle', m_castle, kx, ky, [(0.3, 0.08), (0.27, 0.3), (0.18, 0.3), (0.16, 0.5), (0.0, 0.5)], segs=24)
        for i in range(4):
            a = i * math.pi / 2 + 0.6
            rbox(f'Battlement{i}', m_castle, kx + 0.13 * math.cos(a) - 0.035, kx + 0.13 * math.cos(a) + 0.035,
                 ky + 0.13 * math.sin(a) - 0.035, ky + 0.13 * math.sin(a) + 0.035, 0.5, 0.57, bevel=0.012)
        tube('CastleFlagPole', m_sp, [(kx, ky, 0.5), (kx, ky, 0.82)], 0.012, smooth=False)
        solid(mesh_obj('CastleFlag', m_sp, [(kx, ky, 0.82), (kx + 0.16, ky, 0.76), (kx, ky, 0.7)], [(0, 1, 2)], smooth=False), 0.012)

    def flowers(self):
        """Clumps of felt flowers and a few toadstools, tucked where no animal walks or sits."""
        r = random.Random(31)
        stems, leaves = [], []
        heads = {c: [] for c in BLOOMS}

        def clump(px, py, n, spread=46, tall=(0.32, 0.6)):
            for _ in range(n):
                x, y = X(px + r.uniform(-spread, spread)), Yfl(py) + r.uniform(-0.9, 0.9)
                h = r.uniform(*tall)
                lean = r.uniform(-0.06, 0.06)
                stems.append((x, y, 0, h, lean, 0.014))
                leaves.append((x - 0.03, y - 0.02, 0, h * 0.55, -0.1, 0.035))
                leaves.append((x + 0.03, y - 0.02, 0, h * 0.5, 0.11, 0.035))
                heads[r.choice(BLOOMS)].append((x + lean, y, h + 0.03, 0.075, 0.075, 0.1))
        # by the tree on the far left, round the lamp post, by the tower's far post, along the hedge
        clump(318, 878, 9)
        clump(250, 930, 7, 40)
        clump(1335, 868, 6, 26)
        clump(1832, 884, 8, 30)
        clump(858, 866, 5, 22)
        for px in range(-200, W + 201, 34):
            clump(px, 704, 2, 14, (0.14, 0.26))
        blades('Stems', felt('FlowerStem', '#5a9a50', sheen=0.4, var=0.06, bump=0.2), stems)
        blades('FlowerLeaves', felt('FlowerLeaf', '#6fae5c', sheen=0.5, var=0.08, bump=0.2), leaves)
        for i, (c, items) in enumerate(heads.items()):
            blobs(f'Blooms{i}', felt(f'Bloom{i}', c, sheen=0.8, var=0.05, bump=0.25), items, 2)
        # toadstools among the roots
        m_stem = felt('ToadStem', '#f4ecd8', sheen=0.5, var=0.04, bump=0.3)
        m_cap = felt('ToadCap', '#d2553f', sheen=0.7, var=0.06, bump=0.3)
        dots = []
        for i, (px, py, s) in enumerate([(300, 912, 1.0), (338, 926, 0.7), (268, 938, 0.82)]):
            x, y = X(px), Yfl(py)
            lathe(f'ToadStem{i}', m_stem, x, y, [(0.06 * s, 0.0), (0.05 * s, 0.2 * s), (0.045 * s, 0.26 * s)], segs=16)
            lathe(f'ToadCap{i}', m_cap, x, y, [(0.19 * s, 0.22 * s), (0.2 * s, 0.26 * s), (0.15 * s, 0.36 * s), (0.07 * s, 0.42 * s), (0.0, 0.43 * s)], segs=24)
            for k in range(6):
                a = k * 1.05 + i
                dots.append((x + math.cos(a) * 0.12 * s, y - abs(math.sin(a)) * 0.12 * s - 0.02, (0.33 + 0.06 * math.cos(a * 2)) * s, 0.028 * s, 0.028 * s, 0.028 * s))
        blobs('ToadDots', felt('ToadDot', '#fbf5e6', sheen=0.5, var=0.02, bump=0.1), dots, 1)

    # -- the shady tree ------------------------------------------------------------------------
    def tree(self):
        T = self.L['TREE']
        tx, ty = X(T['x']), Yfl(T['base'])
        m_bark = wood('Bark', '#8d623e', along='Z', streak=0.5)
        trunk = lathe('Trunk', m_bark, tx, ty, [(0.86, -0.05), (0.62, 0.22), (0.5, 0.7), (0.44, 1.6), (0.4, 2.8), (0.37, 4.0), (0.33, 5.0), (0.24, 6.2)],
                      segs=36, cap_top=True)
        sub(trunk, 1)
        lumpy(trunk, 0.1, 0.55)
        fuzz(trunk, 0.014, '#8d623e', 0.4)
        # roots feeling their way out across the grass
        for i, a in enumerate((-2.75, -2.2, -1.45, -0.7, -0.2, 0.5)):
            dx, dy = math.cos(a), math.sin(a) * 1.5
            ln = (1.0, 1.25, 1.1, 1.3, 1.05, 0.9)[i]
            tube(f'Root{i}', m_bark, [(tx + dx * 0.3, ty + dy * 0.3, 0.42), (tx + dx * 0.72 * ln, ty + dy * 0.72 * ln, 0.13),
                                      (tx + dx * 1.2 * ln, ty + dy * 1.2 * ln, -0.05)], 0.2, radii=[1.0, 0.62, 0.3], res=4)
        # the big branch: its top edge passes exactly under the branch cat's feet
        sp = self.spots['branch']
        yb = ty
        r_at = lambda x: 0.27 - (x - 4.6) * 0.036
        pts, radii = [], []
        for x, py in ((tx + 0.1, 668), (5.4, 634), (6.3, 612), (X(sp['x']), sp['y']), (7.9, 592), (8.5, 582)):
            rr_ = r_at(x)
            pts.append((x, yb, Zp(py + rr_ * U, yb)))   # centre line = top edge + radius
            radii.append(rr_ / 0.27)
        tube('Branch', m_bark, pts, 0.27, radii=radii, res=5)
        # two smaller limbs disappearing up into the leaves
        for i, (x1, py1, x2, py2) in enumerate(((tx - 0.1, 520, 3.1, 400), (tx + 0.15, 500, 5.5, 380))):
            tube(f'Limb{i}', m_bark, [(x1, ty, Zp(py1, ty)), ((x1 + x2) / 2, ty, Zp((py1 + py2) / 2 + 14, ty)), (x2, ty, Zp(py2, ty))], 0.17, radii=[1, 0.8, 0.5], res=4)

        # the canopy: felt pom-poms at many depths, so it shades the grass all round the trunk
        m_leaf = obj_color_felt('Canopy', sheen=0.35, bump=0.6, var=0.16)
        r = random.Random(6)
        big = [(330, 340, 120, 17.0), (420, 220, 150, 19.6), (560, 240, 145, 18.4), (665, 330, 120, 16.6), (520, 380, 125, 15.2), (385, 415, 95, 14.6),
               (705, 405, 76, 15.8), (250, 300, 78, 18.2), (610, 150, 84, 20.2), (300, 190, 80, 20.6), (470, 300, 110, 13.6), (600, 400, 70, 13.8)]
        cols = ['#5d9f58', '#68aa5c', '#549452', '#73b464']
        for i, (px, py, rad, y) in enumerate(big):
            o = pom(f'Canopy{i}', m_leaf, (X(px), y, Zp(py, y)), rad / U, color=cols[i % 4], lump=0.2)
            if i < 9:
                fuzz(o, 0.03, shade(cols[i % 4], -0.12), 0.35)
        # smaller tufts round the edge to break the outline
        for i in range(26):
            a = i / 26 * math.pi * 2 + r.uniform(-0.1, 0.1)
            px = 480 + math.cos(a) * r.uniform(250, 300) * 1.0
            py = 285 - math.sin(a) * r.uniform(170, 215)
            if py > 455 and px > 560:
                continue    # keep the sky open above the branch cat
            y = r.uniform(14.5, 20.0)
            pom(f'Tuft{i}', m_leaf, (X(px), y, Zp(py, y)), r.uniform(0.32, 0.5), color=cols[(i + 1) % 4], lump=0.22)
        # a sprig at the tip of the branch
        for i, (px, py, rad) in enumerate(((856, 566, 36), (892, 592, 26), (826, 548, 26))):
            pom(f'Sprig{i}', m_leaf, (X(px), yb - 0.05 * i, Zp(py, yb)), rad / U, color=cols[(i + 2) % 4], lump=0.2)
        # stitched leaves standing proud of the wool, and a few red apples
        m_l = obj_color_felt('Leaf', sheen=0.8, bump=0.3)
        for i in range(70):
            px, py, rad, y = big[r.randrange(9)]
            a, d = r.uniform(0, math.pi * 2), math.sqrt(r.random()) * rad * 0.8
            lx, ly = px + math.cos(a) * d, py + math.sin(a) * d * 0.9
            yy = y - math.sqrt(max(0.0, (rad / U) ** 2 - (d / U) ** 2)) - 0.06
            th = r.uniform(-2.4, -0.7)
            leaf(f'TreeLeaf{i}', m_l, (lx, ly), (math.cos(th), -math.sin(th)), r.uniform(20, 30), color=['#8cc674', '#7ab868', '#9ad07e'][i % 3],
                 curl=0.2, y_of=lambda *_: yy)
        apples = []
        for px, py, bi in ((352, 372, 0), (470, 268, 10), (585, 300, 2), (668, 352, 3), (530, 420, 4), (300, 300, 7), (420, 180, 1), (610, 205, 2)):
            _, _, rad, y = big[bi]
            bx, by = big[bi][0], big[bi][1]
            d = min(rad * 0.95, math.hypot(px - bx, py - by))
            yy = y - math.sqrt(max(0.0, (rad / U) ** 2 - (d / U) ** 2)) - 0.1
            apples.append((X(px), yy, Zp(py, yy), 0.115, 0.115, 0.105))
        blobs('Apples', felt('Apple', '#d2493a', sheen=0.9, var=0.07, bump=0.25, spec=0.4), apples, 3)
        self.notes['branch'] = px_of((X(sp['x']), yb, Zp(sp['y'], yb)))

    # -- the bench -----------------------------------------------------------------------------
    def bench(self):
        """A slatted park bench on two end frames. Each frame is a front leg that rises to the
        armrest, a back leg that carries on up as the post for the backrest, an armrest between
        them, and stretchers at the foot. The cats sit on the seat at the middle of its depth."""
        B = self.L['BENCH']
        x0, x1 = X(B['x0']), X(B['x1'])
        ys = Yfl(B['base']) - 0.35            # the middle of the seat's depth
        zs = Zp(B['seat'], ys)                # the top of the seat
        yf, yb = ys - 0.48, ys + 0.5          # front legs, back legs
        m_slat = wood('BenchSlat', '#4f9097', along='X', streak=0.22)
        m_iron = felt('BenchFrame', '#3b4947', sheen=0.35, var=0.07, bump=0.3, spec=0.35, rough=0.7)
        # seat: four slats with small gaps, the front one rounded over
        n = 4
        d = (yb - 0.04 - (yf - 0.06)) / n
        for i in range(n):
            a = yf - 0.06 + i * d
            rbox(f'SeatSlat{i}', m_slat, x0 - 0.06, x1 + 0.06, a + 0.015, a + d - 0.015, zs - 0.075, zs, bevel=0.03)
        # backrest: three slats leaning back a little
        lean = 0.1
        for i in range(3):
            za = zs + 0.34 + i * 0.3
            o = rbox(f'BackSlat{i}', m_slat, x0 - 0.02, x1 + 0.02, -0.035, 0.035, -0.12, 0.12, bevel=0.03)
            o.location = (0, yb + 0.02 + i * 0.3 * lean, za + 0.12)
            o.rotation_euler = (-lean, 0, 0)
        ztop = zs + 0.34 + 0.9 + 0.12
        zarm = zs + 0.62
        for k, ex in enumerate((x0 + 0.16, x1 - 0.16)):
            w = 0.055
            # front leg: grass to armrest
            rbox(f'FrontLeg{k}', m_iron, ex - w, ex + w, yf - w, yf + w, 0, zarm, bevel=0.025)
            # back leg and backrest post in one piece, raked back above the seat
            tube(f'BackLeg{k}', m_iron, [(ex, yb, 0), (ex, yb, zs), (ex, yb + 0.02 + (ztop - zs) * lean, ztop)], w * 1.05, res=3, smooth=False)
            ell(f'Finial{k}', m_iron, (ex, yb + 0.02 + (ztop - zs) * lean, ztop + 0.04), (0.085, 0.085, 0.085), seg=16)
            # armrest: a flat bar from the post forward over the front leg, with a rounded nose
            ya = yb + 0.02 + (zarm - zs) * lean
            rbox(f'Arm{k}', m_slat, ex - 0.1, ex + 0.1, yf - 0.16, ya + 0.04, zarm, zarm + 0.075, bevel=0.035)
            # the side rail under the seat and a stretcher near the grass
            rbox(f'SideRail{k}', m_iron, ex - w * 0.8, ex + w * 0.8, yf, yb, zs - 0.16, zs - 0.075, bevel=0.02)
            rbox(f'SideStretch{k}', m_iron, ex - w * 0.7, ex + w * 0.7, yf, yb, 0.28, 0.36, bevel=0.02)
            # little feet
            for fy in (yf, yb):
                ell(f'Foot{k}{fy:.1f}', m_iron, (ex, fy, 0.02), (0.1, 0.1, 0.035), seg=16)
        # long rails that carry the slats, and one stretcher between the two frames
        rbox('FrontRail', m_iron, x0 + 0.16, x1 - 0.16, yf - 0.03, yf + 0.03, zs - 0.15, zs - 0.075, bevel=0.02)
        rbox('BackRail', m_iron, x0 + 0.16, x1 - 0.16, yb - 0.03, yb + 0.03, zs - 0.15, zs - 0.075, bevel=0.02)
        rbox('Stretcher', m_iron, x0 + 0.16, x1 - 0.16, ys - 0.03, ys + 0.03, 0.28, 0.35, bevel=0.02)
        self.notes['benchSeat'] = px_of(((x0 + x1) / 2, ys, zs))

    # -- the lamp post -------------------------------------------------------------------------
    def lamp(self):
        Lm = self.L['LAMP']
        x, y = X(Lm['x']), Yfl(Lm['base'])
        zh = Zp(Lm['head'], y)
        m = felt('LampIron', '#3b4947', sheen=0.35, var=0.07, bump=0.3, spec=0.35, rough=0.7)
        lathe('LampPost', m, x, y, [(0.2, 0.0), (0.2, 0.1), (0.13, 0.16), (0.11, 0.44), (0.075, 0.52), (0.055, 0.7), (0.05, zh - 0.5),
                                    (0.09, zh - 0.44), (0.09, zh - 0.38), (0.05, zh - 0.34), (0.05, zh - 0.26), (0.16, zh - 0.22), (0.16, zh - 0.19)], segs=28)
        # the lantern: four panes of warm glass in an iron cage, under a little roof
        m_glass = felt('LampGlass', '#f6e9c2', sheen=0.3, var=0.03, bump=0.1, emission=0.45, emit_color=lin('#ffe3a8'))
        lathe('Lantern', m_glass, x, y, [(0.12, zh - 0.19), (0.17, zh + 0.2), (0.0, zh + 0.2)], segs=4, cap_bottom=True).rotation_euler = (0, 0, 0)
        for i in range(4):
            a = math.pi / 4 + i * math.pi / 2
            tube(f'Cage{i}', m, [(x + 0.125 * math.cos(a), y + 0.125 * math.sin(a), zh - 0.19), (x + 0.175 * math.cos(a), y + 0.175 * math.sin(a), zh + 0.2)], 0.016, smooth=False)
        lathe('LampRoof', m, x, y, [(0.25, zh + 0.19), (0.24, zh + 0.23), (0.07, zh + 0.42), (0.03, zh + 0.45), (0.0, zh + 0.45)], segs=4)
        ell('LampFinial', m, (x, y, zh + 0.49), (0.045, 0.045, 0.06), seg=16)
        # a crossbar, as on an old gas lamp
        tube('LampBar', m, [(x - 0.26, y, zh - 0.44), (x + 0.26, y, zh - 0.44)], 0.022, smooth=False)
        for sx_ in (-0.26, 0.26):
            ell(f'LampBarEnd{sx_}', m, (x + sx_, y, zh - 0.44), (0.04, 0.04, 0.04), seg=12)
        self.lamp_top = (x, y, zh + 0.3)
        self.notes['lampHead'] = px_of((x, y, zh))

    # -- the play tower and its slide ----------------------------------------------------------
    def tower(self):
        Tw = self.L['TOWER']
        x0, x1 = X(Tw['x0']), X(Tw['x1'])
        yf = Yfl(Tw['base'])                  # front posts
        yb = yf + 1.6                         # back posts
        yc = (yf + yb) / 2                    # where the tower cat sits
        zd = Zp(Tw['deck'], yc)               # top of the deck
        ze = Zp(478, yc)                      # the eaves
        m_post = wood('TowerPost', '#c99a66', along='Z', streak=0.28)
        m_rail = wood('TowerRail', '#b98654', along='X', streak=0.25)
        m_deck = wood('TowerDeck', '#5a9e9c', along='X', streak=0.2)
        w = 0.085
        for k, (px_, py_) in enumerate(((x0, yf), (x1, yf), (x0, yb), (x1, yb))):
            rbox(f'Post{k}', m_post, px_ - w, px_ + w, py_ - w, py_ + w, 0, ze + 0.05, bevel=0.03)
            ell(f'PostFoot{k}', m_post, (px_, py_, 0.03), (0.15, 0.15, 0.05), seg=16)
        # the deck: boards running front to back between two beams
        nb = 8
        bw = (x1 - x0 + 0.24) / nb
        for i in range(nb):
            a = x0 - 0.12 + i * bw
            rbox(f'DeckBoard{i}', m_deck, a + 0.012, a + bw - 0.012, yf - 0.14, yb + 0.14, zd - 0.09, zd, bevel=0.025)
        rbox('DeckBeamF', m_rail, x0 - 0.1, x1 + 0.1, yf - 0.05, yf + 0.05, zd - 0.24, zd - 0.09, bevel=0.025)
        rbox('DeckBeamB', m_rail, x0 - 0.1, x1 + 0.1, yb - 0.05, yb + 0.05, zd - 0.24, zd - 0.09, bevel=0.025)
        # rails round the back and the ladder side, with spindles
        zr = zd + 0.72
        rbox('RailBack', m_rail, x0, x1, yb - 0.04, yb + 0.04, zr - 0.05, zr + 0.05, bevel=0.025)
        rbox('RailSide', m_rail, x1 - 0.04, x1 + 0.04, yf, yb, zr - 0.05, zr + 0.05, bevel=0.025)
        for i in range(1, 6):
            sx_ = x0 + (x1 - x0) * i / 6
            rbox(f'Spindle{i}', m_rail, sx_ - 0.03, sx_ + 0.03, yb - 0.03, yb + 0.03, zd, zr, bevel=0.012)
        # cross braces under the deck, at the back
        for k, (a, b) in enumerate(((x0, x1), (x1, x0))):
            tube(f'Brace{k}', m_rail, [(a, yb, 0.25), (b, yb, zd - 0.3)], 0.045, smooth=False)
        # the roof: a red felt pyramid with rows of shingles and a scalloped edge
        def shingles(g, P, col):
            x, y, z = g.sep(P)
            fz = g.m('FRACT', g.mul(z, 1 / 21))
            return g.mix(col, shade('#cf5c44', -0.3), g.mrange(fz, 0.0, 0.3, 0.55, 0.0))
        m_roof = felt('TowerRoof', '#cf5c44', pattern=shingles, var=0.09, sheen=0.3, bump=0.55)
        ov = 0.36
        cxr = (x0 + x1) / 2
        zp = ze + 1.0
        verts = [(x0 - ov, yf - ov, ze), (x1 + ov, yf - ov, ze), (x1 + ov, yb + ov, ze), (x0 - ov, yb + ov, ze), (cxr, yc, zp)]
        roof = mesh_obj('Roof', m_roof, verts, [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (3, 2, 1, 0)], smooth=False)
        bev(roof, 0.04, 3)
        scallops = []
        n = 9
        for i in range(n):
            sx_ = x0 - ov + (x1 - x0 + 2 * ov) * (i + 0.5) / n
            scallops.append((sx_, yf - ov, ze - 0.01, (x1 - x0 + 2 * ov) / n * 0.52, 0.05, 0.13))
        blobs('Scallops', felt('Scallop', '#b94c38', sheen=0.8, var=0.07, bump=0.4), scallops, 3)
        ell('RoofKnob', m_post, (cxr, yc, zp + 0.03), (0.09, 0.09, 0.09), seg=16)
        tube('FlagPole', m_post, [(cxr, yc, zp), (cxr, yc, zp + 0.5)], 0.022, smooth=False)
        solid(mesh_obj('Flag', felt('TowerFlag', '#f0c24a', sheen=0.7, var=0.05, bump=0.3),
                       [(cxr, yc, zp + 0.5), (cxr + 0.34, yc, zp + 0.4), (cxr, yc, zp + 0.28)], [(0, 1, 2)], smooth=False), 0.016)

        # the slide: a felt chute from the deck's left edge down to a flat run-out on the grass,
        # where the slide cat lies. Its floor passes under the route's stepping point too.
        sp = self.spots['slide']
        ysl = yc - 0.5
        hw = 0.45
        z_out = Zp(sp['y'], ysl)
        top = (x0 - 0.05, zd)
        knee = (X(1462), z_out + 0.26)
        path = [(top[0] + 0.14, top[1]), (top[0], top[1] - 0.04)]
        for t in np.linspace(0.08, 1.0, 8):
            path.append((top[0] + (knee[0] - top[0]) * t, top[1] - 0.04 + (knee[1] - top[1] + 0.04) * t))
        path += [(knee[0] - 0.16, z_out + 0.1), (knee[0] - 0.34, z_out + 0.02), (knee[0] - 0.55, z_out), (X(1378), z_out)]
        verts, faces = [], []
        wall = 0.15
        for x, z in path:
            verts += [(x, ysl - hw, z + wall), (x, ysl - hw, z), (x, ysl + hw, z), (x, ysl + hw, z + wall)]
        for i in range(len(path) - 1):
            a = i * 4
            for j in range(3):
                faces.append((a + j, a + j + 1, a + j + 5, a + j + 4))
        m_slide = felt('Slide', '#e8b53c', var=0.07, sheen=0.3, bump=0.4)
        chute = mesh_obj('Slide', m_slide, verts, faces)
        solid(chute, 0.06)
        bev(chute, 0.02, 2)
        # rolled rims along both edges, and legs under the run-out
        for k, yy in enumerate((ysl - hw, ysl + hw)):
            tube(f'SlideRim{k}', felt('SlideRim', '#f0c85c', var=0.05, sheen=0.3, bump=0.3), [(x, yy, z + wall) for x, z in path], 0.045, res=4)
        for k, lx in enumerate((knee[0] - 0.45, knee[0] - 0.1)):
            for yy in (ysl - hw + 0.08, ysl + hw - 0.08):
                rbox(f'SlideLeg{k}{yy:.1f}', m_post, lx - 0.04, lx + 0.04, yy - 0.04, yy + 0.04, 0, z_out + (0.02 if k == 0 else 0.1), bevel=0.015)
        # where the route's middle step lands on the slide's floor
        rx = 15.05
        t = (rx - top[0]) / (knee[0] - top[0])
        self.notes['slideStep'] = px_of((rx, ysl, top[1] - 0.04 + (knee[1] - top[1] + 0.04) * t))
        self.notes['slideFoot'] = px_of((X(sp['x']), ysl, z_out))
        self.notes['towerDeck'] = px_of((cxr, yc, zd))

        # the ladder up the right-hand side
        lx0, lx1 = x1 + 0.62, x1 + 0.1
        for k, yy in enumerate((yc - 0.36, yc + 0.36)):
            tube(f'LadderRail{k}', m_post, [(lx0, yy, 0), (lx1, yy, zd + 0.1)], 0.05, smooth=False)
        for i in range(1, 7):
            u = i / 7
            tube(f'Rung{i}', m_rail, [(lx0 + (lx1 - lx0) * u, yc - 0.36, zd * u), (lx0 + (lx1 - lx0) * u, yc + 0.36, zd * u)], 0.035, smooth=False)
        self.tower_eave = (x0 - ov, yf - ov, ze)

    # -- bunting and string lights -------------------------------------------------------------
    def bunting(self):
        """Two swags of felt flags with a bulb between each: tree to lamp post, lamp post to tower.
        The game lights the bulbs for the last minute."""
        m_string = felt('String', '#5a4a3c', sheen=0.3, var=0.03, bump=0.1)
        m_flag = obj_color_felt('Bunting', sheen=0.8, bump=0.35, var=0.07)
        m_bulb = felt('Bulb', '#fff0c4', sheen=0.4, var=0.02, bump=0.05, emission=0.5, emit_color=lin('#ffe6a6'))
        cols = ['#e98a6b', '#f6d36b', '#8fc0b8', '#f2a3b0', '#9fb6dd', '#f7f1e1']
        lx, ly, lz = self.lamp_top
        ex, ey, ez = self.tower_eave
        y_tree = 17.6
        runs = [((X(804), y_tree, Zp(452, y_tree)), (lx - 0.05, ly, lz - 0.12), 0.55, 11),
                ((lx + 0.05, ly, lz - 0.12), (ex + 0.1, ey, ez + 0.05), 0.4, 6)]
        bulbs = []
        k = 0
        for a, b, sag, n in runs:
            pt = lambda t: (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - sag * 4 * t * (1 - t))
            tube(f'String{k}', m_string, [pt(t) for t in np.linspace(0, 1, 24)], 0.012, res=2)
            for i in range(n):
                t = (i + 0.5) / n
                x, y, z = pt(t)
                x2, _, z2 = pt(t + 0.01)
                tilt = math.atan2(z2 - z, x2 - x)
                fl = mesh_obj(f'Flag{k}', m_flag, [(-0.15, 0, 0), (0.15, 0, 0), (0, 0, -0.34)], [(0, 1, 2)], smooth=False)
                solid(fl, 0.02)
                fl.location = (x, y, z - 0.012)
                fl.rotation_euler = (0, -tilt, 0)
                fl.color = (*lin(cols[k % len(cols)])[:3], 1)
                k += 1
                if i < n - 1:
                    bx, by, bz = pt((i + 1) / n)
                    bulbs.append((bx, by, bz - 0.06, 0.05, 0.05, 0.065))
                    self.fairy.append(px_of((bx, by, bz - 0.06)))
        blobs('Bulbs', m_bulb, bulbs, 2)

    # -- right in front of the lens ------------------------------------------------------------
    def foreground(self):
        """Out-of-focus grass, daisies and a few leaves overhead, framing the corners."""
        vx, vy, vw, vh = self.view
        r = random.Random(21)
        m_blade = obj_color_felt('ForeBlade', sheen=0.7, bump=0.3, var=0.1)
        yy = 2.6

        def blade(i, x, h, lean, w, col):
            base = vy + vh + 50
            pts = [(x - w, base), (x + lean * 0.35 - w * 0.6, base - h * 0.6), (x + lean, base - h), (x + lean * 0.5 + w * 0.7, base - h * 0.5), (x + w, base)]
            o = prism(f'ForeBlade{i}', m_blade, px_poly(pts, yy + i * 0.01), yy + i * 0.01, yy + i * 0.01 + 0.03, 0.01)
            o.color = (*lin(col)[:3], 1)
        for i in range(24):
            blade(i, r.uniform(vx - 70, vx + 250), r.uniform(110, 250), r.uniform(-60, 80), r.uniform(10, 18), GREENS[i % 4])
        for i in range(22):
            blade(40 + i, r.uniform(vx + vw - 240, vx + vw + 70), r.uniform(100, 230), r.uniform(-90, 50), r.uniform(10, 18), GREENS[i % 4])
        petals, eyes = [], []
        for dx, dy, s in ((vx + 110, vy + vh - 130, 34), (vx + 230, vy + vh - 60, 27), (vx + 20, vy + vh - 50, 30), (vx + vw - 50, vy + vh - 110, 32), (vx + vw - 150, vy + vh - 40, 26)):
            yd = yy - 0.2
            for p in range(9):
                a = p * math.pi * 2 / 9
                petals.append((X(dx + math.cos(a) * s), yd, Zp(dy + math.sin(a) * s * 0.85, yd), s * 0.6 / U, 0.03, s * 0.3 / U))
            eyes.append((X(dx), yd - 0.04, Zp(dy, yd - 0.04), s * 0.45 / U, 0.06, s * 0.42 / U))
        blobs('ForeDaisies', felt('ForeDaisy', '#f6f0e0', sheen=0.6, var=0.03, bump=0.1), petals, 2)
        blobs('ForeEyes', felt('ForeEye', '#ecb53f', sheen=0.4, var=0.03, bump=0.1), eyes, 2)
        # leaves hanging into the top right corner, from a tree behind the camera
        m_leaf = obj_color_felt('ForeLeaf', sheen=0.8, bump=0.3)
        for i in range(11):
            x, y = vx + vw - r.uniform(-20, 250), vy + r.uniform(-30, 105 - i * 4)
            th = r.uniform(0.3, 1.4)
            leaf(f'ForeLeaf{i}', m_leaf, (x, y), (-math.cos(th), math.sin(th)), r.uniform(70, 110), color=GREENS[i % 4], curl=0.15, y_of=lambda *_: 2.2)


# ---------------------------------------------------------------------------------- lights
def lights():
    with layer('room'):
        # afternoon sun from high up, a little behind the park and to the left: the tree's shade
        # falls forward onto the grass where the cats lie, and everything gets a warm rim
        add_light('Sun', 'SUN', energy=2.1, color=(1.0, 0.93, 0.8), frm=(-0.28, 0.34, 1.0), angle=7)
        # the open sky filling the shadows from in front, so nothing facing us goes dark
        add_light('SkyFill', 'SUN', energy=0.62, color=(0.84, 0.92, 1.0), frm=(0.25, -1.0, 0.55), angle=50, shadow=False)
        # a low warm kiss from the right, like light bouncing back off the lawn
        add_light('Bounce', 'SUN', energy=0.15, color=(1.0, 0.88, 0.7), frm=(1.0, -0.5, 0.25), angle=40, shadow=False)


PROPS = ['tree', 'bench', 'lamp', 'tower', 'bunting']
ALL_PROPS = {f'prop:{p}' for p in PROPS}
# the tree's broad shade is baked into the lawn and falls on the other props; the others carry
# their own contact shadows, so they stay put under the prop as the camera drifts
SHADOWED = ['bench', 'lamp', 'tower']


def passes():
    R.PASSES.clear()
    R.PASSES.update({
        'far': ({'far'}, set(), {'room'}),
        'mid': ({'mid'}, {'far', 'prop:tree'}, {'room'}),
        'fore': ({'fore'}, set(), {'room'}),
        'beauty': ({'far', 'mid'} | ALL_PROPS, set(), {'room'}),
        'light': ({'far', 'mid'} | ALL_PROPS, set(), {'room'}),
    })
    for p in PROPS:
        R.PASSES[p] = ({f'prop:{p}'}, {'mid', 'far', 'prop:tree'}, {'room'})
        R.PASSES[f'shadow_{p}'] = ({'mid'}, {f'prop:{p}', 'prop:tree', 'far'}, {'room'})
    # a soft miniature depth of field: the far end of the lawn and the backdrop go gently out of
    # focus, and so does the grass right under the lens
    R.FOCUS['far'] = (27.0, 39.0, 1.5)
    R.FOCUS['near'] = (8.0, 2.5, 3.5)


def sky_backdrop(img, s):
    """A daytime sky behind a preview render (the game draws its own, live)."""
    h, w = img.shape[:2]
    t = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    top, low = np.array([0.41, 0.67, 0.88], np.float32), np.array([0.84, 0.93, 0.96], np.float32)
    bg = np.ones_like(img)
    bg[..., :3] = top * (1 - t) + low * np.minimum(t / 0.64, 1.0) * 1.0 + 0 * t
    bg[..., :3] = top + (low - top) * np.minimum(t / 0.64, 1.0)
    return over(img, bg)


def main_park():
    o = args()
    L = json.load(open(o['layout'], encoding='utf-8'))
    scale = float(o['scale'])
    samples = int(o['samples'])
    work, out = o['work'], o['out']
    os.makedirs(work, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    setup_scene(scale, samples)
    bg = bpy.context.scene.world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = lin('#bcd8f2')
    bg.inputs['Strength'].default_value = 0.4
    passes()
    park = Park(L)
    park.build()
    lights()
    print('NOTE landings ' + json.dumps(park.notes), flush=True)
    if 'save' in o:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(o['save']))
    s = scale
    vx, vy, vw, vh = park.view
    crop = lambda a: a[int(vy * s):int((vy + vh) * s), int(vx * s):int((vx + vw) * s)]

    if o.get('beauty'):
        img = sky_backdrop(render('beauty', work, scale, samples=min(samples, 24)), s)
        save(os.path.join(work, 'beauty.png'), crop(img))
        save(os.path.join(work, 'beauty_spots.png'), crop(mark_spots(img, L, scale)))
        return

    want = o['passes'].split(',') if 'passes' in o else None
    do = lambda n: want is None or n in want
    os.makedirs(out, exist_ok=True)
    mpath = os.path.join(out, 'manifest.json')
    man = json.load(open(mpath)) if os.path.exists(mpath) else {}
    man.update({'version': 1, 'note': 'Rendered in Blender by tools/blender/felt_park.py (node tools/blender/park.mjs).',
                'frame': [W, H], 'scale': scale, 'camera': {'ortho': True, 'pitch': 7, 'yaw': 0, 'pxPerUnit': U},
                'fairy': park.fairy, 'landings': park.notes})
    man.setdefault('plates', {})
    man.setdefault('props', {})

    def crop_save(name, img, box_px=None):
        x0, y0, x1, y1 = bbox(img[..., 3]) if box_px is None else box_px
        X0, Y0 = math.floor(x0 / s), math.floor(y0 / s)
        X1, Y1 = math.ceil(x1 / s), math.ceil(y1 / s)
        save(os.path.join(out, f'{name}.png'), img[int(Y0 * s):int(Y1 * s), int(X0 * s):int(X1 * s)])
        return [X0, Y0, X1 - X0, Y1 - Y0]

    composite = {}
    zmat = depth_material()
    M = 48
    vbox = [max(0, vx - M) * s, max(0, vy - M) * s, min(W, vx + vw + M) * s, min(H, vy + vh + M) * s]
    base = None
    for name in ('far', 'mid'):
        if do(name) or (name == 'mid' and any(do(p) for p in SHADOWED)):
            raw = render(name, work, scale)
            if name == 'mid':
                base = raw
            if not do(name):
                continue
            img = dof(raw, depth_of(name, work, scale, zmat), s)
            # only the part of the plate that has something in it, within the view
            bx0, by0, bx1, by1 = bbox(img[..., 3])
            box = [max(vbox[0], bx0), max(vbox[1], by0), min(vbox[2], bx1), min(vbox[3], by1)]
            man['plates'][name] = {'file': f'{name}.png', 'box': crop_save(name, img, box)}
            composite[name] = img
    if do('fore'):
        img = blur(render('fore', work, scale), 9 * s)
        img[..., :3] *= 0.88
        man['plates']['fore'] = {'file': 'fore.png', 'box': crop_save('fore', img, vbox)}
        composite['fore'] = img
    zs = {p['id']: p['z'] for p in L['PROPS']}
    for p in PROPS:
        if not do(p):
            continue
        img = render(p, work, scale)
        img = dof(img, depth_of(p, work, scale, zmat), s)
        cut = img
        if p in SHADOWED:
            x0, y0, x1, y1 = bbox(img[..., 3], pad=int(70 * s))
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
            sh[..., :3] = (0.07, 0.16, 0.1)     # shadows on grass are deep green, not black
            sh[..., 3] = np.clip(k * 1.15, 0, 0.8)
            cut = over(img, sh)
        man['props'][p] = {'file': f'{p}.png', 'z': zs.get(p, 900), 'box': crop_save(p, cut)}
        composite[p] = cut
    if do('light'):
        white = bpy.data.materials.new('White')
        white.use_nodes = True
        bsdf(white).inputs['Base Color'].default_value = (0.8, 0.8, 0.8, 1)
        setin(bsdf(white), 'Sheen Weight', 0.0)
        setin(bsdf(white), 'Specular IOR Level', 0.0)
        img = render('light', work, scale, res=(192, 108), samples=16, override=white)
        # the open sky is see-through in the render: fill it with full daylight
        day = np.array([1.0, 0.97, 0.9], np.float32) * np.percentile(lum(img[img[..., 3] > 0.5]), 90)
        rgb = img[..., :3] * img[..., 3:4] + day * (1 - img[..., 3:4])
        small = rgb.reshape(54, 2, 96, 2, 3).mean((1, 3))
        l = lum(small)
        ref = np.percentile(l, 80)
        v = np.clip(l / max(ref, 1e-3), 0.55, 1.0)
        tint = small / np.maximum(l[..., None], 1e-3)
        tint = tint / np.maximum(tint.max(-1, keepdims=True), 1.0)
        lm = np.clip(tint * v[..., None], 0, 1)
        save(os.path.join(out, 'lightmap.png'), np.dstack([lm, np.ones((54, 96), np.float32)]))
        man['lightmap'] = 'lightmap.png'
    with open(mpath, 'w') as f:
        json.dump(man, f, indent=2)
    print('WROTE manifest.json', flush=True)
    if {'far', 'mid'} <= composite.keys():
        img = over(composite['mid'], composite['far'])
        for p in sorted((p for p in PROPS if p in composite), key=lambda p: zs.get(p, 900)):
            img = over(composite[p], img)
        if 'fore' in composite:
            img = over(composite['fore'], img)
        img = sky_backdrop(img, s)
        save(os.path.join(work, 'view.png'), crop(img))
        save(os.path.join(work, 'view_spots.png'), crop(mark_spots(img, L, s)))


main_park()
