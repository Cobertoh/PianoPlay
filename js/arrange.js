// PianoPlay - audio -> piano ARRANGEMENT (not a raw note dump).
//
// What a pianist does when covering a song by ear, done with signal processing:
//   1. Separate the steady, pitched sound from drums/hits (harmonic–percussive separation by median
//      filtering on a semitone spectrogram). Drums are broadband and short; notes are narrow and steady.
//   2. Follow ONE main melody line – the thing you would hum – with a dynamic-programming pitch tracker
//      that prefers smooth, stable lines. Speech and gliding vocal samples are unstable in pitch, so they
//      mostly fall out; very short blips are removed.
//   3. Track the beat (tempo + beat positions, robust to drift) and find the chords every half bar from
//      the harmonic spectrum (bass weighted), smoothed so chords only change when the music really does.
//   4. Write a clean two-hand piano part: the melody in the right hand, a left-hand pattern built from the
//      chords (broken chords, held chords or a fuller pattern), with sustain pedal on every chord change.
//
// It runs entirely on the device. It is an arrangement "in the style of" the recording – the melody and
// harmony are taken from the audio, the piano texture is composed from them.
import { FFT, hann, amplitudeSpectrum } from './fft.js';
import { midiToFreq, buildSong, barLength } from './music.js';
import { estimateTempo, detectKey } from './transcribe.js';

const LO = 24, HI = 108, K = HI - LO + 1;        // semitone bins C1..C8
const BAND_EDGES = Array.from({ length: 37 }, (_, i) => 60 * Math.pow(5000 / 60, i / 36));
const tick = () => new Promise((r) => setTimeout(r, 0));

// ------------------------------------------------------------------ 1. analysis (heavy, once per file)
/**
 * input: a mono Float32Array, or { left, right } for stereo. With stereo we also build two extra views:
 *   centre = |mid| − |side|  (what is panned to the middle: lead vocal, hook samples, bass)
 *   side   = |side|          (what is spread left/right: guitars, keys, pads)
 */
