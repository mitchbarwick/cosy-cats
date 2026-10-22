// Writes every clip's per-frame rig pose (tools/clip-maker/clips.js) plus the cat's look to JSON,
// for felt_cat.py to pose the 3D cat from. Usage: node tools/blender/export-poses.mjs <cat> <out.json>
import { writeFileSync } from 'node:fs';
import { CAT_DEFS, mottle } from '../../js/catArt.js';
import { CLIPS, FRAME, ANCHOR, PPU, FPS, STRIDE } from '../clip-maker/clips.js';

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const [cat = 'biscuit', out = 'poses.json'] = process.argv.slice(2);
const def = CAT_DEFS.find((d) => slug(d.name) === cat);
if (!def) throw new Error(`No cat called ${cat}`);

const clips = {};
for (const [name, c] of Object.entries(CLIPS)) {
  const frames = [];
  for (let i = 0; i < c.frames; i++) {
    const u = c.loop ? i / c.frames : i / Math.max(1, c.frames - 1);
    const f = c.frame(u);
    frames.push({
      p: f.p, yaw: f.yaw ?? 0, blink: f.blink ?? 1, lookX: f.lookX ?? 0,
      earFlick: f.earFlick ?? 0, alert: f.alert ?? 0,
    });
  }
  clips[name] = { loop: !!c.loop, frames };
}
const walkSpeed = +(STRIDE / (CLIPS.walk.frames / FPS)).toFixed(2);
// tortie blobs come from the rig's own seeded generator, so both renderers share one coat
const look = def.pattern === 'tortie' ? { ...def, mottle: mottle(def) } : def;
writeFileSync(out, JSON.stringify({ cat, def: look, frame: FRAME, anchor: ANCHOR, pxPerUnit: PPU, fps: FPS, walkSpeed, clips }));
console.log(`${Object.keys(clips).length} clips → ${out}`);
