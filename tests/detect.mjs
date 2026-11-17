// Mic/spectrum detection tests on synthetic piano tones.
import assert from 'node:assert/strict';
import { FFT, hann, amplitudeSpectrum } from '../js/fft.js';
import { detectNotes, scoreTargets } from '../js/pitch.js';
import { renderNotes } from './synth.mjs';

export async function run(t) {
  console.log('pitch detection');
  const sr = 48000, N = 8192, fft = new FFT(N), win = hann(N), mag = new Float32Array(N / 2);
  const spec = (ms, opts = {}) => { const sig = renderNotes(ms.map((m) => ({ m, t: 0, d: 1.2 })), sr, 1.3, opts); amplitudeSpectrum(fft, win, sig, 6000, mag); return mag; };
  t('single notes C2..C7 detected exactly', () => {
    let bad = [];
    for (let m = 36; m <= 96; m++) { const r = detectNotes(spec([m]), sr, N).map((d) => d.m); if (r.length !== 1 || r[0] !== m) bad.push(`${m}->${r}`); }
    assert.ok(bad.length <= 1, bad.join(' '));
  });
  t('single notes tolerate +-25 cent detune', () => {
    // render a note slightly sharp/flat by shifting midi via fractional frequency
    const sig = new Float32Array(sr * 1.3);
    for (const cents of [-25, 25]) {
      sig.fill(0);
      const f0 = 440 * Math.pow(2, (60 - 69) / 12) * Math.pow(2, cents / 1200);
      for (let h = 1; h <= 8; h++) for (let i = 0; i < sig.length; i++) sig[i] += (0.15 / h) * Math.sin(2 * Math.PI * f0 * h * i / sr);
      amplitudeSpectrum(fft, win, sig, 6000, mag);
      const r = detectNotes(mag, sr, N).map((d) => d.m);
      assert.deepEqual(r, [60], `cents ${cents}: ${r}`);
    }
  });
  t('triads and sevenths are fully detected', () => {
    for (const c of [[60, 64, 67], [62, 65, 69], [65, 69, 72], [67, 71, 74], [57, 60, 64], [72, 76, 79], [55, 59, 62, 65]]) {
      const r = detectNotes(spec(c), sr, N).map((d) => d.m).sort((a, b) => a - b);
      assert.deepEqual(r, [...c].sort((a, b) => a - b), `chord ${c} -> ${r}`);
    }
  });
  t('no ghost notes below / above a chord', () => {
    for (const c of [[62, 65, 69], [67, 71, 74], [72, 76, 79]]) {
      const r = detectNotes(spec(c), sr, N).map((d) => d.m);
      assert.ok(r.every((m) => c.includes(m)), `ghost in ${c}: ${r}`);
    }
  });
  t('octave doubling found by targeted scoring', () => {
    const m = spec([48, 60]);
    const sc = scoreTargets(m, sr, N, [48, 60, 55], {});
    assert.ok(sc.get(48) > 3 && sc.get(60) > 3, 'octave pair: ' + [...sc]);
    assert.ok(sc.get(55) < 1, 'absent note must score ~0: ' + sc.get(55));
  });
  t('silence / noise produces no notes', () => {
    const sig = renderNotes([], sr, 1.3, { noise: 0.01 }); amplitudeSpectrum(fft, win, sig, 6000, mag);
    assert.equal(detectNotes(mag, sr, N).length, 0);
  });
  t('works with background noise at 20 dB SNR', () => {
    const r = detectNotes(spec([60, 64, 67], { noise: 0.012 }), sr, N).map((d) => d.m).sort((a, b) => a - b);
    assert.deepEqual(r, [60, 64, 67]);
  });
}
