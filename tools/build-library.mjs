// Builds library/index.json + library/midi/*.mid from tools/library-picks.json and a local clone of
// github.com/christianpasinrey/falling-notes (Mutopia Project MIDI files). Usage: node tools/build-library.mjs /tmp/fn
import fs from 'node:fs'; import path from 'node:path';
import { midiToSong } from '../js/midi.js';
import { tempoClock } from '../js/music.js';
const src = process.argv[2] || '/tmp/fn';
const picks = JSON.parse(fs.readFileSync('tools/library-picks.json', 'utf8')).filter((p) => p.cid !== 1);
const T = {
  468: 'Prelude in E minor, Op. 28 No. 4', 470: 'Prelude in A major, Op. 28 No. 7', 469: 'Prelude in B minor, Op. 28 No. 6', 472: 'Prelude in C minor, Op. 28 No. 20', 471: 'Prelude in Db major "Raindrop", Op. 28 No. 15',
  1590: 'Nocturne in Eb major, Op. 9 No. 2', 582: 'Nocturne in Bb minor, Op. 9 No. 1', 1955: 'Nocturne in B major, Op. 9 No. 3', 486: 'Nocturne in Db major, Op. 27 No. 2', 509: 'Nocturne in E minor, Op. 72 No. 1',
  483: 'Minute Waltz, Op. 64 No. 1', 511: 'Waltz in B minor, Op. 69 No. 2', 1693: 'Fantaisie-Impromptu, Op. 66', 914: 'Etude in C major, Op. 10 No. 1', 926: 'Etude "Black Keys", Op. 10 No. 5', 484: 'Etude in F minor, Op. 10 No. 9',
  743: 'Etude in C minor "Revolutionary", Op. 10 No. 12', 489: 'Etude "Aeolian Harp", Op. 25 No. 1', 508: 'Etude in A minor, Op. 10 No. 2', 1959: 'Ballade No. 1 in G minor, Op. 23', 422: 'Ballade No. 4 in F minor, Op. 52',
  1682: 'Mazurka in G minor, Op. 33 No. 1', 1687: 'Mazurka in F# minor, Op. 6 No. 1', 2168: 'Prelude in E major, Op. 28 No. 9', 2190: 'Prelude in Ab major, Op. 28 No. 17', 2221: 'Prelude in D minor, Op. 28 No. 24', 2159: 'Prelude in G major, Op. 28 No. 3', 2160: 'Prelude in D major, Op. 28 No. 5',
  108: 'Turkish March (Rondo alla Turca)', 998: 'Sonata Facile, K. 545 - I', 1007: 'Sonata Facile, K. 545 - II', 1027: 'Sonata Facile, K. 545 - III', 356: 'Sonata in C minor, K. 457 - I', 1379: 'Sonata in C major, K. 309 - I',
  614: 'Sonata K. 331 - Theme', 2034: 'Fantasia in D minor, K. 397', 1770: 'Menuett in F, K. 2', 239: 'Gigue in G, K. 574', 446: 'Funeral March, K. 453a',
  931: 'Für Elise', 295: 'Pathétique Sonata - II (Adagio)', 299: 'Pathétique Sonata - I', 276: 'Moonlight Sonata - I', 1778: 'Clair de Lune', 1777: 'Arabesque No. 1',
  5: 'Prelude in C, BWV 846', 550: 'Prelude in C minor, BWV 847', 40: 'Invention No. 1', 61: 'Invention No. 8', 59: 'Invention No. 13',
  1054: 'Ave Maria', 1192: 'Impromptu in C minor, Op. 90 No. 1', 1193: 'Impromptu in Gb major, Op. 90 No. 3', 1551: 'Impromptu in Eb major, Op. 90 No. 2', 1647: 'Consolation No. 3', 2032: 'Morning Prayer', 896: 'Neapolitan Dance', 803: 'The Seasons: August', 1171: 'The Seasons: January',
  2033: 'Prelude in C# minor, Op. 3 No. 2', 1958: 'Prelude in F# minor, Op. 23 No. 1', 263: 'The Entertainer', 23: 'Maple Leaf Rag', 203: "L'Arabesque", 224: 'Consolation', 519: 'The Blue Danube (main theme)', 781: 'Wedding Day at Troldhaugen',
  794: 'Waltz in A♭, Op. 39 No. 15', 2164: 'Waltz Op. 39 No. 10', 1037: 'Lullaby (Wiegenlied)', 37: 'Gymnopédie No. 1', 38: 'Gymnopédie No. 2', 39: 'Gymnopédie No. 3', 2035: 'Gnossienne No. 1',
};
// performance tempo corrections where the source file's tempo marking is off (factor applied to every tempo)
const SCALE = { 108: 2, 1590: 0.8, 472: 0.8, 23: 0.8, 2035: 0.85, 471: 0.88, 468: 0.88, 37: 0.75, 38: 0.75, 39: 0.75, 2033: 0.9, 743: 0.92 };
const ERA = { Chopin: 'Romantic', Mozart: 'Classical', Beethoven: 'Classical', Debussy: 'Impressionist', Satie: 'Impressionist', Bach: 'Baroque', Schubert: 'Romantic', Liszt: 'Romantic', Tchaikovsky: 'Romantic', Rachmaninoff: 'Romantic', Joplin: 'Ragtime', Burgmüller: 'Romantic', Strauss: 'Romantic', Grieg: 'Romantic', Brahms: 'Romantic' };
const clean = (c) => c.replace(/\s*\(.*$/, '').replace(/^(?:[A-Z]\.\s*)+/, '').replace(/^F\.\s*/, '').trim();
fs.mkdirSync('library/midi', { recursive: true });
for (const f of fs.readdirSync('library/midi')) fs.unlinkSync('library/midi/' + f);
const out = [], report = [];
for (const p of picks) {
  const fn = (p.file || p.cid + '.mid'); const from = path.join(src, 'assets/midi', fn);
  if (!fs.existsSync(from)) { console.warn('missing', from); continue; }
  const buf = fs.readFileSync(from);
  let song; try { song = midiToSong(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), p.title); } catch (e) { console.warn('skip', p.cid, e.message); continue; }
  const sec = tempoClock(song).sec(0, song.length) / (SCALE[p.cid] || 1);
  const last = clean(p.composer).split(' ').pop(), composer = clean(p.composer);
  const id = 'lib-' + p.cid;
  fs.copyFileSync(from, `library/midi/${id}.mid`);
  out.push({ id, title: T[p.cid] || p.title, composer, era: ERA[last] || ERA[composer.split(' ').pop()] || '', level: p.level || 'Intermediate', cat: 'classical', file: `library/midi/${id}.mid`, bars: song.bars, sec: Math.round(sec), ...(SCALE[p.cid] ? { tempoScale: SCALE[p.cid] } : {}), notes: song.notes.length, license: p.license, mutopia: p.mutopia });
  report.push(`${p.cid}\t${p.level}\test:${song.est.label}\t${Math.round(sec)}s\t${song.notes.length}n\t${T[p.cid] || p.title}`);
}
out.sort((a, b) => a.composer.localeCompare(b.composer) || a.title.localeCompare(b.title));
fs.writeFileSync('library/index.json', JSON.stringify({ note: 'Generated by tools/build-library.mjs from Mutopia Project MIDI (public domain / CC).', songs: out }, null, 1));
console.log(report.join('\n')); console.log(out.length, 'songs', Math.round(fs.readdirSync('library/midi').reduce((a, f) => a + fs.statSync('library/midi/' + f).size, 0) / 1024) + ' KB');
