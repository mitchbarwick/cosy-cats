// Procedural cat rig: poses, looks and drawing. Everything is drawn in cat-local space
// facing right, origin at the feet, y negative is up. Size ~140 units tall when sitting.
import { lerp, clamp, shade, rgba, fibreCanvas, radial, linear, makeRng } from './util.js';

// ---------------------------------------------------------------------------
// Cat looks
// ---------------------------------------------------------------------------
export const CAT_DEFS = [
  { name: 'Biscuit', fur: '#eba25e', belly: '#f8dfb8', stripe: '#c46a33', pattern: 'tabby', eye: '#8fbf5a',
    acc: { type: 'scarf', color: '#5f8fb8', color2: '#f1e4c8' }, size: 1.04, voice: { pitch: 520, len: 0.75, bright: 1 } },
  { name: 'Pepper', fur: '#35303a', belly: '#f6f0e6', pattern: 'tux', eye: '#e8c450',
    acc: { type: 'collar', color: '#c84c45', bell: true }, size: 0.98, voice: { pitch: 470, len: 0.6, bright: 0.9 } },
  { name: 'Mochi', fur: '#f7f1e8', belly: '#ffffff', pattern: 'longhair', eye: '#7fb4e0', eye2: '#e3b04a',
    acc: { type: 'bow', color: '#f19aac' }, size: 0.92, voice: { pitch: 760, len: 0.45, bright: 1.2 } },
  { name: 'Clover', fur: '#f5ecdf', belly: '#fffaf2', patchA: '#e2954e', patchB: '#4b3b35', pattern: 'calico', eye: '#86b86a',
    acc: { type: 'collar', color: '#f2c46d', flower: true }, size: 0.96, voice: { pitch: 620, len: 0.55, bright: 1.1 } },
  { name: 'Earl Grey', fur: '#9ea4ae', belly: '#d9dce2', stripe: '#6b717c', pattern: 'tabbyLong', eye: '#e2a84a',
    acc: { type: 'scarf', color: '#d4a04a', color2: '#b5534a' }, size: 1.12, voice: { pitch: 400, len: 0.9, bright: 0.8 } },
  { name: 'Juniper', fur: '#f0e2c9', belly: '#f7eedc', points: '#5c4234', pattern: 'siamese', eye: '#6fb1e3',
    acc: { type: 'collar', color: '#3f8f88', bell: true }, size: 0.95, voice: { pitch: 660, len: 0.85, bright: 1.15 } },
  { name: 'Inky', fur: '#2b2731', belly: '#3a3542', pattern: 'solid', eye: '#f0c84a',
    acc: { type: 'bow', color: '#a98bd6' }, size: 0.94, voice: { pitch: 580, len: 0.5, bright: 1 } },
  { name: 'Toffee', fur: '#ad8058', belly: '#e8d2b4', stripe: '#6d4930', pattern: 'tabby', eye: '#9cc56a',
    acc: { type: 'bandana', color: '#c0504a' }, size: 1.0, voice: { pitch: 500, len: 0.65, bright: 0.95 } },
  { name: 'Pumpkin', fur: '#3d2c27', belly: '#4a3830', patchA: '#d0763b', patchB: '#e9a565', pattern: 'tortie', eye: '#e6a43f',
    acc: { type: 'collar', color: '#6f9e98', bell: true }, size: 0.97, voice: { pitch: 560, len: 0.7, bright: 1 } },
  { name: 'Bluebell', fur: '#8a95a8', belly: '#a9b2c2', pattern: 'solid', eye: '#9fd27a',
    acc: { type: 'collar', color: '#f19aac', flower: true }, size: 1.0, voice: { pitch: 640, len: 0.6, bright: 1.05 } },
];

// Toby, a white French bulldog: the last visitor, who only comes once every cat is here.
export const TOBY = {
  name: 'Toby', species: 'dog', fur: '#f7f3ec', belly: '#ffffff', pattern: 'solid', eye: '#f0b429',
  acc: { type: 'collar', color: '#4f72a0' }, size: 1.12, voice: { dog: true, pitch: 150, len: 0.4, bright: 1 },
};
export const ANIMAL_DEFS = [...CAT_DEFS, TOBY];

// Per-animal changes to a pose: a French bulldog is stockier, with thick legs and a stub of a
// tail. Shared by the live rig and the Blender exporter so both draw the same animal.
export function shapeFor(def, p) {
  if (def.species !== 'dog') return p;
  p.chest[2] *= 1.1; p.chest[3] *= 1.04;
  p.body[3] *= 1.06; p.haunch[2] *= 1.05;
  for (const l of p.legs) l[4] *= 1.32;
  for (const i of [0, 2]) { p.legs[i][0] += 6; p.legs[i][2] += 9; } // front legs set forward, under a broad chest
  p.head[2] *= 1.06;
  const [bx, by] = p.tail;
  for (const i of [2, 4, 6]) { p.tail[i] = bx + (p.tail[i] - bx) * 0.13; p.tail[i + 1] = by + (p.tail[i + 1] - by) * 0.13; }
  p.tail[8] *= 1.6;
  p.tail[9] = 0;
  return p;
}

