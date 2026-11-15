// Web Audio: microphone loudness meter, synthesised cat sounds and the background music track.

const MUSIC_URL = 'assets/music/rainy-window-study.mp3';
const MUSIC_VOL = 0.35;     // the track is mastered loud (about -15 LUFS); this sits it under the room
const MUSIC_LOOP_AT = 175;  // seconds: the track's own fade-out starts here
const MUSIC_XFADE = 2.5;    // seconds of overlap when it wraps back to the top

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.level = 0;          // smoothed 0..1 loudness
    this.sensitivity = 2;
    this.catSounds = true;
    this.warnSounds = true;
    this.musicOn = true;
    this.quietUntil = 0;     // mic readings are ignored while our own cat sounds play
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(c.destination);
    // shared soft reverb
    this.reverb = c.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.4);
    const wet = c.createGain();
    wet.gain.value = 0.28;
    this.reverb.connect(wet).connect(this.master);
    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = 1;
    this.sfxBus.connect(this.master);
    this.sfxBus.connect(this.reverb);
    this.noiseBuf = this.makeNoise(2);
  }

  makeImpulse(sec) {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * sec);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  makeNoise(sec) {
    const c = this.ctx;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * sec), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ---------------------------------------------------------------- microphone
  async startMic() {
    this.init();
    await this.ctx.resume();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
    });
    const src = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    src.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.micOn = true;
  }

  // Returns 0..1 loudness. Fast attack, slow release so the bar feels calm.
  readLevel(dt) {
    if (!this.analyser) return this.level;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length) * this.sensitivity;
    const db = 20 * Math.log10(rms + 1e-8);
    let v = Math.min(1, Math.max(0, (db + 62) / 52));
    if (this.ctx.currentTime < this.quietUntil) v = Math.min(v, this.level);
    const k = v > this.level ? 1 - Math.exp(-dt * 12) : 1 - Math.exp(-dt * 2.2);
    this.level += (v - this.level) * k;
    return this.level;
  }

  // ---------------------------------------------------------------- cat sounds
  hold(sec) { this.quietUntil = Math.max(this.quietUntil, this.ctx.currentTime + sec + 0.4); }

  meow(voice, vol = 0.6) {
    if (!this.ctx || !this.catSounds) return;
    if (voice.dog) return Math.random() < 0.5 ? this.snort(vol) : this.grumble(vol);
    const c = this.ctx;
    const t = c.currentTime + 0.02;
    const { pitch, len, bright } = voice;
    const d = len * (0.85 + Math.random() * 0.3);
    const f0 = pitch * (0.94 + Math.random() * 0.12);
    this.hold(d);

    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0 * 0.82, t);
    osc.frequency.linearRampToValueAtTime(f0 * 1.18, t + d * 0.3);
    osc.frequency.linearRampToValueAtTime(f0 * 1.05, t + d * 0.6);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.72, t + d);
    const vib = c.createOscillator();
    vib.frequency.value = 5.5;
    const vibG = c.createGain();
    vibG.gain.value = f0 * 0.012;
    vib.connect(vibG).connect(osc.frequency);

    // "m-ee-ow": formants open then close
    const mk = (f, q, g) => {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = q;
      const gg = c.createGain();
      gg.gain.value = g;
      osc.connect(bp).connect(gg);
      return { bp, gg };
    };
    const F1 = mk(700, 6, 1);
    const F2 = mk(1800, 9, 0.6);
    F1.bp.frequency.setValueAtTime(450, t);
    F1.bp.frequency.linearRampToValueAtTime(1100 * bright, t + d * 0.35);
    F1.bp.frequency.linearRampToValueAtTime(650, t + d);
    F2.bp.frequency.setValueAtTime(1300, t);
    F2.bp.frequency.linearRampToValueAtTime(2500 * bright, t + d * 0.3);
    F2.bp.frequency.linearRampToValueAtTime(1100, t + d);

    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.11 * vol, t + 0.06);
    env.gain.setValueAtTime(0.11 * vol, t + d * 0.55);
    env.gain.exponentialRampToValueAtTime(0.0008, t + d);
    F1.gg.connect(lp); F2.gg.connect(lp);
    lp.connect(env).connect(this.sfxBus);
    osc.start(t); vib.start(t);
    osc.stop(t + d + 0.05); vib.stop(t + d + 0.05);
  }

  trill(voice) {
    if (!this.ctx || !this.catSounds) return;
    if (voice.dog) { this.snort(0.8, 2); return this.grumble(0.7, 0.6); }
    const c = this.ctx;
    const t = c.currentTime + 0.02;
    const d = 0.38;
    const f0 = voice.pitch * 0.9;
    this.hold(d);
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f0 * 0.8, t);
    osc.frequency.linearRampToValueAtTime(f0 * 1.25, t + d);
    const am = c.createOscillator();
    am.frequency.value = 28;
    const amG = c.createGain();
    amG.gain.value = 0.5;
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.06, t + 0.04);
    env.gain.exponentialRampToValueAtTime(0.0008, t + d);
    const trem = c.createGain();
    trem.gain.value = 0.5;
    am.connect(amG).connect(trem.gain);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 1.5;
    osc.connect(trem).connect(bp).connect(env).connect(this.sfxBus);
    osc.start(t); am.start(t);
    osc.stop(t + d + 0.05); am.stop(t + d + 0.05);
  }

  purr(voice, dur = 4) {
    if (!this.ctx || !this.catSounds) return;
    if (voice.dog) return this.snore(dur);
    const c = this.ctx;
    const t = c.currentTime + 0.02;
    this.hold(dur);
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240 + voice.pitch * 0.15;
    lp.Q.value = 2;
    // the purr "rumble": ~24 Hz amplitude modulation
    const rumble = c.createGain();
    rumble.gain.value = 0;
    const lfo = c.createOscillator();
    lfo.type = 'sawtooth';
    lfo.frequency.value = 21 + (voice.pitch % 7);
    const lfoG = c.createGain();
    lfoG.gain.value = 0.9;
    lfo.connect(lfoG).connect(rumble.gain);
    // breathing in / out
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    const breaths = Math.max(2, Math.round(dur / 1.6));
    const step = dur / breaths;
    for (let i = 0; i < breaths; i++) {
      const b = t + i * step;
      env.gain.linearRampToValueAtTime(0.11, b + step * 0.3);
      env.gain.linearRampToValueAtTime(0.03, b + step * 0.55);
      env.gain.linearRampToValueAtTime(0.08, b + step * 0.8);
      env.gain.linearRampToValueAtTime(0.01, b + step);
    }
    env.gain.linearRampToValueAtTime(0, t + dur + 0.1);
    src.connect(lp).connect(rumble).connect(env).connect(this.master);
    src.start(t); lfo.start(t);
    src.stop(t + dur + 0.2); lfo.stop(t + dur + 0.2);
  }

  // ---------------------------------------------------------------- Toby's sounds
  // French-bulldog noises are mostly air through a squashed nose: shaped bursts of the shared
  // noise, often with a fast flutter (a soft palate or loose lips), plus a low voiced grunt.
  // All gentle, and each one holds the mic off for as long as it plays.
  burst(t, d, { type = 'bandpass', f = 600, f2 = f, q = 1, vol = 0.05, attack = 0.01, flutter = 0, depth = 0.6, out = this.sfxBus } = {}) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const flt = c.createBiquadFilter();
    flt.type = type;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f, t);
    flt.frequency.exponentialRampToValueAtTime(f2, t + d);
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0005, t + d);
    let node = src.connect(flt);
    if (flutter) {
      const am = c.createGain();
      am.gain.value = 1 - depth;
      const lfo = c.createOscillator();
      lfo.type = 'triangle';
      lfo.frequency.value = flutter;
      const lg = c.createGain();
      lg.gain.value = depth;
      lfo.connect(lg).connect(am.gain);
      node = node.connect(am);
      lfo.start(t); lfo.stop(t + d + 0.05);
    }
    node.connect(env).connect(out);
    src.start(t, Math.random() * 1.5); src.stop(t + d + 0.05);
  }

  grunt(t, d, f0, f1, vol, out = this.sfxBus) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + d);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 2;
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0005, t + d);
    o.connect(lp).connect(env).connect(out);
    o.start(t); o.stop(t + d + 0.05);
  }

  // Toby's hello: one or two soft, snuffly snorts, each ending in a wet little click.
  snort(vol = 0.6, count = 1 + Math.floor(Math.random() * 2)) {
    if (!this.ctx || !this.catSounds) return;
    const c = this.ctx;
    let t = c.currentTime + 0.02;
    for (let i = 0; i < count; i++) {
      const d = 0.17 + Math.random() * 0.08;
      this.burst(t, d, { f: 950, f2: 380, q: 3, vol: 0.12 * vol, attack: 0.015, flutter: 60, depth: 0.5 });
      this.grunt(t, d, 120, 80, 0.05 * vol);
      this.burst(t + d * 0.8, 0.035, { f: 2200, q: 6, vol: 0.02 * vol, attack: 0.004 });
      t += d + 0.09;
    }
    this.hold(t - c.currentTime);
  }

  // Grumbly Frenchie "talking": a short rising and falling rrr-wuh-wuh, quiet.
  grumble(vol = 0.6, delay = 0) {
    if (!this.ctx || !this.catSounds) return;
    const c = this.ctx;
    const t = c.currentTime + 0.02 + delay;
    const d = 0.6 + Math.random() * 0.25;
    const f0 = 150 + Math.random() * 30;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * 1.5, t + d * 0.32);
    o.frequency.linearRampToValueAtTime(f0 * 1.1, t + d * 0.6);
    o.frequency.linearRampToValueAtTime(f0 * 1.35, t + d * 0.75);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.85, t + d);
    // the growl: a rough ~30 Hz wobble
    const am = c.createGain();
    am.gain.value = 0.55;
    const lfo = c.createOscillator();
    lfo.frequency.value = 28 + Math.random() * 6;
    const lg = c.createGain();
    lg.gain.value = 0.45;
    lfo.connect(lg).connect(am.gain);
    const F1 = c.createBiquadFilter();
    F1.type = 'bandpass'; F1.Q.value = 4;
    F1.frequency.setValueAtTime(500, t);
    F1.frequency.linearRampToValueAtTime(820, t + d * 0.35);
    F1.frequency.linearRampToValueAtTime(520, t + d);
    const F2 = c.createBiquadFilter();
    F2.type = 'bandpass'; F2.Q.value = 6; F2.frequency.value = 1250;
    const g2 = c.createGain();
    g2.gain.value = 0.4;
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.1 * vol, t + 0.07);
    env.gain.setValueAtTime(0.1 * vol, t + d * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0005, t + d);
    o.connect(am);
    am.connect(F1).connect(env);
    am.connect(F2).connect(g2).connect(env);
    env.connect(this.sfxBus);
    o.start(t); lfo.start(t);
    o.stop(t + d + 0.05); lfo.stop(t + d + 0.05);
    this.burst(t + d, 0.14, { f: 700, f2: 350, q: 1.5, vol: 0.03 * vol }); // and a little snuff to finish
    this.hold(delay + d + 0.2);
  }

  // A contented "hmph" through the nose as he flops down.
  huff() {
    if (!this.ctx || !this.catSounds) return;
    const t = this.ctx.currentTime + 0.02;
    this.burst(t, 0.34, { f: 720, f2: 300, q: 0.9, vol: 0.06, attack: 0.015 });
    this.grunt(t, 0.2, 95, 70, 0.025);
    this.hold(0.4);
  }

  // "h… h… pfft!" then a snort: the head snaps down on the burst, 0.42 s in.
  sneeze() {
    if (!this.ctx || !this.catSounds) return;
    const t = this.ctx.currentTime + 0.02;
    this.burst(t, 0.14, { f: 1200, f2: 1600, vol: 0.018, attack: 0.1 });
    this.burst(t + 0.2, 0.16, { f: 1300, f2: 1800, vol: 0.026, attack: 0.12 });
    this.burst(t + 0.42, 0.2, { f: 2600, f2: 1100, q: 0.7, vol: 0.065, attack: 0.004 });
    this.burst(t + 0.42, 0.12, { type: 'lowpass', f: 420, vol: 0.05, attack: 0.004 });
    this.burst(t + 0.78, 0.15, { f: 820, f2: 400, q: 3, vol: 0.045, flutter: 60, depth: 0.5 });
    this.hold(1);
  }

  // The shake-off: ears and jowls flapping, fast then slowing, and a snuff at the end.
  shakeOff() {
    if (!this.ctx || !this.catSounds) return;
    const t = this.ctx.currentTime + 0.02;
    for (let i = 0; i < 8; i++) {
      this.burst(t + 0.12 + i * 0.105 + i * i * 0.003, 0.07, { type: 'lowpass', f: 380, q: 0.7, vol: 0.12 * (1 - i / 10), attack: 0.005 });
    }
    this.burst(t + 1.05, 0.16, { f: 800, f2: 350, q: 3, vol: 0.04, flutter: 55, depth: 0.5 });
    this.hold(1.25);
  }

  // Toby asleep or flopped: a wet, snuffly snore. Each breath is a fluttering, rattly inhale
  // through a squashed nose, a lip-flapping "puh" out, and now and then a wet snuffle.
  snore(dur = 4) {
    if (!this.ctx || !this.catSounds) return;
    const c = this.ctx;
    let t = c.currentTime + 0.02;
    const end = t + dur;
    this.hold(dur);
    while (t < end) {
      const k = 0.85 + Math.random() * 0.3; // no two breaths quite alike
      this.burst(t, 1.0 * k, { f: 300, f2: 470, q: 1.4, vol: 0.07, attack: 0.55 * k, flutter: 26 + Math.random() * 6, depth: 0.85, out: this.master });
      this.grunt(t + 0.3, 0.7 * k, 70, 86, 0.016, this.master);
      if (Math.random() < 0.5) {
        for (const dt of [0.82, 0.9]) this.burst(t + dt * k, 0.035, { f: 1900, q: 5, vol: 0.012, attack: 0.004 });
      }
      this.burst(t + 1.15 * k, 0.55, { f: 650, f2: 420, q: 2, vol: 0.035, attack: 0.04, flutter: 48, depth: 0.5, out: this.master });
      t += 2.5 * k;
    }
  }

  thump() {
    if (!this.ctx || !this.catSounds) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.14);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.16);
  }

  // ---------------------------------------------------------------- background music
  // "Rainy Window Study": a 3-minute track that fades out over its last few seconds, so rather
  // than looping the whole file we crossfade back to the top just before that fade begins.
  async startMusic() {
    this.init();
    if (this.music) return;
    const c = this.ctx;
    const bus = c.createGain();
    bus.gain.value = this.musicOn ? MUSIC_VOL * (this.musicLevel ?? 1) : 0;
    bus.connect(this.master);
    this.music = { bus, buffer: null, nextStart: 0 };
    try {
      const res = await fetch(MUSIC_URL);
      this.music.buffer = await c.decodeAudioData(await res.arrayBuffer());
    } catch (err) {
      console.warn('Background music failed to load', err);
      return;
    }
    this.music.nextStart = c.currentTime + 0.1;
    this.queueMusic();
    this.scheduler = setInterval(() => this.queueMusic(), 1000);
  }

  // Keep one pass of the track queued ahead; each pass fades in over the previous one's tail.
  queueMusic() {
    const c = this.ctx;
    const m = this.music;
    if (m.nextStart > c.currentTime + 5) return;
    const t = m.nextStart;
    const src = c.createBufferSource();
    src.buffer = m.buffer;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + MUSIC_XFADE);
    g.gain.setValueAtTime(1, t + MUSIC_LOOP_AT);
    g.gain.linearRampToValueAtTime(0, t + MUSIC_LOOP_AT + MUSIC_XFADE);
    src.connect(g).connect(m.bus);
    src.start(t);
    src.stop(t + MUSIC_LOOP_AT + MUSIC_XFADE + 0.05);
    m.nextStart = t + MUSIC_LOOP_AT;
  }

  setMusic(on) {
    this.musicOn = on;
    this.applyMusic();
  }

  // 0..1 on top of on/off: the session fades the music over its last 30 s
  setMusicLevel(level) {
    if (Math.abs((this.musicLevel ?? 1) - level) < 0.02) return;
    this.musicLevel = level;
    this.applyMusic();
  }

  applyMusic() {
    if (this.music) this.music.bus.gain.setTargetAtTime(this.musicOn ? MUSIC_VOL * (this.musicLevel ?? 1) : 0, this.ctx.currentTime, 0.5);
  }

  // A cat is thinking of leaving: two soft, low, falling notes. Plain and a little flat, so it
  // reads as "careful" and is nothing anyone would want to hear again.
  warn() {
    if (!this.ctx || !this.warnSounds) return;
    const c = this.ctx;
    const t0 = c.currentTime + 0.03;
    this.hold(1.1);
    [[67, 0], [63, 0.26]].forEach(([n, at]) => {
      const t = t0 + at;
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 440 * Math.pow(2, (n - 69) / 12);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1100;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.085, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      o.connect(lp).connect(g).connect(this.sfxBus);
      o.start(t); o.stop(t + 0.75);
    });
  }

  // Time's up: a soft rising bell, quieter than a meow.
  endChime() {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = c.currentTime + 0.05;
    [77, 81, 84, 89].forEach((n, i) => {
      const t = t0 + i * 0.22;
      const f = 440 * Math.pow(2, (n - 69) / 12);
      for (const [mult, vol, dec] of [[1, 0.05, 2.2], [2.76, 0.012, 0.9]]) {
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * mult;
        const g = c.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
        o.connect(g).connect(this.sfxBus);
        o.start(t); o.stop(t + dec + 0.05);
      }
    });
  }
}
