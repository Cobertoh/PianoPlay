// End-to-end transcription test: synthesise a known two-hand piece, transcribe it, compare notes.
import assert from 'node:assert/strict';
import { analyzeAudio, framesToSong } from '../js/transcribe.js';
import { renderNotes } from './synth.mjs';
import { buildLibrary } from '../js/songs.js';

function score(truth, est, tolBeats = 0.26) {
  const used = new Set(); let tp = 0;
  for (const n of truth) {
    let bi = -1, bd = 1e9;
    est.forEach((e, i) => { if (used.has(i) || e.m !== n.m) return; const d = Math.abs(e.t - n.t); if (d < bd) { bd = d; bi = i; } });
    if (bi >= 0 && bd <= tolBeats) { used.add(bi); tp++; }
  }
  const p = est.length ? tp / est.length : 0, r = truth.length ? tp / truth.length : 0;
  return { p, r, f: p + r ? (2 * p * r) / (p + r) : 0 };
}

export async function run(t) {
  console.log('transcription (synthetic piano audio)');
  const lib = buildLibrary();
  const sr = 22050;
  for (const [id, secs, min] of [['twinkle-mozart', 22, 0.8], ['ode-to-joy', 24, 0.75], ['canon-d', 26, 0.7]]) {
    const song = lib.find((s) => s.id === id);
    const spb = 60 / song.tempo;
    const dur = Math.min(secs, song.length * spb + 1.5);
    const truth = song.notes.filter((n) => n.t * spb < secs - 1);
    const sig = renderNotes(truth.map((n) => ({ m: n.m, t: n.t * spb, d: Math.max(0.2, n.d * spb * 0.95), v: n.h === 'L' ? 0.1 : 0.14 })), sr, dur, { noise: 0.002 });
    const a = await analyzeAudio(sig, sr);
    const out = framesToSong(a, { maxPerHand: 4 }, id);
    // compare in beats after mapping tempo; the transcriber may pick a related tempo, so compare in seconds
    const secOf = (n, bpm) => n.t * 60 / bpm;
    const est = out.notes.map((n) => ({ m: n.m, t: secOf(n, out.tempo) }));
    const tr = truth.map((n) => ({ m: n.m, t: n.t * spb }));
    // align the first note
    const off = Math.min(...est.map((e) => e.t)) - Math.min(...tr.map((e) => e.t));
    est.forEach((e) => (e.t -= off));
    const sc = score(tr, est, 0.2);
    t(`${id}: F1 ${sc.f.toFixed(2)} (P ${sc.p.toFixed(2)}, R ${sc.r.toFixed(2)}), tempo ${out.tempo} vs ${song.tempo}`, () => assert.ok(sc.f >= min, 'F1 too low: ' + sc.f.toFixed(2)));
  }
}
