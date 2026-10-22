// Cat behaviour. Each cat runs a queue of small actions (walk, jump, hold a pose, turn) built
// by routines that read like a cat's day: arrive → sniff → circle → knead → curl up → doze…
// Every routine also names a `clip` (enter, circle, settle, sleepLoop, wake, leave…) so the
// procedural rig can later be swapped for pre-rendered video clips (see ASSETS.md).
import { lerp, clamp, rand, pick, softShadow, noise1, rr, makeCanvas } from './util.js';
import { SPOTS, FLOOR_LANE, VIEW, floorScale } from './scene.js';
import { CAT_DEFS, TOBY, ANIMAL_DEFS, POSE_FLAT, unflat, drawCat, applyTurn, shapeFor } from './catArt.js';
import { ClipCatRenderer, preloadClipSets } from './clipCat.js';

export const CAT_SCALE = 1.2;          // cats read clearly from the back of a classroom
const WALK_SPEED = 66;
// Cats enter and leave just past the edges of the VIEW: far enough that the camera drift
// (±17 px) and the cat's own length never show, close enough that they appear straight away.
const VIEW_MID = VIEW.x + VIEW.w / 2;
const EXIT_PAD = 40;   // px beyond the view edge, on top of the cat's reach
const CLIP_WAIT = 12;   // s an arriving cat waits off-stage for its clips before coming in on the rig
const REACH = 100;     // cat units from the feet to the nose or tail tip, side-on
const SPR = { l: 170, t: 240, w: 340, h: 280 }; // sprite box in cat-local units (origin at feet)

const isFloorSpot = (s) => s.route.length === 1;
const isDog = (def) => def.species === 'dog';
// dogs only use dog spots, cats never do
const spotFits = (s, def) => !!s.dog === isDog(def);
const RECALL_WINDOW = 30; // s the undo button offers to bring a departed cat back
// Floor x just out of sight on one side (-1 left, 1 right) for a cat walking at row y.
const offstageX = (def, side, y) => {
  const reach = REACH * floorScale(y) * def.size * CAT_SCALE + EXIT_PAD;
  return side < 0 ? VIEW.x - reach : VIEW.x + VIEW.w + reach;
};
const COSY = new Set(['loaf', 'sleep']);
const isCosySpot = (s) => s.poses.some((p) => COSY.has(p));

// What a resting cat may drift into next. Changes are gradual: no sit → sleep jumps.
const NEXT = {
  sit: ['groom', 'loaf', 'look', 'sit', 'yawn'],
  groom: ['sit', 'sit', 'loaf'],
  look: ['sit'],
  yawn: ['sit', 'loaf'],
  loaf: ['sleep', 'sleep', 'loaf', 'sit', 'groom'],
  sleep: ['wake'],
  wake: ['yawn', 'loaf', 'loaf'],
  nuzzle: ['sit'],
  alert: ['sit'],
};
const ALWAYS_OK = new Set(['sit', 'look', 'yawn', 'wake', 'groom']);
const DURATION = {
  sit: [7, 14], groom: [4, 7], look: [3, 6], yawn: [1.6, 1.8], loaf: [12, 26], sleep: [30, 75], wake: [2.5, 4],
};

class Cat {
  constructor(def, world) {
    this.def = def;
    this.world = world;
    this.x = 0; this.y = FLOOR_LANE; this.z = FLOOR_LANE;
    this.scale = floorScale(FLOOR_LANE);
    this.dir = 1; this.dirVis = 1;
    this.turnRate = 6;
    this.poseName = 'walk';
    this.cur = POSE_FLAT.walk.slice();
    this.walkPhase = Math.random() * 6; this.walkAmt = 0;
    this.gait = rand(0.88, 1.1);
    this.queue = [];
    this.seg = null;
    this.spot = null;
    this.state = 'arriving';
    this.clip = 'enter';
    this.restUntil = 0;
    this.nextBlink = rand(1, 4); this.blinkT = 0;
    this.lookX = 0; this.lookTarget = 0; this.nextLook = rand(3, 8);
    this.flickT = -1; this.nextFlick = rand(5, 14);
    this.settledAt = 0; this.resettleAfter = rand(100, 200);
    this.alertAmt = 0; this.alerted = false; this.relaxAt = 0;
    this.wiggle = 0;
    this.nextSound = rand(30, 80);
    this.nextZ = 0;
    this.label = 0;
    this.age = 0;
    this.busy = null;
    this.attending = false; this.front = 0; // paused: sitting up, facing the room
  }

  // --- action queue ----------------------------------------------------------
  walkTo(x, y, opts = {}) { this.queue.push({ type: 'walk', x, y, speed: (opts.speed || WALK_SPEED) * this.gait, inPlace: !!opts.inPlace }); }
  jumpTo(pt, scale) { this.queue.push({ type: 'jump', x: pt.x, y: pt.y, z: pt.z ?? pt.y, scale }); }
  hold(t, pose, clip) { this.queue.push({ type: 'wait', wait: t, pose, clip }); }
  turn(dir) { this.queue.push({ type: 'turn', dir }); }
  call(fn) { this.queue.push({ type: 'call', fn }); }
  flick() { this.flickT = 0; }

