// PianoPlay - app shell: router, home / learn / library / progress / settings screens.
import { Store } from './store.js';
import { getAudio } from './audio.js';
import { InputManager } from './input.js';
import { buildLibrary, composerShort } from './songs.js';
import { midiToSong, MidiInput } from './midi.js';
import { LEVELS } from './music.js';
import { LESSONS, UNITS, recommend, warmupSet, drillSong, noteLabel } from './practice.js';
import { Player } from './player.js';
import { ico, esc, $, $$, toast, starsHtml, levelBadge } from './ui.js';
import { renderPractice, runQuiz } from './practice-view.js';
import { renderImport } from './import-view.js';

const store = new Store();
const app = { store, toast, audio: null, library: buildLibrary(), dropIns: [] };
app.audio = getAudio();
app.input = new InputManager(app);
window.app = app;                       // handy for debugging in the console

// ---------------------------------------------------------------- song helpers
app.allSongs = () => [...app.store.data.custom.map((s) => ({ ...s, custom: true })), ...app.library, ...app.dropIns];
app.findSong = (id) => app.allSongs().find((s) => s.id === id);
app.resolveSong = async (s) => {
  if (!s.stub) return s;
  const buf = await (await fetch(s.file)).arrayBuffer();
  const song = midiToSong(buf, s.title);
  Object.assign(song, { id: s.id, title: s.title, composer: s.composer || 'Library', era: s.era || '', level: s.level || song.level, cat: s.cat || 'classical', desc: s.desc || '', exact: true, stub: false });
  const i = app.dropIns.findIndex((d) => d.id === s.id); if (i >= 0) app.dropIns[i] = song;
  return song;
};
async function loadDropIns() {
  try {
    const r = await fetch('library/index.json', { cache: 'no-cache' }); if (!r.ok) return;
    const j = await r.json();
    app.dropIns = (j.songs || []).filter((s) => s.id && s.file && !app.library.some((x) => x.id === s.id)).map((s) => ({ ...s, stub: true, level: s.level || 'Intermediate', cat: s.cat || 'classical', composer: s.composer || 'Library', notes: [], bars: s.bars || 0 }));
    if (location.hash.startsWith('#/library')) route();
  } catch { /* offline or no drop-ins */ }
}

// ---------------------------------------------------------------- playing
app.play = async (song, ctx = {}) => {
  try { song = await app.resolveSong(song); } catch (e) { toast('Could not load that song: ' + e.message); return; }
  await app.audio.resume().catch(() => {});
  const back = ctx.onClose;
  new Player(app, song, { ...ctx, onClose: (d) => { back?.(d); route(); } });
};
app.playQueue = (items, index = 0, base = {}) => {
  const it = items[index]; if (!it) { route(); return; }
  app.play(it.song, { ...base, mode: it.mode, hand: it.hand, sub: `${base.label || 'Practice'} · ${index + 1} of ${items.length} – ${it.title}`, queue: items, index, recordAs: it.song.id, onNext: () => app.playQueue(items, index + 1, base) });
};
app.openLesson = (id) => {
  const L = LESSONS.find((l) => l.id === id); if (!L) return;
  const lessons = LESSONS;
  const next = () => { const i = lessons.findIndex((l) => l.id === id); const n = lessons[i + 1]; if (n) app.openLesson(n.id); else route(); };
  if (L.type === 'quiz') { runQuiz(app, { ...L.quiz, lesson: L, onClose: route, onNext: next }); return; }
  const song = L.song ? L.song() : app.findSong(L.songId);
  if (!song) { toast('Lesson song missing'); return; }
  const unit = UNITS.find((u) => u.id === L.unit);
  app.play(song, { mode: L.mode, hand: L.hand, lesson: L, recordAs: song.id, sub: `${unit.title} · ${L.title}`, queue: [1, 2], index: 0, onNext: next });
};
app.runAction = (a) => {
  if (a.type === 'warmup') { app.playQueue(warmupSet(store.skillLevel()), 0, { label: 'Daily warm-up' }); }
  else if (a.type === 'lesson') app.openLesson(a.id);
  else if (a.type === 'drill') app.play(drillSong(a.id), { mode: 'learn', hand: 'both', recordAs: 'drill-' + a.id });
  else if (a.type === 'quiz') runQuiz(app, { level: a.level, kind: a.kind, n: 10, weak: a.weak, onClose: route });
  else if (a.type === 'song') { const s = app.findSong(a.id); if (s) app.play(s, { mode: 'learn' }); }
};

