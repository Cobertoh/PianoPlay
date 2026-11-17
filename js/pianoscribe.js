// PianoPlay - solo piano recording -> exact song. Notes come from Basic Pitch (js/basicpitch.js);
// here they get a beat grid that follows the player (tempo map from beat tracking, so rubato is kept),
// a time signature, hands, and dynamics. Playback uses the exact recorded timing (n.tx / n.dx);
// the sheet music uses the same notes quantised to the nearest 16th.
import { tempoOf, trackBeats } from './arrange.js';
import { buildSong } from './music.js';
import { detectKey } from './transcribe.js';

export function pianoNotesToSong(notes, duration, opts = {}, title = 'Piano recording') {
  if (!notes.length) throw new Error('No piano notes were found in this recording.');
  const fps = 100, n = Math.ceil(duration * fps) + 2;
  const env = new Float32Array(n), bassEnv = new Float32Array(n);
  const groups = new Map();
  for (const x of notes) { const f = Math.round(x.t0 * fps); env[f] += x.a; (groups.get(f) || groups.set(f, []).get(f)).push(x); }
  for (const [f, g] of groups) { const low = g.reduce((a, b) => (b.m < a.m ? b : a)); if (low.m < 60) bassEnv[f] += low.a + (low.t1 - low.t0) * 0.3; }
  const smooth = (a) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) for (let d = -2; d <= 2; d++) { const j = i + d; if (j >= 0 && j < a.length) o[i] += a[j] * [0.1, 0.2, 0.4, 0.2, 0.1][d + 2]; } return o; };
  const an = { flux: smooth(env), hopSec: 1 / fps, duration };
  const bpm = opts.bpm || tempoOf(an).bpm;
  const beats = trackBeats(an, bpm);
  // time signature + downbeat from the bass: the strongest low notes fall on beat 1
  const bAt = (i) => { const f = Math.round(beats[i] * fps); let s = 0; for (let d = -3; d <= 3; d++) s += bassEnv[f + d] || 0; return s; };
  let best = { meter: 4, off: 0, contrast: 0 };
  for (const meter of opts.ts ? [opts.ts[0]] : [4, 3]) {
    const sums = new Array(meter).fill(0); for (let i = 0; i < beats.length; i++) sums[i % meter] += bAt(i);
    const mean = sums.reduce((a, b) => a + b, 0) / meter, mx = Math.max(...sums), off = sums.indexOf(mx);
    const contrast = mean ? mx / mean : 1;
    if (contrast * (meter === 4 ? 1.12 : 1) > best.contrast) best = { meter, off, contrast: contrast * (meter === 4 ? 1.12 : 1) };
  }
  const ts = opts.ts || [best.meter, 4], bl = ts[0];
  const spb = 60 / bpm;
  const tToBeat = (t) => {
    if (t <= beats[0]) return (t - beats[0]) / spb;
    let lo = 0, hi = beats.length - 2;
    if (t >= beats[hi + 1]) return hi + 1 + (t - beats[hi + 1]) / spb;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (beats[mid] <= t) lo = mid; else hi = mid - 1; }
    return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo]);
  };
  const first = tToBeat(notes[0].t0);
  let start = best.off; while (start + bl <= first + 0.2) start += bl; while (start > first + 0.2) start -= bl;
  // tempo map that follows the player beat by beat (merged where it barely changes)
  const tempoMap = [];
  for (let i = 0; i + 1 < beats.length; i++) {
    const b = i - start; if (b < -1) continue;
    const v = 60 / (beats[i + 1] - beats[i]), prev = tempoMap[tempoMap.length - 1];
    if (prev && Math.abs(prev.bpm - v) / prev.bpm < 0.003) continue;
    tempoMap.push({ beat: Math.max(0, b), bpm: v });
  }
  if (!tempoMap.length || tempoMap[0].beat > 0) tempoMap.unshift({ beat: 0, bpm });
  // notes
  const ampMax = Math.max(...notes.map((x) => x.a));
  const raw = notes.map((x) => { const tx = tToBeat(x.t0) - start, ex = tToBeat(x.t1) - start; return { tx, dx: Math.max(0.05, ex - tx), m: x.m, vel: Math.min(1, 0.3 + 0.75 * Math.max(0, (x.a - 0.25) / Math.max(0.2, ampMax - 0.25))) }; }).filter((x) => x.tx > -0.5);
  // hands: split around the middle of what is being played in each two-bar stretch
  const win = bl * 2, splitAt = new Map();
  for (const x of raw) { const k = Math.floor(x.tx / win); (splitAt.get(k) || splitAt.set(k, []).get(k)).push(x.m); }
  for (const [k, ms] of splitAt) { ms.sort((a, b) => a - b); const lo = ms[0], hi = ms[ms.length - 1]; let s = hi - lo > 12 ? (lo + hi) / 2 : (ms[Math.floor(ms.length / 2)] >= 60 ? 48 : 72); splitAt.set(k, Math.max(50, Math.min(67, s))); }
  const out = raw.map((x) => {
    const t = Math.max(0, Math.round(x.tx * 4) / 4), d = Math.max(0.25, Math.round(x.dx * 4) / 4);
    return { t, d: Math.min(d, bl * 2), m: x.m, h: x.m >= (splitAt.get(Math.floor(x.tx / win)) ?? 60) ? 'R' : 'L', vel: x.vel, tx: Math.max(-0.4, x.tx), dx: x.dx };
  });
  // merge duplicates created by quantisation (same pitch, same slot)
  const seen = new Map(), notesOut = [];
  for (const x of out.sort((a, b) => a.t - b.t || a.m - b.m)) { const k = x.t + ':' + x.m; const p = seen.get(k); if (p) { p.d = Math.max(p.d, x.d); continue; } seen.set(k, x); notesOut.push(x); }
  const key = detectKey(notesOut.map((x) => ({ m: x.m, d: x.d })));
  const song = buildSong({ id: 'import-' + Date.now(), title, composer: 'Piano recording', era: 'Custom', cat: 'custom', custom: true, source: 'audio', key, tempo: Math.round(bpm), tempoMap: tempoMap.length > 1 ? tempoMap : undefined, ts, notes: notesOut, exact: true, pedalStyle: 'none',
    desc: 'Transcribed note-for-note from a piano recording. Playback follows the recording’s exact timing; the sheet music is rounded to the nearest 16th note.' });
  song.analysisInfo = { bpm: Math.round(bpm), notes: notesOut.length, key, meter: ts[0] };
  return song;
}

