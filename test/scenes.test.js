// 分场景出片: scene detection, per-scene guidance, and per-scene development.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUP_OF, groupScores, freshScene, addClassification, stepScene, isSunsetSky,
  cameraElevation, flatDeviation, sceneRules, SHAKE_LIMIT,
} from '../js/scene.js';
import { analyze, findHorizon } from '../js/guide.js';
import { measureLight, faceBox } from '../js/light.js';
import { measureTone, planDevelop, develop, pickStyle, chromaDenoise, fillLight } from '../js/develop.js';
import { correctVertical, shouldCorrect, rowSource } from '../js/perspective.js';
import { demoPose, DEMO_FINAL } from '../js/demo.js';

const aspect = 3 / 4;
const NORMAL = { mean: 0.45, clip: 0, face: null, top: [0.5, 0.55, 0.62], bottom: 0.4 };

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

const meanRGB = (data) => {
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
  const n = data.length / 4;
  return [r / n, g / n, b / n];
};

/* ---------- detection ---------- */

test('classifier labels map to scene groups', () => {
  assert.equal(GROUP_OF.get(963), 'food'); // pizza
  assert.equal(GROUP_OF.get(926), 'food'); // hot pot
  assert.equal(GROUP_OF.get(809), 'food'); // soup bowl
  assert.equal(GROUP_OF.get(207), 'pet'); // golden retriever
  assert.equal(GROUP_OF.get(281), 'pet'); // tabby
  assert.equal(GROUP_OF.get(497), 'city'); // church
  assert.equal(GROUP_OF.get(919), 'city'); // street sign
  assert.equal(GROUP_OF.get(958), undefined); // hay
  assert.equal(GROUP_OF.get(134), undefined); // crane (the bird)
  const g = groupScores([{ index: 926, score: 0.2 }, { index: 925, score: 0.15 }, { index: 923, score: 0.1 }, { index: 497, score: 0.05 }]);
  assert.ok(Math.abs(g.food - 0.45) < 1e-9 && Math.abs(g.city - 0.05) < 1e-9 && g.pet === 0);
});

test('a scene shows only after holding for a second, then sticks', () => {
  const s = freshScene();
  addClassification(s, [{ index: 963, score: 0.8 }], 1);
  assert.equal(stepScene(s, NORMAL, 0), null);
  assert.equal(stepScene(s, NORMAL, 600), null);
  assert.equal(stepScene(s, NORMAL, 1000), 'food');
  addClassification(s, [], 0.5); // one weak reading: 0.4 stays above the exit level
  assert.equal(stepScene(s, NORMAL, 1100), 'food');
});

test('pets win over food, food over city', () => {
  const s = freshScene();
  addClassification(s, [{ index: 963, score: 0.6 }, { index: 207, score: 0.4 }, { index: 497, score: 0.5 }], 1);
  stepScene(s, NORMAL, 0);
  assert.equal(stepScene(s, NORMAL, 1000), 'pet');
});

test('dim light becomes a night scene, with hysteresis', () => {
  const s = freshScene();
  const dark = { ...NORMAL, mean: 0.1, top: [0.08, 0.08, 0.12], bottom: 0.1 };
  stepScene(s, dark, 0);
  assert.equal(stepScene(s, dark, 1000), 'night');
  assert.equal(s.lowLight, true);
  stepScene(s, { ...dark, mean: 0.21 }, 1100);
  assert.equal(s.lowLight, true, 'stays dim until clearly brighter');
  stepScene(s, { ...dark, mean: 0.3 }, 1200);
  assert.equal(s.lowLight, false);
});

test('sunset needs a warm sky over darker ground and a warm horizon', () => {
  const glow = { mean: 0.4, clip: 0.02, face: null, top: [0.9, 0.5, 0.25], bottom: 0.15 };
  assert.equal(isSunsetSky(glow), true);
  assert.equal(isSunsetSky({ ...glow, top: [0.5, 0.55, 0.65] }), false, 'blue sky');
  assert.equal(isSunsetSky({ ...glow, bottom: 0.6 }), false, 'ground as bright as the sky');
  const room = freshScene();
  stepScene(room, glow, 0, 1000, false);
  assert.equal(stepScene(room, glow, 2000, 1000, false), null, 'no horizon: a warm-lit room is not a sunset');
  const s = freshScene();
  stepScene(s, glow, 0, 1000, true);
  assert.equal(stepScene(s, glow, 1000, 1000, true), 'sunset');
});

