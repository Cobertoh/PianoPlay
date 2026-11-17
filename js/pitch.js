// PianoPlay - polyphonic note detection from an amplitude spectrum (harmonic-salience with
// iterative cancellation), plus the live microphone detector built on top of it.
import { FFT, hann, amplitudeSpectrum } from './fft.js';
import { midiToFreq } from './music.js';

const W = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2];
const tableCache = new Map();

function getTable(sr, n, minM, maxM, H) {
  const key = `${sr}|${n}|${minM}|${maxM}|${H}`;
  let t = tableCache.get(key);
  if (t) return t;
  const hz = sr / n, nb = n / 2;
  t = [];
  for (let m = minM; m <= maxM; m++) {
    const f0 = midiToFreq(m), hs = [];
    for (let h = 1; h <= H; h++) {
      const f = f0 * h;
      if (f > sr * 0.45) break;
      const c = f / hz;
      let lo = Math.floor((f * 0.98) / hz), hi = Math.ceil((f * 1.02) / hz);
      lo = Math.min(lo, Math.round(c) - 1); hi = Math.max(hi, Math.round(c) + 1);
      let b1 = Math.round((f * 0.9439) / hz), b2 = Math.round((f * 1.0595) / hz);
      b1 = Math.min(b1, Math.round(c) - 3); b2 = Math.max(b2, Math.round(c) + 3);
      if (b1 < 1 || hi >= nb - 1 || b2 >= nb - 1) { if (h === 1) break; else continue; }
      hs.push({ lo: Math.max(lo, 1), hi, b1, b2, w: W[h - 1] });
    }
    t.push({ m, hs });
  }
  tableCache.set(key, t);
  return t;
}

/**
 * mag: amplitude spectrum (n/2 bins, full-scale sine ~1). Returns [{m, s}] strongest first.
 * opt: thresh (salience), rel (relative to strongest), maxNotes, minM, maxM, ref
 */
export function detectNotes(mag, sr, n, opt = {}) {
  const { minM = 28, maxM = 100, maxNotes = 6, thresh = 3.2, rel = 0.3, H = 8, ref = 5e-4, minHarm = 2, attn2 = 0.5, attnN = 0.2, fund = 0.9 } = opt;
  const nb = n / 2;
  const ls = new Float32Array(nb);
  for (let i = 0; i < nb; i++) ls[i] = Math.log1p(mag[i] / ref);
  const table = getTable(sr, n, minM, maxM, H);
  const out = [];
  let first = 0;
  const salience = (e) => {
    let sum = 0, cnt = 0, c1 = 0;
    for (let k = 0; k < e.hs.length; k++) {
      const h = e.hs[k];
      let pk = 0;
      for (let i = h.lo; i <= h.hi; i++) if (ls[i] > pk) pk = ls[i];
      const base = (ls[h.b1] + ls[h.b2]) * 0.5;
      const c = pk - base;
      if (k === 0) c1 = c;
      if (c > 0.6) { sum += h.w * c; cnt++; }
    }
    // a real note has its fundamental (very low notes often don't, so they are exempt)
    if (e.m >= 45 && c1 < fund) return 0;
    return cnt >= minHarm ? sum : 0;
  };
  const taken = new Set();
  for (let k = 0; k < maxNotes; k++) {
    let best = null, bs = 0;
    for (const e of table) {
      if (taken.has(e.m)) continue;
      const s = salience(e);
      if (s > bs) { bs = s; best = e; }
    }
    if (!best || bs < thresh || (first && bs < rel * first)) break;
    if (!first) first = bs;
    // octave-error guard: if a candidate an octave lower explains this note as its 2nd partial, keep the stronger
    out.push({ m: best.m, s: bs });
    taken.add(best.m);
    best.hs.forEach((h, k) => {
      const base = (ls[h.b1] + ls[h.b2]) * 0.5;
      const a = k === 1 ? attn2 : attnN;
      for (let i = h.lo; i <= h.hi; i++) if (ls[i] > base) ls[i] = base + (ls[i] - base) * (k === 0 ? 0.1 : a);
    });
  }
  // drop ghosts: a detected note exactly one octave / octave+fifth above a much stronger note is likely a partial
  return out.filter((a) => !out.some((b) => b !== a && b.s > a.s * 2.4 && [12, 19, 24].includes(a.m - b.m)));
}

// ---------------------------------------------------------------- live microphone detector
export class MicDetector {
  constructor(ctx) {
    this.ctx = ctx;
    this.fftSize = 8192;
    this.fft = new FFT(this.fftSize);
    this.win = hann(this.fftSize);
    this.mag = new Float32Array(this.fftSize / 2);
    this.buf = new Float32Array(this.fftSize);
    this.active = new Map();          // midi -> {s, since}
    this.miss = new Map();
    this.hit = new Map();
    this.listeners = { on: [], off: [], level: [] };
    this.thresh = 3.2;
    this.sensitivity = 1;
    this.level = 0;
    this.noise = 0;
    this.running = false;
    this.rmsHist = [];
    this.pending = null;
    this.prevSal = new Map();
  }
  async start() {
    if (this.running) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch {}
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.an = this.ctx.createAnalyser();
    this.an.fftSize = this.fftSize;
    this.an.smoothingTimeConstant = 0;
    // a gentle high-pass removes rumble / handling noise
    this.hp = this.ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 35;
    this.src.connect(this.hp); this.hp.connect(this.an);
    this.sr = this.ctx.sampleRate;
    this.running = true;
    this.timer = setInterval(() => this.tick(), 32);
  }
  stop() {
    this.running = false;
    clearInterval(this.timer);
    try { this.stream?.getTracks().forEach((t) => t.stop()); } catch {}
    try { this.src?.disconnect(); } catch {}
    this.active.clear();
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  }
  on(ev, cb) { this.listeners[ev].push(cb); return () => (this.listeners[ev] = this.listeners[ev].filter((f) => f !== cb)); }
  emit(ev, a, b) { for (const f of this.listeners[ev]) f(a, b); }

