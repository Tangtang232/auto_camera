// 出片版: AI framing, light check, and photo development.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAIC_BOXES, SAME_ASPECT, FULL, bestBox, frameHint, boxesContaining } from '../js/frame.js';
import { measureLight, lightRules } from '../js/light.js';
import { measureTone, autoParams, planDevelop, develop, pickStyle } from '../js/develop.js';
import { analyze } from '../js/guide.js';
import { demoPose, DEMO_FINAL } from '../js/demo.js';

const aspect = 3 / 4;

function scoresFavoring(pred) {
  // Higher score for boxes that satisfy pred, slightly preferring larger ones.
  return Float32Array.from(GAIC_BOXES, (b) => (pred(b) ? 2 : 0) + b.w * 0.1);
}

test('candidate grid matches GAIC: 90 boxes, 14 with the viewfinder shape', () => {
  assert.equal(GAIC_BOXES.length, 90);
  assert.equal(SAME_ASPECT.length, 14);
  const full = GAIC_BOXES[FULL];
  assert.ok(Math.abs(full.w - 11 / 12) < 1e-9 && Math.abs(full.x - 0.5 / 12) < 1e-9);
  for (const b of GAIC_BOXES) {
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1 + 1e-9 && b.y + b.h <= 1 + 1e-9);
    assert.ok(b.w * b.h >= 0.5 - 1e-9);
  }
});

test('best crop on the left: turn the phone left', () => {
  const pick = bestBox(scoresFavoring((b) => b.x + b.w / 2 < 0.45), SAME_ASPECT);
  assert.equal(pick.aligned, false);
  const h = frameHint(pick, 'still', false);
  assert.equal(h.id, 'ai-frame');
  assert.equal(h.level, 'warn');
  assert.equal(h.text, '手机往左转一点');
  assert.ok(h.arrow.to.x > h.arrow.from.x, 'content moves right toward the center');
});

test('best crop above center: tilt the phone up', () => {
  const pick = bestBox(scoresFavoring((b) => b.y + b.h / 2 < 0.45 && Math.abs(b.x + b.w / 2 - 0.5) < 0.03), SAME_ASPECT);
  assert.equal(frameHint(pick, 'still', false).text, '手机往上抬一点');
});

test('small centered crop: step closer', () => {
  const pick = bestBox(scoresFavoring((b) => b.rows === 9 && Math.abs(b.x + b.w / 2 - 0.5) < 0.01 && Math.abs(b.y + b.h / 2 - 0.5) < 0.01), SAME_ASPECT);
  assert.equal(frameHint(pick, 'still', false).text, '往前走一点');
});

test('keeping the frame is close to the best: no hint', () => {
  const s = scoresFavoring(() => true);
  const pick = bestBox(s, SAME_ASPECT);
  assert.equal(pick.aligned, true);
  assert.equal(frameHint(pick, 'still', false), null);
});

test('crops must contain the person: a left-only crop is never picked', () => {
  const person = { x0: 0.62, y0: 0.2, x1: 0.84, y1: 0.9 };
  const ids = boxesContaining(person);
  assert.ok(ids.length > 0 && ids.length < SAME_ASPECT.length);
  for (const i of ids) assert.ok(GAIC_BOXES[i].x + GAIC_BOXES[i].w >= 0.82);
  // the model "likes" the empty left side, but those boxes are filtered out
  const pick = bestBox(scoresFavoring((b) => b.x + b.w / 2 < 0.45), ids);
  assert.ok(pick.box.x + pick.box.w >= 0.82);
  assert.equal(boxesContaining({ x0: 0, y0: 0, x1: 1, y1: 1 }).length, 0, 'nothing fits a full-frame subject');
  assert.equal(boxesContaining(null), SAME_ASPECT);
});

test('hysteresis keeps the previous crop unless a new one is clearly better', () => {
  const s = Float32Array.from(GAIC_BOXES, () => 0);
  s[SAME_ASPECT[0]] = 1.0;
  s[SAME_ASPECT[1]] = 1.05;
  s[SAME_ASPECT[5]] = -3;
  assert.equal(bestBox(s, SAME_ASPECT, SAME_ASPECT[0]).index, SAME_ASPECT[0]);
  s[SAME_ASPECT[1]] = 3;
  assert.equal(bestBox(s, SAME_ASPECT, SAME_ASPECT[0]).index, SAME_ASPECT[1]);
});

