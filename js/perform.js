// PianoPlay - makes playback sound like a pianist rather than a sequencer:
//   • sustain pedal: the score's own pedal marks (MIDI CC64) when present, otherwise automatic
//     pedalling that changes with the harmony (bass changes) and at every bar
//   • dynamics: the score's velocities, with the melody voiced above the accompaniment and
//     gentle metric accents, plus a touch of human variation
//   • a small ritardando into the final bar and a last chord that is allowed to ring
import { barLength, tempoClock } from './music.js';

/** none = Baroque (finger legato only), light = Classical/ragtime/simple pieces, full = Romantic & arrangements */
export function pedalStyle(song) {
  if (song.pedalStyle) return song.pedalStyle;
  if (song.pedal) return 'full';
  const era = song.era || '';
  if (/Baroque/.test(era)) return 'none';
  if (/Classical|Ragtime|Folk/.test(era) || song.cat === 'folk') return 'light';
  return 'full';
}

/** Automatic pedalling: change at every bar and wherever the bass moves to a new pitch class on a beat. */
export function autoPedal(song) {
  const bl = barLength(song.ts), len = song.length;
  const unit = song.ts[1] === 8 && song.ts[0] % 3 === 0 ? 1.5 : 1;
  const pts = new Set();
  for (let b = 0; b < len; b += bl) pts.add(+b.toFixed(4));
  const low = new Map();
  for (const n of song.notes) {
    const k = Math.round(n.t / unit);
    if (Math.abs(n.t - k * unit) > 0.13 * unit) continue;          // only notes on (or very near) the beat
    const cur = low.get(k); if (!cur || n.m < cur.m) low.set(k, n);
  }
  let prev = null;
  for (const k of [...low.keys()].sort((a, b) => a - b)) {
    const n = low.get(k); if (n.m > 62) { prev = null; continue; }
    if (prev != null && n.m % 12 !== prev) pts.add(+(k * unit).toFixed(4));
    prev = n.m % 12;
  }
  const arr = [...pts].sort((a, b) => a - b); arr.push(len + 8);
  return arr.slice(0, -1).map((a, i) => [a + 0.03, arr[i + 1]]);    // pedal goes down just after the change (legato pedalling)
}

function findInterval(ped, b) {
  let lo = 0, hi = ped.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (ped[mid][0] <= b) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans >= 0 && b < ped[ans][1] ? ped[ans] : null;
}

/** Precompute per-note sound end (in beats, with pedal) and velocity. Cached on the song. */
export function preparePerformance(song) {
  if (song._perf && song._perf.end instanceof Map && song._perf.n === song.notes.length) return song._perf;
  const style = pedalStyle(song);
  const ped = style === 'none' ? [] : (song.pedal || autoPedal(song)).slice().sort((a, b) => a[0] - b[0]);
  const cap = style === 'light' && !song.pedal ? 0.5 : Infinity;
  const bl = barLength(song.ts), len = song.length;
  const groups = new Map();
  for (const n of song.notes) { const k = Math.round(n.t * 64); (groups.get(k) || groups.set(k, []).get(k)).push(n); }
  const top = new Set(), bass = new Set();
  for (const g of groups.values()) {
    const r = g.filter((n) => n.h !== 'L'), l = g.filter((n) => n.h === 'L');
    if (r.length) top.add(r.reduce((a, b) => (b.m > a.m ? b : a)));
    if (l.length) bass.add(l.reduce((a, b) => (b.m < a.m ? b : a)));
  }
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
  const vs = song.notes.map((n) => n.v).filter((v) => v != null);
  const flat = !vs.length || Math.max(...vs) - Math.min(...vs) < 0.02;
  const end = new Map(), vel = new Map();
  for (const n of song.notes) {
    const e0 = n.t + n.d;
    const iv = findInterval(ped, e0 - 1e-4);
    let e = iv ? Math.max(e0, Math.min(iv[1], e0 + cap)) : e0;
    if (e0 >= len - 0.01) e = Math.max(e, e0 + 1.5);              // let the final chord ring
    end.set(n.id, e);
    let v = n.vel ?? (flat ? 0.68 : 0.32 + 0.62 * n.v);
    if (n.vel == null) {
      if (top.has(n)) v += 0.08; else if (n.h !== 'L') v -= 0.05;
      else v += bass.has(n) ? -0.04 : -0.1;
      const inBar = ((n.t % bl) + bl) % bl;
      if (inBar < 0.02) v += 0.05; else if (Math.abs(inBar - Math.round(inBar)) < 0.02) v += 0.015;
      v += rnd() * 0.05;
    }
    vel.set(n.id, Math.max(0.18, Math.min(1, v)));
  }
  const perf = { n: song.notes.length, end, vel };
  Object.defineProperty(song, '_perf', { value: perf, enumerable: false, configurable: true, writable: true });   // not saved with the song
  return perf;
}

/** Tempo clock with a gentle ritardando over the last bar (unless the score already changes tempo there). */
export function performanceClock(song) {
  const bl = barLength(song.ts), len = song.length;
  const base = song.tempoMap?.length ? song.tempoMap.map((x) => ({ ...x })) : [{ beat: 0, bpm: song.tempo || 90 }];
  const startR = len - bl;
  if (len > bl * 4 && !base.some((x) => x.beat > startR - bl)) {
    const bpm0 = tempoClock({ ...song, tempoMap: base }).bpm(startR);
    for (let i = 0; i < 6; i++) base.push({ beat: startR + (bl * i) / 6, bpm: bpm0 * (1 - 0.045 * (i + 1)) });
  }
  return tempoClock({ ...song, tempoMap: base });
}
