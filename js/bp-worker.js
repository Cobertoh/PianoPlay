// Web Worker: runs Basic Pitch windows off the main thread.
import { loadModel, runWindow } from './basicpitch.js';
const ready = loadModel(new URL('../models/basic-pitch/', import.meta.url).href);
self.onmessage = async (e) => {
  try {
    const model = await ready;
    const r = runWindow(model, e.data.win);
    self.postMessage({ i: e.data.i, frames: r.frames, onsets: r.onsets, n: r.n }, [r.frames.buffer, r.onsets.buffer]);
  } catch (x) { self.postMessage({ error: String(x && x.message || x) }); }
};
