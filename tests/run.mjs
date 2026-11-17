// PianoPlay test-suite (plain Node, no dependencies):  npm test
import assert from 'node:assert/strict';
import { buildLibrary } from '../js/songs.js';
import { parseNotes, nameToMidi, midiToName, keySignature, estimateDifficulty, stepsOf, parseChord, voiceChord } from '../js/music.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '\n       ', e.message); } };

console.log('music theory');
t('note names round-trip', () => { for (let m = 21; m <= 108; m++) assert.equal(nameToMidi(midiToName(m)), m); });
t('enharmonic spellings', () => { assert.equal(nameToMidi('Cb4'), 59); assert.equal(nameToMidi('B#3'), 60); assert.equal(nameToMidi('E#4'), 65); });
t('key signatures', () => { assert.equal(keySignature('G').n, 1); assert.equal(keySignature('Bb').n, -2); assert.equal(keySignature('C#m').n, 4); assert.equal(keySignature('Am').n, 0); });
t('chord parsing', () => { const c = parseChord('Am7/E'); assert.equal(c.bassPc, 4); assert.deepEqual(c.intervals, [0, 3, 7, 10]); });
t('voicing places bass below chord tones', () => { const v = voiceChord('C', 43); assert.ok(v.u.every((p) => p > v.bass)); });
t('parser durations persist and ties merge', () => { const r = parseNotes('C4:1 D4 E4:2 R:1 G4:1~ G4:1'); assert.equal(r.notes.length, 4); assert.equal(r.end, 7); assert.equal(r.notes[3].d, 2); });

console.log('library');
const lib = buildLibrary();
t('library not empty', () => assert.ok(lib.length >= 15, 'songs: ' + lib.length));
const ids = new Set();
for (const s of lib) {
  t(`${s.title}: structure`, () => {
    assert.ok(!ids.has(s.id), 'duplicate id'); ids.add(s.id);
    assert.ok(s.notes.length > 0);
    assert.ok(s.notes.every((n) => n.m >= 21 && n.m <= 108 && n.d > 0 && n.t >= 0), 'bad note');
    assert.deepEqual(s.warnings, [], s.warnings.join('; '));
    assert.ok(['Beginner', 'Intermediate', 'Advanced'].includes(s.level));
  });
  t(`${s.title}: both hands end together`, () => {
    const endR = Math.max(0, ...s.notes.filter((n) => n.h === 'R').map((n) => n.t + n.d));
    const endL = Math.max(0, ...s.notes.filter((n) => n.h === 'L').map((n) => n.t + n.d));
    if (endR && endL) assert.ok(Math.abs(endR - endL) < 1.01, `RH ends ${endR}, LH ends ${endL}`);
  });
}
console.log('\nlevels:'); for (const s of lib) console.log('  ', s.level.padEnd(13), 'est', s.est.label.padEnd(13), s.est.score.toFixed(2), s.title);

const extra = process.argv.includes('--quick') ? [] : ['./detect.mjs', './transcribe.mjs', './arrange.mjs', './basicpitch.mjs', './worker.mjs'];
for (const f of extra) { try { const m = await import(f); const r = await m.run(t); } catch (e) { fail++; console.log('  FAIL suite', f, e.message); } }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
