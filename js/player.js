// PianoPlay - the player screen: sheet music + falling notes + controls, wired to a Session.
import { Stage } from './stage.js';
import { SheetView } from './sheet.js';
import { Session } from './session.js';
import { levelBadge, ico, esc, $, $$, toast } from './ui.js';
import { fmtTime, tempoClock } from './music.js';
import { MidiInput } from './midi.js';

export class Player {
  /** ctx: {lesson, mode, hand, queue:[{title,song,mode,hand}], index, onClose(result)} */
  constructor(app, song, ctx = {}) {
    this.app = app; this.song = song; this.ctx = ctx; this.dead = false; app.player = this;
    const st = app.store.settings;
    const root = this.root = document.createElement('div');
    root.className = 'player';
    root.innerHTML = `
      <div class="p-top">
        <button class="iconbtn" data-a="back" aria-label="Close">${ico('back')}</button>
        <div class="p-title"><b>${esc(song.title)}</b><span data-r="level"></span></div>
        <button class="iconbtn" data-a="labels" aria-label="Key labels">${ico('label')}</button>
        <button class="iconbtn" data-a="input" aria-label="Input">${ico('mic')}</button>
      </div>
      <div class="p-sheet" id="p-sheet"></div>
      <div class="p-stage"><canvas></canvas>
        <div class="hud"><span class="pill" data-r="step" style="opacity:0"></span><span class="pill combo" data-r="combo" style="opacity:0"></span></div>
        <div class="hint" data-r="hint"></div>
      </div>
      <div class="p-controls">
        <div class="row">
          <div class="seg grow" data-g="mode"><button data-v="watch">Watch</button><button data-v="learn">Learn</button><button data-v="play">Play</button></div>
          <div class="seg hands grow" data-g="hand"><button class="l" data-v="L">Left</button><button data-v="both">Both</button><button class="r" data-v="R">Right</button></div>
        </div>
        <div class="speedrow"><span>Speed</span><input type="range" min="25" max="125" step="5" value="100" data-r="speed" aria-label="Speed"><b data-r="speedv">100%</b></div>
        <div class="transport">
          <button class="tbtn" data-a="restart" aria-label="Restart">${ico('restart')}</button>
          <button class="tbtn" data-a="loop" aria-label="Loop a section">${ico('loop')}</button>
          <button class="play-btn" data-a="play" aria-label="Play"><svg viewBox="0 0 24 24" data-r="playico"><path d="M7 4.5v15l13-7.5z"/></svg></button>
          <button class="tbtn" data-a="metro" aria-label="Metronome">${ico('metro')}</button>
          <button class="tbtn" data-a="sound" aria-label="Sound">${ico('vol')}</button>
        </div>
        <div class="row" style="justify-content:center;min-height:22px"><span class="loopchip" data-r="loopchip" style="display:none"></span><span class="small muted" data-r="time"></span></div>
      </div>`;
    document.body.appendChild(root);
    this.q = (s) => root.querySelector(s);
    $('[data-r=level]', root).innerHTML = levelBadge(song.level || 'Beginner') + (song.exact === false ? ' <span class="badge approx" title="A simplified approximation">approx.</span>' : '') + ' <span class="small muted" style="margin-left:4px">' + esc(ctx.sub || song.composer || '') + '</span>';
    this.stage = new Stage($('canvas', root), { labels: st.labels === 'all' ? 'all' : 'c', colorMode: st.colors || 'hands' });
    this.sheet = new SheetView($('#p-sheet', root), { onTap: (b, bar) => this.onSheetTap(b, bar), onPan: () => {} });
    this.stage.setSong(song);
    this.sheet.setSong(song, { hand: 'both' });
    this.session = new Session({ song, audio: app.audio, stage: this.stage, sheet: this.sheet, onEvent: (e) => this.onEvent(e) });
    this.stage.on('keyDown', (m, v) => { app.audio.resume(); this.session.press(m, v, 'touch'); });
    this.stage.on('keyUp', (m) => this.session.release(m));
    this.stage.on('tapStage', () => {});
    this.mode = ctx.mode || 'learn'; this.hand = ctx.hand || 'both';
    this.session.setMode(this.mode); this.session.setHand(this.hand);
    this.session.metronome = !!st.metronome;
    app.input.attach(this.session);
    app.input.onLevel = null;
    this.syncUI();
    this.bind();
    this.timeTimer = setInterval(() => { if (this.session.running) app.store.addTime(1); }, 1000);
    this.onResize = () => { this.stage.resize(); this.sheet.resize(); };
    window.addEventListener('resize', this.onResize);
    setTimeout(() => { this.stage.resize(); this.sheet.resize(); }, 30);
    this.showHint();
  }