  routeScale(i, spot) {
    const pt = spot.route[i];
    if (i === spot.route.length - 1 && spot.scale) return spot.scale;
    if (pt.z && pt.z !== pt.y) return (spot.scale || 0.82) + 0.04;
    return floorScale(pt.y);
  }

  goToSpot(spot, { wander = false } = {}) {
    this.spot = spot;
    spot.taken = this;
    const r = spot.route;
    const dist = Math.abs(r[0].x - this.x);
    if (wander && dist > 450) {
      // stop part-way for a curious sniff, like a cat exploring a new room
      const mx = lerp(this.x, r[0].x, rand(0.35, 0.6));
      this.walkTo(mx, lerp(this.y, r[0].y, 0.5));
      this.hold(rand(0.4, 0.8), 'stand');
      this.hold(rand(1.2, 1.8), 'sniff', 'sniff');
      this.call(() => this.flick());
    }
    this.walkTo(r[0].x, r[0].y);
    for (let i = 1; i < r.length; i++) this.jumpTo(r[i], this.routeScale(i, spot));
    this.call(() => this.settleRoutine());
  }

  leaveSpot() {
    const spot = this.spot;
    if (!spot) return;
    const r = spot.route;
    for (let i = r.length - 2; i >= 0; i--) {
      if (i === 0) this.jumpTo({ x: r[0].x, y: r[0].y }, floorScale(r[0].y));
      else this.jumpTo(r[i], this.routeScale(i, spot));
    }
  }

  // arrive → sniff → circle → knead → curl up
  settleRoutine() {
    this.state = 'settling';
    this.clip = 'settle';
    const spot = this.spot;
    const first = !this.arrived;
    if (first) {
      this.arrived = true;
      this.label = 5.5;
      if (Math.random() < 0.75) setTimeout(() => this.world.sfx?.meow(this.def.voice, 0.6), 700);
    }
    this.hold(0.5, 'stand');
    this.hold(rand(1.1, 1.7), 'sniff', 'sniff');
    if (isCosySpot(spot) && Math.random() < 0.85) this.curlUp(0.6);
    else {
      this.turn(spot.facing || this.dir);
      this.hold(0.8, 'sit');
      this.call(() => { this.settledAt = this.world.time; this.rest('sit'); });
    }
  }

  // circle → knead → curl up, ending asleep (with chance `sleepy`) or in a loaf
  curlUp(sleepy) {
    const spot = this.spot;
    const d = this.dir;
    const step = 9 * this.scale;
    this.call(() => { this.clip = 'circle'; this.turnRate = 4; });
    this.turn(-d);
    this.walkTo(spot.x - d * step, spot.y, { speed: 26, inPlace: !isFloorSpot(spot) });
    this.turn(d);
    this.walkTo(spot.x, spot.y, { speed: 26, inPlace: !isFloorSpot(spot) });
    this.turn(spot.facing || d);
    this.call(() => {
      this.turnRate = 6;
      this.clip = 'knead';
      if (Math.random() < 0.7) this.world.sfx?.purr(this.def.voice, 3.5);
    });
    if (isDog(this.def)) this.hold(rand(1.2, 1.8), 'sniff', 'sniff'); // dogs circle and flop, no kneading
    else this.hold(rand(2.2, 3.2), 'knead', 'knead');
    this.hold(1.4, 'loaf');
    this.call(() => {
      this.settledAt = this.world.time;
      this.resettleAfter = rand(100, 200);
      this.rest(spot.poses.includes('sleep') && Math.random() < sleepy ? 'sleep' : 'loaf');
    });
  }

  // After a long rest a cat gets up, maybe yawns, stretches, turns round and curls up again:
  // the change of position that keeps a dozing room from looking frozen.
  resettle() {
    this.state = 'settling';
    this.clip = 'resettle';
    this.call(() => this.flick());
    this.hold(rand(1.2, 1.8), 'sit');
    if (Math.random() < 0.5) { this.hold(1.7, 'yawn'); this.hold(0.6, 'sit'); }
    this.hold(0.6, 'stand');
    this.hold(1.9, 'stretch', 'stretch');
    this.hold(0.5, 'stand');
    this.curlUp(0.75);
  }

  rest(pose) {
    this.state = 'resting';
    this.setActivity(pose);
  }

  setActivity(pose) {
    this.poseName = pose;
    const [a, b] = DURATION[pose] || [8, 14];
    this.restUntil = this.world.time + rand(a, b);
    this.clip = pose === 'sleep' ? 'sleepLoop' : `idle_${pose}`;
    if (COSY.has(pose)) this.nextFlick = Math.max(this.nextFlick, rand(10, 30));
    if (pose === 'sleep') {
      this.nextZ = 4; // the clip waits for the loaf's slow blink before it curls up
      if (Math.random() < 0.4) this.world.sfx?.purr(this.def.voice, rand(4, 6));
    }
  }

