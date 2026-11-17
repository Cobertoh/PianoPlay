// PianoPlay - Web MIDI input (keyboards) and Standard MIDI File import/export.
import { estimateDifficulty, barLength, tempoClock } from './music.js';

// ---------------------------------------------------------------- Web MIDI input
export class MidiInput {
  constructor() { this.access = null; this.cbs = { on: [], off: [], devices: [] }; this.names = []; }
  static get supported() { return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess; }
  async start() {
    if (!MidiInput.supported) throw new Error('Web MIDI is not supported in this browser (iPhone Safari does not support it).');
    this.access = await navigator.requestMIDIAccess();
    const attach = () => {
      this.names = [];
      for (const inp of this.access.inputs.values()) { this.names.push(inp.name); inp.onmidimessage = (e) => this._msg(e); }
      this.cbs.devices.forEach((f) => f(this.names));
    };
    this.access.onstatechange = attach;
    attach();
    return this.names;
  }
  on(ev, cb) { this.cbs[ev].push(cb); }
  _msg(e) {
    const [st, a, b] = e.data;
    const cmd = st & 0xf0;
    if (cmd === 0x90 && b > 0) this.cbs.on.forEach((f) => f(a, b / 127));
    else if (cmd === 0x80 || (cmd === 0x90 && b === 0)) this.cbs.off.forEach((f) => f(a));
  }
}

