// 照着拍: compare the live frame with a reference photo.
// With a person in the reference, compare pose (limb angles), position and size.
// Without one, compare the scene itself by sliding small grayscale thumbnails.

import { clamp, mid, visible, personGeometry } from './geom.js';
import { finish, levelRule } from './guide.js';
import { lightRules } from './light.js';

const LIMBS = [
  { id: 'torso', a: 'sh', b: 'hip', part: '上身', w: 1.2 },
  { id: 'l-up', a: 11, b: 13, part: '左手臂', w: 1 },
  { id: 'l-lo', a: 13, b: 15, part: '左手', w: 0.9 },
  { id: 'r-up', a: 12, b: 14, part: '右手臂', w: 1 },
  { id: 'r-lo', a: 14, b: 16, part: '右手', w: 0.9 },
  { id: 'l-th', a: 23, b: 25, part: '左腿', w: 0.8 },
  { id: 'l-sh', a: 25, b: 27, part: '左小腿', w: 0.6 },
  { id: 'r-th', a: 24, b: 26, part: '右腿', w: 0.8 },
  { id: 'r-sh', a: 26, b: 28, part: '右小腿', w: 0.6 },
];

const BONE_LIMB = {
  '11-13': 'l-up', '13-15': 'l-lo', '12-14': 'r-up', '14-16': 'r-lo',
  '23-25': 'l-th', '25-27': 'l-sh', '24-26': 'r-th', '26-28': 'r-sh',
  '11-12': 'torso', '11-23': 'torso', '12-24': 'torso', '23-24': 'torso',
};
export const boneLimb = (a, b) => BONE_LIMB[`${a}-${b}`];

const deg = (r) => (r * 180) / Math.PI;
const pt = (lm, k) => (k === 'sh' ? mid(lm[11], lm[12]) : k === 'hip' ? mid(lm[23], lm[24]) : lm[k]);

function usable(lm, limb, m = 0.02) {
  const vis = (k) => typeof k === 'string' || visible(lm[k]);
  const inside = (p) => p.x >= -m && p.x <= 1 + m && p.y >= -m && p.y <= 1 + m;
  return vis(limb.a) && vis(limb.b) && inside(pt(lm, limb.a)) && inside(pt(lm, limb.b));
}

function vec(lm, limb, aspect) {
  const a = pt(lm, limb.a), b = pt(lm, limb.b);
  return { x: (b.x - a.x) * aspect, y: b.y - a.y };
}

function angDiff(u, v) {
  let d = Math.abs(Math.atan2(u.y, u.x) - Math.atan2(v.y, v.x));
  if (d > Math.PI) d = 2 * Math.PI - d;
  return deg(d);
}

// 0 = pointing straight down, 180 = straight up.
function elevation(v) {
  const n = Math.hypot(v.x, v.y) || 1;
  return deg(Math.acos(clamp(v.y / n, -1, 1)));
}

const anchor = (g) => ({ x: (g.sh.x + g.hip.x) / 2, y: (g.sh.y + g.hip.y) / 2 });

export function prepareReference(lm, aspect) {
  if (!lm) return null;
  const limbs = LIMBS.filter((l) => usable(lm, l));
  if (!limbs.length) return null;
  return { lm, geo: personGeometry(lm, aspect), limbs };
}

