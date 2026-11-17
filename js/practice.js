// PianoPlay - practice content generators: warm-ups, scales, chords, hand drills, note quiz,
// the lesson path and personalised recommendations. Every drill is produced as a normal song so it
// runs through the same engine (falling notes, sheet, wait/flow modes, mic input).
import { buildSong, nameToMidi, midiToName } from './music.js';

// ---------------------------------------------------------------- scales
export const ROOTS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
export const SCALE_TYPES = {
  major: { name: 'Major', iv: [0, 2, 4, 5, 7, 9, 11], minor: false },
  minor: { name: 'Natural minor', iv: [0, 2, 3, 5, 7, 8, 10], minor: true },
  harmonic: { name: 'Harmonic minor', iv: [0, 2, 3, 5, 7, 8, 11], minor: true },
  melodic: { name: 'Melodic minor (up)', iv: [0, 2, 3, 5, 7, 9, 11], minor: true },
  pentatonic: { name: 'Major pentatonic', iv: [0, 2, 4, 7, 9], minor: false },
  minpent: { name: 'Minor pentatonic', iv: [0, 3, 5, 7, 10], minor: true },
  blues: { name: 'Blues', iv: [0, 3, 5, 6, 7, 10], minor: true },
  chromatic: { name: 'Chromatic', iv: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], minor: false },
};
// standard major-scale fingerings (one octave, ascending): RH / LH
const FING = {
  C: ['12312345', '54321321'], G: ['12312345', '54321321'], D: ['12312345', '54321321'], A: ['12312345', '54321321'], E: ['12312345', '54321321'],
  B: ['12312345', '43214321'], 'F#': ['23412312', '43213214'], Db: ['23123412', '32143213'], Ab: ['34123123', '32143213'], Eb: ['31234123', '32143213'],
  Bb: ['41231234', '32143213'], F: ['12341234', '54321321'],
};
const FLAT_ROOTS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db']);

export function scaleSong(root = 'C', type = 'major', { hand = 'both', octaves = 1, tempo = 72, eighth = false } = {}) {
  const st = SCALE_TYPES[type];
  let r = PC[root]; let start = 60 + r; if (start > 66) start -= 12;       // RH start between F#3..F#4
  const up = [];
  for (let o = 0; o < octaves; o++) for (const i of st.iv) up.push(start + o * 12 + i);
  up.push(start + octaves * 12);
  const seq = type === 'melodic' ? [...up, ...up.slice(0, -1).reverse().map((m, k) => m)] : [...up, ...up.slice(0, -1).reverse()];
  if (type === 'melodic') { // descending uses natural minor
    const natural = []; for (let o = octaves - 1; o >= 0; o--) for (const i of [...SCALE_TYPES.minor.iv].reverse()) natural.push(start + o * 12 + i);
    seq.splice(up.length, seq.length, ...natural);
  }
  const dur = eighth ? 0.5 : 1;
  const finger = (octaves === 1 && type === 'major' && FING[root]) ? FING[root] : null;
  const key = st.minor ? (root.endsWith('b') || FLAT_ROOTS.has(root) ? root + 'm' : root + 'm') : root;
  const notes = [];
  const mk = (hnd, shift, fing) => seq.forEach((m, i) => {
    const asc = i < up.length;
    const idx = asc ? i : seq.length - 1 - i;
    notes.push({ t: i * dur, d: dur, m: m + shift, h: hnd, f: fing ? +fing[idx] : undefined });
  });
  if (hand !== 'L') mk('R', 0, finger?.[0]);
  if (hand !== 'R') mk('L', -12, finger?.[1]);
  const keyName = ['Eb', 'Ab', 'Db', 'Bb', 'F'].includes(root) ? root : root;
  return buildSong({
    id: `scale-${root}-${type}-${hand}-${octaves}`, title: `${root} ${st.name} scale`, composer: 'Technique', cat: 'study', level: 'Beginner', era: 'Practice',
    key: st.minor ? root + 'm' : keyName, tempo, ts: [4, 4], notes: notes.map((n) => ({ ...n })), exact: true,
    desc: `${hand === 'both' ? 'Hands together' : hand === 'R' ? 'Right hand' : 'Left hand'}, ${octaves} octave${octaves > 1 ? 's' : ''}, up and down.${finger ? ' Finger numbers are shown on the notes.' : ''}`,
  });
}

