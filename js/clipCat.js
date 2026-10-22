// Pre-rendered cats: plays a cat's alpha video clips (see ASSETS.md) instead of the procedural
// rig. A cat uses clips when assets/cats/<slug>/manifest.json exists and its clips load;
// otherwise it keeps the rig. The clip is picked from the same behaviour state the rig reads
// (pose, current segment, ground speed), so cats.js stays the only place behaviour lives.
//
// Debug URL flags: ?clips=off (rig only), ?clipset=biscuit (every cat uses that set).

const ROOT = 'assets/cats/';
const FADE = 0.22; // s cross-dissolve between clips, hides small pose mismatches at the seams
const SLOTS = 3;   // video elements per cat: showing, fading out, loading

// A set must have these; anything else falls back to a near neighbour (null = skip it).
const REQUIRED = ['walk', 'stand', 'sit', 'loaf', 'sleepLoop'];
const FALLBACK = {
  sniff: 'stand', groom: 'sit', yawn: 'sit', alert: 'sit', nuzzle: 'sit', bat: 'sit', wake: 'loaf',
  knead: 'loaf', stretch: 'stand', crouch: 'stand', jump: 'stand', land: 'stand',
  turn: null, circle: null, settle: null,
};
const POSE_CLIP = {
  stand: 'stand', walk: 'walk', sniff: 'sniff', sit: 'sit', look: 'sit', groom: 'groom', yawn: 'yawn',
  loaf: 'loaf', sleep: 'sleepLoop', wake: 'wake', nuzzle: 'nuzzle', alert: 'alert', stretch: 'stretch',
  knead: 'knead', crouch: 'crouch', bat: 'bat', jump: 'jump',
};
// In-between clips played when one clip follows another. `from` is where to start (a fraction
// of the clip, or 'here' for where the outgoing clip is); `reverse` steps it backwards, so
// `wake` run back from its end is the cat lowering its head and closing its eyes: dozing off.
const BRIDGE = {
  'knead>loaf': { clip: 'settle' },
  'loaf>sleepLoop': { clip: 'wake', from: 0.8, reverse: true },
  'settle>sleepLoop': { clip: 'wake', from: 0.8, reverse: true },
  'wake>sleepLoop': { clip: 'wake', from: 'here', reverse: true },
};
const REVERSE_RATE = 0.7; // clip seconds per second when stepping a clip backwards
// Resting changes of pose dissolve more slowly than the 0.22 s default, so a dozing cat drifts.
const REST = new Set(['sit', 'loaf', 'sleepLoop', 'wake', 'groom', 'yawn', 'alert']);
const REST_FADE = 0.45;
const SLOW_FADE = { 'loaf>sleepLoop': 0.9, 'wake>loaf': 0.5, 'sit>stand': 0.4 };
// Without a `wake` clip, loaf → sleep waits for the loaf's slow blink (eyelids closing at u ≈ 0.55–0.64 of the loop),
// so the head goes down as the eyes close rather than at a random moment.
const DOZE_OFF = [0.55, 0.64];
// Loops whose breathing pace varies a little from cycle to cycle, so a long rest never ticks.
const CYCLE_RATE = { loaf: [0.84, 1], sleepLoop: [0.72, 0.9] };
// A loafing cat's ear flick: the tail of `wake` (eyelids half down, ears flick), then back.
const TWITCH_FROM = 0.72; // of the wake clip's length
const TWITCH_HOLD = 0.6;  // s on its last frame before easing back into the loaf

export const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const params = new URLSearchParams(location.search);
const DISABLED = params.get('clips') === 'off';
const OVERRIDE = params.get('clipset');
// Safari plays VP9 WebM but drops its alpha, so it gets the HEVC-with-alpha .mov files.
const SAFARI = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
const EXT = SAFARI ? 'mov' : 'webm';
const MIME = SAFARI ? 'video/quicktime' : 'video/webm';

const sets = new Map(); // slug → loaded set, or null when the cat has no clips

