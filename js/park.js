// The sunny park: the second place the cats can visit. Like the library it is a felt diorama
// rendered in Blender (assets/park, made by tools/blender/park.mjs), built to the same plan: a
// 1920 × 1080 scene, cats walking in along the same floor lane, with places to settle on the
// grass, under and in the shady tree, on the bench and around the playground. If the rendered
// plates are missing (or with ?park=procedural) the canvas-drawn park below is used instead.
//
// The park keeps time the way the library does, without a countdown: the sun sinks over the
// session and the light turns golden, the lamp by the bench comes on for the last minute with
// the first fireflies, and they sparkle once the session is over.
import {
  W, H, lerp, clamp, makeRng, noise1, rr, makeCanvas, fibreCanvas, texturePath, radial, linear, softShadow,
} from './util.js';

const GROUND = 700;                       // where the lawn meets the hedge
const TREE = { x: 430, base: 888 };
const BENCH = { x0: 880, x1: 1230, seat: 760, base: 884 };
const TOWER = { x0: 1580, x1: 1760, deck: 610, base: 892 };
const LAMP = { x: 1300, base: 886, head: 476 };
const SAND = { cx: 1700, cy: 952, rx: 165, ry: 40 };
export const PARK_BALL = { x: 935, y: 950 }; // where the ball the cats bat about starts

// Places to settle, in the same form as the library's (see scene.js). Ten for cats, one for Toby.
export const PARK_SPOTS = [
  { id: 'branch', x: 720, y: 598, z: 890, scale: 0.72, poses: ['loaf', 'sleep', 'sit', 'look'], facing: 1,
    route: [{ x: 760, y: 912 }, { x: 720, y: 598, z: 890, jump: true }] },
  { id: 'roots', x: 452, y: 936, poses: ['sleep', 'loaf', 'sit', 'groom'], facing: 1, route: [{ x: 452, y: 936 }] },
  { id: 'shade', x: 640, y: 948, poses: ['sleep', 'loaf', 'sit'], facing: -1, route: [{ x: 640, y: 948 }] },
  { id: 'benchL', x: 965, y: 760, z: 910, scale: 0.84, poses: ['sit', 'loaf', 'sleep', 'groom'], facing: 1,
    route: [{ x: 965, y: 942 }, { x: 965, y: 760, z: 910, jump: true }] },
  { id: 'benchR', x: 1145, y: 760, z: 910, scale: 0.84, poses: ['loaf', 'sleep', 'sit', 'look'], facing: -1,
    route: [{ x: 1145, y: 942 }, { x: 1145, y: 760, z: 910, jump: true }] },
  { id: 'tower', x: 1670, y: 610, z: 900, scale: 0.74, poses: ['sit', 'loaf', 'look', 'sleep'], facing: -1,
    route: [{ x: 1452, y: 945 }, { x: 1505, y: 760, z: 900, jump: true }, { x: 1670, y: 610, z: 900, jump: true }] },
  { id: 'slide', x: 1420, y: 872, z: 902, scale: 0.84, poses: ['loaf', 'sit', 'sleep'], facing: -1,
    route: [{ x: 1420, y: 945 }, { x: 1420, y: 872, z: 902, jump: true }] },
  { id: 'sand', x: 1716, y: 950, poses: ['sleep', 'loaf', 'sit', 'groom'], facing: -1, route: [{ x: 1716, y: 950 }] },
  { id: 'grassA', x: 812, y: 950, poses: ['sit', 'loaf', 'groom', 'sleep', 'play'], facing: 1, route: [{ x: 812, y: 950 }] },
  { id: 'grassB', x: 1058, y: 956, poses: ['sit', 'loaf', 'sleep', 'groom', 'play'], facing: -1, route: [{ x: 1058, y: 956 }] },
  // Toby's place: on the grass by the lamp post, between the bench and the slide (dogs only)
  { id: 'dogGrass', x: 1272, y: 944, poses: ['sleep', 'loaf', 'sit'], facing: -1, dog: true, route: [{ x: 1272, y: 944 }] },
];