// ---------------------------------------------------------------- router + shell
const TABS = [['home', 'Home', 'home'], ['learn', 'Learn', 'path'], ['library', 'Songs', 'library'], ['practice', 'Practice', 'practice'], ['import', 'Import', 'import']];
const shell = document.getElementById('app');
shell.innerHTML = `<div id="view-host" style="flex:1;display:flex;flex-direction:column;min-height:0"></div><nav class="tabbar" aria-label="Main">${TABS.map(([k, t, i]) => `<button data-t="${k}" aria-label="${t}">${ico(i)}<span>${t}</span></button>`).join('')}</nav>`;
const host = $('#view-host');
$('.tabbar').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) location.hash = '#/' + b.dataset.t; });
const VIEWS = { home: renderHome, learn: renderLearn, library: renderLibrary, practice: (r) => renderPractice(app, r), import: (r) => renderImport(app, r), progress: renderProgress, settings: renderSettings };
let lastScroll = {};
function route() {
  const name = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
  const key = VIEWS[name] ? name : 'home';
  const cur = host.querySelector('.view'); if (cur) lastScroll[host.dataset.k] = cur.scrollTop;
  host.dataset.k = key;
  host.innerHTML = '<div class="view"><div class="wrap"></div></div>';
  $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.t === key));
  VIEWS[key]($('.wrap', host));
  const v = $('.view', host); if (lastScroll[key]) v.scrollTop = lastScroll[key];
}
window.addEventListener('hashchange', route);
app.route = route;

