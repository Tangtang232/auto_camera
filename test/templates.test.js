// 出片模板: pose rig, template library, camera-angle hints, 照着调色 and the portrait looks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig, placePose, blendPose } from '../js/rig.js';
import { TEMPLATES, GROUPS, templateById, templatePose, cameraHint } from '../js/templates.js';
import { prepareReference, compareToReference } from '../js/match.js';
import { demoPose, demoTemplateFrame } from '../js/demo.js';
import { colorStats, colorTransfer, measureTone, planDevelop, develop, STYLE_NAMES } from '../js/develop.js';

const aspect = 3 / 4;

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

/* ---------- rig ---------- */

test('the default rig is the familiar standing figure', () => {
  const frame = { cx: 0.5, s: 0.8, fb: 0.955 };
  const a = placePose(rig(), frame, aspect);
  const b = demoPose(frame, aspect);
  assert.equal(a.length, 33);
  a.forEach((p, i) => assert.ok(Math.hypot(p.x - b[i].x, p.y - b[i].y) < 0.015, `point ${i}`));
});

test('rigged poses keep body proportions', () => {
  for (const t of TEMPLATES) {
    const p = rig(t.pose);
    assert.ok(p.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)), t.id);
    const torso = Math.hypot((p[11].x + p[12].x) / 2 - (p[23].x + p[24].x) / 2, (p[11].y + p[12].y) / 2 - (p[23].y + p[24].y) / 2);
    assert.ok(Math.abs(torso - 0.295) < 0.02, `${t.id} torso ${torso}`);
    assert.ok(Math.max(...[27, 28, 29, 30, 31, 32].map((i) => p[i].y)) === 0, `${t.id} feet on the ground`);
  }
});

/* ---------- templates ---------- */

test('the library has both groups, with unique ids and a look for each', () => {
  assert.deepEqual(GROUPS.map((g) => g.key), ['others', 'selfie']);
  assert.equal(TEMPLATES.filter((t) => t.group === 'others').length, 8);
  assert.equal(TEMPLATES.filter((t) => t.group === 'selfie').length, 3);
  assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length);
  for (const t of TEMPLATES) {
    assert.ok(['cream', 'japan', 'film', 'moody'].includes(t.look), t.id);
    assert.ok(t.steps.length >= 2 && t.camera.tip, t.id);
  }
  assert.equal(templateById('walk').name, '走路抓拍');
  assert.equal(templateById('nope'), null);
});

test('every template has enough limbs in frame to guide the pose', () => {
  for (const t of TEMPLATES) {
    const ref = prepareReference(templatePose(t, aspect), aspect);
    const need = t.shot === '全身' ? 7 : 3;
    assert.ok(ref && ref.limbs.length >= need, `${t.id}: ${ref && ref.limbs.length} limbs`);
    const lm = templatePose(t, aspect);
    assert.ok(lm[0].y > 0.05 && lm[0].y < 0.5, `${t.id}: face in the upper half (${lm[0].y.toFixed(2)})`);
  }
});

test('matching a template against itself is ready to shoot', () => {
  for (const t of TEMPLATES) {
    const lm = templatePose(t, aspect);
    const res = compareToReference(prepareReference(lm, aspect), lm, aspect, t.group === 'selfie', 0);
    assert.ok(res.similarity > 0.99, `${t.id} ${res.similarity}`);
    assert.equal(res.ready, true, t.id);
  }
});

test('a hand-on-hip template asks to raise the arm that hangs down', () => {
  const t = templateById('giraffe');
  const ref = prepareReference(templatePose(t, aspect), aspect);
  const hanging = placePose(rig({ ...t.pose, arms: { ...t.pose.arms, left: { up: 8, lo: 4 } } }), t.frame, aspect);
  const res = compareToReference(ref, hanging, aspect, false, 0);
  const limb = res.hints.find((h) => h.id.startsWith('m-limb'));
  assert.ok(limb, JSON.stringify(res.hints));
  assert.match(limb.text, /^让TA左手(臂)?抬高一点$/); // the forearm is off the most, the upper arm too
  assert.equal(res.ready, false);
});