export async function analyzeForArrangement(input, sr, { onProgress, shouldCancel } = {}) {
  const stereo = !(input instanceof Float32Array) && input.left && input.right;
  const len = stereo ? input.left.length : input.length;
  const N = sr > 30000 ? 8192 : 4096, hop = Math.round(sr * 0.0232), hz = sr / N;
  const fft = new FFT(N), win = hann(N), mag = new Float32Array(N / 2), magS = new Float32Array(N / 2);
  const nF = Math.max(1, Math.floor(len / hop));
  const mono = new Float32Array(len), side = stereo ? new Float32Array(len) : null;
  for (let i = 0; i < len; i++) { if (stereo) { mono[i] = (input.left[i] + input.right[i]) / 2; side[i] = (input.left[i] - input.right[i]) / 2; } else mono[i] = input[i]; }
  // loudness normalisation
  const pick = []; for (let i = 0; i < len; i += Math.max(1, Math.floor(len / 4000))) pick.push(Math.abs(mono[i]));
  pick.sort((a, b) => a - b); const p95 = pick[Math.floor(pick.length * 0.95)] || 1e-3;
  const gain = Math.min(40, Math.max(0.2, 0.12 / Math.max(p95, 1e-5)));
  for (let i = 0; i < len; i++) { mono[i] *= gain; if (side) side[i] *= gain; }
  const x = mono;
  let sideE = 0, midE = 0; if (side) for (let i = 0; i < len; i += 5) { sideE += side[i] * side[i]; midE += mono[i] * mono[i]; }
  const wide = !!side && sideE / (midE + 1e-9) > 0.02;          // a real stereo mix (not mono saved as stereo)
  // low notes need finer frequency resolution: a second, longer FFT (every third frame) for bins below MIDI 52
  const N2 = N * 4, hz2 = sr / N2, fft2 = new FFT(N2), win2 = hann(N2), mag2 = new Float32Array(N2 / 2), KB = 52 - LO;
  const ranges2 = []; for (let k = 0; k < KB; k++) { const f = midiToFreq(LO + k); ranges2.push([Math.max(1, Math.round((f * 0.9715) / hz2)), Math.round((f * 1.0293) / hz2)]); }
  const ranges = []; for (let k = 0; k < K; k++) { const f = midiToFreq(LO + k); let a = Math.floor((f * 0.9715) / hz), b = Math.ceil((f * 1.0293) / hz); a = Math.max(1, Math.min(a, Math.round(f / hz))); b = Math.min(N / 2 - 1, Math.max(b, Math.round(f / hz))); ranges.push([a, b]); }
  const spec = new Float32Array(nF * K), specC = wide ? new Float32Array(nF * K) : null, specS = wide ? new Float32Array(nF * K) : null;
  const flux = new Float32Array(nF), lowFlux = new Float32Array(nF), rms = new Float32Array(nF);
  let prev = new Float32Array(36);
  for (let i = 0; i < nF; i++) {
    const c = i * hop;
    amplitudeSpectrum(fft, win, x, c - N / 2, mag);
    if (wide) amplitudeSpectrum(fft, win, side, c - N / 2, magS);
    for (let k = 0; k < K; k++) {
      const [a, b] = ranges[k]; let m = 0, ms = 0, mc = 0;
      for (let j = a; j <= b; j++) { if (mag[j] > m) m = mag[j]; if (wide) { if (magS[j] > ms) ms = magS[j]; const cc = mag[j] - magS[j]; if (cc > mc) mc = cc; } }
      spec[i * K + k] = m; if (wide) { specS[i * K + k] = ms; specC[i * K + k] = mc; }
    }
    if (i % 3 === 0) amplitudeSpectrum(fft2, win2, x, c - N2 / 2, mag2);   // bass moves slowly; refresh every 3rd frame
    for (let k = 0; k < KB; k++) { const [a, b] = ranges2[k]; let m = 0; for (let j = a; j <= b; j++) if (mag2[j] > m) m = mag2[j]; spec[i * K + k] = m; }
    const band = new Float32Array(36);
    for (let bnd = 0; bnd < 36; bnd++) { let s = 0; for (let j = Math.max(1, Math.floor(BAND_EDGES[bnd] / hz)); j < Math.min(N / 2, Math.ceil(BAND_EDGES[bnd + 1] / hz)); j++) s += mag[j]; band[bnd] = Math.log1p(s * 40); }
    let f = 0, lf = 0; for (let bnd = 0; bnd < 36; bnd++) { const d = Math.max(0, band[bnd] - prev[bnd]); f += d; if (BAND_EDGES[bnd] < 180) lf += d; }
    flux[i] = f; lowFlux[i] = lf; prev = band;
    let e = 0; for (let j = Math.max(0, c - hop); j < Math.min(len, c + hop); j++) e += x[j] * x[j]; rms[i] = Math.sqrt(e / (2 * hop));
    if (i % 96 === 0) { onProgress?.(0.8 * i / nF); await tick(); if (shouldCancel?.()) throw new Error('cancelled'); }
  }
  // harmonic / percussive separation (median filters: along time = steady notes, along frequency = hits)
  const L = whiten(hpss(spec, nF, 9, 7), nF);
  onProgress?.(0.87); await tick();
  const Lc = wide ? whiten(hpss(specC, nF, 9, 7), nF) : null;
  onProgress?.(0.94); await tick();
  const Ls = wide ? whiten(hpss(specS, nF, 9, 7), nF) : null;
  onProgress?.(1);
  return { kind: 'arrange', L, Lc, Ls, wide, nF, hop, sr, hopSec: hop / sr, flux, lowFlux, rms, duration: len / sr };
}

/** log-compress and remove each frame's spectral floor */
function whiten(harm, nF) {
  const L = new Float32Array(nF * K), tmp = new Float32Array(K);
  for (let i = 0; i < nF; i++) {
    for (let k = 0; k < K; k++) tmp[k] = Math.log1p(harm[i * K + k] * 300);
    const srt = Array.from(tmp).sort((a, b) => a - b), floor = srt[Math.floor(K * 0.5)];
    for (let k = 0; k < K; k++) L[i * K + k] = Math.max(0, tmp[k] - floor);
  }
  return L;
}

function hpss(spec, nF, wt, wf) {
  const H = new Float32Array(spec.length), out = new Float32Array(spec.length), buf = new Float32Array(Math.max(wt, wf));
  const ht = wt >> 1, hf = wf >> 1;
  const med = (n) => { const a = buf.subarray(0, n); a.sort(); return a[n >> 1]; };
  for (let k = 0; k < K; k++) for (let i = 0; i < nF; i++) { let n = 0; for (let j = i - ht; j <= i + ht; j++) buf[n++] = spec[Math.min(nF - 1, Math.max(0, j)) * K + k]; H[i * K + k] = med(n); }
  for (let i = 0; i < nF; i++) for (let k = 0; k < K; k++) {
    let n = 0; for (let j = k - hf; j <= k + hf; j++) buf[n++] = spec[i * K + Math.min(K - 1, Math.max(0, j))];
    const p = med(n), h = H[i * K + k], h2 = h * h, m = h2 / (h2 + p * p + 1e-12);
    out[i * K + k] = spec[i * K + k] * m;
  }
  return out;
}

