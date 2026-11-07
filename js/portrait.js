// 人像后期: background blur and light skin smoothing, driven by the person / skin masks
// from segment.js. Works on raw RGBA, so it runs in the worker and in tests.
//
// The approach follows Google Meet's web background blur: refine the coarse mask against the
// photo itself, blur only background pixels (so the person's colors don't bleed into a halo),
// and blend by the mask. Skin smoothing is an edge-preserving guided filter (He et al.).

import { boxBlur } from './develop.js';

export const PORTRAIT = {
  work: 768, // long side of the working size for mask refinement
  alphaR: 0.012, alphaEps: 1e-3, // mask refinement: radius (fraction of the long side), edge sensitivity
  blur: 0.012, // background blur radius as a fraction of the photo's long side
  ground: 0.35, // blur left on the ground at the person's feet (it is as far away as they are)
  smooth: 0.6, smoothEps: 0.004, lift: 0.04, // skin smoothing strength, edge sensitivity, brightening
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Samples a mask (Uint8 0..255 or Float 0..1, mw×mh) inside a normalized box {x, y, w, h}
// (null = whole mask) into a w×h Float32Array, bilinearly.
export function cropMask(mask, mw, mh, box, w, h) {
  const bx = box ? box.x : 0, by = box ? box.y : 0, bw = box ? box.w : 1, bh = box ? box.h : 1;
  const k = mask instanceof Float32Array ? 1 : 1 / 255;
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const sy = Math.min(mh - 1, Math.max(0, (by + ((j + 0.5) / h) * bh) * mh - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(mh - 1, y0 + 1), fy = sy - y0;
    for (let i = 0; i < w; i++) {
      const sx = Math.min(mw - 1, Math.max(0, (bx + ((i + 0.5) / w) * bw) * mw - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(mw - 1, x0 + 1), fx = sx - x0;
      const top = mask[y0 * mw + x0] + (mask[y0 * mw + x1] - mask[y0 * mw + x0]) * fx;
      const bot = mask[y1 * mw + x0] + (mask[y1 * mw + x1] - mask[y1 * mw + x0]) * fx;
      out[j * w + i] = (top + (bot - top) * fy) * k;
    }
  }
  return out;
}

const boxMean = (a, w, h, r) => { const b = Float32Array.from(a); boxBlur(b, w, h, r, 1); return b; };

// Guided filter: smooths p while following the edges of the guide I (both w×h, 0..1).
export function guidedFilter(I, p, w, h, r, eps) {
  const n = w * h;
  const Ip = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mI = boxMean(I, w, h, r), mp = boxMean(p, w, h, r);
  const mIp = boxMean(Ip, w, h, r), mII = boxMean(II, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varI = mII[i] - mI[i] * mI[i];
    a[i] = (mIp[i] - mI[i] * mp[i]) / (varI + eps);
    b[i] = mp[i] - a[i] * mI[i];
  }
  boxBlur(a, w, h, r, 1);
  boxBlur(b, w, h, r, 1);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = a[i] * I[i] + b[i];
  return q;
}

// Grayscale (0..1) of an RGBA image, shrunk to ww×wh by box averaging.
function grayAt(data, w, h, ww, wh) {
  const out = new Float32Array(ww * wh);
  for (let j = 0; j < wh; j++) {
    const y0 = Math.floor((j * h) / wh), y1 = Math.max(y0 + 1, Math.floor(((j + 1) * h) / wh));
    for (let i = 0; i < ww; i++) {
      const x0 = Math.floor((i * w) / ww), x1 = Math.max(x0 + 1, Math.floor(((i + 1) * w) / ww));
      let s = 0, c = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const k = (y * w + x) * 4;
          s += 0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2];
          c++;
        }
      }
      out[j * ww + i] = s / c / 255;
    }
  }
  return out;
}

// Person alpha for a w×h photo: the coarse mask (sampled through `box`) is refined against the
// photo at a working size, tightened a little, and scaled back up.
export function personAlpha(data, w, h, mask, mw, mh, box) {
  const s = Math.min(1, PORTRAIT.work / Math.max(w, h));
  const ww = Math.max(8, Math.round(w * s)), wh = Math.max(8, Math.round(h * s));
  const gray = grayAt(data, w, h, ww, wh);
  const coarse = cropMask(mask, mw, mh, box, ww, wh);
  // The window must span the mask's blurry edge (about 3 mask pixels once scaled up).
  const cell = (ww / mw) / (box ? box.w : 1);
  const r = Math.max(2, Math.round(Math.max(PORTRAIT.alphaR * Math.max(ww, wh), 3 * cell)));
  const q = guidedFilter(gray, coarse, ww, wh, r, PORTRAIT.alphaEps);
  for (let i = 0; i < q.length; i++) q[i] = clamp01((q[i] - 0.5) * 1.6 + 0.5);
  return cropMask(q, ww, wh, null, w, h);
}

// Edge-preserving smoothing on skin (skin: w×h Float32 0..1), plus a slight brightening.
// Pixels where skin is 0 are not touched.
export function smoothSkin(data, w, h, skin, amount = PORTRAIT.smooth) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (skin[y * w + x] > 0.05) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) return false;
  const r = Math.max(2, Math.round(Math.min(w, h) / 240));
  x0 = Math.max(0, x0 - r); y0 = Math.max(0, y0 - r); x1 = Math.min(w - 1, x1 + r); y1 = Math.min(h - 1, y1 + r);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, n = bw * bh;
  const chan = new Float32Array(n);
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) chan[y * bw + x] = data[((y + y0) * w + x + x0) * 4 + c] / 255;
    const q = guidedFilter(chan, chan, bw, bh, r, PORTRAIT.smoothEps);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const m = skin[(y + y0) * w + x + x0];
        if (m <= 0) continue;
        const k = y * bw + x;
        const v = chan[k] + (q[k] - chan[k]) * m * amount;
        data[((y + y0) * w + x + x0) * 4 + c] = Math.min(255, v * (1 + PORTRAIT.lift * m) * 255);
      }
    }
  }
  return true;
}