test('camera elevation from the orientation sensor', () => {
  assert.equal(cameraElevation(90), 0);
  assert.equal(cameraElevation(45), -45);
  assert.equal(cameraElevation(0), -90);
  assert.equal(cameraElevation(110), 20);
  assert.equal(cameraElevation(-20), -90);
  assert.equal(cameraElevation(60, true), null, 'sideways');
  assert.equal(cameraElevation(null), null);
  assert.equal(flatDeviation(3, -8), 8);
});

/* ---------- guidance ---------- */

const rules = (scene, ctx) => { const out = []; sceneRules(scene, ctx, out); return out; };

test('food: shoot from above, and level when straight down', () => {
  assert.equal(rules('food', { elev: 0 })[0].text, '手机往下压，从斜上方拍');
  assert.equal(rules('food', { elev: -45 }).length, 0);
  assert.equal(rules('food', { elev: -88, flatDev: 12 })[0].text, '手机端平');
  assert.equal(rules('food', { elev: -88, flatDev: 3 }).length, 0);
  assert.equal(rules('food', {})[0].level, 'tip', 'no sensor: a gentle tip only');
});

test('pet: get down to eye level', () => {
  assert.equal(rules('pet', { elev: -50 })[0].text, '蹲下来，和它眼睛一样高');
  const level = rules('pet', { elev: -10 });
  assert.deepEqual(level.map((h) => h.level), ['tip']);
});

test('city: keep the phone upright', () => {
  assert.equal(rules('city', { elev: 14 })[0].text, '手机竖直，别仰着拍');
  assert.equal(rules('city', { elev: -12 })[0].text, '手机别往下压');
  assert.equal(rules('city', { elev: 4 }).length, 0);
});

test('night: hold still', () => {
  assert.equal(rules('night', { shake: SHAKE_LIMIT + 10 })[0].id, 'steady');
  assert.equal(rules('night', { shake: 3 }).length, 0);
  assert.equal(rules('person', { lowLight: true, shake: 30 })[0].order, 6, 'portraits in dim light too, after framing');
});

test('analyze: food scene blocks until the angle is right', () => {
  const bad = analyze({ lm: null, aspect, light: NORMAL, context: { kind: 'food', elev: 0 } });
  assert.equal(bad.scene, 'food');
  assert.equal(bad.hints[0].text, '手机往下压，从斜上方拍');
  assert.equal(bad.ready, false);
  const good = analyze({ lm: null, aspect, light: NORMAL, context: { kind: 'food', elev: -45 } });
  assert.equal(good.ready, true);
});

test('analyze: a picked scene overrides the detected one', () => {
  const lm = demoPose(DEMO_FINAL, aspect);
  const pet = analyze({ lm, aspect, light: NORMAL, context: { override: 'pet', elev: -50 } });
  assert.equal(pet.scene, 'pet');
  assert.equal(pet.hints[0].text, '蹲下来，和它眼睛一样高');
  const nobody = analyze({ lm: null, aspect, light: NORMAL, context: { override: 'person', kind: 'food' } });
  assert.equal(nobody.scene, 'none');
});

test('analyze: night drops "find more light" and asks to hold still', () => {
  const dim = { ...NORMAL, mean: 0.08 };
  const shaky = analyze({ lm: null, aspect, light: dim, context: { kind: 'night', lowLight: true, shake: 30 } });
  assert.equal(shaky.hints[0].id, 'steady');
  assert.ok(!shaky.hints.some((h) => h.id === 'dark'));
  const still = analyze({ lm: null, aspect, light: dim, context: { kind: 'night', lowLight: true, shake: 2 } });
  assert.equal(still.ready, true);
  const dimRoom = analyze({ lm: null, aspect, light: dim, horizon: null, frame: null, context: {} });
  assert.ok(dimRoom.hints.some((h) => h.id === 'dark'), 'outside a night scene the old advice stays');
});

test('analyze: sunset keeps the horizon low; a warm horizon alone is not a landscape', () => {
  const h = { sky: true, y: 0.45, warm: true };
  const r = analyze({ lm: null, aspect, horizon: h, light: NORMAL, context: { kind: 'sunset', sunset: true } });
  assert.equal(r.hints[0].text, '手机往上抬一点');
  assert.equal(r.hints[0].horizon.target, 2 / 3);
  const low = analyze({ lm: null, aspect, horizon: { ...h, y: 0.66 }, light: NORMAL, context: { kind: 'sunset', sunset: true } });
  assert.equal(low.ready, true);
  const wall = analyze({ lm: null, aspect, horizon: h, light: NORMAL, context: {} });
  assert.notEqual(wall.scene, 'landscape');
});