// ---------------------------------------------------------------------------
// Poses
// legs: [hipX, hipY, footX, footY, width, visible] in order FF, BF, FN, BN (far/near)
// tail: [bx, by, c1x, c1y, c2x, c2y, tx, ty, width, inFront]
// ---------------------------------------------------------------------------
const P = {
  sit: {
    haunch: [-12, -34, 40, 34], body: [-2, -58, 28, 38, -0.25], chest: [12, -62, 25, 30], head: [16, -108, 35, 0],
    legs: [[6, -50, 6, -5, 13, 1], [-28, -16, -18, -5, 12, 0], [18, -50, 22, -5, 14, 1], [-10, -24, 4, -5, 14, 0]],
    tail: [-46, -16, -76, -4, -48, 10, 10, 1, 13, 1], face: [0.3, 1],
  },
  walk: {
    haunch: [-30, -52, 28, 27], body: [0, -56, 44, 25, 0], chest: [30, -58, 25, 26], head: [56, -88, 33, 0],
    legs: [[30, -48, 32, -4, 12, 1], [-28, -46, -30, -4, 12, 1], [38, -48, 40, -4, 13, 1], [-34, -46, -36, -4, 13, 1]],
    tail: [-56, -64, -86, -80, -72, -130, -88, -142, 12, 0], face: [0.55, 1],
  },
  loaf: {
    haunch: [-26, -27, 32, 27], body: [0, -29, 46, 28, 0], chest: [26, -28, 26, 26], head: [44, -62, 33, 0],
    legs: [[34, -12, 40, -4, 11, 0], [-30, -12, -24, -4, 11, 0], [40, -12, 48, -4, 12, 1], [-30, -12, -24, -4, 12, 0]],
    tail: [-54, -14, -68, 4, -20, 8, 26, 0, 12, 1], face: [0.3, 1],
  },
  sleep: {
    haunch: [-20, -27, 36, 27], body: [0, -30, 44, 28, 0.05], chest: [20, -24, 26, 22], head: [38, -36, 31, 0.28],
    legs: [[40, -10, 48, -4, 11, 0], [-30, -12, -24, -4, 11, 0], [44, -10, 54, -5, 11, 1], [-30, -12, -24, -4, 12, 0]],
    tail: [-54, -12, -64, 10, -4, 12, 46, 0, 12, 1], face: [0.25, 0],
  },
  crouch: {
    haunch: [-22, -32, 32, 28], body: [4, -36, 44, 24, 0.12], chest: [30, -34, 25, 24], head: [52, -60, 33, 0],
    legs: [[30, -28, 38, -4, 12, 1], [-24, -26, -12, -4, 12, 1], [36, -28, 44, -4, 13, 1], [-28, -26, -14, -4, 13, 1]],
    tail: [-52, -40, -80, -44, -100, -34, -120, -22, 12, 0], face: [0.6, 1],
  },
  jump: {
    haunch: [-34, -60, 28, 24], body: [0, -66, 48, 22, -0.18], chest: [32, -74, 24, 23], head: [58, -100, 32, 0],
    legs: [[32, -66, 64, -60, 12, 1], [-32, -56, -72, -40, 12, 1], [38, -66, 70, -56, 13, 1], [-36, -56, -78, -44, 13, 1]],
    tail: [-58, -64, -90, -72, -112, -68, -134, -62, 12, 0], face: [0.6, 1],
  },
};
P.groom = clonePose(P.sit, (p) => {
  p.head = [20, -104, 35, 0.28];
  p.legs[2] = [18, -52, 34, -88, 14, 1];
  p.face = [0.55, 0.12];
});
P.look = clonePose(P.sit, (p) => { p.face = [0, 1]; });
P.nuzzle = clonePose(P.sit, (p) => { p.head = [30, -102, 35, 0.22]; p.face = [0.7, 0.1]; });
P.bat = clonePose(P.sit, (p) => {
  p.haunch = [-16, -30, 38, 30]; p.body = [2, -50, 30, 34, -0.45]; p.chest = [18, -52, 25, 28];
  p.head = [26, -94, 35, 0.1];
  p.legs[2] = [22, -44, 56, -20, 14, 1];
  p.face = [0.7, 1];
});
P.stand = clonePose(P.walk, (p) => { p.tail = [-56, -64, -84, -84, -66, -128, -80, -138, 12, 0]; });
// nose down, investigating the spot
P.sniff = clonePose(P.walk, (p) => {
  p.head = [60, -60, 33, 0.3];
  p.chest = [30, -52, 25, 25];
  p.tail = [-56, -62, -82, -76, -76, -112, -92, -118, 12, 0];
  p.face = [0.75, 0.75];
});
// paws pressing the blanket before lying down
P.knead = {
  haunch: [-22, -28, 32, 28], body: [2, -38, 42, 26, -0.14], chest: [26, -44, 25, 27], head: [44, -80, 33, 0],
  legs: [[28, -36, 34, -5, 12, 1], [-30, -12, -24, -4, 11, 0], [36, -36, 42, -5, 13, 1], [-30, -12, -24, -4, 12, 0]],
  tail: [-50, -30, -78, -40, -84, -72, -72, -90, 12, 0], face: [0.4, 0.25],
};
// long play-bow stretch: rump up, front paws forward
P.stretch = {
  haunch: [-34, -60, 28, 26], body: [0, -46, 44, 22, 0.38], chest: [32, -30, 24, 21], head: [58, -44, 33, -0.12],
  legs: [[28, -26, 64, -5, 12, 1], [-28, -52, -30, -4, 12, 1], [34, -26, 74, -5, 13, 1], [-34, -52, -38, -4, 13, 1]],
  tail: [-58, -70, -78, -104, -64, -146, -80, -156, 12, 0], face: [0.5, 0.15, 0.9],
};
// ears up, head raised: "what was that?"
P.alert = clonePose(P.sit, (p) => { p.head = [18, -114, 35, -0.08]; p.face = [0.05, 1]; });
P.yawn = clonePose(P.sit, (p) => { p.head = [14, -110, 35, -0.18]; p.face = [0.2, 0, 1]; });
// lying down but awake, eyes sleepy
P.wake = clonePose(P.loaf, (p) => { p.head = [42, -60, 33, 0.08]; p.face = [0.3, 0.5]; });
// sitting up tall, eyes front: paying attention while the teacher talks (drawn face-on)
P.attend = clonePose(P.sit, (p) => { p.head = [14, -114, 35, 0]; p.face = [0, 1]; });

function clonePose(src, fn) {
  const p = JSON.parse(JSON.stringify(src));
  fn(p);
  return p;
}

