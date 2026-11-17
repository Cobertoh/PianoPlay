// PianoPlay - the play/learn engine. Drives the stage, the sheet music and the audio, and judges
// what the player does in three modes:
//   watch : the song plays itself (demo)
//   learn : "wait mode" – notes fall and stop at the keyboard until you play them (Simply-Piano style)
//   play  : "flow mode" – everything keeps moving; hits and misses are scored by timing
import { stepsOf, barLength } from './music.js';

export const MODES = ['watch', 'learn', 'play'];

export class Session {
  constructor({ song, audio, stage, sheet, onEvent }) {
    this.song = song; this.audio = audio; this.stage = stage; this.sheet = sheet; this.emit = onEvent || (() => {});
    this.mode = 'learn';
    this.hand = 'both';
    this.speed = 1;
    this.loop = null;
    this.metronome = false;
    this.accompaniment = true;     // auto-play the hand you are not practising
    this.userSound = true;         // play a sound when you press a key
    this.latency = 0;              // seconds of input latency to compensate (mic ≈ 0.14)
    this.window = 0.3;             // judging window in seconds (play mode)
    this.mic = null;               // MicDetector when listening
    this.beat = 0; this.running = false;
    this.notes = song.notes;
    this.sorted = [...this.notes].sort((a, b) => a.t - b.t);
    this.bl = barLength(song.ts);
    this._tick = this._tick.bind(this);
    this.reset();
  }

  get bps() { return (this.song.tempo / 60) * this.speed; }
  get practiced() { return this.hand === 'both' ? this.notes : this.notes.filter((n) => (this.hand === 'R' ? n.h !== 'L' : n.h === 'L')); }
  isPracticed(n) { return this.hand === 'both' || (this.hand === 'R' ? n.h !== 'L' : n.h === 'L'); }

  // ------------------------------------------------------------ setup
  setMode(m) { this.mode = m; this.reset(true); }
  setHand(h) { this.hand = h; this.stage.setHand(h); this.sheet?.setHand(h); this.reset(true); }
  setSpeed(s) { this.speed = s; }
  setLoop(a, b) { this.loop = a == null ? null : { a, b }; this.sheet?.setLoop(a, b); }

  reset(keepPos = false) {
    this.stopAudio();
    const first = this.sorted.length ? this.sorted[0].t : 0;
    const lead = this.mode === 'play' ? this.bl : 2;
    const pos = keepPos && this._started ? this.beat : Math.min(0, first) - lead;
    this._setBeat(this.loop && keepPos ? Math.max(pos, this.loop.a) : pos);
    this._started = keepPos ? this._started : false;
    this.stats = { hits: 0, misses: 0, wrong: 0, combo: 0, best: 0, total: this.practiced.length, errMs: [], steps: 0, stepsClean: 0 };
    this.res = new Map();
    this.stage.clearMarks(); this.sheet?.clearMarks();
    this.steps = stepsOf(this.notes, this.hand).map((s) => ({ ...s, need: new Set(s.notes.map((n) => n.m)), got: new Set(), mistakes: 0, done: false }));
    this.stats.steps = this.steps.length;
    this.stepIdx = this.steps.findIndex((s) => s.t >= this.beat - 1e-6); if (this.stepIdx < 0) this.stepIdx = this.steps.length;
    this.waiting = false; this.armedAt = 0;
    this.stage.showSounding = this.mode === 'watch';
    this._syncPtr();
    this.stage.setTargets(null);
    this.finished = false;
    this._pushFrame();
  }
  _setBeat(b) { this.beat = b; this._pushFrame(); }
  _pushFrame() { this.stage.setBeat(this.beat); this.sheet?.setBeat(Math.max(0, this.beat)); this.emit({ type: 'beat', beat: this.beat }); }
  _syncPtr() { let i = 0; while (i < this.sorted.length && this.sorted[i].t < this.beat - 1e-6) i++; this.ptr = i; }

