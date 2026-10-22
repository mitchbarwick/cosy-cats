import { clamp } from './util.js';
import { Scene, LAYER, VIEW, depthFactor } from './scene.js';
import { CatWorld } from './cats.js';
import { AudioEngine } from './audio.js';

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const audio = new AudioEngine();
const scene = new Scene();
const world = new CatWorld(scene, audio);

// ---------------------------------------------------------------- settings
const SETTINGS_KEY = 'cosy-cats-settings-v2';
const settings = { limit: 0.55, sens: 2, interval: 60, grace: 4, music: true, catSounds: true, saver: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch {}
const save = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} };

function bindRange(id, key, fmt) {
  const el = $(id);
  const out = $(id + 'Val');
  el.value = settings[key];
  const show = () => { out.textContent = fmt(settings[key]); };
  el.addEventListener('input', () => { settings[key] = parseFloat(el.value); show(); apply(); save(); });
  show();
}
const fmtTime = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60 ? (s % 60) + 's' : ''}`.trim() : `${s}s`);
bindRange('limit', 'limit', (v) => `${Math.round(v * 100)}%`);
bindRange('sens', 'sens', (v) => `×${v.toFixed(1)}`);
bindRange('interval', 'interval', fmtTime);
bindRange('grace', 'grace', (v) => `${v}s`);
for (const key of ['music', 'catSounds', 'saver']) {
  const el = $(key);
  el.checked = settings[key];
  el.addEventListener('change', () => { settings[key] = el.checked; apply(); save(); });
}
function apply() {
  audio.sensitivity = settings.sens;
  audio.catSounds = settings.catSounds;
  audio.setMusic(settings.music);
  $('noiseLimit').style.left = `${settings.limit * 100}%`;
}
apply();

$('settingsToggle').addEventListener('click', () => $('settings').classList.toggle('hidden'));
$('addCat').addEventListener('click', () => { audio.init(); world.addCat(); });
$('removeCat').addEventListener('click', () => world.removeCat());
$('fullscreenBtn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});
$('micBtn').addEventListener('click', () => enableMic());

async function enableMic() {
  try {
    await audio.startMic();
    $('micBtn').textContent = 'Microphone on';
    $('micBtn').disabled = true;
    return true;
  } catch (e) {
    console.warn('Mic unavailable', e);
    $('noiseStatus').textContent = 'Microphone blocked';
    return false;
  }
}

async function start(withMic) {
  audio.init();
  await audio.ctx.resume();
  audio.startMusic();
  apply();
  $('intro').classList.add('gone');
  if (withMic) await enableMic();
  // a first visitor so the room never feels empty for long
  setTimeout(() => world.addCat(), 2500);
}
$('startBtn').addEventListener('click', () => start(true));
$('startNoMicBtn').addEventListener('click', () => start(false));

// ---------------------------------------------------------------- noise state machine
// calm ──(loud for LOOK_UP s)──▶ restless: cats look up, nobody leaves yet
// restless ──(loud for `grace` s in total)──▶ one cat gently wanders off, then a cooldown
// restless ──(back under the lower threshold until the loud timer drains)──▶ calm
// calm: after a short settle period, quiet time slowly fills the "next visitor" ring.
// The band between the two thresholds holds the timers, so a cough or a dropped pencil does nothing.
const LOOK_UP = 1.5;
const noise = { state: 'calm', loud: 0, quiet: 0, cooldown: 0, settle: 0, leftMsg: 0 };

function updateNoise(dt) {
  const level = audio.readLevel(dt);
  const hi = settings.limit;
  const lo = settings.limit * 0.8;
  const grace = Math.max(settings.grace, LOOK_UP + 1);
  if (level > hi) noise.loud += dt;
  else if (level < lo) noise.loud = Math.max(0, noise.loud - dt * 0.7);
  noise.cooldown = Math.max(0, noise.cooldown - dt);
  noise.leftMsg = Math.max(0, noise.leftMsg - dt);

  if (noise.state === 'calm' && noise.loud > LOOK_UP) {
    noise.state = 'restless';
    world.alert = true;
  }
  if (noise.state === 'restless') {
    noise.quiet = Math.max(0, noise.quiet - dt * 0.5);
    if (noise.loud >= grace && noise.cooldown <= 0 && world.count > 0) {
      world.removeCat();
      noise.cooldown = 8;
      noise.loud = LOOK_UP + 0.1;
      noise.quiet = 0;
      noise.leftMsg = 5;
    }
    if (noise.loud <= 0) {
      noise.state = 'calm';
      world.alert = false;
      noise.settle = 8; // stay calm a little while before new visitors come
    }
  } else if (level < lo) {
    if (noise.settle > 0) noise.settle -= dt;
    else if (world.count < world.capacity) {
      noise.quiet += dt * (level < hi * 0.5 ? 1 : 0.6);
      if (noise.quiet >= settings.interval) {
        world.addCat();
        noise.quiet = 0;
      }
    }
  }
  return level;
}

// ---------------------------------------------------------------- HUD
const hud = $('hud');
const fill = $('noiseFill');
const status = $('noiseStatus');
const arc = $('nextCatArc');
let lastCount = -1;
function updateHud(level) {
  fill.style.width = `calc(${clamp(level, 0, 1) * 100}% - 6px)`;
  fill.style.setProperty('--bar-w', `${$('noiseBar').clientWidth}px`);
  const ratio = level / settings.limit;
  hud.classList.toggle('loud', ratio > 1);
  hud.classList.toggle('restless', noise.state === 'restless');
  let msg;
  if (!audio.micOn) msg = 'Mic off';
  else if (noise.leftMsg > 0) msg = 'A cat wandered off for a nap';
  else if (noise.state === 'restless') msg = 'The cats are listening…';
  else if (ratio > 0.8) msg = 'Getting noisy…';
  else if (ratio > 0.45) msg = 'Nice and calm';
  else msg = 'Lovely and quiet';
  status.textContent = msg;
  const full = world.count >= world.capacity;
  arc.style.strokeDashoffset = full ? 0 : 94.25 * (1 - noise.quiet / settings.interval);
  $('nextCatLabel').textContent = full ? 'Library full!' : 'Next visitor';
  if (world.count !== lastCount) {
    lastCount = world.count;
    $('catCountNum').textContent = lastCount;
    $('catCountLabel').textContent = lastCount === 1 ? 'cat visiting' : 'cats visiting';
  }
}

// ---------------------------------------------------------------- render
// The screen shows VIEW, the chair-led crop of the room. The room (and the rendered plates'
// margins) carries on past it, so the parallax drift never shows an edge.
let view = { s: 1, ox: 0, oy: 0, dpr: 1 };
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vw = window.innerWidth, vh = window.innerHeight;
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
  const s = Math.max(vw / VIEW.w, vh / VIEW.h);
  view = { s, ox: (vw - VIEW.w * s) / 2 - VIEW.x * s, oy: (vh - VIEW.h * s) / 2 - VIEW.y * s, dpr };
  scene.build(s * dpr);
}
window.addEventListener('resize', resize);
resize();

function render(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1b1310';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let { s, ox, oy, dpr } = view;
  const z = window.cosy?.zoom; // debug: { x, y, k } zooms the camera onto a point
  if (z) { s *= z.k; ox = innerWidth / 2 - z.x * s; oy = innerHeight / 2 - z.y * s; }
  ctx.setTransform(s * dpr, 0, 0, s * dpr, ox * dpr, oy * dpr);
  ctx.imageSmoothingQuality = 'high';
  world.pixelScale = s * dpr;

  // slow, breathing camera drift; layers follow it by depth
  scene.cam.x = Math.sin(t * 0.045) * 11 + Math.sin(t * 0.017 + 1) * 6;
  scene.cam.y = Math.sin(t * 0.031) * 4;

  scene.drawBackground(ctx, t);
  scene.at(ctx, LAYER.mid, () => scene.drawFire(ctx, t));
  const items = [
    ...scene.props.map((p) => ({ z: p.z, draw: (c) => scene.drawProp(c, p) })),
    { z: scene.yarn.y, draw: (c) => scene.drawYarn(c) },
    ...world.drawables(),
  ].sort((a, b) => a.z - b.z);
  for (const it of items) scene.at(ctx, depthFactor(it.z), () => it.draw(ctx, t));

  scene.drawGlow(ctx, t);
  scene.at(ctx, 0.85, () => world.drawOverlay(ctx));
  scene.drawForeground(ctx);
  scene.drawPost(ctx, t);
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  // battery saver: 30 fps is plenty for a calm scene and keeps old laptops quiet
  if (settings.saver && now - last < 1000 / 30 - 2) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  scene.update(dt, t);
  world.update(dt);
  const level = updateNoise(dt);
  updateHud(level);
  render(t);
}
requestAnimationFrame(frame);

window.cosy = {
  world, audio, scene, settings, noise,
  // debug: fill the room instantly with settled cats
  fill(n = 10) {
    $('intro').classList.add('gone');
    for (let i = 0; i < n; i++) {
      const c = world.addCat();
      if (!c) break;
      const s = c.spot;
      c.queue = []; c.seg = null;
      c.x = s.x; c.y = s.y; c.z = s.z ?? s.y; c.scale = s.scale || 0.95;
      c.dir = s.facing || 1; c.dirVis = c.dir;
      c.arrived = true;
      c.rest(s.poses.includes('loaf') && Math.random() < 0.5 ? 'loaf' : 'sit');
    }
  },
};