// ---------------------------------------------------------------------------
// Dog poses: Toby keeps the cats' pose names where the behaviour is the same idea (sit, loaf,
// sleep, attend…) but holds them like a French bulldog, plus a few things only a dog does.
// shapeFor() then gives him his stocky build and stub tail.
// ---------------------------------------------------------------------------
const D = { ...P };
// upright puppy sit: chest out, near back leg splayed forward
D.sit = {
  haunch: [-10, -32, 38, 32], body: [0, -58, 27, 36, -0.2], chest: [14, -64, 26, 30], head: [18, -112, 35, 0],
  legs: [[8, -50, 8, -5, 13, 1], [-26, -14, -14, -5, 12, 0], [20, -50, 24, -5, 14, 1], [-14, -20, 0, -5, 14, 1]],
  tail: [-46, -16, -66, -14, -76, -10, -84, -6, 13, 0], face: [0.3, 1],
};
D.walk = clonePose(P.walk, (p) => { p.head = [54, -84, 33, 0]; p.tail = [-56, -64, -78, -76, -92, -80, -104, -82, 12, 0]; });
D.stand = clonePose(D.walk, (p) => { p.head = [56, -90, 33, 0]; p.face = [0.5, 1]; });
// nose down along the floor while trotting in
D.sniffWalk = clonePose(D.walk, (p) => { p.head = [62, -54, 33, 0.28]; p.chest = [30, -50, 25, 25]; p.face = [0.75, 0.7]; });
D.sniff = clonePose(D.sniffWalk, (p) => { p.head = [64, -48, 33, 0.32]; });
// the frog splat: flat on his belly, back legs straight out behind, chin up
D.loaf = {
  haunch: [-24, -22, 30, 22], body: [0, -24, 46, 22, 0], chest: [26, -24, 26, 22], head: [48, -54, 33, 0],
  legs: [[34, -12, 54, -5, 11, 1], [-30, -12, -74, -6, 11, 1], [40, -12, 60, -5, 12, 1], [-32, -12, -80, -6, 12, 1]],
  tail: [-50, -28, -60, -36, -66, -40, -72, -44, 12, 0], face: [0.3, 1],
};
D.wake = clonePose(D.loaf, (p) => { p.head = [46, -50, 33, 0.1]; p.face = [0.3, 0.5]; });
// fast asleep on his back, paws in the air, head rolled to one side
D.sleep = {
  haunch: [-22, -26, 30, 24], body: [0, -28, 44, 24, 0], chest: [24, -28, 26, 22], head: [46, -34, 32, 1.05],
  legs: [[24, -38, 32, -64, 11, 1], [-24, -34, -18, -60, 11, 1], [30, -38, 42, -62, 12, 1], [-30, -36, -28, -64, 12, 1]],
  tail: [-52, -22, -62, -18, -70, -14, -78, -10, 12, 0], face: [0.2, 0],
};
// play bow: elbows down, rump up, grinning at whoever he wants to play with
D.bow = {
  haunch: [-34, -60, 28, 26], body: [0, -44, 44, 22, 0.42], chest: [30, -26, 25, 20], head: [56, -44, 33, -0.15],
  legs: [[26, -22, 58, -5, 12, 1], [-28, -52, -30, -4, 12, 1], [32, -22, 68, -5, 13, 1], [-34, -52, -38, -4, 13, 1]],
  tail: [-58, -72, -66, -86, -70, -96, -74, -106, 12, 0], face: [0.45, 1, 0.5],
};
D.stretch = D.bow;
// whole-body wag: standing tall, mouth open, the wiggle is animated
D.wag = clonePose(D.stand, (p) => { p.head = [56, -94, 33, -0.05]; p.face = [0.45, 1, 0.45]; });
D.shake = D.stand;
D.alert = clonePose(D.sit, (p) => { p.head = [18, -118, 35, -0.1]; p.face = [0.05, 1]; });
D.look = clonePose(D.sit, (p) => { p.face = [0, 1]; });
D.yawn = clonePose(D.sit, (p) => { p.head = [14, -112, 35, -0.2]; p.face = [0.2, 0, 1]; });
D.nuzzle = clonePose(D.sit, (p) => { p.head = [32, -104, 35, 0.15]; p.face = [0.7, 0.6]; });
// "hm?": the curious head tilt
D.tilt = clonePose(D.sit, (p) => { p.head = [18, -114, 35, 0.4]; p.face = [0.1, 1]; });
// scratching an ear with a back foot, eyes half shut
D.scratch = clonePose(D.sit, (p) => {
  p.body = [0, -56, 28, 36, -0.3]; p.head = [16, -104, 35, 0.34];
  p.legs[3] = [-8, -30, 18, -86, 14, 1];
  p.face = [0.4, 0.3, 0.25];
});
// a sneeze: eyes screwed shut
D.sneeze = clonePose(D.sit, (p) => { p.face = [0.35, 0]; }); // the wind-up and snap are animated
// paying attention: sitting tall facing the room, head cocked
D.attend = clonePose(D.sit, (p) => { p.head = [14, -116, 35, 0.18]; p.face = [0, 1]; });

// Swing a tail round its base (a dog's stub tail wags; a rotation survives shapeFor's shrink).
export function wagTail(p, a) {
  const [bx, by] = p.tail, c = Math.cos(a), s = Math.sin(a);
  for (const i of [2, 4, 6]) {
    const x = p.tail[i] - bx, y = p.tail[i + 1] - by;
    p.tail[i] = bx + x * c - y * s; p.tail[i + 1] = by + x * s + y * c;
  }
  return p;
}

export const POSE_NAMES = Object.keys(P);

// Flatten / unflatten so poses can be smoothed numerically.
// face = [turn, eyesOpen, mouthOpen]
export function flat(p) {
  const face = [p.face[0], p.face[1], p.face[2] || 0];
  return [...p.haunch, ...p.body, ...p.chest, ...p.head, ...p.legs.flat(), ...p.tail, ...face];
}
export function unflat(a) {
  let i = 0;
  const take = (n) => { const r = a.slice(i, i + n); i += n; return r; };
  const p = { haunch: take(4), body: take(5), chest: take(4), head: take(4), legs: [] };
  for (let k = 0; k < 4; k++) p.legs.push(take(6));
  p.tail = take(10);
  p.face = take(3);
  return p;
}

// Turning: rather than mirroring with a squash, positions are pulled toward the centre line
// (radii untouched) so mid-turn the cat is seen face-on, like a real cat turning round.
export function applyTurn(p, f) {
  const k = Math.abs(f);
  const spread = (1 - k) * 10;
  p.haunch[0] *= k; p.chest[0] *= k; p.head[0] *= k;
  p.body[0] *= k; p.body[4] *= k;
  p.legs.forEach((l, i) => {
    const side = i < 2 ? -1 : 1; // far legs to one side, near legs to the other when face-on
    l[0] = l[0] * k + side * spread;
    l[2] = l[2] * k + side * spread;
  });
  for (const i of [0, 2, 4, 6]) p.tail[i] *= k;
  p.face[0] *= k;
  // face-on: the body reads rounder
  p.body[2] = Math.max(p.body[2] * (0.6 + 0.4 * k), p.body[3]);
  return p;
}
export const POSE_FLAT = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, flat(v)]));
export const DOG_POSE_FLAT = Object.fromEntries(Object.entries(D).map(([k, v]) => [k, flat(v)]));
// the pose table an animal is drawn from
export const posesFor = (def) => (def.species === 'dog' ? DOG_POSE_FLAT : POSE_FLAT);

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------
let fibrePat = null;
function fibre(ctx) {
  if (!fibrePat || fibrePat.ctx !== ctx) fibrePat = { ctx, pat: ctx.createPattern(fibreCanvas(), 'repeat') };
  return fibrePat.pat;
}

function ell(ctx, x, y, rx, ry, rot = 0) {
  ctx.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot));
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2);
}

function bodyPath(ctx, p) {
  ctx.beginPath();
  ell(ctx, p.haunch[0], p.haunch[1], p.haunch[2], p.haunch[3]);
  ell(ctx, p.body[0], p.body[1], p.body[2], p.body[3], p.body[4]);
  ell(ctx, p.chest[0], p.chest[1], p.chest[2], p.chest[3]);
}

