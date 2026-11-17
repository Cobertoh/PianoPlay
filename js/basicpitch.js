// PianoPlay - note-accurate transcription with Spotify's Basic Pitch model (Apache-2.0,
// https://github.com/spotify/basic-pitch-ts). The model runs in js/tfgraph.js (no libraries), spread
// over Web Workers when available. Note decoding below is a port of Basic Pitch's outputToNotesPoly.
import { GraphModel, Tensor } from './tfgraph.js';

export const SR = 22050;
const FFT_HOP = 256, N_SAMPLES = SR * 2 - FFT_HOP;           // 43844 samples per window
const OVERLAP_FRAMES = 30, HALF = 15, OVERLAP_SAMPLES = OVERLAP_FRAMES * FFT_HOP, HOP = N_SAMPLES - OVERLAP_SAMPLES;
const FPS = Math.floor(SR / FFT_HOP), ANNOT_N_FRAMES = FPS * 2;
const WINDOW_OFFSET = (FFT_HOP / SR) * (ANNOT_N_FRAMES - N_SAMPLES / FFT_HOP) + 0.0018;
const MIDI_OFFSET = 21;

let modelPromise = null;
export function loadModel(base = new URL('../models/basic-pitch/', import.meta.url).href, fetcher = fetch) {
  return (modelPromise ||= (async () => {
    const [j, b] = await Promise.all([fetcher(base + 'model.json').then((r) => r.json()), fetcher(base + 'group1-shard1of1.bin').then((r) => r.arrayBuffer())]);
    return new GraphModel(j, b);
  })());
}

/** Run one 43844-sample window; returns {frames, onsets} as Float32Array [142 x 88] (overlap removed). */
export function runWindow(model, win) {
  const [note, onset] = model.execute({ input_2: new Tensor([1, N_SAMPLES, 1], win) }, ['Identity_1', 'Identity_2']);
  const F = note.shape[1], keep = F - 2 * HALF;
  return { frames: note.data.slice(HALF * 88, (HALF + keep) * 88), onsets: onset.data.slice(HALF * 88, (HALF + keep) * 88), n: keep };
}

export function makeWindows(audio) {
  const padded = new Float32Array(OVERLAP_SAMPLES / 2 + audio.length); padded.set(audio, OVERLAP_SAMPLES / 2);
  const wins = [];
  for (let s = 0; s < padded.length; s += HOP) { const w = new Float32Array(N_SAMPLES); w.set(padded.subarray(s, s + N_SAMPLES)); wins.push(w); if (s + N_SAMPLES >= padded.length) break; }
  return wins;
}

/** audio: mono Float32Array at 22050 Hz. Returns { frames, onsets, nFrames } (flat Float32Array, 88 per frame). */
export async function transcribeActivations(audio, { onProgress, shouldCancel, workers = 0, workerUrl } = {}) {
  const wins = makeWindows(audio), nOut = Math.floor(audio.length * (FPS / SR));
  const results = new Array(wins.length);
  let done = 0;
  const tickP = () => new Promise((r) => setTimeout(r, 0));
  if (workers > 0 && workerUrl && typeof Worker !== 'undefined') {
    await new Promise((resolve, reject) => {
      let next = 0, finished = 0; const pool = [];
      const feed = (w) => { if (shouldCancel?.()) { pool.forEach((p) => p.terminate()); reject(new Error('cancelled')); return; } if (next >= wins.length) return; const i = next++; w.postMessage({ i, win: wins[i] }); };
      for (let k = 0; k < Math.min(workers, wins.length); k++) {
        const w = new Worker(workerUrl, { type: 'module' }); pool.push(w);
        w.onmessage = (e) => {
          if (e.data.error) { pool.forEach((p) => p.terminate()); reject(new Error(e.data.error)); return; }
          results[e.data.i] = e.data; finished++; onProgress?.(finished / wins.length);
          if (finished === wins.length) { pool.forEach((p) => p.terminate()); resolve(); } else feed(w);
        };
        w.onerror = (e) => { pool.forEach((p) => p.terminate()); reject(new Error(e.message || 'worker failed')); };
        feed(w);
      }
    });
  } else {
    const model = await loadModel();
    for (let i = 0; i < wins.length; i++) { results[i] = runWindow(model, wins[i]); done++; onProgress?.(done / wins.length); await tickP(); if (shouldCancel?.()) throw new Error('cancelled'); }
  }
  const frames = new Float32Array(nOut * 88), onsets = new Float32Array(nOut * 88);
  let pos = 0;
  for (const r of results) { const take = Math.min(r.n, nOut - pos); if (take <= 0) break; frames.set(r.frames.subarray(0, take * 88), pos * 88); onsets.set(r.onsets.subarray(0, take * 88), pos * 88); pos += take; }
  return { frames, onsets, nFrames: nOut };
}

const frameToTime = (f) => (f * FFT_HOP) / SR - WINDOW_OFFSET * Math.floor(f / ANNOT_N_FRAMES);

