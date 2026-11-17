// PianoPlay - import screen: audio file / microphone recording / MIDI / YouTube link -> playable song.
import { ico, esc, $, $$, toast, levelBadge, download } from './ui.js';
import { decodeToMono, analyzeAudio, framesToSong, DEFAULTS } from './transcribe.js';
import { analyzeForArrangement, arrangeSong, ARR_DEFAULTS } from './arrange.js';
import { midiToSong, songToMidi } from './midi.js';
import { midiToName, fmtTime } from './music.js';

const iv = { tab: 'audio', mode: 'arrange', samples: null, analysis: null, song: null, opts: { ...DEFAULTS }, aopts: { ...ARR_DEFAULTS }, name: '', level: 'Auto', customN: 5, busy: false, cancel: false, rec: null, yt: null, source: '' };

export function parseYouTube(url) {
  try {
    const u = new URL(url.trim().startsWith('http') ? url.trim() : 'https://' + url.trim());
    const h = u.hostname.replace(/^(www|m|music)\./, '');
    let id = null;
    if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else { const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{11})/); if (m) id = m[2]; }
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

function applyLevel(song) {
  if (iv.level === 'Auto') song.level = song.est.label;
  else if (iv.level === 'Custom') song.level = `Custom ${iv.customN}/10`;
  else song.level = iv.level;
  song.levelChoice = iv.level;
}
function regenerate() {
  if (!iv.analysis) return;
  if (iv.analysis.kind === 'arrange') { const song = arrangeSong(iv.analysis, iv.aopts, iv.name || 'Imported song'); applyLevel(song); iv.song = song; return; }
  const o = { ...iv.opts }; if (o.split == null) delete o.split; if (o.bpm == null) delete o.bpm;
  const song = framesToSong(iv.analysis, o, iv.name || 'Imported song');
  applyLevel(song); iv.song = song;
}

