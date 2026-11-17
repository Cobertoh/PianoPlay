// PianoPlay service worker: precache the app shell so it works offline; update in the background.
const VERSION = 'pianoplay-v5';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/ui.js', 'js/store.js', 'js/input.js', 'js/player.js', 'js/practice.js', 'js/practice-view.js', 'js/import-view.js',
  'js/music.js', 'js/songs.js', 'js/audio.js', 'js/stage.js', 'js/sheet.js', 'js/glyphs.js', 'js/session.js', 'js/pitch.js', 'js/fft.js', 'js/midi.js', 'js/transcribe.js', 'js/arrange.js', 'js/perform.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'samples/piano/A0.mp3', 'samples/piano/C8.mp3',
  ...[1, 2, 3, 4, 5, 6, 7].flatMap((o) => ['C', 'Ds', 'Fs', 'A'].map((n) => `samples/piano/${n}${o}.mp3`))];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                       // YouTube etc. go straight to the network
  // stale-while-revalidate for same-origin files; library/ JSON is network-first so new songs show up
  const netFirst = url.pathname.includes('/library/');
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return netFirst ? net.then((r) => r || hit) : (hit || net);
  }));
});
