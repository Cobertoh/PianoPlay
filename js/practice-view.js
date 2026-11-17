// PianoPlay - practice hub (warm-ups, scales, chords, drills) and the note-reading / keyboard quizzes.
import { ico, esc, $, $$, toast, starsHtml } from './ui.js';
import { ROOTS, SCALE_TYPES, CHORD_KINDS, PROGRESSIONS, DRILLS, QUIZ_LEVELS, scaleSong, chordSong, progressionSong, drillSong, warmupSet, quizQuestion, noteLabel } from './practice.js';
import { miniStaffSvg } from './sheet.js';
import { isBlack, midiToName } from './music.js';

const pv = { scale: { root: 'C', type: 'major', hand: 'both', oct: 1 }, chord: { root: 'C', kind: 'major', style: 'block' }, prog: { root: 'C', name: 'I–IV–V–I' } };
const opt = (arr, cur, f = (x) => x) => arr.map((x) => `<option value="${esc(Array.isArray(x) ? x[0] : x)}" ${(Array.isArray(x) ? x[0] : x) === cur ? 'selected' : ''}>${esc(Array.isArray(x) ? x[1] : f(x))}</option>`).join('');

export function renderPractice(app, el) {
  const st = app.store, lvl = st.skillLevel();
  const q = pv;
  el.innerHTML = `<div class="head"><div><h1>Practice</h1><div class="sub">Train your hands, ears and eyes</div></div></div>
    <button class="hero card tap" data-w="warmup" style="width:100%;text-align:left"><div class="row small muted">${ico('flame', 'flame')}<span>${lvl} level</span></div><h2 style="font-size:22px;margin:6px 0 4px">Daily warm-up</h2><p style="margin:0 0 12px">${warmupSet(lvl).map((x) => x.title).join(' · ')}</p><span class="btn sm">${ico('play')} Start</span></button>

    <div class="section"><h2>Scales</h2></div>
    <div class="card"><div class="grid2"><div><label class="l">Key</label><select class="sel" data-p="scale.root">${opt(ROOTS, q.scale.root)}</select></div><div><label class="l">Scale</label><select class="sel" data-p="scale.type">${opt(Object.entries(SCALE_TYPES).map(([k, v]) => [k, v.name]), q.scale.type)}</select></div></div>
      <div class="gap"></div><div class="grid2"><div class="seg" data-pg="scale.hand">${[['L', 'Left'], ['both', 'Both'], ['R', 'Right']].map(([v, t]) => `<button data-v="${v}" class="${q.scale.hand === v ? 'on' : ''}">${t}</button>`).join('')}</div><div class="seg" data-pg="scale.oct">${[1, 2].map((v) => `<button data-v="${v}" class="${q.scale.oct == v ? 'on' : ''}">${v} octave${v > 1 ? 's' : ''}</button>`).join('')}</div></div>
      <div class="gap"></div><button class="btn block" data-w="scale">${ico('play')} Practice scale</button></div>

    <div class="section"><h2>Chords</h2></div>
    <div class="card"><div class="grid2"><div><label class="l">Root</label><select class="sel" data-p="chord.root">${opt(ROOTS, q.chord.root)}</select></div><div><label class="l">Chord</label><select class="sel" data-p="chord.kind">${opt(Object.entries(CHORD_KINDS).map(([k, v]) => [k, v.name]), q.chord.kind)}</select></div></div>
      <div class="gap"></div><div class="seg" data-pg="chord.style">${[['block', 'Block chords'], ['broken', 'Broken chords']].map(([v, t]) => `<button data-v="${v}" class="${q.chord.style === v ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="gap"></div><button class="btn block" data-w="chord">${ico('play')} Practice chord</button>
      <div class="gap"></div><div class="grid2"><div><label class="l">Progression</label><select class="sel" data-p="prog.name">${opt(Object.keys(PROGRESSIONS), q.prog.name)}</select></div><div><label class="l">Key</label><select class="sel" data-p="prog.root">${opt(['C', 'G', 'D', 'F', 'Bb', 'A'], q.prog.root)}</select></div></div>
      <div class="gap"></div><button class="btn block ghost" data-w="prog">${ico('play')} Practice progression</button></div>

    <div class="section"><h2>Hand drills</h2></div>
    ${Object.entries(DRILLS).map(([id, d]) => `<button class="item" data-w="drill" data-id="${id}"><div class="ico ${d.hand === 'L' ? 'purple' : d.hand === 'both' ? 'warm' : ''}">${ico(d.hand === 'L' ? 'hand-l' : d.hand === 'R' ? 'hand-r' : 'hand-r')}</div><div class="grow"><h3>${esc(d.title)}</h3><p>${esc(d.desc)}</p></div><span class="chev">${ico('chev')}</span></button>`).join('')}

    <div class="section"><h2>Note reading</h2></div>
    ${QUIZ_LEVELS.map((l, i) => `<button class="item" data-w="quiz" data-lv="${i}"><div class="ico">${ico('eye')}</div><div class="grow"><h3>${esc(l.name)}</h3><p>Match the written note to the right key · best ${st.data.quiz.best[i] ?? 0}/10</p></div><span class="chev">${ico('chev')}</span></button>`).join('')}
    <div class="section"><h2>Know your keyboard</h2></div>
    <button class="item" data-w="find"><div class="ico warm">${ico('keys')}</div><div class="grow"><h3>Find the key</h3><p>Hear a name, tap the key – learn the landmarks</p></div><span class="chev">${ico('chev')}</span></button>
    <button class="item" data-w="name"><div class="ico purple">${ico('keys')}</div><div class="grow"><h3>Name the key</h3><p>A key lights up – what is it called?</p></div><span class="chev">${ico('chev')}</span></button>`;
  el.addEventListener('change', (e) => { const p = e.target.dataset.p; if (p) { const [a, b] = p.split('.'); pv[a][b] = e.target.value; } });
  el.addEventListener('click', (e) => {
    const sg = e.target.closest('[data-pg] button'); if (sg) { const [a, b] = sg.parentElement.dataset.pg.split('.'); pv[a][b] = sg.dataset.v; $$('button', sg.parentElement).forEach((x) => x.classList.toggle('on', x === sg)); return; }
    const w = e.target.closest('[data-w]'); if (!w) return;
    const k = w.dataset.w, back = { onClose: () => app.route() };
    if (k === 'warmup') app.runAction({ type: 'warmup' });
    else if (k === 'scale') { const s = pv.scale; app.play(scaleSong(s.root, s.type, { hand: s.hand, octaves: +s.oct, tempo: 72 }), { mode: 'learn', hand: s.hand, ...back }); }
    else if (k === 'chord') { const c = pv.chord; app.play(chordSong(c.root, c.kind, c.style), { mode: 'learn', hand: 'both', ...back }); }
    else if (k === 'prog') app.play(progressionSong(pv.prog.root, pv.prog.name), { mode: 'learn', hand: 'both', ...back });
    else if (k === 'drill') { const d = DRILLS[w.dataset.id]; app.play(drillSong(w.dataset.id), { mode: 'learn', hand: d.hand, recordAs: 'drill-' + w.dataset.id, ...back }); }
    else if (k === 'quiz') runQuiz(app, { level: +w.dataset.lv, kind: 'staff', n: 10, onClose: () => app.route() });
    else if (k === 'find') runQuiz(app, { level: 0, kind: 'find', n: 10, onClose: () => app.route() });
    else if (k === 'name') runQuiz(app, { level: 2, kind: 'name', n: 10, onClose: () => app.route() });
  });
}

// ---------------------------------------------------------------- keyboard widget
function keysHtml(lo, hi, w = 40) {
  let wi = 0, h = ''; const cells = [];
  for (let m = lo; m <= hi; m++) if (!isBlack(m)) { cells.push(`<div class="qk" data-m="${m}" style="left:${wi * w}px;width:${w}px">${m % 12 === 0 ? 'C' + (m / 12 - 1) : ''}</div>`); wi++; }
  let wj = 0;
  for (let m = lo; m <= hi; m++) { if (!isBlack(m)) { wj++; continue; } cells.push(`<div class="qk b" data-m="${m}" style="left:${wj * w - w * 0.3}px;width:${w * 0.6}px"></div>`); }
  return `<div class="inner" style="width:${wi * w}px">${cells.join('')}</div>`;
}
const NAMES = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'];

export function runQuiz(app, o) {
  const st = app.store, L = QUIZ_LEVELS[Math.min(o.level ?? 0, QUIZ_LEVELS.length - 1)];
  const n = o.n || 10, kind = o.kind || 'staff';
  const root = document.createElement('div'); root.className = 'player';
  const title = kind === 'find' ? 'Find the key' : kind === 'name' ? 'Name the key' : 'Note reading';
  const kb = kind === 'name' ? [48, 83] : kind === 'find' ? [48, 83] : [L.lo - ((L.lo % 12)), L.hi - (L.hi % 12) + 11];
  root.innerHTML = `<div class="p-top"><button class="iconbtn" data-a="back" aria-label="Close">${ico('back')}</button><div class="p-title"><b>${esc(o.lesson ? o.lesson.title : title)}</b><span>${esc(L.name)}</span></div><span class="small muted" data-r="score"></span></div>
    <div style="padding:0 18px"><div class="progressbar"><i data-r="bar" style="width:0"></i></div></div>
    <div style="flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;padding:0 14px" data-r="body"></div>
    <div style="padding:10px 12px calc(var(--sab) + 18px)" data-r="input"></div>`;
  document.body.appendChild(root);
  root._q = () => cur;                 // test hook
  const body = $('[data-r=body]', root), inp = $('[data-r=input]', root);
  const mic = st.settings.input === 'mic';
  let i = 0, score = 0, cur = null, locked = false, qs = [];
  const weak = o.weak || []; let last = null;
  const makeQ = () => {
    if (kind === 'find') {
      if (i === 0) return { kind, midi: 60, prompt: 'Find <b>middle C</b>', sub: 'The C closest to the middle of the keyboard – left of the group of two black keys.', exact: true };
      let m; do { m = [60, 62, 64, 65, 67, 69, 71, 72, 48, 55][Math.floor(Math.random() * (i < 4 ? 7 : 10))]; } while (m === last);
      return { kind, midi: m, prompt: `Tap <b>${midiToName(m, false, false)}</b>`, sub: m === 72 ? 'The next C up' : m < 60 ? 'Below middle C' : 'Near middle C', exact: true };
    }
    if (kind === 'name') { let m; do { m = 48 + Math.floor(Math.random() * 36); } while (m === last || (isBlack(m) && i < 4)); return { kind, midi: m }; }
    return quizQuestion(o.level ?? 0, 'staff', last, weak);
  };
  const show = () => {
    cur = makeQ(); last = cur.midi; locked = false;
    $('[data-r=score]', root).textContent = `${score} ✓`; $('[data-r=bar]', root).style.width = (i / n * 100) + '%';
    if (kind === 'staff') body.innerHTML = `<div class="q-staff">${miniStaffSvg([cur.midi], { clef: cur.clef, key: cur.flats ? 'F' : 'C', width: 220 })}</div><div class="q-prompt" style="padding:6px 0 0;font-size:20px">${mic ? 'Play this note on your piano' : 'Tap this note on the keyboard'}</div>`;
    else if (kind === 'find') body.innerHTML = `<div class="q-prompt">${cur.prompt}<div class="small muted" style="font:400 14px var(--sans);margin-top:8px">${esc(cur.sub)}</div></div>`;
    else body.innerHTML = `<div class="q-prompt" style="padding-bottom:0">What is this key called?</div><div class="small muted" style="text-align:center;margin-top:6px">${cur.midi >= 60 ? 'Right' : 'Left'} of middle C · octave ${Math.floor(cur.midi / 12) - 1}</div>`;
    if (kind === 'name') {
      inp.innerHTML = `<div class="qkeys" style="height:120px;margin-bottom:12px">${keysHtml(kb[0], kb[1], 30)}</div><div class="grid2" style="grid-template-columns:repeat(${isBlack(cur.midi) || i >= 4 ? 4 : 7},1fr);gap:6px">${(isBlack(cur.midi) || i >= 4 ? NAMES : NAMES.filter((x, k) => !isBlack(k))).map((nm) => `<button class="chip" style="height:44px;border-radius:12px;padding:0" data-n="${NAMES.indexOf(nm)}">${nm}</button>`).join('')}</div>`;
      const el = $(`.qk[data-m="${cur.midi}"]`, inp); el.style.background = 'linear-gradient(#ffe9a8,#ffd36b)'; if (el.classList.contains('b')) el.style.background = '#ffb21f';
      const sc = $('.qkeys', inp); sc.scrollLeft = Math.max(0, parseInt(el.style.left) - sc.clientWidth / 2);
    } else {
      inp.innerHTML = `<div class="qkeys">${keysHtml(kb[0], kb[1], 42)}</div><div class="kbd-hint">Scroll the keyboard sideways for more keys</div>`;
      const sc = $('.qkeys', inp); sc.scrollLeft = Math.max(0, 7 * 42 * ((60 - kb[0]) / 12) * 1 - sc.clientWidth / 2 + 42 * 3);
    }
  };
  const feedback = (okk, pressed) => {
    if (locked) return; locked = true;
    if (okk) { score++; st.noteRight(cur.midi); } else st.noteWrong(cur.midi);
    const tgt = $(`.qk[data-m="${cur.midi}"]`, inp); if (tgt && kind !== 'name') tgt.classList.add(okk ? 'ok' : 'bad');
    if (!okk && tgt) { tgt.classList.remove('bad'); tgt.classList.add('ok'); }
    const pk = pressed != null && $(`.qk[data-m="${pressed}"]`, inp); if (pk && !okk) pk.classList.add('bad');
    if (kind === 'name') { $$('[data-n]', inp).forEach((b) => { if (+b.dataset.n === cur.midi % 12) b.classList.add('on'); }); }
    $('[data-r=score]', root).textContent = `${score} ✓`;
    setTimeout(() => { i++; if (i >= n) end(); else show(); }, okk ? 550 : 1100);
  };
  const answer = (m, src) => {
    if (locked) return;
    app.audio.play(m, 0.6, 0.7);
    const okk = (src === 'mic' || kind === 'find' && !cur.exact) ? (m % 12 === cur.midi % 12) : (m === cur.midi);
    feedback(okk, m);
  };
  const end = () => {
    st.recordQuiz(o.level ?? 0, score, n);
    const acc = score / n, stars = acc >= 0.95 ? 3 : acc >= 0.8 ? 2 : acc >= 0.55 ? 1 : 0;
    let passed = true, first = false;
    if (o.lesson) { passed = acc >= 0.7; if (passed) first = st.completeLesson(o.lesson.id, acc, stars); }
    const ov = document.createElement('div'); ov.className = 'overlay';
    ov.innerHTML = `<div class="sheetcard"><h2 style="font-size:26px">${stars === 3 ? 'Perfect!' : stars >= 2 ? 'Great job!' : stars === 1 ? 'Getting there' : 'Keep practising'}</h2><div class="bigstars">${[0, 1, 2].map((k) => `<span class="${k < stars ? '' : 'off'}">★</span>`).join('')}</div>
      <p style="font:600 22px var(--serif);margin:4px 0 14px">${score} / ${n}</p>${o.lesson ? `<p class="muted small" style="margin:-6px 0 14px">${first ? '🎉 Lesson complete! +50 XP' : passed ? 'Lesson passed' : 'Get 70% to complete this lesson'}</p>` : ''}
      <div class="row" style="justify-content:center;gap:10px"><button class="btn ghost" data-o="again">${ico('refresh')} Again</button>${o.lesson && passed && o.onNext ? `<button class="btn" data-o="next">Next ${ico('chev')}</button>` : '<button class="btn" data-o="done">Done</button>'}</div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { const a = e.target.closest('[data-o]')?.dataset.o; if (!a) return; ov.remove(); if (a === 'again') { i = 0; score = 0; last = null; show(); } else if (a === 'next') { close(false); o.onNext(); } else close(true); });
  };
  const close = (cb = true) => { app.input.detach(); app.input.stopMic(); root.remove(); document.querySelectorAll('.overlay').forEach((x) => x.remove()); if (cb) o.onClose?.(); };
  root.addEventListener('click', (e) => { if (e.target.closest('[data-a=back]')) { close(true); return; } const n1 = e.target.closest('[data-n]'); if (n1 && !locked) { app.audio.play(cur.midi, 0.6, 0.7); feedback(+n1.dataset.n === cur.midi % 12, null); } });
  // key taps use click so that scrolling the keyboard sideways doesn't count as an answer
  root.addEventListener('click', (e) => { const k = e.target.closest('.qk'); if (k && kind !== 'name') { app.audio.resume(); answer(+k.dataset.m, 'touch'); } });
  app.input.attach({ mode: 'quiz', press: (m, v, src) => answer(m, src), release() {} });
  if (mic) app.input.enable().catch(() => {});
  show();
}
