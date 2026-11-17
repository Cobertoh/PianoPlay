// PianoPlay - built-in song library.
//
// Songs are stored as compact text (see parseNotes/buildAccompaniment in music.js):
//   rh / lh : "E5:1 D5 C5:2 R:1 C3+E3+G3:2 | ..."   pitch[:beats], '+' chord, 'R' rest, '|' bar line
//   chords  : one chord symbol per measure ("C G,Am"), rendered with `pattern` for the left hand
// Everything here is a simplified teaching arrangement written for PianoPlay (the underlying
// compositions are in the public domain). `exact:false` marks arrangements that are approximations.
//
// To add songs: append an object below, drop a MIDI file into /library (see library/index.json),
// or let users import MIDI / audio in the app. Run `npm test` to validate bar alignment.
import { buildSong, nameToMidi, midiToName } from './music.js';

// ---- helpers for pieces that are easier to generate than to type
function bachPreludeC() {
  const bars = [
    ['C4', 'E4', 'G4', 'C5', 'E5'], ['C4', 'D4', 'A4', 'D5', 'F5'], ['B3', 'D4', 'G4', 'D5', 'F5'], ['C4', 'E4', 'G4', 'C5', 'E5'],
    ['C4', 'E4', 'A4', 'E5', 'A5'], ['C4', 'D4', 'F#4', 'A4', 'D5'], ['B3', 'D4', 'G4', 'D5', 'G5'], ['B3', 'C4', 'E4', 'G4', 'C5'],
    ['A3', 'C4', 'E4', 'G4', 'C5'], ['D3', 'A3', 'D4', 'F#4', 'C5'], ['G3', 'B3', 'D4', 'G4', 'B4'], ['G3', 'Bb3', 'E4', 'G4', 'C#5'],
    ['F3', 'A3', 'D4', 'A4', 'D5'],
  ];
  const rh = [], lh = [];
  for (const [a, b, c, d, e] of bars) {
    const seq = [a, b, c, d, e, c, d, e];
    rh.push(seq.concat(seq).map((n, i) => (i === 0 ? n + ':.25' : n)).join(' '));
    lh.push(midiToName(nameToMidi(a) - 12) + ':4');
  }
  rh.push('C4+E4+G4+C5:4'); lh.push('C3+E3:4');
  return { rh: rh.join(' | '), lh: lh.join(' | ') };
}
function celloPrelude() {
  const bars = [
    ['G2', 'D3', 'B3', 'A3', 'B3', 'D3', 'B3', 'D3'], ['G2', 'E3', 'C4', 'B3', 'C4', 'E3', 'C4', 'E3'],
    ['G2', 'F#3', 'C4', 'B3', 'C4', 'F#3', 'C4', 'F#3'], ['G2', 'G3', 'B3', 'A3', 'B3', 'G3', 'B3', 'G3'],
  ];
  const notes = [];
  bars.forEach((b, bi) => b.concat(b).forEach((n, i) => { const m = nameToMidi(n); notes.push({ t: bi * 4 + i * 0.25, d: 0.25, m, h: m < 57 ? 'L' : 'R' }); }));
  [['G2', 'L'], ['D3', 'L'], ['B3', 'R'], ['G3', 'L']].forEach(([n, h]) => notes.push({ t: 16, d: 4, m: nameToMidi(n), h }));
  return notes;
}
const prelC = bachPreludeC();

