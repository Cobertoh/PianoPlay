// Worker API tests with a fake network.
import assert from 'node:assert/strict';
import { handleApi } from '../worker.js';
const fake = async (u) => {
  const url = String(u);
  if (url.startsWith('https://itunes.apple.com/search')) return Response.json({ results: [{ trackName: 'I Caught Myself', artistName: 'Paramore', artworkUrl100: 'https://is1.mzstatic.com/a.jpg', previewUrl: 'https://audio-ssl.itunes.apple.com/p.m4a' }, { trackName: 'No preview' }] });
  if (url.startsWith('https://archive.org/advancedsearch')) return Response.json({ response: { docs: [{ identifier: 'chopin-nocturnes', title: 'Nocturnes', creator: ['Frédéric Chopin'] }] } });
  if (url.startsWith('https://archive.org/metadata/')) return Response.json({ metadata: { title: 'Nocturnes', creator: 'Chopin' }, files: [{ name: 'op9 no2.mp3', format: 'VBR MP3', length: '271.3' }, { name: 'cover.jpg', format: 'JPEG' }] });
  if (url.startsWith('https://audio-ssl.itunes.apple.com/')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/x-m4a', 'content-length': '3' } });
  throw new Error('unexpected ' + url);
};
const get = (path) => handleApi(new Request('https://pianoplay.example' + path), fake);
export async function run(t) {
  console.log('worker api (song search)');
  const s = await (await get('/api/search?q=paramore')).json();
  t('search returns previews with audio and full-length archive items', () => { assert.equal(s.previews.length, 1); assert.equal(s.previews[0].artist, 'Paramore'); assert.equal(s.full[0].id, 'chopin-nocturnes'); assert.equal(s.full[0].artist, 'Frédéric Chopin'); });
  const f = await (await get('/api/ia-files?id=chopin-nocturnes')).json();
  t('archive item lists only its audio files', () => { assert.equal(f.files.length, 1); assert.equal(f.files[0].seconds, 271); assert.ok(f.files[0].url.endsWith('/op9%20no2.mp3')); });
  const a = await get('/api/audio?url=' + encodeURIComponent('https://audio-ssl.itunes.apple.com/p.m4a'));
  t('audio proxy streams allowed sources with CORS', async () => { assert.equal(a.status, 200); assert.equal(a.headers.get('access-control-allow-origin'), '*'); });
  const bad = await get('/api/audio?url=' + encodeURIComponent('https://www.youtube.com/watch?v=x'));
  t('audio proxy refuses other sites (YouTube etc.)', () => assert.equal(bad.status, 400));
  const bad2 = await get('/api/audio?url=' + encodeURIComponent('https://evil.example/archive.org.mp3'));
  t('host check cannot be fooled by the path', () => assert.equal(bad2.status, 400));
}