// ---------------------------------------------------------------- chords
export const CHORD_KINDS = {
  major: { name: 'Major', sym: '', iv: [0, 4, 7] }, minor: { name: 'Minor', sym: 'm', iv: [0, 3, 7] }, dim: { name: 'Diminished', sym: 'dim', iv: [0, 3, 6] },
  aug: { name: 'Augmented', sym: 'aug', iv: [0, 4, 8] }, dom7: { name: 'Dominant 7th', sym: '7', iv: [0, 4, 7, 10] }, maj7: { name: 'Major 7th', sym: 'maj7', iv: [0, 4, 7, 11] }, min7: { name: 'Minor 7th', sym: 'm7', iv: [0, 3, 7, 10] },
};
function inversions(iv, base) {
  const root = iv.map((i) => base + i);
  const out = [root];
  for (let k = 1; k < iv.length; k++) { const prev = out[k - 1]; out.push([...prev.slice(1), prev[0] + 12]); }
  return out;
}
export function chordSong(root = 'C', kind = 'major', style = 'block', tempo = 60) {
  const ck = CHORD_KINDS[kind];
  let base = 60 + PC[root]; if (base > 66) base -= 12;
  const inv = inversions(ck.iv, base);
  const notes = [];
  const seq = [...inv, inversions(ck.iv, base + 12)[0], ...inv.slice(1).reverse()];  // up through inversions then back
  const step = style === 'broken' ? ck.iv.length : 4;
  seq.forEach((ch, i) => {
    const t = i * (style === 'broken' ? ck.iv.length * 0.5 + 0.5 : 4);
    if (style === 'block') {
      ch.forEach((m) => notes.push({ t, d: 4, m, h: 'R' }));
      notes.push({ t, d: 4, m: base - 12 + (inv[0][0] - base), h: 'L' });
    } else {
      ch.forEach((m, j) => notes.push({ t: t + j * 0.5, d: 0.5, m, h: 'R' }));
      notes.push({ t, d: ck.iv.length * 0.5, m: base - 12, h: 'L' });
    }
  });
  const len = seq.length * (style === 'broken' ? ck.iv.length * 0.5 + 0.5 : 4);
  const labels = ['root position', '1st inversion', ...(ck.iv.length > 3 ? ['2nd inversion', '3rd inversion'] : ['2nd inversion'])];
  return buildSong({
    id: `chord-${root}-${kind}-${style}`, title: `${root} ${ck.name} – ${style === 'block' ? 'block chords' : 'broken chords'}`, composer: 'Technique', cat: 'study', era: 'Practice', level: 'Beginner',
    key: kind === 'minor' || kind === 'min7' || kind === 'dim' ? root + 'm' : root, tempo, ts: [4, 4], notes, exact: true,
    desc: `Play the ${root} ${ck.name.toLowerCase()} chord through its inversions (${labels.join(', ')}) and back down. Left hand holds the root.`,
  });
}
export const PROGRESSIONS = {
  'I–IV–V–I': [[1, 'major'], [4, 'major'], [5, 'major'], [1, 'major']],
  'I–V–vi–IV': [[1, 'major'], [5, 'major'], [6, 'minor'], [4, 'major']],
  'I–vi–IV–V': [[1, 'major'], [6, 'minor'], [4, 'major'], [5, 'major']],
  'ii–V–I': [[2, 'minor'], [5, 'dom7'], [1, 'major']],
  '12-bar blues': [[1, 'dom7'], [1, 'dom7'], [1, 'dom7'], [1, 'dom7'], [4, 'dom7'], [4, 'dom7'], [1, 'dom7'], [1, 'dom7'], [5, 'dom7'], [4, 'dom7'], [1, 'dom7'], [5, 'dom7']],
};
export function progressionSong(root = 'C', name = 'I–IV–V–I', tempo = 72) {
  const DEG = [0, 2, 4, 5, 7, 9, 11];
  const prog = PROGRESSIONS[name];
  let prev = null; const notes = [];
  prog.forEach(([deg, kind], i) => {
    const rpc = (PC[root] + DEG[deg - 1]) % 12;
    const iv = CHORD_KINDS[kind].iv;
    // choose the inversion closest to the previous chord for smooth voice leading
    const cands = []; for (const base of [48 + rpc, 60 + rpc, 72 + rpc]) for (const ch of inversions(iv, base)) cands.push(ch);
    const centre = prev ? prev.reduce((a, b) => a + b, 0) / prev.length : 66;
    cands.sort((a, b) => Math.abs(a.reduce((x, y) => x + y, 0) / a.length - centre) - Math.abs(b.reduce((x, y) => x + y, 0) / b.length - centre));
    const ch = cands.find((c) => c[0] >= 58 && c[c.length - 1] <= 80) || cands[0];
    prev = ch;
    ch.forEach((m) => notes.push({ t: i * 4, d: 4, m, h: 'R' }));
    notes.push({ t: i * 4, d: 4, m: 36 + rpc + (rpc > 6 ? 0 : 12) - (rpc > 6 ? 0 : 0), h: 'L' });
  });
  return buildSong({
    id: `prog-${root}-${name}`, title: `${root} major: ${name}`, composer: 'Technique', cat: 'study', era: 'Practice', level: 'Intermediate', key: root, tempo, ts: [4, 4], notes, exact: true,
    desc: `A ${name} chord progression in ${root}. Right hand plays the chords, left hand plays the roots.`,
  });
}