// extra: more hints to weigh in, e.g. the template's camera angle (templates.js cameraHint).
export function compareToReference(ref, lm, aspect, selfie, tilt, light = null, extra = []) {
  const hints = [...extra];
  if (!lm) {
    hints.push({ id: 'm-none', level: 'bad', order: 0, text: selfie ? '人站进画面里' : '让TA站进画面', why: '还没找到人' });
    levelRule(tilt, 'person', hints);
    return finish('person', null, hints, { similarity: 0, limbScores: {} });
  }

  const g = personGeometry(lm, aspect);
  const rg = ref.geo;

  let sum = 0, wsum = 0, worst = null;
  const limbScores = {};
  for (const limb of ref.limbs) {
    wsum += limb.w;
    if (!usable(lm, limb, 0.08)) { limbScores[limb.id] = 0; continue; }
    const vr = vec(ref.lm, limb, aspect), vl = vec(lm, limb, aspect);
    const d = angDiff(vr, vl);
    const s = clamp(1 - d / 70, 0, 1);
    limbScores[limb.id] = s;
    sum += s * limb.w;
    if (d > 22 && (!worst || d * limb.w > worst.d * worst.limb.w)) worst = { limb, d, vr, vl };
  }
  const pose = wsum ? sum / wsum : 0;

  const ratio = g.torsoH / rg.torsoH; // > 1: the live person is bigger than in the reference
  const ra = anchor(rg), la = anchor(g);
  const dx = ra.x - la.x, dy = ra.y - la.y;
  const posScore = clamp(1 - Math.hypot(dx * aspect, dy) / 0.3, 0, 1);
  const sizeScore = clamp(1 - Math.abs(Math.log(ratio)) / 0.5, 0, 1);
  const similarity = 0.6 * pose + 0.25 * posScore + 0.15 * sizeScore;

  if (Math.abs(Math.log(ratio)) > 0.15) {
    const grow = ratio < 1;
    hints.push({
      id: 'm-size', level: 'warn', order: 1,
      text: grow ? (selfie ? '手机拿近一点' : '往前走一步') : (selfie ? '手机拿远一点' : '往后退一步'),
      why: grow ? '人比参考图里小' : '人比参考图里大',
    });
  }
  if (Math.abs(dx) > 0.06) {
    const screenDir = (selfie ? -dx : dx) > 0 ? '右' : '左';
    hints.push({
      id: 'm-x', level: 'warn', order: 2,
      text: selfie ? `人往${screenDir}挪一点` : `手机往${dx < 0 ? '右' : '左'}转一点`,
      why: '对齐参考图里的位置', arrow: { from: la, to: { x: ra.x, y: la.y } },
    });
  } else if (Math.abs(dy) > 0.06) {
    hints.push({
      id: 'm-y', level: 'warn', order: 2,
      text: dy > 0 ? (selfie ? '手机举高一点' : '手机往上抬一点') : (selfie ? '手机放低一点' : '手机往下压一点'),
      why: '对齐参考图里的高度', arrow: { from: la, to: { x: la.x, y: ra.y } },
    });
  }
  if (worst) {
    let action;
    if (worst.limb.id === 'torso') {
      // Shoulders should move toward this side of the screen (the photographer's own left/right).
      const lean = worst.vr.x - worst.vl.x; // torso vector points shoulders -> hips
      const right = (selfie ? lean : -lean) > 0;
      action = selfie ? `上身往${right ? '右' : '左'}歪一点` : `上身往你${right ? '右' : '左'}手边歪一点`;
    } else {
      const er = elevation(worst.vr), el = elevation(worst.vl);
      if (er - el > 15) action = `${worst.limb.part}抬高一点`;
      else if (el - er > 15) action = `${worst.limb.part}放低一点`;
      else action = `${worst.limb.part}换个方向，对齐虚线`;
    }
    hints.push({
      id: `m-limb-${worst.limb.id}`, level: worst.d > 35 ? 'warn' : 'tip', order: 3,
      text: selfie ? action : `让TA${action}`, why: '照着虚线摆姿势', voice: action,
    });
  }
  lightRules(light, selfie, hints);
  levelRule(tilt, 'person', hints);

  const res = finish('person', g, hints, { similarity, limbScores, pose });
  res.ready = similarity >= 0.8 && !hints.some((h) => h.level !== 'tip');
  return res;
}

export function grayOf(img) {
  const { data, width, height } = img;
  const g = new Float32Array(width * height);
  for (let i = 0; i < g.length; i++) {
    g[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
  }
  return g;
}

// Normalized cross-correlation of a(x, y) against b(x + sx, y + sy) over the overlap.
function ncc(a, b, w, h, sx, sy) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  const x0 = Math.max(0, -sx), x1 = Math.min(w, w - sx);
  const y0 = Math.max(0, -sy), y1 = Math.min(h, h - sy);
  for (let y = y0; y < y1; y++) {
    const ra = y * w, rb = (y + sy) * w + sx;
    for (let x = x0; x < x1; x++) {
      const va = a[ra + x], vb = b[rb + x];
      sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; n++;
    }
  }
  if (n < 10) return -1;
  const cov = sab - (sa * sb) / n, va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n;
  return va > 1e-6 && vb > 1e-6 ? cov / Math.sqrt(va * vb) : 0;
}

export function alignImages(ref, live, w, h, maxShift = 6) {
  let best = { ncc: -1, sx: 0, sy: 0 };
  let ncc0 = 0;
  for (let sy = -maxShift; sy <= maxShift; sy++) {
    for (let sx = -maxShift; sx <= maxShift; sx++) {
      const v = ncc(ref, live, w, h, sx, sy);
      if (sx === 0 && sy === 0) ncc0 = v;
      if (v > best.ncc) best = { ncc: v, sx, sy };
    }
  }
  // Near-ties go to "already aligned", so repetitive textures don't trigger a move.
  if (ncc0 >= best.ncc - 0.01) best = { ncc: ncc0, sx: 0, sy: 0 };
  return { ncc0, ...best };
}

// sx > 0 means the live scene sits to the right of where the reference has it.
export function compareScene(al, selfie, tilt, w, h) {
  const hints = [];
  const similarity = clamp((al.ncc0 - 0.3) / 0.6, 0, 1);
  if (al.ncc < 0.35) {
    hints.push({ id: 's-far', level: 'warn', order: 1, text: '找一找参考图的角度', why: '画面和参考图差得有点多' });
  } else if (Math.abs(al.sx) >= 2 || Math.abs(al.sy) >= 2) {
    const horiz = Math.abs(al.sx) / w >= Math.abs(al.sy) / h;
    let text;
    if (selfie) text = '按箭头方向挪一下手机';
    else if (horiz) text = `手机往${al.sx > 0 ? '右' : '左'}转一点`;
    else text = al.sy > 0 ? '手机往下压一点' : '手机往上抬一点';
    const k = 3;
    hints.push({
      id: 's-shift', level: 'warn', order: 1, text, why: '对齐半透明的参考图',
      arrow: { from: { x: 0.5, y: 0.5 }, to: { x: 0.5 - (al.sx / w) * k, y: 0.5 - (al.sy / h) * k } },
    });
  }
  levelRule(tilt, 'landscape', hints);
  const res = finish('landscape', null, hints, { similarity });
  res.ready = similarity >= 0.75 && !hints.some((x) => x.level !== 'tip');
  return res;
}