  nextActivity() {
    const spot = this.spot;
    const from = this.poseName;
    // occasional outings from an awake pose
    if ((from === 'sit' || from === 'loaf') && !this.world.alert) {
      const roll = Math.random();
      if (roll < 0.12 && spot.poses.includes('play') && this.world.yarnFree()) return this.goPlay();
      if (roll < 0.22 && isFloorSpot(spot) && this.tryGreet()) return;
      if (roll < 0.27 && this.age > 90 && this.world.relocate(this)) return;
    }
    if ((from === 'loaf' || from === 'wake') && !this.world.alert && isCosySpot(spot) &&
      this.world.time - this.settledAt > this.resettleAfter) return this.resettle();
    const options = (NEXT[from] || ['sit']).filter((p) => (ALWAYS_OK.has(p) || spot.poses.includes(p)) && !(p === 'groom' && isDog(this.def)));
    this.setActivity(pick(options.length ? options : ['sit']));
  }

  goPlay() {
    const w = this.world;
    w.yarnUser = this;
    this.state = 'outing';
    this.clip = 'play';
    const yarn = w.scene.yarn;
    const side = yarn.x > this.x ? 1 : -1;
    this.hold(0.6, 'stand');
    this.walkTo(yarn.x - side * 62, yarn.y + 2, { speed: 55 });
    this.call(() => { this.dir = Math.sign(w.scene.yarn.x - this.x) || 1; });
    this.hold(0.6, 'sniff');
    for (let k = 0; k < 1 + Math.floor(Math.random() * 2); k++) {
      this.call(() => { this.wiggle = 1; });
      this.hold(rand(1.0, 1.6), 'crouch');
      this.call(() => { this.wiggle = 0; });
      this.hold(0.35, 'bat');
      this.call(() => { w.scene.yarn.vx = this.dir * rand(45, 85); });
      this.hold(0.9, 'bat');
      this.hold(1.4, 'sit');
    }
    this.call(() => {
      w.yarnUser = null;
      this.walkTo(this.spot.x, this.spot.y, { speed: 55 });
      this.turn(this.spot.facing || this.dir);
      this.hold(0.6, 'sit');
      this.call(() => this.rest('sit'));
    });
  }

  tryGreet() {
    const friend = this.world.cats.find((c) => c !== this && c.state === 'resting' && !c.busy && isFloorSpot(c.spot) &&
      Math.abs(c.x - this.x) < 560 && c.poseName !== 'sleep');
    if (!friend) return false;
    this.state = 'outing';
    this.clip = 'greet';
    friend.busy = this;
    const side = friend.x > this.x ? -1 : 1;
    const gap = 112 * friend.scale * CAT_SCALE;
    this.hold(0.5, 'stand');
    this.walkTo(friend.x + side * gap, friend.y + 3, { speed: 55 });
    this.call(() => {
      this.dir = Math.sign(friend.x - this.x) || 1;
      friend.dir = -this.dir;
      friend.poseName = 'nuzzle';
      this.world.sfx?.trill(this.def.voice);
      setTimeout(() => this.world.sfx?.purr(friend.def.voice, 4), 700);
      for (let i = 0; i < 3; i++) this.world.addParticle('heart', (this.x + friend.x) / 2, this.y - 150 * this.scale * CAT_SCALE, i * 0.7);
    });
    this.hold(1.2, 'sniff');
    this.hold(3.8, 'nuzzle');
    this.call(() => {
      friend.busy = null;
      friend.setActivity('sit');
      this.hold(0.5, 'stand');
      this.walkTo(this.spot.x, this.spot.y, { speed: 55 });
      this.turn(this.spot.facing || this.dir);
      this.hold(0.6, 'sit');
      this.call(() => this.rest('sit'));
    });
    return true;
  }

  // Gentle exit: wake → ear flick → look up → stretch → wander off. Never a startled dash.
  leave() {
    if (this.state === 'leaving') return;
    const w = this.world;
    if (w.yarnUser === this) w.yarnUser = null;
    for (const c of w.cats) if (c.busy === this) { c.busy = null; c.setActivity('sit'); }
    if (this.busy) this.busy = null;
    const settled = this.state === 'resting' || this.state === 'settling';
    w.departed.push({ cat: this, def: this.def, spot: this.spot, at: w.time });
    this.state = 'leaving';
    this.clip = 'leave';
    this.label = 0;
    this.wiggle = 0;
    if (!(this.seg && this.seg.type === 'jump')) this.seg = null;
    this.queue = [];
    const spot = this.spot;
    if (spot) spot.taken = null;
    const pose = this.poseName;
    this.call(() => {
      if (settled) {
        if (pose === 'sleep') { this.hold(1.8, 'wake', 'wake'); this.hold(1.5, 'yawn'); }
        else if (COSY.has(pose) || pose === 'knead') this.hold(1.2, 'wake', 'wake');
        this.call(() => this.flick());
        this.hold(1.1, 'alert');
        this.call(() => this.flick());
        this.hold(0.6, 'stand');
        this.hold(1.9, 'stretch', 'stretch');
        this.hold(0.5, 'stand');
      }
      if (spot && this.y < 870) {
        const atSpot = Math.hypot(this.x - spot.x, this.y - spot.y) < 20;
        if (atSpot) { this.spot = spot; this.leaveSpot(); }
        else this.jumpTo({ x: spot.route[0].x, y: spot.route[0].y }, floorScale(spot.route[0].y));
      }
      this.call(() => this.exit());
    });
  }