export function renderImport(app, el) {
  const draw = () => {
    el.innerHTML = `<div class="head"><div><h1>Import</h1><div class="sub">Turn any song into a lesson</div></div></div>
      <div class="seg" data-tabs>${[['audio', 'Audio'], ['record', 'Record'], ['midi', 'MIDI'], ['youtube', 'YouTube']].map(([k, t]) => `<button data-tab="${k}" class="${iv.tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="gap"></div><div id="tab"></div><div id="result"></div>`;
    drawTab(); drawResult();
  };
  const tabEl = () => $('#tab', el);
  const busyView = (msg, pct) => { tabEl().innerHTML = `<div class="card"><div class="row"><div class="spin"></div><div class="grow"><b>${esc(msg)}</b><div class="progressbar" style="margin:8px 0 0"><i id="pbar" style="width:${Math.round((pct || 0) * 100)}%"></i></div></div></div><div class="gap"></div><button class="btn sm ghost" id="cancel">Cancel</button></div>`; };

  async function process(buf, title, source) {
    iv.busy = true; iv.cancel = false; iv.song = null; iv.analysis = null; iv.name = title; iv.source = source;
    busyView('Decoding audio…', 0.02); drawResult();
    $('#cancel', el)?.addEventListener('click', () => { iv.cancel = true; });
    try {
      const { samples, sr, duration, truncated } = await decodeToMono(buf);
      if (duration < 1) throw new Error('That audio is too short.');
      iv.samples = { samples, sr };
      await analyse();
      if (!iv.song?.notes.length) { toast('No clear melody was found in that audio.'); }
      if (truncated) toast('Only the first 6 minutes were analysed.');
    } catch (e) {
      if (e.message !== 'cancelled') toast(e.message?.includes('decode') || e.name === 'EncodingError' ? 'Could not read that audio file. Try MP3, M4A or WAV.' : 'Import failed: ' + (e.message || e));
    }
    iv.busy = false; draw();
  }

  async function analyse() {
    const { samples, sr } = iv.samples;
    const prog = { onProgress: (p) => { const b = $('#pbar', el); if (b) b.style.width = Math.round(p * 100) + '%'; }, shouldCancel: () => iv.cancel };
    busyView(iv.mode === 'arrange' ? 'Finding the melody, beat and chords…' : 'Listening for every note…', 0.05);
    $('#cancel', el)?.addEventListener('click', () => { iv.cancel = true; });
    if (iv.mode === 'arrange') { iv.analysis = await analyzeForArrangement(samples, sr, prog); iv.aopts = { ...ARR_DEFAULTS }; }
    else { iv.analysis = await analyzeAudio(samples, sr, prog); iv.opts = { ...DEFAULTS }; }
    regenerate();
  }

  function drawTab() {
    const t = tabEl(); if (iv.busy) return;
    if (iv.tab === 'audio') {
      t.innerHTML = `<label class="drop" id="drop">${ico('upload')}<div style="font-weight:700;font-size:17px">Choose an audio file</div><div class="small muted" style="margin-top:4px">MP3 · M4A · WAV · OGG · FLAC – up to 6 minutes</div><input type="file" id="f-audio" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac" hidden></label>
        <div class="gap"></div><div class="note-box info small">PianoPlay listens for the <b>main melody</b> (what you’d hum), the <b>beat</b> and the <b>chords</b>, ignores drums and background talking, and writes a piano version: melody in the right hand, chords in the left, with pedal. Instrumentals work best. Everything runs on your phone – nothing is uploaded.</div>`;
      const f = $('#f-audio', t); f.addEventListener('change', async () => { const file = f.files[0]; if (file) process(await file.arrayBuffer(), file.name.replace(/\.[^.]+$/, ''), 'audio'); });
      const drop = $('#drop', t); ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); })); ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
      drop.addEventListener('drop', async (e) => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) process(await file.arrayBuffer(), file.name.replace(/\.[^.]+$/, ''), 'audio'); });
    } else if (iv.tab === 'record') {
      const supported = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
      t.innerHTML = `<div class="card" style="text-align:center"><div class="meter" style="margin:4px 0 14px"><i id="rlvl"></i></div>
        <button class="btn ${iv.rec ? 'warm' : ''} block" id="recbtn" ${supported ? '' : 'disabled'}>${ico('rec')} <span id="rectxt">${iv.rec ? 'Stop & analyse' : 'Start recording'}</span></button>
        <p class="small muted" style="margin:12px 0 0" id="rectime">${supported ? 'Play the song on a piano or keyboard (or a recording through a speaker) close to the phone.' : 'Recording isn’t supported in this browser – use an audio file instead.'}</p></div>
        <div class="gap"></div><div class="note-box small"><b>Tip:</b> a quiet room and one instrument give far better sheet music. Recording a speaker adds noise, so expect to tweak the settings afterwards.</div>`;
      $('#recbtn', t)?.addEventListener('click', () => (iv.rec ? stopRec() : startRec()));
    } else if (iv.tab === 'midi') {
      t.innerHTML = `<label class="drop">${ico('upload')}<div style="font-weight:700;font-size:17px">Choose a MIDI file</div><div class="small muted" style="margin-top:4px">.mid / .midi – the most accurate way to add a song</div><input type="file" id="f-midi" accept=".mid,.midi,audio/midi,audio/x-midi" hidden></label>
        <div class="gap"></div><div class="note-box info small">MIDI files contain the exact notes, so sheet music and lessons come out clean. Free MIDI versions of classical pieces are easy to find (for example on IMSLP or Mutopia).</div>`;
      $('#f-midi', t).addEventListener('change', async (e) => { const file = e.target.files[0]; if (!file) return; try { const s = midiToSong(await file.arrayBuffer(), file.name.replace(/\.[^.]+$/, '')); s.id = 'midi-' + Date.now(); iv.analysis = null; iv.name = s.title; iv.song = s; iv.source = 'midi'; iv.level = 'Auto'; applyLevel(s); drawResult(); } catch (x) { toast('Could not read MIDI: ' + x.message); } });
    } else {
      const id = iv.yt;
      t.innerHTML = `<div class="card"><label class="l">Paste a YouTube link</label><div class="row"><input class="fld grow" id="yturl" type="url" inputmode="url" placeholder="https://youtu.be/…" autocomplete="off" value="${id ? esc('https://youtu.be/' + id) : ''}"><button class="btn sm" id="ytgo">Check</button></div>
        ${id ? `<div class="gap"></div><iframe class="yt" src="https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0" title="Reference video" allow="encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe><p class="small muted" style="margin:8px 0 0">Reference player – use it to listen while you work from the sheet music you create below.</p>` : ''}</div>
        <div class="gap"></div><div class="note-box"><b>What a web app can and can’t do with YouTube.</b> Browsers don’t allow a page to read audio from YouTube, and YouTube’s terms don’t allow ripping it, so PianoPlay <b>can’t analyse a YouTube link directly</b> and it won’t pretend to. Instead:<br>• Import an <b>audio file</b> you have the rights to use, or a <b>MIDI</b> version of the piece.<br>• Or play the video out loud and use <b>Record</b> – works, but picks up noise, so results are rougher.</div>
        <div class="gap"></div><div class="row"><button class="btn ghost grow" data-goto="audio">${ico('upload')} Audio file</button><button class="btn ghost grow" data-goto="midi">${ico('music')} MIDI</button><button class="btn ghost grow" data-goto="record">${ico('mic')} Record</button></div>`;
      const go = () => { const v = $('#yturl', t).value; const i = parseYouTube(v); if (!i) { toast('That doesn’t look like a YouTube link.'); iv.yt = null; } else iv.yt = i; drawTab(); };
      $('#ytgo', t).addEventListener('click', go); $('#yturl', t).addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      $$('[data-goto]', t).forEach((b) => b.addEventListener('click', () => { iv.tab = b.dataset.goto; draw(); }));
    }
  }

  async function startRec() {
    try {
      await app.audio.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const rec = new MediaRecorder(stream), chunks = [];
      const ctx = app.audio.ctx, src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an); const buf = new Float32Array(1024);
      const t0 = performance.now();
      const timer = setInterval(() => { an.getFloatTimeDomainData(buf); let e = 0; for (const v of buf) e += v * v; const l = $('#rlvl', el); if (l) l.style.width = Math.min(100, Math.sqrt(e / 1024) * 600) + '%'; const tt = $('#rectime', el); if (tt) tt.textContent = 'Recording… ' + fmtTime((performance.now() - t0) / 1000); if (performance.now() - t0 > 6 * 60000) stopRec(); }, 80);
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      iv.rec = { rec, stream, chunks, timer, src };
      rec.onstop = async () => { clearInterval(timer); try { src.disconnect(); } catch {} stream.getTracks().forEach((t) => t.stop()); const blob = new Blob(chunks, { type: rec.mimeType || 'audio/mp4' }); iv.rec = null; if (blob.size < 2000) { toast('Nothing was recorded.'); drawTab(); return; } process(await blob.arrayBuffer(), 'My recording', 'record'); };
      rec.start(); drawTab();
    } catch (e) { toast(e.name === 'NotAllowedError' ? 'Microphone permission was denied.' : 'Could not start recording: ' + e.message); iv.rec = null; }
  }
  function stopRec() { try { iv.rec?.rec.stop(); } catch {} }

  function drawResult() {
    const r = $('#result', el); if (!r) return;
    const s = iv.song; if (!s || iv.busy) { r.innerHTML = ''; return; }
    const midi = iv.source === 'midi', arr = iv.analysis?.kind === 'arrange', o = iv.opts, ao = iv.aopts, info = s.analysisInfo || {};
    const sg = (k, opts, cur) => `<div class="seg" data-s="${k}">${opts.map(([v, t]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    const prog = (s.chordsInfo || []);
    const loop = (() => { // the most common 4-chord loop, for the learn panel
      const names = prog.map((c) => c.name); const cnt = new Map();
      for (let i = 0; i + 4 <= names.length; i++) { const k = names.slice(i, i + 4).join(' – '); cnt.set(k, (cnt.get(k) || 0) + 1); }
      let best = names.slice(0, 4).join(' – '), bc = 0; for (const [k, c] of cnt) if (c > bc) { bc = c; best = k; } return best;
    })();
    r.innerHTML = `<div class="section"><h2>Your piano version</h2></div>
      <div class="card"><input class="fld" id="ttl" value="${esc(iv.name)}" maxlength="60" aria-label="Title">
        <p class="small muted" style="margin:10px 2px 0">${s.tempo} BPM · key of ${esc(s.key)} · ${s.bars} bars · ${levelBadge(s.est.label)}</p>
        <div class="gap"></div>
        <div class="row"><button class="btn grow" id="listen">${ico('play')} Listen</button><button class="btn ghost grow" id="prac">${ico('music')} Learn it</button></div>
        <div class="row" style="margin-top:8px"><button class="btn sm ghost grow" id="save">${ico('check')} Save</button><button class="btn sm ghost grow" id="mid">${ico('download')} MIDI</button></div></div>
      ${arr ? `<div class="section"><h2>Make it sound right</h2></div><div class="card">
        <label class="l">Left hand</label>${sg('style', [['simple', 'Simple'], ['flow', 'Flowing'], ['full', 'Full']], ao.style)}
        <div class="gap"></div><label class="l">Melody</label>${sg('detail', [['simple', 'Fewer notes'], ['normal', 'Normal'], ['detailed', 'More detail']], ao.detail)}
        <div class="gap"></div><label class="l">Speed felt wrong? <span class="faint">(${s.tempo} BPM)</span></label>
        <div class="row"><button class="btn sm ghost grow" data-bpm="0.5">Half speed</button><button class="btn sm ghost grow" data-bpm="2">Double speed</button></div>
        <div class="gap"></div><label class="l">Melody octave</label><div class="row"><button class="btn sm ghost grow" data-oct="-1">Lower</button><button class="btn sm ghost grow" data-oct="1">Higher</button></div>
      </div>
      <div class="section"><h2>Learn it yourself</h2></div>
      <div class="card small" style="line-height:1.65">
        <b style="color:#fff">The chords:</b> ${prog.length ? esc(loop) : 'none found'}${prog.length > 4 ? ' <span class="faint">(the main loop)</span>' : ''}<br>
        1. <b>Right hand first.</b> Open <i>Learn it</i>, pick <i>Right</i> and play the melody at 60% speed. Hum it while you play.<br>
        2. <b>Left hand chords.</b> Switch to <i>Left</i>. Each chord is the root + fifth + third, broken up. Say the chord names out loud.<br>
        3. <b>Hands together, slowly.</b> Loop 2 bars at a time; the pedal goes down on every new chord.<br>
        4. <b>Speed up</b> by 10% each time you get three clean runs.<br>
        <span class="faint">Tip: most songs repeat one 4-chord loop. Learn that loop and you can play along with the original track.</span></div>` : ''}
      ${!arr && !midi ? `<div class="section"><h2>Tune the notes</h2></div><div class="card">
        <label class="l">Tempo <span id="bpmv">${s.tempo} BPM</span></label><div class="row"><button class="btn sm ghost" data-bpm="0.5">½×</button><input type="range" id="bpm" min="40" max="200" value="${s.tempo}" class="grow"><button class="btn sm ghost" data-bpm="2">2×</button></div>
        <label class="l" style="margin-top:8px">Note sensitivity <span id="sensv">${o.sens.toFixed(1)}×</span></label><input type="range" id="sens" min="0.5" max="2" step="0.1" value="${o.sens}">
        <label class="l" style="margin-top:8px">Max notes per hand <span id="maxv">${o.maxPerHand}</span></label><input type="range" id="maxp" min="1" max="6" value="${o.maxPerHand}">
      </div>` : ''}
      ${!midi && iv.samples ? `<div class="gap"></div><button class="btn sm ghost block" id="mode">${arr ? 'This is solo piano – transcribe every note instead' : 'Make a piano arrangement instead'}</button>` : ''}
      <div class="section"><h2>Difficulty</h2></div>
      <div class="card">${sg('level', [['Auto', 'Auto'], ['Beginner', 'Easy'], ['Intermediate', 'Medium'], ['Advanced', 'Hard']], iv.level)}</div>`;
    const redo = () => { try { regenerate(); } catch (x) { toast(x.message); } drawResult(); };
    let tm; const later = () => { clearTimeout(tm); tm = setTimeout(redo, 250); };
    $('#ttl', r).addEventListener('input', (e) => { iv.name = e.target.value; s.title = iv.name; });
    $('#bpm', r)?.addEventListener('input', (e) => { iv.opts.bpm = +e.target.value; $('#bpmv', r).textContent = e.target.value + ' BPM'; later(); });
    $$('[data-bpm]', r).forEach((b) => b.addEventListener('click', () => { const v = Math.max(40, Math.min(200, Math.round(s.tempo * +b.dataset.bpm))); if (arr) iv.aopts.bpm = v; else iv.opts.bpm = v; redo(); }));
    $$('[data-oct]', r).forEach((b) => b.addEventListener('click', () => { iv.aopts.octave = Math.max(-2, Math.min(2, iv.aopts.octave + +b.dataset.oct)); redo(); }));
    $('#sens', r)?.addEventListener('input', (e) => { iv.opts.sens = +e.target.value; $('#sensv', r).textContent = (+e.target.value).toFixed(1) + '×'; later(); });
    $('#maxp', r)?.addEventListener('input', (e) => { iv.opts.maxPerHand = +e.target.value; $('#maxv', r).textContent = e.target.value; later(); });
    $('#mode', r)?.addEventListener('click', async () => { iv.mode = arr ? 'exact' : 'arrange'; iv.busy = true; iv.cancel = false; drawResult(); try { await analyse(); } catch (x) { if (x.message !== 'cancelled') toast(x.message); } iv.busy = false; draw(); });
    r.onclick = (e) => {
      const sg1 = e.target.closest('[data-s] button'); if (!sg1) return;
      const k = sg1.parentElement.dataset.s, v = sg1.dataset.v;
      if (k === 'style' || k === 'detail') { iv.aopts[k] = v; redo(); }
      else if (k === 'level') { iv.level = v; applyLevel(s); drawResult(); }
    };
    const finalize = () => { s.title = (iv.name || 'My song').trim() || 'My song'; applyLevel(s); app.store.addCustom(s); };
    $('#save', r).addEventListener('click', () => { finalize(); toast('Saved to Songs → My imports'); });
    $('#listen', r).addEventListener('click', () => { finalize(); app.play(s, { mode: 'watch', onClose: () => app.route() }); });
    $('#prac', r).addEventListener('click', () => { if (!s.notes.length) { toast('There are no notes to practise yet.'); return; } finalize(); app.play(s, { mode: 'learn', onClose: () => app.route() }); });
    $('#mid', r).addEventListener('click', () => download((iv.name || 'song').replace(/[^\w-]+/g, '_') + '.mid', songToMidi(s), 'audio/midi'));
  }

  el.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b && !iv.busy) { iv.tab = b.dataset.tab; draw(); } });
  draw();
}