test('camera angle hints follow each template, flipped for selfies', () => {
  const low = templateById('giraffe');
  assert.equal(cameraHint(low, 0).text, '镜头往上仰一点');
  assert.equal(cameraHint(low, 8), null);
  assert.equal(cameraHint(low, 25).text, '镜头往下一点');
  assert.equal(cameraHint(low, null), null);
  const high = templateById('selfie-high');
  assert.equal(cameraHint(high, 20, true), null, 'back camera up 20° = front camera down 20°');
  assert.equal(cameraHint(high, -5, true).text, '手机举高一点');
  assert.equal(cameraHint(high, 40, true).text, '手机放低一点');
  const lm = templatePose(low, aspect);
  const res = compareToReference(prepareReference(lm, aspect), lm, aspect, false, 0, null, [cameraHint(low, 0)]);
  assert.equal(res.ready, false, 'a wrong angle is not aligned yet');
  assert.equal(res.hints[0].id, 't-cam');
});

test('the template demo eases into the pose and the right angle', () => {
  for (const t of [templateById('giraffe'), templateById('steps'), templateById('hair')]) {
    const ref = prepareReference(templatePose(t, aspect), aspect);
    const start = demoTemplateFrame(t, 0, aspect);
    const end = demoTemplateFrame(t, 11, aspect);
    const at = (f) => compareToReference(ref, f.lm, aspect, false, 0, null, [cameraHint(t, f.sensors.elev)].filter(Boolean));
    assert.equal(at(start).ready, false, t.id);
    assert.equal(at(end).ready, true, t.id);
  }
  const mid = blendPose([{ x: 0, y: 0 }], [{ x: 1, y: 2 }], 0.5);
  assert.deepEqual(mid, [{ x: 0.5, y: 1 }]);
});

/* ---------- 照着调色 and looks ---------- */

const meanRGB = (data) => {
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
  const n = data.length / 4;
  return [r / n, g / n, b / n];
};

test('照着调色 moves the photo toward the reference colors', () => {
  const warmRef = image(40, 40, (x, y) => [200 + (x % 20), 150 + (y % 20), 90 + (x % 10)]);
  const target = colorStats(warmRef.data, 1);
  const photo = image(40, 40, (x, y) => [110 + x, 120 + y, 140 + (x % 7)]);
  const before = colorStats(photo.data, 1);
  colorTransfer(photo.data, target);
  const after = colorStats(photo.data, 1);
  // b* (blue → yellow) and a* move most of the way toward the warm reference
  assert.ok(after.mean[2] - before.mean[2] > (target.mean[2] - before.mean[2]) * 0.6, `${before.mean[2]} -> ${after.mean[2]} (target ${target.mean[2]})`);
  assert.ok(Math.abs(after.mean[1] - target.mean[1]) < Math.abs(before.mean[1] - target.mean[1]));
  // brightness only half way
  const dL = Math.abs(after.mean[0] - before.mean[0]), want = Math.abs(target.mean[0] - before.mean[0]);
  assert.ok(dL <= want * 0.5 + 2, `L moved ${dL} of ${want}`);
});

test('照着调色 with the photo\'s own colors changes almost nothing', () => {
  const img = image(30, 30, (x, y) => [60 + x * 4, 80 + y * 3, 120 + x * 2]);
  const copy = Uint8ClampedArray.from(img.data);
  colorTransfer(img.data, colorStats(img.data, 1));
  let worst = 0;
  for (let i = 0; i < copy.length; i++) worst = Math.max(worst, Math.abs(copy[i] - img.data[i]));
  assert.ok(worst <= 3, `max change ${worst}`);
});

test('portrait looks: 日系 is cooler than 奶油, 暗调 is darker than 清透', () => {
  const base = () => image(32, 32, (x, y) => [120 + x * 2, 110 + y * 2, 100 + x]);
  const tone = measureTone(base().data, 1);
  const run = (k) => { const im = base(); develop(im.data, planDevelop(tone, k)); return meanRGB(im.data); };
  const warm = ([r, , b]) => r - b;
  const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
  assert.ok(warm(run('japan')) < warm(run('cream')) - 5);
  assert.ok(luma(run('moody')) < luma(run('clear')) - 8);
  assert.equal(STYLE_NAMES.japan, '日系');
  assert.equal(STYLE_NAMES.moody, '暗调');
  assert.equal(STYLE_NAMES.match, '参考色调');
});