// ------------------------------------------------------------------ 2. melody
const HOFF = [0, 12, 19, 24, 28, 31], HW = [1, 0.75, 0.55, 0.4, 0.3, 0.22];
function melodyPath(an, L = an.L, MEL_LO = 50, MEL_HI = 88) {
  const { nF } = an, S = MEL_HI - MEL_LO + 1;
  const sal = new Float32Array(nF * S), fmax = new Float32Array(nF);
  const row = new Float32Array(K);
  for (let i = 0; i < nF; i++) {
    let mx = 0;
    for (let k = 0; k < K; k++) row[k] = L[i * K + k];
    // explain away the bass: its 2nd/3rd/4th… harmonics sit right in the melody range
    for (let pass = 0; pass < 2; pass++) {
      let bb = -1, bv = 0;
      for (let m = 28; m <= 50; m++) { const k = m - LO; if (row[k] < 0.35 || row[k] < row[k - 1] || row[k] < row[k + 1]) continue; let v = 0; for (let h = 0; h < 4; h++) v += HW[h] * row[k + HOFF[h]]; if (v > bv) { bv = v; bb = k; } }
      if (bb < 0 || bv < 1) break;
      row[bb] = 0; for (let h = 1; h < HOFF.length; h++) { const kk = bb + HOFF[h]; if (kk < K) row[kk] *= 0.2; }
    }
    for (let s = 0; s < S; s++) {
      const k = MEL_LO + s - LO; let v = 0;
      for (let h = 0; h < HOFF.length; h++) { const kk = k + HOFF[h]; if (kk < K) v += HW[h] * row[kk]; }
      const f0 = row[k];
      if (f0 < 0.35) v *= 0.25;                                       // a real melody note has its fundamental
      // a note an octave below explaining this one as its 2nd harmonic is weaker evidence than this note itself
      sal[i * S + s] = v; if (v > mx) mx = v;
    }
    fmax[i] = mx;
  }
  const act = Array.from(fmax).filter((v, i) => an.rms[i] > 0.004).sort((a, b) => a - b);
  const G = act[Math.floor(act.length * 0.9)] || 1;
  // Viterbi over S pitches + 1 silent state
  const U = S, back = new Int16Array(nF * (S + 1));
  let prev = new Float32Array(S + 1), cur = new Float32Array(S + 1);
  const theta = 0.42, jump = 0.03, voiceSw = 0.35, hiPref = 0.0035;
  const emit = (i, s) => sal[i * S + s] / G + hiPref * s;
  for (let s = 0; s <= S; s++) prev[s] = s === U ? theta : emit(0, s);
  for (let i = 1; i < nF; i++) {
    // best voiced predecessor for each s within ±12 with linear jump cost: O(S*25)
    for (let s = 0; s < S; s++) {
      let best = prev[U] - voiceSw, arg = U;
      for (let d = -12; d <= 12; d++) { const p = s + d; if (p < 0 || p >= S) continue; const v = prev[p] - jump * Math.abs(d) - (d ? 0.04 : 0); if (v > best) { best = v; arg = p; } }
      cur[s] = best + emit(i, s); back[i * (S + 1) + s] = arg;
    }
    let best = prev[U], arg = U; for (let p = 0; p < S; p++) { const v = prev[p] - voiceSw; if (v > best) { best = v; arg = p; } }
    cur[U] = best + theta; back[i * (S + 1) + U] = arg;
    const t = prev; prev = cur; cur = t;
  }
  let s = 0; for (let k = 1; k <= S; k++) if (prev[k] > prev[s]) s = k;
  const path = new Int16Array(nF), str = new Float32Array(nF);
  for (let i = nF - 1; i >= 0; i--) { path[i] = s === U ? -1 : MEL_LO + s; str[i] = s === U ? 0 : sal[i * S + s] / G; s = i > 0 ? back[i * (S + 1) + s] : s; }
  return { path, str };
}

function segmentMelody(an, { path, str }, L = an.L) {
  const { hopSec } = an, nF = path.length;
  // remove 1–2 frame glitches
  for (let i = 1; i < nF - 1; i++) {
    if (path[i] !== path[i - 1]) { let j = i; while (j < nF && path[j] === path[i] && j - i < 3) j++; if (j - i < 3 && j < nF && path[j] === path[i - 1]) for (let k = i; k < j; k++) path[k] = path[i - 1]; }
  }
  const notes = [];
  let i = 0;
  while (i < nF) {
    if (path[i] < 0) { i++; continue; }
    const m = path[i]; let j = i; while (j < nF && path[j] === m) j++;
    // split repeated notes on a fresh attack at this pitch
    const k = m - LO; let st = i;
    for (let f = i + 4; f < j - 2; f++) {
      const e = L[f * K + k], before = Math.min(L[(f - 1) * K + k], L[(f - 2) * K + k], L[(f - 3) * K + k]);
      let pk = 0; for (let g = st; g < f - 2; g++) pk = Math.max(pk, L[g * K + k]);
      if (e - before > 0.55 && pk - before > 0.45 && f - st >= 5) { push(st, f); st = f; }
    }
    push(st, j);
    i = j;
    function push(a, b) {
      let s = 0; for (let f = a; f < b; f++) s += str[f];
      notes.push({ m, t0: a * hopSec + 0.03, t1: b * hopSec + 0.03, s: s / (b - a) });
    }
  }
  return notes.filter((n) => n.t1 - n.t0 >= 0.09);
}

