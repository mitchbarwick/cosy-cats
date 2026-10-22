// A quiet-time session: the teacher picks a length, and the ten cats are due across it on a
// front-loaded curve (quick at first, further apart later). Toby, the full-house reward, is due
// in the final minute. The clock is real time: noise never adds time, it only holds arrivals
// back (a cat due while the room is loud waits until it's calm) and sends cats home.
import { clamp } from './util.js';

export const LEAD = 30;         // s of settling-in before the first cat is due
export const FINALE = 60;       // the final minute, when Toby is due
export const CURVE = 1.5;       // >1 front-loads arrivals; fixed, never shown to teachers
export const CATS = 10;
export const MIN_MINUTES = 5;   // nothing shorter is offered
export const MAX_MINUTES = 90;
const CATCH_UP_GAP = 6;         // s between two arrivals when the room is catching up
const MIN_REPLACE = 15;         // s: the soonest a cat that wandered off can be replaced

export class Session {
  constructor() {
    this.state = 'setup'; // setup → running → final → done (pause is the world's)
    this.length = 15 * 60;
    this.curveLength = this.length; // the schedule keeps the length it started with
    this.elapsed = 0;
    this.name = '';
    this.due = [];
    this.lastArrival = -Infinity;
    this.minuteCued = false;
  }

  get remaining() { return Math.max(0, this.length - this.elapsed); }
  get progress() { return clamp(this.elapsed / this.length, 0, 1); }
  get active() { return this.state === 'running' || this.state === 'final'; }

  start(minutes, name) {
    this.length = clamp(Math.round(minutes), MIN_MINUTES, MAX_MINUTES) * 60;
    this.curveLength = this.length;
    this.name = name;
    this.elapsed = 0;
    this.state = 'running';
    this.due = Array.from({ length: CATS }, (_, i) => ({ t: this.curveAt(i + 1) }));
    this.lastArrival = -Infinity;
    this.minuteCued = false;
  }

  // when the k-th cat (fractional is fine) is due, in session seconds
  curveAt(k) {
    return LEAD + (this.curveLength - LEAD - FINALE) * Math.pow(clamp(k / CATS, 0, 1), CURVE);
  }

  // the curve's own spacing at time t: about 40 s early in a 15-minute session, 2 min late on
  gapAt(t) {
    const span = this.curveLength - LEAD - FINALE;
    const u = clamp((t - LEAD) / span, 0, 1);
    const k = CATS * Math.pow(u, 1 / CURVE);
    const slope = (span * CURVE * Math.pow(Math.max(k, 0.5) / CATS, CURVE - 1)) / CATS;
    return Math.max(MIN_REPLACE, slope);
  }

  // A cat wandered off: its replacement is due one curve-gap from now. Early that's soon (a
  // cheap mistake); late it's long, and may not fit before the end.
  departed(def) {
    if (!this.active || def.species === 'dog') return;
    this.due.push({ t: this.elapsed + this.gapAt(this.elapsed), def });
    this.due.sort((a, b) => a.t - b.t);
  }

  // Undo brought that cat back, so its replacement isn't needed.
  recalled(def) {
    const i = this.due.findIndex((d) => d.def === def);
    if (i >= 0) this.due.splice(i, 1);
  }

  extend(seconds) {
    this.length += seconds;
    if (this.state === 'done' || this.state === 'final') this.state = this.remaining <= FINALE ? 'final' : 'running';
    if (this.remaining > FINALE) this.minuteCued = false;
  }

  // Advance the clock and say what should happen this frame.
  //   calm: is the room quiet enough for someone to walk in?   cats: cats in the room (not leaving)
  tick(dt, { calm, cats, toby }) {
    const out = { arrive: false, toby: false, minute: false, end: false };
    if (!this.active) return out;
    this.elapsed += dt;
    if (this.state === 'running' && this.remaining <= FINALE) this.state = 'final';
    if (this.state === 'final' && !this.minuteCued) { this.minuteCued = true; out.minute = true; }
    // drop slots that are no longer needed (a full room, or a recall already filled it)
    while (this.due.length && cats >= CATS) this.due.shift();
    if (calm && this.elapsed - this.lastArrival >= CATCH_UP_GAP) {
      if (this.due.length && this.due[0].t <= this.elapsed) out.arrive = true;
      else if (this.state === 'final' && cats >= CATS && !toby) out.toby = true;
    }
    if (this.remaining <= 0) { this.state = 'done'; out.end = true; }
    return out;
  }

  // the scheduler confirms an arrival actually happened
  arrived() {
    this.due.shift();
    this.lastArrival = this.elapsed;
  }

  tobyArrived() { this.lastArrival = this.elapsed; }
}