function headPath(ctx, p, fluffy, dog) {
  const [hx, hy, r] = p.head;
  ctx.beginPath();
  if (dog) {
    // broad square skull with heavy jowls
    ell(ctx, hx, hy - r * 0.06, r * 1.12, r * 0.9);
    ell(ctx, hx - r * 0.44, hy + r * 0.34, r * 0.58, r * 0.46);
    ell(ctx, hx + r * 0.44, hy + r * 0.34, r * 0.58, r * 0.46);
    return;
  }
  ell(ctx, hx, hy - r * 0.04, r * 1.08, r * 0.9);
  ell(ctx, hx - r * 0.52, hy + r * 0.26, r * 0.58, r * 0.48);
  ell(ctx, hx + r * 0.52, hy + r * 0.26, r * 0.58, r * 0.48);
  if (fluffy) {
    for (const s of [-1, 1]) {
      ctx.moveTo(hx + s * r * 0.95, hy + r * 0.05);
      ctx.lineTo(hx + s * r * 1.32, hy + r * 0.28);
      ctx.lineTo(hx + s * r * 1.02, hy + r * 0.36);
      ctx.lineTo(hx + s * r * 1.26, hy + r * 0.56);
      ctx.lineTo(hx + s * r * 0.8, hy + r * 0.62);
      ctx.closePath();
    }
  }
}

function bez(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}
function tailPoint(tl, t) {
  return [bez(tl[0], tl[2], tl[4], tl[6], t), bez(tl[1], tl[3], tl[5], tl[7], t)];
}

function strokeTail(ctx, tl, w, col, t0 = 0, t1 = 1) {
  // tapered tail: series of segments with decreasing width
  const N = 14;
  ctx.strokeStyle = col;
  ctx.lineCap = 'round';
  let prev = tailPoint(tl, t0);
  for (let i = 1; i <= N; i++) {
    const t = lerp(t0, t1, i / N);
    const pt = tailPoint(tl, t);
    ctx.lineWidth = w * (1 - t * 0.35);
    ctx.beginPath();
    ctx.moveTo(prev[0], prev[1]);
    ctx.lineTo(pt[0], pt[1]);
    ctx.stroke();
    prev = pt;
  }
}

