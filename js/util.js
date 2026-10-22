// Shared helpers: logical canvas size, maths, seeded randomness and drawing utilities.

export const W = 1920;
export const H = 1080;
export const FLOOR_Y = 830;

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Mulberry32 – deterministic so the room looks the same every time.
export function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (a, b) => a + next() * (b - a);
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  return next;
}

// Smooth 1D value noise for flicker / sway.
const NP = new Float32Array(512);
{
  const r = makeRng(99);
  for (let i = 0; i < 512; i++) NP[i] = r();
}
export function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const a = NP[i & 511];
  const b = NP[(i + 1) & 511];
  return lerp(a, b, smooth(f));
}

export function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Lighten (amt > 0) or darken (amt < 0) a hex colour, returns rgb() string.
export function shade(hex, amt, alpha = 1) {
  const [r, g, b] = hexToRgb(hex);
  const f = (c) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  return alpha === 1 ? `rgb(${f(r)},${f(g)},${f(b)})` : `rgba(${f(r)},${f(g)},${f(b)},${alpha})`;
}

export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

// A tileable soft noise texture used for the felt/fabric grain.
let grainCache = null;
export function grainCanvas() {
  if (grainCache) return grainCache;
  const size = 256;
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const r = makeRng(7);
  for (let i = 0; i < size * size; i++) {
    const v = 128 + (r() - 0.5) * 120;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainCache = c;
  return c;
}

// Fibrous texture: lots of tiny short strokes, gives a woolly / felt surface.
let fibreCache = null;
export function fibreCanvas() {
  if (fibreCache) return fibreCache;
  const size = 256;
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, size, size);
  const r = makeRng(11);
  g.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {
    const x = r() * size;
    const y = r() * size;
    const a = r() * Math.PI * 2;
    const l = 2 + r() * 5;
    const v = r() > 0.5 ? 255 : 0;
    g.strokeStyle = `rgba(${v},${v},${v},${0.08 + r() * 0.12})`;
    g.lineWidth = 0.6 + r() * 0.8;
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l);
        g.stroke();
      }
    }
  }
  fibreCache = c;
  return c;
}

// Fill the current path with a texture in 'soft-light' so it keeps the base colour.
export function texturePath(ctx, tex, alpha = 0.5, mode = 'soft-light', scale = 1) {
  ctx.save();
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = mode;
  const pat = ctx.createPattern(tex, 'repeat');
  if (scale !== 1 && pat.setTransform) pat.setTransform(new DOMMatrix().scale(scale));
  ctx.fillStyle = pat;
  ctx.fillRect(-4000, -4000, 8000, 8000);
  ctx.restore();
}

export function radial(ctx, x, y, r, stops) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

export function linear(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

export function softShadow(ctx, x, y, rx, ry, alpha = 0.35) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  ctx.fillStyle = radial(ctx, 0, 0, rx, [
    [0, `rgba(30,15,8,${alpha})`],
    [0.6, `rgba(30,15,8,${alpha * 0.55})`],
    [1, 'rgba(30,15,8,0)'],
  ]);
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