const felt = (g, a = 0.8, s = 0.7) => texturePath(g, fibreCanvas(), a, 'soft-light', s);
const mix = (a, b, t) => a.map((v, i) => Math.round(lerp(v, b[i], t)));
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// ---------------------------------------------------------------------------
// Far plate: hills, a village, the far trees and the hedge (the sky shows above them)
// ---------------------------------------------------------------------------
function drawFar(g) {
  const hill = (base, amp, col, ph, f = 0.004) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(-60, GROUND + 20);
    for (let x = -60; x <= W + 60; x += 12) g.lineTo(x, base + Math.sin(x * f + ph) * amp + Math.sin(x * f * 2.7 + ph * 2) * amp * 0.35);
    g.lineTo(W + 60, GROUND + 20);
    g.closePath();
    g.fill();
    felt(g, 0.5, 1);
  };
  hill(560, 46, '#a9cdb9', 0.6);
  // the village on the far hill: a few felt houses and a church spire
  const r = makeRng(77);
  for (const [x, y, w, col] of [[1010, 548, 30, '#f1e4c8'], [1052, 556, 26, '#e9c9a0'], [1094, 552, 34, '#f1e4c8'], [1380, 560, 28, '#e9c9a0'], [1420, 566, 30, '#f1e4c8']]) {
    g.fillStyle = col; g.fillRect(x, y, w, 26);
    g.fillStyle = r() > 0.5 ? '#c8684d' : '#b5563f';
    g.beginPath(); g.moveTo(x - 4, y + 1); g.lineTo(x + w / 2, y - 16); g.lineTo(x + w + 4, y + 1); g.fill();
    g.fillStyle = 'rgba(90,70,60,0.5)'; g.fillRect(x + w / 2 - 3, y + 10, 6, 8);
  }
  g.fillStyle = '#f1e4c8'; g.fillRect(1140, 520, 14, 60);
  g.fillStyle = '#b5563f'; g.beginPath(); g.moveTo(1136, 522); g.lineTo(1147, 488); g.lineTo(1158, 522); g.fill();
  hill(604, 30, '#8fc09a', 2.4, 0.005);
  // far trees: round felt lollipops along the nearer hill
  for (let i = 0; i < 26; i++) {
    const x = -20 + i * 78 + r.range(-22, 22), y = 628 + r.range(-10, 10), s = r.range(22, 38);
    g.fillStyle = '#6b563f'; g.fillRect(x - 2.5, y - 4, 5, 26);
    g.fillStyle = radial(g, x + s * 0.3, y - s * 0.4, s * 1.3, [[0, '#86b878'], [1, '#5c965e']]);
    g.beginPath(); g.arc(x, y - s * 0.5, s, 0, Math.PI * 2); g.fill();
  }
  hill(650, 12, '#79b07c', 4.1, 0.007);
  // the hedge along the back of the lawn, with a scalloped top
  g.fillStyle = linear(g, 0, 640, 0, GROUND + 14, [[0, '#4f8a55'], [1, '#3f7449']]);
  g.beginPath();
  g.moveTo(-60, GROUND + 20);
  g.lineTo(-60, 668);
  for (let x = -60; x < W + 60; x += 46) g.quadraticCurveTo(x + 23, 640 + r.range(-4, 6), x + 46, 668);
  g.lineTo(W + 60, GROUND + 20);
  g.closePath();
  g.fill();
  felt(g, 0.9, 0.8);
  g.fillStyle = 'rgba(160,210,140,0.35)';
  for (let x = -40; x < W + 60; x += 46) { g.beginPath(); g.ellipse(x + 26, 662, 15, 6, 0, 0, Math.PI * 2); g.fill(); }
}

