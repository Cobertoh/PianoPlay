// PianoPlay - interactive sheet music (SVG grand staff). Scrolls with the music, highlights the
// notes being played, supports tap-to-seek, loop regions and per-hand dimming.
import { GLYPHS } from './glyphs.js';
import { spellMidi, keySignature, barLength, LETTERS } from './music.js';

const SP = 9;                    // staff space (logical px)
const GS = SP / 200;             // glyph scale: FreeSerif staff space ~200 units
const TREBLE_TOP = 6 * SP, TREBLE_BOT = TREBLE_TOP + 4 * SP;
const BASS_TOP = TREBLE_BOT + 4.5 * SP, BASS_BOT = BASS_TOP + 4 * SP;
const H = BASS_BOT + 6 * SP;
const PANEL_PAD = 8;
const NS = 'http://www.w3.org/2000/svg';

const stepNum = (s) => LETTERS.indexOf(s.letter) + s.oct * 7;           // diatonic step (C0 = 0)
const TREBLE_BASE = 4 * 7 + 2;                                          // E4
const BASS_BASE = 2 * 7 + 4;                                            // G2
const yFor = (staff, step) => (staff === 'T' ? TREBLE_BOT - ((step - TREBLE_BASE) * SP) / 2 : BASS_BOT - ((step - BASS_BASE) * SP) / 2);

function durClass(d) {
  if (Math.abs(d - 1 / 3) < 0.02) return { base: 0.5, dots: 0, tuplet: 3 };
  if (Math.abs(d - 2 / 3) < 0.03) return { base: 1, dots: 0, tuplet: 3 };
  let base = 0.25;
  for (const b of [4, 2, 1, 0.5, 0.25]) if (d >= b * 0.97) { base = b; break; }
  const dots = Math.abs(d - base * 1.5) < base * 0.12 ? 1 : 0;
  if (!dots && d > base * 1.3 && base < 4) { // 5 beats etc: fall back to nearest standard
    const alt = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25].find((x) => d >= x * 0.97);
    if (alt === 3) return { base: 2, dots: 1 }; if (alt === 1.5) return { base: 1, dots: 1 }; if (alt === 0.75) return { base: 0.5, dots: 1 };
  }
  return { base, dots };
}

const SHARP_T = [38, 35, 39, 36, 33, 37, 34], SHARP_B = [24, 21, 25, 22, 19, 23, 20];
const FLAT_T = [34, 37, 33, 36, 32, 35, 31], FLAT_B = [20, 23, 19, 22, 18, 21, 17];

function glyphPath(name, cx, cy, scale, anchor = 'bbox', extra = '') {
  const g = GLYPHS[name];
  const [x0, y0, x1, y1] = g.b;
  const gx = (x0 + x1) / 2, gy = -(y0 + y1) / 2;
  return `<path d="${g.d}" transform="translate(${(cx - gx * scale).toFixed(1)} ${(cy - gy * scale).toFixed(1)}) scale(${scale.toFixed(5)})" ${extra}/>`;
}
const acc = (kind, x, y) => {
  const h = { sharp: 2.9, flat: 2.5, natural: 2.9 }[kind];
  const g = GLYPHS[kind], hh = g.b[3] - g.b[1];
  const s = (h * SP) / hh;
  return glyphPath(kind, x, y - (kind === 'flat' ? 0.45 * SP : 0), s, 'bbox', 'class="acc"');
};

