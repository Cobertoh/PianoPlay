// PianoPlay server part (Cloudflare Worker, free tier). Serves the app's static files and a tiny API that
// lets the app find songs and read their audio – browsers block web pages from downloading audio from
// other sites directly. Only two sources are allowed:
//   • Apple's iTunes Search API – official 30-second previews of almost any song
//   • the Internet Archive – full-length recordings that are free / public domain / Creative Commons
// It never touches YouTube, Spotify or other services whose terms forbid downloading.
const ALLOWED = ['itunes.apple.com', 'mzstatic.com', 'archive.org'];
const MAX_BYTES = 40 * 1024 * 1024;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600', ...cors } });
const allowedHost = (u) => { try { const h = new URL(u).hostname; return new URL(u).protocol === 'https:' && ALLOWED.some((d) => h === d || h.endsWith('.' + d)); } catch { return false; } };

export async function handleApi(req, fetcher = fetch) {
  const url = new URL(req.url), p = url.pathname;
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    if (p === '/api/search') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
      if (!q) return json({ previews: [], full: [] });
      const [it, ia] = await Promise.allSettled([
        fetcher(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=12`).then((r) => r.json()),
        fetcher(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(`(${q}) AND mediatype:audio`)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=downloads&sort[]=downloads+desc&rows=10&output=json`).then((r) => r.json()),
      ]);
      const previews = it.status === 'fulfilled' ? (it.value.results || []).filter((r) => r.previewUrl).map((r) => ({ title: r.trackName, artist: r.artistName, art: r.artworkUrl100, url: r.previewUrl, seconds: 30 })) : [];
      const full = ia.status === 'fulfilled' ? (ia.value.response?.docs || []).map((d) => ({ id: d.identifier, title: Array.isArray(d.title) ? d.title[0] : d.title || d.identifier, artist: Array.isArray(d.creator) ? d.creator[0] : d.creator || '' })) : [];
      return json({ previews, full });
    }
    if (p === '/api/lookup') {           // Apple Music link -> preview
      const id = (url.searchParams.get('id') || '').replace(/\D/g, '');
      const r = await (await fetcher(`https://itunes.apple.com/lookup?id=${id}&entity=song`)).json();
      const t = (r.results || []).find((x) => x.previewUrl);
      return t ? json({ title: t.trackName, artist: t.artistName, url: t.previewUrl, seconds: 30 }) : json({ error: 'No preview for that song' }, 404);
    }
    if (p === '/api/ia-files') {         // Internet Archive item -> its audio tracks
      const id = (url.searchParams.get('id') || '').replace(/[^\w.\-]/g, '');
      const m = await (await fetcher(`https://archive.org/metadata/${id}`)).json();
      const files = (m.files || []).filter((f) => /mp3/i.test(f.format || '') || /\.mp3$/i.test(f.name)).map((f) => ({ name: f.name, title: f.title || f.name.replace(/\.[^.]+$/, ''), seconds: f.length ? Math.round(parseFloat(f.length) || 0) : null, url: `https://archive.org/download/${id}/${f.name.split('/').map(encodeURIComponent).join('/')}` }));
      return json({ title: m.metadata?.title || id, artist: m.metadata?.creator || '', license: m.metadata?.licenseurl || '', files: files.slice(0, 60) });
    }
    if (p === '/api/audio') {
      const target = url.searchParams.get('url') || '';
      if (!allowedHost(target)) return json({ error: 'That site isn’t supported.' }, 400);
      const r = await fetcher(target, { redirect: 'follow' });
      if (!r.ok) return json({ error: 'Could not download that audio (' + r.status + ')' }, 502);
      if (!allowedHost(r.url || target)) return json({ error: 'Redirected to an unsupported site.' }, 400);
      const len = +r.headers.get('content-length') || 0;
      if (len > MAX_BYTES) return json({ error: 'That file is too big (over 40 MB).' }, 413);
      return new Response(r.body, { headers: { 'Content-Type': r.headers.get('content-type') || 'audio/mpeg', ...(len ? { 'Content-Length': String(len) } : {}), 'Cache-Control': 'public, max-age=86400', ...cors } });
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) { return json({ error: 'Search is unavailable right now.' }, 502); }
}

export default {
  async fetch(req, env) {
    if (new URL(req.url).pathname.startsWith('/api/')) return handleApi(req);
    return env.ASSETS.fetch(req);
  },
};