  // Undo: a cat on its way out turns round and goes back (to its old spot if it's still free).
  comeBack() {
    const w = this.world;
    const old = this.spot;
    this.state = 'arriving';
    this.clip = 'enter';
    this.arrived = false; // name tag and a hello again
    if (!(this.seg && this.seg.type === 'jump')) this.seg = null;
    this.queue = [];
    this.call(() => {
      const target = old && !old.taken ? old : w.pickSpot(this.def);
      if (!target) { this.exit(); return; }
      if (target === old && Math.hypot(this.x - old.x, this.y - old.y) < 20) {
        // never got down: just settle again where it was
        this.spot = old; old.taken = this;
        this.settleRoutine();
        return;
      }
      if (old && this.y < 870) this.jumpTo({ x: old.route[0].x, y: old.route[0].y }, floorScale(old.route[0].y));
      target.taken = this;
      this.call(() => this.goToSpot(target));
    });
  }

  exit() {
    const toLeft = this.x < VIEW_MID;
    const lane = FLOOR_LANE + rand(-6, 10);
    const exit = offstageX(this.def, toLeft ? -1 : 1, lane);
    this.walkTo(this.x + (toLeft ? -30 : 30), lane, { speed: 40 });
    const mid = lerp(this.x, exit, rand(0.3, 0.5));
    if (Math.abs(exit - this.x) > 500) {
      this.walkTo(mid, lane, { speed: 52 });
      this.hold(rand(1.0, 1.6), 'sniff');
    }
    this.walkTo(exit, lane, { speed: 52 });
    this.call(() => { this.state = 'gone'; });
  }

  // --- update ----------------------------------------------------------------
  update(dt) {
    const w = this.world;
    if (this.waitClips) {
      if (!ClipCatRenderer.loading(this.def)) this.clips = ClipCatRenderer.for(this.def);
      if (this.clips || w.time > this.waitClips || this.state !== 'arriving') this.waitClips = 0;
      else return;
    }
    this.age += dt;
    if (this.label > 0) this.label -= dt;

    // Paused by the teacher: whatever it was doing waits; the animal sits up and faces the room.
    // A jump in flight lands first.
    const midJump = this.seg && this.seg.type === 'jump';
    if (w.paused && !midJump) {
      if (!this.attending) {
        this.attending = true;
        this.prePose = this.poseName;
        this.pausedAt = w.time;
        if (this.seg && this.seg.type === 'walk') this.seg.v = 0;
        this.flick();
      }
      this.poseName = 'attend';
    } else if (this.attending && !w.paused) {
      this.attending = false;
      this.poseName = this.seg && this.seg.type === 'wait' && this.seg.pose ? this.seg.pose : this.prePose;
      this.restUntil += w.time - this.pausedAt;
      this.flick();
    }
    this.front = lerp(this.front, this.attending ? 1 : 0, 1 - Math.exp(-dt * 4));

    if (!this.attending && !this.seg && this.queue.length) this.startSeg(this.queue.shift());
    let speed = 0;
    if (this.attending) { /* everything waits */ }
    else if (this.seg) speed = this.runSeg(dt);
    else if (this.state === 'resting' && !this.busy && !this.alerted && w.time > this.restUntil) this.nextActivity();

    // React to a noisy room: look up, but settle back down once it's quiet again.
    if (this.state === 'resting' && !this.busy) {
      if (w.alert && !this.alerted) {
        this.alerted = true;
        this.prevPose = this.poseName;
        this.flick();
        this.poseName = this.poseName === 'sleep' || this.poseName === 'loaf' ? 'wake' : 'alert';
      } else if (!w.alert && this.alerted) {
        if (!this.relaxAt) this.relaxAt = w.time + rand(1, 3.5);
        if (w.time > this.relaxAt) {
          this.alerted = false;
          this.relaxAt = 0;
          this.setActivity(this.prevPose === 'sleep' ? 'loaf' : this.prevPose || 'sit');
        }
      }
    } else if (this.state !== 'resting') {
      this.alerted = false;
    }
    this.alertAmt = lerp(this.alertAmt, this.alerted || this.attending || this.poseName === 'alert' ? 1 : 0, 1 - Math.exp(-dt * 6));

    // pose smoothing (procedural walk cycle is layered on top in draw)
    this.walkAmt = lerp(this.walkAmt, clamp(speed / 25, 0, 1), 1 - Math.exp(-dt * 10));
    const k = 1 - Math.exp(-dt * (this.seg && this.seg.type === 'jump' ? 15 : 5));
    const target = POSE_FLAT[this.poseName] || POSE_FLAT.sit;
    for (let i = 0; i < this.cur.length; i++) this.cur[i] += (target[i] - this.cur[i]) * k;
    this.dirVis = lerp(this.dirVis, this.dir, 1 - Math.exp(-dt * this.turnRate));

    this.nextBlink -= dt;
    if (this.nextBlink < 0) { this.blinkT = 0.16; this.nextBlink = rand(2.5, 6); }
    if (this.blinkT > 0) this.blinkT -= dt;

    if (this.flickT >= 0) { this.flickT += dt * 3.2; if (this.flickT > 1) this.flickT = -1; }
    this.nextFlick -= dt;
    if (this.nextFlick < 0) {
      // a resting cat's ear flicks now and then, a dozing one's only rarely
      const dozy = this.state === 'resting' && COSY.has(this.poseName);
      this.nextFlick = dozy ? rand(16, 40) : rand(6, 16);
      if (this.poseName !== 'sleep' || Math.random() < 0.5) this.flick();
    }

    this.nextLook -= dt;
    if (this.nextLook < 0) {
      this.lookTarget = this.poseName === 'look' || this.poseName === 'sit' ? rand(-0.9, 0.5) : rand(-0.3, 0.2);
      if (this.attending) this.lookTarget = rand(-0.12, 0.12); // eyes on the teacher
      if (Math.random() < 0.4) this.lookTarget = 0;
      this.nextLook = rand(2.5, 7);
    }
    this.lookX = lerp(this.lookX, this.lookTarget, 1 - Math.exp(-dt * 2.5));

    if (this.state === 'resting' && !this.attending) {
      this.nextSound -= dt;
      if (this.nextSound < 0) {
        this.nextSound = rand(50, 120);
        if (this.poseName === 'sleep' || this.poseName === 'loaf') w.sfx?.purr(this.def.voice, rand(3, 5));
        else if (!w.alert) w.sfx?.meow(this.def.voice, 0.5);
      }
      if (this.poseName === 'sleep') {
        this.nextZ -= dt;
        if (this.nextZ < 0) {
          this.nextZ = 3.4;
          const p = unflat(this.cur);
          const s = this.scale * CAT_SCALE;
          w.addParticle('z', this.x + p.head[0] * s * this.dir, this.y + (p.head[1] - 40) * s, 0);
        }
      }
    }
    if (this.clips) this.clips.update(this, dt, speed / (this.scale * this.def.size * CAT_SCALE));
  }