export class SheetView {
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = opts;
    el.classList.add('sheet');
    el.innerHTML = `<div class="sheet-panel"></div><div class="sheet-view"><div class="sheet-track"></div><div class="sheet-playhead"></div></div>`;
    this.panel = el.querySelector('.sheet-panel');
    this.view = el.querySelector('.sheet-view');
    this.track = el.querySelector('.sheet-track');
    this.playhead = el.querySelector('.sheet-playhead');
    this.k = 1;
    this.offset = 0;           // logical px scrolled
    this.user = null;          // user pan override while paused
    this.song = null;
    this.beat = 0;
    this._bind();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(el);
  }
  destroy() { this._ro.disconnect(); }

  setSong(song, { hand = 'both' } = {}) {
    this.song = song;
    this.hand = hand;
    this._layout();
    this._draw();
    this.setHand(hand);
    this.setBeat(0, { force: true });
  }

  resize() {
    const h = this.el.clientHeight || 220;
    this.k = Math.max(0.55, Math.min(1.5, h / H));
    if (this.song) this._applySize();
  }
  _applySize() {
    const svg = this.track.firstElementChild;
    if (svg) { svg.setAttribute('width', (this.totalW * this.k).toFixed(0)); svg.setAttribute('height', (H * this.k).toFixed(0)); }
    const p = this.panel.firstElementChild;
    if (p) { p.setAttribute('width', (this.panelW * this.k).toFixed(0)); p.setAttribute('height', (H * this.k).toFixed(0)); }
    this.panel.style.width = this.panelW * this.k + 'px';
    this.view.style.left = this.panelW * this.k + 'px';
    this._applyOffset();
  }

  // ------------------------------------------------------------ layout
  _layout() {
    const song = this.song, bl = barLength(song.ts);
    this.bl = bl;
    const key = song.key || 'C';
    const ks = keySignature(key);
    this.ks = ks;
    this.panelW = PANEL_PAD + 30 + Math.abs(ks.n) * 8 + 8 + 20 + 8;
    // columns: every onset + every bar start
    const set = new Set([0]);
    for (const n of song.notes) { set.add(+n.t.toFixed(4)); }
    const bars = Math.max(1, Math.ceil(song.length / bl - 1e-6));
    for (let b = 0; b <= bars; b++) set.add(+(b * bl).toFixed(4));
    const cols = [...set].sort((a, b) => a - b);
    this.cols = cols;
    this.colX = new Map();
    let x = 14;
    for (let i = 0; i < cols.length; i++) {
      const t = cols[i];
      const barStart = Math.abs(t / bl - Math.round(t / bl)) < 1e-4;
      if (barStart && i > 0) x += 8;
      this.colX.set(t, x);
      if (i < cols.length - 1) { const dt = cols[i + 1] - t; x += Math.max(24, 14 + 34 * Math.pow(dt, 0.65)); }
    }
    this.endX = x + 40;
    this.totalW = this.endX + 160;
    this.xs = cols.map((t) => this.colX.get(t));
  }
  /** beat -> logical x (interpolated) */
  xOf(beat) {
    const cols = this.cols, xs = this.xs;
    if (beat <= 0) return xs[0];
    let lo = 0, hi = cols.length - 1;
    if (beat >= cols[hi]) return xs[hi] + (beat - cols[hi]) * 20;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cols[mid] <= beat) lo = mid; else hi = mid; }
    const f = (beat - cols[lo]) / (cols[hi] - cols[lo]);
    return xs[lo] + f * (xs[hi] - xs[lo]);
  }
  beatAt(x) {
    const cols = this.cols, xs = this.xs;
    if (x <= xs[0]) return 0;
    let lo = 0, hi = xs.length - 1;
    if (x >= xs[hi]) return cols[hi];
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    return cols[lo];
  }

  // ------------------------------------------------------------ drawing
  _draw() {
    const song = this.song, notes = song.notes, bl = this.bl, key = song.key || 'C';
    const parts = [];
    const bars = Math.max(1, Math.ceil(song.length / bl - 1e-6));
    // staff lines
    for (let i = 0; i < 5; i++) {
      parts.push(`<line class="staff" x1="0" x2="${this.totalW}" y1="${TREBLE_TOP + i * SP}" y2="${TREBLE_TOP + i * SP}"/>`);
      parts.push(`<line class="staff" x1="0" x2="${this.totalW}" y1="${BASS_TOP + i * SP}" y2="${BASS_TOP + i * SP}"/>`);
    }
    // bar lines + numbers
    for (let b = 0; b <= bars; b++) {
      const x = this.colX.get(+(b * bl).toFixed(4)) - 6;
      parts.push(`<line class="bar" x1="${x}" x2="${x}" y1="${TREBLE_TOP}" y2="${BASS_BOT}"/>`);
      if (b < bars) parts.push(`<text class="barnum" x="${x + 4}" y="${TREBLE_TOP - 4 * SP}">${b + 1}</text>`);
    }
    this.barX = Array.from({ length: bars + 1 }, (_, b) => this.colX.get(+(b * bl).toFixed(4)) - 6);
    // loop band + playhead placeholders are DOM overlays
    parts.push('<rect class="loopband" x="0" y="0" width="0" height="' + H + '" style="display:none"/>');

    // ---- assign notes to staves and spell them
    const items = notes.map((n) => {
      const sp = n.sp || spellMidi(n.m, key);
      const staff = n.m >= 60 || (n.h !== 'L' && n.m >= 57) ? (n.h === 'L' && n.m < 63 ? 'B' : 'T') : 'B';
      const step = stepNum(sp);
      return { n, sp, staff, step, y: yFor(staff, step), cls: durClass(n.d) };
    });
    // accidentals per measure
    const state = new Map();
    let lastBar = -1;
    for (const it of [...items].sort((a, b) => a.n.t - b.n.t)) {
      const bar = Math.floor(it.n.t / bl + 1e-6);
      if (bar !== lastBar) { state.clear(); lastBar = bar; }
      const k = it.sp.letter + it.sp.oct;
      const cur = state.has(k) ? state.get(k) : (this.ks.map[it.sp.letter] || 0);
      if (it.sp.acc !== cur) { it.acc = it.sp.acc === 1 ? 'sharp' : it.sp.acc === -1 ? 'flat' : 'natural'; state.set(k, it.sp.acc); }
    }
    // group into units (same staff, onset, duration class)
    const units = new Map();
    for (const it of items) {
      const key2 = `${it.staff}|${it.n.t.toFixed(3)}|${it.cls.base}|${it.cls.dots}`;
      if (!units.has(key2)) units.set(key2, { staff: it.staff, t: it.n.t, d: it.n.d, cls: it.cls, items: [] });
      units.get(key2).items.push(it);
    }
    const unitList = [...units.values()].sort((a, b) => a.t - b.t);
    for (const u of unitList) {
      u.items.sort((a, b) => a.step - b.step);
      u.x = this.colX.get(+u.t.toFixed(4));
      const avg = u.items.reduce((s, i) => s + i.step, 0) / u.items.length;
      const mid = u.staff === 'T' ? TREBLE_BASE + 4 : BASS_BASE + 4;
      u.up = avg < mid;
    }
    // beam groups per staff
    const beatSpan = (song.ts[1] === 8) ? 1.5 : 1;
    const groups = [];
    for (const staff of ['T', 'B']) {
      const list = unitList.filter((u) => u.staff === staff);
      let cur = null;
      for (const u of list) {
        const beamable = u.cls.base <= 0.5 && u.cls.base >= 0.25;
        if (beamable && cur) {
          const last = cur[cur.length - 1];
          const contiguous = Math.abs(last.t + last.d - u.t) < 0.02;
          const sameBeat = Math.floor(u.t / beatSpan + 1e-6) === Math.floor(cur[0].t / beatSpan + 1e-6);
          if (contiguous && sameBeat && cur.length < 8) { cur.push(u); continue; }
        }
        if (cur && cur.length > 1) groups.push(cur);
        cur = beamable ? [u] : null;
      }
      if (cur && cur.length > 1) groups.push(cur);
    }
    const beamed = new Set();
    const beamSvg = [];
    for (const g of groups) {
      const up = g.reduce((s, u) => s + (u.up ? 1 : 0), 0) >= g.length / 2;
      g.forEach((u) => { u.up = up; beamed.add(u); });
      const tip = (u) => (up ? Math.min(...u.items.map((i) => i.y)) - 3.2 * SP : Math.max(...u.items.map((i) => i.y)) + 3.2 * SP);
      const stemX = (u) => (up ? u.x + SP * 0.6 : u.x - SP * 0.6);
      let y0 = tip(g[0]), y1 = tip(g[g.length - 1]);
      const slope = Math.max(-1.4 * SP, Math.min(1.4 * SP, y1 - y0));
      const x0 = stemX(g[0]), x1 = stemX(g[g.length - 1]);
      let base = y0;
      const lineAt = (x) => (x1 === x0 ? base : base + (slope * (x - x0)) / (x1 - x0));
      // push the beam out until every stem is long enough
      for (const u of g) {
        const need = tip(u);
        const at = lineAt(stemX(u));
        if (up && at > need) base -= at - need;
        if (!up && at < need) base += need - at;
      }
      const yy = (x) => lineAt(x);
      u2svg: for (const u of g) {
        const sx = stemX(u);
        const near = up ? Math.max(...u.items.map((i) => i.y)) : Math.min(...u.items.map((i) => i.y));
        u.stem = { x: sx, y1: near, y2: yy(sx) };
      }
      const bt = 0.5 * SP, dir = up ? 1 : -1;
      beamSvg.push(`<polygon class="beam" points="${x0},${yy(x0)} ${x1},${yy(x1)} ${x1},${yy(x1) + dir * bt} ${x0},${yy(x0) + dir * bt}"/>`);
      for (let i = 0; i < g.length - 1; i++) {
        if (g[i].cls.base <= 0.25 && g[i + 1].cls.base <= 0.25) {
          const a = stemX(g[i]), b = stemX(g[i + 1]), o = dir * (bt + 0.35 * SP);
          beamSvg.push(`<polygon class="beam" points="${a},${yy(a) + o} ${b},${yy(b) + o} ${b},${yy(b) + o + dir * bt} ${a},${yy(a) + o + dir * bt}"/>`);
        }
      }
      if (g[0].cls.tuplet) {
        const mx = (x0 + x1) / 2, my = yy(mx) + (up ? -1.2 : 1.9) * SP;
        beamSvg.push(`<text class="tuplet" x="${mx}" y="${my}">3</text>`);
      }
    }
    // ---- noteheads, stems, flags, ledgers
    const noteSvg = [];
    const rx = SP * 0.64, ry = SP * 0.46;
    for (const u of unitList) {
      const hollow = u.cls.base >= 2;
      const hasStem = u.cls.base < 4;
      // seconds: offset heads
      const xs = u.items.map(() => 0);
      for (let i = 1; i < u.items.length; i++) {
        if (u.items[i].step - u.items[i - 1].step === 1 && xs[i - 1] === 0) xs[i] = (u.up ? 1 : -1) * rx * 1.75;
      }
      const ledgers = new Set();
      u.items.forEach((it, i) => {
        const top = u.staff === 'T' ? TREBLE_BASE + 8 : BASS_BASE + 8, bot = u.staff === 'T' ? TREBLE_BASE : BASS_BASE;
        for (let s = it.step; s > top; s--) if ((s - bot) % 2 === 0) ledgers.add(s);
        for (let s = it.step; s < bot; s++) if ((bot - s) % 2 === 0) ledgers.add(s);
      });
      // ledger lines (draw only those between staff and note)
      for (const s of ledgers) noteSvg.push(`<line class="ledger" x1="${u.x - rx * 1.7}" x2="${u.x + rx * 1.7}" y1="${yFor(u.staff, s)}" y2="${yFor(u.staff, s)}"/>`);
      let accX = u.x - rx - 5;
      // stem
      if (hasStem) {
        let st = u.stem;
        if (!st) {
          const ys = u.items.map((i) => i.y);
          const sx = u.up ? u.x + rx * 0.92 : u.x - rx * 0.92;
          st = { x: sx, y1: u.up ? Math.max(...ys) : Math.min(...ys), y2: u.up ? Math.min(...ys) - 3.4 * SP : Math.max(...ys) + 3.4 * SP };
          // stems that cross the middle line shorten to the middle line
          const mid = u.staff === 'T' ? TREBLE_TOP + 2 * SP : BASS_TOP + 2 * SP;
          if (u.up && st.y2 > mid) st.y2 = mid; if (!u.up && st.y2 < mid) st.y2 = mid;
        } else {
          st = { ...st, x: u.up ? u.x + rx * 0.92 : u.x - rx * 0.92 };
        }
        u.stemEl = st;
        noteSvg.push(`<line class="stem" data-u="1" x1="${st.x}" x2="${st.x}" y1="${st.y1}" y2="${st.y2}"/>`);
        if (!beamed.has(u) && u.cls.base <= 0.5) {
          const flags = u.cls.base <= 0.25 ? 2 : 1;
          for (let f = 0; f < flags; f++) {
            const dir = u.up ? 1 : -1, y = st.y2 + (u.up ? 1 : -1) * f * SP * 0.65;
            const x = st.x;
            noteSvg.push(u.up
              ? `<path class="flag" d="M${x} ${y} c ${SP * 0.2} ${SP * 0.8} ${SP * 1.4} ${SP * 1.1} ${SP * 0.9} ${SP * 2.5} c ${SP * 0.1} ${-SP * 1.0} ${-SP * 0.6} ${-SP * 1.3} ${-SP * 0.9} ${-SP * 1.7} z"/>`
              : `<path class="flag" d="M${x} ${y} c ${SP * 0.2} ${-SP * 0.8} ${SP * 1.4} ${-SP * 1.1} ${SP * 0.9} ${-SP * 2.5} c ${SP * 0.1} ${SP * 1.0} ${-SP * 0.6} ${SP * 1.3} ${-SP * 0.9} ${SP * 1.7} z"/>`);
          }
        }
      }
      u.items.forEach((it, i) => {
        const cx = u.x + xs[i], cy = it.y;
        const cls = `note ${it.n.h === 'L' ? 'lh' : 'rh'}${hollow ? ' hollow' : ''}`;
        noteSvg.push(`<ellipse class="${cls}" data-id="${it.n.id}" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(-20 ${cx} ${cy})"/>`);
        if (u.cls.dots) { const onLine = ((it.step - (u.staff === 'T' ? TREBLE_BASE : BASS_BASE)) % 2 + 2) % 2 === 0; noteSvg.push(`<circle class="dot" data-id="${it.n.id}" cx="${cx + rx + 4}" cy="${cy + (onLine ? -SP * 0.5 : 0)}" r="1.5"/>`); }
        if (it.acc) { noteSvg.push(`<g class="accg" data-id="${it.n.id}">${acc(it.acc, accX - (xs[i] < 0 ? rx * 1.8 : 0), cy)}</g>`); accX -= 0; }
      });
    }
    // ---- rests
    const restSvg = [];
    const restGlyph = { 4: 'rest1', 2: 'rest2', 1: 'rest4', 0.5: 'rest8', 0.25: 'rest16' };
    for (const staff of ['T', 'B']) {
      const sn = items.filter((i) => i.staff === staff).map((i) => i.n);
      if (!sn.length) continue;
      for (let b = 0; b < bars; b++) {
        const t0 = b * bl, t1 = t0 + bl;
        const iv = sn.filter((n) => n.t < t1 - 1e-6 && n.t + n.d > t0 + 1e-6).map((n) => [Math.max(n.t, t0), Math.min(n.t + n.d, t1)]).sort((a, c) => a[0] - c[0]);
        let cursor = t0;
        const gaps = [];
        for (const [a, c] of iv) { if (a > cursor + 0.01) gaps.push([cursor, a]); cursor = Math.max(cursor, c); }
        if (cursor < t1 - 0.01) gaps.push([cursor, t1]);
        for (const [a, c] of gaps) {
          let t = a;
          const whole = Math.abs(a - t0) < 0.01 && Math.abs(c - t1) < 0.01;
          if (whole) {
            const x = (this.colX.get(+t0.toFixed(4)) + this.colX.get(+t1.toFixed(4))) / 2 - 3;
            const ly = staff === 'T' ? TREBLE_TOP + SP : BASS_TOP + SP;
            restSvg.push(`<g class="rest">${glyphPath('rest1', x, ly + 0.28 * SP, GS)}</g>`);
            continue;
          }
          while (c - t > 0.12) {
            const len = [2, 1, 0.5, 0.25].find((x) => x <= c - t + 0.01) || 0.25;
            const key3 = len;
            const x = this.xOf(t) + 2;
            const mid = (staff === 'T' ? TREBLE_TOP : BASS_TOP) + 2 * SP;
            if (len === 2) restSvg.push(`<g class="rest">${glyphPath('rest2', x, mid - 0.28 * SP, GS)}</g>`);
            else if (len === 1) restSvg.push(`<g class="rest">${glyphPath('rest4', x, mid, GS)}</g>`);
            else if (len === 0.5) restSvg.push(`<g class="rest">${glyphPath('rest8', x, mid - 0.1 * SP, GS)}</g>`);
            else restSvg.push(`<g class="rest">${glyphPath('rest16', x, mid + 0.1 * SP, GS)}</g>`);
            t += len;
            if (len === 0.25 && c - t < 0.12) break;
          }
        }
      }
    }
    parts.push(...restSvg, ...beamSvg, ...noteSvg);
    this.track.innerHTML = `<svg xmlns="${NS}" viewBox="0 0 ${this.totalW} ${H}" preserveAspectRatio="xMinYMin meet">${parts.join('')}</svg>`;
    // ---- fixed panel with clefs, key + time signature
    const pp = [];
    for (let i = 0; i < 5; i++) {
      pp.push(`<line class="staff" x1="0" x2="${this.panelW}" y1="${TREBLE_TOP + i * SP}" y2="${TREBLE_TOP + i * SP}"/>`);
      pp.push(`<line class="staff" x1="0" x2="${this.panelW}" y1="${BASS_TOP + i * SP}" y2="${BASS_TOP + i * SP}"/>`);
    }
    pp.push(`<line class="bar" x1="1" x2="1" y1="${TREBLE_TOP}" y2="${BASS_BOT}"/>`);
    // G clef: spiral centred on the G line (2nd line); F clef on the F line (4th line)
    const gLine = TREBLE_BOT - SP, fLine = BASS_TOP + SP;
    pp.push(`<g class="clef">${glyphPath('gclef', PANEL_PAD + 11, gLine - 0.6 * SP + 0, GS * 1.12)}</g>`);
    pp.push(`<g class="clef">${glyphPath('fclef', PANEL_PAD + 11, fLine + 0.55 * SP, GS * 1.0)}</g>`);
    const sig = this.ks;
    const nT = sig.n > 0 ? SHARP_T : FLAT_T, nB = sig.n > 0 ? SHARP_B : FLAT_B;
    for (let i = 0; i < Math.abs(sig.n); i++) {
      const x = PANEL_PAD + 32 + i * 8;
      pp.push(`<g class="clef">${acc(sig.n > 0 ? 'sharp' : 'flat', x, yFor('T', nT[i]))}${acc(sig.n > 0 ? 'sharp' : 'flat', x, yFor('B', nB[i]))}</g>`);
    }
    const tx = PANEL_PAD + 32 + Math.abs(sig.n) * 8 + 10;
    const [tn, td] = song.ts;
    pp.push(`<text class="timesig" x="${tx}" y="${TREBLE_TOP + 2 * SP - 1}">${tn}</text><text class="timesig" x="${tx}" y="${TREBLE_TOP + 4 * SP - 1}">${td}</text>`);
    pp.push(`<text class="timesig" x="${tx}" y="${BASS_TOP + 2 * SP - 1}">${tn}</text><text class="timesig" x="${tx}" y="${BASS_TOP + 4 * SP - 1}">${td}</text>`);
    this.panel.innerHTML = `<svg xmlns="${NS}" viewBox="0 0 ${this.panelW} ${H}">${pp.join('')}</svg>`;
    // element index for highlighting
    this.noteEls = new Map();
    this.track.querySelectorAll('[data-id]').forEach((e) => {
      const id = +e.dataset.id;
      if (!this.noteEls.has(id)) this.noteEls.set(id, []);
      this.noteEls.get(id).push(e);
    });
    this.loopBand = this.track.querySelector('.loopband');
    this.sorted = [...song.notes].sort((a, b) => a.t - b.t);
    this.resize();
    this._applySize();
  }

  // ------------------------------------------------------------ state
  setHand(hand) {
    this.hand = hand;
    if (!this.noteEls) return;
    for (const n of this.song.notes) {
      const dim = hand === 'R' ? n.h === 'L' : hand === 'L' ? n.h !== 'L' : false;
      for (const e of this.noteEls.get(n.id) || []) e.classList.toggle('dim', dim);
    }
  }
  setLoop(a, b) {
    this.loop = a == null ? null : [a, b];
    if (!this.loopBand) return;
    if (!this.loop) { this.loopBand.style.display = 'none'; return; }
    const x0 = this.xOf(this.loop[0]) - 8, x1 = this.xOf(this.loop[1]) - 8;
    this.loopBand.setAttribute('x', x0); this.loopBand.setAttribute('width', Math.max(4, x1 - x0));
    this.loopBand.style.display = '';
  }
  mark(id, kind) { for (const e of this.noteEls.get(id) || []) { e.classList.remove('hit', 'miss'); if (kind) e.classList.add(kind); } }
  clearMarks() { for (const es of this.noteEls.values()) for (const e of es) e.classList.remove('hit', 'miss'); }

  setBeat(beat, { force = false } = {}) {
    if (!this.song) return;
    if (beat < this.beat - 1e-6 || force) this._reset(beat);
    this.beat = beat;
    const s = this.sorted;
    while (this.ptr < s.length && s[this.ptr].t <= beat + 1e-6) { this.on.add(s[this.ptr].id); this._cls(s[this.ptr].id, 'on', true); this.ptr++; }
    for (const id of [...this.on]) {
      const n = this.song.notes[id] || this.byId(id);
      if (n.t + n.d <= beat + 1e-6) { this.on.delete(id); this._cls(id, 'on', false); this._cls(id, 'past', true); }
    }
    const x = this.xOf(beat) - 8;
    this.playhead.dataset.x = x;
    if (!this.user) this._follow(x);
    this._applyOffset();
  }
  byId(id) { return this.song.notes.find((n) => n.id === id); }
  _reset(beat) {
    this.on = new Set(); this.ptr = 0;
    const s = this.sorted;
    for (const n of s) {
      const past = n.t + n.d <= beat + 1e-6;
      for (const e of this.noteEls.get(n.id) || []) { e.classList.toggle('past', past); e.classList.remove('on'); }
    }
    // pointer: first note starting after beat; notes currently sounding are re-added
    while (this.ptr < s.length && s[this.ptr].t <= beat + 1e-6) {
      const n = s[this.ptr]; if (n.t + n.d > beat + 1e-6) { this.on.add(n.id); this._cls(n.id, 'on', true); }
      this.ptr++;
    }
  }
  _cls(id, c, on) { for (const e of this.noteEls.get(id) || []) e.classList.toggle(c, on); }
  _follow(x) {
    const vw = this.view.clientWidth / this.k;
    const target = Math.max(0, x - vw * 0.28);
    // ease toward target; snap when far
    this.offset += Math.abs(target - this.offset) > vw ? target - this.offset : (target - this.offset) * 0.25;
  }
  _applyOffset() {
    const off = this.user != null ? this.user : this.offset;
    const px = off * this.k;
    this.track.style.transform = `translate3d(${-px}px,0,0)`;
    const ph = (+this.playhead.dataset.x || 0) - off;
    this.playhead.style.transform = `translate3d(${ph * this.k}px,0,0)`;
  }
  resumeFollow() { this.user = null; this._applyOffset(); }

  // ------------------------------------------------------------ interaction
  _bind() {
    let down = null;
    this.view.addEventListener('pointerdown', (e) => { down = { x: e.clientX, off: this.user != null ? this.user : this.offset, moved: false, id: e.pointerId }; this.view.setPointerCapture?.(e.pointerId); });
    this.view.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      if (Math.abs(dx) > 6) down.moved = true;
      if (down.moved) {
        const max = Math.max(0, this.totalW - this.view.clientWidth / this.k);
        this.user = Math.max(0, Math.min(max, down.off - dx / this.k));
        this._applyOffset();
      }
    });
    const up = (e) => {
      if (!down) return;
      const d = down; down = null;
      if (!d.moved) {
        const r = this.view.getBoundingClientRect();
        const lx = (e.clientX - r.left) / this.k + (this.user != null ? this.user : this.offset) + 8;
        const beat = this.beatAt(lx);
        this.user = null;
        this.opts.onTap?.(beat, Math.floor(beat / this.bl + 1e-6));
      } else this.opts.onPan?.();
    };
    this.view.addEventListener('pointerup', up);
    this.view.addEventListener('pointercancel', () => { down = null; });
  }
}