export const LIBRARY_DEFS = [
  // ============================================================ BEETHOVEN
  {
    id: 'ode-to-joy', title: 'Ode to Joy', composer: 'Ludwig van Beethoven', era: 'Classical', cat: 'classical', level: 'Beginner', key: 'C', tempo: 96, pattern: 'bass',
    desc: 'The glorious theme from the finale of Symphony No. 9. Five-finger position, mostly stepwise.', exact: true,
    rh: 'E4:1 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4:1.5 D4:.5 D4:2 | E4:1 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:.5 C4:2 | D4:1 D4 E4 C4 | D4:1 E4:.5 F4:.5 E4:1 C4 | D4:1 E4:.5 F4:.5 E4:1 D4 | C4:1 D4 G3:2 | E4:1 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:.5 C4:2',
    chords: 'C G C C,G C G C G,C G G,C G C,G C G C G,C',
  },
  {
    id: 'fur-elise', title: 'Für Elise (Theme)', composer: 'Ludwig van Beethoven', era: 'Classical', cat: 'classical', level: 'Intermediate', key: 'Am', tempo: 72, ts: [3, 8], exact: true,
    desc: 'Bagatelle No. 25 in A minor – the famous opening theme with its rocking E–D♯ figure.',
    rh: 'R:1 E5:.25 D#5 | E5 D#5 E5 B4 D5 C5 | A4:.5 R:.25 C4:.25 E4 A4 | B4:.5 R:.25 E4:.25 G#4 B4 | C5:.5 R:.25 E4:.25 E5 D#5 | E5:.25 D#5 E5 B4 D5 C5 | A4:.5 R:.25 C4:.25 E4 A4 | B4:.5 R:.25 E4:.25 C5 B4 | A4:.5 R:1',
    lh: 'R:1.5 | R:1.5 | A2:.5 E3 A3 | E2:.5 E3 G#3 | A2:.5 E3 A3 | R:1.5 | A2:.5 E3 A3 | E2:.5 E3 G#3 | A2:.5 R:1',
  },
  {
    id: 'beethoven-5', title: 'Symphony No. 5 – Opening Motif', composer: 'Ludwig van Beethoven', era: 'Classical', cat: 'classical', level: 'Beginner', key: 'Cm', tempo: 100, pattern: 'block',
    desc: 'The most famous four notes in music. Short, punchy, and great for rhythm practice.', exact: true,
    rh: 'R:.5 G4:.5 G4 G4 Eb4:2 | R:.5 F4:.5 F4 F4 D4:2 | R:.5 G4:.5 G4 G4 Eb4:2 | R:.5 F4:.5 F4 F4 D4:2 | C4:4',
    chords: 'Cm G7 Cm G7 Cm',
  },
  {
    id: 'moonlight-1', title: 'Moonlight Sonata (Opening)', composer: 'Ludwig van Beethoven', era: 'Classical', cat: 'classical', level: 'Intermediate', key: 'C#m', tempo: 54, exact: false,
    desc: 'The hypnotic triplet arpeggios over a slowly descending bass. Approximate arrangement of the opening bars.',
    chords: 'rep@1/3@G#3_C#4_E4 rep@1/3@G#3_C#4_E4 rep@1/3@A3_C#4_E4 rep@1/3@A3_D4_F#4,rep@1/3@G#3_B#3_D#4 rep@1/3@G#3_C#4_E4', chordsHand: 'R',
    lh: 'C#2+C#3:4 | B1+B2:4 | A1+A2:4 | F#1+F#2:2 G#1+G#2:2 | C#2+C#3:4',
  },
  // ============================================================ MOZART
  {
    id: 'twinkle-mozart', title: 'Twinkle, Twinkle, Little Star', composer: 'Wolfgang A. Mozart', era: 'Classical', cat: 'classical', level: 'Beginner', key: 'C', tempo: 100, pattern: 'bass',
    desc: 'Mozart\'s "Ah! vous dirai-je, Maman" theme – the tune behind the nursery rhyme.', exact: true,
    rh: 'C4:1 C4 G4 G4 | A4 A4 G4:2 | F4:1 F4 E4 E4 | D4 D4 C4:2 | G4:1 G4 F4 F4 | E4 E4 D4:2 | G4:1 G4 F4 F4 | E4 E4 D4:2 | C4:1 C4 G4 G4 | A4 A4 G4:2 | F4:1 F4 E4 E4 | D4 D4 C4:2',
    chords: 'C F,C F,C G,C C,F C,G C,F C,G C F,C F,C G,C',
  },
  {
    id: 'alla-turca', title: 'Rondo alla Turca (Theme)', composer: 'Wolfgang A. Mozart', era: 'Classical', cat: 'classical', level: 'Intermediate', key: 'Am', tempo: 126, ts: [2, 4], pattern: 'waltz', exact: false,
    desc: 'The sparkling "Turkish March" from Piano Sonata No. 11. Opening theme only.',
    rh: 'B4:.25 A4 G#4 A4 C5:1 | D5:.25 C5 B4 C5 E5:1 | F5:.25 E5 D#5 E5 B5:.25 A5 G#5 A5 | B5:.25 A5 G#5 A5 C6:.5 A5:.5 | A4:2',
    chords: 'Am Am Am E Am',
  },
  // ============================================================ BACH & BAROQUE
  {
    id: 'minuet-g', title: 'Minuet in G', composer: 'Christian Petzold (attrib. J.S. Bach)', era: 'Baroque', cat: 'classical', level: 'Beginner', key: 'G', tempo: 112, ts: [3, 4], pattern: 'waltz',
    desc: 'From the Notebook for Anna Magdalena Bach – the classic first minuet every pianist learns.', exact: true,
    rh: 'D5:1 G4:.5 A4 B4 C5 | D5:1 G4 G4 | E5:1 C5:.5 D5 E5 F#5 | G5:1 G4 G4 | C5:1 D5:.5 C5 B4 A4 | B4:1 C5:.5 B4 A4 G4 | F#4:1 G4:.5 A4 B4 G4 | A4:3 | D5:1 G4:.5 A4 B4 C5 | D5:1 G4 G4 | E5:1 C5:.5 D5 E5 F#5 | G5:1 G4 G4 | C5:1 D5:.5 C5 B4 A4 | B4:1 C5:.5 B4 A4 G4 | A4:1 B4:.5 A4 G4 F#4 | G4:3',
    chords: 'G G C G C G D D G G C G C G D G',
  },
  {
    id: 'canon-d', title: 'Canon in D (Simplified)', composer: 'Johann Pachelbel', era: 'Baroque', cat: 'classical', level: 'Beginner', key: 'D', tempo: 66, exact: true,
    desc: 'The eight-chord ground bass with its gently descending melody, then a flowing variation.',
    rh: 'F#5:2 E5:2 | D5:2 C#5:2 | B4:2 A4:2 | B4:2 C#5:2 | D5:1 F#5:1 E5:1 C#5:1 | D5:1 B4:1 C#5:1 A4:1 | B4:1 D5:1 A4:1 F#4:1 | G4:1 B4:1 A4:1 C#5:1 | D5:4',
    lh: 'D3:2 A2:2 | B2:2 F#2:2 | G2:2 D3:2 | G2:2 A2:2 | D3:2 A2:2 | B2:2 F#2:2 | G2:2 D3:2 | G2:2 A2:2 | D3:4',
  },
  {
    id: 'prelude-c', title: 'Prelude in C (BWV 846)', composer: 'Johann Sebastian Bach', era: 'Baroque', cat: 'classical', level: 'Intermediate', key: 'C', tempo: 62, exact: true,
    desc: 'The shimmering arpeggios from The Well-Tempered Clavier. First 13 bars plus a closing chord.',
    rh: prelC.rh, lh: prelC.lh,
  },
  {
    id: 'cello-prelude', title: 'Cello Suite No. 1 – Prelude (Opening)', composer: 'Johann Sebastian Bach', era: 'Baroque', cat: 'classical', level: 'Intermediate', key: 'G', tempo: 72, exact: true,
    desc: 'The rolling sixteenth-note pattern that opens Bach\'s first cello suite, arranged for two hands. First four bars.',
    notes: celloPrelude(),
  },
  // ============================================================ HAYDN
  {
    id: 'surprise-symphony', title: 'Surprise Symphony (Theme)', composer: 'Joseph Haydn', era: 'Classical', cat: 'classical', level: 'Beginner', key: 'C', tempo: 92, pattern: 'bass', exact: false,
    desc: 'The gentle tune from the slow movement of Symphony No. 94 – just before the famous "surprise" chord.',
    rh: 'C4:1 C4 E4 E4 | G4 G4 E4:2 | F4:1 F4 D4 D4 | B3 B3 G3:2 | C4:1 C4 E4 E4 | G4 G4 E4:2 | F4:1 F4 D4 D4 | G3:2 C4:2',
    chords: 'C C F,G G C C F,G G,C',
  },
  // ============================================================ GRIEG
  {
    id: 'mountain-king', title: 'In the Hall of the Mountain King', composer: 'Edvard Grieg', era: 'Romantic', cat: 'classical', level: 'Intermediate', key: 'Bm', tempo: 116, pattern: 'bass', exact: true,
    desc: 'The creeping theme that gets faster and louder – here shown as its opening statement and a higher repeat.',
    rh: 'B3:.5 C#4 D4 E4 F#4 D4 F#4:1 | E#4:.5 C#4 E#4:1 R:2 | B3:.5 C#4 D4 E4 F#4 D4 F#4:1 | B4:.5 A4 F#4 D4 F#4 A4:1.5 | B4:.5 C#5 D5 E5 F#5 D5 F#5:1 | E#5:.5 C#5 E#5:1 R:2 | B4:.5 C#5 D5 E5 F#5 D5 F#5:1 | B5:.5 A5 F#5 D5 F#5 A5:1.5',
    chords: 'Bm F# Bm Bm Bm F# Bm Bm',
  },
  // ============================================================ FOLK / TRADITIONAL STARTERS (public domain)
  {
    id: 'mary-lamb', title: 'Mary Had a Little Lamb', composer: 'Traditional', era: 'Folk', cat: 'folk', level: 'Beginner', key: 'C', tempo: 100, pattern: 'bass', exact: true,
    desc: 'A perfect first song – only three fingers needed.',
    rh: 'E4:1 D4 C4 D4 | E4 E4 E4:2 | D4:1 D4 D4:2 | E4:1 G4 G4:2 | E4:1 D4 C4 D4 | E4 E4 E4 E4 | D4 D4 E4 D4 | C4:4',
    chords: 'C C G C C C G C',
  },
  {
    id: 'jingle-bells', title: 'Jingle Bells', composer: 'James Lord Pierpont', era: 'Folk', cat: 'folk', level: 'Beginner', key: 'C', tempo: 120, pattern: 'bass', exact: true,
    desc: 'The chorus, from the first "dashing through the snow" to the final cadence.',
    rh: 'E4:1 E4 E4:2 | E4:1 E4 E4:2 | E4:1 G4 C4:1.5 D4:.5 | E4:4 | F4:1 F4 F4:1.5 F4:.5 | F4:1 E4 E4 E4:.5 E4:.5 | E4:1 D4 D4 E4 | D4:2 G4:2 | E4:1 E4 E4:2 | E4:1 E4 E4:2 | E4:1 G4 C4:1.5 D4:.5 | E4:4 | F4:1 F4 F4:1.5 F4:.5 | F4:1 E4 E4 E4:.5 E4:.5 | G4:1 G4 F4 D4 | C4:4',
    chords: 'C C C C F F,C C,G G C C C C F F,C C,G C',
  },
  {
    id: 'happy-birthday', title: 'Happy Birthday to You', composer: 'Traditional', era: 'Folk', cat: 'folk', level: 'Beginner', key: 'C', tempo: 96, ts: [3, 4], pattern: 'waltz', exact: true,
    desc: 'Everyone knows it. Includes the pickup notes and a high G at the end of the third line.',
    rh: 'R:2 G4:.75 G4:.25 | A4:1 G4 C5 | B4:2 G4:.75 G4:.25 | A4:1 G4 D5 | C5:2 G4:.75 G4:.25 | G5:1 E5 C5 | B4:1 A4 F5:.75 F5:.25 | E5:1 C5 D5 | C5:3',
    chords: '- C G G C C F C,G C',
  },
  {
    id: 'frere-jacques', title: 'Frère Jacques', composer: 'Traditional', era: 'Folk', cat: 'folk', level: 'Beginner', key: 'C', tempo: 100, pattern: 'bass', exact: true,
    desc: 'A round you can play with one hand – then add the left-hand bass.',
    rh: 'C4:1 D4 E4 C4 | C4 D4 E4 C4 | E4 F4 G4:2 | E4:1 F4 G4:2 | G4:.5 A4 G4 F4 E4:1 C4:1 | G4:.5 A4 G4 F4 E4:1 C4:1 | C4:1 G3 C4:2 | C4:1 G3 C4:2',
    chords: 'C C C C G,C G,C C C',
  },
  {
    id: 'silent-night', title: 'Silent Night', composer: 'Franz Xaver Gruber', era: 'Folk', cat: 'folk', level: 'Beginner', key: 'C', tempo: 60, ts: [3, 4], pattern: 'waltz', exact: true,
    desc: 'Gentle 3/4 carol in C – a lovely piece for smooth, connected playing.',
    rh: 'G4:1.5 A4:.5 G4:1 | E4:3 | G4:1.5 A4:.5 G4:1 | E4:3 | D5:2 D5:1 | B4:3 | C5:2 C5:1 | G4:3 | A4:2 A4:1 | C5:1.5 B4:.5 A4:1 | G4:1.5 A4:.5 G4:1 | E4:3 | A4:2 A4:1 | C5:1.5 B4:.5 A4:1 | G4:1.5 A4:.5 G4:1 | E4:3 | D5:2 D5:1 | F5:1.5 D5:.5 B4:1 | C5:3 | E5:3 | C5:1 G4:1 E4:1 | G4:1.5 F4:.5 D4:1 | C4:3',
    chords: 'C C C C G G C C F C C C F C C C G G C C C G C',
  },
  {
    id: 'greensleeves', title: 'Greensleeves', composer: 'Traditional (16th c.)', era: 'Folk', cat: 'folk', level: 'Intermediate', key: 'Am', tempo: 88, ts: [3, 4], pattern: 'waltz', exact: true,
    desc: 'The timeless English melody in A minor – expressive, lyrical, and a good step up.',
    rh: 'R:2 A4:1 | C5:2 D5:1 | E5:1.5 F5:.5 E5:1 | D5:2 B4:1 | G4:1.5 A4:.5 B4:1 | C5:2 A4:1 | A4:1.5 G#4:.5 A4:1 | B4:2 G#4:1 | E4:2 A4:1 | C5:2 D5:1 | E5:1.5 F5:.5 E5:1 | D5:2 B4:1 | G4:1.5 A4:.5 B4:1 | C5:1.5 B4:.5 A4:1 | G#4:1.5 F#4:.5 G#4:1 | A4:3',
    chords: '- Am Am G G Am E E Am Am Am G G Am E Am',
  },
];

export function buildLibrary() {
  return LIBRARY_DEFS.map((d) => buildSong(d));
}

/** Composer short names for filters */
export const composerShort = (c) => c.replace(/\(.*\)/, '').trim().split(' ').slice(-1)[0];
