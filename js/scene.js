// The cosy library: a pre-rendered room plus animated layers (sky, fire, candles, lights).
import {
  W, H, FLOOR_Y, lerp, clamp, makeRng, noise1, rr, shade, rgba, makeCanvas,
  grainCanvas, fibreCanvas, texturePath, radial, linear, softShadow,
} from './util.js';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
const SHELF = { x0: 50, x1: 540, top: 96, boards: [290, 470, 650, 830], post: 26, board: 18 };
const WIN = { x0: 800, x1: 1120, archY: 300, r: 160, sill: 622 };
const FIRE = { x0: 1530, x1: 1870, mantel: 470, open: { x0: 1615, x1: 1785, top: 650, bottom: 880 } };
const TABLE = { cx: 645, top: 705 };
const CHAIR = { cx: 1330 };
const POUF = { cx: 470, top: 902 };

export const FLOOR_LANE = 935;

// The part of the room the game shows: a chair-led crop of the 1920 × 1080 room, about 1.2×
// closer. The bookcase and fireplace run off the edges, and the floor spots stay clear of the HUD.
export const VIEW = { x: 280, y: 160, w: 1600, h: 900 };

// Places a cat can settle. `route` is walked from the floor: first entry is a floor point,
// later entries are jumps. Elevated spots carry their own draw depth (z) and scale.
export const SPOTS = [
  { id: 'shelfHigh', x: 446, y: 470, z: 470, scale: 0.7, poses: ['loaf', 'sleep', 'sit', 'groom'], facing: -1,
    route: [{ x: 790, y: 905 }, { x: 712, y: 707, z: 872, jump: true }, { x: 446, y: 470, z: 470, jump: true }] },
  { id: 'shelfLow', x: 430, y: 650, z: 650, scale: 0.7, poses: ['loaf', 'sleep', 'sit'], facing: 1,
    route: [{ x: 430, y: 900 }, { x: 430, y: 650, z: 650, jump: true }] },
  { id: 'sill', x: 985, y: 622, z: 622, scale: 0.76, poses: ['sit', 'loaf', 'look', 'sleep'], facing: 1,
    route: [{ x: 985, y: 885 }, { x: 985, y: 622, z: 622, jump: true }] },
  { id: 'seat', x: 1366, y: 768, z: 910, scale: 0.86, poses: ['sleep', 'loaf', 'sit', 'groom'], facing: -1,
    route: [{ x: 1366, y: 940 }, { x: 1366, y: 768, z: 910, jump: true }] },
  { id: 'chairBack', x: 1318, y: 534, z: 910, scale: 0.78, poses: ['loaf', 'sit', 'sleep'], facing: 1,
    route: [{ x: 1366, y: 940 }, { x: 1366, y: 768, z: 910, jump: true }, { x: 1318, y: 534, z: 910, jump: true }] },
  { id: 'mantel', x: 1672, y: 470, z: 500, scale: 0.72, poses: ['loaf', 'sit', 'sleep'], facing: -1,
    route: [{ x: 1510, y: 940 }, { x: 1466, y: 702, z: 910, jump: true }, { x: 1672, y: 470, z: 910, jump: true }] },
  { id: 'pouf', x: 470, y: 902, z: 965, scale: 0.8, poses: ['sleep', 'loaf', 'sit', 'groom'], facing: 1,
    route: [{ x: 590, y: 945 }, { x: 470, y: 902, z: 965, jump: true }] },
  { id: 'hearth', x: 1712, y: 940, poses: ['sleep', 'loaf', 'sit'], facing: -1, route: [{ x: 1712, y: 940 }] },
  { id: 'rugA', x: 830, y: 925, poses: ['sit', 'loaf', 'groom', 'sleep', 'play'], facing: 1, route: [{ x: 830, y: 925 }] },
  { id: 'rugB', x: 1150, y: 950, poses: ['sit', 'loaf', 'sleep', 'groom', 'play'], facing: -1, route: [{ x: 1150, y: 950 }] },
];

// How strongly a layer at depth z follows the slow camera drift (parallax).
export function depthFactor(z) {
  return lerp(0.42, 1, clamp((z - 450) / 520, 0, 1));
}
export const LAYER = { sky: 0.12, back: 0.32, mid: 0.5, fore: 1.9 };

export function floorScale(y) {
  return 0.86 + clamp((y - FLOOR_Y) / 250, 0, 1) * 0.2;
}

const PAL = {
  wallTop: '#2c3a52',
  wall: '#3d5070',
  wood: '#7a4a30',
  woodDark: '#4a2b1c',
  woodLight: '#a8714b',
  cream: '#f1e4c8',
  velvet: '#b4563d',
  mustard: '#d4a04a',
};

const BOOK_COLOURS = ['#b5534a', '#d9a441', '#3f7f7a', '#3d5582', '#5a7f4a', '#7a4a6b', '#e2d2ad', '#c0703d', '#8b3a3a', '#2f6b6b', '#c98e6b', '#566b8f', '#9a5f3a', '#6f8f6a'];

function windowPath(g, inset = 0) {
  const { x0, x1, archY, r, sill } = WIN;
  g.beginPath();
  g.moveTo(x0 + inset, sill);
  g.lineTo(x0 + inset, archY);
  g.arc((x0 + x1) / 2, archY, r - inset, Math.PI, 0);
  g.lineTo(x1 - inset, sill);
  g.closePath();
}

// ---------------------------------------------------------------------------
// Static room
// ---------------------------------------------------------------------------
function drawWall(g) {
  g.fillStyle = linear(g, 0, 0, 0, 620, [[0, PAL.wallTop], [1, PAL.wall]]);
  g.fillRect(0, 0, W, FLOOR_Y);

  // Wallpaper stripes + little leaf motif
  for (let x = 0; x < W; x += 64) {
    g.fillStyle = 'rgba(255,240,210,0.035)';
    g.fillRect(x, 0, 30, 600);
    g.fillStyle = 'rgba(30,50,40,0.05)';
    g.fillRect(x + 30, 0, 2, 600);
  }
  g.fillStyle = 'rgba(245,230,190,0.09)';
  for (let y = 60, row = 0; y < 590; y += 74, row++) {
    for (let x = (row % 2) * 32 + 15; x < W; x += 64) {
      g.save();
      g.translate(x, y);
      g.beginPath();
      g.moveTo(0, -11);
      g.quadraticCurveTo(7, -2, 0, 11);
      g.quadraticCurveTo(-7, -2, 0, -11);
      g.fill();
      g.beginPath();
      g.arc(0, 17, 1.8, 0, Math.PI * 2);
      g.arc(0, -17, 1.8, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }
  // Crown moulding
  g.fillStyle = linear(g, 0, 0, 0, 40, [[0, '#2e1c13'], [0.6, '#6a4029'], [1, '#3b2418']]);
  g.fillRect(0, 0, W, 38);
  g.fillStyle = 'rgba(255,220,180,0.15)';
  g.fillRect(0, 30, W, 2);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 38, W, 10);

  // Wainscoting
  g.fillStyle = linear(g, 0, 600, 0, FLOOR_Y, [[0, '#7e4e33'], [1, '#5c3622']]);
  g.fillRect(0, 600, W, FLOOR_Y - 600);
  g.fillStyle = linear(g, 0, 594, 0, 618, [[0, '#b07a52'], [0.4, '#8a5737'], [1, '#5a341f']]);
  g.fillRect(0, 594, W, 24);
  for (let x = 20; x < W; x += 170) {
    const px = x, pw = 140, py = 640, ph = 150;
    g.fillStyle = 'rgba(0,0,0,0.18)';
    rr(g, px, py, pw, ph, 6); g.fill();
    g.fillStyle = linear(g, px, py, px + pw, py + ph, [[0, '#8d5b3c'], [1, '#64391f']]);
    rr(g, px + 5, py + 5, pw - 10, ph - 10, 4); g.fill();
    g.strokeStyle = 'rgba(255,215,170,0.14)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(px + 6, py + ph - 6); g.lineTo(px + 6, py + 6); g.lineTo(px + pw - 6, py + 6); g.stroke();
  }
  // Baseboard
  g.fillStyle = linear(g, 0, 800, 0, FLOOR_Y, [[0, '#4b2c1b'], [1, '#2f1b10']]);
  g.fillRect(0, 804, W, FLOOR_Y - 804);
  g.fillStyle = 'rgba(255,210,160,0.15)';
  g.fillRect(0, 804, W, 2);

  const wallPath = () => { g.beginPath(); g.rect(0, 0, W, FLOOR_Y); };
  wallPath();
  texturePath(g, fibreCanvas(), 0.35);
}

function drawFloor(g) {
  g.fillStyle = linear(g, 0, FLOOR_Y, 0, H, [[0, '#6c4129'], [0.25, '#8b5636'], [1, '#7a4a2e']]);
  g.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);

  const vpx = 960, vpy = -1400;
  const xAt = (xb, y) => vpx + (xb - vpx) * (y - vpy) / (H - vpy);
  const r = makeRng(42);
  for (let xb = -900; xb < W + 900; xb += 120) {
    // plank tint
    const tint = r.range(-0.08, 0.08);
    g.fillStyle = tint > 0 ? `rgba(255,220,180,${tint})` : `rgba(40,20,10,${-tint})`;
    g.beginPath();
    g.moveTo(xAt(xb, FLOOR_Y), FLOOR_Y);
    g.lineTo(xAt(xb + 120, FLOOR_Y), FLOOR_Y);
    g.lineTo(xb + 120, H);
    g.lineTo(xb, H);
    g.closePath();
    g.fill();
    // grain
    g.strokeStyle = 'rgba(50,25,12,0.12)';
    g.lineWidth = 1;
    for (let k = 0; k < 4; k++) {
      const f = r.range(0.1, 0.9);
      g.beginPath();
      g.moveTo(xAt(xb + 120 * f, FLOOR_Y), FLOOR_Y);
      g.lineTo(xb + 120 * f + r.range(-6, 6), H);
      g.stroke();
    }
    // seams
    g.strokeStyle = 'rgba(35,18,8,0.55)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(xAt(xb, FLOOR_Y), FLOOR_Y);
    g.lineTo(xb, H);
    g.stroke();
    let y = FLOOR_Y + r.range(10, 90);
    while (y < H) {
      const xa = xAt(xb, y), xc = xAt(xb + 120, y);
      g.strokeStyle = 'rgba(35,18,8,0.45)';
      g.beginPath(); g.moveTo(xa, y); g.lineTo(xc, y); g.stroke();
      g.strokeStyle = 'rgba(255,210,170,0.08)';
      g.beginPath(); g.moveTo(xa, y + 2); g.lineTo(xc, y + 2); g.stroke();
      y += r.range(90, 160) * (0.7 + (y - FLOOR_Y) / 300);
    }
  }
  // floor sheen + wall contact shadow
  g.fillStyle = linear(g, 0, FLOOR_Y, 0, FLOOR_Y + 60, [[0, 'rgba(20,10,5,0.55)'], [1, 'rgba(20,10,5,0)']]);
  g.fillRect(0, FLOOR_Y, W, 60);
  g.beginPath(); g.rect(0, FLOOR_Y, W, H - FLOOR_Y);
  texturePath(g, grainCanvas(), 0.18, 'overlay');
}

