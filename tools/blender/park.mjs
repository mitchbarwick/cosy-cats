// Renders the felt park in Blender and installs the plates in assets/park/.
//
//   node tools/blender/park.mjs [--passes far,mid,...] [--scale 1.2] [--samples 64] [--beauty]
//
// Steps: read the park's layout from js/park.js (PARK_LAYOUT, so the 3D park is built to the same
// plan as the cats' PARK_SPOTS) → build and render it with felt_park.py (Eevee, one RGBA render
// per plate and prop, plus a light map for tinting the cats) → write assets/park/manifest.json.
// `--beauty` renders one quick all-in preview with the sit spots marked instead (work folder
// only). Set BLENDER to the exe (or its folder) if it isn't found.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? def : argv[i + 1];
};

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

const { PARK_LAYOUT } = await import(pathToFileURL(join(root, 'js', 'park.js')));
const { LAYOUT } = await import(pathToFileURL(join(root, 'js', 'scene.js')));
const layoutData = { ...PARK_LAYOUT, VIEW: LAYOUT.VIEW };
const work = opt('work', join(tmpdir(), 'cosy-cats-blender', 'park'));
mkdirSync(work, { recursive: true });
const layout = join(work, 'layout.json');
writeFileSync(layout, JSON.stringify(layoutData, null, 1));

const out = join(root, 'assets', 'park');
const args = ['-b', '--factory-startup', '--python', join(here, 'felt_park.py'), '--',
  '--layout', layout, '--work', work, '--out', out,
  '--scale', opt('scale', String(+(LAYOUT.W / LAYOUT.VIEW[2]).toFixed(3))), '--samples', opt('samples', '64')];
if (argv.includes('--beauty')) args.push('--beauty', '1');
const passes = opt('passes');
if (passes) args.push('--passes', passes);
const save = opt('save');
if (save) args.push('--save', save);

const t0 = Date.now();
const r = spawnSync(blender, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
const log = String(r.stdout);
for (const line of log.split('\n')) if (/^(PASS|WROTE|NOTE|WARN)/.test(line)) console.log(line.trim());
if (r.status !== 0 || /Traceback|Error:/.test(log) || /Traceback/.test(String(r.stderr))) {
  console.error(log.slice(-4000), String(r.stderr).slice(-3000));
  throw new Error(`blender failed (${r.error || r.status})`);
}
console.log(`blender: ${((Date.now() - t0) / 1000).toFixed(0)} s → ${argv.includes('--beauty') ? work : out}`);
