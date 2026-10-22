import { clamp, lerp } from './util.js';
import { Scene, LAYER, VIEW, depthFactor } from './scene.js';
import { CatWorld } from './cats.js';
import { AudioEngine } from './audio.js';
import { Session, MIN_MINUTES, MAX_MINUTES } from './session.js';

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const audio = new AudioEngine();
const scene = new Scene();
const world = new CatWorld(scene, audio);
const session = new Session();
world.onDepart = (def) => session.departed(def);
world.onRecall = (def) => session.recalled(def);

// ---------------------------------------------------------------- settings
const SETTINGS_KEY = 'cosy-cats-settings-v3';
const settings = {
  limit: 0.55, sens: 2, strict: 'normal', music: true, catSounds: true, chime: true, saver: true,
  minutes: 15, activity: '', useMic: true,
};
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch {}
const save = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} };
// seconds the room must stay over the limit before a cat wanders off
const GRACE = { gentle: 6, normal: 4, strict: 2.6 };

function bindRange(id, key, fmt) {
  const el = $(id);
  const out = $(id + 'Val');
  el.value = settings[key];
  const show = () => { out.textContent = fmt(settings[key]); };
  el.addEventListener('input', () => { settings[key] = parseFloat(el.value); show(); apply(); save(); });
  show();
}
bindRange('limit', 'limit', (v) => `${Math.round(v * 100)}%`);
bindRange('sens', 'sens', (v) => `×${v.toFixed(1)}`);
$('strict').value = settings.strict;
$('strict').addEventListener('change', () => { settings.strict = $('strict').value; save(); });
for (const key of ['music', 'catSounds', 'chime', 'saver']) {
  const el = $(key);
  el.checked = settings[key];
  el.addEventListener('change', () => { settings[key] = el.checked; apply(); save(); });
}
let teacherPaused = false;
function apply() {
  audio.sensitivity = settings.sens;
  audio.catSounds = settings.catSounds;
  audio.setMusic(settings.music && !teacherPaused);
  $('noiseLimit').style.left = `${settings.limit * 100}%`;
}
apply();

$('settingsToggle').addEventListener('click', () => $('settings').classList.toggle('hidden'));
$('fullscreenBtn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});
$('micBtn').addEventListener('click', () => enableMic());

async function enableMic() {
  if (audio.micOn) return true;
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

// ---------------------------------------------------------------- the session picker
const chips = [...document.querySelectorAll('#lengths button')];
const custom = $('customMin');
function showLength() {
  const chip = chips.find((b) => +b.dataset.min === settings.minutes);
  chips.forEach((b) => b.classList.toggle('on', b === chip));
  custom.classList.toggle('on', !chip);
  if (!chip) custom.value = settings.minutes;
}
chips.forEach((b) => b.addEventListener('click', () => { settings.minutes = +b.dataset.min; custom.value = ''; showLength(); }));
custom.addEventListener('input', () => {
  const v = Math.round(+custom.value);
  if (v >= MIN_MINUTES) { settings.minutes = Math.min(MAX_MINUTES, v); chips.forEach((b) => b.classList.remove('on')); custom.classList.add('on'); }
});
$('activity').value = settings.activity;
$('useMic').checked = settings.useMic;
showLength();

$('picker').addEventListener('submit', async (e) => {
  e.preventDefault();
  settings.minutes = clamp(Math.round(settings.minutes), MIN_MINUTES, MAX_MINUTES);
  settings.activity = $('activity').value.trim();
  settings.useMic = $('useMic').checked;
  save();
  audio.init();
  await audio.ctx.resume();
  audio.startMusic();
  apply();
  $('intro').classList.add('gone');
  if (settings.useMic) await enableMic();
  startSession();
});

const activityName = () => settings.activity || 'Quiet time';

function startSession() {
  session.start(settings.minutes, activityName());
  Object.assign(noise, { state: 'calm', loud: 0, cooldown: 0, settle: 0, leftMsg: 0 });
  world.alert = false;
  $('activityTag').textContent = activityName();
  $('activityTag').classList.remove('hidden');
  $('endCard').classList.add('hidden');
  setHudMode();
}

// ---------------------------------------------------------------- pause, extend, end, reset
// Pause: the clock stops, nobody arrives or leaves, and every animal sits up and faces the room.
function setPaused(on) {
  if (on && !session.active) return;
  teacherPaused = on;
  if (on) { world.alert = false; noise.state = 'calm'; noise.loud = 0; }
  else noise.settle = Math.max(noise.settle, 4); // a moment to settle back before anyone new arrives
  apply();
  $('pausedBanner').classList.toggle('hidden', !on);
  setHudMode();
}
$('pauseBtn').addEventListener('click', () => {
  if (session.state === 'done') newSession();
  else setPaused(!teacherPaused);
});
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.target.closest('input, textarea, select, button')) return;
  e.preventDefault();
  if (session.active) setPaused(!teacherPaused);
});