function drawRug(g) {
  const cx = 1000, cy = 925, rx = 470, ry = 80;
  softShadow(g, cx, cy + 6, rx + 10, ry + 8, 0.35);
  // fringe
  g.strokeStyle = '#e8d6ad';
  g.lineWidth = 2.2;
  g.lineCap = 'round';
  for (const side of [-1, 1]) {
    for (let a = -0.45; a <= 0.45; a += 0.035) {
      const x = cx + side * Math.cos(a) * rx;
      const y = cy + Math.sin(a) * ry;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + side * 16, y + 2);
      g.stroke();
    }
  }
  const ell = (k) => { g.beginPath(); g.ellipse(cx, cy, rx * k, ry * k, 0, 0, Math.PI * 2); };
  ell(1); g.fillStyle = '#7f3029'; g.fill();
  ell(0.95); g.fillStyle = '#e6d1a6'; g.fill();
  ell(0.9); g.fillStyle = '#a5483a'; g.fill();
  ell(0.72); g.fillStyle = '#c1663f'; g.fill();
  ell(0.66); g.strokeStyle = '#e6d1a6'; g.lineWidth = 3; g.stroke();
  ell(0.4); g.fillStyle = '#7f3029'; g.fill();
  ell(0.34); g.fillStyle = '#d9a441'; g.fill();
  ell(0.22); g.fillStyle = '#3f6f6a'; g.fill();
  // border motif: little diamonds around the band
  g.fillStyle = '#7f3029';
  for (let a = 0; a < Math.PI * 2; a += 0.11) {
    const x = cx + Math.cos(a) * rx * 0.925;
    const y = cy + Math.sin(a) * ry * 0.925;
    g.beginPath();
    g.moveTo(x - 6, y); g.lineTo(x, y - 2.5); g.lineTo(x + 6, y); g.lineTo(x, y + 2.5);
    g.fill();
  }
  // field flowers
  g.fillStyle = '#e6d1a6';
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
    const x = cx + Math.cos(a) * rx * 0.55;
    const y = cy + Math.sin(a) * ry * 0.55;
    for (let p = 0; p < 4; p++) {
      g.beginPath();
      g.ellipse(x + Math.cos(p * Math.PI / 2) * 7, y + Math.sin(p * Math.PI / 2) * 2.2, 5, 2, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  ell(1);
  texturePath(g, fibreCanvas(), 0.9, 'soft-light', 0.8);
  ell(1);
  g.save(); g.clip();
  g.fillStyle = linear(g, 0, cy - ry, 0, cy + ry, [[0, 'rgba(255,230,200,0.1)'], [1, 'rgba(40,15,5,0.25)']]);
  g.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
  g.restore();
}

function drawBookshelf(g) {
  const { x0, x1, top, boards, post, board } = SHELF;
  // back panel
  g.fillStyle = linear(g, x0, 0, x1, 0, [[0, '#2a170e'], [0.5, '#3b2316'], [1, '#2a170e']]);
  g.fillRect(x0, top, x1 - x0, boards[3] - top);
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 2;
  for (let x = x0 + 60; x < x1; x += 70) { g.beginPath(); g.moveTo(x, top); g.lineTo(x, boards[3]); g.stroke(); }

  const r = makeRng(5);
  const rows = [
    { base: boards[0], h: boards[0] - top - 30, gaps: [] },
    { base: boards[1], h: boards[1] - boards[0] - board, gaps: [[372, x1]] },
    { base: boards[2], h: boards[2] - boards[1] - board, gaps: [[356, x1]] },
    { base: boards[3], h: boards[3] - boards[2] - board, gaps: [] },
  ];
  rows.forEach((row, ri) => {
    let x = x0 + post + 2;
    const end = x1 - post - 2;
    let n = 0;
    while (x < end - 14) {
      const gap = row.gaps.find((gp) => x >= gp[0] - 2 && x < gp[1]);
      if (gap) { x = gap[1] + 4; continue; }
      const nextGap = row.gaps.find((gp) => gp[0] > x);
      const limit = nextGap ? nextGap[0] : end;
      n++;
      const roll = r();
      if (roll < 0.07 && limit - x > 70) {
        // lying stack
        const sw = r.range(62, 80);
        let y = row.base;
        for (let k = 0; k < r.range(2, 5); k++) {
          const bh = r.range(12, 18);
          const bw = sw - r.range(0, 12);
          drawBookFlat(g, x + (sw - bw) / 2, y - bh, bw, bh, r.pick(BOOK_COLOURS));
          y -= bh;
        }
        if (r() > 0.4) drawTrinket(g, x + sw / 2, y, r);
        x += sw + 4;
        continue;
      }
      let w = r.range(17, 32);
      if (x + w > limit) w = limit - x;
      if (w < 10) break;
      const h = row.h * r.range(0.6, 0.93);
      const lean = (roll > 0.93 && x + w + 20 < limit) ? 0.12 : 0;
      drawBookSpine(g, x, row.base, w - 1.5, h, r.pick(BOOK_COLOURS), r, lean);
      x += w + (lean ? 12 : 0);
    }
    // shadow cast by the board above + side posts
    const ceil = ri === 0 ? top : boards[ri - 1] + board;
    g.fillStyle = linear(g, 0, ceil, 0, ceil + 60, [[0, 'rgba(10,4,2,0.6)'], [1, 'rgba(10,4,2,0)']]);
    g.fillRect(x0, ceil, x1 - x0, 60);
    g.fillStyle = linear(g, x0 + post, 0, x0 + post + 40, 0, [[0, 'rgba(10,4,2,0.45)'], [1, 'rgba(10,4,2,0)']]);
    g.fillRect(x0 + post, ceil, 40, row.base - ceil);
    g.fillStyle = linear(g, x1 - post, 0, x1 - post - 40, 0, [[0, 'rgba(10,4,2,0.45)'], [1, 'rgba(10,4,2,0)']]);
    g.fillRect(x1 - post - 40, ceil, 40, row.base - ceil);
  });

  // frame
  const woodV = (x, w) => linear(g, x, 0, x + w, 0, [[0, '#8a5636'], [0.35, '#7a4a2e'], [1, '#4b2b1a']]);
  g.fillStyle = woodV(x0, post); g.fillRect(x0, top, post, boards[3] - top + 30);
  g.fillStyle = woodV(x1 - post, post); g.fillRect(x1 - post, top, post, boards[3] - top + 30);
  for (const b of boards) {
    g.fillStyle = linear(g, 0, b, 0, b + board, [[0, '#a06a45'], [0.25, '#7f4d2f'], [1, '#4e2d1b']]);
    g.fillRect(x0, b, x1 - x0, board);
    g.fillStyle = 'rgba(255,220,180,0.2)';
    g.fillRect(x0, b, x1 - x0, 2);
  }
  // crown + plinth
  g.fillStyle = linear(g, 0, top - 30, 0, top + 6, [[0, '#9c6742'], [0.5, '#7a4a2e'], [1, '#3e2416']]);
  rr(g, x0 - 14, top - 30, x1 - x0 + 28, 36, 4); g.fill();
  g.fillStyle = 'rgba(255,220,180,0.18)'; g.fillRect(x0 - 14, top - 30, x1 - x0 + 28, 3);
  g.fillStyle = linear(g, 0, boards[3], 0, boards[3] + 32, [[0, '#6e4329'], [1, '#3a2215']]);
  g.fillRect(x0 - 8, boards[3] + 10, x1 - x0 + 16, 24);
  g.beginPath(); g.rect(x0 - 14, top - 30, x1 - x0 + 28, boards[3] - top + 64);
  texturePath(g, fibreCanvas(), 0.4);

  // things on top: plant + books
  drawBookFlat(g, 120, top - 30 - 16, 90, 16, '#3f7f7a');
  drawBookFlat(g, 126, top - 30 - 30, 78, 14, '#d9a441');
  drawPlantPot(g, 430, top - 30, 1, r);
}

function drawBookSpine(g, x, base, w, h, col, r, lean) {
  g.save();
  if (lean) { g.translate(x + w, base); g.rotate(lean); g.translate(-(x + w), -base); }
  const y = base - h;
  g.fillStyle = linear(g, x, 0, x + w, 0, [[0, shade(col, 0.22)], [0.18, col], [0.75, shade(col, -0.12)], [1, shade(col, -0.4)]]);
  rr(g, x, y, w, h, 2.5);
  g.fill();
  const style = r();
  const deco = shade(col, col === '#e2d2ad' ? -0.35 : 0.55, 0.75);
  g.fillStyle = deco;
  if (style < 0.4) {
    g.fillRect(x + 2, y + 10, w - 4, 2);
    g.fillRect(x + 2, y + 14, w - 4, 1);
    g.fillRect(x + 2, base - 16, w - 4, 2);
    g.fillRect(x + 2, base - 12, w - 4, 1);
  } else if (style < 0.75) {
    rr(g, x + 3, y + h * 0.22, w - 6, h * 0.22, 2);
    g.fillStyle = shade(col, 0.7, 0.55);
    g.fill();
    g.fillStyle = shade(col, -0.45, 0.5);
    for (let i = 0; i < 2; i++) g.fillRect(x + 6, y + h * 0.26 + i * 6, w - 12, 2);
  } else {
    g.fillRect(x + 2, y + 6, w - 4, 6);
    g.beginPath(); g.arc(x + w / 2, y + h * 0.55, Math.min(4, w / 5), 0, Math.PI * 2); g.fill();
  }
  // top page edge
  g.fillStyle = 'rgba(255,240,210,0.12)';
  g.fillRect(x + 1, y, w - 2, 2);
  g.restore();
}

function drawBookFlat(g, x, y, w, h, col) {
  g.fillStyle = linear(g, 0, y, 0, y + h, [[0, shade(col, 0.2)], [0.6, col], [1, shade(col, -0.35)]]);
  rr(g, x, y, w, h, 2);
  g.fill();
  g.fillStyle = '#efe3c6';
  g.fillRect(x + w - 6, y + 2, 4, h - 4);
  g.fillStyle = shade(col, 0.5, 0.6);
  g.fillRect(x + 8, y + h / 2 - 1, w * 0.4, 2);
}

function drawTrinket(g, x, y, r) {
  if (r() > 0.5) {
    // small vase
    g.fillStyle = linear(g, x - 10, 0, x + 10, 0, [[0, '#e8b7a2'], [1, '#a8685a']]);
    g.beginPath();
    g.moveTo(x - 5, y - 34); g.quadraticCurveTo(x - 14, y - 16, x - 9, y); g.lineTo(x + 9, y);
    g.quadraticCurveTo(x + 14, y - 16, x + 5, y - 34); g.closePath(); g.fill();
    g.strokeStyle = '#5a7f4a'; g.lineWidth = 1.5;
    for (const a of [-0.4, 0, 0.35]) { g.beginPath(); g.moveTo(x, y - 32); g.lineTo(x + Math.sin(a) * 18, y - 52); g.stroke(); }
    g.fillStyle = '#f2c46d';
    for (const a of [-0.4, 0, 0.35]) { g.beginPath(); g.arc(x + Math.sin(a) * 18, y - 53, 3, 0, Math.PI * 2); g.fill(); }
  } else {
    // little candle jar
    g.fillStyle = 'rgba(240,220,190,0.8)';
    rr(g, x - 9, y - 20, 18, 20, 4); g.fill();
    g.fillStyle = '#c0703d'; g.fillRect(x - 9, y - 12, 18, 5);
  }
}

function drawPlantPot(g, x, y, s, r) {
  // trailing pothos in a terracotta pot
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  const leaf = (lx, ly, a, sz, c) => {
    g.save(); g.translate(lx, ly); g.rotate(a);
    g.fillStyle = c;
    g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(sz * 0.7, -sz * 0.5, sz * 0.9, sz * 0.4, 0, sz); g.bezierCurveTo(-sz * 0.9, sz * 0.4, -sz * 0.7, -sz * 0.5, 0, 0); g.fill();
    g.strokeStyle = 'rgba(20,50,20,0.35)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, sz * 0.1); g.lineTo(0, sz * 0.85); g.stroke();
    g.restore();
  };
  const greens = ['#6f9a52', '#5b8a45', '#7fae5e', '#4e7a3c'];
  // vines
  const rr2 = makeRng(17);
  for (let v = 0; v < 4; v++) {
    const vx = -24 + v * 16;
    const len = 80 + rr2() * 120;
    g.strokeStyle = '#4e7a3c'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(vx, -10);
    g.bezierCurveTo(vx + 20, 10, vx - 10, len * 0.5, vx + (v - 1.5) * 10, len);
    g.stroke();
    for (let t = 0.15; t < 1; t += 0.14) {
      const px = vx + (v - 1.5) * 10 * t + Math.sin(t * 6) * 8;
      const py = -10 + len * t;
      leaf(px, py, (t * 7 + v) % 2 > 1 ? 0.8 : -0.8, 13 + rr2() * 5, greens[(v + Math.floor(t * 10)) % 4]);
    }
  }
  for (let k = 0; k < 9; k++) leaf(-20 + k * 5, -26 - (k % 3) * 6, -1.6 + k * 0.4, 18, greens[k % 4]);
  // pot
  g.fillStyle = linear(g, -30, 0, 30, 0, [[0, '#e0926a'], [0.5, '#c7714b'], [1, '#8d4a2f']]);
  g.beginPath(); g.moveTo(-30, -30); g.lineTo(30, -30); g.lineTo(24, 0); g.lineTo(-24, 0); g.closePath(); g.fill();
  g.fillStyle = linear(g, -33, 0, 33, 0, [[0, '#eaa07a'], [1, '#9d5537']]);
  rr(g, -33, -36, 66, 10, 3); g.fill();
  g.restore();
}

function drawWindow(g) {
  const { x0, x1, sill, archY, r } = WIN;
  const cx = (x0 + x1) / 2;
  // recess shadow
  g.save();
  windowPath(g, -26);
  g.fillStyle = 'rgba(15,20,25,0.35)';
  g.fill();
  g.restore();
  // cut the opening so the animated sky shows through
  g.save();
  g.globalCompositeOperation = 'destination-out';
  windowPath(g, 0);
  g.fill();
  g.restore();
  // glass reflections
  g.save();
  windowPath(g, 0);
  g.clip();
  g.fillStyle = 'rgba(200,220,255,0.05)';
  g.fillRect(x0, 0, x1 - x0, sill);
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  g.lineWidth = 26;
  g.beginPath(); g.moveTo(x0 - 40, sill - 40); g.lineTo(x0 + 180, 220); g.stroke();
  g.lineWidth = 10;
  g.beginPath(); g.moveTo(x0 + 10, sill + 30); g.lineTo(x0 + 240, 260); g.stroke();
  g.restore();

  // frame
  const frameCol = '#efe2c6';
  g.lineJoin = 'round';
  g.strokeStyle = frameCol;
  g.lineWidth = 22;
  windowPath(g, 0);
  g.stroke();
  g.strokeStyle = 'rgba(80,60,40,0.35)';
  g.lineWidth = 2;
  windowPath(g, 11);
  g.stroke();
  // mullions
  g.strokeStyle = frameCol;
  g.lineWidth = 10;
  g.beginPath();
  g.moveTo(cx, archY - r); g.lineTo(cx, sill);
  g.moveTo(x0, 465); g.lineTo(x1, 465);
  g.moveTo(x0, archY); g.lineTo(x1, archY);
  for (const a of [Math.PI * 1.25, Math.PI * 1.75]) {
    g.moveTo(cx, archY);
    g.lineTo(cx + Math.cos(a) * r, archY + Math.sin(a) * r);
  }
  g.stroke();
  g.fillStyle = frameCol;
  g.beginPath(); g.arc(cx, archY, 26, Math.PI, 0); g.fill();

  // sill
  g.fillStyle = linear(g, 0, sill - 4, 0, sill + 30, [[0, '#fbf1dc'], [0.3, '#e8d8b8'], [1, '#bda885']]);
  rr(g, x0 - 34, sill - 6, x1 - x0 + 68, 26, 6);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillRect(x0 - 20, sill + 20, x1 - x0 + 40, 10);
  g.fillStyle = linear(g, 0, sill + 20, 0, sill + 54, [[0, '#d8c6a3'], [1, '#a8936e']]);
  rr(g, x0 - 16, sill + 20, x1 - x0 + 32, 30, 4);
  g.fill();

  // little plant + candle on the sill
  drawSucculent(g, x0 + 30, sill - 4);
  // stack of books on right side of sill
  drawBookFlat(g, x1 - 70, sill - 20, 64, 14, '#7a4a6b');
  drawBookFlat(g, x1 - 66, sill - 34, 56, 14, '#e2d2ad');

  // curtain rod
  g.fillStyle = linear(g, 0, 100, 0, 114, [[0, '#f0cf87'], [1, '#9a7032']]);
  rr(g, x0 - 110, 102, x1 - x0 + 220, 10, 5);
  g.fill();
  for (const fx of [x0 - 114, x1 + 114]) {
    g.fillStyle = radial(g, fx - 3, 104, 14, [[0, '#ffe7a8'], [1, '#9a7032']]);
    g.beginPath(); g.arc(fx, 107, 12, 0, Math.PI * 2); g.fill();
  }
  drawCurtain(g, x0 - 96, 112, 1);
  drawCurtain(g, x1 + 96, 112, -1);
}

function drawSucculent(g, x, y) {
  g.fillStyle = linear(g, x - 22, 0, x + 22, 0, [[0, '#f4e9d6'], [1, '#bfae92']]);
  rr(g, x - 20, y - 30, 40, 30, 6);
  g.fill();
  const greens = ['#8fb585', '#7aa36f', '#a3c79a'];
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (i - 4) * 0.34;
    g.save(); g.translate(x, y - 30); g.rotate(a + Math.PI / 2);
    g.fillStyle = greens[i % 3];
    g.beginPath(); g.ellipse(0, -16 - (i % 2) * 4, 7, 17, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
}

function drawCurtain(g, x, top, dir) {
  // gathered velvet curtain tied back at y=470
  const col = '#c9963f';
  const tieY = 480, bottom = 800;
  const outer = x - dir * 30;
  const inner = x + dir * 70;
  g.save();
  g.beginPath();
  g.moveTo(outer, top);
  g.lineTo(inner, top);
  g.bezierCurveTo(inner + dir * 10, 300, x + dir * 6, tieY - 60, x + dir * 4, tieY);
  g.bezierCurveTo(x + dir * 30, tieY + 80, x + dir * 60, 700, x + dir * 70, bottom);
  g.lineTo(outer - dir * 10, bottom);
  g.bezierCurveTo(outer - dir * 4, 650, outer + dir * 2, tieY + 60, outer + dir * 8, tieY);
  g.bezierCurveTo(outer + dir * 2, 380, outer, 200, outer, top);
  g.closePath();
  g.fillStyle = col;
  g.fill();
  g.clip();
  // folds
  for (let i = 0; i < 7; i++) {
    const fx = outer + dir * (i * 16 + 2);
    g.fillStyle = linear(g, fx - 8, 0, fx + 8, 0, [[0, 'rgba(90,50,10,0.35)'], [0.5, 'rgba(255,230,170,0.25)'], [1, 'rgba(90,50,10,0.35)']]);
    g.beginPath();
    g.moveTo(fx - 8, top);
    g.lineTo(fx + 8, top);
    g.quadraticCurveTo(fx + dir * 20, tieY - 40, x + dir * 6 + 2, tieY);
    g.quadraticCurveTo(fx + dir * (30 + i * 6), 680, fx + dir * (20 + i * 10) + 8, bottom);
    g.lineTo(fx + dir * (20 + i * 10) - 8, bottom);
    g.quadraticCurveTo(fx + dir * (24 + i * 6), 680, x + dir * 6 - 2, tieY);
    g.quadraticCurveTo(fx + dir * 14, tieY - 40, fx - 8, top);
    g.fill();
  }
  g.fillStyle = linear(g, 0, top, 0, bottom, [[0, 'rgba(40,20,5,0.25)'], [0.4, 'rgba(40,20,5,0)'], [1, 'rgba(40,20,5,0.3)']]);
  g.fillRect(x - 200, top, 400, bottom - top);
  g.restore();
  // tie-back
  g.fillStyle = '#7f3029';
  g.save(); g.translate(x + dir * 16, tieY); g.rotate(dir * -0.15);
  rr(g, -46, -8, 92, 16, 8); g.fill();
  g.fillStyle = '#f0cf87'; g.beginPath(); g.arc(dir * 30, 0, 9, 0, Math.PI * 2); g.fill();
  g.restore();
}

function drawFireplace(g) {
  const { x0, x1, mantel, open } = FIRE;
  softShadow(g, (x0 + x1) / 2, 880, 230, 28, 0.4);
  // surround
  g.fillStyle = linear(g, x0, 0, x1, 0, [[0, '#cdb594'], [0.5, '#e6d4b5'], [1, '#b8a07e']]);
  rr(g, x0, mantel + 20, x1 - x0, 880 - mantel - 20, 4);
  g.fill();
  // pilasters
  for (const px of [x0 + 18, x1 - 68]) {
    g.fillStyle = linear(g, px, 0, px + 50, 0, [[0, '#efe2c8'], [1, '#c5ad8a']]);
    rr(g, px, mantel + 40, 50, 880 - mantel - 50, 4);
    g.fill();
    g.strokeStyle = 'rgba(120,90,60,0.25)';
    g.lineWidth = 2;
    g.strokeRect(px + 10, mantel + 60, 30, 880 - mantel - 100);
  }
  // opening
  const { x0: ox0, x1: ox1, top: otop, bottom: ob } = open;
  const ocx = (ox0 + ox1) / 2, or = (ox1 - ox0) / 2;
  const openingPath = (inset = 0) => {
    g.beginPath();
    g.moveTo(ox0 - inset, ob);
    g.lineTo(ox0 - inset, otop + or);
    g.arc(ocx, otop + or, or + inset, Math.PI, 0);
    g.lineTo(ox1 + inset, ob);
    g.closePath();
  };
  openingPath(18);
  g.fillStyle = '#7d4a36';
  g.fill();
  // bricks around the arch
  g.strokeStyle = 'rgba(60,30,20,0.6)';
  g.lineWidth = 2;
  for (let a = Math.PI; a <= Math.PI * 2 + 0.01; a += Math.PI / 9) {
    g.beginPath();
    g.moveTo(ocx + Math.cos(a) * or, otop + or + Math.sin(a) * or);
    g.lineTo(ocx + Math.cos(a) * (or + 18), otop + or + Math.sin(a) * (or + 18));
    g.stroke();
  }
  openingPath(0);
  g.fillStyle = linear(g, 0, otop, 0, ob, [[0, '#120806'], [0.7, '#2a120a'], [1, '#3a1a0e']]);
  g.fill();
  g.save();
  openingPath(0);
  g.clip();
  g.strokeStyle = 'rgba(90,40,25,0.35)';
  g.lineWidth = 2;
  for (let y = otop + 10, row = 0; y < ob; y += 22, row++) {
    g.beginPath(); g.moveTo(ox0, y); g.lineTo(ox1, y); g.stroke();
    for (let x = ox0 + (row % 2) * 24; x < ox1; x += 48) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 22); g.stroke(); }
  }
  g.restore();
  // keystone
  g.fillStyle = '#efe2c8';
  g.beginPath();
  g.moveTo(ocx - 16, otop - 20); g.lineTo(ocx + 16, otop - 20); g.lineTo(ocx + 11, otop + 8); g.lineTo(ocx - 11, otop + 8); g.closePath();
  g.fill();

  // mantel shelf + corbels
  for (const cxp of [x0 + 30, x1 - 30]) {
    g.fillStyle = linear(g, cxp - 16, 0, cxp + 16, 0, [[0, '#8a5636'], [1, '#4b2b1a']]);
    g.beginPath(); g.moveTo(cxp - 16, mantel + 26); g.lineTo(cxp + 16, mantel + 26); g.quadraticCurveTo(cxp + 16, mantel + 70, cxp, mantel + 80); g.quadraticCurveTo(cxp - 16, mantel + 60, cxp - 16, mantel + 26); g.fill();
  }
  g.fillStyle = linear(g, 0, mantel, 0, mantel + 30, [[0, '#b37b52'], [0.2, '#8a5636'], [1, '#4b2b1a']]);
  rr(g, x0 - 26, mantel, x1 - x0 + 52, 28, 4);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(x0, mantel + 28, x1 - x0, 8);

  // hearth
  g.fillStyle = linear(g, 0, 878, 0, 910, [[0, '#9a8a7c'], [1, '#5f5249']]);
  rr(g, x0 - 30, 876, x1 - x0 + 60, 30, 6);
  g.fill();
  g.fillStyle = 'rgba(255,240,220,0.2)';
  g.fillRect(x0 - 26, 877, x1 - x0 + 52, 2);


  // mantel decor (clock + plant); candles are animated separately
  drawClock(g, 1820, mantel);
  for (const c of CANDLES) {
    g.fillStyle = linear(g, c.x - 7, 0, c.x + 7, 0, [[0, '#fff6e3'], [1, '#d9c7a4']]);
    rr(g, c.x - 7, mantel - c.h, 14, c.h, 3);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.beginPath(); g.ellipse(c.x, mantel - c.h, 7, 2.5, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3a2a20'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(c.x, mantel - c.h); g.lineTo(c.x, mantel - c.h - 5); g.stroke();
  }
  // brass holder
  g.fillStyle = linear(g, 1520, 0, 1600, 0, [[0, '#f0cf87'], [1, '#9a7032']]);
  rr(g, 1530, mantel - 6, 62, 6, 3); g.fill();

  // back log inside the fire
  drawLog(g, ocx - 6, ob - 22, 130, 20, -0.06);
}

const CANDLES = [{ x: 1546, h: 54 }, { x: 1572, h: 38 }];

function drawLog(g, x, y, len, th, rot) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = linear(g, 0, -th / 2, 0, th / 2, [[0, '#7a4a2e'], [1, '#2e1a10']]);
  rr(g, -len / 2, -th / 2, len, th, th / 2);
  g.fill();
  g.fillStyle = '#c99b6e';
  g.beginPath(); g.ellipse(len / 2 - 4, 0, th / 3, th / 2 - 1, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#8a5a3a'; g.lineWidth = 1;
  g.beginPath(); g.ellipse(len / 2 - 4, 0, th / 6, th / 4, 0, 0, Math.PI * 2); g.stroke();
  g.restore();
}

function drawPainting(g, x, y, w, h) {
  // gilded frame
  g.fillStyle = 'rgba(0,0,0,0.3)';
  rr(g, x - 14, y - 6, w + 28, h + 28, 6); g.fill();
  g.fillStyle = linear(g, x, y, x + w, y + h, [[0, '#f3d48a'], [0.5, '#b8873c'], [1, '#e4bd6c']]);
  rr(g, x - 16, y - 16, w + 32, h + 32, 6); g.fill();
  g.strokeStyle = 'rgba(90,60,20,0.5)'; g.lineWidth = 2;
  g.strokeRect(x - 6, y - 6, w + 12, h + 12);
  // landscape: dusk hills, a little house and moon
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = linear(g, 0, y, 0, y + h, [[0, '#f0b48a'], [0.45, '#f5d6a8'], [1, '#9cb58e']]);
  g.fillRect(x, y, w, h);
  g.fillStyle = '#fff3d6';
  g.beginPath(); g.arc(x + w * 0.72, y + h * 0.3, 18, 0, Math.PI * 2); g.fill();
  const hill = (yy, c, amp, ph) => {
    g.fillStyle = c;
    g.beginPath(); g.moveTo(x, y + h);
    for (let i = 0; i <= 20; i++) g.lineTo(x + (w * i) / 20, y + yy + Math.sin(i * 0.5 + ph) * amp);
    g.lineTo(x + w, y + h); g.fill();
  };
  hill(h * 0.6, '#8aa98a', 10, 1);
  hill(h * 0.72, '#6f9174', 12, 3);
  hill(h * 0.85, '#58785f', 8, 0.2);
  g.fillStyle = '#efe3c6'; g.fillRect(x + w * 0.28, y + h * 0.6, 26, 18);
  g.fillStyle = '#b5534a';
  g.beginPath(); g.moveTo(x + w * 0.28 - 4, y + h * 0.6); g.lineTo(x + w * 0.28 + 13, y + h * 0.6 - 14); g.lineTo(x + w * 0.28 + 30, y + h * 0.6); g.fill();
  g.fillStyle = '#f5c35a'; g.fillRect(x + w * 0.28 + 9, y + h * 0.6 + 5, 7, 7);
  g.restore();
  g.beginPath(); g.rect(x, y, w, h);
  texturePath(g, fibreCanvas(), 0.6);
}

function drawClock(g, x, base) {
  g.fillStyle = linear(g, x - 30, 0, x + 30, 0, [[0, '#8a5636'], [1, '#3e2416']]);
  g.beginPath();
  g.moveTo(x - 30, base); g.lineTo(x - 30, base - 44);
  g.arc(x, base - 44, 30, Math.PI, 0);
  g.lineTo(x + 30, base); g.closePath(); g.fill();
  g.fillStyle = '#f7ecd3';
  g.beginPath(); g.arc(x, base - 46, 21, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#d9b46a'; g.lineWidth = 3; g.stroke();
  g.strokeStyle = '#3a2a20'; g.lineWidth = 2; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x, base - 46); g.lineTo(x + 7, base - 52); g.moveTo(x, base - 46); g.lineTo(x - 2, base - 62); g.stroke();
}

function drawHangingPlant(g, x) {
  g.strokeStyle = '#d9c4a0';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x, 38); g.lineTo(x - 28, 220);
  g.moveTo(x, 38); g.lineTo(x + 28, 220);
  g.moveTo(x, 38); g.lineTo(x, 222);
  g.stroke();
  drawPlantPot(g, x, 250, 0.9);
}

