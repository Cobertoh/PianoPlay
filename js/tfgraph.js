// PianoPlay - a tiny, dependency-free executor for TensorFlow.js "graph model" files (model.json +
// weights .bin). It implements only the ops used by Spotify's Basic Pitch transcription model, in
// plain JavaScript on Float32Arrays (NHWC). No libraries, runs on any phone.

export class Tensor {
  constructor(shape, data, dtype = 'float32') { this.shape = shape; this.data = data; this.dtype = dtype; }
  get size() { return this.shape.reduce((a, b) => a * b, 1); }
}
const strides = (shape) => { const s = new Array(shape.length); let k = 1; for (let i = shape.length - 1; i >= 0; i--) { s[i] = k; k *= shape[i]; } return s; };
const vals = (t) => Array.from(t.data);
const b64 = (s) => (typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary'));

export class GraphModel {
  /** json: parsed model.json, bin: ArrayBuffer of the weights shard(s) concatenated */
  constructor(json, bin) {
    this.nodes = new Map();
    for (const n of json.modelTopology.node) this.nodes.set(n.name, n);
    this.consts = new Map();
    let off = 0;
    for (const grp of json.weightsManifest) for (const w of grp.weights) {
      const n = w.shape.reduce((a, b) => a * b, 1);
      const data = w.dtype === 'int32' ? new Int32Array(bin.slice(off, off + n * 4)) : new Float32Array(bin.slice(off, off + n * 4));
      this.consts.set(w.name, new Tensor(w.shape, data, w.dtype)); off += n * 4;
    }
  }
  execute(inputs, outputNames) {
    const cache = new Map(Object.entries(inputs));
    const order = [], seen = new Set();
    const visit = (name) => {
      const base = name.replace(/^\^/, '').split(':')[0];
      if (seen.has(base)) return; seen.add(base);
      const node = this.nodes.get(base); if (!node) throw new Error('missing node ' + base);
      for (const i of node.input || []) if (!i.startsWith('^')) visit(i);
      order.push(node);
    };
    outputNames.forEach(visit);
    // free intermediate tensors once their last consumer has run (keeps memory low on phones)
    const lastUse = new Map(); order.forEach((n, idx) => (n.input || []).forEach((i) => lastUse.set(i.split(':')[0], idx)));
    order.forEach((node, idx) => {
      if (!cache.has(node.name)) {
        const ins = (node.input || []).filter((i) => !i.startsWith('^')).map((i) => cache.get(i.split(':')[0]));
        cache.set(node.name, this.run(node, ins));
      }
      for (const i of node.input || []) { const b = i.split(':')[0]; if (lastUse.get(b) === idx && !outputNames.includes(b) && this.nodes.get(b)?.op !== 'Const' && !(b in inputs)) cache.delete(b); }
    });
    return outputNames.map((n) => cache.get(n));
  }
  run(node, x) {
    const a = node.attr || {}, op = node.op;
    const ints = (k) => (a[k]?.list?.i || []).map(Number);
    switch (op) {
      case 'Const': { const t = this.consts.get(node.name); if (!t) throw new Error('const ' + node.name); return t; }
      case 'Identity': return x[0];
      case 'Shape': return new Tensor([x[0].shape.length], Int32Array.from(x[0].shape), 'int32');
      case 'Pack': { let axis = Number(a.axis?.i || 0); if (axis < 0) axis += x[0].shape.length + 1; if (x.every((t) => t.shape.length === 0 || t.size === 1) && axis === 0) return new Tensor([x.length], (x[0].dtype === 'int32' ? Int32Array : Float32Array).from(x.map((t) => t.data[0])), x[0].dtype); return concat(x.map((t) => expandDims(t, axis)), axis); }
      case 'Reshape': return reshape(x[0], vals(x[1]));
      case 'ExpandDims': return expandDims(x[0], vals(x[1])[0]);
      case 'Squeeze': { const dims = ints('squeeze_dims').map((d) => (d < 0 ? d + x[0].shape.length : d)); return new Tensor(x[0].shape.filter((s, i) => (dims.length ? !dims.includes(i) : s !== 1)), x[0].data, x[0].dtype); }
      case 'Transpose': return transpose(x[0], vals(x[1]));
      case 'StridedSlice': return stridedSlice(x[0], vals(x[1]), vals(x[2]), vals(x[3]), a);
      case 'Pad': return pad(x[0], vals(x[1]), 'constant');
      case 'MirrorPad': return pad(x[0], vals(x[1]), b64(a.mode.s) === 'REFLECT' ? 'reflect' : 'symmetric');
      case 'ConcatV2': { const axis = vals(x[x.length - 1])[0]; const ts = x.slice(0, -1); return concat(ts, axis < 0 ? axis + ts[0].shape.length : axis); }
      case 'Neg': return unary(x[0], (v) => -v);
      case 'Square': return unary(x[0], (v) => v * v);
      case 'Sqrt': return unary(x[0], Math.sqrt);
      case 'Log': return unary(x[0], Math.log);
      case 'Sigmoid': return unary(x[0], (v) => 1 / (1 + Math.exp(-v)));
      case 'Mul': return binary(x[0], x[1], (p, q) => p * q);
      case 'Add': case 'AddV2': return binary(x[0], x[1], (p, q) => p + q);
      case 'Sub': return binary(x[0], x[1], (p, q) => p - q);
      case 'DivNoNan': return binary(x[0], x[1], (p, q) => (q === 0 ? 0 : p / q));
      case 'Sum': return reduce(x[0], vals(x[1]), !!a.keep_dims?.b, (acc, v) => acc + v, 0);
      case 'Max': return reduce(x[0], vals(x[1]), !!a.keep_dims?.b, (acc, v) => (v > acc ? v : acc), -Infinity);
      case 'Min': return reduce(x[0], vals(x[1]), !!a.keep_dims?.b, (acc, v) => (v < acc ? v : acc), Infinity);
      case 'Conv2D': case '_FusedConv2D': {
        const fused = (a.fused_ops?.list?.s || []).map(b64);
        return conv2d(x[0], x[1], ints('strides'), b64(a.padding.s), fused.includes('BiasAdd') ? x[2] : null, fused.includes('Relu'));
      }
      default: throw new Error('Unsupported op ' + op);
    }
  }
}

function reshape(t, shape) {
  const n = t.size; const s = shape.slice(); const i = s.indexOf(-1);
  if (i >= 0) s[i] = n / s.reduce((p, q, j) => (j === i ? p : p * q), 1);
  return new Tensor(s, t.data, t.dtype);
}
function expandDims(t, axis) { const s = t.shape.slice(); if (axis < 0) axis += s.length + 1; s.splice(axis, 0, 1); return new Tensor(s, t.data, t.dtype); }
function transpose(t, perm) {
  const sh = t.shape, out = perm.map((p) => sh[p]), st = strides(sh), ost = strides(out), n = t.size;
  const res = new (t.data.constructor)(n), r = sh.length, idx = new Array(r).fill(0);
  const pst = perm.map((p) => st[p]);
  for (let o = 0; o < n; o++) {
    let src = 0; for (let k = 0; k < r; k++) src += idx[k] * pst[k];
    res[o] = t.data[src];
    for (let k = r - 1; k >= 0; k--) { if (++idx[k] < out[k]) break; idx[k] = 0; }
  }
  return new Tensor(out, res, t.dtype);
}
function stridedSlice(t, begin, end, step, a) {
  const bm = Number(a.begin_mask?.i || 0), em = Number(a.end_mask?.i || 0), el = Number(a.ellipsis_mask?.i || 0), na = Number(a.new_axis_mask?.i || 0), sa = Number(a.shrink_axis_mask?.i || 0);
  // expand the spec to full rank
  const spec = []; let dim = 0;
  const nSpecReal = begin.length - [...Array(begin.length).keys()].filter((i) => (na >> i) & 1).length;
  for (let i = 0; i < begin.length; i++) {
    if ((el >> i) & 1) { const fill = t.shape.length - (nSpecReal - 1); for (let k = 0; k < fill; k++) spec.push({ dim: dim++, full: true }); continue; }
    if ((na >> i) & 1) { spec.push({ newAxis: true }); continue; }
    spec.push({ dim: dim++, b: begin[i], e: end[i], s: step[i], bm: (bm >> i) & 1, em: (em >> i) & 1, shrink: (sa >> i) & 1 });
  }
  while (dim < t.shape.length) spec.push({ dim: dim++, full: true });
  const ranges = [], outShape = [];
  for (const sp of spec) {
    if (sp.newAxis) { outShape.push(1); continue; }
    const n = t.shape[sp.dim];
    if (sp.full) { ranges[sp.dim] = { b: 0, s: 1, len: n }; outShape.push(n); continue; }
    const s = sp.s;
    let b = sp.b < 0 ? sp.b + n : sp.b, e = sp.e < 0 ? sp.e + n : sp.e;
    if (sp.shrink) { ranges[sp.dim] = { b, s: 1, len: 1 }; continue; }
    if (sp.bm) b = s > 0 ? 0 : n - 1; if (sp.em) e = s > 0 ? n : -1;
    b = Math.max(s > 0 ? 0 : -1, Math.min(b, s > 0 ? n : n - 1)); e = Math.max(-1, Math.min(e, n));
    const len = Math.max(0, Math.ceil((e - b) / s));
    ranges[sp.dim] = { b, s, len }; outShape.push(len);
  }
  const st = strides(t.shape), lens = ranges.map((r) => r.len), total = lens.reduce((p, q) => p * q, 1);
  const res = new (t.data.constructor)(total), idx = new Array(lens.length).fill(0);
  for (let o = 0; o < total; o++) {
    let src = 0; for (let k = 0; k < lens.length; k++) src += (ranges[k].b + idx[k] * ranges[k].s) * st[k];
    res[o] = t.data[src];
    for (let k = lens.length - 1; k >= 0; k--) { if (++idx[k] < lens[k]) break; idx[k] = 0; }
  }
  return new Tensor(outShape, res, t.dtype);
}
function pad(t, p, mode) {
  const r = t.shape.length, before = [], out = [];
  for (let i = 0; i < r; i++) { before.push(p[2 * i]); out.push(t.shape[i] + p[2 * i] + p[2 * i + 1]); }
  const st = strides(t.shape), n = out.reduce((a, b) => a * b, 1), res = new (t.data.constructor)(n), idx = new Array(r).fill(0);
  for (let o = 0; o < n; o++) {
    let src = 0, ok = true;
    for (let k = 0; k < r; k++) {
      let c = idx[k] - before[k]; const L = t.shape[k];
      if (c < 0 || c >= L) { if (mode === 'constant') { ok = false; break; } c = mode === 'reflect' ? (c < 0 ? -c : 2 * L - 2 - c) : (c < 0 ? -c - 1 : 2 * L - 1 - c); }
      src += c * st[k];
    }
    res[o] = ok ? t.data[src] : 0;
    for (let k = r - 1; k >= 0; k--) { if (++idx[k] < out[k]) break; idx[k] = 0; }
  }
  return new Tensor(out, res, t.dtype);
}
function concat(ts, axis) {
  const out = ts[0].shape.slice(); out[axis] = ts.reduce((s, t) => s + t.shape[axis], 0);
  const outer = out.slice(0, axis).reduce((a, b) => a * b, 1), res = new (ts[0].data.constructor)(out.reduce((a, b) => a * b, 1));
  const inner = out.slice(axis + 1).reduce((a, b) => a * b, 1);
  let o = 0;
  for (let i = 0; i < outer; i++) for (const t of ts) { const blk = t.shape[axis] * inner; res.set(t.data.subarray(i * blk, (i + 1) * blk), o); o += blk; }
  return new Tensor(out, res, ts[0].dtype);
}
function unary(t, f) { const r = new Float32Array(t.size); for (let i = 0; i < r.length; i++) r[i] = f(t.data[i]); return new Tensor(t.shape, r); }
function binary(A, B, f) {
  const r = Math.max(A.shape.length, B.shape.length);
  const sa = Array(r - A.shape.length).fill(1).concat(A.shape), sb = Array(r - B.shape.length).fill(1).concat(B.shape);
  const out = sa.map((v, i) => Math.max(v, sb[i]));
  const n = out.reduce((a, b) => a * b, 1), res = new Float32Array(n);
  if (A.size === n && B.size === n) { for (let i = 0; i < n; i++) res[i] = f(A.data[i], B.data[i]); return new Tensor(out, res); }
  if (B.size === 1) { const q = B.data[0]; for (let i = 0; i < n; i++) res[i] = f(A.data[i], q); return new Tensor(out, res); }
  if (A.size === 1) { const p = A.data[0]; for (let i = 0; i < n; i++) res[i] = f(p, B.data[i]); return new Tensor(out, res); }
  const sta = strides(sa).map((s, i) => (sa[i] === 1 ? 0 : s)), stb = strides(sb).map((s, i) => (sb[i] === 1 ? 0 : s)), idx = new Array(r).fill(0);
  for (let o = 0; o < n; o++) {
    let ia = 0, ib = 0; for (let k = 0; k < r; k++) { ia += idx[k] * sta[k]; ib += idx[k] * stb[k]; }
    res[o] = f(A.data[ia], B.data[ib]);
    for (let k = r - 1; k >= 0; k--) { if (++idx[k] < out[k]) break; idx[k] = 0; }
  }
  return new Tensor(out, res);
}
function reduce(t, axes, keep, f, init) {
  const r = t.shape.length; axes = axes.map((a) => (a < 0 ? a + r : a));
  const outKeep = t.shape.map((s, i) => (axes.includes(i) ? 1 : s));
  const n = outKeep.reduce((a, b) => a * b, 1), res = new Float32Array(n).fill(init), ost = strides(outKeep), idx = new Array(r).fill(0);
  for (let i = 0; i < t.size; i++) {
    let o = 0; for (let k = 0; k < r; k++) if (!axes.includes(k)) o += idx[k] * ost[k];
    res[o] = f(res[o], t.data[i]);
    for (let k = r - 1; k >= 0; k--) { if (++idx[k] < t.shape[k]) break; idx[k] = 0; }
  }
  return new Tensor(keep ? outKeep : t.shape.filter((s, i) => !axes.includes(i)), res);
}
/** NHWC conv, kernel [kh, kw, cin, cout], padding 'SAME' | 'VALID' */
function conv2d(X, Kt, st, padding, bias, relu) {
  const [N, H, W, C] = X.shape, [kh, kw, ci, co] = Kt.shape, sh = st[1], sw = st[2];
  let oh, ow, pt = 0, pl = 0;
  if (padding === 'SAME') { oh = Math.ceil(H / sh); ow = Math.ceil(W / sw); pt = Math.max(0, Math.floor(((oh - 1) * sh + kh - H) / 2)); pl = Math.max(0, Math.floor(((ow - 1) * sw + kw - W) / 2)); }
  else { oh = Math.floor((H - kh) / sh) + 1; ow = Math.floor((W - kw) / sw) + 1; }
  const out = new Float32Array(N * oh * ow * co), x = X.data, k = Kt.data;
  if (kh === 1 && ci === 1 && padding === 'VALID') {
    // 1-D filter bank over time (the constant-Q transform): out[x, o] = sum_d x[x*sw + d] * k[d, o]
    const kT = new Float32Array(co * kw); for (let d = 0; d < kw; d++) for (let o = 0; o < co; o++) kT[o * kw + d] = k[d * co + o];
    for (let n = 0; n < N; n++) for (let y = 0; y < oh; y++) {
      const rowIn = (n * H + y) * W, rowOut = (n * oh + y) * ow;
      for (let xo = 0; xo < ow; xo++) {
        const base = rowIn + xo * sw;
        for (let o = 0; o < co; o++) { let s = 0; const kb = o * kw; for (let d = 0; d < kw; d++) s += x[base + d] * kT[kb + d]; out[(rowOut + xo) * co + o] = s + (bias ? bias.data[o] : 0); }
      }
    }
    return new Tensor([N, oh, ow, co], out);
  }
  // planar direct convolution: long contiguous inner loops over the output row (fast in JS engines)
  const PW = W + kw, PH = H + kh;   // padded input planes
  const outP = new Float32Array(co * oh * ow);
  for (let n = 0; n < N; n++) {
    const inP = new Float32Array(ci * PH * PW);
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) { const src = ((n * H + y) * W + xx) * C; for (let c = 0; c < ci; c++) inP[(c * PH + y + pt) * PW + xx + pl] = x[src + c]; }
    outP.fill(0);
    for (let y = 0; y < oh; y++) for (let o = 0; o < co; o++) {
      const ob = (o * oh + y) * ow;
      for (let c = 0; c < ci; c++) for (let dy = 0; dy < kh; dy++) {
        const rb = (c * PH + y * sh + dy) * PW, kb = (dy * kw * ci + c) * co + o, kstep = ci * co;
        for (let dx = 0; dx < kw; dx++) {
          const kv = k[kb + dx * kstep]; if (kv === 0) continue;
          const ib = rb + dx;
          if (sw === 1) for (let xo = 0; xo < ow; xo++) outP[ob + xo] += kv * inP[ib + xo];
          else for (let xo = 0; xo < ow; xo++) outP[ob + xo] += kv * inP[ib + xo * sw];
        }
      }
    }
    for (let o = 0; o < co; o++) { const bv = bias ? bias.data[o] : 0; for (let i = 0; i < oh * ow; i++) { let v = outP[o * oh * ow + i] + bv; if (relu && v < 0) v = 0; out[(n * oh * ow + i) * co + o] = v; } }
  }
  return new Tensor([N, oh, ow, co], out);
}