async function loadSet(name) {
  const base = `${ROOT}${name}/`;
  let m;
  try {
    const res = await fetch(base + 'manifest.json');
    if (!res.ok) return null;
    m = await res.json();
  } catch { return null; }
  if (!(m.formats || ['webm']).includes(EXT)) return null;
  if (!document.createElement('video').canPlayType(SAFARI ? 'video/mp4; codecs="hvc1"' : 'video/webm; codecs="vp9"')) return null;
  const urls = {};
  // whole files in memory as blob URLs: instant seeks and loops, no server range support needed
  await Promise.all(Object.keys(m.clips).map(async (c) => {
    try {
      const r = await fetch(`${base}${c}.${EXT}`);
      if (r.ok) urls[c] = URL.createObjectURL(new Blob([await r.arrayBuffer()], { type: MIME }));
    } catch {}
  }));
  const missing = REQUIRED.filter((c) => !urls[c]);
  if (missing.length) {
    console.warn(`Cat clips for "${name}" are missing ${missing.join(', ')}; using the procedural rig.`);
    return null;
  }
  const [fw, fh] = m.frame;
  const [ax, ay] = m.anchor;
  const ppu = m.pxPerUnit;
  const fps = m.fps || 24;
  const dur = Object.fromEntries(Object.entries(m.clips).map(([c, d]) => [c, (d.frames || 1) / (d.fps || fps)]));
  return { name, m, urls, fps, dur, ax, ay, ppu, box: { l: ax / ppu, t: ay / ppu, w: fw / ppu, h: fh / ppu } };
}

// Fetch every cat's set up front. A cat that arrives before its set is ready uses the rig
// for that whole visit, so a cat never switches renderer mid-walk.
export function preloadClipSets(defs) {
  if (DISABLED) return Promise.resolve();
  const names = OVERRIDE ? [OVERRIDE] : defs.map((d) => slug(d.name));
  return Promise.all(names.map(async (n) => { sets.set(n, await loadSet(n)); }));
}

export class ClipCatRenderer {
  static for(def) {
    const set = sets.get(OVERRIDE || slug(def.name));
    return set ? new ClipCatRenderer(set) : null;
  }

