// PianoPlay - audio -> notes. A small, dependency-free polyphonic transcriber that runs in the
// browser. It is *not* magic: it works best on solo piano / clean instrumental recordings and is
// approximate on dense, noisy or heavily reverberant music (see the Import screen for details).
//
//   analyzeAudio()  heavy step (STFT + multi-pitch detection per frame) -> analysis
//   framesToSong()  cheap step (note tracking, tempo, quantise, hands) -> song; re-run with new
//                   settings (sensitivity, simplify, tempo, grid...) without re-analysing.
import { FFT, hann, amplitudeSpectrum } from './fft.js';
import { detectNotes } from './pitch.js';
import { buildSong, keySignature, midiToName, parseChord } from './music.js';

const BAND_EDGES = Array.from({ length: 37 }, (_, i) => 60 * Math.pow(5000 / 60, i / 36));
export const ONSET_BIAS = 0.045;     // seconds; the first frame that "sees" a note is slightly early

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Decode an audio file/Blob to mono Float32 at 22.05 kHz (browser only). */
export async function decodeToMono(arrayBuffer, targetSr = 22050) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const probe = new Ctx(1, targetSr, targetSr);
  const buf = await new Promise((res, rej) => { const p = probe.decodeAudioData(arrayBuffer, res, rej); if (p && p.then) p.then(res, rej); });
  const len = Math.min(buf.length, Math.floor(buf.sampleRate * 60 * 6));            // cap at 6 minutes
  const mono = new Float32Array(len);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += d[i] / buf.numberOfChannels; }
  let out = mono, sr = buf.sampleRate;
  if (sr !== targetSr) {                                                            // simple resample via OfflineAudioContext
    const off = new Ctx(1, Math.ceil((len * targetSr) / sr), targetSr);
    const b2 = off.createBuffer(1, len, sr); b2.copyToChannel(mono, 0);
    const src = off.createBufferSource(); src.buffer = b2; src.connect(off.destination); src.start();
    out = (await off.startRendering()).getChannelData(0); sr = targetSr;
  }
  return { samples: out, sr, duration: len / buf.sampleRate, truncated: buf.length > len };
}

export async function analyzeAudio(samples, sr, { onProgress, shouldCancel } = {}) {
  const N = sr > 30000 ? 8192 : 4096, hop = Math.round(sr * 0.0232);
  const fft = new FFT(N), win = hann(N), mag = new Float32Array(N / 2);
  const nFrames = Math.max(1, Math.floor(samples.length / hop));
  // loudness normalisation so thresholds behave the same for quiet and loud recordings
  const rmsAt = (c) => { let e = 0, k = 0; for (let j = Math.max(0, c - hop); j < Math.min(samples.length, c + hop); j++) { e += samples[j] * samples[j]; k++; } return k ? Math.sqrt(e / k) : 0; };
  const sample = []; for (let i = 0; i < nFrames; i += Math.max(1, Math.floor(nFrames / 400))) sample.push(rmsAt(i * hop));
  sample.sort((a, b) => a - b);
  const p95 = sample[Math.floor(sample.length * 0.95)] || 1e-3;
  const gain = Math.min(30, Math.max(0.2, 0.08 / Math.max(p95, 1e-5)));
  const norm = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) norm[i] = samples[i] * gain;
  const frames = new Array(nFrames), flux = new Float32Array(nFrames);
  let prev = new Float32Array(36);
  const hzPerBin = sr / N;
  for (let i = 0; i < nFrames; i++) {
    const c = i * hop;
    amplitudeSpectrum(fft, win, norm, c - N / 2, mag);
    const e = (() => { let s = 0, k = 0; for (let j = Math.max(0, c - hop); j < Math.min(norm.length, c + hop); j++) { s += norm[j] * norm[j]; k++; } return k ? Math.sqrt(s / k) : 0; })();
    // spectral flux in 36 log bands
    const band = new Float32Array(36);
    for (let b = 0; b < 36; b++) {
      let s = 0;
      for (let k = Math.max(1, Math.floor(BAND_EDGES[b] / hzPerBin)); k < Math.min(N / 2, Math.ceil(BAND_EDGES[b + 1] / hzPerBin)); k++) s += mag[k];
      band[b] = Math.log1p(s * 40);
    }
    let f = 0; for (let b = 0; b < 36; b++) f += Math.max(0, band[b] - prev[b]);
    flux[i] = f; prev = band;
    let notes = [];
    if (e > 0.006) notes = detectNotes(mag, sr, N, { thresh: 2.1, maxNotes: 6 }).map((d) => [d.m, +d.s.toFixed(2)]);
    frames[i] = { e: +e.toFixed(4), n: notes };
    if (i % 64 === 0) {
      onProgress?.(i / nFrames);
      await tick();
      if (shouldCancel?.()) throw new Error('cancelled');
    }
  }
  onProgress?.(1);
  return { frames, flux, hop, sr, duration: samples.length / sr, hopSec: hop / sr };
}