// Undo: the animal that just wandered off comes back, and the room gets a fresh start.
$('undoBtn').addEventListener('click', () => {
  if (!world.recall()) return;
  Object.assign(noise, { state: 'calm', loud: 0, cooldown: 8, leftMsg: 0 });
  world.alert = false;
});

function extend(minutes) {
  const wasDone = session.state === 'done';
  session.extend(minutes * 60);
  if (wasDone) {
    celebrateUntil = 0;
    $('endCard').classList.add('hidden');
    $('activityTag').classList.remove('hidden');
  }
  setHudMode();
}
for (const [id, m] of [['plus1', 1], ['plus5', 5], ['endPlus1', 1], ['endPlus5', 5]]) $(id).addEventListener('click', () => extend(m));
$('endNow').addEventListener('click', () => { if (session.active) { setPaused(false); session.elapsed = session.length; } });
$('endClose').addEventListener('click', () => $('endCard').classList.add('hidden'));
$('endNew').addEventListener('click', () => newSession());

// Time's up: everyone sits up and faces the room for a moment, a soft chime, hearts, then the
// animals stay to doze in the room the class filled. Nobody new comes and nobody leaves.
let celebrateUntil = 0;
function finish() {
  setPaused(false);
  world.departed = [];
  world.alert = false;
  celebrateUntil = world.time + 3.5;
  if (settings.chime) audio.endChime();
  world.cheer();
  const cats = world.catCount;
  const toby = !!world.toby;
  $('endTitle').textContent = `${activityName()} done!`;
  $('endText').textContent = cats === 0 ? 'The cats will come and visit next time'
    : `${cats} ${cats === 1 ? 'cat' : 'cats'}${toby ? ' and Toby' : ''} came to visit`;
  setTimeout(() => { if (session.state === 'done') $('endCard').classList.remove('hidden'); }, 1200);
  setHudMode();
}

// A new session starts with an empty room: a gentle fade, then the picker.
function newSession() {
  setPaused(false);
  $('fader').classList.add('on');
  $('endCard').classList.add('hidden');
  setTimeout(() => {
    world.reset();
    session.state = 'setup';
    session.elapsed = 0;
    celebrateUntil = 0;
    $('activityTag').classList.add('hidden');
    $('minuteNote').classList.add('hidden');
    $('intro').classList.remove('gone');
    setHudMode();
    $('fader').classList.remove('on');
  }, 750);
}