// ---------------------------------------------------------------- home
function greeting() { const h = new Date().getHours(); return h < 5 ? 'Late-night session?' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
function renderHome(el) {
  const d = store.data, today = d.stats.days[store.todayKey()], mins = Math.round((today?.sec || 0) / 60), lv = store.level(), streak = store.streak();
  const recs = recommend(store, app.allSongs());
  const warm = recs.find((r) => r.id === 'warmup');
  const last = Object.entries(d.progress.songs).sort((a, b) => b[1].lastPlayed - a[1].lastPlayed)[0];
  const lastSong = last && app.findSong(last[0]);
  el.innerHTML = `
    <div class="head"><div><h1>PianoPlay</h1><div class="sub">${greeting()} 👋</div></div>
      <div class="row"><button class="iconbtn" data-go="progress" aria-label="Progress">${ico('progress')}</button><button class="iconbtn" data-go="settings" aria-label="Settings">${ico('settings')}</button></div></div>
    <div class="hero card">
      <div class="row small muted" style="margin-bottom:8px">${ico('flame', 'flame')}<span>${streak ? `${streak}-day streak` : 'Start your streak today'}</span></div>
      <h2>${warm ? 'Warm up your fingers' : 'Nice – keep the music going'}</h2>
      <p>${warm ? 'A quick 3–4 minute routine: finger shapes, a scale and a chord.' : `You've practised ${mins} min today. Pick something below or learn a new piece.`}</p>
      <button class="btn" data-act='{"type":"${warm ? 'warmup' : 'lesson'}","id":"${LESSONS.find((l) => !d.progress.lessons[l.id]?.done)?.id || ''}"}'>${ico('play')} ${warm ? 'Start warm-up' : 'Next lesson'}</button>
    </div>
    <div class="stats">
      <div class="stat"><b>${streak}</b><span>day streak</span></div>
      <div class="stat"><b>${mins}</b><span>min today</span></div>
      <div class="stat"><b>${lv.level}</b><span>level</span></div>
    </div>
    <div class="xp" style="margin:10px 2px 0"><i style="width:${Math.round(lv.into / lv.need * 100)}%"></i></div>
    <div class="section"><h2>For you</h2></div>
    ${recs.filter((r) => r.id !== 'warmup').map((r, i) => `<button class="item" data-act='${esc(JSON.stringify(r.action))}'><div class="ico ${['', 'warm', 'purple'][i % 3]}">${ico(r.icon)}</div><div class="grow"><h3>${esc(r.title)}</h3><p>${esc(r.sub)}</p></div><span class="chev">${ico('chev')}</span></button>`).join('') || '<div class="empty">Play a song to get personalised suggestions.</div>'}
    ${lastSong ? `<div class="section"><h2>Continue</h2></div><button class="item" data-act='${esc(JSON.stringify({ type: 'song', id: lastSong.id }))}'><div class="ico">${ico('music')}</div><div class="grow"><h3>${esc(lastSong.title)}</h3><p>${esc(lastSong.composer)}</p></div>${starsHtml(d.progress.songs[lastSong.id].stars)}</button>` : ''}
    <div class="section"><h2>Make it yours</h2></div>
    <button class="item" data-go="import"><div class="ico purple">${ico('import')}</div><div class="grow"><h3>Import a song</h3><p>Audio file, recording or MIDI → sheet music & lessons</p></div><span class="chev">${ico('chev')}</span></button>`;
  wireActions(el);
}
function wireActions(el) {
  el.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]'); if (g) { location.hash = '#/' + g.dataset.go; return; }
    const a = e.target.closest('[data-act]'); if (a) { try { app.runAction(JSON.parse(a.dataset.act)); } catch (x) { console.error(x); } }
  });
}

// ---------------------------------------------------------------- learn path
function renderLearn(el) {
  const d = store.data.progress.lessons; const next = LESSONS.find((l) => !d[l.id]?.done);
  const done = LESSONS.filter((l) => d[l.id]?.done).length;
  el.innerHTML = `<div class="head"><div><h1>Learn</h1><div class="sub">${done} of ${LESSONS.length} lessons complete</div></div></div>
    <div class="progressbar"><i style="width:${done / LESSONS.length * 100}%"></i></div>
    ${UNITS.map((u) => `<div class="unit"><h2>${esc(u.title)}</h2><p>${esc(u.blurb)}</p>
      ${LESSONS.filter((l) => l.unit === u.id).map((l) => { const s = d[l.id]; const cls = s?.done ? 'done' : l === next ? 'next' : ''; return `<button class="node ${cls}" data-act='{"type":"lesson","id":"${l.id}"}'><div class="dot">${s?.done ? ico('check') : l.type === 'quiz' ? ico('eye') : ico('play')}</div><div class="grow"><h3>${esc(l.title)}</h3><p>${esc(l.blurb)}</p></div>${s?.done ? starsHtml(s.stars) : l === next ? '<span class="badge Beginner">Next</span>' : ''}</button>`; }).join('')}</div>`).join('')}`;
  wireActions(el);
}

// ---------------------------------------------------------------- library
const libState = { q: '', level: 'All', cat: 'All', comp: 'All' };
function renderLibrary(el) {
  const all = app.allSongs();
  const comps = ['All', ...new Set(all.filter((s) => !s.custom).map((s) => composerShort(s.composer)))].sort((a, b) => (a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b)));
  el.innerHTML = `<div class="head"><div><h1>Songs</h1><div class="sub">${all.length} pieces · ${all.filter((s) => s.level === 'Beginner').length} for beginners</div></div></div>
    <div class="searchbox">${ico('search')}<input class="search" type="search" placeholder="Search title or composer" value="${esc(libState.q)}" autocomplete="off"></div>
    <div class="chips" data-f="level">${['All', ...LEVELS].map((l) => `<button class="chip ${libState.level === l ? 'on' : ''}" data-v="${l}">${l}</button>`).join('')}</div>
    <div class="chips" data-f="cat">${['All', 'Classical', 'Folk', 'Mine'].map((l) => `<button class="chip ${libState.cat === l ? 'on' : ''}" data-v="${l}">${l === 'Mine' ? 'My imports' : l}</button>`).join('')}<select class="sel" style="width:auto;height:34px;flex:none;border-radius:17px" data-f="comp">${comps.map((c) => `<option ${libState.comp === c ? 'selected' : ''}>${c === 'All' ? 'All composers' : c}</option>`).join('')}</select></div>
    <div id="lib-list" style="margin-top:8px"></div>
    <div class="note-box info small" style="margin-top:14px"><b>More songs:</b> import any MIDI file or audio on the Import tab, or drop MIDI files into <code>library/</code> in your repo (see README). Pieces marked “approx.” are simplified arrangements.</div>`;
  const list = $('#lib-list', el);
  const draw = () => {
    const q = libState.q.trim().toLowerCase();
    const catOk = (s) => libState.cat === 'All' || (libState.cat === 'Mine' ? !!s.custom : libState.cat === 'Folk' ? (s.cat === 'folk' && !s.custom) : (!s.custom && s.cat !== 'folk'));
    const rows = all.filter((s) => (libState.level === 'All' || s.level === libState.level) && catOk(s)
      && (libState.comp === 'All' || composerShort(s.composer) === libState.comp)
      && (!q || (s.title + ' ' + s.composer + ' ' + (s.desc || '')).toLowerCase().includes(q)));
    const order = { Beginner: 0, Intermediate: 1, Advanced: 2, Custom: 1 };
    rows.sort((a, b) => (b.custom ? 1 : 0) - (a.custom ? 1 : 0) || (order[a.level] ?? 1) - (order[b.level] ?? 1) || a.title.localeCompare(b.title));
    list.innerHTML = rows.map((s) => { const p = store.data.progress.songs[s.id]; return `<div class="item" data-id="${esc(s.id)}" role="button" tabindex="0"><div class="ico ${s.level === 'Advanced' ? 'purple' : s.level === 'Intermediate' ? 'warm' : ''}">${ico('music')}</div>
      <div class="grow"><h3>${esc(s.title)}</h3><p>${esc(s.composer)}${s.era && !s.custom ? ' · ' + esc(s.era) : ''}</p><div style="margin-top:5px">${levelBadge(s.level)} ${s.exact === false ? '<span class="badge approx">approx.</span>' : ''}</div></div>
      <div style="text-align:right">${p ? starsHtml(p.stars) : ''}${s.custom ? `<div><button class="small faint" data-del="${esc(s.id)}" aria-label="Delete">${ico('trash')}</button></div>` : ''}</div></div>`; }).join('') || '<div class="empty">No songs match.</div>';
  };
  draw();
  $('.search', el).addEventListener('input', (e) => { libState.q = e.target.value; draw(); });
  el.addEventListener('click', (e) => {
    const f = e.target.closest('.chips[data-f] .chip'); if (f) { libState[f.parentElement.dataset.f] = f.dataset.v; $$('.chip', f.parentElement).forEach((c) => c.classList.toggle('on', c === f)); draw(); return; }
    const del = e.target.closest('[data-del]'); if (del) { e.stopPropagation(); if (confirm('Delete this imported song?')) { store.removeCustom(del.dataset.del); route(); } return; }
    const it = e.target.closest('.item[data-id]'); if (it) { const s = app.findSong(it.dataset.id); if (s) app.play(s, { mode: 'learn' }); }
  });
  $('select[data-f=comp]', el).addEventListener('change', (e) => { libState.comp = e.target.value.startsWith('All') ? 'All' : e.target.value; draw(); });
}

// ---------------------------------------------------------------- progress
function renderProgress(el) {
  const d = store.data, lv = store.level(), week = store.weekMinutes(), mx = Math.max(10, ...week.map((w) => w.min));
  const songs = Object.entries(d.progress.songs).filter(([, s]) => s.plays).sort((a, b) => b[1].stars - a[1].stars || b[1].lastPlayed - a[1].lastPlayed);
  const errs = Object.entries(d.noteErrors).filter(([, c]) => c >= 1).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const lessons = LESSONS.filter((l) => d.progress.lessons[l.id]?.done).length;
  const ha = d.progress.handAcc;
  const pct = (h) => (ha[h]?.n ? Math.round(ha[h].sum / ha[h].n * 100) : null);
  el.innerHTML = `<div class="head"><div class="row"><button class="iconbtn" data-go="home" aria-label="Back">${ico('back')}</button><h1>Progress</h1></div></div>
    <div class="stats"><div class="stat"><b>${store.streak()}</b><span>day streak</span></div><div class="stat"><b>${Math.round(d.stats.total / 60)}</b><span>total min</span></div><div class="stat"><b>${lv.level}</b><span>level · ${d.stats.xp} XP</span></div></div>
    <div class="section"><h2>This week</h2></div>
    <div class="card"><div class="bars">${week.map((w, i) => `<div class="${i === 6 ? 'today' : ''}"><i style="height:${Math.max(4, w.min / mx * 78)}px"></i>${'SMTWTFS'[w.dow]}</div>`).join('')}</div><p class="small muted" style="margin:10px 0 0">Minutes of practice per day. A streak day needs at least a minute.</p></div>
    <div class="section"><h2>Skills</h2></div>
    <div class="card"><div class="setrow"><b>Current level</b><span>${levelBadge(store.skillLevel())}</span></div>
      <div class="setrow"><b>Lessons complete</b><span>${lessons} / ${LESSONS.length}</span></div>
      <div class="setrow"><b>Right-hand accuracy</b><span>${pct('R') == null ? '–' : pct('R') + '%'}</span></div>
      <div class="setrow"><b>Left-hand accuracy</b><span>${pct('L') == null ? '–' : pct('L') + '%'}</span></div></div>
    ${errs.length ? `<div class="section"><h2>Trouble spots</h2></div><div class="card"><div class="row wrapx">${errs.map(([m, c]) => `<span class="chip on" style="background:var(--grad-warm)">${noteLabel(+m, false)}${ico('', '')}</span>`).join('')}</div><p class="small muted" style="margin:10px 0 0">Notes you miss most. The note-reading drills target these.</p></div>` : ''}
    <div class="section"><h2>Songs played</h2></div>
    ${songs.length ? songs.slice(0, 20).map(([id, s]) => `<div class="item" style="cursor:default"><div class="ico">${ico('music')}</div><div class="grow"><h3>${esc(s.title || id)}</h3><p>${s.plays} play${s.plays > 1 ? 's' : ''} · best ${Math.round(s.best * 100)}%</p></div>${starsHtml(s.stars)}</div>`).join('') : '<div class="empty">Nothing yet – play your first song!</div>'}`;
  wireActions(el);
}

// ---------------------------------------------------------------- settings
function renderSettings(el) {
  const s = store.settings, midiOk = MidiInput.supported;
  const sw = (k, on) => `<button class="switch ${on ? 'on' : ''}" data-sw="${k}" role="switch" aria-checked="${!!on}"></button>`;
  const seg = (k, opts, cur) => `<div class="seg" data-seg="${k}">${opts.map(([v, t]) => `<button data-v="${v}" class="${cur === v ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  el.innerHTML = `<div class="head"><div class="row"><button class="iconbtn" data-go="home" aria-label="Back">${ico('back')}</button><h1>Settings</h1></div></div>
    <div class="section" style="margin-top:4px"><h2>Input</h2></div>
    <div class="card">
      <label class="l">How do you play?</label>${seg('input', [['touch', 'Touch keys'], ['mic', 'Microphone'], ...(midiOk ? [['midi', 'MIDI']] : [])], s.input)}
      <p class="small muted" style="margin:10px 2px 0">${s.input === 'mic' ? 'Play a real piano or keyboard near your phone – PianoPlay listens and checks each note. Works best in a quiet room with the phone near the keys.' : s.input === 'midi' ? 'Connect a USB/Bluetooth MIDI keyboard.' : 'Tap the on-screen keys. Switch to Microphone to play a real instrument.'}${midiOk ? '' : ' (MIDI input isn’t available on iPhone Safari.)'}</p>
      <div style="${s.input === 'mic' ? '' : 'display:none'}" id="mic-box">
        <div class="gap"></div><label class="l">Microphone sensitivity</label><input type="range" min="0" max="100" value="${Math.round(s.sensitivity * 100)}" data-rg="sensitivity">
        <label class="l" style="margin-top:8px">Timing offset (flow mode) <span id="latv">${Math.round((s.latency || 0) * 1000)} ms</span></label><input type="range" min="0" max="300" step="10" value="${Math.round((s.latency || 0) * 1000)}" data-rg="latency">
        <div class="row" style="margin-top:8px"><button class="btn sm ghost" id="calib">${ico('mic')} Calibrate &amp; test</button><div class="meter grow"><i id="lvl"></i></div></div>
        <p class="small faint" id="calmsg" style="margin:8px 2px 0">Calibrate in a quiet moment, then play a key – the bar should jump.</p>
      </div>
    </div>
    <div class="section"><h2>Playing</h2></div>
    <div class="card">
      <div class="setrow"><div><b>Piano sound</b><span class="d">Hear a note when you press a key</span></div>${sw('sound', s.sound)}</div>
      <div class="setrow"><div><b>Play the other hand</b><span class="d">When practising one hand, I play the other</span></div>${sw('accompaniment', s.accompaniment)}</div>
      <div class="setrow"><div><b>Metronome</b><span class="d">Click along in every song</span></div>${sw('metronome', s.metronome)}</div>
      <div class="gap"></div><label class="l">Flow-mode timing window</label>${seg('window', [['easy', 'Easy'], ['normal', 'Normal'], ['strict', 'Strict']], s.window)}
      <div class="gap"></div><label class="l">Key labels</label>${seg('labels', [['c', 'C only'], ['all', 'All notes']], s.labels)}
      <div class="gap"></div><label class="l">Note colours</label>${seg('colors', [['hands', 'By hand'], ['rainbow', 'Rainbow']], s.colors || 'hands')}
    </div>
    <div class="section"><h2>Install on iPhone</h2></div>
    <div class="card small muted">Open this page in <b style="color:#fff">Safari</b>, tap the <b style="color:#fff">Share</b> button, then <b style="color:#fff">Add to Home Screen</b>. PianoPlay then opens full-screen like an app and works offline.</div>
    <div class="section"><h2>Your data</h2></div>
    <div class="card"><div class="row wrapx"><button class="btn sm ghost" id="exp">Export backup</button><label class="btn sm ghost" style="cursor:pointer">Import backup<input type="file" id="imp" accept=".json,application/json" hidden></label><button class="btn sm ghost" id="rst" style="color:#ff8497">Reset progress</button></div>
      <p class="small faint" style="margin:10px 0 0">Progress and imported songs are stored on this device only.</p></div>
    <div class="section"><h2>About &amp; limits</h2></div>
    <div class="card small muted" style="line-height:1.6"><b style="color:#fff">PianoPlay</b> works fully offline with no accounts or paid services.<br>• Microphone note detection is most reliable between C3 and C7 and for one or two notes at a time. Dense chords and noisy rooms are harder.<br>• Audio → sheet-music transcription is approximate: best on solo piano or clean instrumentals, weaker on full mixes, fast runs and big chords. Always check the result.<br>• YouTube audio can’t be read by a web app, so YouTube links are for reference only – import the audio file or MIDI instead.<br>• Library pieces are simplified teaching arrangements; ones marked “approx.” may differ from the published score.</div>`;
  wireActions(el);
  el.addEventListener('click', async (e) => {
    const sw1 = e.target.closest('[data-sw]'); if (sw1) { const k = sw1.dataset.sw; store.set('settings.' + k, !store.settings[k]); sw1.classList.toggle('on'); return; }
    const sg = e.target.closest('[data-seg] button'); if (sg) { const k = sg.parentElement.dataset.seg; store.set('settings.' + k, sg.dataset.v); if (k === 'input') { app.input.stopMic(); route(); } else $$('button', sg.parentElement).forEach((b) => b.classList.toggle('on', b === sg)); return; }
    if (e.target.closest('#calib')) {
      const msg = $('#calmsg', el); msg.textContent = 'Listening… stay quiet for a moment.';
      try { await app.input.enable(); if (!app.input.mic?.running) return; app.input.onLevel = (v) => { $('#lvl', el) && ($('#lvl', el).style.width = Math.min(100, v * 900) + '%'); };
        const n = await app.input.mic.calibrate(1500); msg.textContent = n > 4 ? 'Quite a lot of background noise – try a quieter spot or lower sensitivity.' : 'Calibrated. Now play a key – the bar should jump.'; app.input.apply();
      } catch (x) { msg.textContent = 'Could not use the microphone: ' + x.message; }
    }
    if (e.target.closest('#exp')) { const { download } = await import('./ui.js'); download('pianoplay-backup.json', store.exportJson(), 'application/json'); }
    if (e.target.closest('#rst') && confirm('Reset all progress, settings and imported songs on this device?')) { store.reset(); route(); toast('Progress reset'); }
  });
  $$('[data-rg]', el).forEach((r) => r.addEventListener('input', () => { if (r.dataset.rg === 'latency') { store.data.settings.latency = +r.value / 1000; $('#latv', el).textContent = r.value + ' ms'; } else store.data.settings.sensitivity = +r.value / 100; store.save(); app.input.apply(); }));
  $('#imp', el)?.addEventListener('change', async (e) => { try { store.importJson(await e.target.files[0].text()); toast('Backup restored'); route(); } catch (x) { toast(x.message); } });
}

// ---------------------------------------------------------------- boot
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
route();
loadDropIns();