// ---------------------------------------------------------------- tempo
export function estimateTempo(analysis, { min = 56, max = 168 } = {}) {
  const { flux, hopSec } = analysis;
  const n = flux.length;
  const f = new Float32Array(n);
  // local mean subtraction -> onset strength
  const w = Math.round(0.3 / hopSec);
  let run = 0;
  for (let i = 0; i < n; i++) { run += flux[i]; if (i >= 2 * w) run -= flux[i - 2 * w]; f[i] = Math.max(0, flux[i] - run / Math.min(i + 1, 2 * w)); }
  const lagMin = Math.floor(60 / max / hopSec), lagMax = Math.ceil(60 / min / hopSec);
  let best = 0, bestLag = lagMin, scores = [];
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0; for (let i = lag; i < n; i++) s += f[i] * f[i - lag];
    // also reward the double period (bar level) a little
    let s2 = 0; for (let i = 2 * lag; i < n; i += 1) s2 += f[i] * f[i - 2 * lag];
    const bpm = 60 / (lag * hopSec);
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 100) / 0.65, 2));     // prefer tempi near 100
    const sc = (s + 0.5 * s2) * prior / (n - lag);
    scores.push([lag, sc]);
    if (sc > best) { best = sc; bestLag = lag; }
  }
  // refine with parabolic interpolation
  const idx = bestLag - lagMin;
  let lagF = bestLag;
  if (idx > 0 && idx < scores.length - 1) { const a = scores[idx - 1][1], b = scores[idx][1], c = scores[idx + 1][1]; const d = a - 2 * b + c; if (d) lagF = bestLag + (0.5 * (a - c)) / d; }
  const bpm = 60 / (lagF * hopSec);
  // phase: offset (seconds) of the beat grid
  const period = lagF; let bestPh = 0, bp = -1;
  for (let ph = 0; ph < period; ph += 0.5) { let s = 0; for (let k = ph; k < n; k += period) s += f[Math.round(k)] || 0; if (s > bp) { bp = s; bestPh = ph; } }
  const sorted = scores.map((x) => x[1]).sort((a, b) => a - b);
  const conf = best / (sorted[Math.floor(sorted.length / 2)] + 1e-9);
  return { bpm, phase: bestPh * hopSec, confidence: conf };
}

// ---------------------------------------------------------------- key
const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MAJ_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MIN_NAMES = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];
export function detectKey(notes) {
  const h = new Float64Array(12);
  for (const n of notes) h[n.m % 12] += n.d;
  const corr = (prof, r) => { let ma = 0, mb = 0; for (let i = 0; i < 12; i++) { ma += h[(i + r) % 12]; mb += prof[i]; } ma /= 12; mb /= 12; let s = 0, a = 0, b = 0; for (let i = 0; i < 12; i++) { const x = h[(i + r) % 12] - ma, y = prof[i] - mb; s += x * y; a += x * x; b += y * y; } return s / Math.sqrt(a * b + 1e-9); };
  let best = -2, key = 'C';
  for (let r = 0; r < 12; r++) { const a = corr(KS_MAJ, r); if (a > best) { best = a; key = MAJ_NAMES[r]; } const b = corr(KS_MIN, r); if (b > best) { best = b; key = MIN_NAMES[r]; } }
  return key;
}