  // ------------------------------------------------------------ transport
  async start() {
    await this.audio.resume();
    if (this.finished) this.reset();
    this._started = true;
    this.running = true; this.stage.setPlaying(true);
    this.last = performance.now();
    this.lastClick = Math.floor(this.beat) - 1;
    cancelAnimationFrame(this._raf); this._raf = requestAnimationFrame(this._tick);
    this.emit({ type: 'state', running: true });
  }
  pause() {
    this.running = false; this.stage.setPlaying(false); cancelAnimationFrame(this._raf);
    this.stopAudio(); this.stage.setTargets(null);
    this.emit({ type: 'state', running: false });
  }
  toggle() { return this.running ? this.pause() : this.start(); }
  stopAudio() { this.audio.allOff(); }
  seek(beat) {
    const b = Math.max(-4, Math.min(this.song.length, beat));
    this.stopAudio();
    this._setBeat(b); this._syncPtr();
    this.steps.forEach((s) => { s.got.clear(); s.done = s.t < b - 1e-6; });
    this.stepIdx = this.steps.findIndex((s) => !s.done); if (this.stepIdx < 0) this.stepIdx = this.steps.length;
    this.waiting = false; this.lastClick = Math.floor(b) - 1;
    // clear marks of notes that lie ahead of the new position
    for (const n of this.notes) if (n.t >= b - 1e-6 && this.res.has(n.id)) { this.res.delete(n.id); this.stage.markNote(n.id, null); this.sheet?.mark(n.id, null); }
    this.stage.setTargets(null);
  }
  destroy() { this.running = false; cancelAnimationFrame(this._raf); this.stopAudio(); this.stage.setTargets(null); }