test('analyze: backlight at sunset is a tip about silhouettes', () => {
  const lm = demoPose(DEMO_FINAL, aspect);
  const light = { ...NORMAL, mean: 0.6, face: 0.2 };
  const plain = analyze({ lm, aspect, light, context: {} });
  assert.equal(plain.hints.find((x) => x.id === 'backlight').level, 'warn');
  const dusk = analyze({ lm, aspect, light, context: { sunset: true } });
  const b = dusk.hints.find((x) => x.id === 'backlight');
  assert.equal(b.level, 'tip');
  assert.match(b.text, /剪影/);
});

test('analyze: a crooked phone comes first in a city shot', () => {
  const r = analyze({ lm: null, aspect, tilt: 4, light: NORMAL, context: { kind: 'city', elev: 0 } });
  assert.equal(r.hints[0].id, 'level');
});

test('findHorizon accepts an orange sky and marks it warm', () => {
  const img = image(48, 64, (x, y) => (y < 30 ? [235, 150, 80] : [40, 32, 45]));
  const h = findHorizon(img);
  assert.equal(h.warm, true);
  assert.ok(Math.abs(h.y - 30 / 64) < 0.06, String(h.y));
  const blue = findHorizon(image(48, 64, (x, y) => (y < 30 ? [150, 190, 235] : [60, 90, 50])));
  assert.equal(blue.warm, false);
});

test('measureLight reports the sky color and the ground brightness', () => {
  const m = measureLight(image(48, 64, (x, y) => (y < 25 ? [230, 140, 70] : [30, 30, 30])), null);
  assert.ok(m.top[0] > 0.85 && m.top[2] < 0.3);
  assert.ok(m.bottom < 0.15);
  const lm = demoPose({ cx: 0.5, s: 0.8, fb: 0.95 }, aspect);
  const f = faceBox(lm, aspect);
  assert.ok(f.x0 < lm[0].x && lm[0].x < f.x1 && f.y0 < lm[0].y && lm[0].y < f.y1);
});

/* ---------- development ---------- */

test('each scene gets its look', () => {
  assert.equal(pickStyle('food', { warm: 1 }), 'food');
  assert.equal(pickStyle('pet', { warm: 1 }), 'pet');
  assert.equal(pickStyle('city', { warm: 1 }), 'city');
  assert.equal(pickStyle('night', { warm: 1 }), 'night');
  assert.equal(pickStyle('sunset', { warm: 1 }), 'sunset');
  assert.equal(pickStyle('person', { warm: 1 }), 'cream');
});

test('food is warmer and more colorful than clear; city is cooler', () => {
  const base = () => image(32, 32, (x, y) => [110 + x * 2, 100 + y * 2, 90 + x]);
  const tone = measureTone(base().data, 1);
  const run = (k) => { const im = base(); develop(im.data, planDevelop(tone, k)); return im.data; };
  const warmth = (d) => { const [r, , b] = meanRGB(d); return r - b; };
  const chroma = (d) => {
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
    return s / (d.length / 4);
  };
  const clear = run('clear'), food = run('food'), city = run('city');
  assert.ok(warmth(food) > warmth(clear) + 3, `${warmth(food)} vs ${warmth(clear)}`);
  assert.ok(chroma(food) > chroma(clear) + 3, `${chroma(food)} vs ${chroma(clear)}`);
  assert.ok(warmth(city) < warmth(clear), `${warmth(city)} vs ${warmth(clear)}`);
});

test('sunset keeps its warmth instead of white-balancing it away', () => {
  const base = () => image(32, 32, (x, y) => [200 - y, 120 - y, 70 - y / 2]);
  const tone = measureTone(base().data, 1);
  const before = meanRGB(base().data);
  const s = base(); develop(s.data, planDevelop(tone, 'sunset'));
  const c = base(); develop(c.data, planDevelop(tone, 'clear'));
  const warm = (d) => { const [r, , b] = meanRGB(d); return r - b; };
  assert.ok(warm(s.data) > warm(c.data) + 10, `${warm(s.data)} vs ${warm(c.data)}`);
  assert.ok(warm(s.data) >= (before[0] - before[2]) * 0.9);
});