test('AI framing leads in still scenes and is only a tip with a person', () => {
  const frame = bestBox(scoresFavoring((b) => b.x + b.w / 2 < 0.45), SAME_ASPECT);
  const still = analyze({ lm: null, aspect, frame });
  assert.equal(still.scene, 'still');
  assert.equal(still.hints[0].id, 'ai-frame');
  assert.equal(still.ready, false);
  const person = analyze({ lm: demoPose(DEMO_FINAL, aspect), aspect, frame });
  assert.equal(person.hints.find((h) => h.id === 'ai-frame').level, 'tip');
  assert.equal(person.ready, true);
});

function image(w, h, fill) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fill(x, y);
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

test('backlit face: bright background, dark face', () => {
  const lm = demoPose({ cx: 0.5, s: 0.8, fb: 0.95 }, aspect);
  const w = 48, h = 64;
  const nose = lm[0];
  const img = image(w, h, (x, y) => (Math.abs(x - nose.x * w) < 5 && Math.abs(y - nose.y * h) < 6 ? [40, 35, 30] : [235, 235, 240]));
  const m = measureLight(img, lm);
  assert.ok(m.face < 0.3 && m.mean > 0.8, JSON.stringify(m));
  const out = [];
  lightRules(m, false, out);
  assert.equal(out[0].id, 'backlight');
  assert.equal(out[0].text, '换个方向，让光照在脸上');
});

test('dark scene and blown highlights', () => {
  const dark = [];
  lightRules(measureLight(image(48, 64, () => [20, 20, 25]), null), false, dark);
  assert.deepEqual(dark.map((h) => h.id), ['dark']);
  const bright = [];
  lightRules(measureLight(image(48, 64, (x, y) => (y < 30 ? [255, 255, 255] : [90, 100, 80])), null), false, bright);
  assert.deepEqual(bright.map((h) => h.id), ['blown']);
});

const meanRGB = (data) => {
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
  const n = data.length / 4;
  return [r / n, g / n, b / n];
};

test('auto correction pulls a blue cast back toward neutral', () => {
  const img = image(64, 48, (x, y) => [90 + x, 100 + x, 135 + x + (y % 3)]);
  const before = meanRGB(img.data);
  const plan = planDevelop(measureTone(img.data, 1), 'clear');
  develop(img.data, plan);
  const after = meanRGB(img.data);
  assert.ok(after[2] - after[0] < (before[2] - before[0]) * 0.8, `${before} -> ${after}`);
});

test('levels stretch a flat, low-contrast photo', () => {
  const img = image(64, 48, (x) => { const v = 90 + x; return [v, v, v]; });
  const tone = measureTone(img.data, 1);
  const a = autoParams(tone);
  assert.ok(a.black <= 0.15 && a.white >= 0.82, JSON.stringify(a));
  const plan = planDevelop(tone, 'clear');
  develop(img.data, plan);
  let lo = 255, hi = 0;
  for (let i = 0; i < img.data.length; i += 4) { lo = Math.min(lo, img.data[i]); hi = Math.max(hi, img.data[i]); }
  assert.ok(hi - lo > 63 * 1.3, `range ${lo}-${hi}`);
});

test('looks differ: cream is warmer than clear; original changes nothing', () => {
  const base = () => image(32, 32, (x, y) => [120 + x, 125 + y, 130]);
  const tone = measureTone(base().data, 1);
  const clear = base(); develop(clear.data, planDevelop(tone, 'clear'));
  const cream = base(); develop(cream.data, planDevelop(tone, 'cream'));
  const warmth = (d) => { const [r, , b] = meanRGB(d); return r - b; };
  assert.ok(warmth(cream.data) > warmth(clear.data) + 5);
  assert.equal(planDevelop(tone, 'original'), null);
  const film1 = base(), film2 = base();
  develop(film1.data, planDevelop(tone, 'film'));
  develop(film2.data, planDevelop(tone, 'film'));
  assert.deepEqual(film1.data, film2.data, 'grain is deterministic');
});

test('style choice: portraits get cream, warm scenes get film', () => {
  assert.equal(pickStyle('person', { warm: 1 }), 'cream');
  assert.equal(pickStyle('landscape', { warm: 1.3 }), 'film');
  assert.equal(pickStyle('still', { warm: 1 }), 'clear');
});
