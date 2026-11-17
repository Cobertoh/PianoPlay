// PianoPlay - import screen: audio file / microphone recording / MIDI / YouTube link -> playable song.
import { ico, esc, $, $$, toast, levelBadge, download } from './ui.js';
import { decodeToMono, analyzeAudio, framesToSong, DEFAULTS } from './transcribe.js';
import { analyzeForArrangement, arrangeSong, ARR_DEFAULTS } from './arrange.js';
import { transcribeActivations, activationsToNotes, cleanNotes } from './basicpitch.js';
import { pianoNotesToSong, filterSongNotes } from './pianoscribe.js';
const PIANO_DETAIL = { fewer: { onsetThresh: 0.7, frameThresh: 0.35 }, normal: { onsetThresh: 0.6, frameThresh: 0.3 }, more: { onsetThresh: 0.45, frameThresh: 0.25 } };
const savedKind = (() => { try { return localStorage.getItem('pp-import-kind'); } catch { return null; } })();
import { midiToSong, songToMidi } from './midi.js';
import { midiToName, fmtTime } from './music.js';

const iv = { tab: 'audio', kind: savedKind || 'piano', popts: { detail: 'normal', bpm: null, ts: null }, mode: 'arrange', samples: null, analysis: null, song: null, opts: { ...DEFAULTS }, aopts: { ...ARR_DEFAULTS }, name: '', level: 'Auto', customN: 5, busy: false, cancel: false, rec: null, yt: null, source: '' };

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
  if (iv.analysis.kind === 'piano' || iv.analysis.kind === 'song') {
    const a = iv.analysis; let notes = cleanNotes(activationsToNotes(a.act, { ...PIANO_DETAIL.normal, minNoteLen: 6 }));
    if (a.kind === 'song') notes = filterSongNotes(notes, a.harm);
    const song = pianoNotesToSong(notes, a.duration, {}, iv.name || 'Imported song');
    if (a.kind === 'song') { song.composer = 'From a song'; song.desc = 'Every pitched part of the recording (vocals, guitar, keys, bass) played on piano; drums and noise are left out.'; }
    applyLevel(song); iv.song = song; iv.saved = false; return;
  }
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
      const { samples, left, right, sr, duration, truncated } = await decodeToMono(buf);
      if (duration < 1) throw new Error('That audio is too short.');
      iv.samples = { samples, left, right, sr };
      await analyse();
      if (!iv.song?.notes.length) { toast('No clear melody was found in that audio.'); }
      if (truncated) toast('Only the first 6 minutes were analysed.');
    } catch (e) {
      if (e.message !== 'cancelled') toast(e.message?.includes('decode') || e.name === 'EncodingError' ? 'Could not read that audio file. Try MP3, M4A or WAV.' : 'Import failed: ' + (e.message || e));
    }
    iv.busy = false; draw();
  }

  async function analyse() {
    const { samples, left, right, sr } = iv.samples;
    const prog = { onProgress: (p) => { const b = $('#pbar', el); if (b) b.style.width = Math.round(p * 100) + '%'; }, shouldCancel: () => iv.cancel };
    busyView('Listening to every note (this takes a little while)…', 0.03);
    $('#cancel', el)?.addEventListener('click', () => { iv.cancel = true; });
    const song = iv.kind === 'song';
    const harm = song ? await analyzeForArrangement(samples, sr, { onProgress: (p) => prog.onProgress(p * 0.15), shouldCancel: prog.shouldCancel }) : null;
    const workers = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    const act = await transcribeActivations(samples, { onProgress: (p) => prog.onProgress((song ? 0.15 : 0) + p * (song ? 0.85 : 1)), shouldCancel: prog.shouldCancel, workers, workerUrl: new URL('./bp-worker.js', import.meta.url) });
    iv.analysis = { kind: iv.kind, act, harm, duration: samples.length / sr };
    regenerate();
  }

  function drawTab() {
    const t = tabEl(); if (iv.busy) return;
    if (iv.tab === 'audio') {
      t.innerHTML = `<label class="l">What are you importing?</label><div class="seg" data-kind>${[['piano', 'Piano recording'], ['song', 'Any song']].map(([k, l]) => `<button data-k="${k}" class="${iv.kind === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <p class="small faint" style="margin:6px 2px 12px">${iv.kind === 'piano' ? 'Solo piano: every note is transcribed exactly as played – both hands, timing and dynamics.' : 'Songs with vocals, guitar, drums…: the vocals, guitar, keys and bass are played on piano; drums and noise are left out.'}</p>
        <label class="drop" id="drop">${ico('upload')}<div style="font-weight:700;font-size:17px">Choose an audio file</div><div class="small muted" style="margin-top:4px">MP3 · M4A · WAV · OGG · FLAC – up to 6 minutes</div><input type="file" id="f-audio" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac" hidden></label>
        <div class="gap"></div>${iv.kind === 'piano' ? `<div class="note-box info small">Uses a neural note-recognition model (Spotify’s open-source Basic Pitch) running on your phone. A 3-minute recording takes roughly a minute. Nothing is uploaded.</div>` : `<div class="note-box info small">Uses the same note-recognition model as piano recordings (Spotify’s open-source Basic Pitch) on your phone, then filters out drums and noise. A 3-minute song takes about a minute. Nothing is uploaded.</div>`}`;
      $$('[data-kind] button', t).forEach((b) => b.addEventListener('click', () => { iv.kind = b.dataset.k; try { localStorage.setItem('pp-import-kind', iv.kind); } catch {} drawTab(); }));
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
      $('#f-midi', t).addEventListener('change', async (e) => { const file = e.target.files[0]; if (!file) return; try { const s = midiToSong(await file.arrayBuffer(), file.name.replace(/\.[^.]+$/, '')); s.id = 'midi-' + Date.now(); iv.analysis = null; iv.samples = null; iv.saved = false; iv.name = s.title; iv.song = s; iv.source = 'midi'; iv.level = 'Auto'; applyLevel(s); drawResult(); } catch (x) { toast('Could not read MIDI: ' + x.message); } });
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
    const midi = iv.source === 'midi';
    const sg = (k, opts, cur) => `<div class="seg" data-s="${k}">${opts.map(([v, t]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    r.innerHTML = `<div class="section"><h2>Your song</h2></div>
      <div class="card"><input class="fld" id="ttl" value="${esc(iv.name)}" maxlength="60" aria-label="Title">
        <p class="small muted" style="margin:10px 2px 0">${s.notes.length} notes · ${s.bars} bars · ${levelBadge(s.level)}</p>
        <div class="gap"></div>
        <div class="row"><button class="btn grow" id="listen">${ico('play')} Listen</button><button class="btn ghost grow" id="prac">${ico('music')} Learn it</button></div>
        <div class="row" style="margin-top:8px"><button class="btn sm ${iv.saved ? 'ghost' : ''} grow" id="save" ${iv.saved ? 'disabled' : ''}>${ico('check')} ${iv.saved ? 'Saved to library' : 'Save to library'}</button><button class="btn sm ghost" id="mid">${ico('download')} MIDI</button></div>
        <p class="small faint" style="margin:10px 2px 0">${iv.saved ? 'It’s in Songs → My imports.' : 'Not saved yet – listen first, and only save it if you like it.'}</p></div>
      ${!midi && iv.samples ? `<div class="gap"></div><button class="btn sm ghost block" id="mode">${iv.analysis?.kind === 'piano' ? 'Doesn’t sound right? Try it as “Any song”' : 'Is this solo piano? Try it as “Piano recording”'}</button>` : ''}
      <div class="section"><h2>Difficulty</h2></div>
      <div class="card">${sg('level', [['Auto', 'Auto'], ['Beginner', 'Easy'], ['Intermediate', 'Medium'], ['Advanced', 'Hard']], iv.level)}</div>`;
    $('#ttl', r).addEventListener('input', (e) => { iv.name = e.target.value; s.title = iv.name; });
    $('#mode', r)?.addEventListener('click', async () => { iv.kind = iv.analysis?.kind === 'piano' ? 'song' : 'piano'; try { localStorage.setItem('pp-import-kind', iv.kind); } catch {} iv.busy = true; iv.cancel = false; drawResult(); try { await analyse(); } catch (x) { if (x.message !== 'cancelled') toast(x.message); } iv.busy = false; draw(); });
    r.onclick = (e) => { const b = e.target.closest('[data-s=level] button'); if (b) { iv.level = b.dataset.v; applyLevel(s); if (iv.saved) app.store.addCustom(s); drawResult(); } };
    const named = () => { s.title = (iv.name || 'My song').trim() || 'My song'; applyLevel(s); };
    $('#save', r).addEventListener('click', () => { named(); app.store.addCustom(s); iv.saved = true; toast('Saved to Songs → My imports'); drawResult(); });
    $('#listen', r).addEventListener('click', () => { named(); app.play(s, { mode: 'watch', onClose: () => app.route() }); });
    $('#prac', r).addEventListener('click', () => { if (!s.notes.length) { toast('There are no notes to practise.'); return; } named(); app.play(s, { mode: 'learn', onClose: () => app.route() }); });
    $('#mid', r).addEventListener('click', () => download((iv.name || 'song').replace(/[^\w-]+/g, '_') + '.mid', songToMidi(s), 'audio/midi'));
  }

  el.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b && !iv.busy) { iv.tab = b.dataset.tab; draw(); } });
  draw();
}