  syncUI() {
    const st = this.app.store.settings;
    $$('[data-g=mode] button', this.root).forEach((b) => b.classList.toggle('on', b.dataset.v === this.mode));
    $$('[data-g=hand] button', this.root).forEach((b) => b.classList.toggle('on', b.dataset.v === this.hand));
    this.q('[data-a=metro]').classList.toggle('on', this.session.metronome);
    this.q('[data-a=sound]').innerHTML = ico(st.sound ? 'vol' : 'mute'); this.q('[data-a=sound]').classList.toggle('on', st.sound);
    this.q('[data-a=input]').classList.toggle('on', st.input !== 'touch');
    this.q('[data-a=input]').innerHTML = ico(st.input === 'mic' ? 'mic' : st.input === 'midi' ? 'music' : 'hand-r');
    this.q('[data-a=loop]').classList.toggle('on', !!(this.session.loop || this.picking));
    const chip = this.q('[data-r=loopchip]');
    if (this.session.loop) { const bl = this.session.bl; chip.style.display = ''; chip.innerHTML = `${ico('loop')} bars ${Math.round(this.session.loop.a / bl) + 1}–${Math.round(this.session.loop.b / bl)} <span style="margin-left:4px;opacity:.7">✕</span>`; }
    else chip.style.display = 'none';
    const dur = tempoClock(this.song).sec(0, this.song.length) / this.session.speed;
    this.q('[data-r=time]').textContent = `${this.song.bars} bars · ♩=${Math.round(this.song.tempo * this.session.speed)} · ${fmtTime(dur)}`;
  }
  showHint() {
    const h = this.q('[data-r=hint]'), s = this.session;
    if (s.running || s.finished) { h.classList.remove('show', 'count'); return; }
    const inp = this.app.store.settings.input;
    const t = this.mode === 'watch' ? 'Press play to listen' : this.mode === 'learn'
      ? (inp === 'mic' ? 'Press play, then play the glowing keys<br><small style="font-size:14px;opacity:.7">on your piano – I’m listening</small>' : 'Press play, then tap the glowing keys')
      : 'Flow mode – keep time with the falling notes';
    h.classList.remove('count'); h.innerHTML = t; h.classList.add('show');
  }

