// Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, findHorizon } from '../js/guide.js';
import { prepareReference, compareToReference, alignImages, compareScene } from '../js/match.js';
import { demoFrame, demoPose, DEMO_FINAL } from '../js/demo.js';

const aspect = 3 / 4;
const at = (t, selfie = false) => {
  const f = demoFrame(t, aspect);
  return analyze({ lm: f.lm, aspect, selfie, tilt: f.tilt, horizon: null });
};
const ids = (r) => r.hints.map((h) => h.id);

test('person far to the side: turn the phone toward them first', () => {
  const r = at(0.5);
  assert.equal(r.scene, 'person');
  assert.equal(r.person.shot, 'full');
  assert.equal(r.hints[0].id, 'position');
  assert.equal(r.hints[0].level, 'bad');
  assert.equal(r.hints[0].text, '手机往右转一点');
  assert.ok(r.hints[0].arrow.to.x < r.hints[0].arrow.from.x, 'arrow points left: the person should move left in the frame');
  assert.ok(ids(r).includes('too-small'));
  assert.ok(ids(r).includes('level'));
  assert.equal(r.ready, false);
});

test('selfie preview is mirrored, so the same case says move right', () => {
  const r = at(0.5, true);
  assert.equal(r.hints[0].text, '人往右挪一点');
});

test('after moving over, the person is still too small', () => {
  const r = at(5.8);
  assert.ok(!ids(r).includes('position'));
  assert.equal(r.hints[0].id, 'too-small');
  assert.equal(r.hints[0].text, '往前走两步');
});

test('framed well: ready, with pose tips only', () => {
  const r = at(9);
  assert.equal(r.ready, true, JSON.stringify(r.hints));
  assert.deepEqual(ids(r).sort(), ['arms', 'turn']);
  assert.ok(r.hints.every((h) => h.level === 'tip'));
});

test('turned and hand on hip: no hints left', () => {
  const r = at(14);
  assert.equal(r.ready, true);
  assert.deepEqual(ids(r), []);
});

test('feet cut off at the bottom edge', () => {
  const lm = demoPose({ cx: 0.5, s: 0.85, fb: 1.02 }, aspect);
  const r = analyze({ lm, aspect });
  assert.ok(ids(r).includes('cut-feet'), JSON.stringify(ids(r)));
  assert.equal(r.hints.find((h) => h.id === 'cut-feet').text, '手机往下压一点');
});

test('head cut off with feet at the bottom: step back instead of tilting', () => {
  const lm = demoPose({ cx: 0.5, s: 1.0, fb: 0.96 }, aspect);
  const r = analyze({ lm, aspect });
  const h = r.hints.find((x) => x.id === 'head-cut');
  assert.ok(h, JSON.stringify(ids(r)));
  assert.equal(h.text, '往后退一步');
});

test('small feet gap: tilt up so the feet sit on the bottom edge', () => {
  const lm = demoPose({ cx: 0.5, s: 0.7, fb: 0.82 }, aspect);
  const r = analyze({ lm, aspect });
  assert.equal(r.hints[0].id, 'leg-room');
  assert.equal(r.hints[0].text, '手机往上抬一点');
});

test('level: small tilt ignored, big tilt flagged', () => {
  const lm = demoPose(DEMO_FINAL, aspect);
  assert.ok(!ids(analyze({ lm, aspect, tilt: 1.5 })).includes('level'));
  const r = analyze({ lm, aspect, tilt: -7 });
  assert.equal(r.hints[0].id, 'level');
  assert.equal(r.hints[0].why, '画面歪了 7°');
});

function sceneImage(w, h, horizonY, clouds = false) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const sky = y < horizonY * h;
      let [r, g, b] = sky ? [140, 185, 225] : [90, 120, 70];
      if (sky && clouds && (x * 7 + y * 13) % 5 < 2) { r += 70; g += 50; b += 25; }
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

test('horizon found in the middle of a plain-sky scene', () => {
  const hz = findHorizon(sceneImage(48, 64, 0.5));
  assert.equal(hz.sky, true);
  assert.ok(Math.abs(hz.y - 0.5) < 0.03, String(hz.y));
  assert.equal(hz.cloudy, false);
  const r = analyze({ lm: null, aspect, horizon: hz });
  assert.equal(r.scene, 'landscape');
  assert.equal(r.hints[0].text, '手机往下压一点');
});

test('cloudy sky: put the horizon low instead', () => {
  const hz = findHorizon(sceneImage(48, 64, 0.5, true));
  assert.equal(hz.cloudy, true);
  assert.equal(analyze({ lm: null, aspect, horizon: hz }).hints[0].text, '手机往上抬一点');
});

test('indoor scene without sky: no horizon advice', () => {
  const data = new Uint8ClampedArray(48 * 64 * 4).fill(60);
  assert.equal(findHorizon({ data, width: 48, height: 64 }).sky, false);
});

test('pose matching climbs toward the reference and ends ready', () => {
  const ref = prepareReference(demoPose(DEMO_FINAL, aspect), aspect);
  const early = compareToReference(ref, demoFrame(0.5, aspect).lm, aspect, false, 0);
  const mid = compareToReference(ref, demoFrame(9, aspect).lm, aspect, false, 0);
  const end = compareToReference(ref, demoFrame(14, aspect).lm, aspect, false, 0);
  assert.ok(early.similarity < mid.similarity && mid.similarity < end.similarity);
  assert.ok(end.similarity > 0.97, String(end.similarity));
  assert.equal(end.ready, true);
  assert.equal(early.ready, false);
  assert.equal(early.hints[0].id, 'm-size');
  assert.equal(early.hints[0].text, '往前走一步');
});

test('pose matching names the arm to fix, from the subject\'s side', () => {
  const ref = prepareReference(demoPose(DEMO_FINAL, aspect), aspect);
  const lm = demoPose({ ...DEMO_FINAL, hand: 0 }, aspect);
  const r = compareToReference(ref, lm, aspect, false, 0);
  const limb = r.hints.find((h) => h.id.startsWith('m-limb'));
  assert.ok(limb, JSON.stringify(r.hints));
  assert.match(limb.text, /^让TA左手/);
});

test('scene alignment: shifted view gets a direction', () => {
  const w = 48, h = 64;
  const gray = (img) => Float32Array.from({ length: w * h }, (_, i) => img.data[i * 4] / 255);
  const ref = gray(sceneImage(w, h, 0.4, true));
  const live = gray(sceneImage(w, h, 0.5, true));
  const al = alignImages(ref, live, w, h);
  assert.ok(al.sy > 0, JSON.stringify(al));
  const r = compareScene(al, false, 0, w, h);
  assert.equal(r.hints[0].text, '手机往下压一点');
  const same = compareScene(alignImages(ref, ref, w, h), false, 0, w, h);
  assert.equal(same.ready, true);
});
