// PianoPlay - music theory helpers, song format, chord/accompaniment builder, difficulty estimator.
// Pure module (no DOM) so it can be unit-tested in Node.

const PC_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PC_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

export const isBlack = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);

export function parseName(n) {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(n);
  if (!m) throw new Error('Bad note name: ' + n);
  const letter = m[1].toUpperCase();
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const oct = parseInt(m[3], 10);
  return { letter, acc, oct, midi: (oct + 1) * 12 + LETTER_PC[letter] + acc };
}
export const nameToMidi = (n) => parseName(n).midi;

export function midiToName(m, flats = false, withOct = true) {
  const pc = ((m % 12) + 12) % 12;
  const name = (flats ? PC_FLAT : PC_SHARP)[pc];
  return withOct ? name + (Math.floor(m / 12) - 1) : name;
}
/** Letter-only (no accidental) name for keyboard learning. */
export function pcName(m, flats = false) { return midiToName(m, flats, false); }

// ---------------------------------------------------------------- keys
const SHARP_KEYS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, Am: 0, Em: 1, Bm: 2, 'F#m': 3, 'C#m': 4, 'G#m': 5, 'D#m': 6, 'A#m': 7 };
const FLAT_KEYS = { F: 1, Bb: 2, Eb: 3, Ab: 4, Db: 5, Gb: 6, Cb: 7, Dm: 1, Gm: 2, Cm: 3, Fm: 4, Bbm: 5, Ebm: 6, Abm: 7 };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Returns {n: signed count (+sharps/-flats), map: letter->acc} */
export function keySignature(key = 'C') {
  let n = 0;
  if (key in SHARP_KEYS) n = SHARP_KEYS[key];
  else if (key in FLAT_KEYS) n = -FLAT_KEYS[key];
  const map = {};
  if (n > 0) SHARP_ORDER.slice(0, n).forEach((l) => (map[l] = 1));
  if (n < 0) FLAT_ORDER.slice(0, -n).forEach((l) => (map[l] = -1));
  return { n, map };
}
export const keyPrefersFlats = (key) => keySignature(key).n < 0;

/** Spell a midi note using the key's preference. Returns {letter, acc, oct, midi}. */
export function spellMidi(m, key = 'C') {
  const flats = keyPrefersFlats(key);
  const name = midiToName(m, flats, false);
  const letter = name[0];
  const acc = name.length > 1 ? (name[1] === '#' ? 1 : -1) : 0;
  const oct = Math.floor((m - acc) / 12) - 1;
  return { letter, acc, oct, midi: m };
}

// ---------------------------------------------------------------- note-string parser
/**
 * Compact notation:  "E5:1 D5 C5 R:1 C3+E3+G3:2 | ..."
 *  - pitch[:duration in beats]; duration persists until changed
 *  - "R" rest, "+" joins chord tones, "|" bar line (checked, otherwise ignored)
 *  - "~" after a token ties it to the next token of the same pitch
 * Returns {notes:[{t,d,m,n}], end, warnings}
 */
export function parseNotes(str, hand = 'R', barLen = 4) {
  const notes = [];
  const warnings = [];
  let t = 0, dur = 1;
  const pendingTie = {};
  for (const raw of str.trim().split(/\s+/)) {
    if (!raw) continue;
    if (raw === '|') {
      const r = t / barLen;
      if (Math.abs(r - Math.round(r)) > 0.01) warnings.push(`bar line at beat ${t.toFixed(3)} misaligned`);
      continue;
    }
    let tok = raw, tie = false;
    if (tok.endsWith('~')) { tie = true; tok = tok.slice(0, -1); }
    const [p, d] = tok.split(':');
    if (d !== undefined && d !== '') dur = parseFloat(d);
    if (!(dur > 0)) throw new Error('Bad duration in token ' + raw);
    if (p.toUpperCase() !== 'R') {
      for (const nm of p.split('+')) {
        const info = parseName(nm);
        const key = info.midi;
        const prev = pendingTie[key];
        if (prev) { prev.d += dur; if (!tie) delete pendingTie[key]; }
        else {
          const note = { t, d: dur, m: info.midi, h: hand, sp: { letter: info.letter, acc: info.acc, oct: info.oct } };
          notes.push(note);
          if (tie) pendingTie[key] = note;
        }
      }
    }
    t += dur;
  }
  return { notes, end: t, warnings };
}

