// Small radix-2 FFT (no dependencies). Used by mic detection and the audio transcriber.
export class FFT {
  constructor(n) {
    if (n & (n - 1)) throw new Error('FFT size must be a power of two');
    this.n = n;
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
  }
  /** In-place transform of this.re / this.im */
  run() {
    const { n, rev, cos, sin, re, im } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const tr = re[b] * cos[k] - im[b] * sin[k];
          const ti = re[b] * sin[k] + im[b] * cos[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }
}

export function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/**
 * Amplitude spectrum of `samples` (length >= fft.n starting at `offset`), normalised so that a
 * full-scale sine reads ~1.0. Writes fft.n/2 values into `out`.
 */
export function amplitudeSpectrum(fft, win, samples, offset, out) {
  const n = fft.n;
  let ws = 0;
  for (let i = 0; i < n; i++) {
    const idx = offset + i;
    fft.re[i] = idx < samples.length && idx >= 0 ? samples[idx] * win[i] : 0;
    fft.im[i] = 0;
    ws += win[i];
  }
  fft.run();
  const norm = 2 / ws;
  for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(fft.re[i], fft.im[i]) * norm;
  return out;
}