  startSeg(seg) {
    this.seg = seg;
    seg.t = 0;
    if (seg.type === 'walk') {
      seg.x0 = this.x; seg.y0 = this.y; seg.d = 0; seg.v = 0;
      seg.len = Math.hypot(seg.x - this.x, seg.y - this.y);
      if (seg.len < 1.5) { this.seg = null; return; }
      this.poseName = 'walk';
      if (Math.abs(seg.x - this.x) > 3) this.dir = seg.x > this.x ? 1 : -1;
    } else if (seg.type === 'jump') {
      seg.x0 = this.x; seg.y0 = this.y; seg.z0 = this.z; seg.s0 = this.scale;
      const dy = seg.y - this.y;
      seg.arc = 40 + Math.abs(dy) * (dy < 0 ? 0.32 : 0.12);
      seg.air = 0.45 + Math.hypot(seg.x - this.x, dy) / 1100;
      seg.crouch = dy < -60 ? 0.75 : 0.45; // bigger leaps need a longer wind-up
      seg.land = 0.35;
      if (Math.abs(seg.x - this.x) > 4) this.dir = seg.x > this.x ? 1 : -1;
      this.poseName = 'crouch';
      this.clip = this.state === 'leaving' ? 'leave' : 'jump';
    } else if (seg.type === 'wait') {
      seg.dur = seg.wait;
      if (seg.pose) this.poseName = seg.pose;
      if (seg.clip) this.clip = seg.clip;
    } else if (seg.type === 'turn') {
      this.dir = seg.dir;
    } else if (seg.type === 'call') {
      this.seg = null;
      seg.fn();
    }
  }

  // returns ground speed (px/s) so the walk cycle can match it
  runSeg(dt) {
    const s = this.seg;
    s.t += dt;
    if (s.type === 'walk') {
      // ease in and out instead of sliding at constant speed
      const remaining = s.len - s.d;
      const target = Math.min(s.speed, Math.sqrt(2 * 90 * remaining) + 6);
      s.v += clamp(target - s.v, -260 * dt, 70 * dt);
      s.d = Math.min(s.len, s.d + s.v * dt);
      const u = s.d / s.len;
      this.x = lerp(s.x0, s.x, u);
      this.y = lerp(s.y0, s.y, u);
      if (!s.inPlace) { this.z = this.y; this.scale = floorScale(this.y); }
      this.walkPhase += (s.v * dt) / (8.9 * this.scale * CAT_SCALE * this.def.size);
      if (s.d >= s.len - 0.5) { this.seg = null; this.poseName = 'stand'; }
      return s.v;
    }
    if (s.type === 'jump') {
      const { crouch, air, land } = s;
      if (s.t < crouch) {
        this.poseName = 'crouch';
        this.wiggle = s.t > crouch * 0.3 ? 1 : 0; // the little bottom-wiggle before a leap
      } else if (s.t < crouch + air) {
        this.wiggle = 0;
        const u = (s.t - crouch) / air;
        this.poseName = u < 0.72 ? 'jump' : 'crouch';
        this.x = lerp(s.x0, s.x, u);
        this.y = lerp(s.y0, s.y, u) - s.arc * 4 * u * (1 - u);
        this.scale = lerp(s.s0, s.scale, u);
        this.z = Math.max(s.z0, s.z);
        if (!s.sounded && u > 0.95) { s.sounded = true; this.world.sfx?.thump(); }
      } else {
        this.x = s.x; this.y = s.y; this.scale = s.scale; this.z = s.z;
        this.poseName = 'crouch';
        if (s.t >= crouch + air + land) { this.poseName = 'stand'; this.seg = null; }
      }
      return 0;
    }
    if (s.type === 'wait' && s.t >= s.dur) this.seg = null;
    if (s.type === 'turn' && Math.abs(this.dirVis - this.dir) < 0.12) this.seg = null;
    return 0;
  }

