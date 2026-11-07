// Smart guidance: turns what the camera sees into one prioritized list of hints.
//
// Every hint has:
//   id     stable key, used to keep the on-screen hint from flickering
//   level  'bad' | 'warn' | 'tip'   (tips never block "可以拍了")
//   text   the action, short enough to read at a glance
//   why    the reason, shown smaller
//   voice  optional wording for speech (addressed to the person being photographed)
//   arrow  optional {from, to} in photo coords: where the content of the frame should move
//   box / edge / horizon  optional extra visuals
//
// Phone movements follow one rule: tilting the phone up (or raising it) moves
// everything in the frame down, and turning the phone right moves everything left.

import { P, clamp, angleAt, personGeometry } from './geom.js';
import { frameHint } from './frame.js';
import { lightRules } from './light.js';
import { sceneRules } from './scene.js';

const THIRDS = [1 / 3, 1 / 2, 2 / 3];
const nearest = (arr, v) => arr.reduce((b, t) => (Math.abs(t - v) < Math.abs(b - v) ? t : b));
const RANK = { bad: 0, warn: 1, tip: 2 };

// light: from measureLight(); frame: the AI crop pick from bestBox(), or null.
// context (all optional): {override, kind, lowLight, sunset, elev, flatDev, shake}
//   override  a scene the user picked by hand; kind  the scene the classifier settled on
//   elev / flatDev / shake  the phone's angle and steadiness, from the motion sensors
export function analyze({ lm, aspect, selfie = false, tilt = null, horizon = null, light = null, frame = null, context = null }) {
  const ctx = context || {};
  const forced = ctx.override || null;
  const hints = [];
  let scene = 'none';
  let person = null;
  if (lm && (!forced || forced === 'person')) {
    scene = 'person';
    person = personGeometry(lm, aspect);
    framingRules(person, lm, selfie, hints);
    poseRules(person, lm, aspect, selfie, hints);
  } else if (forced !== 'person') {
    const level = horizon && horizon.y != null;
    const kind = forced || ctx.kind || null;
    // A warm "sky" without a sunset is more likely a lit wall than a horizon.
    if (kind) scene = kind;
    else if (level && !horizon.warm) scene = 'landscape';
    else if (frame) scene = 'still';
    if (level && (scene === 'landscape' || scene === 'sunset')) horizonRule(horizon, hints, scene === 'sunset');
  }
  sceneRules(scene, ctx, hints);
  const fh = frameHint(frame, scene, selfie);
  if (fh) hints.push(fh);
  lightRules(light, selfie, hints, { scene, sunset: scene === 'sunset' || !!ctx.sunset });
  levelRule(tilt, scene, hints);
  return finish(scene, person, hints);
}

export function finish(scene, person, hints, extra = {}) {
  hints.sort((a, b) => RANK[a.level] - RANK[b.level] || a.order - b.order);
  const penalty = hints.reduce((s, h) => s + (h.level === 'bad' ? 0.4 : h.level === 'warn' ? 0.2 : 0.04), 0);
  const blocking = hints.some((h) => h.level !== 'tip');
  return { scene, person, hints, score: clamp(1 - penalty, 0, 1), ready: scene !== 'none' && !blocking, ...extra };
}

