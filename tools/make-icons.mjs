// Generates the PWA / iOS home-screen icons (pure Node, no dependencies):  npm run icons
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// signed distance to a rounded rect (centre cx,cy half sizes hw,hh radius r)
const sdRR = (x, y, cx, cy, hw, hh, r) => { const dx = Math.abs(x - cx) - (hw - r), dy = Math.abs(y - cy) - (hh - r); return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r; };

function render(size, { maskable = false, full = false } = {}) {
  const S = size, px = Buffer.alloc(S * S * 4), ss = 3;                 // 3x3 supersampling
  const inner = maskable ? 0.62 : 0.8;                                   // content scale (maskable keeps a safe zone)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let acc = [0, 0, 0, 0];
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const u = (x + (sx + 0.5) / ss) / S, v = (y + (sy + 0.5) / ss) / S;
      // background: deep navy with aurora gradient
      const d = sdRR(u, v, 0.5, 0.5, 0.5, 0.5, full || maskable ? 0 : 0.225);
      let a = d < 0 ? 1 : 0; if (!a) { acc[3] += 0; continue; }
      let c = mix([11, 13, 26], [26, 32, 78], v);
      const g1 = Math.max(0, 1 - Math.hypot(u - 0.18, v - 0.12) / 0.7), g2 = Math.max(0, 1 - Math.hypot(u - 0.9, v - 0.95) / 0.75);
      c = mix(c, [57, 208, 255], g1 * 0.55); c = mix(c, [180, 123, 255], g2 * 0.6);
      // keyboard glyph: 4 white keys + 3 black keys inside a rounded panel
      const k = inner * 0.78, kw = k, kh = k * 0.78, x0 = 0.5 - kw / 2, y0 = 0.5 - kh / 2;
      if (sdRR(u, v, 0.5, 0.5, kw / 2, kh / 2, 0.06 * k) < 0) {
        const t = (u - x0) / kw; const wi = Math.min(3, Math.floor(t * 4)); const fx = t * 4 - wi;
        c = [244, 246, 255]; if (fx < 0.035 || fx > 0.965) c = [196, 202, 232];
        c = mix(c, [205, 210, 238], (v - y0) / kh * 0.6);
        // black keys at boundaries 1..3
        for (let b = 1; b <= 3; b++) { const bx = x0 + (b / 4) * kw, bw = kw * 0.085; if (Math.abs(u - bx) < bw && v < y0 + kh * 0.62) { const gg = mix([40, 44, 80], [10, 12, 24], (v - y0) / (kh * 0.62)); c = b === 2 ? [57, 208, 255] : gg; if (b === 2) c = mix([120, 235, 255], [57, 150, 255], (v - y0) / (kh * 0.62)); } }
      }
      acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 255;
    }
    const n = ss * ss, o = (y * S + x) * 4, cov = acc[3] / (255 * n);
    px[o] = cov ? acc[0] / (cov * n) : 0; px[o + 1] = cov ? acc[1] / (cov * n) : 0; px[o + 2] = cov ? acc[2] / (cov * n) : 0; px[o + 3] = Math.round(cov * 255);
  }
  return png(S, S, px);
}
mkdirSync('icons', { recursive: true });
writeFileSync('icons/icon-512.png', render(512));
writeFileSync('icons/icon-192.png', render(192));
writeFileSync('icons/icon-maskable-512.png', render(512, { maskable: true }));
writeFileSync('icons/apple-touch-icon.png', render(180, { full: true }));   // iOS rounds the corners itself
console.log('icons written');