  // --- draw ------------------------------------------------------------------
  posed(t) {
    const p = shapeFor(this.def, unflat(this.cur));
    const sleepy = this.poseName === 'sleep';
    const breathe = Math.sin(t * (sleepy ? 1.3 : 2.1) + this.def.name.length) * (sleepy ? 0.03 : 0.02);
    p.body[3] *= 1 + breathe;
    p.haunch[3] *= 1 + breathe * 0.6;
    p.chest[3] *= 1 + breathe;
    p.head[1] -= breathe * 22;
    const sway = noise1(t * 0.55 + this.def.name.length * 3) - 0.5;
    const swish = this.state === 'resting' && !sleepy ? 1 : 0.35;
    p.tail[4] += sway * 18 * swish; p.tail[5] += sway * 8 * swish;
    p.tail[6] += sway * 26 * swish; p.tail[7] += Math.sin(t * 1.3) * 4 * swish;

    if (this.walkAmt > 0.01) {
      const ph = this.walkPhase;
      const offs = [Math.PI, 0, 0, Math.PI]; // FF, BF, FN, BN
      p.legs.forEach((l, i) => {
        const a = ph + offs[i];
        l[2] += Math.sin(a) * 14 * this.walkAmt;
        l[3] -= Math.max(0, Math.cos(a)) * 9 * this.walkAmt;
      });
      // weight shifts: shoulders and hips rise alternately, head bobs a beat behind
      const hip = Math.sin(ph) * 2.2 * this.walkAmt;
      p.haunch[1] -= Math.abs(hip);
      p.chest[1] -= Math.abs(Math.cos(ph)) * 2.2 * this.walkAmt;
      p.body[1] -= Math.abs(Math.sin(ph * 2)) * 1.2 * this.walkAmt;
      p.head[1] += Math.sin(ph * 2 - 0.6) * 1.6 * this.walkAmt;
    }
    switch (this.poseName) {
      case 'groom': { const g = Math.sin(t * 7); p.legs[2][3] += g * 6; p.head[3] += g * 0.05; break; }
      case 'bat': p.legs[2][2] += Math.sin(t * 9) * 6; p.legs[2][3] += Math.cos(t * 9) * 5; break;
      case 'sniff': p.head[1] += Math.sin(t * 11) * 1.2; p.head[0] += Math.sin(t * 2.3) * 3; break;
      case 'knead': {
        const kn = t * 4.5;
        p.legs[0][3] -= Math.max(0, Math.sin(kn)) * 7;
        p.legs[2][3] -= Math.max(0, Math.sin(kn + Math.PI)) * 7;
        p.body[1] += Math.sin(kn * 2) * 0.8;
        break;
      }
      case 'stretch': p.haunch[1] -= Math.sin(t * 1.5) * 1.5; break;
      case 'look': case 'sit': p.head[3] += Math.sin(t * 0.5 + this.age) * 0.06; break;
      default: break;
    }
    if (this.wiggle) p.haunch[0] += Math.sin(t * 16) * 3;
    if (this.attending) p.head[3] += Math.sin(t * 0.4 + this.age) * 0.05; // the odd curious head tilt
    // face the room while paying attention: the rig's turn pulled toward face-on
    return applyTurn(p, this.dirVis * (1 - this.front));
  }