  bind() {
    const r = this.root, s = this.session, app = this.app;
    r.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-a],[data-v]'); if (!b) { if (e.target.closest('[data-r=loopchip]')) { s.setLoop(null); this.syncUI(); } return; }
      if (b.dataset.v) {
        const g = b.parentElement.dataset.g;
        if (g === 'mode') { this.mode = b.dataset.v; s.setMode(this.mode); }
        else { this.hand = b.dataset.v; s.setHand(this.hand); }
        this.syncUI(); this.showHint(); return;
      }
      const a = b.dataset.a;
      if (a === 'back') this.close();
      else if (a === 'play') await this.togglePlay();
      else if (a === 'restart') { s.pause(); s.reset(); this.setPlayIcon(false); this.showHint(); this.q('[data-r=combo]').style.opacity = 0; }
      else if (a === 'loop') {
        if (s.loop) { s.setLoop(null); this.picking = false; }
        else { this.picking = !this.picking; this.pickA = null; if (this.picking) toast('Tap the first bar on the sheet music, then the last bar'); }
        this.syncUI();
      } else if (a === 'metro') { s.metronome = !s.metronome; app.store.set('settings.metronome', s.metronome); this.syncUI(); }
      else if (a === 'sound') { const on = !app.store.settings.sound; app.store.set('settings.sound', on); app.input.apply(); this.syncUI(); }
      else if (a === 'labels') { const all = app.store.settings.labels !== 'all'; app.store.set('settings.labels', all ? 'all' : 'c'); this.stage.opts.labels = all ? 'all' : 'c'; this.stage.dirty = true; toast(all ? 'Showing all note names' : 'Showing C labels only'); }
      else if (a === 'input') { const order = MidiInput.supported ? ['touch', 'mic', 'midi'] : ['touch', 'mic']; const cur = app.store.settings.input; const nx = order[(order.indexOf(cur) + 1) % order.length]; s.pause(); this.setPlayIcon(false); app.store.set('settings.input', nx); app.input.stopMic(); await app.input.enable().catch(() => {}); toast(({ touch: 'Touch the on-screen keys', mic: 'Listening through the microphone', midi: 'MIDI keyboard' })[app.store.settings.input]); this.syncUI(); this.showHint(); }
    });
    this.q('[data-r=speed]').addEventListener('input', (e) => { s.setSpeed(+e.target.value / 100); this.q('[data-r=speedv]').textContent = e.target.value + '%'; this.syncUI(); });
    this._keyh = (e) => { if (e.code === 'Space' && !/input|select|button/i.test(e.target.tagName)) { e.preventDefault(); this.togglePlay(); } else if (e.key === 'Escape') this.close(); };
    window.addEventListener('keydown', this._keyh);
  }

  setPlayIcon(playing) { this.q('[data-r=playico]').innerHTML = playing ? '<path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z"/>' : '<path d="M7 4.5v15l13-7.5z"/>'; }
  async togglePlay() {
    const s = this.session;
    if (s.running) { s.pause(); return; }
    await this.app.input.enable();
    this.syncUI();
    this.q('[data-r=hint]').classList.remove('show');
    await s.start();
  }
  onSheetTap(beat, bar) {
    const s = this.session, bl = s.bl;
    if (this.picking) {
      if (this.pickA == null) { this.pickA = bar; toast(`Starts at bar ${bar + 1} – now tap the last bar`); return; }
      const a = Math.min(this.pickA, bar), b = Math.max(this.pickA, bar);
      s.setLoop(a * bl, Math.min(this.song.length, (b + 1) * bl)); s.seek(a * bl); this.picking = false; this.pickA = null; this.syncUI(); return;
    }
    s.seek(Math.max(0, bar * bl) - (this.mode === 'play' ? 0 : 0));
  }
  onEvent(e) {
    if (this.dead || !this.session) return;
    const s = this.session;
    if (e.type === 'state') { this.setPlayIcon(e.running); if (!e.running) this.showHint(); }
    else if (e.type === 'beat') {
      const hint = this.q('[data-r=hint]');
      if (s.running && e.beat < 0 && this.mode === 'play') { hint.textContent = Math.ceil(-e.beat); hint.classList.add('show', 'count'); }
      else if (s.running && hint.classList.contains('show')) { hint.classList.remove('show', 'count'); }
    } else if (e.type === 'combo') {
      const c = this.q('[data-r=combo]');
      if (e.combo >= 3) { c.textContent = `${e.combo} in a row`; c.style.opacity = 1; c.classList.add('pop'); setTimeout(() => c.classList.remove('pop'), 120); } else c.style.opacity = 0;
    } else if (e.type === 'step') {
      const p = this.q('[data-r=step]'); p.style.opacity = 1; p.textContent = `${e.index}/${e.of}`;
    } else if (e.type === 'finish') this.finish(e);
  }

  finish(e) {
    const app = this.app, song = this.song;
    this.setPlayIcon(false);
    if (e.mode === 'watch') { this.showHint(); return; }
    const s = this.session;
    // which notes gave trouble
    const mistakes = {};
    if (e.mode === 'learn') for (const st of s.steps) { if (st.mistakes > 0) for (const n of st.notes) mistakes[n.m] = (mistakes[n.m] || 0) + 1; }
    else for (const n of s.notes) if (s.res.get(n.id) === 'miss' || (!s.res.has(n.id) && s.isPracticed(n))) mistakes[n.m] = (mistakes[n.m] || 0) + 1;
    const acc = e.accuracy, stars = e.stars;
    const known = this.ctx.recordAs ?? song.id;
    app.store.recordSong({ id: known, title: song.title, level: song.level }, { acc, stars, hand: e.hand, mistakes });
    let lessonDone = false, passed = true;
    if (this.ctx.lesson) { const L = this.ctx.lesson; passed = acc >= (L.minAcc ?? 0.7); if (passed) { lessonDone = app.store.completeLesson(L.id, acc, stars); } }
    const q = this.ctx.queue, hasNext = q && this.ctx.index < q.length - 1;
    const msg = passed ? (stars === 3 ? 'Flawless!' : stars === 2 ? 'Great playing!' : stars === 1 ? 'Nice work!' : 'Keep going!') : 'Almost there – try again';
    const pct = Math.round(acc * 100), ms = Math.round(e.avgErrMs);
    const ov = document.createElement('div'); ov.className = 'overlay';
    ov.innerHTML = `<div class="sheetcard"><h2 style="font-size:26px">${msg}</h2>
      <div class="bigstars">${[0, 1, 2].map((i) => `<span class="${i < stars ? '' : 'off'}">★</span>`).join('')}</div>
      <div class="res-grid"><div><b>${pct}%</b><span>accuracy</span></div><div><b>${e.stats.best}</b><span>best streak</span></div><div><b>${e.mode === 'play' ? ms + ' ms' : e.stats.wrong}</b><span>${e.mode === 'play' ? 'avg. timing' : 'wrong notes'}</span></div></div>
      ${this.ctx.lesson ? `<p class="muted small" style="margin:-6px 0 14px">${lessonDone ? '🎉 Lesson complete! +50 XP' : passed ? 'Lesson passed' : `Reach ${Math.round((this.ctx.lesson.minAcc ?? .7) * 100)}% to complete this lesson`}</p>` : ''}
      <div class="row" style="justify-content:center;gap:10px;flex-wrap:wrap">
        <button class="btn ghost" data-o="again">${ico('refresh')} Again</button>
        ${hasNext && passed ? `<button class="btn" data-o="next">Next ${ico('chev')}</button>` : `<button class="btn" data-o="done">Done</button>`}
      </div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (ev) => {
      const o = ev.target.closest('[data-o]')?.dataset.o; if (!o) return;
      ov.remove();
      if (o === 'again') { s.reset(); this.showHint(); this.q('[data-r=combo]').style.opacity = 0; }
      else if (o === 'next') { this.destroy(); this.ctx.onNext?.(); }
      else this.close(true);
    });
  }
  close(done = false) { const cb = this.ctx.onClose; this.destroy(); cb?.(done); }
  destroy() {
    if (this.dead) return; this.dead = true;
    clearInterval(this.timeTimer); window.removeEventListener('resize', this.onResize); window.removeEventListener('keydown', this._keyh);
    this.session.destroy(); this.app.input.detach(); this.app.input.stopMic(); this.stage.destroy(); this.sheet.destroy(); this.root.remove();
    document.querySelectorAll('.overlay').forEach((o) => o.remove());
  }
}
