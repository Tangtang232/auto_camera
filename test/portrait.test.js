// 人像后期: mask sampling, guided filter, mask refinement, background blur, skin smoothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cropMask, guidedFilter, personAlpha, smoothSkin, bokeh, groundFactor, PORTRAIT } from '../js/portrait.js';

let seed = 11;
const rand = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };

function image(w, h, fill) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fill(x, y);
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return data;
}

const std = (vals) => { const m = vals.reduce((a, b) => a + b, 0) / vals.length; return Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / vals.length); };

test('masks are sampled through the crop box, bytes become 0..1', () => {
  const m = new Uint8Array(16);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) m[y * 4 + x] = 255; // left half is the person
  const full = cropMask(m, 4, 4, null, 8, 8);
  assert.ok(Math.abs(full[0] - 1) < 1e-6 && Math.abs(full[7]) < 1e-6);
  const right = cropMask(m, 4, 4, { x: 0.5, y: 0, w: 0.5, h: 1 }, 4, 4);
  for (let y = 0; y < 4; y++) {
    assert.ok(right[y * 4] < 0.3, 'only the edge column blends in a little');
    assert.ok(right[y * 4 + 2] === 0 && right[y * 4 + 3] === 0, String(right));
  }
  const floats = cropMask(Float32Array.from([0, 1, 0, 1]), 2, 2, null, 2, 2);
  assert.deepEqual(Array.from(floats), [0, 1, 0, 1]);
});

test('guided filter flattens noise and keeps a hard edge', () => {
  const w = 40, h = 40;
  const I = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) I[y * w + x] = (x < 20 ? 0.2 : 0.8) + (rand() - 0.5) * 0.06;
  const q = guidedFilter(I, I, w, h, 3, 0.004);
  const patch = (a) => { const v = []; for (let y = 10; y < 30; y++) for (let x = 4; x < 14; x++) v.push(a[y * w + x]); return v; };
  assert.ok(std(patch(q)) < std(patch(I)) * 0.6, `${std(patch(q))} vs ${std(patch(I))}`);
  for (let y = 10; y < 30; y++) {
    assert.ok(Math.abs(q[y * w + 18] - 0.2) < 0.06, `left of edge ${q[y * w + 18]}`);
    assert.ok(Math.abs(q[y * w + 21] - 0.8) < 0.06, `right of edge ${q[y * w + 21]}`);
  }
});

test('the coarse person mask snaps to the edges in the photo', () => {
  const w = 96, h = 96;
  const inside = (x) => x >= 37 && x < 61; // the real person
  const data = image(w, h, (x) => (inside(x) ? [40, 40, 50] : [225, 220, 210]));
  // a blocky, blurred 12×12 mask that is a few pixels off, like a 256-px model scaled up
  const mw = 12, mh = 12, coarse = new Float32Array(mw * mh);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) coarse[y * mw + x] = x >= 4 && x < 8 ? 1 : x === 3 || x === 8 ? 0.5 : 0;
  const truth = (x) => (inside(x) ? 1 : 0);
  const rough = cropMask(coarse, mw, mh, null, w, h);
  const alpha = personAlpha(data, w, h, coarse, mw, mh, null);
  let e0 = 0, e1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { e0 += Math.abs(rough[y * w + x] - truth(x)); e1 += Math.abs(alpha[y * w + x] - truth(x)); }
  assert.ok(e1 < e0 * 0.8, `refined error ${e1.toFixed(0)} vs coarse ${e0.toFixed(0)}`);
});

test('background blur: busy background goes soft, the person stays sharp, no halo', () => {
  const w = 120, h = 160;
  const person = (x, y) => x >= 45 && x < 75 && y >= 30 && y < 150;
  const data = image(w, h, (x, y) => (person(x, y) ? [230, 20, 20] : ((x >> 1) + (y >> 1)) % 2 ? [255, 255, 255] : [0, 0, 0]));
  const before = Uint8ClampedArray.from(data);
  const alpha = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) alpha[y * w + x] = person(x, y) ? 1 : 0;
  bokeh(data, w, h, alpha);
  const far = (d) => { const v = []; for (let y = 20; y < 140; y++) for (let x = 2; x < 30; x++) v.push(d[(y * w + x) * 4]); return v; };
  assert.ok(std(far(data)) < std(far(before)) * 0.3, `background std ${std(far(data))} vs ${std(far(before))}`);
  for (let y = 30; y < 150; y++) for (let x = 45; x < 75; x++) assert.equal(data[(y * w + x) * 4], 230);
  // the background right next to the person must not pick up its red
  for (let y = 40; y < 140; y++) {
    for (const x of [42, 43, 44, 75, 76, 77]) {
      const i = (y * w + x) * 4;
      assert.ok(data[i] - (data[i + 1] + data[i + 2]) / 2 < 20, `halo at ${x},${y}: ${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
  }
});

test('the ground at the feet stays sharper than the background', () => {
  assert.equal(groundFactor(0.5, 0.9), 1);
  assert.equal(groundFactor(0.95, 0.9), PORTRAIT.ground);
  assert.ok(groundFactor(0.84, 0.9) < 1 && groundFactor(0.84, 0.9) > PORTRAIT.ground);
  assert.equal(groundFactor(0.95, null), 1, 'half-length shot: no ground');
  const w = 60, h = 100;
  const data = image(w, h, (x, y) => (((x >> 1) + (y >> 1)) % 2 ? [255, 255, 255] : [0, 0, 0]));
  const before = Uint8ClampedArray.from(data);
  bokeh(data, w, h, new Float32Array(w * h), { feet: 0.8 });
  const rows = (d, y0, y1) => { const v = []; for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) v.push(d[(y * w + x) * 4]); return v; };
  const kept = (y0, y1) => std(rows(data, y0, y1)) / std(rows(before, y0, y1));
  assert.ok(kept(85, 98) > kept(10, 50) + 0.3, `ground ${kept(85, 98)} vs sky ${kept(10, 50)}`);
});

test('skin smoothing softens skin and leaves everything else untouched', () => {
  const w = 60, h = 60;
  const isSkin = (x, y) => x >= 15 && x < 45 && y >= 15 && y < 45;
  const data = image(w, h, (x, y) => { const n = (rand() - 0.5) * 30; return [200 + n, 160 + n, 140 + n]; });
  const before = Uint8ClampedArray.from(data);
  const skin = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) skin[y * w + x] = isSkin(x, y) ? 1 : 0;
  assert.equal(smoothSkin(data, w, h, skin), true);
  const vals = (d) => { const v = []; for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) v.push(d[(y * w + x) * 4 + 1]); return v; };
  assert.ok(std(vals(data)) < std(vals(before)) * 0.7, `${std(vals(data))} vs ${std(vals(before))}`);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isSkin(x, y)) continue;
      const i = (y * w + x) * 4;
      assert.ok(data[i] === before[i] && data[i + 1] === before[i + 1] && data[i + 2] === before[i + 2], `changed outside skin at ${x},${y}`);
    }
  }
  assert.equal(smoothSkin(data, w, h, new Float32Array(w * h)), false, 'no skin, nothing to do');
});