// ------------------------------------------------------------------ 3. beats & chords
/** Tempo from onset autocorrelation, scored with its multiples and subdivision so that 2/3 and 3/2 errors lose. */
export function tempoOf(an) {
  const { flux, hopSec } = an, n = flux.length, w = Math.round(0.4 / hopSec);
  const o = new Float32Array(n); let run = 0;
  for (let i = 0; i < n; i++) { run += flux[i]; if (i >= w) run -= flux[i - w]; o[i] = Math.max(0, flux[i] - run / Math.min(i + 1, w)); }
  const maxLag = Math.ceil((60 / 55) * 4 / hopSec) + 2, ac = new Float32Array(maxLag + 1);
  for (let l = 1; l <= maxLag; l++) { let s = 0; for (let i = l; i < n; i++) s += o[i] * o[i - l]; ac[l] = s / (n - l); }
  const A = (x) => { const i = Math.floor(x), f = x - i; return i + 1 <= maxLag ? ac[i] * (1 - f) + ac[i + 1] * f : 0; };
  const pk = (x) => Math.max(A(x - 1), A(x), A(x + 1));
  let best = 0, bpm = 100, conf = 0; const all = [];
  for (let b = 58; b <= 165; b += 0.25) {
    const l = 60 / b / hopSec;
    const sc = (pk(l) + 0.6 * pk(2 * l) + 0.4 * pk(4 * l) + 0.35 * pk(l / 2)) * Math.exp(-0.5 * (Math.log2(b / 95) / 0.8) ** 2);
    all.push(sc); if (sc > best) { best = sc; bpm = b; }
  }
  all.sort((a, b) => a - b); conf = best / (all[Math.floor(all.length / 2)] + 1e-9);
  return { bpm, confidence: conf };
}

export function trackBeats(an, bpm) {
  const { flux, hopSec } = an, n = flux.length;
  const o = new Float32Array(n), w = Math.round(0.4 / hopSec);
  let run = 0; for (let i = 0; i < n; i++) { run += flux[i]; if (i >= w) run -= flux[i - w]; o[i] = Math.max(0, flux[i] - run / Math.min(i + 1, w)); }
  const sd = Math.sqrt(o.reduce((a, b) => a + b * b, 0) / n) || 1; for (let i = 0; i < n; i++) o[i] /= sd;
  const p = 60 / bpm / hopSec, C = new Float32Array(n), B = new Int32Array(n).fill(-1), alpha = 6;
  for (let i = 0; i < n; i++) {
    let best = 0, arg = -1;
    for (let j = Math.round(i - 2 * p); j <= Math.round(i - p / 2); j++) { if (j < 0) continue; const v = C[j] - alpha * (Math.log((i - j) / p) ** 2); if (v > best || arg < 0) { best = v; arg = j; } }
    C[i] = o[i] + (arg >= 0 ? Math.max(0, best) : 0); B[i] = arg >= 0 && best > 0 ? arg : -1;
  }
  let end = 0; for (let i = Math.max(0, n - Math.round(p)); i < n; i++) if (C[i] > C[end] || end < n - Math.round(p)) end = i;
  const beats = []; for (let i = end; i >= 0; i = B[i]) { beats.push(i * hopSec); if (B[i] < 0) break; }
  beats.reverse();
  // fill gaps / extend to cover the whole file with the local period
  const per = 60 / bpm, full = [];
  let t = beats[0] ?? 0; while (t - per > -per * 0.5) t -= per;
  const tail = beats.length ? beats : [t];
  for (let b = t; b < tail[0] - per * 0.5; b += per) full.push(b);
  for (let k = 0; k < tail.length; k++) { full.push(tail[k]); if (k + 1 < tail.length) { const gap = tail[k + 1] - tail[k], m = Math.round(gap / per); for (let q = 1; q < m; q++) full.push(tail[k] + (gap * q) / m); } }
  for (let b = full[full.length - 1] + per; b < an.duration + per; b += per) full.push(b);
  return full;
}

