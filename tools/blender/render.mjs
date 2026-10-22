// Renders a cat's full clip set in Blender and installs it in assets/cats/<cat>/.
//
//   node tools/blender/render.mjs biscuit [clip,clip...]
//
// Steps: export the rig poses (export-poses.mjs) → pose and render a felt 3D cat in Blender
// (felt_cat.py, Eevee, RGBA PNGs) → encode each clip to VP9-alpha WebM with ffmpeg → write
// manifest.json. Set BLENDER / FFMPEG to the exe (or its folder) if they aren't on PATH.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const [cat = 'biscuit', only] = process.argv.slice(2);

function tool(envName, exe, guesses) {
  let p = process.env[envName];
  if (p && existsSync(p) && statSync(p).isDirectory()) p = join(p, exe);
  if (p) return p;
  return guesses.find((g) => existsSync(g)) || exe;
}
const blender = tool('BLENDER', 'blender.exe', [
  'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
  'D:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
]);
const ffmpeg = tool('FFMPEG', 'ffmpeg', []);

const work = join(tmpdir(), 'cosy-cats-blender', cat);
const frames = join(work, 'frames');
const poses = join(work, 'poses.json');
mkdirSync(work, { recursive: true });

const run = (cmd, args, label) => {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
  if (r.status !== 0) {
    console.error(String(r.stdout).slice(-3000), String(r.stderr).slice(-3000));
    throw new Error(`${label} failed (${r.error || r.status})`);
  }
  console.log(`${label}: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return String(r.stdout);
};

run(process.execPath, [join(here, 'export-poses.mjs'), cat, poses], 'poses');
const spec = JSON.parse(readFileSync(poses, 'utf8'));
const clips = only ? only.split(',') : Object.keys(spec.clips);
for (const c of clips) rmSync(join(frames, c), { recursive: true, force: true });
run(blender, ['-b', '--factory-startup', '--python', join(here, 'felt_cat.py'), '--',
  '--poses', poses, '--out', frames, '--clips', clips.join(','), '--samples', '48'], 'blender');

const out = join(root, 'assets', 'cats', cat);
mkdirSync(out, { recursive: true });
for (const c of clips) {
  run(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(spec.fps), '-i', join(frames, c, '%04d.png'),
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30', '-auto-alt-ref', '0',
    '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', join(out, `${c}.webm`)], `encode ${c}`);
}

const manifestPath = join(out, 'manifest.json');
const old = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { clips: {} };
const manifest = {
  version: 1,
  note: 'Rendered in Blender by tools/blender (felt_cat.py), posed from the procedural rig.',
  frame: spec.frame, anchor: spec.anchor, pxPerUnit: spec.pxPerUnit, fps: spec.fps,
  walkSpeed: spec.walkSpeed,
  formats: ['webm'],
  clips: { ...old.clips },
};
for (const c of clips) {
  const d = spec.clips[c];
  manifest.clips[c] = d.loop ? { frames: d.frames.length, loop: true } : { frames: d.frames.length };
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`installed ${clips.length} clips in assets/cats/${cat}/`);