  // ------------------------------------------------------------ main loop
  _tick(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);
    const dt = Math.min(0.08, (now - this.last) / 1000); this.last = now;
    let next = this.beat;
    let blockAt = Infinity;
    // --- wait mode: clamp at the first unsatisfied step
    if (this.mode === 'learn') {
      while (this.stepIdx < this.steps.length && this.steps[this.stepIdx].done) this.stepIdx++;
      const st = this.steps[this.stepIdx];
      if (st) {
        blockAt = st.t;
        if (this.beat >= st.t - 1e-6 && !st.done) {
          next = st.t;
          if (!this.waiting) { this.waiting = true; this.armedAt = now; this._targets(st); }
        }
      }
    }
    if (!this.waiting || this.mode !== 'learn') next = this.beat + dt * this.bps;
    if (this.mode === 'learn' && next > blockAt) next = blockAt;
    // --- looping
    if (this.loop && next >= this.loop.b) {
      this.stopAudio();
      for (const n of this.notes) if (n.t >= this.loop.a - 1e-6 && n.t < this.loop.b) { this.res.delete(n.id); this.stage.markNote(n.id, null); this.sheet?.mark(n.id, null); }
      this.steps.forEach((s) => { if (s.t >= this.loop.a - 1e-6 && s.t < this.loop.b) { s.done = false; s.got.clear(); } });
      this.stepIdx = this.steps.findIndex((s) => s.t >= this.loop.a - 1e-6); if (this.stepIdx < 0) this.stepIdx = this.steps.length;
      next = this.loop.a; this.waiting = false; this._syncPtrAt(next); this.emit({ type: 'loop' });
    }
    this._schedule(next, blockAt);
    this._metro(next);
    this.beat = next;
    if (this.mode === 'play') this._expire();
    if (this.mic && this.mic.running) this._micJudge(now);
    this._pushFrame();
    // --- end
    if (this.beat >= this.song.length + (this.mode === 'play' ? 0.6 : 0.2) && !this.loop) this._finish();
  }
  _syncPtrAt(b) { let i = 0; while (i < this.sorted.length && this.sorted[i].t < b - 1e-6) i++; this.ptr = i; }

  _schedule(next, blockAt) {
    const bps = this.bps, ahead = 0.1 * bps;
    const limit = Math.min(next + ahead, this.mode === 'learn' ? blockAt + 1e-6 : Infinity);
    const spb = 1 / bps;
    while (this.ptr < this.sorted.length && this.sorted[this.ptr].t <= limit) {
      const n = this.sorted[this.ptr++];
      if (n.t < this.beat - 0.05 && n.t < next - 0.05) continue;
      const mine = this.isPracticed(n);
      if (this.mode === 'watch' || (!mine && this.accompaniment)) {
        const when = this.audio.now + Math.max(0, (n.t - this.beat) * spb);
        this.audio.play(n.m, Math.max(0.12, n.d * spb * 0.97), n.h === 'L' ? 0.62 : 0.78, when);
      }
    }
  }
  _metro(next) {
    if (!(this.metronome || (this.mode === 'play' && next < 0))) return;
    const bps = this.bps;
    for (let b = this.lastClick + 1; b <= Math.floor(next + 0.1 * bps); b++) {
      if (b < this.lastClick + 1) continue;
      const when = this.audio.now + Math.max(0, (b - this.beat) / bps);
      if (b >= -this.bl * 2) this.audio.click(when, b % Math.round(this.bl) === 0);
      this.lastClick = b;
    }
  }

  // ------------------------------------------------------------ judging
  _targets(st) {
    const m = new Map();
    for (const n of st.notes) if (!st.got.has(n.m)) m.set(n.m, n.h === 'L' ? 'L' : 'R');
    this.stage.setTargets(m);
  }
  /** a key went down (touch / MIDI / microphone). time = performance.now() of the actual event */
  press(m, vel = 0.75, source = 'touch', time = performance.now()) {
    const hand = m < 60 ? 'L' : 'R';
    if (this.userSound && source !== 'mic') this.voices = { ...(this.voices || {}), [m]: this.audio.noteOn(m, vel) };
    this.stage.press(m, true, hand);
    if (!this.running && this.mode !== 'watch') { this.emit({ type: 'idle-press', m }); return; }
    if (this.mode === 'learn') this._pressLearn(m, source, time);
    else if (this.mode === 'play') this._pressPlay(m, source, time);
  }
  release(m) {
    this.stage.release(m);
    const v = this.voices?.[m]; if (v) { v.release(); delete this.voices[m]; }
  }
  _pressLearn(m, source, time) {
    const st = this.steps[this.stepIdx]; if (!st) return;
    // accept presses a little before the step arrives, so playing slightly early still counts
    const early = 0.6;
    if (this.beat < st.t - early) { this._wrong(m, st, false); return; }
    if (st.need.has(m) && !st.got.has(m)) {
      st.got.add(m);
      this._ok(m, st.notes.find((n) => n.m === m));
      if (st.got.size >= st.need.size) this._completeStep(st);
      else this._targets(st);
    } else if (!st.need.has(m)) this._wrong(m, st, true);
  }
  _completeStep(st) {
    st.done = true; this.waiting = false;
    this.stats.steps = this.steps.length;
    if (st.mistakes === 0) this.stats.stepsClean++;
    this.stage.setTargets(null);
    this.stepIdx++;
    this.emit({ type: 'step', index: this.stepIdx, of: this.steps.length });
  }
  _pressPlay(m, source, time) {
    const lat = (source === 'mic' ? Math.max(this.latency, 0.1) : this.latency);
    const pressBeat = this.beat - ((performance.now() - time) / 1000 + lat) * this.bps;
    const win = (source === 'mic' ? Math.max(this.window, 0.45) : this.window) * this.bps;
    let best = null, bd = 1e9;
    for (const n of this.notes) {
      if (n.m !== m || this.res.has(n.id) || !this.isPracticed(n)) continue;
      const d = Math.abs(n.t - pressBeat);
      if (d <= win && d < bd) { best = n; bd = d; }
      if (n.t > pressBeat + win + 1) break;
    }
    if (best) { this._ok(m, best, (pressBeat - best.t) / this.bps * 1000); this.res.set(best.id, 'hit'); this.stage.markNote(best.id, 'hit'); this.sheet?.mark(best.id, 'hit'); this.stats.hits++; this._combo(true); }
    else this._wrong(m, null, true);
  }
  _expire() {
    const win = this.window * this.bps + 0.12;
    for (const n of this.notes) {
      if (n.t > this.beat) break;
      if (this.res.has(n.id) || !this.isPracticed(n)) continue;
      if (this.beat - n.t > win) { this.res.set(n.id, 'miss'); this.stage.markNote(n.id, 'miss'); this.sheet?.mark(n.id, 'miss'); this.stats.misses++; this._combo(false); }
    }
  }
  _micJudge(now) {
    const mic = this.mic;
    if (this.mode === 'learn') {
      const st = this.steps[this.stepIdx]; if (!st || !this.waiting && this.beat < st.t - 0.6) return;
      if (mic.lastOnset && mic.lastOnset >= (this.armedAt || 0) - 150) {
        const need = [...st.need].filter((m) => !st.got.has(m));
        if (!need.length) return;
        const sc = mic.targetScores(need);
        for (const m of need) if ((sc.get(m) || 0) >= mic.effThresh * 0.8) this._pressLearn(m, 'mic', mic.lastOnset);
      }
    } else if (this.mode === 'play') {
      if (mic.lastOnset && mic.lastOnset !== this._lastMicOnset && now - mic.lastOnset > 70) {
        this._lastMicOnset = mic.lastOnset;
        const win = Math.max(this.window, 0.45) * this.bps;
        const cands = this.notes.filter((n) => !this.res.has(n.id) && this.isPracticed(n) && Math.abs(n.t - (this.beat - (now - mic.lastOnset) / 1000 * this.bps)) <= win);
        if (cands.length) {
          const sc = mic.targetScores([...new Set(cands.map((n) => n.m))]);
          for (const m of sc.keys()) if (sc.get(m) >= mic.effThresh * 0.8) this._pressPlay(m, 'mic', mic.lastOnset);
        }
      }
    }
  }
  _ok(m, note, errMs) {
    this.stage.press(m, true, note?.h === 'L' ? 'L' : 'R', true);
    this.stage.burst(m, note?.h === 'L' ? 'L' : 'R', 14);
    if (this.mode === 'learn') { this.stats.hits++; this._combo(true); if (note) { this.res.set(note.id, 'hit'); this.stage.markNote(note.id, 'hit'); this.sheet?.mark(note.id, 'hit'); } }
    if (errMs != null) this.stats.errMs.push(errMs);
    this.emit({ type: 'ok', m, errMs });
  }
  _wrong(m, st, count) {
    this.stage.flash(m, 'bad'); this.stage.press(m, true, null, false);
    if (!count) return;
    this.stats.wrong++; if (st) st.mistakes++; this._combo(false);
    this.emit({ type: 'wrong', m });
  }
  _combo(ok) { const s = this.stats; if (ok) { s.combo++; s.best = Math.max(s.best, s.combo); } else s.combo = 0; this.emit({ type: 'combo', combo: s.combo }); }

  // ------------------------------------------------------------ results
  get accuracy() {
    const s = this.stats;
    if (this.mode === 'learn') return s.steps ? s.stepsClean / s.steps : 0;
    const n = s.hits + s.misses; return n ? s.hits / n : 0;
  }
  get stars() { const a = this.accuracy; return a >= 0.95 ? 3 : a >= 0.8 ? 2 : a >= 0.55 ? 1 : 0; }
  _finish() {
    if (this.finished) return;
    this.finished = true;
    this.pause();
    if (this.mode === 'play') for (const n of this.notes) if (this.isPracticed(n) && !this.res.has(n.id)) { this.stats.misses++; }
    const e = this.stats.errMs; const avg = e.length ? e.reduce((a, b) => a + Math.abs(b), 0) / e.length : 0;
    this.emit({ type: 'finish', mode: this.mode, hand: this.hand, accuracy: this.accuracy, stars: this.stars, stats: { ...this.stats }, avgErrMs: avg, speed: this.speed });
  }
}