/** Up to 6 pitches in a frame (MIDI 28..84) by iterative harmonic-sum + cancellation, so overtones don't pose as chord tones. */
function framePitches(an, f) {
  an._fp ||= new Map(); const c = an._fp.get(f); if (c) return c;
  const row = an.L.slice(f * K, f * K + K), out = [];
  for (let it = 0; it < 6; it++) {
    let best = -1, bv = 0;
    for (let m = 28; m <= 84; m++) {
      const k = m - LO; if (row[k] < 0.35 || row[k] < row[k - 1] || (k + 1 < K && row[k] < row[k + 1])) continue;
      let v = 0; for (let h = 0; h < HOFF.length; h++) { const kk = k + HOFF[h]; if (kk < K) v += HW[h] * row[kk]; }
      if (v > bv) { bv = v; best = m; }
    }
    if (best < 0 || bv < 0.8 || (out.length && bv < out[0][1] * 0.25)) break;
    out.push([best, bv]);
    const k = best - LO; for (let h = 0; h < HOFF.length; h++) { const kk = k + HOFF[h]; if (kk < K) { row[kk] *= h === 0 ? 0 : 0.35; if (kk + 1 < K) row[kk + 1] *= 0.5; row[kk - 1] *= 0.5; } }
  }
  an._fp.set(f, out); return out;
}