// ---------------------------------------------------------------------------
// Ground plate: the lawn, the path along the hedge, the tree's shade, flowers and the sandpit
// ---------------------------------------------------------------------------
function drawGround(g) {
  g.fillStyle = linear(g, 0, GROUND, 0, H, [[0, '#93c670'], [0.3, '#85bb63'], [1, '#70a653']]);
  g.fillRect(-60, GROUND, W + 120, H - GROUND + 40);
  // mown stripes running away from us
  const vpx = 960, vpy = -1300;
  const xAt = (xb, y) => vpx + (xb - vpx) * (y - vpy) / (H - vpy);
  for (let xb = -900, i = 0; xb < W + 900; xb += 150, i++) {
    if (i % 2) continue;
    g.fillStyle = 'rgba(255,255,210,0.085)';
    g.beginPath();
    g.moveTo(xAt(xb, GROUND), GROUND); g.lineTo(xAt(xb + 150, GROUND), GROUND); g.lineTo(xb + 150, H + 40); g.lineTo(xb, H + 40);
    g.fill();
  }
  // the gravel path along the hedge
  g.fillStyle = linear(g, 0, 708, 0, 742, [[0, '#e6d3a6'], [1, '#d9c191']]);
  g.beginPath();
  g.moveTo(-60, 722);
  for (let x = -60; x <= W + 60; x += 40) g.lineTo(x, 712 + Math.sin(x * 0.004 + 1) * 5);
  for (let x = W + 60; x >= -60; x -= 40) g.lineTo(x, 742 + Math.sin(x * 0.004 + 1.4) * 6);
  g.closePath();
  g.fill();
  felt(g, 0.7, 0.9);
  // a flower bed in front of the hedge
  const r = makeRng(5);
  const blooms = ['#f2a3b0', '#f6d36b', '#f7f1e1', '#e98a6b', '#c9a2dd'];
  for (let i = 0; i < 90; i++) {
    const x = r.range(-40, W + 40), y = r.range(700, 709);
    g.fillStyle = '#4f8a4a'; g.fillRect(x - 1, y - 9, 2, 10);
    g.fillStyle = r.pick(blooms);
    g.beginPath(); g.arc(x, y - 11, r.range(3.2, 5), 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = linear(g, 0, GROUND - 2, 0, GROUND + 22, [[0, 'rgba(30,60,30,0.3)'], [1, 'rgba(30,60,30,0)']]);
  g.fillRect(-60, GROUND - 2, W + 120, 24);

  // the tree's shade: a broad cool pool on the grass
  g.save();
  g.translate(540, 928); g.scale(1, 0.2);
  g.fillStyle = radial(g, 0, 0, 400, [[0, 'rgba(26,66,52,0.42)'], [0.7, 'rgba(26,66,52,0.3)'], [1, 'rgba(26,66,52,0)']]);
  g.beginPath(); g.arc(0, 0, 400, 0, Math.PI * 2); g.fill();
  g.restore();
  // dappled light inside it
  for (let i = 0; i < 16; i++) {
    const x = r.range(300, 800), y = r.range(890, 975);
    g.fillStyle = 'rgba(245,250,190,0.13)';
    g.beginPath(); g.ellipse(x, y, r.range(14, 30), r.range(4, 8), 0, 0, Math.PI * 2); g.fill();
  }

  // tufts and daisies across the lawn (small, and thinner where the animals rest)
  g.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const x = r.range(-40, W + 40), y = r.range(760, H + 20);
    const k = 0.6 + (y - GROUND) / 380;
    g.strokeStyle = r() > 0.5 ? 'rgba(70,125,60,0.5)' : 'rgba(170,215,120,0.5)';
    g.lineWidth = 1.6 * k;
    for (const dx of [-3, 0, 3]) { g.beginPath(); g.moveTo(x + dx * k, y); g.lineTo(x + dx * 1.9 * k, y - 8 * k); g.stroke(); }
  }
  for (let i = 0; i < 70; i++) {
    const x = r.range(-40, W + 40), y = r.range(770, H + 20);
    const k = 0.6 + (y - GROUND) / 380;
    const yellow = r() > 0.7;
    g.fillStyle = yellow ? '#f6d86b' : '#fbf6e8';
    for (let p = 0; p < 5; p++) {
      const a = p * Math.PI * 0.4;
      g.beginPath(); g.ellipse(x + Math.cos(a) * 3.4 * k, y + Math.sin(a) * 1.7 * k, 2.6 * k, 1.5 * k, 0, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = yellow ? '#e9a13b' : '#f2c14e';
    g.beginPath(); g.ellipse(x, y, 1.9 * k, 1.1 * k, 0, 0, Math.PI * 2); g.fill();
  }

  // the sandpit: a low wooden rim round a dish of sand, with a bucket and spade
  const { cx, cy, rx, ry } = SAND;
  softShadow(g, cx, cy + 8, rx + 16, ry + 10, 0.3);
  g.fillStyle = linear(g, 0, cy - ry, 0, cy + ry + 14, [[0, '#b88556'], [1, '#8c5f3b']]);
  g.beginPath(); g.ellipse(cx, cy + 7, rx + 12, ry + 9, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#c99a69';
  g.beginPath(); g.ellipse(cx, cy, rx + 12, ry + 8, 0, 0, Math.PI * 2); g.fill();
  felt(g, 0.8);
  g.fillStyle = radial(g, cx - 30, cy - 8, rx * 1.1, [[0, '#f3e4b8'], [1, '#e2cc97']]);
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
  felt(g, 0.9, 0.9);
  g.fillStyle = 'rgba(190,160,100,0.3)';
  for (const [dx, dy, w] of [[-90, -6, 40], [60, 14, 54], [-30, 20, 36], [100, -10, 30]]) { g.beginPath(); g.ellipse(cx + dx, cy + dy, w, 5, 0, 0, Math.PI * 2); g.fill(); }
  // bucket and spade at the back of the sand
  const bx = cx - 108, by = cy - 4;
  g.fillStyle = linear(g, bx - 16, 0, bx + 16, 0, [[0, '#6fa8c9'], [1, '#467a9c']]);
  g.beginPath(); g.moveTo(bx - 17, by - 32); g.lineTo(bx + 17, by - 32); g.lineTo(bx + 12, by); g.lineTo(bx - 12, by); g.closePath(); g.fill();
  g.fillStyle = '#8fc0dc'; g.beginPath(); g.ellipse(bx, by - 32, 17, 4.5, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#e9c46a'; g.lineWidth = 3;
  g.beginPath(); g.arc(bx, by - 32, 16, Math.PI, 0); g.stroke();
  g.strokeStyle = '#c8553d'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(bx + 34, by - 30); g.lineTo(bx + 44, by - 4); g.stroke();
  g.fillStyle = '#c8553d'; g.beginPath(); g.ellipse(bx + 46, by, 9, 6, 0.3, 0, Math.PI * 2); g.fill();
}

// ---------------------------------------------------------------------------
// Props (z-sorted with the animals): the tree, bench, lamp post and play tower
// ---------------------------------------------------------------------------
const CANOPY = [[330, 340, 120], [420, 220, 150], [560, 240, 145], [665, 330, 120], [520, 380, 125], [385, 415, 95], [705, 405, 76], [250, 300, 70], [610, 150, 80]];

function drawTree(g) {
  const { x, base } = TREE;
  softShadow(g, x + 10, base + 2, 150, 20, 0.5);
  // trunk, flaring into roots, with one big branch to the right
  const bark = linear(g, x - 60, 0, x + 60, 0, [[0, '#6f4a30'], [0.45, '#96683f'], [1, '#5d3d27']]);
  g.fillStyle = bark;
  g.beginPath();
  g.moveTo(x - 86, base + 4);
  g.quadraticCurveTo(x - 44, base - 20, x - 40, base - 120);
  g.lineTo(x - 30, 430); g.lineTo(x + 34, 430);
  g.lineTo(x + 36, 624);
  g.quadraticCurveTo(600, 606, 720, 598);       // the branch top: the cat's seat is on this line
  g.quadraticCurveTo(790, 594, 842, 584);
  g.lineTo(846, 600);
  g.quadraticCurveTo(760, 618, 700, 626);
  g.quadraticCurveTo(580, 646, x + 44, 706);
  g.lineTo(x + 46, base - 120);
  g.quadraticCurveTo(x + 52, base - 20, x + 96, base + 6);
  g.quadraticCurveTo(x + 30, base - 6, x + 6, base + 8);
  g.quadraticCurveTo(x - 30, base - 6, x - 86, base + 4);
  g.closePath();
  g.fill();
  felt(g, 0.95, 0.8);
  // bark seams and a knot
  g.strokeStyle = 'rgba(60,35,20,0.35)'; g.lineWidth = 3; g.lineCap = 'round';
  for (const [dx, y0, y1, bend] of [[-18, 520, 800, 6], [4, 470, 690, -5], [22, 730, 860, 4], [-6, 820, 878, -6]]) {
    g.beginPath(); g.moveTo(x + dx, y0); g.quadraticCurveTo(x + dx + bend, (y0 + y1) / 2, x + dx, y1); g.stroke();
  }
  g.beginPath(); g.ellipse(x + 8, 760, 9, 13, 0, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(520, 640); g.quadraticCurveTo(640, 622, 760, 610); g.stroke();
  // a sprig of leaves at the tip of the branch
  for (const [lx, ly, lr] of [[852, 574, 34], [886, 596, 25], [826, 556, 24]]) {
    g.fillStyle = radial(g, lx + lr * 0.3, ly - lr * 0.4, lr * 1.4, [[0, '#86c070'], [1, '#559653']]);
    g.beginPath(); g.arc(lx, ly, lr, 0, Math.PI * 2); g.fill();
  }

  // canopy: felt pom-poms, darkest underneath, lit from the sunny side
  const blobs = (dx, dy, k) => { g.beginPath(); for (const [bx, by, br] of CANOPY) { g.moveTo(bx + dx + br * k, by + dy); g.arc(bx + dx, by + dy, br * k, 0, Math.PI * 2); } };
  blobs(0, 8, 1); g.fillStyle = '#3f7a4a'; g.fill();
  blobs(0, 0, 1); g.fillStyle = '#56995a'; g.fill(); felt(g, 1, 0.9);
  for (const [bx, by, br] of CANOPY) {
    g.fillStyle = radial(g, bx + br * 0.35, by - br * 0.4, br * 1.05, [[0, 'rgba(150,205,110,0.75)'], [0.6, 'rgba(110,175,95,0.3)'], [1, 'rgba(90,160,90,0)']]);
    g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill();
  }
  // leaf stitches
  const r = makeRng(9);
  g.lineWidth = 2.4;
  for (let i = 0; i < 150; i++) {
    const [bx, by, br] = r.pick(CANOPY);
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * br * 0.9;
    const lx = bx + Math.cos(a) * d, ly = by + Math.sin(a) * d, la = r.range(-0.9, 0.3);
    g.strokeStyle = r() > 0.5 ? 'rgba(190,230,140,0.4)' : 'rgba(40,95,55,0.3)';
    g.beginPath(); g.moveTo(lx, ly); g.lineTo(lx + Math.cos(la) * 11, ly + Math.sin(la) * 11); g.stroke();
  }
}

function drawBench(g) {
  // A park bench seen from the front, a little from above: a slatted back and seat carried by two
  // cast-iron end frames. On each frame the back leg runs straight up into the post that holds
  // the backrest, the front leg stands in front of the seat and rises to the armrest, and the
  // armrest runs back from the top of the front leg to that post.
  const { x0, x1, seat, base } = BENCH;
  const teal = '#3f7f86', tealL = '#5a9ca2', tealD = '#2c5d64';
  const iron = '#3a4644', ironL = '#566462', ironD = '#232c2b';
  const DEPTH = 20;                 // how far up the screen the back of the seat sits
  const backTop = 628, armY = 700;  // top of the backrest posts; height of the armrests
  const ends = [[x0 + 12, 1], [x1 - 12, -1]]; // [x of the frame, which way is inward]
  softShadow(g, (x0 + x1) / 2, base - 6, (x1 - x0) / 2 + 30, 20, 0.5);
  g.lineCap = 'round'; g.lineJoin = 'round';

  // back legs and backrest posts: one piece each, behind everything
  for (const [ex, d] of ends) {
    const bx = ex + d * 7; // the back of the frame shows just inside the front
    g.strokeStyle = ironD; g.lineWidth = 11;
    g.beginPath(); g.moveTo(bx, backTop); g.lineTo(bx, seat); g.quadraticCurveTo(bx, base - 44, bx - d * 5, base - DEPTH); g.stroke();
    g.fillStyle = ironD; g.beginPath(); g.ellipse(bx - d * 5, base - DEPTH + 2, 9, 4, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(bx, backTop - 3, 7.5, 0, Math.PI * 2); g.fill(); // finial
  }
  // a stretcher between the back legs keeps the frame honest
  g.strokeStyle = ironD; g.lineWidth = 6;
  g.beginPath(); g.moveTo(x0 + 18, base - 62); g.lineTo(x1 - 18, base - 62); g.stroke();

  // backrest: three slats fixed across the posts
  for (let i = 0; i < 3; i++) {
    const y = 640 + i * 30;
    g.fillStyle = linear(g, 0, y, 0, y + 23, [[0, tealL], [1, teal]]);
    rr(g, x0 + 2, y, x1 - x0 - 4, 23, 6); g.fill(); felt(g, 0.9);
    g.fillStyle = 'rgba(20,45,50,0.25)'; g.fillRect(x0 + 8, y + 20, x1 - x0 - 16, 3);
    g.fillStyle = ironD; // bolts where the slat meets each post
    for (const [ex, d] of ends) { g.beginPath(); g.arc(ex + d * 7, y + 11.5, 2.6, 0, Math.PI * 2); g.fill(); }
  }
  // seat: the top face (two slats deep, where the cats sit) and the front edge
  g.fillStyle = linear(g, 0, seat - DEPTH, 0, seat, [[0, teal], [1, tealL]]);
  rr(g, x0, seat - DEPTH, x1 - x0, DEPTH + 2, 5); g.fill(); felt(g, 0.9);
  g.fillStyle = 'rgba(20,45,50,0.3)'; g.fillRect(x0 + 6, seat - DEPTH / 2 - 1, x1 - x0 - 12, 2.5);
  g.fillStyle = linear(g, 0, seat, 0, seat + 16, [[0, teal], [1, tealD]]);
  rr(g, x0, seat, x1 - x0, 16, 5); g.fill(); felt(g, 0.9);

  // front of each end frame: leg, armrest support and armrest, in front of the seat
  for (const [ex, d] of ends) {
    const bx = ex + d * 7;
    const metal = linear(g, ex - 7, 0, ex + 7, 0, [[0, ironL], [0.5, iron], [1, ironD]]);
    // front leg: from a foot on the grass, bowing gently outward, up past the seat to the armrest
    g.strokeStyle = metal; g.lineWidth = 12;
    g.beginPath();
    g.moveTo(ex - d * 9, base);
    g.quadraticCurveTo(ex - d * 1, base - 46, ex, seat + 10);
    g.lineTo(ex, armY + 4);
    g.stroke();
    g.fillStyle = iron; g.beginPath(); g.ellipse(ex - d * 10, base + 1, 11, 4.5, 0, 0, Math.PI * 2); g.fill();
    // a scroll bracing the leg under the seat
    g.strokeStyle = iron; g.lineWidth = 5;
    g.beginPath(); g.moveTo(ex + d * 2, seat + 22); g.quadraticCurveTo(ex + d * 26, seat + 24, ex + d * 30, seat + 44); g.quadraticCurveTo(ex + d * 30, seat + 58, ex + d * 18, seat + 54); g.stroke();
    // armrest: a flat bar running back from the top of the front leg to the backrest post
    g.fillStyle = linear(g, 0, armY - DEPTH, 0, armY + 8, [[0, ironL], [1, iron]]);
    g.beginPath();
    g.moveTo(ex - 11, armY + 2); g.quadraticCurveTo(ex - 13, armY - 8, ex - 7, armY - 10);
    g.lineTo(bx - 7, armY - DEPTH - 4); g.lineTo(bx + 7, armY - DEPTH - 4);
    g.lineTo(ex + 9, armY - 10); g.quadraticCurveTo(ex + 13, armY - 6, ex + 11, armY + 2);
    g.quadraticCurveTo(ex, armY + 9, ex - 11, armY + 2);
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.beginPath(); g.ellipse(ex, armY - 5, 7, 2.6, 0, 0, Math.PI * 2); g.fill();
  }
}

function drawLamp(g) {
  const { x, base, head } = LAMP;
  softShadow(g, x, base + 2, 38, 8, 0.45);
  const iron = linear(g, x - 8, 0, x + 8, 0, [[0, '#4b5a58'], [1, '#2b3534']]);
  g.fillStyle = iron;
  rr(g, x - 16, base - 16, 32, 18, 5); g.fill();
  rr(g, x - 10, base - 40, 20, 28, 5); g.fill();
  g.fillRect(x - 5, head + 26, 10, base - head - 60);
  rr(g, x - 14, head + 20, 28, 9, 4); g.fill();
  // the lantern: a glass box with a little roof
  g.fillStyle = '#f4e7bf';
  g.beginPath(); g.moveTo(x - 17, head - 20); g.lineTo(x + 17, head - 20); g.lineTo(x + 12, head + 21); g.lineTo(x - 12, head + 21); g.closePath(); g.fill();
  g.strokeStyle = '#2b3534'; g.lineWidth = 3;
  g.stroke();
  g.beginPath(); g.moveTo(x, head - 20); g.lineTo(x, head + 21); g.stroke();
  g.fillStyle = iron;
  g.beginPath(); g.moveTo(x - 24, head - 19); g.lineTo(x, head - 44); g.lineTo(x + 24, head - 19); g.closePath(); g.fill();
  g.beginPath(); g.arc(x, head - 46, 4, 0, Math.PI * 2); g.fill();
}

function drawTower(g) {
  const { x0, x1, deck, base } = TOWER;
  const wood = '#c49560', woodD = '#946a41', red = '#c8553d', yellow = '#e8b93f', yellowD = '#c4922b';
  softShadow(g, (x0 + x1) / 2 + 6, base + 2, 150, 20, 0.5);
  softShadow(g, 1425, 884, 70, 10, 0.4);
  const post = (px, y0, y1, w, c0, c1) => { g.fillStyle = linear(g, px - w / 2, 0, px + w / 2, 0, [[0, c0], [1, c1]]); rr(g, px - w / 2, y0, w, y1 - y0, 4); g.fill(); felt(g, 0.8); };
  // back posts and the far rail
  post(x0 + 26, 474, base - 14, 13, '#a87a4b', '#7d5735');
  post(x1 - 26, 474, base - 14, 13, '#a87a4b', '#7d5735');
  g.fillStyle = '#a87a4b'; rr(g, x0 + 26, 548, x1 - x0 - 52, 9, 4); g.fill();
  // ladder up the right-hand side
  g.strokeStyle = woodD; g.lineWidth = 9; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x1 + 8, deck + 6); g.lineTo(x1 + 52, base); g.stroke();
  g.strokeStyle = wood; g.lineWidth = 7;
  for (let i = 1; i <= 5; i++) { const u = i / 6, lx = lerp(x1 + 8, x1 + 52, u), ly = lerp(deck + 6, base, u); g.beginPath(); g.moveTo(lx - 30, ly); g.lineTo(lx, ly); g.stroke(); }
  // the slide: down from the deck's left edge to a flat run-out on the grass
  g.fillStyle = linear(g, 1385, 0, x0, 0, [[0, yellow], [1, yellowD]]);
  g.beginPath();
  g.moveTo(x0 + 2, deck); g.lineTo(x0 + 2, deck + 26);
  g.lineTo(1466, 884); g.lineTo(1380, 888); g.lineTo(1380, 872); g.lineTo(1452, 866);
  g.closePath(); g.fill(); felt(g, 0.9);
  g.strokeStyle = '#f6d877'; g.lineWidth = 6; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(x0 + 2, deck + 2); g.lineTo(1452, 867); g.lineTo(1382, 873); g.stroke();
  g.fillStyle = woodD; g.fillRect(1440, 884, 10, 6);
  // deck: top face and front edge
  g.fillStyle = linear(g, 0, deck - 14, 0, deck, [[0, '#4d8f8f'], [1, '#63a8a6']]);
  rr(g, x0 - 6, deck - 14, x1 - x0 + 12, 16, 5); g.fill(); felt(g, 0.9);
  g.fillStyle = linear(g, 0, deck, 0, deck + 20, [[0, '#4d8f8f'], [1, '#356c6e']]);
  rr(g, x0 - 6, deck, x1 - x0 + 12, 20, 5); g.fill(); felt(g, 0.9);
  // front posts
  post(x0 + 4, 474, base, 16, wood, woodD);
  post(x1 - 4, 474, base, 16, wood, woodD);
  // cross brace under the deck
  g.strokeStyle = 'rgba(148,106,65,0.9)'; g.lineWidth = 8;
  g.beginPath(); g.moveTo(x0 + 6, base - 40); g.lineTo(x1 - 6, deck + 40); g.stroke();
  // roof: a red felt gable with a scalloped edge
  g.fillStyle = linear(g, 0, 392, 0, 486, [[0, '#d8674c'], [1, red]]);
  g.beginPath(); g.moveTo(x0 - 28, 480); g.lineTo((x0 + x1) / 2, 392); g.lineTo(x1 + 28, 480); g.closePath(); g.fill(); felt(g, 0.95);
  g.fillStyle = red;
  for (let sx = x0 - 28; sx < x1 + 20; sx += 29.5) { g.beginPath(); g.arc(sx + 14.75, 480, 14.75, 0, Math.PI); g.fill(); }
  g.strokeStyle = 'rgba(120,40,25,0.3)'; g.lineWidth = 2.5;
  for (const k of [0.35, 0.68]) { g.beginPath(); g.moveTo(lerp((x0 + x1) / 2, x0 - 28, k), lerp(392, 480, k)); g.lineTo(lerp((x0 + x1) / 2, x1 + 28, k), lerp(392, 480, k)); g.stroke(); }
  // a little flag
  g.strokeStyle = woodD; g.lineWidth = 4;
  g.beginPath(); g.moveTo((x0 + x1) / 2, 394); g.lineTo((x0 + x1) / 2, 356); g.stroke();
  g.fillStyle = '#e8b93f'; g.beginPath(); g.moveTo((x0 + x1) / 2 + 2, 358); g.lineTo((x0 + x1) / 2 + 34, 367); g.lineTo((x0 + x1) / 2 + 2, 378); g.fill();
}

const PARK_PROPS = [
  { id: 'tree', box: [170, 40, 760, 880], z: 880, draw: drawTree },
  { id: 'bench', box: [840, 620, 430, 290], z: 900, draw: drawBench },
  { id: 'lamp', box: [1250, 410, 100, 490], z: 884, draw: drawLamp },
  { id: 'tower', box: [1340, 340, 520, 580], z: 892, draw: drawTower },
];

// ---------------------------------------------------------------------------
// Foreground: out-of-focus grass and flowers framing the bottom corners
// ---------------------------------------------------------------------------
function drawForePlate(g) {
  const r = makeRng(21);
  const blade = (x, y, h, lean, c, w) => {
    g.fillStyle = c;
    g.beginPath(); g.moveTo(x - w, y); g.quadraticCurveTo(x + lean * 0.4, y - h * 0.6, x + lean, y - h); g.quadraticCurveTo(x + lean * 0.5 + w, y - h * 0.5, x + w, y); g.fill();
  };
  const greens = ['#4f8a45', '#3f7a3c', '#63a052', '#356a35'];
  for (let i = 0; i < 26; i++) blade(r.range(-60, 330), 1110, r.range(110, 260), r.range(-60, 80), r.pick(greens), r.range(10, 18));
  for (let i = 0; i < 22; i++) blade(r.range(1690, 1990), 1110, r.range(100, 230), r.range(-90, 50), r.pick(greens), r.range(10, 18));
  const daisy = (x, y, s) => {
    g.fillStyle = '#f4efe0';
    for (let p = 0; p < 9; p++) { const a = p * Math.PI * 2 / 9; g.beginPath(); g.ellipse(x + Math.cos(a) * s, y + Math.sin(a) * s * 0.8, s * 0.62, s * 0.3, a, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#e8b33f'; g.beginPath(); g.arc(x, y, s * 0.5, 0, Math.PI * 2); g.fill();
  };
  daisy(120, 930, 34); daisy(250, 1010, 28); daisy(30, 1020, 30);
  daisy(1840, 960, 32); daisy(1740, 1030, 26);
}

// ---------------------------------------------------------------------------
// Rendered felt park (assets/park, made by tools/blender/park.mjs)
// ---------------------------------------------------------------------------
const PARK_DIR = 'assets/park/';
const RENDER_Z = { bunting: 886 }; // draw depth for rendered props the drawn park doesn't have

// Loads the Blender-rendered plates, props and light map, or resolves to null (no manifest, or
// ?park=procedural) so the canvas-drawn park is used instead.
async function loadPark() {
  if (new URLSearchParams(location.search).get('park') === 'procedural') return null;
  try {
    const res = await fetch(PARK_DIR + 'manifest.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const man = await res.json();
    const image = (file) => new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error(`missing ${file}`));
      im.src = PARK_DIR + file;
    });
    const group = async (name) => Object.fromEntries(await Promise.all(
      Object.entries(man[name] || {}).map(async ([id, v]) => [id, { ...v, img: await image(v.file) }])));
    const [plates, props, lightmap] = await Promise.all([group('plates'), group('props'), man.lightmap ? image(man.lightmap) : null]);
    if (!plates.far || !plates.mid) return null;
    return { plates, props, lightmap, fairy: man.fairy || [] };
  } catch (e) {
    console.warn('Rendered park unavailable, drawing the canvas park instead', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// The live park
// ---------------------------------------------------------------------------
export class Park {
  constructor(scene) {
    this.scene = scene;
    this.props = [];
    this.fairy = [];
    // undefined while we find out whether a rendered park exists; then its art, or null
    this.art = undefined;
    this.artReady = loadPark().then((art) => {
      this.art = art;
      if (art) scene.parkLoaded();
      return art;
    });
    const r = makeRng(12);
    this.clouds = [
      { x: 380, y: 215, w: 330, v: 5 },
      { x: 1150, y: 300, w: 250, v: 3.6 },
      { x: 1620, y: 190, w: 300, v: 4.4 },
    ];
    this.stars = Array.from({ length: 26 }, () => ({ x: r.range(260, 1900), y: r.range(150, 430), s: r.range(0.8, 2), ph: r() * 10 }));
    this.flies = Array.from({ length: 30 }, () => ({ x: r.range(330, 1840), y: r.range(520, 900), ph: r() * 10, sp: r.range(0.5, 1.1) }));
    this.leaves = Array.from({ length: 5 }, () => this.newLeaf(true));
  }

  newLeaf(any) {
    return { x: 260 + Math.random() * 520, y: any ? 480 + Math.random() * 420 : 470, v: 16 + Math.random() * 12, ph: Math.random() * 10, wait: any ? 0 : Math.random() * 14 };
  }

  build(scale) {
    const mk = (w, h, x, y, fn) => {
      const c = makeCanvas(w * scale, h * scale);
      const g = c.getContext('2d');
      g.scale(scale, scale);
      g.translate(-x, -y);
      fn(g);
      return c;
    };
    const A = this.art;
    // a rendered piece resampled once to the device scale
    const image = (p) => mk(p.box[2], p.box[3], p.box[0], p.box[1], (g) => g.drawImage(p.img, ...p.box));
    if (A) {
      this.farBox = A.plates.far.box;
      this.far = image(A.plates.far);
      this.groundBox = A.plates.mid.box;
      this.ground = image(A.plates.mid);
      // a rendered prop brings its own box (it includes the prop's contact shadow)
      this.props = Object.entries(A.props).map(([id, p]) => ({ id, z: RENDER_Z[id] ?? p.z, box: p.box, canvas: image(p) }));
      this.fairy = A.fairy;
    } else {
      // every drawn plate is a little wider than the frame, so the camera drift never shows an edge
      this.farBox = [-60, 430, W + 120, 300];
      this.far = mk(this.farBox[2], this.farBox[3], this.farBox[0], this.farBox[1], (g) => { g.filter = `blur(${0.8 * scale}px)`; drawFar(g); });
      this.groundBox = [-60, GROUND - 4, W + 120, H - GROUND + 44];
      this.ground = mk(this.groundBox[2], this.groundBox[3], this.groundBox[0], this.groundBox[1], drawGround);
      this.props = PARK_PROPS.map((p) => ({ ...p, canvas: mk(p.box[2], p.box[3], p.box[0], p.box[1], p.draw) }));
      this.fairy = [];
    }
    if (A?.plates.fore) {
      this.foreBox = A.plates.fore.box;
      this.fore = image(A.plates.fore);
    } else {
      this.foreBox = [0, 0, W, H];
      const fg = mk(W, H, 0, 0, drawForePlate);
      this.fore = mk(W, H, 0, 0, (g) => {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.filter = `blur(${8 * scale}px) brightness(0.8)`;
        g.drawImage(fg, 0, 0);
      });
    }
    this.cloud = mk(300, 120, 0, 0, (g) => {
      g.filter = `blur(${4 * scale}px)`;
      g.fillStyle = 'rgba(255,255,255,0.95)';
      for (const [x, y, rx, ry] of [[70, 72, 52, 26], [128, 54, 60, 36], [196, 66, 56, 28], [150, 82, 96, 22]]) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); }
    });
  }

  // What tints the animals: Blender's own light map when the park is rendered; otherwise bright
  // daylight everywhere, cooler under the tree.
  drawLightmap(g) {
    if (this.art?.lightmap) { g.drawImage(this.art.lightmap, 0, 0, W, H); return; }
    g.fillStyle = 'rgb(250,244,228)';
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(540, 900); g.scale(1, 0.45);
    g.fillStyle = radial(g, 0, 0, 420, [[0, 'rgb(176,196,190)'], [0.6, 'rgb(190,206,196)'], [1, 'rgba(250,244,228,0)']]);
    g.fillRect(-420, -420, 840, 840);
    g.restore();
  }

  update(dt, t) {
    for (const c of this.clouds) {
      c.x += c.v * dt;
      if (c.x > W + 80) c.x = -c.w - 80 - Math.random() * 200;
    }
    for (const l of this.leaves) {
      if (l.wait > 0) { l.wait -= dt; continue; }
      l.y += l.v * dt;
      l.x += Math.sin(t * 1.1 + l.ph) * 22 * dt + 4 * dt;
      if (l.y > 930) Object.assign(l, this.newLeaf(false));
    }
  }

  // The sun's place in the sky: high at the start, down behind the far hills as time runs out.
  sun() {
    const p = this.scene.progress;
    return { x: lerp(1035, 1105, p), y: lerp(240, 612, Math.pow(p, 1.15)), p };
  }

  drawBackground(ctx, t) {
    const sc = this.scene;
    const { x: sx, y: sy, p } = this.sun();
    const dusk = clamp(sc.finale * 0.6 + sc.reward * 0.25, 0, 1);
    sc.at(ctx, 0.12, () => {
      const top = mix(mix([104, 170, 224], [98, 118, 184], p), [58, 66, 124], dusk);
      const mid = mix(mix([164, 208, 238], [236, 170, 140], p), [150, 110, 140], dusk);
      const low = mix(mix([214, 236, 246], [255, 206, 146], p), [236, 160, 120], dusk);
      ctx.fillStyle = linear(ctx, 0, 120, 0, 690, [[0, rgb(top)], [0.6, rgb(mid)], [1, rgb(low)]]);
      ctx.fillRect(-80, -40, W + 160, 780);
      if (dusk > 0.02) {
        for (const s of this.stars) {
          const tw = 0.4 + 0.6 * noise1(t * 0.8 + s.ph * 7);
          ctx.fillStyle = `rgba(255,248,225,${dusk * (0.3 + tw * 0.6)})`;
          ctx.beginPath(); ctx.arc(s.x, s.y, s.s, 0, Math.PI * 2); ctx.fill();
        }
      }
      // the sun: pale and small at first, big and orange as it sets
      const sunCol = mix([255, 250, 226], [255, 176, 96], p);
      const sr = lerp(34, 46, p);
      ctx.fillStyle = radial(ctx, sx, sy, sr * 6, [[0, rgb(sunCol, 0.55)], [0.25, rgb(sunCol, 0.2)], [1, rgb(sunCol, 0)]]);
      ctx.fillRect(sx - sr * 6, sy - sr * 6, sr * 12, sr * 12);
      ctx.fillStyle = radial(ctx, sx - 6, sy - 6, sr, [[0, '#fffdf0'], [1, rgb(sunCol)]]);
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.92 - 0.25 * dusk;
      for (const c of this.clouds) ctx.drawImage(this.cloud, c.x, c.y, c.w, c.w * 0.4);
      ctx.globalAlpha = 1;
    });
    sc.at(ctx, 0.32, () => ctx.drawImage(this.far, ...this.farBox));
    sc.at(ctx, 0.5, () => ctx.drawImage(this.ground, ...this.groundBox));
  }

  // Live light on top of the animals: drifting leaves, the lamp, and the evening's fireflies.
  drawGlow(ctx, t) {
    const sc = this.scene;
    sc.at(ctx, 0.9, () => {
      for (const l of this.leaves) {
        if (l.wait > 0) continue;
        const a = clamp((l.y - 470) / 40, 0, 1) * clamp((930 - l.y) / 30, 0, 1);
        ctx.save();
        ctx.translate(l.x, l.y); ctx.rotate(Math.sin(t * 1.4 + l.ph) * 0.9);
        ctx.fillStyle = `rgba(120,175,90,${0.9 * a})`;
        ctx.beginPath(); ctx.ellipse(0, 0, 9, 4.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    });
  }

  // The time-of-day grade, over everything: golden as the sun sinks, dusk for the last minute.
  // Then the lights that belong to the evening, which sit on top of the grade.
  drawPost(ctx, t) {
    const sc = this.scene;
    const { x: sx, y: sy, p } = this.sun();
    const dusk = clamp(sc.finale * 0.75 + sc.reward * 0.25, 0, 1);
    ctx.save();
    if (p > 0.01) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(255,196,142,${0.45 * p})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, sx, Math.min(sy, 640), 900, [[0, `rgba(255,170,90,${0.2 * p * (1 - dusk * 0.6)})`], [1, 'rgba(255,170,90,0)']]);
      ctx.fillRect(0, 0, W, H);
    }
    if (dusk > 0.01) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(132,130,190,${0.5 * dusk})`;
      ctx.fillRect(0, 0, W, H);
      const lit = dusk * (0.92 + 0.08 * noise1(t * 2.3));
      ctx.globalCompositeOperation = 'lighter';
      sc.at(ctx, 0.9, () => {
        const { x, head } = LAMP;
        ctx.fillStyle = radial(ctx, x, head + 40, 380, [[0, `rgba(255,196,110,${0.34 * lit})`], [0.5, `rgba(255,170,90,${0.1 * lit})`], [1, 'rgba(255,160,80,0)']]);
        ctx.fillRect(x - 380, head - 340, 760, 760);
        ctx.fillStyle = radial(ctx, x, head, 46, [[0, `rgba(255,244,205,${0.95 * lit})`], [0.45, `rgba(255,214,130,${0.6 * lit})`], [1, 'rgba(255,190,100,0)']]);
        ctx.fillRect(x - 46, head - 46, 92, 92);
        // a pool of lamplight on the grass
        ctx.save();
        ctx.translate(x, LAMP.base + 20); ctx.scale(1, 0.24);
        ctx.fillStyle = radial(ctx, 0, 0, 300, [[0, `rgba(255,200,120,${0.3 * lit})`], [1, 'rgba(255,190,110,0)']]);
        ctx.fillRect(-300, -300, 600, 600);
        ctx.restore();
        // the string lights between the bunting flags come on with the lamp
        this.fairy.forEach(([bx, by], i) => {
          const tw = lit * (0.75 + 0.25 * noise1(t * 0.9 + i * 1.7));
          ctx.fillStyle = radial(ctx, bx, by, 30, [[0, `rgba(255,214,140,${0.5 * tw})`], [1, 'rgba(255,200,120,0)']]);
          ctx.fillRect(bx - 30, by - 30, 60, 60);
          ctx.fillStyle = `rgba(255,246,214,${0.95 * tw})`;
          ctx.beginPath(); ctx.arc(bx, by, 4, 0, Math.PI * 2); ctx.fill();
        });
        // fireflies: a few for the last minute, more (and brighter) once the session is over
        const gain = Math.min(1, sc.finale * 0.7 + sc.reward);
        this.flies.forEach((f, i) => {
          if (i >= 14 && sc.reward < 0.3) return;
          const fx = f.x + Math.sin(t * 0.35 * f.sp + f.ph) * 46 + Math.sin(t * 0.9 + f.ph * 3) * 10;
          const fy = f.y + Math.cos(t * 0.28 * f.sp + f.ph * 2) * 30;
          const a = gain * Math.max(0, Math.sin(t * 1.2 * f.sp + f.ph * 5)) ** 2;
          if (a < 0.03) return;
          ctx.fillStyle = radial(ctx, fx, fy, 15, [[0, `rgba(245,255,170,${0.85 * a})`], [0.3, `rgba(230,250,140,${0.35 * a})`], [1, 'rgba(220,250,120,0)']]);
          ctx.fillRect(fx - 15, fy - 15, 30, 30);
        });
      });
    }
    ctx.restore();
  }
}

// kept for tools that want the park's plan as data, like the library's LAYOUT
export const PARK_LAYOUT = { W, H, GROUND, TREE, BENCH, TOWER, LAMP, SAND, SPOTS: PARK_SPOTS, PROPS: PARK_PROPS.map(({ id, box, z }) => ({ id, box, z })) };