// ---------------------------------------------------------------- frames -> notes -> song
export const DEFAULTS = { sens: 1, minDur: 0.1, grid: 0.25, ts: [4, 4], maxPerHand: 4, faithful: true, split: null, bpm: null, simplifyShort: true };

export function framesToSong(analysis, options = {}, title = 'Imported song') {
  const o = { ...DEFAULTS, ...options };
  const { frames, hopSec } = analysis;
  const thr = 2.7 / o.sens;
  const tempoInfo = estimateTempo(analysis);
  const bpm = o.bpm || tempoInfo.bpm;
  // ---- 1. track pitches across frames
  const active = new Map(), raw = [];
  const finish = (m, a, endFrame) => {
    const dur = (endFrame - a.start) * hopSec;
    raw.push({ m, t0: a.start * hopSec + ONSET_BIAS, t1: a.start * hopSec + dur + ONSET_BIAS * 0.5, s: a.sum / a.n });
  };
  for (let i = 0; i <= frames.length; i++) {
    const cur = new Map();
    if (i < frames.length) for (const [m, s] of frames[i].n) if (s >= thr) cur.set(m, s);
    for (const [m, s] of cur) {
      let a = active.get(m);
      if (!a) { active.set(m, { start: i, last: i, sum: s, n: 1, hist: [s] }); continue; }
      // re-attack: salience jumps well above the recent minimum
      const h = a.hist; const recentMin = Math.min(...h.slice(-3));
      if (i - a.start > 4 && s > recentMin * 1.7 && s > thr * 1.4) { finish(m, a, i); active.set(m, { start: i, last: i, sum: s, n: 1, hist: [s] }); continue; }
      a.last = i; a.sum += s; a.n++; h.push(s);
    }
    for (const [m, a] of [...active]) if (!cur.has(m) && i - a.last > 2) { finish(m, a, a.last + 1); active.delete(m); }
  }
  let notes = raw.filter((n) => n.t1 - n.t0 >= Math.min(o.minDur, 0.08));
  // ---- 2. drop probable harmonics / ghosts: same-onset note an octave (or twelfth) above a much stronger one
  notes = notes.filter((a) => !notes.some((b) => b !== a && Math.abs(b.t0 - a.t0) < 0.06 && [12, 19, 24].includes(a.m - b.m) && b.s > a.s * 1.9));
  if (!notes.length) throw new Error('No notes were detected. Try raising the sensitivity, or use a cleaner (instrumental / piano) recording.');
  const exactAll = notes;   // everything that survived cleaning, for faithful playback
  notes = notes.filter((n) => n.t1 - n.t0 >= o.minDur);
  if (!notes.length) notes = exactAll;
  // ---- 3. quantise to the beat grid
  const bps = bpm / 60, grid = o.grid;
  const bl = (o.ts[0] * 4) / o.ts[1];
  const first = Math.min(...notes.map((n) => n.t0));
  const phase = o.bpm ? first : tempoInfo.phase;
  const toBeat = (t) => (t - phase) * bps;
  const q = (b) => Math.round(b / grid) * grid;
  let qn = notes.map((n) => {
    const t = q(toBeat(n.t0));
    let d = Math.max(grid, q((n.t1 - n.t0) * bps));
    return { t, d: Math.min(d, 8), m: n.m, v: n.s, h: 'R' };
  });
  const minT = Math.min(...qn.map((n) => n.t));
  const shift = Math.floor(minT / bl + 1e-6) * bl;
  qn.forEach((n) => (n.t = +(n.t - shift).toFixed(4)));
  // faithful notes: same beat axis, exact timing, quiet/short notes kept (this is what Watch plays)
  const faithful = o.faithful ? exactAll.map((n) => ({ t: +(toBeat(n.t0) - shift).toFixed(4), d: Math.max(0.1, (n.t1 - n.t0) * bps), m: n.m, h: n.m >= 60 ? 'R' : 'L', v: n.s })).filter((n) => n.t > -1) : null;
  if (faithful) { const mx = Math.max(...faithful.map((n) => n.v)) || 1; faithful.forEach((n) => { n.vel = 0.45 + 0.5 * Math.min(1, n.v / mx); }); }
  // merge duplicates (same pitch, same onset); shorten overlaps of same pitch
  qn.sort((a, b) => a.t - b.t || a.m - b.m);
  const out = [];
  const lastByPitch = new Map();
  for (const n of qn) {
    const prev = lastByPitch.get(n.m);
    if (prev && Math.abs(prev.t - n.t) < 1e-6) { prev.d = Math.max(prev.d, n.d); continue; }
    if (prev && prev.t + prev.d > n.t) prev.d = Math.max(grid, n.t - prev.t);
    out.push(n); lastByPitch.set(n.m, n);
  }
  // ---- 4. hands
  const pitches = out.map((n) => n.m).sort((a, b) => a - b);
  const med = pitches[Math.floor(pitches.length / 2)];
  let split = o.split ?? (med > 72 ? 66 : med < 50 ? 55 : 60);
  // monophonic material is a melody -> right hand, unless it lives down low
  const sim = maxSimultaneous(out);
  if (o.split == null && sim <= 1) split = Math.min(split, 50);
  out.forEach((n) => (n.h = n.m >= split ? 'R' : 'L'));
  // ---- 5. simplification (limit chord size per hand, drop very short notes when asked)
  let result = limitPerHand(out, o.maxPerHand);
  if (o.simplifyShort) result = result.filter((n) => n.d >= grid);
  result = result.map((n, i) => ({ ...n, id: i }));
  const key = detectKey(result);
  const tempo = Math.max(40, Math.min(200, Math.round(bpm)));
  const song = buildSong({
    id: 'import-' + Date.now(), title, composer: 'Imported audio', era: 'Custom', cat: 'custom', custom: true, source: 'audio',
    key, tempo, ts: o.ts, notes: result, exact: false,
    desc: `Transcribed from audio at ~${tempo} BPM. Approximate – edit settings to improve it.`,
  });
  if (faithful) song.audioNotes = faithful;
  song.analysisInfo = { bpm: tempoInfo.bpm, confidence: tempoInfo.confidence, notesRaw: raw.length, notes: result.length, split, maxSim: sim };
  return song;
}

function maxSimultaneous(notes) {
  const ev = [];
  for (const n of notes) { ev.push([n.t, 1]); ev.push([n.t + n.d - 1e-6, -1]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let c = 0, mx = 0; for (const [, d] of ev) { c += d; mx = Math.max(mx, c); }
  return mx;
}
function limitPerHand(notes, max) {
  const by = new Map();
  for (const n of notes) { const k = n.h + n.t.toFixed(3); if (!by.has(k)) by.set(k, []); by.get(k).push(n); }
  const keep = [];
  for (const g of by.values()) {
    if (g.length <= max) { keep.push(...g); continue; }
    g.sort((a, b) => b.v - a.v);
    const chosen = g.slice(0, max);
    keep.push(...chosen);
  }
  return keep.sort((a, b) => a.t - b.t || a.m - b.m);
}

/** Convenience: whole pipeline for tests */
export async function transcribeSamples(samples, sr, options, title) {
  const a = await analyzeAudio(samples, sr);
  return { analysis: a, song: framesToSong(a, options, title) };
}
export const _helpers = { midiToName, keySignature, parseChord };