function framingRules(g, lm, selfie, out) {
  const up = selfie ? '手机举高一点' : '手机往上抬一点';
  const down = selfie ? '手机放低一点' : '手机往下压一点';
  const back = selfie ? '手机拿远一点' : '往后退一步';
  const ankleY = Math.max(lm[P.L_AN].y, lm[P.R_AN].y);
  const kneeY = Math.max(lm[P.L_KN].y, lm[P.R_KN].y);
  const hipY = Math.max(lm[P.L_HIP].y, lm[P.R_HIP].y);

  // Head cut off at the top. If the feet are already near the bottom, there is no room: step back.
  if (g.headTop < -0.015) {
    const noRoom = ankleY > 0.88 && ankleY < 1.06;
    out.push({
      id: 'head-cut', level: 'bad', order: 1,
      text: noRoom ? back : up, why: '头被切掉了',
      arrow: noRoom ? null : { from: { x: g.cx, y: 0.03 }, to: { x: g.cx, y: 0.16 } },
    });
  }

  // Left-right placement: center or a third line.
  const target = nearest(THIRDS, g.cx);
  const dx = target - g.cx;
  if (Math.abs(dx) > 0.07) {
    const edge = g.cx < 0.15 || g.cx > 0.85;
    const screenDir = (selfie ? -dx : dx) > 0 ? '右' : '左';
    out.push({
      id: 'position', level: edge ? 'bad' : 'warn', order: 2,
      text: selfie ? `人往${screenDir}挪一点` : `手机往${dx < 0 ? '右' : '左'}转一点`,
      why: edge ? '人太靠边了' : target === 0.5 ? '把人放到画面中间' : '把人放到三分线上',
      voice: selfie ? `往${screenDir}挪一点` : null,
      arrow: { from: { x: g.cx, y: g.cy }, to: { x: target, y: g.cy } },
    });
  }

  // Bottom edge cutting through a joint.
  if (ankleY > 0.95 && ankleY < 1.06) {
    const room = g.headTop > 0.06;
    out.push({
      id: 'cut-feet', level: 'warn', order: 3,
      text: room ? down : back, why: '脚被切掉了', edge: 'bottom',
      arrow: room ? { from: { x: g.cx, y: 0.97 }, to: { x: g.cx, y: 0.85 } } : null,
    });
  } else if (kneeY > 0.92 && kneeY < 1.06) {
    out.push({ id: 'cut-knee', level: 'warn', order: 3, text: selfie ? '手机拿远一点，拍到脚' : '往后退一步，拍到脚', why: '画面别卡在膝盖上', edge: 'bottom' });
  } else if (hipY > 0.94 && hipY < 1.05) {
    out.push({ id: 'cut-hip', level: 'tip', order: 3, text: down, why: '别卡在胯部，多拍一点腿', edge: 'bottom' });
  }

  // Size and vertical placement.
  if (g.shot === 'full') {
    if (g.height < 0.55) {
      out.push({
        id: 'too-small', level: 'warn', order: 4,
        text: selfie ? '离手机近一点' : '往前走两步', why: '人在画面里太小了',
        box: { cx: g.cx, top: 0.12, bottom: 0.95 },
      });
    } else {
      // Feet near the bottom edge makes legs look longer; keep at least a little headroom.
      const shift = Math.max(0.955 - g.bottom, 0.04 - g.headTop);
      if (shift > 0.06) {
        out.push({
          id: 'leg-room', level: 'warn', order: 4, text: up, why: '让脚踩在画面底边，显腿长',
          arrow: { from: { x: g.cx, y: g.bottom }, to: { x: g.cx, y: g.bottom + shift } },
        });
      }
    }
  } else if (g.headTop >= -0.015) {
    if (g.headTop < 0.02 && g.shot !== 'close') {
      out.push({
        id: 'head-tight', level: 'warn', order: 4, text: up, why: '头顶太挤了',
        arrow: { from: { x: g.cx, y: g.headTop + 0.02 }, to: { x: g.cx, y: g.headTop + 0.1 } },
      });
    } else if (g.headTop > 0.2) {
      out.push({
        id: 'head-loose', level: 'warn', order: 4, text: down, why: '头顶空太多了',
        arrow: { from: { x: g.cx, y: g.headTop }, to: { x: g.cx, y: 0.08 } },
      });
    }
  }
}

function poseRules(g, lm, aspect, selfie, out) {
  if (g.shot === 'close') return;
  // Square to the camera: shoulders look as wide as the torso is tall.
  if (g.torsoH > 0.04 && g.shoulderW / g.torsoH > 0.68) {
    out.push({
      id: 'turn', level: 'tip', order: 10,
      text: selfie ? '身体侧过来一点' : '让TA侧身一点', why: '正对镜头显宽，侧一点更显瘦',
      voice: '身体稍微侧过来一点',
    });
  }
  // Both arms hanging straight down beside the body.
  const stiff = ([wr, el, sh, hip]) => {
    const W = lm[wr], E = lm[el], S = lm[sh], H = lm[hip];
    if (W.y > 1 || H.y > 1) return false;
    return W.y > H.y - 0.03 && Math.abs(W.x - H.x) * aspect < g.shoulderW * 0.45 && angleAt(S, E, W, aspect) > 155;
  };
  if (g.rank >= 1 && stiff([15, 13, 11, 23]) && stiff([16, 14, 12, 24])) {
    out.push({
      id: 'arms', level: 'tip', order: 11,
      text: selfie ? '一只手叉个腰试试' : '让TA一只手叉腰', why: '两只手直直垂着显得僵',
      voice: '一只手叉腰试试',
    });
  }
}