  draw(ctx, t) {
    const w = this.world;
    const p = this.posed(t);
    const s = this.scale * this.def.size * CAT_SCALE;

    // grounding shadow (stays on the surface while airborne)
    const seg = this.seg;
    const airborne = seg && seg.type === 'jump' && seg.t > seg.crouch && seg.t < seg.crouch + seg.air;
    const bodyW = Math.max(p.body[2] + Math.abs(p.body[0]), p.haunch[2] + Math.abs(p.haunch[0]) + 10);
    if (!airborne) softShadow(ctx, this.x, this.y + 1, bodyW * 1.15 * s, 11 * s, 0.45);
    else {
      const u = clamp((seg.t - seg.crouch) / seg.air, 0, 1);
      softShadow(ctx, this.x, lerp(seg.y0, seg.y, u), bodyW * 0.8 * s, 8 * s, 0.18);
    }

    // render into this cat's own sprite canvas so it can be lit as a whole
    const box = this.clips ? this.clips.box : SPR;
    const px = w.pixelScale;
    const kMax = 1.2 * this.def.size * CAT_SCALE * px;
    if (!this.canvas || this.canvasK !== kMax) {
      this.canvas = makeCanvas(box.w * kMax, box.h * kMax);
      this.g = this.canvas.getContext('2d');
      this.canvasK = kMax;
    }
    const g = this.g;
    let k = Math.min(s * px, kMax);
    // a clip that can't give a frame right now (loop wrap): reuse the last lit sprite
    const keep = this.clips && !this.clips.drawable() && this.spriteK;
    if (keep) k = this.spriteK;
    this.spriteK = k;
    const cw = Math.ceil(box.w * k), ch = Math.ceil(box.h * k);
    if (!keep) this.renderSprite(g, k, cw, ch, p, t, s);
    ctx.drawImage(this.canvas, 0, 0, cw, ch, this.x - box.l * s, this.y - box.t * s, (cw / k) * s, (ch / k) * s);
  }