// How much blur the ground keeps near the person's feet (feet: normalized y, null = not in frame).
export function groundFactor(y, feet) {
  if (feet == null || feet > 0.97) return 1;
  const top = feet - 0.15;
  if (y <= top) return 1;
  if (y >= feet) return PORTRAIT.ground;
  const t = (y - top) / (feet - top);
  return 1 - (1 - PORTRAIT.ground) * t * t * (3 - 2 * t);
}

// Background blur. alpha: w×h Float32 (1 = person). Blurs only background pixels at quarter
// size (normalized convolution, so no halo), in a squared "light" space so highlights bloom.
export function bokeh(data, w, h, alpha, { feet = null } = {}) {
  const f = 4;
  const lw = Math.ceil(w / f), lh = Math.ceil(h / f), ln = lw * lh;
  const R = new Float32Array(ln), G = new Float32Array(ln), B = new Float32Array(ln), W = new Float32Array(ln);
  for (let y = 0; y < h; y++) {
    const ly = Math.floor(y / f);
    for (let x = 0; x < w; x++) {
      const i = y * w + x, k = ly * lw + Math.floor(x / f), bg = 1 - alpha[i];
      const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
      R[k] += r * r * bg; G[k] += g * g * bg; B[k] += b * b * bg; W[k] += bg;
    }
  }
  const rad = Math.max(1, Math.round((PORTRAIT.blur * Math.max(w, h)) / f));
  for (const a of [R, G, B, W]) boxBlur(a, lw, lh, rad, 3);
  for (let k = 0; k < ln; k++) {
    const d = W[k] > 1e-4 ? W[k] : 1e-4;
    R[k] = Math.sqrt(R[k] / d); G[k] = Math.sqrt(G[k] / d); B[k] = Math.sqrt(B[k] / d);
  }
  for (let y = 0; y < h; y++) {
    const sy = Math.min(lh - 1, Math.max(0, (y + 0.5) / f - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(lh - 1, y0 + 1), fy = sy - y0;
    const gf = groundFactor((y + 0.5) / h, feet);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = (1 - alpha[i]) * gf;
      if (t <= 0.002) continue;
      const sx = Math.min(lw - 1, Math.max(0, (x + 0.5) / f - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(lw - 1, x0 + 1), fx = sx - x0;
      const a = y0 * lw + x0, b = y0 * lw + x1, c = y1 * lw + x0, d = y1 * lw + x1;
      const lerp = (P) => { const tp = P[a] + (P[b] - P[a]) * fx; const bt = P[c] + (P[d] - P[c]) * fx; return tp + (bt - tp) * fy; };
      data[i * 4] += (lerp(R) * 255 - data[i * 4]) * t;
      data[i * 4 + 1] += (lerp(G) * 255 - data[i * 4 + 1]) * t;
      data[i * 4 + 2] += (lerp(B) * 255 - data[i * 4 + 2]) * t;
    }
  }
  return data;
}
