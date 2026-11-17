// PianoPlay - Web Audio piano synthesiser (no samples needed, works offline) and metronome.

let shared = null;

export class AudioEngine {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 18; this.comp.ratio.value = 3; this.comp.attack.value = 0.004; this.comp.release.value = 0.25;
    this.dry = this.ctx.createGain(); this.dry.gain.value = 0.85;
    this.wet = this.ctx.createGain(); this.wet.gain.value = 0.2;
    this.verb = this.ctx.createConvolver();
    this.verb.buffer = this._impulse(2.2, 3.2);
    this.master.connect(this.dry); this.master.connect(this.verb);
    this.verb.connect(this.wet);
    this.dry.connect(this.comp); this.wet.connect(this.comp);
    this.comp.connect(this.ctx.destination);
    this.voices = new Set();
    this.muted = false;
    this.volume = 0.9;
    this.noise = this._noiseBuffer();
    this.waves = this._waves();
  }
  _impulse(sec, decay) {
    const len = Math.floor(this.ctx.sampleRate * sec);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const n = Math.random() * 2 - 1;
        lp += (n - lp) * 0.35;                      // darker tail
        d[i] = lp * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }
  _noiseBuffer() {
    const len = Math.floor(this.ctx.sampleRate * 0.08);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  _waves() {
    const mk = (n, p, k) => {
      const real = new Float32Array(n + 1), imag = new Float32Array(n + 1);
      for (let h = 1; h <= n; h++) imag[h] = Math.exp(-k * (h - 1)) / Math.pow(h, p) * (h % 7 === 0 ? 0.3 : 1);
      return this.ctx.createPeriodicWave(real, imag);
    };
    return { low: mk(24, 1.0, 0.06), mid: mk(16, 1.15, 0.12), high: mk(8, 1.3, 0.2) };
  }
  async resume() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch {} }
    return this.ctx.state === 'running';
  }
  setVolume(v) { this.volume = v; this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }
  get now() { return this.ctx.currentTime; }

  /** Start a note. Returns a voice with release(when). */
  noteOn(m, vel = 0.75, when = this.ctx.currentTime) {
    if (this.muted) return { release() {} };
    const ctx = this.ctx, t = Math.max(when, ctx.currentTime);
    const f = 440 * Math.pow(2, (m - 69) / 12);
    const wave = m < 50 ? this.waves.low : m < 78 ? this.waves.mid : this.waves.high;
    const v = Math.min(1, Math.max(0.05, vel));
    const out = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const bright = 1800 + 7000 * v * v + f * 2.5;
    lp.frequency.setValueAtTime(Math.min(bright, 14000), t);
    lp.frequency.setTargetAtTime(Math.max(900, f * 3), t + 0.01, 0.35);
    lp.Q.value = 0.4;
    lp.connect(out);
    const amp = 0.34 * v * (m < 40 ? 0.9 : m > 90 ? 0.8 : 1);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(amp, t + 0.004);
    const tau = 0.55 + Math.max(0, 96 - m) / 24;      // lower notes ring longer
    out.gain.setTargetAtTime(amp * 0.0, t + 0.04, tau);
    out.connect(this.master);
    const oscs = [-3, 3].map((cents) => {
      const o = ctx.createOscillator();
      o.setPeriodicWave(wave);
      o.frequency.value = f;
      o.detune.value = cents;
      const g = ctx.createGain(); g.gain.value = 0.5;
      o.connect(g); g.connect(lp);
      o.start(t);
      return o;
    });
    // hammer thump
    const ns = ctx.createBufferSource(); ns.buffer = this.noise;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = Math.min(f * 2, 5000); nf.Q.value = 0.7;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.22 * v, t); ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
    ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t);
    const voice = {
      m, released: false,
      release: (at = ctx.currentTime, rel = 0.18) => {
        if (voice.released) return; voice.released = true;
        const r = Math.max(at, ctx.currentTime);
        out.gain.cancelScheduledValues(r);
        out.gain.setTargetAtTime(0, r, rel / 3);
        oscs.forEach((o) => { try { o.stop(r + rel * 2 + 0.2); } catch {} });
        setTimeout(() => this.voices.delete(voice), (r - ctx.currentTime + rel * 2 + 0.4) * 1000);
      },
      kill: () => { try { oscs.forEach((o) => o.stop()); out.disconnect(); } catch {} this.voices.delete(voice); },
    };
    // natural end after the decay for held notes
    const life = (t - ctx.currentTime) + 0.04 + tau * 7;
    oscs.forEach((o) => { try { o.stop(t + 0.04 + tau * 7); } catch {} });
    setTimeout(() => this.voices.delete(voice), life * 1000);
    this.voices.add(voice);
    if (this.voices.size > 64) { const first = this.voices.values().next().value; first.release(ctx.currentTime, 0.05); }
    return voice;
  }
  /** Convenience: play a note for a given duration (seconds) */
  play(m, dur, vel = 0.75, when = this.ctx.currentTime) {
    const v = this.noteOn(m, vel, when);
    v.release(Math.max(when, this.ctx.currentTime) + dur, Math.min(0.4, 0.12 + dur * 0.2));
    return v;
  }
  allOff() { for (const v of [...this.voices]) v.release(this.ctx.currentTime, 0.06); }

  click(when, accent = false) {
    const ctx = this.ctx, t = Math.max(when, ctx.currentTime);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = accent ? 1760 : 1175;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(accent ? 0.35 : 0.22, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.06);
    o.connect(g); g.connect(this.comp); o.start(t); o.stop(t + 0.08);
  }
  /** soft "ding" for correct notes / stars */
  chime(freq = 1568, when = this.ctx.currentTime, vol = 0.12) {
    const ctx = this.ctx, t = Math.max(when, ctx.currentTime);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.5);
    o.connect(g); g.connect(this.comp); o.start(t); o.stop(t + 0.55);
  }
}

export function getAudio() {
  if (!shared) shared = new AudioEngine();
  return shared;
}