export function levelRule(tilt, scene, out) {
  if (tilt == null) return;
  const a = Math.abs(tilt);
  if (a <= 2) return;
  const lines = scene === 'landscape' || scene === 'city' || scene === 'sunset';
  out.push({
    id: 'level', level: a > 6 ? 'bad' : 'warn', order: lines ? 0 : 5,
    text: '手机拿正一点', why: `画面歪了 ${Math.round(a)}°`,
  });
}

function horizonRule(h, out, sunset = false) {
  if (sunset) {
    // At sunset the sky is the subject: keep the horizon on the lower third.
    if (h.y >= 0.55) return;
    out.push({
      id: 'horizon', level: 'warn', order: 3, text: '手机往上抬一点', why: '日落多留点天空',
      arrow: { from: { x: 0.5, y: h.y }, to: { x: 0.5, y: 2 / 3 } },
      horizon: { y: h.y, target: 2 / 3 },
    });
    return;
  }
  if (h.y < 0.4 || h.y > 0.6) return;
  const lower = !!h.cloudy; // an interesting sky earns more room
  const target = lower ? 2 / 3 : 1 / 3;
  out.push({
    id: 'horizon', level: 'warn', order: 3,
    text: lower ? '手机往上抬一点' : '手机往下压一点',
    why: lower ? '天空有层次，多拍点天空' : '地平线别放在正中间',
    arrow: { from: { x: 0.5, y: h.y }, to: { x: 0.5, y: target } },
    horizon: { y: h.y, target },
  });
}

// Finds a sky-over-ground horizon in a small RGBA image ({data, width, height}).
// Returns {sky, y, strength, cloudy, warm}; y is null when no clear, level-ish horizon is found.
// warm: the sky is orange rather than blue (sunset); callers only trust it in a sunset scene.
export function findHorizon(img) {
  const { data, width: w, height: h } = img;
  const lum = new Float32Array(w * h);
  const topRows = Math.max(2, Math.round(h * 0.15));
  let topR = 0, topB = 0, topL = 0, topN = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      lum[y * w + x] = l;
      if (y < topRows) { topR += r; topB += b; topL += l; topN++; }
    }
  }
  topR /= topN; topB /= topN; topL /= topN;
  const blue = topL > 0.42 && topB >= topR * 0.92;
  const warm = !blue && topL > 0.3 && topR > topB * 1.25;
  if (!blue && !warm) return { sky: false, y: null };

  const k = Math.max(2, Math.round(h * 0.06));
  const edgeRow = (x0, x1) => {
    const rows = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let x = x0; x < x1; x++) s += lum[y * w + x];
      rows[y] = s / (x1 - x0);
    }
    let best = 0, at = -1;
    for (let y = k; y <= h - k; y++) {
      let above = 0, below = 0;
      for (let j = 1; j <= k; j++) { above += rows[y - j]; below += rows[y + j - 1]; }
      const d = (above - below) / k;
      if (d > best) { best = d; at = y; }
    }
    return { best, at };
  };
  const half = Math.floor(w / 2);
  const L = edgeRow(0, half), R = edgeRow(half, w);
  if (L.best < 0.08 || R.best < 0.08 || Math.abs(L.at - R.at) > h * 0.08) return { sky: true, y: null, warm };
  const row = (L.at + R.at) / 2;
  const y = row / h;
  if (y < 0.12 || y > 0.88) return { sky: true, y: null, warm };

  // Sky texture: clouds make neighbouring pixels differ; a plain gradient does not.
  let t = 0, n = 0;
  const lim = Math.floor(row) - 2;
  for (let yy = 0; yy < lim; yy++) {
    for (let x = 0; x < w - 1; x++) {
      const i = yy * w + x;
      t += Math.abs(lum[i + 1] - lum[i]) + Math.abs(lum[i + w] - lum[i]);
      n++;
    }
  }
  const texture = n ? t / n : 0;
  return { sky: true, y, strength: (L.best + R.best) / 2, cloudy: texture > 0.025, warm };
}