/** Port of Basic Pitch outputToNotesPoly (+ inferred onsets + "melodia trick"). Returns notes in seconds. */
export function activationsToNotes({ frames, onsets, nFrames }, { onsetThresh = 0.5, frameThresh = 0.3, minNoteLen = 11, inferOnsets = true, minMidi = 21, maxMidi = 108, energyTol = 11, melodia = true } = {}) {
  const P = 88, at = (a, f, p) => a[f * P + p];
  const lo = Math.max(0, minMidi - MIDI_OFFSET), hi = Math.min(P, maxMidi - MIDI_OFFSET + 1);
  const fr = frames.slice(), on = onsets.slice();
  for (let f = 0; f < nFrames; f++) for (let p = 0; p < P; p++) if (p < lo || p >= hi) { fr[f * P + p] = 0; on[f * P + p] = 0; }
  let ons = on;
  if (inferOnsets) {
    const diff = new Float32Array(nFrames * P); let dMax = 0, oMax = 0;
    for (let f = 0; f < nFrames; f++) for (let p = 0; p < P; p++) {
      const c = fr[f * P + p], d1 = c - (f >= 1 ? fr[(f - 1) * P + p] : 0), d2 = c - (f >= 2 ? fr[(f - 2) * P + p] : 0);
      const d = f < 2 ? 0 : Math.max(0, Math.min(d1, d2)); diff[f * P + p] = d; if (d > dMax) dMax = d; if (on[f * P + p] > oMax) oMax = on[f * P + p];
    }
    ons = new Float32Array(nFrames * P);
    for (let i = 0; i < ons.length; i++) ons[i] = Math.max(on[i], dMax ? (oMax * diff[i]) / dMax : 0);
  }
  // onset peaks over time (argrelmax, order 1)
  const starts = [];
  for (let f = 0; f < nFrames; f++) for (let p = 0; p < P; p++) {
    const v = ons[f * P + p]; if (v <= onsetThresh) continue;
    if ((f > 0 && !(v > ons[(f - 1) * P + p])) || (f < nFrames - 1 && !(v > ons[(f + 1) * P + p]))) continue;
    starts.push([f, p]);
  }
  starts.reverse();
  const energy = fr.slice(), notes = [];
  for (const [s, p] of starts) {
    if (s >= nFrames - 1) continue;
    let i = s + 1, k = 0;
    while (i < nFrames - 1 && k < energyTol) { if (energy[i * P + p] < frameThresh) k++; else k = 0; i++; }
    i -= k;
    if (i - s <= minNoteLen) continue;
    let amp = 0; for (let j = s; j < i; j++) { amp += at(fr, j, p); energy[j * P + p] = 0; if (p < P - 1) energy[j * P + p + 1] = 0; if (p > 0) energy[j * P + p - 1] = 0; }
    notes.push({ s, e: i, m: p + MIDI_OFFSET, a: amp / (i - s), mel: false });
  }
  if (melodia) {
    // repeated "loudest remaining frame" search: energy only ever gets zeroed, so walking a list sorted
    // once by value (skipping cleared cells) gives exactly the same order as re-scanning – but fast
    const cand = [];
    for (let i = 0; i < energy.length; i++) if (energy[i] > frameThresh) cand.push(i);
    const orig = Float32Array.from(cand, (i) => energy[i]);
    const ord = Uint32Array.from(cand.keys()).sort((x, y) => orig[y] - orig[x] || cand[x] - cand[y]);
    for (let q = 0; q < ord.length; q++) {
      const best = cand[ord[q]];
      if (energy[best] !== orig[ord[q]] || energy[best] <= frameThresh) continue;
      const iMid = Math.floor(best / P), p = best % P; energy[best] = 0;
      const clear = (i) => { energy[i * P + p] = 0; if (p < P - 1) energy[i * P + p + 1] = 0; if (p > 0) energy[i * P + p - 1] = 0; };
      let i = iMid + 1, k = 0;
      while (i < nFrames - 1 && k < energyTol) { if (energy[i * P + p] < frameThresh) k++; else k = 0; clear(i); i++; }
      const iEnd = i - 1 - k;
      i = iMid - 1; k = 0;
      while (i > 0 && k < energyTol) { if (energy[i * P + p] < frameThresh) k++; else k = 0; clear(i); i--; }
      const iStart = i + 1 + k;
      if (iEnd - iStart <= minNoteLen) continue;
      let amp = 0; for (let j = iStart; j < iEnd; j++) amp += at(fr, j, p);
      notes.push({ s: iStart, e: iEnd, m: p + MIDI_OFFSET, a: amp / (iEnd - iStart), mel: true });
    }
  }
  const onAt = (f, p) => { let v = 0; for (let d = -2; d <= 2; d++) { const ff = f + d; if (ff >= 0 && ff < nFrames) v = Math.max(v, onsets[ff * P + p]); } return v; };
  return notes.map((n) => ({ m: n.m, t0: frameToTime(n.s), t1: frameToTime(n.e), a: n.a, on: onAt(n.s, n.m - MIDI_OFFSET), mel: n.mel })).sort((x, y) => x.t0 - y.t0 || x.m - y.m);
}

/** Piano clean-up: merge same-pitch fragments of one held note, drop overtone ghosts (octave/12th above a louder note). */
export function cleanNotes(notes) {
  const byPitch = new Map();
  for (const n of [...notes].sort((a, b) => a.t0 - b.t0)) (byPitch.get(n.m) || byPitch.set(n.m, []).get(n.m)).push(n);
  let out = [];
  for (const list of byPitch.values()) {
    const merged = [];
    for (const n of list) {
      const prev = merged[merged.length - 1];
      // a "new" note with no real attack that starts as the previous one ends is the same held note
      if (prev && n.t0 - prev.t1 < 0.09 && (n.mel || n.on < 0.35)) { prev.t1 = Math.max(prev.t1, n.t1); continue; }
      merged.push({ ...n });
    }
    out.push(...merged);
  }
  out.sort((a, b) => a.t0 - b.t0 || a.m - b.m);
  out = out.filter((n) => !out.some((o) => o !== n && Math.abs(o.t0 - n.t0) < 0.06 && [12, 19, 24, 28].includes(n.m - o.m) && o.a > n.a * 1.2 && n.a < 0.55));
  // melodia-only notes (no onset at all) that are quiet are usually resonance, not played notes
  return out.filter((n) => !(n.mel && n.on < 0.2 && n.a < 0.45));
}