function minuteNote() {
  const el = $('minuteNote');
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

// ---------------------------------------------------------------- noise state machine
// calm ──(loud for LOOK_UP s)──▶ restless: cats look up, nobody leaves yet
// restless ──(loud for the strictness grace in total)──▶ one cat gently wanders off, then a cooldown
// restless ──(back under the lower threshold until the loud timer drains)──▶ calm
// The band between the two thresholds holds the timers, so a cough or a dropped pencil does nothing.
const LOOK_UP = 1.5;
const hud = $('hud');
const noise = { state: 'calm', loud: 0, cooldown: 0, settle: 0, leftMsg: 0 };

function updateNoise(dt) {
  const level = audio.readLevel(dt);
  // noise only matters while a session is running and not paused
  if (!session.active || world.paused) return level;
  const hi = settings.limit;
  const lo = settings.limit * 0.8;
  const grace = Math.max(GRACE[settings.strict] || 4, LOOK_UP + 1);
  if (level > hi) noise.loud += dt;
  else if (level < lo) noise.loud = Math.max(0, noise.loud - dt * 0.7);
  noise.cooldown = Math.max(0, noise.cooldown - dt);
  noise.leftMsg = Math.max(0, noise.leftMsg - dt);
  if (noise.settle > 0 && level < lo) noise.settle -= dt;

  if (noise.state === 'calm' && noise.loud > LOOK_UP) {
    noise.state = 'restless';
    world.alert = true;
  }
  if (noise.state === 'restless') {
    if (noise.loud >= grace && noise.cooldown <= 0 && world.count > 0) {
      world.removeCat();
      noise.cooldown = 8;
      noise.loud = LOOK_UP + 0.1;
      noise.leftMsg = 5;
    }
    if (noise.loud <= 0) {
      noise.state = 'calm';
      world.alert = false;
      noise.settle = 8; // stay calm a little while before anyone new walks in
    }
  }
  return level;
}

// ---------------------------------------------------------------- session clock
function updateSession(dt) {
  world.paused = teacherPaused || world.time < celebrateUntil;
  if (session.active && !teacherPaused) {
    const calm = noise.state === 'calm' && noise.settle <= 0;
    const ev = session.tick(dt, { calm, cats: world.catCount, toby: !!world.toby });
    if (ev.arrive) { world.addCat(); session.arrived(); }
    if (ev.toby && world.addToby()) session.tobyArrived();
    if (ev.minute) minuteNote();
    if (ev.end) finish();
  }
  // the room keeps time: deeper night, settling fire, brighter lights for the last minute
  const done = session.state === 'done';
  const k = 1 - Math.exp(-dt * 1.5);
  scene.progress = session.state === 'setup' ? lerp(scene.progress, 0, k) : session.progress;
  scene.finale = lerp(scene.finale, session.state === 'final' ? 1 : 0, k);
  scene.reward = lerp(scene.reward, done ? 1 : 0, k);
  // music fades over the last 30 s, then comes back softly for the finished room
  const level = session.active ? clamp(session.remaining / 30, 0, 1)
    : done ? (world.time < celebrateUntil ? 0 : 0.45) : 0.7;
  audio.setMusicLevel(level);
}

// ---------------------------------------------------------------- HUD
const fill = $('noiseFill');
const status = $('noiseStatus');
const arc = $('nextCatArc');
let lastCount = -1;

function setHudMode() {
  const done = session.state === 'done';
  hud.classList.toggle('paused', teacherPaused);
  hud.classList.toggle('idle', !session.active);
  $('pauseBtn').classList.toggle('on', teacherPaused);
  $('pauseIcon').textContent = done ? '↺' : teacherPaused ? '▶' : '⏸';
  $('pauseLabel').textContent = done ? 'New session' : teacherPaused ? 'Resume' : 'Pause';
  $('pauseBtn').title = done ? 'Start a new session' : 'Pause (Space)';
}

function timeLeft() {
  if (session.state === 'setup') return `${settings.minutes} min`;
  if (session.state === 'done') return "Time's up";
  const r = session.remaining;
  return r > 60 ? `${Math.ceil(r / 60)} min left` : 'Final minute';
}

function updateHud(level) {
  fill.style.width = `calc(${clamp(level, 0, 1) * 100}% - 6px)`;
  fill.style.setProperty('--bar-w', `${$('noiseBar').clientWidth}px`);
  const ratio = level / settings.limit;
  hud.classList.toggle('loud', session.active && ratio > 1);
  hud.classList.toggle('restless', noise.state === 'restless');
  let msg;
  if (session.state === 'done') msg = 'All done. Enjoy the room!';
  else if (teacherPaused) msg = 'Paused';
  else if (!audio.micOn) msg = 'Mic off';
  else if (noise.leftMsg > 0) msg = 'A cat wandered off for a nap';
  else if (noise.state === 'restless') msg = 'The cats are listening…';
  else if (ratio > 0.8) msg = 'Getting noisy…';
  else if (ratio > 0.45) msg = 'Nice and calm';
  else msg = 'Lovely and quiet';
  status.textContent = msg;
  arc.style.strokeDashoffset = 94.25 * (1 - (session.state === 'setup' ? 0 : session.progress));
  $('nextCatLabel').textContent = timeLeft();
  const cats = world.catCount;
  const toby = !!world.toby;
  const key = cats * 2 + toby;
  if (key !== lastCount) {
    lastCount = key;
    $('catCountNum').textContent = cats;
    $('catCountLabel').textContent = (cats === 1 ? 'cat visiting' : 'cats visiting') + (toby ? ' + Toby 🐶' : '');
  }
  const back = session.active && world.recallable;
  $('undo').classList.toggle('hidden', !back);
  if (back) $('undoText').textContent = `${back.name} wandered off`;
}

// ---------------------------------------------------------------- testing
$('addCat').addEventListener('click', () => { audio.init(); world.addCat() || world.addToby(); });
$('removeCat').addEventListener('click', () => world.removeCat());
$('skipMin').addEventListener('click', () => { if (session.active) session.elapsed = Math.min(session.length - 1, session.elapsed + 60); });

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
  updateSession(dt);
  updateHud(level);
  render(t);
}
setHudMode();
requestAnimationFrame(frame);

window.cosy = {
  world, audio, scene, settings, noise, session,
  // debug: jump the session clock forward
  skip(sec) { if (session.active) session.elapsed = Math.min(session.length - 0.01, session.elapsed + sec); },
  // debug: fill the room instantly with settled animals
  fill(n = 10) {
    $('intro').classList.add('gone');
    for (let i = 0; i < n; i++) {
      const c = world.addCat() || world.addToby();
      if (!c) break;
      c.waitClips = 0;
      const s = c.spot;
      c.queue = []; c.seg = null;
      c.x = s.x; c.y = s.y; c.z = s.z ?? s.y; c.scale = s.scale || 0.95;
      c.dir = s.facing || 1; c.dirVis = c.dir;
      c.arrived = true;
      c.rest(s.poses.includes('loaf') && Math.random() < 0.5 ? 'loaf' : 'sit');
    }
  },
};
