// PianoPlay - the stage: a realistic canvas piano keyboard with a falling-note visualisation.
// Everything (notes, hit line, key lights, particles) is drawn on one canvas so the lanes line up
// perfectly with the keys.
import { isBlack, midiToName } from './music.js';

export const PALETTE = {
  R: { top: '#9ff3ff', mid: '#39d0ff', bot: '#2b7bff', glow: '56,208,255', hue: 195 },
  L: { top: '#e2b8ff', mid: '#b47bff', bot: '#7a4dff', glow: '176,120,255', hue: 268 },
  ok: '#4ade80', bad: '#ff5d73', gold: '#ffd36b',
};
const BLACK_OFF = { 1: -0.1, 3: 0.1, 6: -0.12, 8: 0, 10: 0.12 };

const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export class Stage {
  constructor(canvas, opts = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = Object.assign({ lookBeats: 5, minKeyW: 15, keyboardRatio: 0.24, colorMode: 'hands', labels: 'c', showBeats: true }, opts);
    this.notes = [];
    this.beat = 0;
    this.playing = false;
    this.hand = 'both';
    this.lo = 48; this.hi = 84;
    this.pressed = new Map();      // midi -> {color, since, user}
    this.targets = new Map();      // midi -> hand (expected now)
    this.state = new Map();        // note id -> 'hit' | 'miss'
    this.flashes = new Map();      // midi -> {kind, t}
    this.parts = [];
    this.dust = Array.from({ length: 34 }, () => ({ x: Math.random(), y: Math.random(), s: 0.4 + Math.random() * 1.6, v: 0.02 + Math.random() * 0.06, a: Math.random() }));
    this.camPx = 0; this.focus = 60;
    this.ptrs = new Map();
    this.cb = {};
    this.last = performance.now();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas.parentElement || canvas);
    this._bind();
    this.resize();
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
    this.dirty = true;
  }
  destroy() { cancelAnimationFrame(this._raf); this._ro.disconnect(); }
  on(ev, fn) { this.cb[ev] = fn; }

  setSong(song) {
    this.song = song;
    this.notes = song.notes;
    this.state.clear(); this.parts.length = 0;
    const ms = song.notes.map((n) => n.m);
    const lo = Math.min(...ms), hi = Math.max(...ms);
    this.setRange(lo, hi);
    this.dirty = true;
  }
  setRange(lo, hi) {
    // pad to full octaves-ish and make sure there are at least ~3 octaves
    let L = lo - ((lo % 12) + 12) % 12 - 0;                // C at/below lo
    if (isBlack(L)) L -= 1;
    let Hh = hi - (((hi % 12) + 12) % 12) + 11;           // B at/above hi
    while (Hh - L < 35) { if (L > 36) L -= 12; if (Hh - L < 35 && Hh < 96) Hh += 12; if (L <= 36 && Hh >= 96) break; }
    this.lo = Math.max(21, L); this.hi = Math.min(108, Hh);
    this.layout();
  }
  setHand(h) { this.hand = h; this.dirty = true; }
  setBeat(b) { this.beat = b; this.dirty = true; }
  setPlaying(p) { this.playing = p; }
  setTargets(map) { this.targets = map || new Map(); this.dirty = true; }
  setLook(beats) { this.opts.lookBeats = beats; this.dirty = true; }
  setOpt(k, v) { this.opts[k] = v; this.layout(); this.dirty = true; }
  markNote(id, kind) { if (kind) this.state.set(id, kind); else this.state.delete(id); }
  clearMarks() { this.state.clear(); }

  press(m, user = true, hand = null, ok = null) { this.pressed.set(m, { since: performance.now(), user, hand, ok }); this.dirty = true; }
  release(m) { this.pressed.delete(m); this.dirty = true; }
  flash(m, kind) { this.flashes.set(m, { kind, t: performance.now() }); this.dirty = true; }
  burst(m, hand = 'R', n = 10) {
    const k = this.keyRect(m); if (!k) return;
    const col = this.opts.colorMode === 'rainbow' ? hsl((m % 12) * 30, 90, 62) : `rgb(${PALETTE[hand].glow})`;
    for (let i = 0; i < n && this.parts.length < 220; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.8, sp = 40 + Math.random() * 120;
      this.parts.push({ x: k.x + k.w / 2, y: this.hitY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, d: 0.9 + Math.random() * 0.8, s: 1 + Math.random() * 2.2, c: col });
    }
    this.dirty = true;
  }

  // ------------------------------------------------------------ geometry
  resize() {
    const p = this.cv.parentElement || this.cv;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(50, p.clientWidth), h = Math.max(50, p.clientHeight);
    this.W = w; this.H = h; this.dpr = dpr;
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    this.dirty = true;
    this.kh = Math.max(70, Math.min(170, h * this.opts.keyboardRatio));
    this.hitY = h - this.kh;
    this.layout();
    this._bg = null;
  }
  layout() {
    const whites = [];
    for (let m = this.lo; m <= this.hi; m++) if (!isBlack(m)) whites.push(m);
    this.whites = whites;
    const need = whites.length * this.opts.minKeyW;
    this.cam = need > this.W;
    this.keyW = this.cam ? this.opts.minKeyW : this.W / whites.length;
    this.totalW = whites.length * this.keyW;
    this.rects = new Map();
    const bw = this.keyW * 0.6, bh = this.kh * 0.62;
    let wi = -1;
    for (let m = this.lo; m <= this.hi; m++) {
      if (!isBlack(m)) { wi++; this.rects.set(m, { x: wi * this.keyW, w: this.keyW, black: false, h: this.kh }); }
      else this.rects.set(m, { x: (wi + 1) * this.keyW - bw / 2 + (BLACK_OFF[m % 12] || 0) * this.keyW, w: bw, black: true, h: bh });
    }
    if (this.hitY == null) this.hitY = this.H - this.kh;
    this.pxPerBeat = this.hitY / this.opts.lookBeats;
  }
  keyRect(m) {
    const r = this.rects.get(m); if (!r) return null;
    return { x: r.x - this.camPx, w: r.w, black: r.black, h: r.h };
  }
  keyAt(px, py) {
    const y = py - this.hitY; if (y < 0) return null;
    let found = null;
    for (const [m, r] of this.rects) {
      const x = r.x - this.camPx;
      if (px >= x && px <= x + r.w && y <= r.h) { if (r.black) return m; found = found ?? m; }
    }
    return found;
  }

  // ------------------------------------------------------------ input
  _bind() {
    const pos = (e) => { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    this.cv.addEventListener('pointerdown', (e) => {
      const [x, y] = pos(e); const m = this.keyAt(x, y);
      if (m == null) { this.cb.tapStage?.(x, y); return; }
      e.preventDefault(); this.cv.setPointerCapture?.(e.pointerId);
      const vel = Math.min(1, Math.max(0.35, 0.45 + (y - this.hitY) / this.kh * 0.6));
      this.ptrs.set(e.pointerId, m); this.cb.keyDown?.(m, vel);
    });
    this.cv.addEventListener('pointermove', (e) => {
      if (!this.ptrs.has(e.pointerId) || e.buttons === 0 && e.pointerType === 'mouse') return;
      const [x, y] = pos(e); const m = this.keyAt(x, y); const cur = this.ptrs.get(e.pointerId);
      if (m != null && m !== cur) { this.cb.keyUp?.(cur); this.ptrs.set(e.pointerId, m); this.cb.keyDown?.(m, 0.7); }
    });
    const up = (e) => { const m = this.ptrs.get(e.pointerId); if (m != null) { this.ptrs.delete(e.pointerId); this.cb.keyUp?.(m); } };
    this.cv.addEventListener('pointerup', up); this.cv.addEventListener('pointercancel', up); this.cv.addEventListener('pointerleave', up);
    this.cv.style.touchAction = 'none';
  }

  // ------------------------------------------------------------ drawing
  _loop(now) {
    this._raf = requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const animating = this.playing || this.parts.length || this.pressed.size || this.flashes.size || this.targets.size;
    if (!animating && !this.dirty) return;
    this.dirty = false;
    this.draw(now, dt);
  }
  _updateCam(dt) {
    if (!this.cam) { this.camPx = 0; return; }
    // follow the pitch of what is about to be played
    let sum = 0, c = 0;
    for (const n of this.notes) { if (n.t >= this.beat - 0.5 && n.t < this.beat + 3) { sum += n.m; c++; } if (n.t > this.beat + 3) break; }
    if (c) this.focus += (sum / c - this.focus) * Math.min(1, dt * 2.5);
    const r = this.rects.get(Math.round(this.focus)) || this.rects.get(this.lo);
    const target = (r ? r.x : 0) - this.W / 2;
    const max = Math.max(0, this.totalW - this.W);
    const t = Math.max(0, Math.min(max, target));
    this.camPx += (t - this.camPx) * Math.min(1, dt * 4);
  }
  _background(ctx) {
    if (!this._bg) {
      const c = document.createElement('canvas'); c.width = this.cv.width; c.height = this.cv.height;
      const g = c.getContext('2d'); g.scale(this.dpr, this.dpr);
      const lg = g.createLinearGradient(0, 0, 0, this.H);
      lg.addColorStop(0, '#0a0c1d'); lg.addColorStop(0.55, '#10132b'); lg.addColorStop(1, '#1b1840');
      g.fillStyle = lg; g.fillRect(0, 0, this.W, this.H);
      const rg = g.createRadialGradient(this.W * 0.5, this.hitY, 10, this.W * 0.5, this.hitY, this.W * 0.75);
      rg.addColorStop(0, 'rgba(120,90,255,.28)'); rg.addColorStop(0.5, 'rgba(60,110,255,.09)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.fillRect(0, 0, this.W, this.H);
      const vg = g.createRadialGradient(this.W / 2, this.H / 2, this.H * 0.2, this.W / 2, this.H / 2, this.H * 0.9);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)');
      g.fillStyle = vg; g.fillRect(0, 0, this.W, this.H);
      this._bg = c;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this._bg, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
  noteColors(n) {
    const h = n.h === 'L' ? 'L' : 'R';
    if (this.opts.colorMode === 'rainbow') {
      const hue = (n.m % 12) * 30 + (h === 'L' ? 8 : 0);
      return { top: hsl(hue, 95, 78), mid: hsl(hue, 90, 60), bot: hsl(hue + 18, 85, 48), glow: null, hue };
    }
    return PALETTE[h];
  }
  draw(now, dt) {
    const ctx = this.ctx, W = this.W, H = this.H, hitY = this.hitY, ppb = this.pxPerBeat;
    this._updateCam(dt);
    this._background(ctx);
    // lanes: faint vertical separators at every C and F, octave shading
    ctx.save();
    ctx.globalAlpha = 1;
    for (const [m, r] of this.rects) {
      if (r.black) continue;
      const x = r.x - this.camPx;
      if (x + r.w < 0 || x > W) continue;
      if (m % 12 === 0 || m % 12 === 5) { ctx.fillStyle = m % 12 === 0 ? 'rgba(255,255,255,.075)' : 'rgba(255,255,255,.035)'; ctx.fillRect(x - 0.5, 0, 1, hitY); }
    }
    // dust
    for (const d of this.dust) {
      d.y -= d.v * dt * (this.playing ? 1 : 0.3); if (d.y < 0) { d.y = 1; d.x = Math.random(); }
      ctx.fillStyle = `rgba(190,200,255,${0.1 + 0.2 * d.a})`; ctx.fillRect(d.x * W, d.y * hitY, d.s, d.s);
    }
    // beat grid scrolling with the music
    if (this.opts.showBeats && this.song) {
      const bl = (this.song.ts[0] * 4) / this.song.ts[1];
      const first = Math.floor(this.beat), last = Math.ceil(this.beat + this.opts.lookBeats);
      for (let b = first; b <= last; b++) {
        const y = hitY - (b - this.beat) * ppb;
        if (y < 0 || y > hitY) continue;
        const bar = Math.abs(b / bl - Math.round(b / bl)) < 1e-6;
        ctx.fillStyle = bar ? 'rgba(180,190,255,.22)' : 'rgba(180,190,255,.07)';
        ctx.fillRect(0, y, W, bar ? 1.5 : 1);
      }
    }
    ctx.restore();

    // ---- key light beams (under notes)
    const activeKeys = new Map();
    for (const [m, p] of this.pressed) activeKeys.set(m, p);
    const sounding = this._sounding();
    for (const [m, hnd] of sounding) if (!activeKeys.has(m)) activeKeys.set(m, { hand: hnd, user: false });
    for (const [m, p] of activeKeys) {
      const k = this.keyRect(m); if (!k) continue;
      const hand = p.hand || (m < 60 ? 'L' : 'R');
      const g = ctx.createLinearGradient(0, hitY, 0, hitY - this.kh * 1.6);
      const col = p.ok === false ? '255,93,115' : p.ok === true ? '74,222,128' : (this.opts.colorMode === 'rainbow' ? null : PALETTE[hand].glow) || '120,200,255';
      g.addColorStop(0, `rgba(${col},.55)`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.fillRect(k.x, hitY - this.kh * 1.6, k.w, this.kh * 1.6);
    }

    // ---- falling notes
    const top = this.beat + this.opts.lookBeats + 0.5;
    const notes = this.notes;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n.t > top) break;
      if (n.t + n.d < this.beat - 0.3) continue;
      const k = this.keyRect(n.m); if (!k) continue;
      if (k.x + k.w < 0 || k.x > W) continue;
      const dim = this.hand === 'R' ? n.h === 'L' : this.hand === 'L' ? n.h !== 'L' : false;
      const st = this.state.get(n.id);
      const yb = hitY - (n.t - this.beat) * ppb, yt = hitY - (n.t + n.d - this.beat) * ppb;
      const h = Math.max(12, yb - yt - 3);       // 3px gap so repeated notes stay distinct
      const inset = k.black ? 1 : 2;
      const x = k.x + inset, w = k.w - inset * 2;
      let y = yb - h; let hh = h;
      if (y + hh > hitY) { hh = hitY - y; }         // clip at keyboard
      if (hh < 3) continue;
      const col = this.noteColors(n);
      const fade = Math.max(0.0, Math.min(1, (top - n.t) / 1.2));
      let alpha = (dim ? 0.28 : 1) * (st === 'miss' ? 0.35 : 1) * (0.5 + 0.5 * fade);
      if (st === 'hit') alpha *= Math.max(0, 1 - (this.beat - (n.t + 0.1)) * 1.2);
      if (alpha <= 0.01) continue;
      const isNow = n.t <= this.beat + 1e-6 && n.t + n.d > this.beat;
      ctx.save();
      ctx.globalAlpha = alpha;
      const g = ctx.createLinearGradient(0, y, 0, y + hh);
      g.addColorStop(0, col.top); g.addColorStop(0.5, col.mid); g.addColorStop(1, col.bot);
      if (isNow && !dim) { ctx.shadowColor = col.glow ? `rgba(${col.glow},.9)` : hsl(col.hue, 100, 65); ctx.shadowBlur = 18; }
      ctx.fillStyle = st === 'miss' ? '#6b7094' : st === 'hit' ? PALETTE.ok : g;
      rr(ctx, x, y, w, hh, Math.min(7, w / 2.2)); ctx.fill();
      ctx.shadowBlur = 0;
      // glass highlight
      const hl = ctx.createLinearGradient(x, 0, x + w, 0);
      hl.addColorStop(0, 'rgba(255,255,255,.38)'); hl.addColorStop(0.35, 'rgba(255,255,255,.05)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hl; rr(ctx, x + 1, y + 1, w - 2, hh - 2, Math.min(6, w / 2.4)); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1; rr(ctx, x + 0.5, y + 0.5, w - 1, hh - 1, Math.min(7, w / 2.2)); ctx.stroke();
      // label
      if (w >= 15 && hh >= 15 && !dim) {
        ctx.fillStyle = 'rgba(8,10,30,.78)'; ctx.font = `700 ${Math.min(13, w * 0.52)}px ui-rounded, -apple-system, system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        const label = n.f ? String(n.f) : midiToName(n.m, false, false);
        ctx.fillText(label, x + w / 2, y + hh - 5);
      }
      ctx.restore();
    }

    // ---- hit line
    const hg = ctx.createLinearGradient(0, 0, W, 0);
    hg.addColorStop(0, 'rgba(255,211,107,0)'); hg.addColorStop(0.5, 'rgba(255,211,107,.85)'); hg.addColorStop(1, 'rgba(255,211,107,0)');
    ctx.fillStyle = hg; ctx.fillRect(0, hitY - 1.5, W, 3);
    const hg2 = ctx.createLinearGradient(0, hitY - 26, 0, hitY);
    hg2.addColorStop(0, 'rgba(255,211,107,0)'); hg2.addColorStop(1, 'rgba(255,211,107,.16)');
    ctx.fillStyle = hg2; ctx.fillRect(0, hitY - 26, W, 26);

    // ---- keyboard
    this._keyboard(ctx, now, activeKeys);

    // ---- particles
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt / p.d; if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.vy += 180 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.s * p.life + 0.4, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const [m, f] of this.flashes) if (now - f.t > 450) this.flashes.delete(m);
  }
  /** notes the song is playing right now: Map midi -> hand */
  _sounding() {
    const out = new Map();
    if (!this.song || !this.showSounding) return out;
    for (const n of this.notes) {
      if (n.t > this.beat) break;
      if (n.t + n.d > this.beat) { const dim = this.hand === 'R' ? n.h === 'L' : this.hand === 'L' ? n.h !== 'L' : false; if (!dim) out.set(n.m, n.h === 'L' ? 'L' : 'R'); }
    }
    return out;
  }
  _keyboard(ctx, now, active) {
    const y0 = this.hitY, kh = this.kh;
    // base shadow / body
    ctx.fillStyle = '#05060f'; ctx.fillRect(0, y0, this.W, kh + 2);
    const whites = [], blacks = [];
    for (const [m, r] of this.rects) (r.black ? blacks : whites).push([m, r]);
    for (const [m, r] of whites) {
      const x = r.x - this.camPx; if (x + r.w < 0 || x > this.W) continue;
      const on = active.get(m) || this.targets.has(m) && 'target';
      const down = this.pressed.has(m) || (active.has(m));
      const off = down ? 3 : 0;
      const g = ctx.createLinearGradient(0, y0, 0, y0 + kh);
      if (down) { g.addColorStop(0, '#d8dcf2'); g.addColorStop(0.6, '#eef0fb'); g.addColorStop(1, '#ffffff'); }
      else { g.addColorStop(0, '#f4f5fd'); g.addColorStop(0.7, '#ffffff'); g.addColorStop(1, '#e6e8f4'); }
      ctx.fillStyle = g;
      rr(ctx, x + 0.8, y0 + off - 6, r.w - 1.6, kh - off + 6, 5); ctx.fill();
      // tint when active
      const p = active.get(m);
      if (p) {
        const hand = p.hand || (m < 60 ? 'L' : 'R');
        const col = p.ok === false ? '255,93,115' : p.ok === true ? '74,222,128' : (PALETTE[hand].glow);
        const tg = ctx.createLinearGradient(0, y0, 0, y0 + kh);
        tg.addColorStop(0, `rgba(${col},.85)`); tg.addColorStop(1, `rgba(${col},.25)`);
        ctx.fillStyle = tg; rr(ctx, x + 0.8, y0 + off - 6, r.w - 1.6, kh - off + 6, 5); ctx.fill();
      }
      // target hint (what to play now)
      if (this.targets.has(m) && !p) {
        const pulse = 0.55 + 0.35 * Math.sin(now / 160);
        const col = PALETTE[this.targets.get(m) === 'L' ? 'L' : 'R'].glow;
        ctx.fillStyle = `rgba(${col},${0.35 * pulse})`; rr(ctx, x + 0.8, y0 - 6, r.w - 1.6, kh + 6, 5); ctx.fill();
        ctx.strokeStyle = `rgba(${col},${0.9 * pulse})`; ctx.lineWidth = 2; rr(ctx, x + 1.5, y0 - 5, r.w - 3, kh + 4, 5); ctx.stroke();
      }
      const fl = this.flashes.get(m);
      if (fl) { const a = 1 - (now - fl.t) / 450; ctx.fillStyle = (fl.kind === 'ok' ? 'rgba(74,222,128,' : 'rgba(255,93,115,') + 0.55 * a + ')'; rr(ctx, x + 0.8, y0 - 6, r.w - 1.6, kh + 6, 5); ctx.fill(); }
      // edge shading
      ctx.fillStyle = 'rgba(30,34,70,.22)'; ctx.fillRect(x + r.w - 1.6, y0, 1, kh);
      // labels
      const showAll = this.opts.labels === 'all';
      if (m % 12 === 0 || (showAll && r.w >= 16)) {
        ctx.fillStyle = m % 12 === 0 ? '#555a85' : '#8a8fb6';
        ctx.font = `600 ${Math.min(11, r.w * 0.5)}px ui-rounded, -apple-system, system-ui, sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(m % 12 === 0 ? 'C' + (Math.floor(m / 12) - 1) : midiToName(m, false, false), x + r.w / 2, y0 + kh - 8);
      }
    }
    for (const [m, r] of blacks) {
      const x = r.x - this.camPx; if (x + r.w < 0 || x > this.W) continue;
      const p = active.get(m);
      const down = !!p;
      const h = r.h - (down ? 3 : 0);
      const g = ctx.createLinearGradient(x, 0, x + r.w, 0);
      g.addColorStop(0, '#0b0c18'); g.addColorStop(0.5, '#2a2d4a'); g.addColorStop(1, '#0b0c18');
      ctx.fillStyle = '#000'; rr(ctx, x - 1, y0 - 7, r.w + 2, h + 8, 4); ctx.fill();
      const gv = ctx.createLinearGradient(0, y0, 0, y0 + h);
      gv.addColorStop(0, '#2b2e50'); gv.addColorStop(0.75, '#14152a'); gv.addColorStop(1, '#05060d');
      ctx.fillStyle = gv; rr(ctx, x, y0 - 6, r.w, h + 6, 4); ctx.fill();
      // gloss
      const gl = ctx.createLinearGradient(x, 0, x + r.w, 0); gl.addColorStop(0, 'rgba(255,255,255,.22)'); gl.addColorStop(0.4, 'rgba(255,255,255,.04)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gl; rr(ctx, x + 1.5, y0 - 5, r.w - 3, h * 0.82, 3); ctx.fill();
      if (p) {
        const hand = p.hand || (m < 60 ? 'L' : 'R');
        const col = p.ok === false ? '255,93,115' : p.ok === true ? '74,222,128' : PALETTE[hand].glow;
        ctx.fillStyle = `rgba(${col},.75)`; rr(ctx, x, y0 - 6, r.w, h + 6, 4); ctx.fill();
      }
      if (this.targets.has(m) && !p) {
        const pulse = 0.55 + 0.35 * Math.sin(now / 160); const col = PALETTE[this.targets.get(m) === 'L' ? 'L' : 'R'].glow;
        ctx.fillStyle = `rgba(${col},${0.55 * pulse})`; rr(ctx, x, y0 - 6, r.w, h + 6, 4); ctx.fill();
        ctx.strokeStyle = `rgba(${col},${0.95 * pulse})`; ctx.lineWidth = 2; rr(ctx, x + 1, y0 - 5, r.w - 2, h + 4, 4); ctx.stroke();
      }
      const fl = this.flashes.get(m);
      if (fl) { const a = 1 - (now - fl.t) / 450; ctx.fillStyle = (fl.kind === 'ok' ? 'rgba(74,222,128,' : 'rgba(255,93,115,') + 0.7 * a + ')'; rr(ctx, x, y0 - 6, r.w, h + 6, 4); ctx.fill(); }
    }
    // keybed lip
    const lip = ctx.createLinearGradient(0, y0 - 8, 0, y0 + 2);
    lip.addColorStop(0, 'rgba(0,0,0,0)'); lip.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = lip; ctx.fillRect(0, y0 - 8, this.W, 10);
  }
}