// ---------------------------------------------------------------- hand drills & warm-ups
const N = (names, d = 1, h = 'R', t0 = 0, f) => names.map((n, i) => ({ t: t0 + i * d, d, m: nameToMidi(n), h, f: f?.[i] }));
export const DRILLS = {
  'rh-five': { title: 'Right hand: five-finger shapes', hand: 'R', desc: 'Fingers 1-5 on C-D-E-F-G in different patterns. Keep your hand relaxed and curved.',
    make() { const p = ['C4', 'D4', 'E4', 'F4', 'G4']; const f = [1, 2, 3, 4, 5]; const seq = [[0, 1, 2, 3, 4, 3, 2, 1, 0], [0, 2, 1, 3, 2, 4, 3, 2, 1, 0], [0, 1, 0, 2, 0, 3, 0, 4, 0], [4, 3, 2, 1, 0, 1, 2, 3, 4]]; const notes = []; let t = 0; for (const s of seq) { for (const i of s) { notes.push({ t, d: 1, m: nameToMidi(p[i]), h: 'R', f: f[i] }); t += 1; } t += 0; } return { notes, tempo: 76, key: 'C' }; } },
  'lh-five': { title: 'Left hand: five-finger shapes', hand: 'L', desc: 'Fingers 5-1 on C-D-E-F-G (one octave below middle C).',
    make() { const p = ['C3', 'D3', 'E3', 'F3', 'G3']; const f = [5, 4, 3, 2, 1]; const seq = [[0, 1, 2, 3, 4, 3, 2, 1, 0], [0, 2, 1, 3, 2, 4, 3, 2, 1, 0], [4, 3, 2, 1, 0, 1, 2, 3, 4], [0, 4, 0, 3, 0, 2, 0, 1, 0]]; const notes = []; let t = 0; for (const s of seq) { for (const i of s) { notes.push({ t, d: 1, m: nameToMidi(p[i]), h: 'L', f: f[i] }); t += 1; } } return { notes, tempo: 76, key: 'C' }; } },
  thirds: { title: 'Right hand: broken thirds', hand: 'R', desc: 'Skip a finger: 1-3, 2-4, 3-5. Great for finger independence.',
    make() { const n = N(['C4', 'E4', 'D4', 'F4', 'E4', 'G4', 'F4', 'A4', 'G4', 'A4', 'F4', 'G4', 'E4', 'F4', 'D4', 'E4', 'C4:2'.split(':')[0]], 0.5, 'R'); return { notes: n, tempo: 84, key: 'C' }; } },
  alberti: { title: 'Left hand: Alberti bass', hand: 'L', desc: 'The classic broken-chord accompaniment (low-high-middle-high) over C – F – G7 – C.',
    make() { const ch = [['C3', 'G3', 'E3'], ['F2', 'C3', 'A2'], ['G2', 'D3', 'B2'], ['C3', 'G3', 'E3']]; const notes = []; ch.forEach((c, b) => { const seq = [c[0], c[1], c[2], c[1]]; for (let i = 0; i < 8; i++) notes.push({ t: b * 4 + i * 0.5, d: 0.5, m: nameToMidi(seq[i % 4]), h: 'L' }); }); return { notes, tempo: 76, key: 'C' }; } },
  contrary: { title: 'Hands together: contrary motion', hand: 'both', desc: 'Both hands move away from and back toward each other – a mirror image.',
    make() { const r = ['E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'B4', 'A4', 'G4', 'F4', 'E4'], l = ['E4', 'D4', 'C4', 'B3', 'A3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4']; return { notes: [...N(r, 1, 'R'), ...N(l, 1, 'L')], tempo: 70, key: 'C' }; } },
  independence: { title: 'Hands together: 2 against 1', hand: 'both', desc: 'Right hand plays steady quarter notes while the left hand plays eighths. Count out loud!',
    make() { const r = N(['C5', 'D5', 'E5', 'F5', 'G5', 'F5', 'E5', 'D5'], 1, 'R'); const l = []; for (let i = 0; i < 16; i++) l.push({ t: i * 0.5, d: 0.5, m: nameToMidi(i % 2 ? 'G3' : 'C3'), h: 'L' }); return { notes: [...r, ...l], tempo: 66, key: 'C' }; } },
  hanon: { title: 'Hanon-style finger builder', hand: 'both', desc: 'Both hands in octaves: 1-2-3-4-5-4-3-2, stepping up the scale. Builds speed and evenness.',
    make() {
      const sc = [0, 2, 4, 5, 7, 9, 11]; const deg = (d) => 60 + Math.floor(d / 7) * 12 + sc[((d % 7) + 7) % 7];
      const notes = []; let t = 0;
      for (let s = 0; s < 8; s++) for (const off of [0, 2, 3, 4, 5, 4, 3, 2]) { const m = deg(s + off); notes.push({ t, d: 0.5, m, h: 'R' }); notes.push({ t, d: 0.5, m: m - 12, h: 'L' }); t += 0.5; }
      notes.push({ t, d: 2, m: deg(8), h: 'R' }); notes.push({ t, d: 2, m: deg(8) - 12, h: 'L' });
      return { notes, tempo: 70, key: 'C' };
    } },
  staccato: { title: 'Right hand: legato vs. staccato', hand: 'R', desc: 'Same melody, two touches: play smoothly, then short and bouncy.',
    make() { const m = ['C4', 'D4', 'E4', 'C4', 'E4', 'F4', 'G4', 'R', 'G4', 'A4', 'G4', 'F4', 'E4', 'C4', 'D4', 'G3', 'C4']; const notes = []; let t = 0; for (const n of m) { if (n === 'R') { t += 1; continue; } notes.push({ t, d: 1, m: nameToMidi(n), h: 'R' }); t += 1; } return { notes, tempo: 80, key: 'C' }; } },
};
export function drillSong(id) {
  const d = DRILLS[id]; const g = d.make();
  return buildSong({ id: 'drill-' + id, title: d.title, composer: 'Technique', cat: 'study', era: 'Practice', level: 'Beginner', key: g.key, tempo: g.tempo, ts: [4, 4], notes: g.notes, exact: true, desc: d.desc, drillHand: d.hand });
}
/** A short, varied daily warm-up (≈ 3-4 minutes) that scales with the player's level. */
export function warmupSet(level = 'Beginner') {
  const day = Math.floor(Date.now() / 86400000);
  const roots = level === 'Beginner' ? ['C', 'G', 'F'] : level === 'Intermediate' ? ['C', 'G', 'D', 'A', 'F', 'Bb'] : ROOTS;
  const root = roots[day % roots.length];
  const items = [
    { title: 'Finger warm-up', song: drillSong(day % 2 ? 'rh-five' : 'lh-five'), mode: 'learn', hand: day % 2 ? 'R' : 'L' },
    { title: `${root} major scale`, song: scaleSong(root, 'major', { hand: level === 'Beginner' ? 'R' : 'both', octaves: level === 'Advanced' ? 2 : 1, tempo: level === 'Beginner' ? 60 : 80 }), mode: 'learn', hand: level === 'Beginner' ? 'R' : 'both' },
    { title: `${root} chords`, song: chordSong(root, 'major', 'block', 60), mode: 'learn', hand: 'both' },
  ];
  if (level !== 'Beginner') items.push({ title: 'Hands together', song: drillSong(day % 2 ? 'contrary' : 'hanon'), mode: 'learn', hand: 'both' });
  return items;
}

// ---------------------------------------------------------------- note quiz
export const QUIZ_LEVELS = [
  { name: 'Level 1 – White keys, treble', lo: 60, hi: 72, clefs: ['T'], acc: false },
  { name: 'Level 2 – White keys, both clefs', lo: 48, hi: 72, clefs: ['T', 'B'], acc: false },
  { name: 'Level 3 – Sharps & flats', lo: 48, hi: 72, clefs: ['T', 'B'], acc: true },
  { name: 'Level 4 – Wide range & ledger lines', lo: 36, hi: 84, clefs: ['T', 'B'], acc: true },
];
export function quizQuestion(levelIdx = 0, kind = 'staff', avoid = null, weak = []) {
  const L = QUIZ_LEVELS[Math.min(levelIdx, QUIZ_LEVELS.length - 1)];
  for (let tries = 0; tries < 50; tries++) {
    let m = L.lo + Math.floor(Math.random() * (L.hi - L.lo + 1));
    if (weak.length && Math.random() < 0.35) { const w = weak[Math.floor(Math.random() * weak.length)]; if (w >= L.lo && w <= L.hi) m = w; }
    const black = [1, 3, 6, 8, 10].includes(m % 12);
    if (black && !L.acc) continue;
    if (m === avoid) continue;
    const clef = L.clefs.length === 1 ? L.clefs[0] : (m >= 60 ? 'T' : 'B');
    const flats = Math.random() < 0.4;
    return { kind, midi: m, clef, flats, name: midiToName(m, flats, false), pc: m % 12, black };
  }
  return { kind, midi: 60, clef: 'T', flats: false, name: 'C', pc: 0, black: false };
}
export const NOTE_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export const noteLabel = (m, flats) => midiToName(m, flats, false).replace('#', '♯').replace('b', '♭');

// ---------------------------------------------------------------- the lesson path
const lessonSong = (fn) => () => fn();
const rhNotes = (names, tempo = 70, id = 'x', title = '') => buildSong({ id, title, composer: 'Lesson', cat: 'study', era: 'Lesson', level: 'Beginner', key: 'C', tempo, ts: [4, 4], notes: N(names, 1, 'R'), exact: true });
export const UNITS = [
  { id: 'u1', title: 'First steps', blurb: 'Meet the keys and play your first notes.' },
  { id: 'u2', title: 'Both hands', blurb: 'Left hand, right hand, then together.' },
  { id: 'u3', title: 'Scales & chords', blurb: 'The building blocks of every piece.' },
  { id: 'u4', title: 'Real music', blurb: 'Classical favourites, one step at a time.' },
];
export const LESSONS = [
  { id: 'l-middle-c', unit: 'u1', title: 'Find middle C', blurb: 'Learn where C lives on the keyboard.', type: 'quiz', quiz: { level: 0, kind: 'find', n: 6 } },
  { id: 'l-cde', unit: 'u1', title: 'Right hand: C-D-E', blurb: 'Your first three notes.', type: 'play', mode: 'learn', hand: 'R', song: lessonSong(() => rhNotes(['C4', 'D4', 'E4', 'D4', 'C4', 'D4', 'E4', 'E4', 'E4'], 70, 'les-cde', 'C-D-E')), minAcc: 0.7 },
  { id: 'l-five-rh', unit: 'u1', title: 'Right-hand five fingers', blurb: 'C to G, one finger per note.', type: 'play', mode: 'learn', hand: 'R', song: lessonSong(() => drillSong('rh-five')), minAcc: 0.7 },
  { id: 'l-read', unit: 'u1', title: 'Read your first notes', blurb: 'Match the notes on the staff to the keys.', type: 'quiz', quiz: { level: 0, kind: 'staff', n: 8 } },
  { id: 'l-mary', unit: 'u1', title: 'Mary Had a Little Lamb', blurb: 'Your first real song – right hand.', type: 'play', mode: 'learn', hand: 'R', songId: 'mary-lamb', minAcc: 0.7 },
  { id: 'l-five-lh', unit: 'u2', title: 'Left-hand five fingers', blurb: 'Fingers 5-4-3-2-1 below middle C.', type: 'play', mode: 'learn', hand: 'L', song: lessonSong(() => drillSong('lh-five')), minAcc: 0.7 },
  { id: 'l-bass-clef', unit: 'u2', title: 'Meet the bass clef', blurb: 'Read notes for your left hand.', type: 'quiz', quiz: { level: 1, kind: 'staff', n: 8 } },
  { id: 'l-ode-rh', unit: 'u2', title: 'Ode to Joy – right hand', blurb: 'Beethoven\'s famous theme.', type: 'play', mode: 'learn', hand: 'R', songId: 'ode-to-joy', minAcc: 0.75 },
  { id: 'l-ode-lh', unit: 'u2', title: 'Ode to Joy – left hand', blurb: 'The bass line.', type: 'play', mode: 'learn', hand: 'L', songId: 'ode-to-joy', minAcc: 0.75 },
  { id: 'l-ode-both', unit: 'u2', title: 'Ode to Joy – hands together', blurb: 'Put it all together.', type: 'play', mode: 'learn', hand: 'both', songId: 'ode-to-joy', minAcc: 0.7 },
  { id: 'l-twinkle', unit: 'u2', title: 'Twinkle, Twinkle (Mozart)', blurb: 'Hands together, in flow mode.', type: 'play', mode: 'play', hand: 'both', songId: 'twinkle-mozart', minAcc: 0.7 },
  { id: 'l-scale-rh', unit: 'u3', title: 'C major scale – right hand', blurb: 'Thumb-under technique.', type: 'play', mode: 'learn', hand: 'R', song: lessonSong(() => scaleSong('C', 'major', { hand: 'R' })), minAcc: 0.75 },
  { id: 'l-scale-lh', unit: 'u3', title: 'C major scale – left hand', blurb: 'Fingers 5-4-3-2-1-3-2-1.', type: 'play', mode: 'learn', hand: 'L', song: lessonSong(() => scaleSong('C', 'major', { hand: 'L' })), minAcc: 0.75 },
  { id: 'l-scale-both', unit: 'u3', title: 'C major scale – hands together', blurb: 'Play both hands in parallel.', type: 'play', mode: 'play', hand: 'both', song: lessonSong(() => scaleSong('C', 'major', { hand: 'both', tempo: 60 })), minAcc: 0.7 },
  { id: 'l-chords', unit: 'u3', title: 'C major chord & inversions', blurb: 'Three notes at once.', type: 'play', mode: 'learn', hand: 'both', song: lessonSong(() => chordSong('C', 'major', 'block')), minAcc: 0.7 },
  { id: 'l-prog', unit: 'u3', title: 'I – IV – V – I', blurb: 'The most useful chord progression.', type: 'play', mode: 'learn', hand: 'both', song: lessonSong(() => progressionSong('C', 'I–IV–V–I')), minAcc: 0.7 },
  { id: 'l-notes-acc', unit: 'u3', title: 'Sharps and flats', blurb: 'Meet the black keys.', type: 'quiz', quiz: { level: 2, kind: 'staff', n: 10 } },
  { id: 'l-minuet', unit: 'u4', title: 'Minuet in G', blurb: 'A Baroque classic in 3/4.', type: 'play', mode: 'learn', hand: 'both', songId: 'minuet-g', minAcc: 0.7 },
  { id: 'l-canon', unit: 'u4', title: 'Canon in D', blurb: 'Pachelbel\'s ground bass and melody.', type: 'play', mode: 'learn', hand: 'both', songId: 'canon-d', minAcc: 0.7 },
  { id: 'l-elise', unit: 'u4', title: 'Für Elise', blurb: 'The famous opening theme.', type: 'play', mode: 'learn', hand: 'both', songId: 'fur-elise', minAcc: 0.7 },
  { id: 'l-prelude', unit: 'u4', title: 'Bach Prelude in C', blurb: 'Smooth, flowing arpeggios.', type: 'play', mode: 'learn', hand: 'both', songId: 'prelude-c', minAcc: 0.7 },
];

// ---------------------------------------------------------------- recommendations
/** store: PianoPlay store; library: built songs. Returns [{id,title,sub,icon,action}] */
export function recommend(store, library) {
  const out = [];
  const d = store.data, today = store.todayKey();
  const todayStat = d.stats.days[today];
  const level = store.skillLevel();
  if (!todayStat || todayStat.sec < 120) out.push({ id: 'warmup', icon: 'flame', title: 'Daily warm-up', sub: '3–4 minutes · fingers, a scale, a chord', action: { type: 'warmup' }, hot: true });
  // next lesson
  const next = LESSONS.find((l) => !d.progress.lessons[l.id]?.done);
  if (next) out.push({ id: 'lesson', icon: 'path', title: next.title, sub: `Next lesson · ${UNITS.find((u) => u.id === next.unit).title}`, action: { type: 'lesson', id: next.id } });
  // weaker hand
  const ha = d.progress.handAcc || {};
  if (ha.R?.n >= 3 && ha.L?.n >= 3) {
    const r = ha.R.sum / ha.R.n, l = ha.L.sum / ha.L.n;
    if (Math.abs(r - l) > 0.08) { const weak = r < l ? 'R' : 'L'; out.push({ id: 'hand', icon: weak === 'R' ? 'hand-r' : 'hand-l', title: `${weak === 'R' ? 'Right' : 'Left'}-hand drills`, sub: `Your ${weak === 'R' ? 'right' : 'left'} hand is ${Math.round(Math.abs(r - l) * 100)}% less accurate`, action: { type: 'drill', id: weak === 'R' ? 'rh-five' : 'alberti' } }); }
  }
  // weak notes
  const errs = Object.entries(d.noteErrors || {}).sort((a, b) => b[1] - a[1]).filter(([, c]) => c >= 3).slice(0, 3);
  if (errs.length) out.push({ id: 'notes', icon: 'eye', title: 'Note-reading practice', sub: `Trouble spots: ${errs.map(([m]) => noteLabel(+m, false)).join(', ')}`, action: { type: 'quiz', level: Math.min(3, QUIZ_LEVELS.length - 1), kind: 'staff', weak: errs.map(([m]) => +m) } });
  // retry weak songs
  const weakSong = Object.entries(d.progress.songs).filter(([, s]) => s.plays && (s.stars || 0) < 2).sort((a, b) => b[1].lastPlayed - a[1].lastPlayed)[0];
  if (weakSong) { const s = library.find((x) => x.id === weakSong[0]) || d.custom.find((x) => x.id === weakSong[0]); if (s) out.push({ id: 'retry', icon: 'refresh', title: `Polish “${s.title}”`, sub: 'Almost there – aim for 2 stars', action: { type: 'song', id: s.id } }); }
  // something new at the player's level
  const fresh = library.filter((s) => s.level === level && !d.progress.songs[s.id]?.plays);
  if (fresh.length) { const s = fresh[Math.floor(store.dayNumber() % fresh.length)]; out.push({ id: 'new', icon: 'music', title: s.title, sub: `${s.composer.split(' ').slice(-1)[0]} · ${s.level} · new for you`, action: { type: 'song', id: s.id } }); }
  return out.slice(0, 5);
}
