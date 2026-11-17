// PianoPlay - import screen: audio file / microphone recording / MIDI / YouTube link -> playable song.
import { ico, esc, $, $$, toast, levelBadge, download } from './ui.js';
import { decodeToMono, analyzeAudio, framesToSong, DEFAULTS } from './transcribe.js';
import { analyzeForArrangement, arrangeSong, ARR_DEFAULTS } from './arrange.js';
import { transcribeActivations, activationsToNotes, cleanNotes } from './basicpitch.js';
import { pianoNotesToSong, filterSongNotes, splitParts } from './pianoscribe.js';
// Simple = only the clear, strong notes; Detailed = also quieter and shorter ones
const DETAIL = {
  simple: { dec: { onsetThresh: 0.72, frameThresh: 0.38, minNoteLen: 11 }, minAmp: 0.42, maxSim: 4 },
  normal: { dec: { onsetThresh: 0.6, frameThresh: 0.3, minNoteLen: 6 }, minAmp: 0, maxSim: 6 },
  detailed: { dec: { onsetThresh: 0.45, frameThresh: 0.25, minNoteLen: 5 }, minAmp: 0, maxSim: 8 },
};
const savedKind = (() => { try { return localStorage.getItem('pp-import-kind'); } catch { return null; } })();
import { midiToSong, songToMidi } from './midi.js';
import { midiToName, fmtTime } from './music.js';

