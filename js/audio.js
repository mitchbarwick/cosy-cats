// Web Audio: microphone loudness meter, synthesised cat sounds and a gentle lo-fi loop.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.level = 0;          // smoothed 0..1 loudness
    this.sensitivity = 2;
    this.catSounds = true;
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

  // ---------------------------------------------------------------- lo-fi music
  startMusic() {
    this.init();
    if (this.music) return;
    const c = this.ctx;
    const bus = c.createGain();
    bus.gain.value = this.musicOn ? 0.5 : 0;
    const warm = c.createBiquadFilter();
    warm.type = 'lowpass';
    warm.frequency.value = 2200;
    bus.connect(warm).connect(this.master);
    warm.connect(this.reverb);
    this.music = { bus, nextBar: c.currentTime + 0.3, bar: 0 };

    // vinyl crackle + soft fire hiss
    const hiss = c.createBufferSource();
    hiss.buffer = this.makeCrackle(4);
    hiss.loop = true;
    const hg = c.createGain();
    hg.gain.value = 0.25;
    hiss.connect(hg).connect(bus);
    hiss.start();

    // wobbly tape: a slow LFO shared by every note's detune
    this.wow = c.createOscillator();
    this.wow.frequency.value = 0.35;
    this.wowG = c.createGain();
    this.wowG.gain.value = 9;
    this.wow.connect(this.wowG);
    this.wow.start();

    this.scheduler = setInterval(() => this.schedule(), 200);
  }

  makeCrackle(sec) {
    const c = this.ctx;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * sec), c.sampleRate);
    const d = buf.getChannelData(0);
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      lp = lp * 0.97 + (Math.random() * 2 - 1) * 0.03;
      d[i] = lp * 0.25;
      if (Math.random() < 0.00025) d[i] += (Math.random() - 0.5) * 0.6;
    }
    return buf;
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.music) this.music.bus.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.5);
  }

  schedule() {
    const c = this.ctx;
    const m = this.music;
    const beat = 60 / 68;
    const barLen = beat * 4;
    // Fmaj9 – Em7 – Dm9 – Cmaj7 (+ G6 turnaround)
    const prog = [
      [53, 57, 60, 64, 67], [52, 55, 59, 62, 66], [50, 53, 57, 60, 64], [48, 52, 55, 59, 62],
      [53, 57, 60, 64, 69], [52, 55, 59, 62, 67], [50, 53, 57, 62, 65], [43, 50, 55, 59, 64],
    ];
    const bass = [41, 40, 38, 36, 41, 40, 38, 43];
    const mel = [72, 74, 76, 79, 81, 79, 76, 74, 72, 69, 67];
    while (m.nextBar < c.currentTime + 1.2) {
      const t = m.nextBar;
      const i = m.bar % prog.length;
      prog[i].forEach((n, k) => this.keys(n, t + k * 0.018, barLen * 0.95, 0.032));
      this.keys(prog[i][2] + 12, t + beat * 2.5, beat * 1.2, 0.012);
      this.bass(bass[i], t, beat * 2.6);
      this.bass(bass[i] + (i % 2 ? 7 : 12), t + beat * 2.5, beat * 1.3);
      // a sparse, gentle melody
      for (let b = 0; b < 4; b++) {
        if (Math.random() < 0.35) {
          const swing = b % 2 ? beat * 0.12 : 0;
          const n = mel[Math.floor(Math.random() * mel.length)];
          this.bell(n, t + b * beat + swing + (Math.random() < 0.5 ? beat / 2 : 0), beat * 1.5);
        }
      }
      // brushed beat: soft kick + muted hat
      for (let b = 0; b < 4; b++) {
        if (b === 0 || b === 2.5 || (b === 2 && m.bar % 2)) this.kick(t + b * beat);
        this.hat(t + b * beat + beat / 2 + beat * 0.08, 0.012);
        if (b % 2 === 1) this.hat(t + b * beat, 0.02);
      }
      this.kick(t + beat * 2.5);
      m.nextBar += barLen;
      m.bar++;
    }
  }

  freq(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  keys(n, t, d, vol) {
    // Rhodes-ish: sine + quiet FM bell, slow release
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = this.freq(n);
    this.wowG.connect(o.detune);
    const mod = c.createOscillator();
    mod.frequency.value = this.freq(n) * 2;
    const mg = c.createGain();
    mg.gain.setValueAtTime(this.freq(n) * 0.9, t);
    mg.gain.exponentialRampToValueAtTime(1, t + 0.8);
    mod.connect(mg).connect(o.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(vol * 0.4, t + 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.6);
    o.connect(g).connect(this.music.bus);
    o.start(t); mod.start(t);
    o.stop(t + d + 0.7); mod.stop(t + d + 0.7);
  }

  bass(n, t, d) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = this.freq(n - 12);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 300;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(lp).connect(g).connect(this.music.bus);
    o.start(t); o.stop(t + d + 0.05);
  }

  bell(n, t, d) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = this.freq(n);
    this.wowG.connect(o.detune);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.022, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(this.music.bus);
    o.start(t); o.stop(t + d + 0.05);
  }

  kick(t) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.music.bus);
    o.start(t); o.stop(t + 0.32);
  }

  hat(t, vol) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 6000;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    s.connect(hp).connect(g).connect(this.music.bus);
    s.start(t, Math.random()); s.stop(t + 0.08);
  }
}