const CHORD_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SHARP_KEYS = new Set(['G', 'D', 'A', 'E', 'B', 'F#', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m']);
function chordsFor(an, segs, keyPc, minorKey, perBar = 2) {
  const { L, nF, hopSec } = an;
  const scale = (minorKey ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]).map((x) => (x + keyPc) % 12);
  const cands = []; for (let r = 0; r < 12; r++) for (const q of [0, 1]) cands.push({ r, q });
  const score = [], energy = [];
  for (const [a, b] of segs) {
    const fa = Math.max(0, Math.floor(a / hopSec)), fb = Math.min(nF, Math.max(fa + 1, Math.floor(b / hopSec)));
    const ch = new Float64Array(12), bass = new Float64Array(12); let e = 0;
    for (let f = fa; f < fb; f++) for (const [m, v0] of framePitches(an, f)) { const v = an._path && an._path[f] === m ? v0 * 0.3 : v0; if (m >= 40) ch[m % 12] += v; if (m <= 52) bass[m % 12] += v; e += v; }
    const sc = ch.reduce((x, y) => x + y, 0) || 1, sb = bass.reduce((x, y) => x + y, 0) || 1;
    for (let i = 0; i < 12; i++) { ch[i] /= sc; bass[i] /= sb; }
    energy.push(e / (fb - fa));
    score.push(cands.map(({ r, q }) => {
      const t3 = (r + (q ? 3 : 4)) % 12, t5 = (r + 7) % 12;
      let s = ch[r] * 1 + ch[t3] * 0.9 + ch[t5] * 0.75;
      for (let i = 0; i < 12; i++) if (i !== r && i !== t3 && i !== t5) s -= ch[i] * 0.3;
      s += bass[r] * 0.8 - bass[t3] * 0.15 - (bass[(r + 1) % 12] + bass[(r + 11) % 12]) * 0.2;
      if (scale.includes(r) && scale.includes(t3) && scale.includes(t5)) s += 0.1;
      return s;
    }));
  }
  // Viterbi: chords change only when the evidence is clearly better
  const n = segs.length, C = cands.length, back = [], change = 0.07;
  let prev = score[0] ? [...score[0]] : [];
  for (let i = 1; i < n; i++) {
    let bi = 0; for (let c = 1; c < C; c++) if (prev[c] > prev[bi]) bi = c;
    const cur = new Array(C), bk = new Array(C);
    const chg = i % perBar === 0 ? change : change * 2.2;   // prefer changes on the bar line
    for (let c = 0; c < C; c++) { const stay = prev[c], sw = prev[bi] - chg; if (stay >= sw) { cur[c] = stay + score[i][c]; bk[c] = c; } else { cur[c] = sw + score[i][c]; bk[c] = bi; } }
    back.push(bk); prev = cur;
  }
  let c = 0; for (let k = 1; k < C; k++) if (prev[k] > prev[c]) c = k;
  const res = new Array(n); for (let i = n - 1; i >= 0; i--) { res[i] = cands[c]; if (i > 0) c = back[i - 1][c]; }
  const eMed = [...energy].sort((a, b) => a - b)[Math.floor(n / 2)] || 1;
  return res.map((ch, i) => ({ ...ch, silent: energy[i] < eMed * 0.18, name: CHORD_NAMES[ch.r] + (ch.q ? 'm' : '') }));
}

// ------------------------------------------------------------------ 4. arrangement (cheap, re-run on every setting change)
export const _framePitches = framePitches;
export const ARR_DEFAULTS = { style: 'flow', bpm: null, octave: 0, detail: 'normal', ts: [4, 4], harmony: false, source: 'vocals' };

/** Melody line from one view of the audio, cached per view. */
function lineFrom(an, which) {
  an._lines ||= {};
  if (an._lines[which]) return an._lines[which];
  const L = which === 'centre' ? an.Lc : which === 'side' ? an.Ls : an.L;
  const [lo, hi] = which === 'centre' ? [52, 84] : [50, 88];
  const mp = melodyPath(an, L, lo, hi);
  const path = mp.path.slice();
  return (an._lines[which] = { path, notes: segmentMelody(an, mp, L) });
}

/** raw melody notes (seconds) -> clean, quantised, legato line (beats) */
function buildLine(raw, B, grid, bl, scale) {
  const sMed = raw.length ? [...raw].map((n) => n.s).sort((a, b) => a - b)[Math.floor(raw.length / 2)] : 1;
  let mel = raw.map((n) => ({ m: n.m, a: B(n.t0), b: B(n.t1), s: n.s })).filter((n) => n.a > -0.5);
  // drop weak isolated blips (talking, noise)
  mel = mel.filter((n, i) => {
    const near = mel.some((x, j) => j !== i && Math.abs(x.a - n.a) < 1.5);
    return n.s > sMed * 0.45 && (near || (n.b - n.a > 0.5 && n.s > sMed * 0.8));
  });
  // octave glitches: a note far from both neighbours is folded towards them
  for (let i = 1; i < mel.length - 1; i++) { const p = mel[i - 1].m, q = mel[i + 1].m, c = mel[i].m; if (Math.abs(c - p) >= 10 && Math.abs(c - q) >= 10) mel[i].m += Math.round(((p + q) / 2 - c) / 12) * 12; }
  // slides and scoops: short out-of-key notes are passing pitches of a glide -> snap to the scale
  if (scale) for (const n of mel) if (!scale.includes(((n.m % 12) + 12) % 12) && n.b - n.a < 0.75) { const up = scale.includes((n.m + 1) % 12); n.m += up ? 1 : -1; }
  // quantise; one note per grid slot (keep the stronger / longer)
  const slots = new Map();
  for (const n of mel) {
    const t = Math.max(0, Math.round(n.a / grid) * grid), d = Math.max(grid, Math.round((n.b - n.a) / grid) * grid);
    const k = t.toFixed(3), cur = slots.get(k), w = n.s * Math.min(2, d);
    if (!cur || w > cur.w) slots.set(k, { t, d, m: n.m, w, s: n.s });
  }
  let rh = [...slots.values()].sort((a, b) => a.t - b.t);
  // merge same pitch re-struck on the very next slot (sung notes wobble)
  rh = rh.filter((n, i) => !(i > 0 && rh[i - 1].m === n.m && Math.abs(rh[i - 1].t + rh[i - 1].d - n.t) < 1e-6 && n.d <= grid * 2 && n.s < rh[i - 1].s * 1.25 && ((rh[i - 1].d += n.d), true)));
  // legato like a singer: hold each note until the next one (up to a bar), never overlapping
  for (let i = 0; i < rh.length; i++) { const nx = rh[i + 1]; const gap = nx ? nx.t - rh[i].t : rh[i].d; rh[i].d = Math.max(grid, Math.min(gap <= 1.01 ? gap : Math.max(rh[i].d, Math.min(gap, 2)), bl)); }
  rh.sMed = sMed;
  return rh;
}

export function arrangeSong(an, opts = {}, title = 'Imported song') {
  const o = { ...ARR_DEFAULTS, ...opts };
  if (!an._tempo) an._tempo = tempoOf(an);
  // which view carries the tune
  const leadView = !an.wide ? 'mix' : o.source === 'instruments' ? 'side' : 'centre';
  const lead = lineFrom(an, leadView);
  const fillLine = an.wide && o.source === 'vocals' ? lineFrom(an, 'side') : null;
  an._path = lead.path;
  let raw = lead.notes;
  const bpm = o.bpm || an._tempo.bpm;
  const beatsT = (an._beats && an._beatsBpm === bpm) ? an._beats : (an._beats = trackBeats(an, bpm), an._beatsBpm = bpm, an._beats);
  const spb = 60 / bpm;
  const tToBeat = (t) => {
    let lo = 0, hi = beatsT.length - 2;
    if (t <= beatsT[0]) return (t - beatsT[0]) / spb;
    if (t >= beatsT[hi + 1]) return hi + 1 + (t - beatsT[hi + 1]) / spb;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (beatsT[mid] <= t) lo = mid; else hi = mid - 1; }
    return lo + (t - beatsT[lo]) / (beatsT[lo + 1] - beatsT[lo]);
  };
  const bl = barLength(o.ts);
  // downbeat: the beat phase (mod bar) with the strongest low-frequency hits (kick drum / bass notes)
  let bestOff = 0, bestS = -1;
  for (let off = 0; off < bl; off++) { let s = 0; for (let b = off; b < beatsT.length; b += bl) { const f = Math.round(beatsT[b] / an.hopSec); for (let d = -2; d <= 2; d++) s += an.lowFlux[f + d] || 0; } if (s > bestS) { bestS = s; bestOff = off; } }
  // first bar that contains music
  const firstT = Math.min(raw.length ? raw[0].t0 : Infinity, fillLine?.notes.length ? fillLine.notes[0].t0 : Infinity, an.duration);
  let startBeat = bestOff; while (startBeat + bl <= tToBeat(firstT) - 0.25) startBeat += bl;
  if (tToBeat(firstT) - startBeat < -0.01) startBeat -= bl;
  an._startBeat = startBeat;
  const B = (t) => tToBeat(t) - startBeat;
  // key from the whole harmonic spectrum (needed to clean up sung slides)
  const keyNotes = []; for (let k = 0; k < K; k++) { let s = 0; for (let f = 0; f < an.nF; f += 2) s += an.L[f * K + k]; if (LO + k >= 36 && LO + k <= 84) keyNotes.push({ m: LO + k, d: s }); }
  const key = detectKey(keyNotes), minorKey = /m$/.test(key);
  const keyPc = Math.max(0, CHORD_NAMES.indexOf(key.replace(/m$/, '').replace('C#', 'Db').replace('G#', 'Ab').replace('D#', 'Eb').replace('A#', 'Bb')));
  const scale = (minorKey ? [0, 2, 3, 5, 7, 8, 10, 11] : [0, 2, 4, 5, 7, 9, 11]).map((x) => (x + keyPc) % 12);
  // ---- melody: clean up to "what you would hum"
  const grid = o.detail === 'simple' ? 0.5 : o.detail === 'detailed' ? 0.25 : (bpm <= 92 ? 0.25 : 0.5);
  let rh = buildLine(raw, B, grid, bl, leadView === 'centre' ? scale : null);
  const sMed = rh.sMed;
  // vocals + instruments: the instrument riff answers in the gaps where the singer rests
  if (fillLine) {
    const fill = buildLine(fillLine.notes, B, grid, bl, null);
    const gaps = []; let prevEnd = 0;
    const lead0 = rh.map((n) => ({ t: n.t, e: n.t + Math.min(n.d, 2) }));
    for (const n of lead0) { if (n.t - prevEnd >= 1.5) gaps.push([prevEnd + 0.25, n.t - 0.25]); prevEnd = Math.max(prevEnd, n.e); }
    gaps.push([prevEnd + 0.25, Infinity]);
    const med = rh.length ? [...rh].map((n) => n.m).sort((a, b) => a - b)[Math.floor(rh.length / 2)] : 72;
    for (const f of fill) {
      const g = gaps.find(([a, b]) => f.t >= a && f.t < b); if (!g) continue;
      const m = f.m + Math.round((med - f.m) / 12) * 12;
      rh.push({ ...f, m, d: Math.min(f.d, g[1] - f.t), fill: true });
    }
    rh.sort((a, b) => a.t - b.t);
  }
  // comfortable right-hand register: centre the melody around A4–F5
  if (rh.length) {
    const med = [...rh].map((n) => n.m).sort((a, b) => a - b)[Math.floor(rh.length / 2)];
    const shift = Math.round((72 - med) / 12) * 12 + 12 * o.octave; an._shift = shift;
    rh.forEach((n) => { n.m += shift; while (n.m < 57) n.m += 12; while (n.m > 93) n.m -= 12; });
  }
  // ---- chords (half-bar segments)
  const half = bl / 2, lastBeat = Math.max(B(an.duration) - 0.01, rh.length ? rh[rh.length - 1].t + rh[rh.length - 1].d : 0);
  const nSeg = Math.max(1, Math.ceil(lastBeat / half));
  const beatTime = (b) => { const x = b + startBeat; const i = Math.floor(x); if (i < 0) return beatsT[0] + x * spb; if (i >= beatsT.length - 1) return beatsT[beatsT.length - 1] + (x - beatsT.length + 1) * spb; return beatsT[i] + (x - i) * (beatsT[i + 1] - beatsT[i]); };
  const segs = []; for (let i = 0; i < nSeg; i++) segs.push([beatTime(i * half), beatTime((i + 1) * half)]);
  const chords = chordsFor(an, segs, keyPc, minorKey);
  // melody that is silent for a whole segment with no harmony either -> treat as silence
  // ---- left hand
  const lh = [], harm = [], pedal = [];
  const melAt = (t) => { let best = null; for (const n of rh) if (n.t <= t + 1e-6 && n.t + n.d > t + 1e-6) best = n; return best; };
  let i = 0;
  while (i < nSeg) {
    const c = chords[i]; if (c.silent) { i++; continue; }
    let j = i + 1; while (j < nSeg && !chords[j].silent && chords[j].r === c.r && chords[j].q === c.q && (j - i) * half < bl * 2 - 1e-6 && !(o.style !== 'simple' && (j * half) % bl === 0 && (j - i) * half >= bl)) j++;
    const t0 = i * half, len = (j - i) * half;
    pedal.push([t0 + 0.03, t0 + len]);
    const root = 40 + ((c.r - 4 + 12) % 12), third = c.q ? 3 : 4;
    const add = (m, t, d, v) => { const mel = melAt(t); if (mel && m > mel.m - 3) m -= 12; if (m >= 28) lh.push({ t: +t.toFixed(4), d, m, v }); };
    if (o.style === 'simple') { add(root, t0, len, 0.52); add(root + 7, t0, len, 0.42); }
    else if (o.style === 'full') {
      for (let b = 0; b < len - 1e-6; b += half) { add(root, t0 + b, half, 0.55); if (b === 0) add(root - 12 >= 28 ? root - 12 : root + 12, t0, half, 0.45); [7, 12, 12 + third].forEach((iv) => add(root + iv, t0 + b + 1, half - 1, 0.4)); }
    } else {
      const pat = bpm <= 105 ? [0, 7, 12 + third, 7, 12, 7, 12 + third, 7] : [0, 7, 12 + third, 7];
      const step = bpm <= 105 ? 0.5 : 1;
      let k = 0; for (let b = 0; b < len - 1e-6; b += step, k++) add(root + pat[k % pat.length], t0 + b, step, k % pat.length === 0 ? 0.52 : 0.4);
    }
    // optional harmony under long melody notes at chord changes
    if (o.harmony || o.style === 'full') {
      const mel = melAt(t0);
      if (mel && mel.d >= 1) { const pcs = [c.r, (c.r + third) % 12, (c.r + 7) % 12]; for (let m = mel.m - 3; m >= mel.m - 9; m--) if (pcs.includes(((m % 12) + 12) % 12)) { harm.push({ t: t0, d: Math.min(mel.d, len), m, v: 0.45 }); break; } }
    }
    i = j;
  }
  // final chord: let the piece end on a held tonic-ish chord if it stops abruptly
  const notes = [
    ...rh.map((n) => ({ t: +n.t.toFixed(4), d: +n.d.toFixed(4), m: n.m, h: 'R', vel: (n.fill ? -0.08 : 0) + Math.min(0.92, 0.62 + 0.12 * Math.min(1, n.s / (sMed * 1.6)) + ((n.t % bl) < 1e-6 ? 0.05 : 0)) })),
    ...harm.map((n) => ({ ...n, h: 'R', vel: n.v })),
    ...lh.map((n) => ({ t: n.t, d: n.d, m: n.m, h: 'L', vel: n.v })),
  ];
  if (!notes.length) throw new Error('No melody or chords could be found in this audio.');
  const song = buildSong({
    id: 'import-' + Date.now(), title, composer: 'Piano arrangement', era: 'Custom', cat: 'custom', custom: true, source: 'audio',
    key, tempo: Math.max(40, Math.min(200, Math.round(bpm))), ts: o.ts, notes, exact: false, pedalStyle: 'full', pedal,
    desc: `Piano arrangement made from the recording: melody in the right hand, ${o.style === 'simple' ? 'held chords' : o.style === 'full' ? 'a full accompaniment' : 'flowing broken chords'} in the left.`,
  });
  // progression summary for the "learn it yourself" panel
  const prog = []; let last = null;
  const NAMES = SHARP_KEYS.has(key) ? SHARP_NAMES : CHORD_NAMES; chords.forEach((c) => { c.name = NAMES[c.r] + (c.q ? 'm' : ''); });
  for (let s = 0; s < nSeg; s++) { const c = chords[s]; if (c.silent) continue; if (c.name !== last) prog.push({ bar: Math.floor((s * half) / bl) + 1, name: c.name }); last = c.name; }
  song.chordsInfo = prog;
  song.analysisInfo = { bpm: Math.round(an._tempo.bpm), confidence: an._tempo.confidence, melodyNotes: rh.length, key, stereo: an.wide, source: leadView };
  return song;
}