const iv = { tab: 'audio', find: { q: '', results: null, item: null, loading: false, link: '' }, kind: savedKind || 'piano', popts: { detail: 'normal', bpm: null, ts: null }, mode: 'arrange', samples: null, analysis: null, song: null, opts: { ...DEFAULTS }, aopts: { ...ARR_DEFAULTS }, name: '', level: 'Auto', customN: 5, busy: false, cancel: false, rec: null, yt: null, source: '' };

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
    const a = iv.analysis, D = DETAIL[iv.popts.detail] || DETAIL.normal;
    a.cache ||= {};
    let notes = a.cache[iv.popts.detail] ||= (() => {
      let ns = cleanNotes(activationsToNotes(a.act, D.dec)).filter((n) => n.a >= D.minAmp);
      if (a.kind === 'song') ns = filterSongNotes(ns, a.harm, D.maxSim);
      else if (D.maxSim < 6) ns = ns.filter((n) => { const sim = ns.filter((b) => b.t0 <= n.t0 + 0.01 && b.t1 > n.t0 + 0.01); if (sim.length <= D.maxSim) return true; sim.sort((x, y) => y.a - x.a); return sim.indexOf(n) < D.maxSim; });
      return ns;
    })();
    if (a.kind === 'song') notes = splitParts(notes, a.harm, iv.popts.parts);
    if (iv.popts.octave) notes = notes.map((n) => { let m = n.m + 12 * iv.popts.octave; while (m > 108) m -= 12; while (m < 21) m += 12; return { ...n, m }; });
    if (!notes.length) throw new Error(iv.popts.parts === 'vocals' ? 'No vocals were found in this song.' : 'No clear notes were found – try Detailed.');
    const song = pianoNotesToSong(notes, a.duration, { bpm: iv.popts.bpm }, iv.name || 'Imported song');
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
      <div class="seg" data-tabs>${[['audio', 'Audio'], ['record', 'Record'], ['midi', 'MIDI'], ['find', 'Find']].map(([k, t]) => `<button data-tab="${k}" class="${iv.tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>
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
    const harm = song ? await analyzeForArrangement(left && right ? { left, right } : samples, sr, { onProgress: (p) => prog.onProgress(p * 0.15), shouldCancel: prog.shouldCancel }) : null;
    const workers = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    const act = await transcribeActivations(samples, { onProgress: (p) => prog.onProgress((song ? 0.15 : 0) + p * (song ? 0.85 : 1)), shouldCancel: prog.shouldCancel, workers, workerUrl: new URL('./bp-worker.js', import.meta.url) });
    iv.analysis = { kind: iv.kind, act, harm, duration: samples.length / sr }; iv.popts = { detail: 'normal', bpm: null, octave: 0, parts: 'both' };
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
      const f = iv.find;
      const kindSeg = `<label class="l">What are you importing?</label><div class="seg" data-kind>${[['piano', 'Piano recording'], ['song', 'Any song']].map(([k, l]) => `<button data-k="${k}" class="${iv.kind === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
      const row = (r, i, kind) => `<div class="item" data-pick="${kind}:${i}" role="button" tabindex="0">${r.art ? `<img src="${esc(r.art)}" alt="" width="44" height="44" style="border-radius:8px;flex:none" loading="lazy">` : `<div class="ico purple">${ico('music')}</div>`}
        <div class="grow"><h3>${esc(r.title)}</h3><p>${esc(r.artist || '')}${r.seconds ? ' · ' + (r.seconds >= 60 ? Math.round(r.seconds / 60) + ' min' : r.seconds + ' sec') : ''}</p></div><span class="chev">${ico('chev')}</span></div>`;
      let body = '';
      if (f.loading) body = `<div class="card" style="text-align:center"><div class="spin" style="margin:0 auto"></div><p class="small muted" style="margin:10px 0 0">${esc(f.loading)}</p></div>`;
      else if (f.item) body = `<div class="section"><h2>${esc(f.item.title)}</h2></div><p class="small muted" style="margin:-6px 2px 10px">${esc(f.item.artist || '')} · Internet Archive${f.item.license ? ' · <a href="' + esc(f.item.license) + '" target="_blank" rel="noopener">licence</a>' : ''}</p>
          <div class="list">${f.item.files.map((x, i) => row(x, i, 'track')).join('') || '<div class="empty">No audio files in this item.</div>'}</div><div class="gap"></div><button class="btn sm ghost block" id="fback">Back to results</button>`;
      else if (f.results) body = `${f.results.full.length ? `<div class="section"><h2>Full length · free & public domain</h2></div><div class="list">${f.results.full.map((x, i) => row(x, i, 'full')).join('')}</div>` : ''}
          ${f.results.previews.length ? `<div class="section"><h2>30-second previews · Apple Music</h2></div><div class="list">${f.results.previews.map((x, i) => row(x, i, 'prev')).join('')}</div>` : ''}
          ${!f.results.full.length && !f.results.previews.length ? '<div class="empty">Nothing found. Try the song and artist name.</div>' : ''}`;
      t.innerHTML = `${kindSeg}<div class="gap"></div>
        <div class="searchbox">${ico('search')}<input class="search" id="fq" type="search" placeholder="Search a song or artist" value="${esc(f.q)}" autocomplete="off" enterkeyhint="search"></div>
        <div class="row" style="margin-top:8px"><input class="fld grow" id="flink" type="url" inputmode="url" placeholder="…or paste a link (Apple Music, archive.org, .mp3)" value="${esc(f.link)}" autocomplete="off"><button class="btn sm" id="flinkgo">Go</button></div>
        <div class="gap"></div>${body}
        ${!f.results && !f.item && !f.loading ? `<div class="note-box info small"><b>Where songs come from</b><br>• <b>Full-length</b> recordings that are free, public domain or Creative Commons, from the Internet Archive (lots of classical piano).<br>• <b>Any other song:</b> Apple Music’s official 30-second preview.<br>YouTube and Spotify don’t allow downloading their audio, so PianoPlay can’t use their links. If you own the full song, use <b>Audio</b> with the file.</div>` : ''}`;
      $$('[data-kind] button', t).forEach((b) => b.addEventListener('click', () => { iv.kind = b.dataset.k; try { localStorage.setItem('pp-import-kind', iv.kind); } catch {} drawTab(); }));
      const search = async () => {
        f.q = $('#fq', t).value.trim(); if (!f.q) return;
        f.item = null; f.loading = 'Searching…'; drawTab();
        try { f.results = await api('/api/search?q=' + encodeURIComponent(f.q)); } catch (x) { toast(x.message); f.results = null; }
        f.loading = false; drawTab();
      };
      $('#fq', t).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#fq', t).blur(); search(); } });
      const openItem = async (id) => { f.loading = 'Opening…'; drawTab(); try { f.item = await api('/api/ia-files?id=' + encodeURIComponent(id)); } catch (x) { toast(x.message); } f.loading = false; drawTab(); };
      const link = async () => {
        const v = (f.link = $('#flink', t).value.trim()); if (!v) return;
        let u; try { u = new URL(v); } catch { toast('That doesn’t look like a link.'); return; }
        const h = u.hostname.replace(/^www\./, '');
        if (/youtube\.com|youtu\.be|spotify\.com|soundcloud\.com|tiktok\.com/.test(h)) { toast('That site doesn’t allow downloading its audio. Search the song above instead.'); return; }
        if (h.endsWith('archive.org')) { const m = u.pathname.match(/\/(?:details|download)\/([^/]+)/); if (m) return openItem(m[1]); }
        if (h === 'music.apple.com' || h.endsWith('itunes.apple.com')) {
          const id = u.searchParams.get('i') || (u.pathname.match(/\/(?:song|track)\/[^/]*\/?(\d+)/) || [])[1];
          if (!id) { toast('Open the song itself (not the album) and copy its link.'); return; }
          f.loading = 'Getting the preview…'; drawTab();
          try { const r = await api('/api/lookup?id=' + id); f.loading = false; return importUrl(r.url, `${r.title} – ${r.artist}`); } catch (x) { f.loading = false; toast(x.message); drawTab(); return; }
        }
        return importUrl(v, decodeURIComponent(u.pathname.split('/').pop() || 'Song').replace(/\.[^.]+$/, ''));
      };
      $('#flinkgo', t).addEventListener('click', link);
      $('#flink', t).addEventListener('keydown', (e) => { if (e.key === 'Enter') link(); });
      $('#fback', t)?.addEventListener('click', () => { f.item = null; drawTab(); });
      t.onclick = (e) => {
        const it = e.target.closest('[data-pick]'); if (!it) return;
        const [kind, i] = it.dataset.pick.split(':');
        if (kind === 'full') return openItem(f.results.full[+i].id);
        if (kind === 'track') { const x = f.item.files[+i]; return importUrl(x.url, `${x.title}${f.item.artist ? ' – ' + f.item.artist : ''}`); }
        const x = f.results.previews[+i]; return importUrl(x.url, `${x.title} – ${x.artist}`);
      };
    }
  }

  /** JSON from the app's own server part (worker.js) */
  async function api(path) {
    let r; try { r = await fetch(path); } catch { throw new Error('No connection – song search needs the internet.'); }
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json')) throw new Error('Song search isn’t set up on this server yet (deploy with “npx wrangler deploy”).');
    const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || 'Search failed'); return j;
  }
  /** download audio (directly if the site allows it, otherwise through the app's server) and import it */
  async function importUrl(url, title) {
    iv.find.loading = false;
    busyView('Downloading the song…', 0.01); drawResult();
    let buf = null;
    try { const r = await fetch(url, { mode: 'cors' }); if (r.ok && /audio|octet|mp4|mpeg/.test(r.headers.get('content-type') || '')) buf = await r.arrayBuffer(); } catch { /* the site blocks direct downloads – use the proxy */ }
    if (!buf) {
      try {
        const r = await fetch('/api/audio?url=' + encodeURIComponent(url));
        if (!r.ok) { let m = 'Could not download that song.'; try { m = (await r.json()).error || m; } catch {} throw new Error(m); }
        if ((r.headers.get('content-type') || '').includes('text/html')) throw new Error('Song downloads aren’t set up on this server yet (deploy with “npx wrangler deploy”).');
        buf = await r.arrayBuffer();
      } catch (x) { toast(x.message); draw(); return; }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await process(buf, title.slice(0, 60), 'find');
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
      ${iv.analysis && !midi ? `<div class="section"><h2>Settings</h2></div><div class="card">
        ${iv.analysis.kind === 'song' ? `<label class="l">Play</label>${iv.analysis.harm?.wide ? sg('parts', [['both', 'Both'], ['vocals', 'Vocals only'], ['instruments', 'Instruments only']], iv.popts.parts) : `<p class="small faint" style="margin:2px 2px 0">This audio is mono, so vocals and instruments can’t be separated.</p>`}<div class="gap"></div>` : ''}
        <label class="l">Notes</label>${sg('detail', [['simple', 'Simple'], ['normal', 'Normal'], ['detailed', 'Detailed']], iv.popts.detail)}
        <p class="small faint" style="margin:6px 2px 0">Too many notes? Pick Simple. Missing some? Pick Detailed.</p>
        <div class="gap"></div><label class="l">Octave</label>${sg('octave', [['-1', 'Lower'], ['0', 'Normal'], ['1', 'Higher']], iv.popts.octave)}
        <div class="gap"></div><label class="l">BPM <span id="bpmv">${s.tempo}</span></label>
        <div class="row"><button class="btn sm ghost" data-bpm="0.5">½×</button><input type="range" id="bpm" min="30" max="240" value="${s.tempo}" class="grow"><button class="btn sm ghost" data-bpm="2">2×</button></div>
        <p class="small faint" style="margin:6px 2px 0">Sets the beat the sheet music and Learn mode count in. The sound always follows the recording – change playback speed with the Speed slider in the player.</p></div>` : ''}
      ${!midi && iv.samples ? `<div class="gap"></div><button class="btn sm ghost block" id="mode">${iv.analysis?.kind === 'piano' ? 'Doesn’t sound right? Try it as “Any song”' : 'Is this solo piano? Try it as “Piano recording”'}</button>` : ''}
      <div class="section"><h2>Difficulty</h2></div>
      <div class="card">${sg('level', [['Auto', 'Auto'], ['Beginner', 'Easy'], ['Intermediate', 'Medium'], ['Advanced', 'Hard'], ['Custom', 'Custom']], iv.level)}
        ${iv.level === 'Custom' ? `<div class="gap"></div><label class="l">Your rating <span id="cv">${iv.customN} / 10</span></label><input type="range" id="cust" min="1" max="10" value="${iv.customN}">` : ''}</div>`;
    $('#ttl', r).addEventListener('input', (e) => { iv.name = e.target.value; s.title = iv.name; });
    $('#cust', r)?.addEventListener('input', (e) => { iv.customN = +e.target.value; $('#cv', r).textContent = e.target.value + ' / 10'; applyLevel(s); if (iv.saved) app.store.addCustom(s); });
    $('#mode', r)?.addEventListener('click', async () => { iv.kind = iv.analysis?.kind === 'piano' ? 'song' : 'piano'; try { localStorage.setItem('pp-import-kind', iv.kind); } catch {} iv.busy = true; iv.cancel = false; drawResult(); try { await analyse(); } catch (x) { if (x.message !== 'cancelled') toast(x.message); } iv.busy = false; draw(); });
    // settings re-build the song: show that the tap registered, let the screen repaint, then do the work
    const redo = (btn) => {
      if (r.classList.contains('working')) return;
      if (btn && btn.tagName === 'BUTTON' && btn.parentElement.classList.contains('seg')) { $$('button', btn.parentElement).forEach((x) => x.classList.toggle('on', x === btn)); }
      r.classList.add('working'); const card = btn?.closest('.card'); if (card) card.insertAdjacentHTML('beforeend', '<div class="applying"><div class="spin"></div> Applying…</div>');
      setTimeout(() => {
        const keepSaved = iv.saved, id = s.id;
        try { regenerate(); } catch (x) { toast(x.message); r.classList.remove('working'); drawResult(); return; }
        if (keepSaved) { iv.song.id = id; iv.song.title = s.title; app.store.addCustom(iv.song); iv.saved = true; }
        r.classList.remove('working'); drawResult(); toast('Updated');
      }, 40);
    };
    let tm; $('#bpm', r)?.addEventListener('input', (e) => { $('#bpmv', r).textContent = e.target.value; iv.popts.bpm = +e.target.value; clearTimeout(tm); tm = setTimeout(() => redo($('#bpm', r)), 300); });
    $$('[data-bpm]', r).forEach((b) => b.addEventListener('click', () => { iv.popts.bpm = Math.max(30, Math.min(240, Math.round(s.tempo * +b.dataset.bpm))); redo(b); }));
    r.onclick = (e) => {
      const d = e.target.closest('[data-s=detail] button, [data-s=parts] button, [data-s=octave] button');
      if (d) { const k = d.parentElement.dataset.s, v = d.dataset.v; if (String(iv.popts[k]) === v) return; iv.popts[k] = k === 'octave' ? +v : v; redo(d); return; }
      const b = e.target.closest('[data-s=level] button'); if (b) { iv.level = b.dataset.v; applyLevel(s); if (iv.saved) app.store.addCustom(s); drawResult(); }
    };
    const named = () => { s.title = (iv.name || 'My song').trim() || 'My song'; applyLevel(s); };
    $('#save', r).addEventListener('click', () => { named(); app.store.addCustom(s); iv.saved = true; toast('Saved to Songs → My imports'); drawResult(); });
    $('#listen', r).addEventListener('click', () => { named(); app.play(s, { mode: 'watch', onClose: () => app.route() }); });
    $('#prac', r).addEventListener('click', () => { if (!s.notes.length) { toast('There are no notes to practise.'); return; } named(); app.play(s, { mode: 'learn', onClose: () => app.route() }); });
    $('#mid', r).addEventListener('click', () => download((iv.name || 'song').replace(/[^\w-]+/g, '_') + '.mid', songToMidi(s), 'audio/midi'));
  }

  el.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b && !iv.busy) { iv.tab = b.dataset.tab; draw(); } });
  draw();
}