function leg(ctx, l, col, outline, ow, sock) {
  const [hx, hy, fx, fy, w] = l;
  ctx.lineCap = 'round';
  // outline only on the lower part so the leg blends into the body
  const mx = lerp(hx, fx, 0.35), my = lerp(hy, fy, 0.35);
  ctx.strokeStyle = outline;
  ctx.lineWidth = w + ow * 2;
  ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(fx, fy - 2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(fx + w * 0.18, fy - 2, w * 0.66 + ow, w * 0.44 + ow, 0, 0, Math.PI * 2);
  ctx.fillStyle = outline; ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(fx, fy - 2); ctx.stroke();
  if (sock) {
    ctx.strokeStyle = sock;
    ctx.beginPath(); ctx.moveTo(lerp(hx, fx, 0.62), lerp(hy, fy, 0.62)); ctx.lineTo(fx, fy - 2); ctx.stroke();
  }
  ctx.fillStyle = sock || col;
  ctx.beginPath(); ctx.ellipse(fx + w * 0.18, fy - 2, w * 0.66, w * 0.44, 0, 0, Math.PI * 2); ctx.fill();
  // toe beans hint
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(fx + w * 0.3, fy - 5); ctx.lineTo(fx + w * 0.3, fy); ctx.stroke();
}

// Per-cat cached random blobs for mottled coats.
const mottleCache = new Map();
export function mottle(def) {
  if (!mottleCache.has(def.name)) {
    const r = makeRng(def.name.length * 97 + def.name.charCodeAt(0));
    const blobs = [];
    for (let i = 0; i < 16; i++) blobs.push([r.range(-70, 70), r.range(-130, -5), r.range(8, 20), r.range(6, 14), r(), r() > 0.6]);
    mottleCache.set(def.name, blobs);
  }
  return mottleCache.get(def.name);
}

// ---------------------------------------------------------------------------
// Main draw
// ---------------------------------------------------------------------------
export function drawCat(ctx, def, p, opts) {
  const { t, blink = 1, lookX = 0, earFlick = 0, alert = 0 } = opts;
  const fur = def.fur;
  const dark = def.fur === '#2b2731' || def.fur === '#35303a' || def.fur === '#3d2c27';
  const outline = dark ? '#16121a' : shade(fur, -0.38);
  const ow = 2.6;
  const farCol = shade(fur, -0.18);
  const long = def.pattern === 'longhair' || def.pattern === 'tabbyLong';
  const points = def.pattern === 'siamese' ? def.points : null;
  const socks = def.pattern === 'tux' ? def.belly : null;
  const legCol = points || fur;
  const farLegCol = points ? shade(points, -0.15) : farCol;
  const tailW = p.tail[8] * (long ? 1.6 : 1);
  const tail = p.tail;
  const tailFront = tail[9] > 0.5;
  const tailCol = points || (def.pattern === 'calico' ? def.patchA : fur);

  const drawTail = () => {
    strokeTail(ctx, tail, tailW + ow * 2, outline);
    strokeTail(ctx, tail, tailW, tailCol);
    if (def.pattern === 'tabby' || def.pattern === 'tabbyLong') {
      ctx.strokeStyle = rgba(def.stripe, 0.85);
      ctx.lineWidth = 4;
      for (let s = 0.25; s < 0.95; s += 0.17) {
        const a = tailPoint(tail, s), b = tailPoint(tail, s + 0.02);
        const nx = -(b[1] - a[1]), ny = b[0] - a[0];
        const nl = Math.hypot(nx, ny) || 1;
        const hw = tailW * 0.45 * (1 - s * 0.35);
        ctx.beginPath();
        ctx.moveTo(a[0] + (nx / nl) * hw, a[1] + (ny / nl) * hw);
        ctx.lineTo(a[0] - (nx / nl) * hw, a[1] - (ny / nl) * hw);
        ctx.stroke();
      }
    }
    if (def.pattern === 'tux' || def.pattern === 'calico') strokeTail(ctx, tail, tailW * 0.8, def.pattern === 'tux' ? def.belly : def.patchB, 0.86, 1);
    if (long) {
      ctx.globalAlpha = 0.5;
      strokeTail(ctx, tail, tailW * 0.45, shade(fur, 0.25), 0.1, 0.95);
      ctx.globalAlpha = 1;
    }
  };

  // far legs
  for (const i of [0, 1]) if (p.legs[i][5] > 0.5) leg(ctx, p.legs[i], farLegCol, outline, ow, socks ? shade(socks, -0.1) : null);
  if (!tailFront) drawTail();

  // body
  bodyPath(ctx, p);
  fuzzyEdge(ctx, outline, ow);
  ctx.fillStyle = fur;
  ctx.fill();

  ctx.save();
  bodyPath(ctx, p);
  ctx.clip();
  drawBodyPattern(ctx, def, p);
  // volume shading
  const top = Math.min(p.haunch[1] - p.haunch[3], p.body[1] - p.body[3], p.chest[1] - p.chest[3]);
  ctx.fillStyle = linear(ctx, 0, top, 0, 0, [[0, 'rgba(255,248,235,0.28)'], [0.45, 'rgba(255,248,235,0)'], [1, 'rgba(40,20,10,0.32)']]);
  ctx.fillRect(-120, top - 5, 240, -top + 10);
  ctx.fillStyle = radial(ctx, p.haunch[0] - 10, p.haunch[1] - 14, p.haunch[2] * 1.3, [[0, 'rgba(255,250,240,0.18)'], [1, 'rgba(255,250,240,0)']]);
  ctx.fillRect(-120, top - 5, 240, -top + 10);
  // the head casts a soft shadow onto the chest
  const [hx0, hy0, hr0] = p.head;
  ctx.fillStyle = radial(ctx, hx0, hy0 + hr0 * 0.9, hr0 * 1.1, [[0, 'rgba(40,20,10,0.32)'], [1, 'rgba(40,20,10,0)']]);
  ctx.fillRect(hx0 - hr0 * 1.2, hy0, hr0 * 2.4, hr0 * 2.2);
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = fibre(ctx);
  ctx.fillRect(-120, top - 5, 240, -top + 10);
  ctx.restore();

  // longhair chest ruff
  if (long) {
    const [cx, cy, crx, cry] = p.chest;
    ctx.fillStyle = shade(def.belly, 0.1);
    ctx.beginPath();
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI * 0.35 + (i / n) * Math.PI * 0.9;
      const rr1 = i % 2 ? 0.95 : 1.12;
      const x = cx + Math.cos(a) * crx * rr1 + 4, y = cy - cry * 0.3 + Math.sin(a) * cry * rr1;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.75;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // near legs
  for (const i of [3, 2]) if (p.legs[i][5] > 0.5) leg(ctx, p.legs[i], legCol, outline, ow, socks);
  if (tailFront) drawTail();

  // head (neckwear sits under the chin, bows on top of the head)
  if (def.acc && def.acc.type !== 'bow') drawAccessory(ctx, def, p, outline);
  drawHead(ctx, def, p, { t, blink, lookX, earFlick, alert, outline, ow, long, points });
  if (def.acc && def.acc.type === 'bow') drawAccessory(ctx, def, p, outline);
}

// Soft, slightly ragged outline so silhouettes read like felt rather than vector art.
function fuzzyEdge(ctx, outline, ow) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = outline;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = ow * 2 + 3;
  ctx.setLineDash([1.5, 2.6]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = ow * 2;
  ctx.stroke();
  ctx.restore();
}

function drawBodyPattern(ctx, def, p) {
  const [bx, by, brx, bry, brot] = p.body;
  const [hx, hy, hrx, hry] = p.haunch;
  const [cx, cy, crx, cry] = p.chest;
  switch (def.pattern) {
    case 'tabby':
    case 'tabbyLong': {
      ctx.strokeStyle = rgba(def.stripe, def.pattern === 'tabbyLong' ? 0.6 : 0.85);
      ctx.lineCap = 'round';
      ctx.lineWidth = 7;
      // haunch swirl
      ctx.beginPath(); ctx.ellipse(hx - 4, hy + 2, hrx * 0.45, hry * 0.42, 0, Math.PI * 0.9, Math.PI * 2.3); ctx.stroke();
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.ellipse(hx - 4, hy + 2, hrx * 0.78, hry * 0.76, 0, Math.PI * 1.0, Math.PI * 1.9); ctx.stroke();
      // body bands across the minor axis
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(brot);
      ctx.lineWidth = 6;
      const vertical = brx > bry;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        if (vertical) {
          ctx.moveTo(i * 16, -bry - 4);
          ctx.quadraticCurveTo(i * 16 + 8, -bry * 0.2, i * 16 + 2, bry * 0.4);
        } else {
          ctx.moveTo(-brx - 4, i * 15);
          ctx.quadraticCurveTo(-brx * 0.2, i * 15 + 7, brx * 0.2, i * 15 + 2);
        }
        ctx.stroke();
      }
      ctx.restore();
      // pale belly / chest
      ctx.fillStyle = rgba(def.belly, 0.75);
      ctx.beginPath(); ctx.ellipse(cx + crx * 0.45, cy + cry * 0.25, crx * 0.55, cry * 0.75, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'tux':
      ctx.fillStyle = def.belly;
      ctx.beginPath();
      ctx.ellipse(cx + crx * 0.42, cy + cry * 0.2, crx * 0.62, cry * 0.95, 0.1, 0, Math.PI * 2);
      ctx.ellipse(bx + brx * 0.2, by + bry * 0.7, brx * 0.55, bry * 0.42, brot, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'calico':
      ctx.fillStyle = def.patchA;
      ctx.beginPath(); ctx.ellipse(hx - 8, hy - hry * 0.4, hrx * 0.75, hry * 0.6, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = def.patchB;
      ctx.beginPath(); ctx.ellipse(bx + brx * 0.1, by - bry * 0.6, brx * 0.5, bry * 0.42, brot + 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(hx + hrx * 0.4, hy - hry * 0.7, hrx * 0.28, hry * 0.22, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = def.patchA;
      ctx.beginPath(); ctx.ellipse(bx - brx * 0.4, by - bry * 0.7, brx * 0.3, bry * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      break;
    case 'tortie':
      for (const [x, y, rx, ry, c, alt] of mottle(def)) {
        ctx.fillStyle = rgba(alt ? def.patchB : def.patchA, 0.85);
        ctx.beginPath(); ctx.ellipse(x, y, rx, ry, c * 3, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case 'siamese': {
      // gentle darkening toward the rear and legs
      ctx.fillStyle = radial(ctx, hx - hrx * 0.5, hy + hry * 0.3, hrx * 1.4, [[0, rgba(def.points, 0.55)], [1, rgba(def.points, 0)]]);
      ctx.fillRect(hx - hrx * 2, hy - hry * 2, hrx * 4, hry * 4);
      break;
    }
    case 'solid':
    case 'longhair':
    default:
      ctx.fillStyle = rgba(def.belly, 0.45);
      ctx.beginPath(); ctx.ellipse(cx + crx * 0.4, cy + cry * 0.25, crx * 0.55, cry * 0.75, 0, 0, Math.PI * 2); ctx.fill();
  }
}

// A French bulldog's bat ear, base centred on the origin, pointing up (-y) to a rounded tip.
function batEar(ctx, w, h) {
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.bezierCurveTo(-w * 1.02, -h * 0.45, -w * 0.72, -h * 0.8, -w * 0.4, -h * 0.94);
  ctx.bezierCurveTo(-w * 0.18, -h * 1.04, w * 0.18, -h * 1.04, w * 0.4, -h * 0.94);
  ctx.bezierCurveTo(w * 0.72, -h * 0.8, w * 1.02, -h * 0.45, w, 0);
  ctx.quadraticCurveTo(0, h * 0.2, -w, 0);
  ctx.closePath();
}

function drawHead(ctx, def, p, o) {
  const [hx, hy, r, tilt] = p.head;
  const turn = clamp(p.face[0] + o.lookX, -1, 1);
  const eyesOpen = Math.min(p.face[1], o.blink);
  const fur = def.fur;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(tilt);
  ctx.translate(-hx, -hy);

  const fx = hx + turn * r * 0.3;
  const earShift = turn * r * 0.16;
  const earCol = o.points || fur;
  // ears
  // ear flick: the near ear snaps sideways and back; alert: both ears up and forward
  const flick = Math.sin(clamp(o.earFlick || 0, 0, 1) * Math.PI);
  const perk = o.alert || 0;
  const dog = def.species === 'dog';
  if (dog) {
    // big upright bat ears: wide at the base, tapering to a softly rounded point
    for (const s of [-1, 1]) {
      const ex = hx + earShift + s * r * 0.6;
      const ey = hy - r * (0.6 + perk * 0.05);
      const rot = s * (0.3 - perk * 0.1) + (s > 0 ? flick * 0.45 : 0);
      ctx.save();
      ctx.translate(ex, ey); ctx.rotate(rot);
      batEar(ctx, r * 0.48, r * 1.04);
      fuzzyEdge(ctx, o.outline, o.ow);
      ctx.fillStyle = fur; ctx.fill();
      ctx.fillStyle = 'rgba(240,165,165,0.9)';
      ctx.translate(0, -r * 0.04);
      batEar(ctx, r * 0.29, r * 0.82);
      ctx.fill();
      ctx.restore();
    }
  }
  for (const s of dog ? [] : [-1, 1]) {
    const bx = hx + earShift + s * r * 0.56;
    const by = hy - r * 0.5;
    const tx = hx + earShift * 1.4 + s * r * (0.86 - perk * 0.08) + (s > 0 ? flick * r * 0.3 : 0);
    const ty = hy - r * (1.28 + perk * 0.1) + (s > 0 ? flick * r * 0.32 : 0);
    const ear = (shrink) => {
      ctx.beginPath();
      ctx.moveTo(bx - s * r * 0.42 * shrink + s * r * 0.08 * (1 - shrink), by + r * 0.08);
      ctx.quadraticCurveTo(lerp(bx, tx, 0.5) - s * r * 0.2 * shrink, lerp(by, ty, 0.5), lerp(bx, tx, 0.92 - (1 - shrink) * 0.18), lerp(by, ty, 0.92 - (1 - shrink) * 0.18));
      ctx.quadraticCurveTo(tx + s * r * 0.04, ty + r * 0.04, lerp(tx, bx + s * r * 0.36, 0.1), lerp(ty, by, 0.12));
      ctx.quadraticCurveTo(bx + s * r * 0.4 * shrink, lerp(by, ty, 0.35), bx + s * r * 0.34 * shrink, by + r * 0.14);
      ctx.closePath();
    };
    ear(1);
    ctx.strokeStyle = o.outline; ctx.lineWidth = o.ow * 2; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.fillStyle = def.pattern === 'calico' ? (s < 0 ? def.patchA : def.patchB) : earCol;
    ctx.fill();
    ear(0.55);
    ctx.fillStyle = o.points ? shade(o.points, 0.25) : 'rgba(240,160,160,0.9)';
    ctx.fill();
    if (o.long) {
      ctx.strokeStyle = shade(fur, 0.3, 0.8); ctx.lineWidth = 1.5;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(bx + s * k * 3, by); ctx.lineTo(lerp(bx, tx, 0.6) + s * k * 2, lerp(by, ty, 0.6)); ctx.stroke(); }
    }
  }

  // head shape
  headPath(ctx, p, o.long, dog);
  fuzzyEdge(ctx, o.outline, o.ow);
  ctx.fillStyle = fur;
  ctx.fill();

  ctx.save();
  headPath(ctx, p, o.long, dog);
  ctx.clip();
  // markings
  switch (def.pattern) {
    case 'tabby':
    case 'tabbyLong':
      ctx.strokeStyle = rgba(def.stripe, 0.85);
      ctx.lineCap = 'round';
      ctx.lineWidth = 4.5;
      for (const k of [-1, 0, 1]) {
        ctx.beginPath();
        ctx.moveTo(fx + k * r * 0.2, hy - r * 0.92);
        ctx.lineTo(fx + k * r * 0.16, hy - r * 0.56 + Math.abs(k) * r * 0.06);
        ctx.stroke();
      }
      for (const s of [-1, 1]) {
        for (const k of [0, 1]) {
          ctx.beginPath();
          ctx.moveTo(hx + s * r * 1.1, hy + r * (0.05 + k * 0.2));
          ctx.lineTo(hx + s * r * 0.78, hy + r * (0.08 + k * 0.18));
          ctx.stroke();
        }
      }
      ctx.fillStyle = rgba(def.belly, 0.9);
      ctx.beginPath(); ctx.ellipse(fx, hy + r * 0.42, r * 0.5, r * 0.32, 0, 0, Math.PI * 2); ctx.fill();
      break;
    case 'tux':
      ctx.fillStyle = def.belly;
      ctx.beginPath();
      ctx.moveTo(fx, hy - r * 0.15);
      ctx.quadraticCurveTo(fx + r * 0.22, hy + r * 0.1, fx + r * 0.62, hy + r * 0.45);
      ctx.quadraticCurveTo(fx, hy + r * 1.1, fx - r * 0.62, hy + r * 0.45);
      ctx.quadraticCurveTo(fx - r * 0.22, hy + r * 0.1, fx, hy - r * 0.15);
      ctx.fill();
      break;
    case 'calico':
      ctx.fillStyle = def.patchA;
      ctx.beginPath(); ctx.ellipse(hx - r * 0.7 + earShift, hy - r * 0.55, r * 0.6, r * 0.5, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = def.patchB;
      ctx.beginPath(); ctx.ellipse(hx + r * 0.75 + earShift, hy - r * 0.6, r * 0.5, r * 0.42, -0.4, 0, Math.PI * 2); ctx.fill();
      break;
    case 'tortie':
      ctx.fillStyle = rgba(def.patchA, 0.9);
      ctx.beginPath(); ctx.ellipse(hx - r * 0.55, hy - r * 0.3, r * 0.55, r * 0.7, 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba(def.patchB, 0.7);
      ctx.beginPath(); ctx.ellipse(hx + r * 0.6, hy + r * 0.3, r * 0.3, r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba(def.patchA, 0.85);
      ctx.beginPath(); ctx.ellipse(fx + r * 0.05, hy - r * 0.6, r * 0.08, r * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      break;
    case 'siamese':
      ctx.fillStyle = radial(ctx, fx, hy + r * 0.3, r * 0.85, [[0, rgba(def.points, 0.95)], [0.55, rgba(def.points, 0.6)], [1, rgba(def.points, 0)]]);
      ctx.fillRect(hx - r * 1.5, hy - r * 1.5, r * 3, r * 3);
      break;
    default:
      break;
  }
  // head volume + felt
  ctx.fillStyle = radial(ctx, hx - r * 0.35, hy - r * 0.45, r * 1.6, [[0, 'rgba(255,250,240,0.3)'], [0.5, 'rgba(255,250,240,0)'], [1, 'rgba(40,20,10,0.28)']]);
  ctx.fillRect(hx - r * 1.5, hy - r * 1.5, r * 3, r * 3);
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = fibre(ctx);
  ctx.fillRect(hx - r * 1.5, hy - r * 1.5, r * 3, r * 3);
  ctx.restore();

  // face
  const dark = ['#2b2731', '#35303a', '#3d2c27'].includes(fur) && def.pattern !== 'tux';
  const eyeY = hy + r * 0.06;
  const spread = r * (dog ? 0.46 : 0.4) * (1 - Math.abs(turn) * 0.18);
  const eyeR = r * (dog ? 0.19 : 0.2);
  for (const s of [-1, 1]) {
    const ex = fx + s * spread;
    const near = (s > 0) === (turn > 0) ? 1 + Math.abs(turn) * 0.12 : 1 - Math.abs(turn) * 0.12;
    const iris = s < 0 && def.eye2 ? def.eye2 : def.eye;
    if (eyesOpen > 0.18) {
      const ry = eyeR * 1.12 * eyesOpen * near;
      const rx = eyeR * 0.92 * near;
      ctx.fillStyle = '#2a1d1a';
      ctx.beginPath(); ctx.ellipse(ex, eyeY, rx + 1.5, ry + 1.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.ellipse(ex, eyeY, rx, ry, 0, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = linear(ctx, 0, eyeY - ry, 0, eyeY + ry, [[0, shade(iris, -0.35)], [0.6, iris], [1, shade(iris, 0.35)]]);
      ctx.fillRect(ex - rx, eyeY - ry, rx * 2, ry * 2);
      ctx.fillStyle = '#1d1412';
      const pr = dog ? 0.5 : 0.62; // a dog's round pupil leaves more iris showing
      ctx.beginPath(); ctx.ellipse(ex + turn * rx * 0.15, eyeY + ry * 0.05, rx * pr, ry * (dog ? 0.62 : 0.86), 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(ex - rx * 0.28 + turn * 2, eyeY - ry * 0.38, rx * 0.36, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex + rx * 0.32 + turn * 2, eyeY + ry * 0.32, rx * 0.16, 0, Math.PI * 2); ctx.fill();
    } else {
      // content closed eyes
      ctx.strokeStyle = dark ? '#0e0b10' : '#3a2620';
      ctx.lineWidth = r * 0.07;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ex, eyeY - r * 0.04, eyeR * 0.75, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
  }
  if (dog) {
    drawDogMuzzle(ctx, fx, hx, hy, r, turn, p.face[2] || 0);
    ctx.restore();
    return;
  }
  // blush
  ctx.fillStyle = dark ? 'rgba(230,120,140,0.28)' : 'rgba(240,130,130,0.35)';
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(fx + s * r * 0.66, hy + r * 0.38, r * 0.2, r * 0.12, 0, 0, Math.PI * 2); ctx.fill();
  }
  // nose + mouth
  const ny = hy + r * 0.32;
  ctx.fillStyle = dark ? '#c98090' : '#e88a8a';
  ctx.beginPath();
  ctx.moveTo(fx - r * 0.1, ny - r * 0.05);
  ctx.quadraticCurveTo(fx, ny - r * 0.1, fx + r * 0.1, ny - r * 0.05);
  ctx.quadraticCurveTo(fx + r * 0.04, ny + r * 0.07, fx, ny + r * 0.07);
  ctx.quadraticCurveTo(fx - r * 0.04, ny + r * 0.07, fx - r * 0.1, ny - r * 0.05);
  ctx.fill();
  const mouth = p.face[2] || 0;
  if (mouth > 0.15) {
    // yawn
    const my = ny + r * 0.12;
    ctx.fillStyle = '#7a3a3e';
    ctx.beginPath(); ctx.ellipse(fx, my + r * 0.16 * mouth, r * 0.15 * mouth + 1, r * 0.2 * mouth, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f0919a';
    ctx.beginPath(); ctx.ellipse(fx, my + r * 0.28 * mouth, r * 0.09 * mouth, r * 0.07 * mouth, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = dark ? 'rgba(10,8,12,0.9)' : 'rgba(70,40,30,0.75)';
  ctx.lineWidth = r * 0.045;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(fx, ny + r * 0.07);
  ctx.quadraticCurveTo(fx - r * 0.02, ny + r * 0.2, fx - r * 0.13, ny + r * 0.18);
  ctx.moveTo(fx, ny + r * 0.07);
  ctx.quadraticCurveTo(fx + r * 0.02, ny + r * 0.2, fx + r * 0.13, ny + r * 0.18);
  ctx.stroke();
  // whiskers
  ctx.strokeStyle = dark ? 'rgba(240,235,230,0.5)' : 'rgba(80,60,50,0.3)';
  ctx.lineWidth = 1.2;
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(fx + s * r * 0.3, ny + r * 0.06 + k * r * 0.06);
      ctx.quadraticCurveTo(fx + s * r * 0.75, ny - r * 0.02 + k * r * 0.1, fx + s * r * 1.2, ny - r * 0.08 + k * r * 0.18);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// French bulldog face below the eyes: a flat wide muzzle, black nose, droopy lips and a brow wrinkle.
function drawDogMuzzle(ctx, fx, hx, hy, r, turn, mouth) {
  // brow wrinkles between the eyes
  ctx.strokeStyle = 'rgba(150,130,120,0.45)';
  ctx.lineWidth = r * 0.04;
  ctx.lineCap = 'round';
  for (const k of [0, 1]) {
    ctx.beginPath();
    ctx.arc(fx, hy - r * (0.12 + k * 0.12), r * (0.16 + k * 0.04), Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
  }
  // muzzle pad
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath(); ctx.ellipse(fx, hy + r * 0.44, r * 0.52, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(240,130,130,0.35)';
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(fx + s * r * 0.72, hy + r * 0.3, r * 0.18, r * 0.11, 0, 0, Math.PI * 2); ctx.fill();
  }
  // whisker freckles
  ctx.fillStyle = 'rgba(120,100,95,0.4)';
  for (const s of [-1, 1]) {
    for (const [dx, dy] of [[0.22, 0.4], [0.32, 0.36], [0.28, 0.48]]) {
      ctx.beginPath(); ctx.arc(fx + s * r * dx, hy + r * dy, r * 0.025, 0, Math.PI * 2); ctx.fill();
    }
  }
  // big black nose
  const ny = hy + r * 0.27;
  ctx.fillStyle = '#2b2326';
  ctx.beginPath();
  ctx.moveTo(fx - r * 0.19, ny - r * 0.06);
  ctx.quadraticCurveTo(fx, ny - r * 0.15, fx + r * 0.19, ny - r * 0.06);
  ctx.quadraticCurveTo(fx + r * 0.16, ny + r * 0.1, fx, ny + r * 0.1);
  ctx.quadraticCurveTo(fx - r * 0.16, ny + r * 0.1, fx - r * 0.19, ny - r * 0.06);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.ellipse(fx - r * 0.06, ny - r * 0.06, r * 0.05, r * 0.025, 0, 0, Math.PI * 2); ctx.fill();
  if (mouth > 0.15) {
    ctx.fillStyle = '#7a3a3e';
    ctx.beginPath(); ctx.ellipse(fx, ny + r * 0.32, r * 0.2 * mouth + 1, r * 0.16 * mouth, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f0919a';
    ctx.beginPath(); ctx.ellipse(fx, ny + r * 0.4, r * 0.12 * mouth, r * 0.07 * mouth, 0, 0, Math.PI * 2); ctx.fill();
  }
  // droopy lips
  ctx.strokeStyle = 'rgba(60,45,45,0.7)';
  ctx.lineWidth = r * 0.045;
  ctx.beginPath();
  ctx.moveTo(fx, ny + r * 0.1); ctx.lineTo(fx, ny + r * 0.2);
  ctx.moveTo(fx - r * 0.36, ny + r * 0.18);
  ctx.quadraticCurveTo(fx - r * 0.2, ny + r * 0.3, fx, ny + r * 0.2);
  ctx.quadraticCurveTo(fx + r * 0.2, ny + r * 0.3, fx + r * 0.36, ny + r * 0.18);
  ctx.stroke();
  void hx; void turn;
}

function drawAccessory(ctx, def, p, outline) {
  const a = def.acc;
  if (!a) return;
  const [hx, hy, r, tilt] = p.head;
  const turn = p.face[0];
  const nx = hx - r * 0.05;
  const ny = hy + r * 0.84;
  ctx.save();
  ctx.lineCap = 'round';
  if (a.type === 'collar' || a.type === 'scarf' || a.type === 'bandana') {
    const thick = a.type === 'scarf' ? 13 : a.type === 'bandana' ? 8 : 6;
    ctx.strokeStyle = shade(a.color, -0.4);
    ctx.lineWidth = thick + 3;
    ctx.beginPath(); ctx.ellipse(nx, ny - 6, r * 0.66, r * 0.24, 0, Math.PI * 0.08, Math.PI * 0.92); ctx.stroke();
    ctx.strokeStyle = a.color;
    ctx.lineWidth = thick;
    ctx.beginPath(); ctx.ellipse(nx, ny - 6, r * 0.66, r * 0.24, 0, Math.PI * 0.08, Math.PI * 0.92); ctx.stroke();
    const bx = nx + turn * r * 0.25, by = ny - 6 + r * 0.24;
    if (a.type === 'scarf') {
      // knit stripes + hanging end
      ctx.strokeStyle = rgba(a.color2, 0.85);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(nx, ny - 6, r * 0.66, r * 0.24, 0, Math.PI * 0.25, Math.PI * 0.75); ctx.stroke();
      ctx.save();
      ctx.translate(bx - r * 0.25, by);
      ctx.rotate(0.15);
      ctx.fillStyle = shade(a.color, -0.4);
      ctx.beginPath(); ctx.roundRect(-8, -2, 16, 32, 4); ctx.fill();
      ctx.fillStyle = a.color;
      ctx.beginPath(); ctx.roundRect(-6.5, -1, 13, 30, 3); ctx.fill();
      ctx.fillStyle = a.color2;
      ctx.fillRect(-6.5, 10, 13, 4);
      ctx.fillRect(-6.5, 19, 13, 4);
      ctx.restore();
    } else if (a.type === 'bandana') {
      ctx.fillStyle = shade(a.color, -0.35);
      ctx.beginPath(); ctx.moveTo(bx - 20, by - 4); ctx.lineTo(bx + 20, by - 4); ctx.lineTo(bx, by + 22); ctx.closePath(); ctx.fill();
      ctx.fillStyle = a.color;
      ctx.beginPath(); ctx.moveTo(bx - 17, by - 3); ctx.lineTo(bx + 17, by - 3); ctx.lineTo(bx, by + 19); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,240,220,0.8)';
      for (const [dx, dy] of [[-7, 2], [6, 3], [0, 10]]) { ctx.beginPath(); ctx.arc(bx + dx, by + dy, 1.8, 0, Math.PI * 2); ctx.fill(); }
    } else if (a.bell) {
      ctx.fillStyle = radial(ctx, bx - 2, by + 2, 9, [[0, '#fff1b0'], [0.5, '#e8b94a'], [1, '#9a7032']]);
      ctx.beginPath(); ctx.arc(bx, by + 5, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#7a5520'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(bx - 6, by + 5); ctx.lineTo(bx + 6, by + 5); ctx.stroke();
    } else if (a.flower) {
      for (let k = 0; k < 5; k++) {
        const ang = (k / 5) * Math.PI * 2 + 0.3;
        ctx.fillStyle = '#fff6e6';
        ctx.beginPath(); ctx.arc(bx + Math.cos(ang) * 5, by + 3 + Math.sin(ang) * 5, 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#f2c46d';
      ctx.beginPath(); ctx.arc(bx, by + 3, 3, 0, Math.PI * 2); ctx.fill();
    }
  } else if (a.type === 'bow') {
    ctx.translate(hx, hy); ctx.rotate(tilt); ctx.translate(-hx, -hy);
    const bx = hx + turn * r * 0.16 - r * 0.62, by = hy - r * 0.78;
    ctx.fillStyle = shade(a.color, -0.3);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + s * 16, by - 14, bx + s * 18, by);
      ctx.quadraticCurveTo(bx + s * 16, by + 12, bx, by);
      ctx.fill();
    }
    ctx.fillStyle = a.color;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + s * 14, by - 11, bx + s * 15.5, by);
      ctx.quadraticCurveTo(bx + s * 14, by + 9, bx, by);
      ctx.fill();
    }
    ctx.fillStyle = shade(a.color, 0.3);
    ctx.beginPath(); ctx.arc(bx, by, 4.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