test('chroma denoise removes color speckle and keeps brightness', () => {
  let seed = 3;
  const rand = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  const img = image(40, 40, () => { const n1 = (rand() - 0.5) * 60, n2 = (rand() - 0.5) * 60; return [120 + n1, 120, 120 + n2]; });
  const luma = (d) => { const out = []; for (let i = 0; i < d.length; i += 4) out.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); return out; };
  const spread = (d) => { let s = 0; for (let i = 0; i < d.length; i += 4) { const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; s += (d[i] - y) ** 2 + (d[i + 2] - y) ** 2; } return s / (d.length / 4); };
  const l0 = luma(img.data), s0 = spread(img.data);
  chromaDenoise(img.data, 40, 40, 2);
  const l1 = luma(img.data);
  assert.ok(spread(img.data) < s0 * 0.25, `${spread(img.data)} vs ${s0}`);
  assert.ok(l0.every((v, i) => Math.abs(v - l1[i]) < 1.6), 'brightness per pixel unchanged');
});

test('fill light brightens a backlit face only', () => {
  const w = 60, h = 80;
  const face = { x0: 0.4, x1: 0.6, y0: 0.2, y1: 0.4 };
  const inFace = (x, y) => x >= 24 && x < 36 && y >= 16 && y < 32;
  const img = image(w, h, (x, y) => (inFace(x, y) ? [60, 45, 40] : [215, 215, 220]));
  const faceMean = () => { let s = 0, n = 0; for (let y = 16; y < 32; y++) for (let x = 24; x < 36; x++) { s += img.data[(y * w + x) * 4]; n++; } return s / n; };
  const before = faceMean();
  assert.equal(fillLight(img.data, w, h, face), true);
  assert.ok(faceMean() > before + 20, `${before} -> ${faceMean()}`);
  assert.equal(img.data[((h - 1) * w + 0) * 4], 215, 'far corner untouched');
  const lit = image(w, h, () => [180, 170, 160]);
  assert.equal(fillLight(lit.data, w, h, face), false, 'a well-lit face is left alone');
});

/* ---------- perspective ---------- */

// Paints what a camera tilted up by elevDeg sees of vertical stripes: each photo pixel is traced
// back to the upright view (the inverse of rowSource) and colored by the stripe there.
function tiltedStripes(w, h, elevDeg, focal) {
  const f = focal * Math.max(w, h);
  const phi = (elevDeg * Math.PI) / 180;
  const c = Math.cos(phi), s = Math.sin(phi);
  const cx = w / 2, cy = h / 2;
  return image(w, h, (us, vs) => {
    const xr = (us + 0.5 - cx) / f, yr = (vs + 0.5 - cy) / f;
    const z = yr * s + c; // depth along the upright view; verticals only depend on x / z
    const u = cx + (f * xr) / z;
    return Math.floor(u / 12) % 2 === 0 ? [255, 255, 255] : [0, 0, 0];
  });
}

const edgesInRow = (img, row) => {
  const out = [];
  for (let x = 1; x < img.width; x++) {
    const a = img.data[(row * img.width + x - 1) * 4], b = img.data[(row * img.width + x) * 4];
    if ((a > 127) !== (b > 127)) out.push(x);
  }
  return out;
};

test('perspective: a camera tilted up makes verticals lean in; correction straightens them', () => {
  const focal = 0.9;
  const src = tiltedStripes(120, 160, 15, focal);
  assert.ok(edgesInRow(src, 2).length > edgesInRow(src, 157).length, 'more, narrower stripes at the top');
  const out = correctVertical(src, 15, { amount: 1, focal });
  assert.ok(out && out.width > 60 && out.height > 80, JSON.stringify(out && [out.width, out.height]));
  const top = edgesInRow(out, 1), bottom = edgesInRow(out, out.height - 2);
  assert.equal(top.length, bottom.length);
  top.forEach((x, i) => assert.ok(Math.abs(x - bottom[i]) <= 1, `edge ${i}: ${x} vs ${bottom[i]}`));
  assert.ok(Math.abs(out.width / out.height - 0.75) < 0.02, 'keeps the photo shape');
});

test('perspective: only for small tilts', () => {
  assert.equal(shouldCorrect(null), false);
  assert.equal(shouldCorrect(2), false);
  assert.equal(shouldCorrect(-10), true);
  assert.equal(shouldCorrect(25), false);
  const r = rowSource(80, 120, 160, 0, 144);
  assert.ok(Math.abs(r.sy - 80) < 1e-9 && Math.abs(r.k - 1) < 1e-9, 'no tilt, no change');
});
