// PianoPlay - local progress store (localStorage, versioned, resilient to private-mode failures).
const KEY = 'pianoplay.v1';
const defaults = () => ({
  v: 1,
  settings: { input: 'touch', sound: true, labels: 'c', latency: 0, sensitivity: 0.5, window: 'normal', metronome: false, accompaniment: true, theme: 'aurora' },
  progress: { songs: {}, lessons: {}, drills: {}, handAcc: {} },
  stats: { days: {}, xp: 0, total: 0 },
  noteErrors: {},
  quiz: { best: {}, level: 0 },
  custom: [],
});
const mem = { s: null };
const ls = { get() { try { return localStorage.getItem(KEY); } catch { return mem.s; } }, set(v) { try { localStorage.setItem(KEY, v); } catch { mem.s = v; } } };
const merge = (a, b) => { for (const k in b) a[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) ? merge(a[k], b[k]) : b[k]; return a; };
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export class Store {
  constructor() {
    this.data = defaults(); this.listeners = new Set();
    try { const raw = ls.get(); if (raw) merge(this.data, JSON.parse(raw)); } catch { /* corrupt: start fresh */ }
  }
  save() { ls.set(JSON.stringify(this.data)); this.listeners.forEach((f) => f(this.data)); }
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  todayKey() { return dayKey(); }
  dayNumber() { return Math.floor(Date.now() / 86400000); }
  set(path, v) { const p = path.split('.'); let o = this.data; while (p.length > 1) o = o[p.shift()]; o[p[0]] = v; this.save(); }
  get settings() { return this.data.settings; }

  /** Record a practice time slice. */
  addTime(sec) {
    if (!(sec > 0)) return;
    const k = this.todayKey(); const d = (this.data.stats.days[k] ||= { sec: 0, xp: 0, plays: 0 });
    d.sec += sec; this.data.stats.total += sec; this.save();
  }
  addXp(n) { const d = (this.data.stats.days[this.todayKey()] ||= { sec: 0, xp: 0, plays: 0 }); d.xp += n; this.data.stats.xp += n; }
  streak() {
    let n = 0; const d = new Date();
    const has = (dt) => (this.data.stats.days[dayKey(dt)]?.sec || 0) >= 60;
    if (!has(d)) d.setDate(d.getDate() - 1);           // today not done yet - streak still alive from yesterday
    while (has(d)) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  weekMinutes() { const out = []; const d = new Date(); d.setDate(d.getDate() - 6); for (let i = 0; i < 7; i++) { out.push({ k: dayKey(d), dow: d.getDay(), min: Math.round((this.data.stats.days[dayKey(d)]?.sec || 0) / 60) }); d.setDate(d.getDate() + 1); } return out; }
  level() { const xp = this.data.stats.xp; let l = 1, need = 100, left = xp; while (left >= need) { left -= need; l++; need = Math.round(need * 1.35); } return { level: l, into: left, need }; }

  /** Estimate skill level from completed lessons and star counts. */
  skillLevel() {
    const done = Object.values(this.data.progress.lessons).filter((l) => l.done).length;
    const stars = Object.entries(this.data.progress.songs);
    const adv = stars.filter(([id, s]) => s.stars >= 2 && s.level === 'Advanced').length;
    const inter = stars.filter(([id, s]) => s.stars >= 2 && s.level === 'Intermediate').length;
    if (adv >= 2 || inter >= 6) return 'Advanced';
    if (done >= 12 || inter >= 1) return 'Intermediate';
    return 'Beginner';
  }

  /** Called when a session ends. result: {acc, hit, total, stars, hand, mistakes:{midi:count}} */
  recordSong(song, result) {
    const p = (this.data.progress.songs[song.id] ||= { plays: 0, best: 0, stars: 0, level: song.level, title: song.title });
    p.plays++; p.lastPlayed = Date.now(); p.level = song.level; p.title = song.title;
    p.best = Math.max(p.best, result.acc); p.stars = Math.max(p.stars, result.stars);
    const d = (this.data.stats.days[this.todayKey()] ||= { sec: 0, xp: 0, plays: 0 }); d.plays++;
    if (result.hand === 'R' || result.hand === 'L') { const h = (this.data.progress.handAcc[result.hand] ||= { sum: 0, n: 0 }); h.sum += result.acc; h.n++; }
    for (const [m, c] of Object.entries(result.mistakes || {})) this.data.noteErrors[m] = (this.data.noteErrors[m] || 0) + c;
    this.addXp(Math.round(10 + result.acc * 30 + result.stars * 10)); this.save();
  }
  completeLesson(id, acc, stars) {
    const l = (this.data.progress.lessons[id] ||= { done: false, best: 0, stars: 0 });
    const first = !l.done; l.done = true; l.best = Math.max(l.best, acc); l.stars = Math.max(l.stars, stars); l.at = Date.now();
    if (first) this.addXp(50); this.save(); return first;
  }
  recordQuiz(level, score, n) { const b = (this.data.quiz.best[level] ||= 0); this.data.quiz.best[level] = Math.max(b, score); this.addXp(score * 3); this.save(); }
  noteWrong(m) { this.data.noteErrors[m] = (this.data.noteErrors[m] || 0) + 1; }
  noteRight(m) { if (this.data.noteErrors[m] > 0) this.data.noteErrors[m] -= 0.5; }

  // custom (imported) songs
  addCustom(song) { const i = this.data.custom.findIndex((s) => s.id === song.id); const slim = JSON.parse(JSON.stringify(song)); if (i >= 0) this.data.custom[i] = slim; else this.data.custom.unshift(slim); this.save(); }
  removeCustom(id) { this.data.custom = this.data.custom.filter((s) => s.id !== id); this.save(); }

  exportJson() { return JSON.stringify(this.data); }
  importJson(txt) { const o = JSON.parse(txt); if (!o || o.v !== 1) throw new Error('Not a PianoPlay backup'); this.data = merge(defaults(), o); this.save(); }
  reset() { this.data = defaults(); this.save(); }
}