/** A tiny static staff showing one note (or chord) - used by the note-reading quiz. */
export function miniStaffSvg(midis, { clef = 'T', key = 'C', width = 200 } = {}) {
  const sp = SP, top = 4 * sp, bot = top + 4 * sp, h = bot + 4 * sp;
  const base = clef === 'T' ? TREBLE_BASE : BASS_BASE;
  const y = (step) => bot - ((step - base) * sp) / 2;
  const parts = [];
  for (let i = 0; i < 5; i++) parts.push(`<line class="staff" x1="6" x2="${width - 6}" y1="${top + i * sp}" y2="${top + i * sp}"/>`);
  const g = clef === 'T' ? 'gclef' : 'fclef';
  parts.push(`<g class="clef">${glyphPath(g, 32, clef === 'T' ? bot - sp - 0.6 * sp : top + sp + 0.55 * sp, GS * (clef === 'T' ? 1.12 : 1))}</g>`);
  const cx = width / 2 + 20;
  for (const m of midis) {
    const sp0 = spellMidi(m, key), st = stepNum(sp0), cy = y(st);
    const topStep = base + 8;
    for (let s = st; s > topStep; s--) if ((s - base) % 2 === 0) parts.push(`<line class="ledger" x1="${cx - 13}" x2="${cx + 13}" y1="${y(s)}" y2="${y(s)}"/>`);
    for (let s = st; s < base; s++) if ((base - s) % 2 === 0) parts.push(`<line class="ledger" x1="${cx - 13}" x2="${cx + 13}" y1="${y(s)}" y2="${y(s)}"/>`);
    parts.push(`<ellipse class="note" cx="${cx}" cy="${cy}" rx="${sp * 0.64}" ry="${sp * 0.46}" transform="rotate(-20 ${cx} ${cy})"/>`);
    if (sp0.acc) parts.push(`<g class="accg">${acc(sp0.acc === 1 ? 'sharp' : 'flat', cx - 16, cy)}</g>`);
  }
  return `<svg xmlns="${NS}" viewBox="0 0 ${width} ${h}" class="mini-staff">${parts.join('')}</svg>`;
}