// ---------------------------------------------------------------- chords
const QUAL = {
  '': [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11], sus4: [0, 5, 7], sus2: [0, 2, 7], dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10], '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], '9': [0, 4, 7, 10, 14],
};
export const CHORD_QUALITIES = Object.keys(QUAL);

/** parseChord('Am7/E') -> {rootPc, intervals, bassPc, symbol} */
export function parseChord(sym) {
  const m = /^([A-G])([#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(sym);
  if (!m) throw new Error('Bad chord ' + sym);
  const rootPc = (LETTER_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  const q = m[3];
  if (!(q in QUAL)) throw new Error('Unknown chord quality "' + q + '" in ' + sym);
  let bassPc = rootPc;
  if (m[4]) bassPc = (LETTER_PC[m[4][0]] + (m[4][1] === '#' ? 1 : m[4][1] === 'b' ? -1 : 0) + 12) % 12;
  return { rootPc, intervals: QUAL[q], bassPc, symbol: sym };
}

/** Pitch of pitch-class `pc` nearest to `target` (midi) */
function nearestPc(pc, target) {
  let best = pc, bd = 1e9;
  for (let o = 0; o < 128; o += 12) {
    const c = pc + o;
    const d = Math.abs(c - target);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/**
 * Voicing for an accompaniment chord: bass note plus the other chord tones stacked above it.
 * Returns {bass, u:[tones above bass, ascending], top}
 */
export function voiceChord(chordSym, bassTarget = 43) {
  const c = typeof chordSym === 'string' ? parseChord(chordSym) : chordSym;
  const bass = nearestPc(c.bassPc, bassTarget);
  const rel = new Set();
  for (const i of c.intervals) { const r = (((c.rootPc + i) % 12) - c.bassPc + 12) % 12; if (r !== 0) rel.add(r); }
  if (c.bassPc !== c.rootPc) { /* slash chord: root already included via intervals */ }
  const u = [...rel].sort((a, b) => a - b).map((r) => bass + r);
  return { bass, u, top: bass + 12 };
}

/** Accompaniment patterns. Returns array of {t,d,m} relative to the start of a measure segment. */
function patternNotes(pattern, v, len) {
  const out = [];
  const add = (t, d, ...ms) => ms.forEach((m) => out.push({ t, d, m }));
  const third = v.u[0] ?? v.bass + 4, fifth = v.u[1] ?? v.bass + 7, top = v.u[2] ?? v.top;
  const hi = v.bass <= 45 ? 12 : 0;                       // lift "chord" strokes of oom-pah patterns out of the mud
  switch (pattern) {
    case 'block': add(0, len, v.bass, third, fifth); break;
    case 'whole': add(0, len, v.bass, fifth); break;
    case 'bass': { const h = len / 2; add(0, h, v.bass); add(h, h, v.bass + 7); break; }
    case 'alberti': { const n = Math.round(len * 2); const seq = [v.bass, fifth, third, fifth]; for (let i = 0; i < n; i++) add(i * 0.5, 0.5, seq[i % 4]); break; }
    case 'arp': { const seq = [v.bass, third, fifth, v.top, fifth, third]; const n = Math.round(len * 2); for (let i = 0; i < n; i++) add(i * 0.5, 0.5, seq[i % 6]); break; }
    case 'trip': { const seq = [v.bass, third, fifth]; const n = Math.round(len * 3); for (let i = 0; i < n; i++) add(i / 3, 1 / 3, seq[i % 3]); break; }
    case 'waltz': add(0, 1, v.bass); for (let b = 1; b < len; b++) add(b, 1, third + hi, fifth + hi); break;
    case 'march': for (let b = 0; b < len; b++) { if (b % 2 === 0) add(b, 1, b === 2 ? v.bass + 7 : v.bass); else add(b, 1, third + hi, fifth + hi); } break;
    case 'oct': { const n = Math.round(len); for (let b = 0; b < n; b++) add(b, 1, v.bass, v.bass + 12); break; }
    case 'pulse': { const n = Math.round(len * 2); for (let i = 0; i < n; i++) add(i * 0.5, 0.5, v.bass, third, fifth); break; }
    default: throw new Error('Unknown pattern ' + pattern);
  }
  return out;
}

/**
 * chords: "C G,Am F" -> one token per measure; commas split a measure evenly.
 *   token forms:  Am7/E   |  waltz=Am (pattern override)  |  rep@1/3@G#3_C#4_E4 (cycle explicit pitches)  |  - (rest)
 * Returns {notes, end}
 */
export function buildAccompaniment(chords, pattern = 'block', barLen = 4, ts = [4, 4], bassTarget = 43, hand = 'L') {
  const notes = [];
  let t0 = 0;
  for (const tok of chords.trim().split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const parts = tok.split(',');
    const seg = barLen / parts.length;
    parts.forEach((p, i) => {
      if (p === '-' || p.toUpperCase() === 'R') return;
      const base = t0 + i * seg;
      if (p.startsWith('rep@')) {
        const [, durS, pitches] = p.split('@');
        const d = durS.includes('/') ? durS.split('/').map(Number).reduce((a, b) => a / b) : parseFloat(durS);
        const ms = pitches.split('_').map(nameToMidi);
        const n = Math.round(seg / d);
        for (let k = 0; k < n; k++) notes.push({ t: base + k * d, d, m: ms[k % ms.length], h: hand });
        return;
      }
      let pat = pattern, sym = p;
      if (p.includes('=')) [pat, sym] = p.split('=');
      const v = voiceChord(sym, bassTarget);
      for (const n of patternNotes(pat, v, seg)) notes.push({ t: base + n.t, d: n.d, m: n.m, h: hand });
    });
    t0 += barLen;
  }
  return { notes, end: t0 };
}

// ---------------------------------------------------------------- song building
export const barLength = (ts) => (ts[0] * 4) / ts[1];

/**
 * def: {id,title,composer,level,tempo,ts,key,rh,lh?|chords+pattern, tags?, note?}
 * Returns normalised song {…def, notes[], length(beats), bars}
 */
export function buildSong(def) {
  const ts = def.ts || [4, 4];
  const bl = barLength(ts);
  const warnings = [];
  let notes = [];
  let end = 0;
  if (def.rh) { const r = parseNotes(def.rh, 'R', bl); notes.push(...r.notes); end = Math.max(end, r.end); warnings.push(...r.warnings.map((w) => 'RH ' + w)); }
  if (def.lh) { const r = parseNotes(def.lh, 'L', bl); notes.push(...r.notes); end = Math.max(end, r.end); warnings.push(...r.warnings.map((w) => 'LH ' + w)); }
  if (def.chords) {
    const r = buildAccompaniment(def.chords, def.pattern || 'block', bl, ts, def.bassTarget || 43, def.chordsHand || 'L');
    notes.push(...r.notes); end = Math.max(end, r.end);
  }
  if (def.notes) { notes.push(...def.notes); end = Math.max(end, ...def.notes.map((n) => n.t + n.d)); }
  notes.sort((a, b) => a.t - b.t || a.m - b.m);
  notes.forEach((n, i) => (n.id = i));
  const song = { tempo: 90, key: 'C', ...def, ts, notes, length: end, bars: Math.ceil(end / bl - 1e-6), warnings };
  delete song.rh; delete song.lh; delete song.chords;
  song.est = estimateDifficulty(song);
  if (!song.level) song.level = song.est.label;
  return song;
}

// ---------------------------------------------------------------- difficulty
export const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

export function estimateDifficulty(song) {
  const notes = song.notes;
  if (!notes.length) return { label: 'Beginner', score: 0, features: {} };
  const clock = tempoClock(song);
  const len = Math.max(song.length || 1, 1);
  const dur = Math.max(1, clock.sec(0, len));
  const onsetKeys = [...new Set(notes.map((n) => Math.round(n.t * 1000)))].sort((a, b) => a - b);
  const onsetSec = onsetKeys.map((k) => clock.sec(0, k / 1000));
  const nps = onsetKeys.length / dur;
  // peak onset density: 90th percentile of 2-second windows (so one busy passage counts, silence doesn't dilute)
  const wins = []; for (let w = 0; w < dur; w += 1) { let c = 0; for (const t of onsetSec) if (t >= w && t < w + 2) c++; wins.push(c / 2); }
  wins.sort((a, b) => a - b); const peak = wins[Math.floor(wins.length * 0.9)] || nps;
  // per-hand range (hand stretch matters, not the distance between the hands)
  const span = (h) => { const ms = notes.filter((n) => (n.h === 'L') === (h === 'L')).map((n) => n.m); return ms.length ? Math.max(...ms) - Math.min(...ms) : 0; };
  const range = Math.max(span('R'), span('L'));
  // simultaneous notes at each onset -> 90th percentile
  const sorted = [...notes].sort((a, b) => a.t - b.t);
  const sims = []; let lo = 0;
  for (const k of onsetKeys) { const t = k / 1000; while (lo < sorted.length && sorted[lo].t + sorted[lo].d <= t + 1e-6) lo++; let c = 0; for (let i = lo; i < sorted.length && sorted[i].t <= t + 1e-6; i++) if (sorted[i].t + sorted[i].d > t + 1e-6) c++; sims.push(c); }
  sims.sort((a, b) => a - b);
  const maxSim = sims[Math.floor(sims.length * 0.9)] || 1;
  // both hands active ratio
  const slots = Math.ceil(len * 2);
  const act = { R: new Uint8Array(slots + 1), L: new Uint8Array(slots + 1) };
  for (const n of notes) { for (let s = Math.floor(n.t * 2); s < Math.min(slots, Math.ceil((n.t + n.d) * 2)); s++) act[n.h === 'L' ? 'L' : 'R'][s] = 1; }
  let both = 0, any = 0;
  for (let s = 0; s < slots; s++) { if (act.R[s] || act.L[s]) any++; if (act.R[s] && act.L[s]) both++; }
  const bothRatio = any ? both / any : 0;
  // accidentals vs key
  const minor = /m$/.test(song.key);
  const tonic = parseChord(song.key.replace(/m$/, '') + (minor ? 'm' : '')).rootPc;
  const scale = (minor ? [0, 2, 3, 5, 7, 8, 10, 11] : [0, 2, 4, 5, 7, 9, 11]).map((i) => (tonic + i) % 12);
  let out = 0;
  for (const n of notes) if (!scale.includes(n.m % 12)) out++;
  const accFrac = out / notes.length;
  // melodic leaps (RH)
  const rh = notes.filter((n) => n.h !== 'L');
  let leap = 0, ln = 0;
  for (let i = 1; i < rh.length; i++) if (rh[i].t > rh[i - 1].t) { leap += Math.abs(rh[i].m - rh[i - 1].m); ln++; }
  const avgLeap = ln ? leap / ln : 0;
  const c = (x) => Math.min(Math.max(x, 0), 1);
  const speed = c((peak - 2) / 9), avgSpeed = c((nps - 1.2) / 5), density = c((maxSim - 2) / 4), rng = c((range - 14) / 22);
  const acc = c(accFrac * 5), lp = c((avgLeap - 2.5) / 5), size = c(Math.log2(notes.length / 120) / 4), rhythm = c(sims.length / 1500);
  const score = W.speed * speed + W.avg * avgSpeed + W.density * density + W.range * rng + W.acc * acc + W.leap * lp + W.size * size + W.hands * bothRatio + W.bias;
  const label = score < T[0] ? 'Beginner' : score < T[1] ? 'Intermediate' : 'Advanced';
  return { label, score, features: { nps, peak, range, maxSim, bothRatio, accFrac, avgLeap, notes: notes.length, speed, avgSpeed, density, rng, acc, lp, size } };
}
const W = { speed: 0.3, avg: 0.1, density: 0.12, range: 0.1, acc: 0.14, leap: 0.1, size: 0.08, hands: 0.06, bias: 0 };
const T = [0.22, 0.5];

// ---------------------------------------------------------------- helpers used by the engine
/** Group notes into steps (same start time). Optionally only a given hand. */
export function stepsOf(notes, hand = 'both') {
  const sel = hand === 'both' ? notes : notes.filter((n) => (hand === 'R' ? n.h !== 'L' : n.h === 'L'));
  const map = new Map();
  for (const n of sel) {
    const k = Math.round(n.t * 1000);
    if (!map.has(k)) map.set(k, { t: n.t, notes: [] });
    map.get(k).notes.push(n);
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

export function transposeNotes(notes, semis) { return notes.map((n) => ({ ...n, m: n.m + semis, sp: undefined })); }

/** Scale the amount of notes: keep at most `max` notes per simultaneous group per hand (highest for R, lowest for L). */
export function simplifyNotes(notes, maxPerHand = 3, minDur = 0) {
  const groups = new Map();
  for (const n of notes) { const k = n.h + Math.round(n.t * 1000); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
  const keep = [];
  for (const g of groups.values()) {
    g.sort((a, b) => a.m - b.m);
    const picked = g[0].h === 'L' ? [g[0], ...g.slice(-(maxPerHand - 1))].filter((x, i, a) => a.indexOf(x) === i).slice(0, maxPerHand) : g.slice(-maxPerHand);
    keep.push(...picked);
  }
  return keep.filter((n) => n.d >= minDur).sort((a, b) => a.t - b.t || a.m - b.m).map((n, i) => ({ ...n, id: i }));
}

export const beatsToSeconds = (beats, tempo) => (beats * 60) / tempo;

/** Tempo clock for songs with tempo changes: song.tempoMap = [{beat, bpm}, ...] (falls back to the single song.tempo). */
export function tempoClock(song) {
  const raw = song.tempoMap?.length ? song.tempoMap : [{ beat: 0, bpm: song.tempo || 90 }];
  const map = raw.map((s, i) => ({ beat: i === 0 ? 0 : s.beat, bpm: Math.max(20, Math.min(400, s.bpm)) }));
  const segAt = (b) => { let lo = 0, hi = map.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (map[mid].beat <= b) lo = mid; else hi = mid - 1; } return lo; };
  const clock = {
    bpm: (b) => map[segAt(b)].bpm,
    /** seconds from beat a to beat b at 100 % speed */
    sec(a, b) {
      if (b < a) return -clock.sec(b, a);
      let t = 0, i = segAt(Math.max(a, 0)), cur = Math.max(a, 0);
      if (a < 0) t += (Math.min(b, 0) - a) * 60 / map[0].bpm;
      if (b <= 0) return t;
      while (cur < b) { const end = i + 1 < map.length ? Math.min(map[i + 1].beat, b) : b; t += (end - cur) * 60 / map[i].bpm; cur = end; i++; if (i >= map.length) { if (cur < b) t += (b - cur) * 60 / map[map.length - 1].bpm; break; } }
      return t;
    },
    changes: map.length > 1,
  };
  return clock;
}
export const fmtTime = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