  constructor(set) {
    this.set = set;
    this.box = set.box;
    this.slots = [];
    for (let i = 0; i < SLOTS; i++) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      const slot = { v, clip: null, sign: 1, ready: false, from: 0, reverse: false, rt: 0 };
      // a clip that starts part-way in is ready once it has seeked there
      v.addEventListener('loadeddata', () => { if (slot.from || slot.reverse) v.currentTime = slot.from; else slot.ready = true; });
      v.addEventListener('seeked', () => { if (slot.from || slot.reverse) slot.ready = true; });
      this.slots.push(slot);
    }
    this.cur = null;     // slot on screen
    this.prev = null;    // slot fading out
    this.pending = null; // slot loading its first frame
    this.fade = 1;
    this.fadeDur = FADE;
    this.facing = 0;
    this.lastFlick = -1;
    this.twitch = null; // { held } while an ear-flick insert plays
  }

  has(clip) { return !!this.set.urls[clip]; }

  resolve(clip) {
    while (clip && !this.has(clip)) clip = FALLBACK[clip];
    return clip || 'stand';
  }

  ended(slot) {
    const v = slot.v;
    if (slot.reverse) return slot.rt <= 0 && !v.seeking && v.currentTime <= 0.001;
    return v.ended || (v.duration > 0 && v.currentTime >= v.duration - 0.5 / this.set.fps);
  }

  // What the behaviour is doing right now, as a clip, plus how long it should last (0 = natural).
  wanted(cat) {
    const seg = cat.seg;
    if (seg && seg.type === 'jump') {
      if (seg.t < seg.crouch) return { clip: 'crouch', fit: seg.crouch };
      if (seg.t < seg.crouch + seg.air) return { clip: 'jump', fit: seg.air };
      return { clip: 'land', fit: seg.land };
    }
    if (cat.clip === 'circle' && cat.state === 'settling' && this.has('circle')) return { clip: 'circle', fit: 0 };
    if (seg && seg.type === 'walk') return { clip: 'walk', fit: 0 };
    if (this.twitch) {
      if (cat.poseName === 'loaf' && !seg) return { clip: 'wake', fit: 0, from: this.set.dur.wake * TWITCH_FROM };
      this.twitch = null;
    }
    return { clip: POSE_CLIP[cat.poseName] || 'sit', fit: 0 };
  }

  // unitSpeed: ground speed in cat units per second (world speed ÷ the cat's draw scale)
  update(cat, dt, unitSpeed) {
    if (!this.facing) this.facing = cat.dir;
    this.updateTwitch(cat, dt);
    const want = this.wanted(cat);
    const at = this.pending || this.cur;
    let next = want.clip, fit = want.fit, bridgeTo = null, from = want.from || 0, reverse = false;

    if (cat.dir !== this.facing && want.clip !== 'circle') {
      const jumping = cat.seg && cat.seg.type === 'jump';
      if (jumping || !this.has('turn')) this.facing = cat.dir; // the cross-dissolve covers the flip
      else if (at && at.clip === 'turn' && at.sign === this.facing && at === this.cur && this.ended(at)) this.facing = cat.dir;
      else { next = 'turn'; fit = 0; from = 0; }
    } else if (at && at.bridgeTo === next) {
      // let the bridge play out
      if (!(at === this.cur && this.ended(at))) ({ clip: next, from, reverse, bridgeTo } = at);
    } else if (at && at.clip !== next) {
      const b = BRIDGE[`${at.clip}>${next}`];
      if (b && this.has(b.clip)) {
        bridgeTo = next; next = b.clip; fit = 0; reverse = !!b.reverse;
        from = b.from === 'here' ? at.v.currentTime : (b.from || 0) * this.set.dur[b.clip];
      }
    }
    const clip = this.resolve(next);
    if (clip !== next) { next = clip; from = 0; reverse = false; }
    if (next === 'sleepLoop' && at && at === this.cur && at.clip === 'loaf' && !this.dozeReady(at)) next = 'loaf';
    const same = (slot) => slot.clip === next && slot.sign === this.facing && slot.from === from && slot.reverse === reverse;
    const c0 = this.cur;
    if (this.pending && c0 && same(c0)) {
      // changed its mind before the new clip showed (walk → stand → walk): keep what's playing
      this.pending.v.pause();
      this.pending = null;
    } else if (!at || !same(at)) this.start(next, this.facing, fit, bridgeTo, from, reverse);

    // promote the loading clip once its first frame is decoded, so nothing ever blinks out
    const p = this.pending;
    if (p && p.ready) {
      this.pending = null;
      if (this.prev) this.prev.v.pause();
      this.prev = this.cur;
      this.cur = p;
      this.fade = this.prev ? 0 : 1;
      this.fadeDur = this.prev ? this.fadeFor(this.prev.clip, p.clip) : FADE;
      if (!p.reverse) p.v.play().catch(() => {});
    }
    if (this.prev) {
      this.fade += dt / this.fadeDur;
      if (this.fade >= 1) { this.prev.v.pause(); this.prev = null; this.fade = 1; }
    }

    // playback rate: the walk follows ground speed, jump phases stretch to fit the arc
    const c = this.cur;
    if (c && c.reverse) {
      // browsers can't play backwards: step by seeking, holding the first frame through the
      // fade-in. Each seek waits until the last one's frame has been drawn (a seek in flight
      // leaves nothing to draw), so it steps at about half the game's frame rate.
      if (!this.prev) c.rt -= dt * REVERSE_RATE;
      const to = Math.max(0, c.rt);
      if (!c.v.seeking && c.shown && c.v.currentTime > to + 0.001) { c.shown = false; c.v.currentTime = to; }
    } else if (c) {
      let rate = 1;
      if (c.clip === 'walk') {
        rate = unitSpeed / (this.set.m.walkSpeed || 56);
      } else if (c.fit) rate = this.set.dur[c.clip] / c.fit;
      else if (CYCLE_RATE[c.clip]) {
        // pick a fresh pace each time the loop comes round
        const t = c.v.currentTime;
        if (!c.cycleRate || t < c.lastT - 0.1) {
          const [a, b] = CYCLE_RATE[c.clip];
          c.cycleRate = a + Math.random() * (b - a);
        }
        c.lastT = t;
        rate = c.cycleRate;
      }
      rate = Math.round(Math.min(4, Math.max(0.1, rate)) * 20) / 20;
      if (c.v.playbackRate !== rate) c.v.playbackRate = rate;
    }
  }

  fadeFor(a, b) {
    return SLOW_FADE[`${a}>${b}`] || (REST.has(a) && REST.has(b) ? REST_FADE : FADE);
  }

  // Is the loaf at its slow blink, the moment to curl up into sleep?
  dozeReady(slot) {
    const v = slot.v;
    if (!(v.duration > 0)) return true;
    const u = v.currentTime / v.duration;
    return u >= DOZE_OFF[0] && u <= DOZE_OFF[1];
  }

  // Start an ear-flick insert when the behaviour flicks a loafing cat's ear, and end it once
  // the insert has played and held for a beat.
  updateTwitch(cat, dt) {
    const f = cat.flickT;
    const flicked = f >= 0 && (this.lastFlick < 0 || f < this.lastFlick);
    this.lastFlick = f;
    const c = this.cur;
    if (!this.twitch) {
      if (flicked && cat.state === 'resting' && cat.poseName === 'loaf' && !cat.seg && this.has('wake') &&
        c && c.clip === 'loaf' && !this.pending && !this.prev) this.twitch = { held: 0 };
      return;
    }
    if (c && c.clip === 'wake' && c.from && !c.reverse && this.ended(c)) {
      this.twitch.held += dt;
      if (this.twitch.held > TWITCH_HOLD) this.twitch = null;
    }
  }

  start(clip, sign, fit, bridgeTo, from = 0, reverse = false) {
    let slot = this.pending;
    if (!slot) {
      slot = this.slots.find((s) => s !== this.cur && s !== this.prev);
      if (!slot) { slot = this.prev; slot.v.pause(); this.prev = null; this.fade = 1; }
    }
    slot.clip = clip;
    slot.sign = sign;
    slot.fit = fit;
    slot.bridgeTo = bridgeTo;
    slot.from = from;
    slot.reverse = reverse;
    slot.rt = from;
    slot.cycleRate = 0;
    slot.ready = false;
    slot.v.loop = !!this.set.m.clips[clip].loop;
    slot.v.src = this.set.urls[clip];
    this.pending = slot;
  }

  // False for a moment while a looping clip wraps (Chrome drops to HAVE_METADATA as it seeks
  // back to 0); the cat then keeps its last sprite instead of blinking out for a frame.
  drawable() {
    return !!this.cur && this.cur.v.readyState >= 2 && (!this.prev || this.prev.v.readyState >= 2);
  }

  // Draw into the cat's sprite canvas, k = canvas pixels per cat unit.
  draw(g, k) {
    const { ax, ay, ppu } = this.set;
    const s = k / ppu;
    const put = (slot, alpha, op) => {
      if (!slot || slot.v.readyState < 2) return;
      slot.shown = true;
      g.globalAlpha = alpha;
      g.globalCompositeOperation = op;
      g.setTransform(s * slot.sign, 0, 0, s, this.box.l * k, this.box.t * k);
      g.drawImage(slot.v, -ax, -ay);
    };
    g.imageSmoothingQuality = 'high';
    if (this.prev && this.fade < 1) {
      // premultiplied cross-dissolve: (1-f)·old + f·new, so overlapping fur never turns see-through
      put(this.prev, 1 - this.fade, 'source-over');
      put(this.cur, this.fade, 'lighter');
    } else put(this.cur, 1, 'source-over');
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  dispose() {
    for (const s of this.slots) { s.v.pause(); s.v.removeAttribute('src'); s.v.load(); }
  }
}