/**
 * Full songs: keep everything that is pitched (vocals, guitar, keys, bass) and drop what drums and
 * noise leave behind – short, quiet blips with no steady pitch behind them, kick-drum thumps, and
 * notes outside a sensible range. `an` is a harmonic (drum-free) spectrogram from analyzeForArrangement.
 */
export function filterSongNotes(notes, an, maxSim = 6) {
  const K = 85, LO = 24;
  const keep = notes.filter((n) => {
    const dur = n.t1 - n.t0;
    if (n.m < 28 || n.m > 100) return false;
    let s = 0, c = 0; const k = n.m - LO;
    for (let f = Math.floor(n.t0 / an.hopSec); f < Math.min(an.nF, Math.ceil(n.t1 / an.hopSec)); f++) { s += an.L[f * K + k]; c++; }
    const steady = c ? s / c : 0;
    if (steady < 0.3 && n.a < 0.6 && dur < 0.3) return false;     // a hit, not a note
    if (dur < 0.15 && n.a < 0.45) return false;                     // quiet blip
    if (n.m < 40 && dur < 0.2) return false;                        // kick drum thump
    return true;
  });
  // never more than maxSim notes at once – keep the loudest
  return keep.filter((n) => { const sim = keep.filter((b) => b.t0 <= n.t0 + 0.01 && b.t1 > n.t0 + 0.01); if (sim.length <= maxSim) return true; sim.sort((a, b) => b.a - a.a); return sim.indexOf(n) < maxSim; });
}

/**
 * Vocals / instruments split for stereo songs. Lead vocals are mixed in the centre; guitars, keys and
 * pads are spread left/right. For each note we compare its energy in the centre view (|mid| − |side|)
 * with the side view. Bass (below G3) always counts as an instrument.
 * parts: 'both' | 'vocals' | 'instruments'. Mono audio: returns notes unchanged.
 */
export function splitParts(notes, an, parts) {
  if (parts === 'both' || !an?.wide || !an.Hc) return notes;
  const K = 85, LO = 24;
  return notes.filter((n) => {
    let c = 0, s = 0; const k = n.m - LO;
    for (let f = Math.floor(n.t0 / an.hopSec); f < Math.min(an.nF, Math.ceil(n.t1 / an.hopSec)); f++) for (const kk of [k, k + 12]) { if (kk < 0 || kk >= K) continue; c += an.Hc[f * K + kk]; s += an.Hs[f * K + kk]; }
    const vocal = n.m >= 55 && c > s * 1.6;
    return parts === 'vocals' ? vocal : !vocal;
  });
}