// ---------------------------------------------------------------- SMF reader
function readVarLen(d, p) { let v = 0, b; do { b = d[p.i++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; }
const u32 = (d, i) => ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0;
const u16 = (d, i) => (d[i] << 8) | d[i + 1];

/** Parse a Standard MIDI File -> {ppq, tracks:[{name, notes:[{tick,dur,m,v,ch}]}], tempos:[{tick,uspq}], ts, key} */
export function parseMidiFile(buffer) {
  const d = new Uint8Array(buffer);
  if (String.fromCharCode(d[0], d[1], d[2], d[3]) !== 'MThd') throw new Error('Not a MIDI file');
  const nTracks = u16(d, 10), ppq = u16(d, 12);
  if (ppq & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported');
  let pos = 8 + u32(d, 4);
  const out = { ppq, tracks: [], tempos: [], ts: [4, 4], key: 'C' };
  for (let t = 0; t < nTracks && pos < d.length; t++) {
    if (String.fromCharCode(d[pos], d[pos + 1], d[pos + 2], d[pos + 3]) !== 'MTrk') break;
    const len = u32(d, pos + 4), end = pos + 8 + len;
    const p = { i: pos + 8 };
    let tick = 0, run = 0, name = '';
    const open = new Map(), notes = [];
    while (p.i < end) {
      tick += readVarLen(d, p);
      let st = d[p.i];
      if (st < 0x80) st = run; else { p.i++; if (st < 0xf0) run = st; }
      if (st === 0xff) {
        const type = d[p.i++], l = readVarLen(d, p);
        if (type === 0x51 && l === 3) out.tempos.push({ tick, uspq: (d[p.i] << 16) | (d[p.i + 1] << 8) | d[p.i + 2] });
        else if (type === 0x58 && l >= 2 && tick === 0) out.ts = [d[p.i], 2 ** d[p.i + 1]];
        else if (type === 0x59 && l === 2 && tick === 0) {
          const sf = (d[p.i] << 24) >> 24, minor = d[p.i + 1];
          const maj = { '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#' };
          const min = { '-7': 'Abm', '-6': 'Ebm', '-5': 'Bbm', '-4': 'Fm', '-3': 'Cm', '-2': 'Gm', '-1': 'Dm', 0: 'Am', 1: 'Em', 2: 'Bm', 3: 'F#m', 4: 'C#m', 5: 'G#m', 6: 'D#m', 7: 'A#m' };
          out.key = (minor ? min : maj)[sf] || 'C';
        } else if (type === 0x03) name = String.fromCharCode(...d.slice(p.i, p.i + l));
        p.i += l;
      } else if (st === 0xf0 || st === 0xf7) { p.i += readVarLen(d, p); }
      else {
        const cmd = st & 0xf0, ch = st & 0x0f;
        if (cmd === 0xc0 || cmd === 0xd0) { p.i += 1; }
        else {
          const a = d[p.i++], b = d[p.i++];
          if (cmd === 0x90 && b > 0) { const k = ch * 128 + a; if (open.has(k)) { const o = open.get(k); notes.push({ tick: o.tick, dur: tick - o.tick, m: a, v: o.v, ch }); } open.set(k, { tick, v: b / 127 }); }
          else if (cmd === 0x80 || (cmd === 0x90 && b === 0)) { const k = ch * 128 + a; const o = open.get(k); if (o) { notes.push({ tick: o.tick, dur: Math.max(1, tick - o.tick), m: a, v: o.v, ch }); open.delete(k); } }
        }
      }
    }
    out.tracks.push({ name, notes: notes.filter((n) => n.ch !== 9) });
    pos = end;
  }
  out.tempos.sort((a, b) => a.tick - b.tick);
  return out;
}

/** MIDI file -> PianoPlay song definition (notes in beats; hands split by track or pitch). */
export function midiToSong(buffer, title = 'Imported MIDI') {
  const mf = parseMidiFile(buffer);
  const tracks = mf.tracks.filter((t) => t.notes.length);
  if (!tracks.length) throw new Error('This MIDI file has no notes');
  // tempo map (ticks -> beats of one quarter note), merging near-identical consecutive tempi
  const tempoMap = [];
  for (const t of (mf.tempos.length ? mf.tempos : [{ tick: 0, uspq: 500000 }])) {
    const bpm = 60000000 / t.uspq, beat = t.tick / mf.ppq, prev = tempoMap[tempoMap.length - 1];
    if (prev && Math.abs(prev.bpm - bpm) / prev.bpm < 0.01) continue;
    if (prev && Math.abs(prev.beat - beat) < 1e-6) { prev.bpm = bpm; continue; }
    tempoMap.push({ beat, bpm });
  }
  if (!tempoMap.length || tempoMap[0].beat > 0) tempoMap.unshift({ beat: 0, bpm: tempoMap[0]?.bpm || 120 });
  const tempo = Math.round(tempoMap[0].bpm);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const allMed = med(tracks.flatMap((t) => t.notes.map((n) => n.m)));
  const trackMed = tracks.map((t) => med(t.notes.map((n) => n.m)));
  const useTracks = tracks.length >= 2 && Math.max(...trackMed) - Math.min(...trackMed) > 10;
  // de-duplicate identical notes, then assign hands
  const seen = new Set(); const raw = [];
  tracks.forEach((t, ti) => t.notes.forEach((n) => { const k = n.tick + ':' + n.m; if (seen.has(k)) return; seen.add(k); raw.push({ ...n, track: ti }); }));
  const notes = raw.map((n) => {
    const h = useTracks ? (trackMed[n.track] >= allMed ? 'R' : 'L') : (n.m >= 60 ? 'R' : 'L');
    return { t: n.tick / mf.ppq, d: Math.max(n.dur / mf.ppq, 0.125), m: n.m, h, v: n.v };
  }).sort((a, b) => a.t - b.t || a.m - b.m);
  const len = Math.max(...notes.map((n) => n.t + n.d));
  notes.forEach((n, i) => (n.id = i));
  const song = { id: 'midi-' + Date.now(), title, composer: 'Imported MIDI', tempo: Math.min(Math.max(tempo, 20), 300), tempoMap: tempoMap.length > 1 ? tempoMap : undefined, ts: mf.ts, key: mf.key, notes, length: len, bars: Math.ceil(len / barLength(mf.ts)), custom: true, source: 'midi', warnings: [] };
  song.est = estimateDifficulty(song);
  song.level = song.est.label;
  return song;
}

// ---------------------------------------------------------------- SMF writer (export transcriptions)
export function songToMidi(song) {
  const ppq = 480;
  const ev = [];
  for (const n of song.notes) {
    ev.push({ tick: Math.round(n.t * ppq), type: 1, m: n.m, v: Math.round((n.v ?? 0.75) * 127) });
    ev.push({ tick: Math.round((n.t + n.d) * ppq), type: 0, m: n.m });
  }
  ev.sort((a, b) => a.tick - b.tick || a.type - b.type);
  const bytes = [];
  const vlq = (v) => { const out = [v & 0x7f]; while ((v >>= 7)) out.unshift((v & 0x7f) | 0x80); return out; };
  const us = Math.round(60000000 / song.tempo);
  const meta = [0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255];
  bytes.push(...meta);
  bytes.push(0, 0xff, 0x58, 4, song.ts[0], Math.log2(song.ts[1]), 24, 8);
  let last = 0;
  for (const e of ev) {
    bytes.push(...vlq(e.tick - last)); last = e.tick;
    bytes.push(e.type ? 0x90 : 0x80, e.m, e.type ? e.v : 0);
  }
  bytes.push(0, 0xff, 0x2f, 0);
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, ppq >> 8, ppq & 255];
  const len = bytes.length;
  const trk = [0x4d, 0x54, 0x72, 0x6b, (len >> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255];
  return new Uint8Array([...head, ...trk, ...bytes]);
}
