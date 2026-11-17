// Basic Pitch runner check: our dependency-free executor must reproduce Spotify's reference output.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { GraphModel } from '../js/tfgraph.js';
import { runWindow } from '../js/basicpitch.js';
const rd = (p) => { const b = fs.readFileSync(new URL(p, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
export async function run(t) {
  console.log('basic pitch (neural transcription)');
  const g = new GraphModel(JSON.parse(Buffer.from(rd('../models/basic-pitch/model.json')).toString()), rd('../models/basic-pitch/group1-shard1of1.bin'));
  const out = runWindow(g, new Float32Array(rd('./fixtures/bp-window0.f32')));
  const ref = new Float32Array(rd('./fixtures/bp-window0-frames.f32'));
  let md = 0; for (let i = 0; i < ref.length; i++) md = Math.max(md, Math.abs(out.frames[i] - ref[i]));
  t(`matches Spotify's reference output (max diff ${md.toExponential(1)})`, () => assert.ok(md < 1e-3));
}