function drawBackLayer(g) {
  drawWall(g);
  drawWindow(g);
  drawPainting(g, 1590, 210, 220, 200);
  // fairy-light wire across the window top
  g.strokeStyle = 'rgba(40,30,20,0.6)';
  g.lineWidth = 1.5;
  g.beginPath();
  FAIRY.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.stroke();
  drawHangingPlant(g, 1240);
}

function drawMidLayer(g) {
  drawFireplace(g);
  drawBookshelf(g);
  drawFloor(g);
  drawRug(g);
}

// Fairy lights hang in swags just below the curtain rod, inside the view.
const FAIRY = [];
for (let i = 0; i <= 22; i++) {
  const t = i / 22;
  const x = lerp(WIN.x0 - 100, WIN.x1 + 100, t);
  const sag = Math.sin(t * Math.PI * 3) ** 2 * 40;
  FAIRY.push({ x, y: 174 + sag, hue: ['#ffd27a', '#ffb3a1', '#fff0c2', '#ffc46b'][i % 4], ph: i * 1.7 });
}

// ---------------------------------------------------------------------------
// Foreground props (z-sorted with cats)
// ---------------------------------------------------------------------------
function drawArmchair(g) {
  // sage-green felted wingback: darker than the cats so they pop on top of it
  const v = '#667f55', vl = '#86a06f', vd = '#3f5135';
  const felt = (a = 0.85) => texturePath(g, fibreCanvas(), a, 'soft-light', 0.7);
  softShadow(g, CHAIR.cx, 902, 196, 28, 0.55);
  for (const lx of [1200, 1460]) {
    g.fillStyle = linear(g, lx - 8, 0, lx + 8, 0, [[0, '#9a6640'], [1, '#4b2b1a']]);
    g.beginPath(); g.moveTo(lx - 10, 874); g.lineTo(lx + 10, 874); g.lineTo(lx + 6, 908); g.lineTo(lx - 6, 908); g.fill();
  }
  // back
  const back = () => {
    g.beginPath();
    g.moveTo(1214, 790); g.lineTo(1214, 600);
    g.bezierCurveTo(1214, 546, 1262, 526, 1330, 524);
    g.bezierCurveTo(1398, 526, 1446, 546, 1446, 600);
    g.lineTo(1446, 790); g.closePath();
  };
  back();
  g.fillStyle = radial(g, 1320, 590, 240, [[0, vl], [0.55, v], [1, vd]]);
  g.fill();
  back(); felt();
  // soft channel seams
  g.strokeStyle = 'rgba(30,45,25,0.28)';
  g.lineWidth = 3;
  for (const sx of [1272, 1330, 1388]) {
    g.beginPath(); g.moveTo(sx, 552 + Math.abs(sx - 1330) * 0.25); g.quadraticCurveTo(sx + 2, 660, sx, 760); g.stroke();
  }
  // wings
  for (const side of [-1, 1]) {
    const wx = side < 0 ? 1214 : 1446;
    g.beginPath();
    g.moveTo(wx, 596);
    g.bezierCurveTo(wx + side * 44, 588, wx + side * 50, 664, wx + side * 38, 772);
    g.lineTo(wx - side * 4, 772);
    g.closePath();
    g.fillStyle = linear(g, wx, 0, wx + side * 50, 0, [[0, vd], [0.45, v], [1, shade(v, -0.2)]]);
    g.fill();
    felt();
  }
  // seat cushion
  g.beginPath(); rr(g, 1236, 744, 188, 60, 22);
  g.fillStyle = linear(g, 0, 744, 0, 804, [[0, vl], [0.4, v], [1, vd]]);
  g.fill();
  rr(g, 1236, 744, 188, 60, 22); felt();
  // front skirt
  rr(g, 1236, 798, 188, 82, 12);
  g.fillStyle = linear(g, 0, 798, 0, 880, [[0, v], [1, vd]]);
  g.fill();
  rr(g, 1236, 798, 188, 82, 12); felt();
  // rolled arms
  for (const side of [-1, 1]) {
    const ax = side < 0 ? 1222 : 1438;
    rr(g, ax - 44, 702, 88, 178, 30);
    g.fillStyle = linear(g, ax - 44, 0, ax + 44, 0, side < 0 ? [[0, vd], [0.55, v], [1, vl]] : [[0, vl], [0.45, v], [1, vd]]);
    g.fill();
    rr(g, ax - 44, 702, 88, 178, 30); felt();
    g.beginPath(); g.ellipse(ax, 712, 48, 24, 0, 0, Math.PI * 2);
    g.fillStyle = linear(g, 0, 688, 0, 736, [[0, vl], [1, v]]);
    g.fill();
    g.beginPath(); g.ellipse(ax, 712, 48, 24, 0, 0, Math.PI * 2); felt();
    g.beginPath(); g.ellipse(ax, 740, 30, 26, 0, 0, Math.PI * 2);
    g.fillStyle = radial(g, ax - 6, 732, 34, [[0, vl], [0.7, v], [1, vd]]);
    g.fill();
    g.strokeStyle = 'rgba(30,45,25,0.35)'; g.lineWidth = 2.5;
    g.beginPath(); g.arc(ax, 740, 14, 0.3, Math.PI * 1.8); g.stroke();
  }
  // cream pillow with embroidered blue vine (left side, leaves room for a cat)
  g.save();
  g.translate(1284, 724);
  g.rotate(-0.13);
  const pillow = () => {
    g.beginPath();
    g.moveTo(-42, -38); g.quadraticCurveTo(0, -30, 42, -40);
    g.quadraticCurveTo(34, 0, 44, 38); g.quadraticCurveTo(0, 30, -44, 40);
    g.quadraticCurveTo(-34, 0, -42, -38); g.closePath();
  };
  pillow();
  g.fillStyle = radial(g, -8, -10, 64, [[0, '#fbf3e3'], [0.7, '#eadcc2'], [1, '#bfae8c']]);
  g.fill();
  pillow(); felt(1);
  g.strokeStyle = '#4f72a0'; g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); g.moveTo(-30, 22); g.bezierCurveTo(-12, 6, 4, 10, 10, -6); g.bezierCurveTo(16, -20, 26, -18, 30, -28); g.stroke();
  g.fillStyle = '#4f72a0';
  for (const [lx, ly, a] of [[-20, 12, -0.8], [-6, 6, 0.6], [6, -2, -0.9], [16, -14, 0.7], [26, -22, -0.5]]) {
    g.save(); g.translate(lx, ly); g.rotate(a);
    g.beginPath(); g.ellipse(0, -6, 4, 7, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  g.restore();
  // plaid knit throw draped over the right arm and down the front
  g.save();
  const throwPath = () => {
    g.beginPath();
    g.moveTo(1392, 700);
    g.bezierCurveTo(1426, 684, 1474, 688, 1490, 704);
    g.bezierCurveTo(1494, 760, 1490, 820, 1496, 864);
    g.lineTo(1406, 870);
    g.bezierCurveTo(1410, 820, 1398, 760, 1392, 700);
    g.closePath();
  };
  throwPath();
  g.fillStyle = '#ece0c8';
  g.fill();
  throwPath(); g.clip();
  for (let x = 1396; x < 1500; x += 26) {
    g.fillStyle = 'rgba(79,114,160,0.55)'; g.fillRect(x, 690, 9, 190);
    g.fillStyle = 'rgba(181,83,74,0.35)'; g.fillRect(x + 14, 690, 3, 190);
  }
  for (let y = 700; y < 880; y += 30) {
    g.fillStyle = 'rgba(79,114,160,0.45)'; g.fillRect(1380, y, 130, 9);
    g.fillStyle = 'rgba(181,83,74,0.3)'; g.fillRect(1380, y + 15, 130, 3);
  }
  g.strokeStyle = 'rgba(90,70,50,0.25)'; g.lineWidth = 1.5;
  for (let cx = 1400; cx < 1500; cx += 9) {
    for (let y = 700; y < 872; y += 8) { g.beginPath(); g.moveTo(cx - 3, y); g.lineTo(cx, y + 5); g.lineTo(cx + 3, y); g.stroke(); }
  }
  g.fillStyle = linear(g, 1392, 0, 1500, 0, [[0, 'rgba(255,250,240,0.15)'], [1, 'rgba(40,30,20,0.3)']]);
  g.fillRect(1380, 680, 130, 200);
  g.restore();
  g.strokeStyle = '#e4d5b6'; g.lineWidth = 3; g.lineCap = 'round';
  for (let x = 1410; x < 1496; x += 7) { g.beginPath(); g.moveTo(x, 868); g.lineTo(x + 1, 884); g.stroke(); }
}

function drawSideTable(g) {
  const { cx, top } = TABLE;
  softShadow(g, cx, 874, 110, 16, 0.45);
  // tripod feet
  g.strokeStyle = '#4b2b1a';
  g.lineCap = 'round';
  g.lineWidth = 10;
  g.beginPath();
  g.moveTo(cx, 840); g.quadraticCurveTo(cx - 40, 850, cx - 72, 872);
  g.moveTo(cx, 840); g.quadraticCurveTo(cx + 40, 850, cx + 72, 872);
  g.moveTo(cx, 840); g.lineTo(cx, 878);
  g.stroke();
  // pedestal
  g.fillStyle = linear(g, cx - 14, 0, cx + 14, 0, [[0, '#a06a45'], [0.4, '#7a4a2e'], [1, '#3e2416']]);
  g.beginPath();
  g.moveTo(cx - 10, top + 14); g.lineTo(cx + 10, top + 14);
  g.bezierCurveTo(cx + 22, 770, cx + 6, 790, cx + 14, 846);
  g.lineTo(cx - 14, 846);
  g.bezierCurveTo(cx - 6, 790, cx - 22, 770, cx - 10, top + 14);
  g.fill();
  // top
  g.fillStyle = linear(g, 0, top, 0, top + 16, [[0, '#7a4a2e'], [1, '#3e2416']]);
  g.beginPath(); g.ellipse(cx, top + 6, 104, 18, 0, 0, Math.PI); g.fill();
  g.fillRect(cx - 104, top - 2, 208, 8);
  g.fillStyle = radial(g, cx - 20, top - 8, 120, [[0, '#b37b52'], [1, '#7a4a2e']]);
  g.beginPath(); g.ellipse(cx, top - 2, 104, 18, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(cx, top - 2, 104, 18, 0, 0, Math.PI * 2);
  texturePath(g, fibreCanvas(), 0.5);

  // lamp
  const lx = 590;
  g.fillStyle = 'rgba(30,15,5,0.35)';
  g.beginPath(); g.ellipse(lx + 6, top - 2, 30, 6, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = linear(g, lx - 26, 0, lx + 26, 0, [[0, '#7fb0a8'], [0.4, '#5a8f87'], [1, '#2f5a55']]);
  g.beginPath();
  g.moveTo(lx - 8, 626);
  g.bezierCurveTo(lx - 36, 650, lx - 30, 696, lx - 14, top - 2);
  g.lineTo(lx + 14, top - 2);
  g.bezierCurveTo(lx + 30, 696, lx + 36, 650, lx + 8, 626);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.beginPath(); g.ellipse(lx - 12, 660, 4, 14, 0.2, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#d9b46a';
  g.fillRect(lx - 3, 600, 6, 28);
  // shade is drawn in the glow pass so it reads as lit

  // teacup + saucer
  const tx = 652, ty = top - 4;
  g.fillStyle = '#efe3c6';
  g.beginPath(); g.ellipse(tx, ty, 24, 6, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = linear(g, tx - 16, 0, tx + 16, 0, [[0, '#fff7e6'], [1, '#cbb995']]);
  g.beginPath();
  g.moveTo(tx - 16, ty - 26); g.lineTo(tx + 16, ty - 26);
  g.quadraticCurveTo(tx + 16, ty - 2, tx, ty - 2);
  g.quadraticCurveTo(tx - 16, ty - 2, tx - 16, ty - 26);
  g.fill();
  g.strokeStyle = '#cbb995'; g.lineWidth = 3.5;
  g.beginPath(); g.arc(tx + 18, ty - 16, 7, -1.2, 1.4); g.stroke();
  g.fillStyle = '#7a4a2e';
  g.beginPath(); g.ellipse(tx, ty - 26, 16, 4, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#b5534a';
  g.fillRect(tx - 15, ty - 18, 30, 3);
}

function drawPouf(g) {
  const { cx, top } = POUF;
  softShadow(g, cx, 962, 86, 14, 0.5);
  const col = '#6f9e98';
  g.fillStyle = linear(g, cx - 72, 0, cx + 72, 0, [[0, shade(col, 0.15)], [0.5, col], [1, shade(col, -0.35)]]);
  g.beginPath();
  g.moveTo(cx - 70, top + 4);
  g.bezierCurveTo(cx - 80, top + 40, cx - 66, top + 58, cx, top + 60);
  g.bezierCurveTo(cx + 66, top + 58, cx + 80, top + 40, cx + 70, top + 4);
  g.closePath();
  g.fill();
  g.save();
  g.clip();
  g.strokeStyle = 'rgba(20,50,45,0.35)';
  g.lineWidth = 2;
  for (let k = -6; k <= 6; k++) {
    const x = cx + k * 11;
    for (let y = top + 6; y < top + 62; y += 8) {
      g.beginPath();
      g.moveTo(x - 4 + k * 0.4, y);
      g.lineTo(x + k * 0.5, y + 6);
      g.lineTo(x + 4 + k * 0.4, y);
      g.stroke();
    }
  }
  g.restore();
  g.fillStyle = radial(g, cx - 12, top - 4, 80, [[0, shade(col, 0.3)], [1, col]]);
  g.beginPath(); g.ellipse(cx, top + 4, 70, 16, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = shade(col, -0.3, 0.6);
  g.beginPath(); g.arc(cx, top + 4, 4, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(cx, top + 30, 80, 40, 0, 0, Math.PI * 2);
  texturePath(g, fibreCanvas(), 0.8);
}

function drawBasket(g) {
  const cx = 1530, base = 960;
  softShadow(g, cx, base, 64, 12, 0.5);
  // yarn balls peeking out
  const balls = [[-22, -50, 22, '#e89aa0'], [14, -54, 20, '#8fb7d6'], [-2, -64, 18, '#f2c46d']];
  for (const [bx, by, br, c] of balls) {
    g.fillStyle = radial(g, cx + bx - br * 0.3, base + by - br * 0.3, br * 1.3, [[0, shade(c, 0.3)], [1, shade(c, -0.25)]]);
    g.beginPath(); g.arc(cx + bx, base + by, br, 0, Math.PI * 2); g.fill();
    g.strokeStyle = shade(c, -0.3, 0.5); g.lineWidth = 1.5;
    for (let k = -2; k <= 2; k++) {
      g.beginPath(); g.ellipse(cx + bx, base + by, br * 0.9, br * 0.3 + Math.abs(k) * 2, 0.6 + k * 0.4, 0, Math.PI * 2); g.stroke();
    }
  }
  g.fillStyle = linear(g, cx - 60, 0, cx + 60, 0, [[0, '#d7b07a'], [0.5, '#b8894f'], [1, '#7d5a30']]);
  g.beginPath();
  g.moveTo(cx - 58, base - 50); g.lineTo(cx + 58, base - 50); g.lineTo(cx + 48, base); g.lineTo(cx - 48, base); g.closePath();
  g.fill();
  g.save(); g.clip();
  g.strokeStyle = 'rgba(80,50,20,0.45)'; g.lineWidth = 2;
  for (let y = base - 46; y < base; y += 8) {
    for (let x = cx - 60 + ((y / 8) % 2) * 6; x < cx + 60; x += 12) {
      g.beginPath(); g.ellipse(x, y, 5, 3, 0, 0, Math.PI * 2); g.stroke();
    }
  }
  g.restore();
  g.fillStyle = linear(g, 0, base - 56, 0, base - 44, [[0, '#e3c08a'], [1, '#8d6436']]);
  rr(g, cx - 62, base - 56, 124, 12, 6);
  g.fill();
}

const PROP_DEFS = [
  { id: 'armchair', box: [1160, 510, 360, 410], z: 900, draw: drawArmchair },
  { id: 'table', box: [530, 590, 230, 300], z: 871, draw: drawSideTable },
  { id: 'pouf', box: [370, 880, 200, 100], z: 964, draw: drawPouf },
  { id: 'basket', box: [1450, 870, 160, 110], z: 960, draw: drawBasket },
];

// The layout as data, so tools/blender/felt_room.py builds the 3D room to the same plan.
export const LAYOUT = {
  W, H, FLOOR_Y, FLOOR_LANE, SHELF, WIN, FIRE, TABLE, CHAIR, POUF, CANDLES, FAIRY, SPOTS,
  VIEW: [VIEW.x, VIEW.y, VIEW.w, VIEW.h],
  PROPS: PROP_DEFS.map(({ id, box, z }) => ({ id, box, z })),
};

// ---------------------------------------------------------------------------
// Sky (seen through the window)
// ---------------------------------------------------------------------------
function drawSkyBase(g) {
  const { x0, x1, sill } = WIN;
  g.fillStyle = linear(g, 0, 130, 0, sill, [[0, '#1d2a4a'], [0.55, '#33476e'], [1, '#6d7ea0']]);
  g.fillRect(x0 - 20, 120, x1 - x0 + 40, sill - 120);
  // moon
  const mx = 1050, my = 230;
  g.fillStyle = radial(g, mx, my, 120, [[0, 'rgba(255,245,215,0.45)'], [0.3, 'rgba(255,245,215,0.12)'], [1, 'rgba(255,245,215,0)']]);
  g.fillRect(mx - 130, my - 130, 260, 260);
  g.fillStyle = radial(g, mx - 8, my - 8, 34, [[0, '#fffbea'], [1, '#f2e2b6']]);
  g.beginPath(); g.arc(mx, my, 30, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(200,180,140,0.35)';
  for (const [cx, cy, cr] of [[-8, -6, 6], [9, 6, 4], [4, -12, 3]]) { g.beginPath(); g.arc(mx + cx, my + cy, cr, 0, Math.PI * 2); g.fill(); }
  // distant snowy hills + pines
  const hill = (base, amp, col, ph) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x0 - 20, sill);
    for (let x = x0 - 20; x <= x1 + 20; x += 10) g.lineTo(x, base + Math.sin(x * 0.012 + ph) * amp + Math.sin(x * 0.031 + ph) * amp * 0.4);
    g.lineTo(x1 + 20, sill);
    g.fill();
  };
  hill(520, 22, '#8d9cbc', 1.3);
  const r = makeRng(31);
  for (let i = 0; i < 16; i++) {
    const px = x0 + r() * (x1 - x0), py = 540 + r() * 30, ph = 28 + r() * 30;
    g.fillStyle = '#2c3a58';
    g.beginPath(); g.moveTo(px, py - ph); g.lineTo(px + ph * 0.32, py); g.lineTo(px - ph * 0.32, py); g.fill();
    g.fillStyle = 'rgba(230,238,255,0.55)';
    g.beginPath(); g.moveTo(px, py - ph); g.lineTo(px + ph * 0.12, py - ph * 0.6); g.lineTo(px - ph * 0.12, py - ph * 0.6); g.fill();
  }
  hill(575, 12, '#b9c4dc', 4.2);
  // cottage with warm window
  g.fillStyle = '#3a3550'; g.fillRect(860, 548, 44, 30);
  g.fillStyle = '#e8eefa';
  g.beginPath(); g.moveTo(854, 550); g.lineTo(882, 528); g.lineTo(910, 550); g.fill();
  g.fillStyle = '#ffcf7a'; g.fillRect(874, 558, 10, 10);
  hill(600, 8, '#dbe3f2', 2.2);
}

// ---------------------------------------------------------------------------
// Foreground plate: big out-of-focus shapes framing the corners (depth-of-field cue)
// ---------------------------------------------------------------------------
function drawForegroundPlate(g) {
  // bottom-left: trailing pothos in a pot, very close to camera
  const leaf = (x, y, a, sz, c) => {
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = radial(g, -sz * 0.2, sz * 0.3, sz * 1.2, [[0, shade(c, 0.25)], [1, shade(c, -0.25)]]);
    g.beginPath(); g.moveTo(0, 0);
    g.bezierCurveTo(sz * 0.75, -sz * 0.45, sz * 0.95, sz * 0.45, 0, sz);
    g.bezierCurveTo(-sz * 0.95, sz * 0.45, -sz * 0.75, -sz * 0.45, 0, 0);
    g.fill();
    g.strokeStyle = 'rgba(20,40,15,0.35)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, sz * 0.08); g.lineTo(0, sz * 0.86); g.stroke();
    g.restore();
  };
  const greens = ['#6f9a52', '#5b8a45', '#7fae5e', '#4e7a3c'];
  // a fan of big heart leaves curling in from the corner on thin stems
  const fan = [[-10, 1080, -0.2, 150], [60, 1090, 0.35, 120], [-30, 990, -0.9, 130], [130, 1100, 0.8, 110], [10, 930, -1.35, 105], [-60, 1060, -0.6, 140]];
  g.strokeStyle = '#4e7a3c'; g.lineWidth = 6; g.lineCap = 'round';
  fan.forEach(([x, y, a, sz], i) => {
    const bx = x + Math.sin(a + Math.PI) * sz * 0.2;
    g.beginPath(); g.moveTo(-40, 1110); g.quadraticCurveTo(bx - 20, y + 40, x, y); g.stroke();
    leaf(x, y, a + Math.PI, sz, greens[i % 4]);
  });
  // bottom-right: the edge of a chunky knitted pouf
  const cx = 1860, cy = 1120, rad = 230;
  g.fillStyle = radial(g, cx - 80, cy - 120, rad * 1.4, [[0, '#f3e8d2'], [1, '#b8a888']]);
  g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
  g.save();
  g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.clip();
  g.strokeStyle = 'rgba(110,90,60,0.4)'; g.lineWidth = 7; g.lineCap = 'round';
  for (let k = -9; k <= 9; k++) {
    const x = cx + k * 26;
    for (let y = cy - rad; y < cy + rad; y += 26) {
      g.beginPath(); g.moveTo(x - 11, y); g.lineTo(x, y + 16); g.lineTo(x + 11, y); g.stroke();
    }
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// Rendered felt room (assets/room, made by tools/blender/room.mjs)
// ---------------------------------------------------------------------------
const ROOM_DIR = 'assets/room/';

// Loads the Blender-rendered plates, props, light layers and light map, or resolves to null
// (no manifest, or ?room=procedural) so the canvas-drawn room is used instead.
async function loadRoom() {
  if (new URLSearchParams(location.search).get('room') === 'procedural') return null;
  try {
    const res = await fetch(ROOM_DIR + 'manifest.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const man = await res.json();
    // onload rather than decode(): decode() can stall while the page is in the background
    const image = (file) => new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error(`missing ${file}`));
      im.src = ROOM_DIR + file;
    });
    const group = async (name) => Object.fromEntries(await Promise.all(
      Object.entries(man[name] || {}).map(async ([id, v]) => [id, { ...v, img: await image(v.file) }])));
    const [plates, props, lights, lightmap] = await Promise.all([
      group('plates'), group('props'), group('lights'), man.lightmap ? image(man.lightmap) : null]);
    return { plates, props, lights, lightmap };
  } catch (e) {
    console.warn('Rendered room unavailable, drawing the canvas room instead', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scene class
// ---------------------------------------------------------------------------
export class Scene {
  constructor() {
    // undefined while we find out whether a rendered room exists; then the room or null
    this.room = undefined;
    this.ready = false;
    this.props = [];
    this.wantScale = 1;
    this.roomReady = loadRoom().then((room) => {
      this.room = room;
      this.lastScale = 0;
      this.build(this.wantScale);
      return room;
    });
    // never leave the room empty: if the rendered plates are slow, draw the canvas room meanwhile
    setTimeout(() => {
      if (this.room !== undefined) return;
      this.room = null;
      this.lastScale = 0;
      this.build(this.wantScale);
      this.room = undefined;
    }, 5000);
    this.stars = [];
    const r = makeRng(3);
    for (let i = 0; i < 46; i++) {
      this.stars.push({ x: WIN.x0 + r() * (WIN.x1 - WIN.x0), y: 140 + r() * 330, s: 0.6 + r() * 1.6, ph: r() * 10 });
    }
    this.snow = [];
    for (let i = 0; i < 90; i++) this.snow.push(this.newFlake(true));
    this.motes = [];
    for (let i = 0; i < 40; i++) {
      this.motes.push({ x: r.range(450, 1250), y: r.range(380, 900), vx: r.range(-4, 4), vy: r.range(-3, 2), ph: r() * 10, s: r.range(1, 2.4) });
    }
    // slow clouds that sometimes drift over the moon and dim the window light
    this.clouds = [
      { x: 720, y: 220, w: 260, v: 5.5 },
      { x: 1010, y: 300, w: 200, v: 4 },
    ];
    this.moonLight = 1;
    this.yarn = { x: 1060, y: 948, vx: 0, rot: 0, r: 17 };
    this.cam = { x: 0, y: 0 };
    this.lastScale = 0;
  }

  newFlake(anyY) {
    return {
      x: WIN.x0 - 40 + Math.random() * (WIN.x1 - WIN.x0 + 80),
      y: anyY ? 130 + Math.random() * 500 : 120,
      v: 14 + Math.random() * 22,
      s: 1 + Math.random() * 2.2,
      ph: Math.random() * 10,
    };
  }

  // (Re)render static plates at the given device pixel scale. Lighting is baked in once,
  // so per frame we only composite images plus a few live touches. With a rendered room the
  // plates are its images resampled once to the device scale; any piece it lacks is drawn.
  build(scale) {
    scale = Math.min(scale, 2.2);
    this.wantScale = scale;
    if (this.room === undefined) return;
    if (Math.abs(scale - this.lastScale) < 0.01) return;
    this.lastScale = scale;
    const R = this.room;
    const mk = (w, h, x, y, fn) => {
      const c = makeCanvas(w * scale, h * scale);
      const g = c.getContext('2d');
      g.scale(scale, scale);
      g.translate(-x, -y);
      fn(g);
      return c;
    };
    const image = (p) => mk(p.box[2], p.box[3], p.box[0], p.box[1], (g) => g.drawImage(p.img, ...p.box));
    const plate = (id) => R?.plates[id];
    this.lightmap = mk(W, H, 0, 0, (g) => this.drawLightmap(g));
    const lm = makeCanvas(96, 54);
    const lg = lm.getContext('2d', { willReadFrequently: true });
    // the cats are tinted by Blender's own light map when the room is rendered
    lg.drawImage(R?.lightmap || this.lightmap, 0, 0, 96, 54);
    this.lightData = lg.getImageData(0, 0, 96, 54).data;

    const bake = (c, x, y, w, h, extra = 1) => {
      const copy = makeCanvas(c.width, c.height);
      copy.getContext('2d').drawImage(c, 0, 0);
      const g = c.getContext('2d');
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'multiply';
      g.drawImage(this.lightmap, x * scale, y * scale, w * scale, h * scale, 0, 0, c.width, c.height);
      if (extra !== 1) {
        const v = Math.round(255 * extra);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(0, 0, c.width, c.height);
      }
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(copy, 0, 0);
      g.restore();
      return c;
    };

    // rendered plates cover only the view (plus a margin for the drift); drawn ones the room
    const full = [0, 0, W, H];
    this.backBox = plate('back')?.box || full;
    this.midBox = plate('mid')?.box || full;
    this.foreBox = plate('fore')?.box || full;
    this.back = plate('back') ? image(plate('back')) : bake(mk(W, H, 0, 0, drawBackLayer), 0, 0, W, H);
    this.mid = plate('mid') ? image(plate('mid')) : bake(mk(W, H, 0, 0, drawMidLayer), 0, 0, W, H);
    const pad = 40;
    if (plate('sky')) {
      this.sky = image(plate('sky'));
      this.skyBox = plate('sky').box;
    } else {
      this.sky = mk(WIN.x1 - WIN.x0 + pad * 2, WIN.sill - 120 + 20, WIN.x0 - pad, 110, (g) => {
        g.filter = `blur(${1.2 * scale}px)`; // far away: slightly soft
        drawSkyBase(g);
      });
      this.skyBox = [WIN.x0 - pad, 110, WIN.x1 - WIN.x0 + pad * 2, WIN.sill - 120 + 20];
    }
    this.cloud = mk(300, 110, 0, 0, (g) => {
      g.filter = `blur(${7 * scale}px)`;
      g.fillStyle = 'rgba(70,82,112,0.9)';
      for (const [x, y, rx, ry] of [[70, 62, 55, 26], [130, 50, 62, 34], [195, 60, 58, 26], [150, 70, 90, 22]]) {
        g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = 'rgba(150,165,200,0.5)';
      g.beginPath(); g.ellipse(125, 40, 50, 14, 0, 0, Math.PI * 2); g.fill();
    });
    this.props = PROP_DEFS.map((p) => {
      // a rendered prop brings its own box (it includes the prop's contact shadow)
      const r = R?.props[p.id];
      if (r) return { ...p, box: r.box, canvas: image(r) };
      return { ...p, canvas: bake(mk(p.box[2], p.box[3], p.box[0], p.box[1], p.draw), p.box[0], p.box[1], p.box[2], p.box[3]) };
    });
    // foreground: blurred and kept in shadow so it frames rather than distracts (the rendered
    // plate comes blurred and darkened already)
    if (plate('fore')) this.fore = image(plate('fore'));
    else {
      const fg = mk(W, H, 0, 0, drawForegroundPlate);
      this.fore = mk(W, H, 0, 0, (g) => {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.filter = `blur(${9 * scale}px)`;
        g.drawImage(fg, 0, 0);
      });
      bake(this.fore, 0, 0, W, H, 0.9);
    }
    // rendered light layers: the lit lamp shade and the logs in front of the flames
    const layer = (id) => (R?.lights[id] ? { box: R.lights[id].box, canvas: image(R.lights[id]) } : null);
    this.lampShade = layer('lampShade');
    this.fireLogs = layer('fireLogs');
    this.ready = true;
  }

  drawLightmap(g) {
    // Multiplied into the plates: cool ambient with warm pools of light. Kept fairly bright
    // because projectors crush dark values.
    g.fillStyle = 'rgb(150,138,152)';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    const pool = (x, y, r, c, sx = 1, sy = 1) => {
      g.save();
      g.translate(x, y);
      g.scale(sx, sy);
      g.fillStyle = radial(g, 0, 0, r, [[0, c], [1, 'rgba(0,0,0,0)']]);
      g.fillRect(-r, -r, r * 2, r * 2);
      g.restore();
    };
    pool(595, 640, 600, 'rgba(140,104,58,1)', 1.2, 0.95);
    pool(1700, 790, 620, 'rgba(140,86,48,1)', 1.1, 0.9);
    pool(960, 400, 340, 'rgba(80,92,122,1)', 1, 1.5);
    pool(1080, 860, 640, 'rgba(70,58,42,1)', 1.4, 0.6);
    // keep the outer edges darker so the eye stays in the middle
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = radial(g, W / 2, H * 0.58, W * 0.62, [[0, 'rgb(255,255,255)'], [0.7, 'rgb(225,220,225)'], [1, 'rgb(150,140,150)']]);
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
  }

  // Colour of the baked light at a point (0..255 + luminance 0..1), for lighting the cats.
  lightAt(x, y) {
    const ix = clamp(Math.floor((x / W) * 96), 0, 95);
    const iy = clamp(Math.floor((y / H) * 54), 0, 53);
    const i = (iy * 96 + ix) * 4;
    const d = this.lightData;
    if (!d) return { r: 255, g: 255, b: 255, l: 1 };
    return { r: d[i], g: d[i + 1], b: d[i + 2], l: (d[i] * 0.3 + d[i + 1] * 0.55 + d[i + 2] * 0.15) / 255 };
  }

  update(dt, t) {
    for (const f of this.snow) {
      f.y += f.v * dt;
      f.x += Math.sin(t * 0.8 + f.ph) * 8 * dt;
      if (f.y > WIN.sill) Object.assign(f, this.newFlake(false));
    }
    for (const m of this.motes) {
      m.x += (m.vx + Math.sin(t * 0.3 + m.ph) * 4) * dt;
      m.y += (m.vy + Math.cos(t * 0.25 + m.ph) * 3) * dt;
      if (m.x < 420) m.x = 1260; if (m.x > 1260) m.x = 420;
      if (m.y < 360) m.y = 900; if (m.y > 900) m.y = 360;
    }
    let cover = 0;
    for (const c of this.clouds) {
      c.x += c.v * dt;
      if (c.x > WIN.x1 + 80) c.x = WIN.x0 - c.w - 240 - Math.random() * 300;
      const cx = c.x + c.w / 2;
      cover = Math.max(cover, clamp(1 - Math.abs(cx - 1050) / (c.w * 0.55), 0, 1) * clamp(1 - Math.abs(c.y + 40 - 230) / 90, 0, 1));
    }
    this.moonLight = lerp(this.moonLight, 1 - cover * 0.6, 1 - Math.exp(-dt * 0.8));
    const y = this.yarn;
    y.x += y.vx * dt;
    y.rot += (y.vx * dt) / y.r;
    y.vx *= Math.pow(0.25, dt);
    if (Math.abs(y.vx) < 2) y.vx = 0;
    if (y.x < 760) { y.x = 760; y.vx = Math.abs(y.vx); }
    if (y.x > 1240) { y.x = 1240; y.vx = -Math.abs(y.vx); }
  }

  // translate the context for a layer with the given parallax factor
  at(ctx, f, fn) {
    ctx.save();
    ctx.translate(this.cam.x * f, this.cam.y * f);
    fn();
    ctx.restore();
  }

  drawBackground(ctx, t) {
    if (!this.ready) return;
    // sky: clipped by the window (back layer) but drifting even less → depth through the glass.
    // The rendered back plate is see-through only in the window, so its clip can be generous.
    this.at(ctx, LAYER.back, () => {
      windowPath(ctx, this.room ? -12 : 0);
      ctx.clip();
      const d = LAYER.sky - LAYER.back;
      ctx.translate(this.cam.x * d, this.cam.y * d);
      const [sx, sy, sw, sh] = this.skyBox;
      ctx.drawImage(this.sky, sx, sy, sw, sh);
      for (const s of this.stars) {
        const tw = 0.4 + 0.6 * noise1(t * 0.8 + s.ph * 7);
        ctx.fillStyle = `rgba(255,248,225,${0.35 + tw * 0.6})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.s * (0.6 + tw * 0.5), 0, Math.PI * 2); ctx.fill();
      }
      for (const c of this.clouds) ctx.drawImage(this.cloud, c.x, c.y, c.w, c.w * 110 / 300);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (const f of this.snow) {
        ctx.beginPath(); ctx.arc(f.x, f.y, f.s, 0, Math.PI * 2); ctx.fill();
      }
    });
    this.at(ctx, LAYER.back, () => ctx.drawImage(this.back, ...this.backBox));
    this.at(ctx, LAYER.mid, () => ctx.drawImage(this.mid, ...this.midBox));
  }

  drawForeground(ctx) {
    if (!this.ready) return;
    // a touch larger than its box, so its faster drift never shows an edge
    const [x, y, w, h] = this.foreBox;
    this.at(ctx, LAYER.fore, () => ctx.drawImage(this.fore, x - w / 96, y - h / 108, w * (1 + 1 / 48), h * (1 + 1 / 54)));
  }

  drawYarn(ctx) {
    const y = this.yarn;
    softShadow(ctx, y.x, y.y + 2, y.r * 1.3, 5, 0.45);
    ctx.save();
    ctx.translate(y.x, y.y - y.r);
    ctx.fillStyle = radial(ctx, -5, -6, y.r * 1.4, [[0, '#f6b9bd'], [0.7, '#e08a92'], [1, '#a9545e']]);
    ctx.beginPath(); ctx.arc(0, 0, y.r, 0, Math.PI * 2); ctx.fill();
    ctx.clip();
    ctx.rotate(y.rot);
    ctx.strokeStyle = 'rgba(140,50,60,0.45)';
    ctx.lineWidth = 1.6;
    for (let k = -3; k <= 3; k++) {
      ctx.beginPath(); ctx.ellipse(0, 0, y.r * 0.95, y.r * 0.25 + Math.abs(k) * 2.5, k * 0.45, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    // loose strand
    ctx.strokeStyle = '#e08a92';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(y.x + y.r * 0.6, y.y - 3);
    ctx.bezierCurveTo(y.x + 30, y.y + 6, y.x + 40, y.y - 4, y.x + 58, y.y + 4);
    ctx.stroke();
  }

  // Fire + candles: drawn before the lightmap so cats in front still occlude them,
  // then their glow is added afterwards.
  drawFire(ctx, t) {
    if (!this.ready) return;
    const { x0, x1, bottom } = FIRE.open;
    const cx = (x0 + x1) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, FIRE.open.top, x1 - x0, bottom - FIRE.open.top);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = radial(ctx, cx, bottom - 20, 120, [[0, 'rgba(255,140,50,0.5)'], [1, 'rgba(255,80,20,0)']]);
    ctx.fillRect(x0, FIRE.open.top, x1 - x0, bottom - FIRE.open.top);
    const tongues = 7;
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 0; i < tongues; i++) {
        const u = i / (tongues - 1) - 0.5;
        const bx = cx + u * 110;
        const n = noise1(t * 2.4 + i * 3.1 + layer * 11);
        const hgt = (layer ? 55 : 95) * (1 - Math.abs(u) * 0.9) * (0.65 + n * 0.6) + 20;
        const sway = (noise1(t * 1.7 + i * 5.3) - 0.5) * 22;
        const wdt = (layer ? 13 : 20) * (1 - Math.abs(u) * 0.4);
        const by = bottom - 24;
        const g = ctx.createLinearGradient(0, by, 0, by - hgt);
        if (layer) {
          g.addColorStop(0, 'rgba(255,250,210,0.95)');
          g.addColorStop(0.5, 'rgba(255,215,110,0.7)');
          g.addColorStop(1, 'rgba(255,180,60,0)');
        } else {
          g.addColorStop(0, 'rgba(255,190,80,0.85)');
          g.addColorStop(0.45, 'rgba(250,120,40,0.65)');
          g.addColorStop(1, 'rgba(200,50,20,0)');
        }
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(bx - wdt, by);
        ctx.bezierCurveTo(bx - wdt, by - hgt * 0.5, bx + sway * 0.5 - wdt * 0.3, by - hgt * 0.7, bx + sway, by - hgt);
        ctx.bezierCurveTo(bx + sway * 0.5 + wdt * 0.3, by - hgt * 0.7, bx + wdt, by - hgt * 0.5, bx + wdt, by);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    // front logs + embers (the rendered logs reach a little below the opening, so unclipped)
    if (this.fireLogs) {
      ctx.restore();
      ctx.save();
      const b = this.fireLogs.box;
      ctx.drawImage(this.fireLogs.canvas, b[0], b[1], b[2], b[3]);
    } else {
      drawLog(ctx, cx - 30, bottom - 12, 110, 22, 0.12);
      drawLog(ctx, cx + 34, bottom - 10, 100, 20, -0.16);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const ex = cx - 60 + i * 15;
      const a = 0.4 + 0.5 * noise1(t * 3 + i * 7);
      ctx.fillStyle = `rgba(255,${120 + i * 6},40,${a})`;
      ctx.beginPath(); ctx.arc(ex, bottom - 4 - (i % 3) * 2, 3 + (i % 2), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  drawProp(ctx, p) {
    ctx.drawImage(p.canvas, p.box[0], p.box[1], p.box[2], p.box[3]);
  }

  // Live light touches, each drawn on the parallax layer of the thing that emits it.
  drawGlow(ctx, t) {
    if (!this.ready) return;
    const fl = 0.85 + 0.15 * noise1(t * 4) + 0.08 * noise1(t * 11 + 3);
    const lampFl = 0.97 + 0.03 * noise1(t * 2.3 + 8);
    const tableF = depthFactor(871);

    this.at(ctx, LAYER.mid, () => {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = radial(ctx, 1700, 800, 520, [[0, `rgba(255,120,40,${0.2 * fl})`], [0.5, `rgba(255,100,30,${0.06 * fl})`], [1, 'rgba(255,80,20,0)']]);
      ctx.fillRect(1100, 300, 820, 780);
      // candles on the mantel
      CANDLES.forEach((c, i) => {
        const fy = FIRE.mantel - c.h - 6;
        const s = 0.85 + 0.25 * noise1(t * 6 + i * 4);
        const sway = (noise1(t * 3 + i * 9) - 0.5) * 3;
        ctx.fillStyle = radial(ctx, c.x, fy, 60, [[0, `rgba(255,190,100,${0.25 * s})`], [1, 'rgba(255,160,80,0)']]);
        ctx.fillRect(c.x - 60, fy - 60, 120, 120);
        ctx.fillStyle = radial(ctx, c.x, fy, 9 * s, [[0, 'rgba(255,250,220,1)'], [0.5, 'rgba(255,200,90,0.9)'], [1, 'rgba(255,140,40,0)']]);
        ctx.beginPath();
        ctx.moveTo(c.x - 4, fy + 4);
        ctx.quadraticCurveTo(c.x - 5, fy - 4, c.x + sway, fy - 12 * s);
        ctx.quadraticCurveTo(c.x + 5, fy - 4, c.x + 4, fy + 4);
        ctx.fill();
      });
      // moonlight through the window, dimming as clouds pass
      ctx.globalCompositeOperation = 'screen';
      const m = this.moonLight;
      ctx.fillStyle = linear(ctx, 0, 830, 0, 1000, [[0, `rgba(120,150,210,${0.14 * m})`], [1, 'rgba(120,150,210,0)']]);
      ctx.beginPath();
      ctx.moveTo(800, 830); ctx.lineTo(1120, 830); ctx.lineTo(1260, 1000); ctx.lineTo(880, 1000); ctx.closePath();
      ctx.fill();
    });

    this.at(ctx, LAYER.back, () => {
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, 960, 420, 300, [[0, `rgba(110,130,180,${0.12 * this.moonLight})`], [1, 'rgba(110,130,180,0)']]);
      ctx.fillRect(640, 100, 640, 640);
      ctx.globalCompositeOperation = 'lighter';
      for (const b of FAIRY) {
        const tw = 0.6 + 0.4 * noise1(t * 0.9 + b.ph);
        ctx.fillStyle = radial(ctx, b.x, b.y + 4, 26, [[0, rgba(b.hue, 0.45 * tw)], [1, rgba(b.hue, 0)]]);
        ctx.fillRect(b.x - 26, b.y - 22, 52, 52);
        ctx.fillStyle = rgba(b.hue, 0.95);
        ctx.beginPath(); ctx.ellipse(b.x, b.y + 5, 3.2, 4.2, 0, 0, Math.PI * 2); ctx.fill();
      }
    });

    this.at(ctx, tableF, () => {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = radial(ctx, 595, 620, 420, [[0, `rgba(255,190,110,${0.2 * lampFl})`], [0.4, 'rgba(255,170,90,0.06)'], [1, 'rgba(255,150,70,0)']]);
      ctx.fillRect(170, 200, 850, 840);
      ctx.globalCompositeOperation = 'source-over';
      // lamp shade (emissive)
      const lx = 590;
      if (this.lampShade) {
        const b = this.lampShade.box;
        ctx.drawImage(this.lampShade.canvas, b[0], b[1], b[2], b[3]);
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(lx - 34, 560); ctx.lineTo(lx + 34, 560); ctx.lineTo(lx + 62, 632); ctx.lineTo(lx - 62, 632); ctx.closePath();
        ctx.fillStyle = linear(ctx, 0, 560, 0, 632, [[0, '#f7dfae'], [1, '#ffeac2']]);
        ctx.fill();
        ctx.clip();
        ctx.fillStyle = linear(ctx, lx - 62, 0, lx + 62, 0, [[0, 'rgba(200,120,60,0.35)'], [0.4, 'rgba(255,255,255,0)'], [1, 'rgba(200,120,60,0.45)']]);
        ctx.fillRect(lx - 70, 555, 140, 80);
        ctx.strokeStyle = 'rgba(190,120,60,0.25)';
        ctx.lineWidth = 2;
        for (let k = -4; k <= 4; k++) { ctx.beginPath(); ctx.moveTo(lx + k * 7, 560); ctx.lineTo(lx + k * 13.5, 632); ctx.stroke(); }
        ctx.restore();
        ctx.fillStyle = '#c99a5a';
        ctx.fillRect(lx - 63, 629, 126, 4);
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = radial(ctx, lx, 600, 140, [[0, `rgba(255,200,120,${0.35 * lampFl})`], [1, 'rgba(255,170,90,0)']]);
      ctx.fillRect(lx - 150, 450, 300, 300);
      ctx.save();
      ctx.translate(lx, 640); ctx.scale(1, 0.25);
      ctx.fillStyle = radial(ctx, 0, 0, 90, [[0, 'rgba(255,220,150,0.5)'], [1, 'rgba(255,200,120,0)']]);
      ctx.fillRect(-90, -90, 180, 180);
      ctx.restore();
      // teacup steam
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(255,245,230,0.2)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let k = 0; k < 2; k++) {
        ctx.beginPath();
        const sx = 648 + k * 9;
        for (let i = 0; i <= 12; i++) {
          const yy = 672 - i * 5;
          const xx = sx + Math.sin(t * 1.6 + i * 0.5 + k * 2) * (2 + i * 0.5);
          i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
        }
        ctx.stroke();
      }
    });

    // dust motes drifting through the lamp light
    this.at(ctx, 0.8, () => {
      ctx.globalCompositeOperation = 'lighter';
      for (const m of this.motes) {
        const a = 0.25 + 0.25 * Math.sin(t * 0.7 + m.ph);
        const d = Math.hypot(m.x - 595, (m.y - 620) * 1.3);
        const vis = clamp(1 - d / 420, 0, 1) + clamp(1 - Math.abs(m.x - 960) / 200, 0, 1) * 0.4 * this.moonLight;
        if (vis <= 0.02) continue;
        ctx.fillStyle = `rgba(255,230,180,${a * vis})`;
        ctx.beginPath(); ctx.arc(m.x, m.y, m.s, 0, Math.PI * 2); ctx.fill();
      }
    });
  }

  drawPost(ctx, t) {
    // light vignette (projectors already lose the edges) + felt grain
    ctx.save();
    const v = VIEW;
    ctx.fillStyle = radial(ctx, v.x + v.w / 2, v.y + v.h * 0.55, v.w * 0.62, [[0, 'rgba(20,10,6,0)'], [0.7, 'rgba(20,10,6,0.08)'], [1, 'rgba(20,10,6,0.35)']]);
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.06;
    ctx.globalCompositeOperation = 'overlay';
    const pat = ctx.createPattern(grainCanvas(), 'repeat');
    const step = Math.floor(t * 12) % 4;
    ctx.translate(step * 61, step * 37);
    ctx.fillStyle = pat;
    ctx.fillRect(-300, -300, W + 600, H + 600);
    ctx.restore();
  }
}