  renderSprite(g, k, cw, ch, p, t, s) {
    const w = this.world;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, cw + 2, ch + 2);
    if (this.clips) this.clips.draw(g, k);
    else {
      const sign = this.dirVis < 0 ? -1 : 1;
      g.setTransform(k * sign, 0, 0, k, SPR.l * k, SPR.t * k);
      drawCat(g, this.def, p, {
        t,
        blink: this.blinkT > 0 ? 0 : 1,
        lookX: (this.state === 'resting' && !this.alerted) || this.attending ? this.lookX : 0,
        earFlick: this.flickT >= 0 ? this.flickT : 0,
        alert: this.alertAmt,
      });
    }
    // local light: cats stay brighter than the room so they pop on a projector
    const L = w.scene.lightAt(this.x, this.y - 60 * s);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = `rgba(20,12,18,${clamp((1 - L.l) * 0.42, 0, 0.35)})`;
    g.fillRect(0, 0, cw, ch);
    g.fillStyle = `rgba(${L.r},${L.g},${L.b},0.1)`;
    g.fillRect(0, 0, cw, ch);
    g.globalCompositeOperation = 'source-over';
  }

  drawLabel(ctx) {
    if (this.label <= 0) return;
    const a = clamp(this.label, 0, 1) * clamp((5.5 - this.label) * 3, 0, 1);
    const p = unflat(this.cur);
    const s = this.scale * this.def.size * CAT_SCALE;
    const x = this.x + p.head[0] * s * this.dirVis;
    const y = this.y + (p.head[1] - p.head[2] * 1.5) * s - 24 - (1 - a) * 8;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '600 24px Fredoka, "Segoe UI Rounded", sans-serif';
    const text = this.def.name;
    const tw = ctx.measureText(text).width + 30;
    ctx.fillStyle = 'rgba(255,248,236,0.95)';
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 10;
    rr(ctx, x - tw / 2, y - 19, tw, 38, 19);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.moveTo(x - 7, y + 18); ctx.lineTo(x + 7, y + 18); ctx.lineTo(x, y + 26); ctx.fill();
    ctx.fillStyle = '#7a4a2e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 1);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
export class CatWorld {
  constructor(scene, sfx) {
    this.scene = scene;
    this.sfx = sfx;
    this.cats = [];
    this.time = 0;
    this.particles = [];
    this.yarnUser = null;
    this.alert = false;
    this.paused = false;
    this.departed = []; // recent leavers, newest last, for the undo button
    this.pixelScale = 1;
    this.onChange = () => {};
    this.clipsReady = preloadClipSets(ANIMAL_DEFS);
  }

  get count() { return this.cats.filter((c) => c.state !== 'leaving').length; }
  // ten cats, then Toby
  get capacity() { return Math.min(SPOTS.filter((s) => !s.dog).length, CAT_DEFS.length) + 1; }
  get toby() { return this.cats.find((c) => isDog(c.def) && c.state !== 'leaving'); }
  get catCount() { return this.cats.filter((c) => !isDog(c.def) && c.state !== 'leaving').length; }
  yarnFree() { return !this.yarnUser; }
  freeSpots(def = CAT_DEFS[0]) { return SPOTS.filter((s) => !s.taken && spotFits(s, def)); }

  // spread animals out: favour spots far from the others so each one is easy to count
  pickSpot(def) {
    const spots = this.freeSpots(def);
    if (!spots.length) return null;
    const score = (s) => Math.min(...this.cats.filter((c) => c.spot && c.state !== 'leaving').map((c) => Math.hypot(c.spot.x - s.x, c.spot.y - s.y)), 2000);
    return spots.map((s) => ({ s, v: score(s) + rand(0, 400) + (isFloorSpot(s) ? 0 : 150) })).sort((a, b) => b.v - a.v)[0].s;
  }

  // Next visitor: a cat who isn't here yet, or Toby once every cat has come. `want` forces one
  // (the undo button), with `prefer` as the spot to go back to if it's still free.
  addCat(want = null, prefer = null) {
    if (this.count >= this.capacity) return null;
    const present = new Set(this.cats.map((c) => c.def.name));
    let def = want;
    if (!def) {
      const defs = CAT_DEFS.filter((d) => !present.has(d.name));
      if (defs.length) {
        // prefer a cat whose clips have arrived, so early visitors don't have to wait off-stage
        const ready = defs.filter((d) => !ClipCatRenderer.loading(d));
        def = pick(ready.length ? ready : defs);
      } else if (!present.has(TOBY.name)) def = TOBY;
      else return null;
    }
    if (present.has(def.name)) return null;
    const spot = prefer && !prefer.taken && spotFits(prefer, def) ? prefer : this.pickSpot(def);
    if (!spot) return null;
    const cat = new Cat(def, this);
    cat.clips = ClipCatRenderer.for(def); // pre-rendered clips when this cat has them, else the rig
    // over a slow connection its clips may still be downloading: it waits off-stage for them
    // (up to a limit, then comes in on the rig) rather than arriving as the drawn cat
    if (!cat.clips && ClipCatRenderer.loading(def)) cat.waitClips = this.time + CLIP_WAIT;
    const fromLeft = spot.route[0].x < VIEW_MID;
    cat.y = FLOOR_LANE + rand(-6, 10);
    cat.x = offstageX(def, fromLeft ? -1 : 1, cat.y);
    cat.z = cat.y;
    cat.scale = floorScale(cat.y);
    cat.dir = fromLeft ? 1 : -1;
    cat.dirVis = cat.dir;
    cat.goToSpot(spot, { wander: true });
    this.cats.push(cat);
    this.onChange();
    return cat;
  }

  // Undo the latest departure: a leaver still in view turns back, one already gone walks in again.
  recall() {
    this.departed = this.departed.filter((d) => this.time - d.at < RECALL_WINDOW);
    const d = this.departed.pop();
    if (!d) return null;
    const cat = this.cats.find((c) => c === d.cat && c.state === 'leaving');
    if (cat) cat.comeBack();
    else this.addCat(d.def, d.spot);
    this.onChange();
    return d.def;
  }

  // the most recent departure the undo button can still bring back
  get recallable() {
    const d = this.departed[this.departed.length - 1];
    return d && this.time - d.at < RECALL_WINDOW ? d.def : null;
  }

  removeCat() {
    const candidates = this.cats.filter((c) => c.state !== 'leaving');
    if (!candidates.length) return null;
    // the one who has been here longest gets up first; newcomers keep settling
    const settled = candidates.filter((c) => c.state === 'resting' || c.state === 'outing');
    const pool = settled.length ? settled : candidates;
    const cat = pool.reduce((a, b) => (a.age > b.age ? a : b));
    cat.leave();
    this.onChange();
    return cat;
  }

  relocate(cat) {
    const spots = this.freeSpots(cat.def);
    if (!spots.length) return false;
    const target = pick(spots);
    const old = cat.spot;
    cat.state = 'moving';
    cat.clip = 'relocate';
    cat.hold(0.6, 'stand');
    cat.hold(1.8, 'stretch');
    cat.leaveSpot();
    old.taken = null;
    cat.call(() => cat.goToSpot(target));
    return true;
  }

  addParticle(type, x, y, delay) {
    this.particles.push({ type, x, y, t: -delay, life: type === 'z' ? 3.4 : 2.4, dx: rand(-10, 10) });
  }

  update(dt) {
    this.time += dt;
    for (const c of this.cats) c.update(dt);
    const before = this.cats.length;
    for (const c of this.cats) if (c.state === 'gone') c.clips?.dispose();
    this.cats = this.cats.filter((c) => c.state !== 'gone');
    if (this.cats.length !== before) this.onChange();
    for (const p of this.particles) p.t += dt;
    this.particles = this.particles.filter((p) => p.t < p.life);
  }

  drawables() {
    return this.cats.map((c) => ({ z: c.z, cat: c, draw: (ctx, t) => c.draw(ctx, t) }));
  }

  drawOverlay(ctx) {
    for (const p of this.particles) {
      if (p.t < 0) continue;
      const u = p.t / p.life;
      const a = Math.sin(u * Math.PI) * 0.95;
      const x = p.x + p.dx * u + Math.sin(p.t * 2) * 6;
      const y = p.y - u * 60;
      ctx.save();
      ctx.globalAlpha = a;
      if (p.type === 'z') {
        ctx.font = `600 ${22 + u * 12}px Fredoka, sans-serif`;
        ctx.fillStyle = '#fff3d9';
        ctx.textAlign = 'center';
        ctx.fillText('z', x, y);
      } else {
        ctx.translate(x, y);
        ctx.scale(0.9 + u * 0.4, 0.9 + u * 0.4);
        ctx.fillStyle = '#f28b9b';
        ctx.beginPath();
        ctx.moveTo(0, 6);
        ctx.bezierCurveTo(-14, -4, -8, -16, 0, -8);
        ctx.bezierCurveTo(8, -16, 14, -4, 0, 6);
        ctx.fill();
      }
      ctx.restore();
    }
    for (const c of this.cats) c.drawLabel(ctx);
  }
}
