// Additive "piano-ish" synthesiser used only by tests.
import { midiToFreq } from '../js/music.js';
export function renderNotes(notes, sr, seconds, { noise = 0.003, seed = 1 } = {}) {
  const out = new Float32Array(Math.ceil(sr * seconds));
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (const n of notes) {
    const f0 = midiToFreq(n.m), start = Math.floor(n.t * sr), len = Math.floor(n.d * sr);
    const amp = n.v ?? 0.15;
    const tau = 0.35 + (100 - n.m) / 40;
    const B = 0.0001 * Math.pow(2, (60 - n.m) / 20);
    for (let h = 1; h <= 10; h++) {
      const f = f0 * h * Math.sqrt(1 + B * h * h);
      if (f > sr * 0.45) break;
      const a = (amp / Math.pow(h, 1.15)) * (n.m < 45 && h === 1 ? 0.4 : 1);
      const w = (2 * Math.PI * f) / sr, ph = Math.abs(rnd()) * 6;
      for (let i = 0; i < len && start + i < out.length; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 0.004) * Math.exp(-t / (tau / (1 + 0.15 * h))) * (i > len - 0.05 * sr ? (len - i) / (0.05 * sr) : 1);
        out[start + i] += a * env * Math.sin(w * i + ph);
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] += noise * rnd();
  return out;
}