  /** measure ambient noise for ~1.5 s and raise the threshold above it */
  async calibrate(ms = 1500) {
    const vals = [];
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      await new Promise((r) => setTimeout(r, 60));
      this.an.getFloatTimeDomainData(this.buf);
      amplitudeSpectrum(this.fft, this.win, this.buf, 0, this.mag);
      const d = detectNotes(this.mag, this.sr, this.fftSize, { thresh: 0.5, maxNotes: 1, minHarm: 2 });
      vals.push(d.length ? d[0].s : 0);
    }
    this.noise = Math.max(...vals, 0);
    this.thresh = Math.max(3.2, this.noise * 1.8 + 1);
    return this.noise;
  }
  setSensitivity(v) { this.sensitivity = v; }
  /** salience of specific expected notes in the most recent spectrum */
  targetScores(midis) { return scoreTargets(this.mag, this.sr, this.fftSize, midis, {}); }
  get effThresh() { return this.thresh / this.sensitivity; }

  tick() {
    if (!this.running) return;
    this.an.getFloatTimeDomainData(this.buf);
    // fast RMS over the most recent 1024 samples for onset detection
    let e = 0;
    for (let i = this.fftSize - 1024; i < this.fftSize; i++) e += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(e / 1024);
    this.level = this.level * 0.7 + rms * 0.3;
    this.emit('level', this.level);
    const hist = this.rmsHist;
    const baseline = hist.length ? Math.min(...hist) : rms;
    hist.push(rms); if (hist.length > 5) hist.shift();
    const now = performance.now();
    const onset = rms > 0.004 && rms > baseline * 2.1 + 0.002;
    if (onset && !this.pending && (!this.lastOnset || now - this.lastOnset > 110)) { this.pending = now + 70; this.lastOnset = now; }

    amplitudeSpectrum(this.fft, this.win, this.buf, 0, this.mag);
    const det = detectNotes(this.mag, this.sr, this.fftSize, { thresh: this.effThresh });
    const sal = new Map(det.map((d) => [d.m, d.s]));
    // stable on/off with hysteresis
    for (const [m, s] of sal) {
      this.miss.set(m, 0);
      const h = (this.hit.get(m) || 0) + 1;
      this.hit.set(m, h);
      if (!this.active.has(m) && h >= 2) { this.active.set(m, { s, since: now }); this.emit('on', m, s); }
      else if (this.active.has(m)) this.active.get(m).s = s;
    }
    for (const m of [...this.active.keys()]) {
      if (!sal.has(m)) {
        const k = (this.miss.get(m) || 0) + 1;
        this.miss.set(m, k);
        if (k >= 3) { this.active.delete(m); this.hit.set(m, 0); this.emit('off', m); }
      }
    }
    for (const m of [...this.hit.keys()]) if (!sal.has(m) && !this.active.has(m)) this.hit.set(m, 0);
    // re-strike: a note that was already sounding but got a fresh attack
    if (this.pending && now >= this.pending) {
      this.pending = null;
      for (const [m, s] of sal) {
        const before = this.prevSal.get(m) || 0;
        if (this.active.has(m) && before > 0 && s > before * 1.35 && now - (this.active.get(m).since || 0) > 150) this.emit('on', m, s);
      }
    }
    if (!this.pending) this.prevSal = sal;
  }
}

/**
 * Targeted check: how strongly is each *expected* note present? Unlike detectNotes() this does no
 * cancellation, so octave doublings (e.g. a left-hand octave) are still found.
 * Returns Map midi -> salience (0 when the fundamental is missing).
 */
export function scoreTargets(mag, sr, n, midis, opt = {}) {
  const { H = 8, ref = 5e-4, fund = 0.9 } = opt;
  const nb = n / 2;
  const ls = new Float32Array(nb);
  for (let i = 0; i < nb; i++) ls[i] = Math.log1p(mag[i] / ref);
  const res = new Map();
  for (const m of midis) {
    const e = getTable(sr, n, m, m, H)[0];
    if (!e) { res.set(m, 0); continue; }
    let sum = 0, cnt = 0, c1 = 0;
    e.hs.forEach((h, k) => {
      let pk = 0;
      for (let i = h.lo; i <= h.hi; i++) if (ls[i] > pk) pk = ls[i];
      const c = pk - (ls[h.b1] + ls[h.b2]) * 0.5;
      if (k === 0) c1 = c;
      if (c > 0.6) { sum += h.w * c; cnt++; }
    });
    res.set(m, (m >= 45 && c1 < fund) || cnt < 2 ? 0 : sum);
  }
  return res;
}
