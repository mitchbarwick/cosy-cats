// Renders a placeholder clip set for one cat from the procedural rig, frame by frame, to the
// ASSETS.md spec (512×448, feet at the anchor, facing right), and has server.js encode each
// clip to VP9-alpha WebM. Loops are built from whole cycles so they repeat without a seam,
// and every loop starts on its neutral pose so the one-shot clips that lead into it end there.
import { CAT_DEFS, drawCat, applyTurn } from '../../js/catArt.js';
import { slug } from '../../js/clipCat.js';
import { CLIPS, FRAME, ANCHOR, PPU, FPS, STRIDE } from './clips.js';

const canvas = document.getElementById('frame');
canvas.width = FRAME[0];
canvas.height = FRAME[1];
const ctx = canvas.getContext('2d');
const log = (msg) => { document.getElementById('log').textContent += msg + '\n'; };

function renderFrame(def, f) {
  const turn = f.turn ?? 1;
  const p = applyTurn(f.p, turn);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, FRAME[0], FRAME[1]);
  ctx.setTransform(PPU * (turn < 0 ? -1 : 1), 0, 0, PPU, ANCHOR[0], ANCHOR[1]);
  drawCat(ctx, { ...def, size: 1 }, p, {
    t: 0, blink: f.blink ?? 1, lookX: f.lookX ?? 0, earFlick: f.earFlick ?? 0, alert: f.alert ?? 0,
  });
}

const post = (url, body) => fetch(url, { method: 'POST', body }).then((r) => r.json());

export async function makeSet(def, only) {
  const cat = slug(def.name);
  const names = only ? only.split(',') : Object.keys(CLIPS);
  for (const clip of names) {
    const c = CLIPS[clip];
    const t0 = performance.now();
    await post(`/api/begin?cat=${cat}&clip=${clip}`);
    for (let i = 0; i < c.frames; i++) {
      const u = c.loop ? i / c.frames : i / Math.max(1, c.frames - 1);
      renderFrame(def, c.frame(u));
      // toDataURL rather than toBlob: toBlob callbacks crawl when the tab is in the background
      const png = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), (ch) => ch.charCodeAt(0));
      await post(`/api/frame?cat=${cat}&clip=${clip}&i=${i}`, png);
    }
    const r = await post(`/api/encode?cat=${cat}&clip=${clip}&fps=${FPS}`);
    log(`${clip}: ${c.frames} frames → ${r.ok ? `${(r.bytes / 1024).toFixed(0)} KB` : 'FAILED ' + r.error} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    if (!r.ok) throw new Error(r.error);
  }
  const manifest = {
    version: 1,
    note: 'Placeholder clips rendered from the procedural rig by tools/clip-maker. Replace with Blender renders.',
    frame: FRAME, anchor: ANCHOR, pxPerUnit: PPU, fps: FPS,
    walkSpeed: +(STRIDE / (CLIPS.walk.frames / FPS)).toFixed(2),
    formats: ['webm'],
    clips: Object.fromEntries(Object.entries(CLIPS).map(([k, c]) => [k, c.loop ? { frames: c.frames, loop: true } : { frames: c.frames }])),
  };
  await post(`/api/manifest?cat=${cat}`, JSON.stringify(manifest));
  log(`manifest.json written for ${def.name}`);
  return manifest;
}

// UI: pick a cat, preview any clip, render the set
const sel = document.getElementById('cat');
for (const d of CAT_DEFS) sel.add(new Option(d.name, d.name));
const clipSel = document.getElementById('clip');
for (const k of Object.keys(CLIPS)) clipSel.add(new Option(k, k));
let previewing = true;
let start = performance.now();
clipSel.addEventListener('change', () => { start = performance.now(); });
(function preview(now) {
  requestAnimationFrame(preview);
  if (!previewing) return;
  const c = CLIPS[clipSel.value];
  const i = Math.floor(((now - start) / 1000) * FPS);
  const n = c.loop ? i % c.frames : Math.min(i % (c.frames + 12), c.frames - 1);
  renderFrame(CAT_DEFS.find((d) => d.name === sel.value), c.frame(c.loop ? n / c.frames : n / Math.max(1, c.frames - 1)));
})(performance.now());

document.getElementById('go').addEventListener('click', async () => {
  previewing = false;
  try { await makeSet(CAT_DEFS.find((d) => d.name === sel.value)); log('done'); } catch (e) { log('error: ' + e.message); }
  previewing = true;
});
window.clipMaker = { makeSet, CLIPS, CAT_DEFS, stopPreview: () => { previewing = false; } };
