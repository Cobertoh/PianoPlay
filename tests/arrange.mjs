// Arranger test: a synthetic "beat" = piano melody + pad chords + bass + drums + a talking vocal sample.
// The arranger should recover the melody line, the chords and the tempo, and ignore drums/speech.
import assert from 'node:assert/strict';
import { analyzeForArrangement, arrangeSong } from '../js/arrange.js';
import { renderNotes } from './synth.mjs';
import { midiToFreq } from '../js/music.js';

export function makeBeat({ bpm = 88, bars = 8, sr = 22050, talk = true, drums = true, seed = 3 } = {}) {
  const spb = 60 / bpm, secs = bars * 4 * spb + 1;
  // Am – F – C – G, melody in quarter/eighth notes
  const prog = [[57, 0], [53, 1], [48, 1], [55, 1]];  // bass roots
  const chordTones = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  const motif = [[0, 76, 1], [1, 74, 0.5], [1.5, 72, 0.5], [2, 71, 1], [3, 72, 1]];
  const motif2 = [[0, 72, 1.5], [1.5, 69, 0.5], [2, 67, 2]];
  const mel = [];
  for (let b = 0; b < bars; b++) for (const [t, m, d] of (b % 2 ? motif2 : motif)) mel.push({ t: (b * 4 + t), m: m + (chordTones[b % 4][0] - 57 > 0 ? 0 : 0), d });
  const notes = mel.map((n) => ({ m: n.m, t: n.t * spb, d: n.d * spb * 0.95, v: 0.16 }));
  const pad = [];
  for (let b = 0; b < bars; b++) { for (const m of chordTones[b % 4]) pad.push({ m, t: b * 4 * spb, d: 4 * spb * 0.98, v: 0.04 }); pad.push({ m: prog[b % 4][0] - 12, t: b * 4 * spb, d: 3.8 * spb, v: 0.09 }); }
  const sig = renderNotes([...notes, ...pad], sr, secs, { noise: 0.002 });
  let s = seed; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  if (drums) for (let k = 0; k < bars * 8; k++) {
    const t0 = Math.floor(k * spb / 2 * sr);
    const beat = k / 2;
    if (k % 8 === 0 || k % 8 === 5) for (let i = 0; i < sr * 0.25; i++) { const f = 50 + 120 * Math.exp(-i / sr / 0.03); sig[t0 + i] += 0.5 * Math.exp(-i / sr / 0.12) * Math.sin(2 * Math.PI * f * i / sr); }  // kick
    if (beat % 2 === 1) for (let i = 0; i < sr * 0.18; i++) sig[t0 + i] += 0.25 * Math.exp(-i / sr / 0.05) * rnd();    // snare
    for (let i = 0; i < sr * 0.04; i++) sig[t0 + i] += 0.06 * Math.exp(-i / sr / 0.01) * rnd();                           // hat
  }
  if (talk) {  // a gliding, syllabic "voice" in a few places
    for (const startBar of [1, 4, 6]) {
      let ph = 0; const t0 = startBar * 4 * spb + 0.3 * spb;
      for (let i = 0; i < sr * 1.6; i++) {
        const t = i / sr, syl = Math.floor(t / 0.17), inSyl = (t % 0.17) / 0.17;
        const f0 = 140 + 40 * Math.sin(t * 7 + syl) + 30 * inSyl;
        ph += 2 * Math.PI * f0 / sr;
        let v = 0; for (let h = 1; h < 25; h++) { const f = f0 * h, form = Math.exp(-(((f - 700) / 250) ** 2)) + 0.6 * Math.exp(-(((f - 1200 - 300 * Math.sin(syl)) / 300) ** 2)) + 0.2; v += form * Math.sin(h * ph) / h; }
        const env = Math.sin(Math.PI * inSyl) ** 0.5;
        const idx = Math.floor((t0 + t) * sr); if (idx < sig.length) sig[idx] += 0.12 * env * v;
      }
    }
  }
  return { sig, sr, mel, bpm, chords: ['Am', 'F', 'C', 'G'] };
}

export async function run(t) {
  console.log('arranger (synthetic beat with drums and a talking sample)');
  const { sig, sr, mel, bpm, chords } = makeBeat();
  const an = await analyzeForArrangement(sig, sr);
  const song = arrangeSong(an, {}, 'beat');
  const rh = song.notes.filter((n) => n.h === 'R');
  // melody accuracy: pitch class + onset within a quarter beat (after aligning the first bar)
  const off = rh.length ? rh[0].t - (mel[0].t % 4) : 0;
  let hit = 0; for (const n of mel) if (rh.some((r) => r.m % 12 === n.m % 12 && Math.abs(r.t - off - n.t) <= 0.26)) hit++;
  const recall = hit / mel.length, precision = rh.length ? Math.min(1, hit / rh.length) : 0;
  const prog = song.chordsInfo.map((c) => c.name);
  const okChords = chords.every((c) => prog.includes(c)) && prog.length <= 10;
  t(`melody recall ${recall.toFixed(2)}, precision ${precision.toFixed(2)} (${rh.length} RH notes for ${mel.length} true)`, () => assert.ok(recall >= 0.75 && precision >= 0.7));
  t(`tempo ${song.tempo} vs ${bpm}`, () => assert.ok(Math.abs(song.tempo - bpm) <= 3));
  t(`chords ${prog.join(' ')}`, () => assert.ok(okChords));
  t(`key ${song.key}`, () => assert.ok(['Am', 'C'].includes(song.key)));
}
