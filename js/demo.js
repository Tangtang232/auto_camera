// Demo mode: a painted scene with a synthetic person, so the guidance can be
// previewed on a computer without a camera. The 22-second loop walks through
// the common fixes: off to the side, too small, feet placement, pose tips,
// then the person leaves and a landscape with a centered horizon remains.

import { clamp } from './geom.js';

// A standing figure in "person units": height 1, origin between the feet,
// x toward the image right, y up (negative). Index order follows MediaPipe Pose.
const BASE = [
  [0, -0.925], [0.015, -0.94], [0.025, -0.945], [0.035, -0.94], [-0.015, -0.94], [-0.025, -0.945], [-0.035, -0.94],
  [0.055, -0.935], [-0.055, -0.935], [0.012, -0.905], [-0.012, -0.905],
  [0.105, -0.815], [-0.105, -0.815], [0.13, -0.64], [-0.13, -0.64], [0.14, -0.49], [-0.14, -0.49],
  [0.145, -0.45], [-0.145, -0.45], [0.14, -0.44], [-0.14, -0.44], [0.13, -0.46], [-0.13, -0.46],
  [0.065, -0.52], [-0.065, -0.52], [0.07, -0.28], [-0.07, -0.28], [0.07, -0.045], [-0.07, -0.045],
  [0.07, -0.02], [-0.07, -0.02], [0.09, -0.005], [-0.09, -0.005],
];

const ease = (t) => t * t * (3 - 2 * t);
const seg = (t, a, b) => ease(clamp((t - a) / (b - a), 0, 1));
export const DEMO_LENGTH = 22;

// cx: horizontal center, s: height as a fraction of the frame, fb: feet line,
// turn: 1 = square to camera, lower = turned sideways, hand: 0..1 left hand on hip.
export function demoPose({ cx, s, fb, turn = 1, hand = 0 }, aspect) {
  return BASE.map(([rx, ry], i) => {
    if (hand) {
      if (i === 13) { rx += (0.24 - 0.13) * hand; ry += (-0.62 + 0.64) * hand; }
      if (i === 15 || i === 17 || i === 19 || i === 21) { rx += (0.085 - 0.14) * hand; ry += (-0.55 + 0.49) * hand; }
    }
    return { x: cx + (rx * turn * s) / aspect, y: fb + ry * s, z: 0, visibility: 0.99 };
  });
}

export const DEMO_FINAL = { cx: 0.665, s: 0.8, fb: 0.955, turn: 0.58, hand: 1 };

export function demoFrame(time, aspect) {
  const t = ((time % DEMO_LENGTH) + DEMO_LENGTH) % DEMO_LENGTH;
  const k1 = seg(t, 3, 5.5), k2 = seg(t, 6, 8.5), k3 = seg(t, 9.5, 11), k4 = seg(t, 11.5, 13);
  const out = seg(t, 16, 17.5);
  const cx = 0.86 + (DEMO_FINAL.cx - 0.86) * k1 + (1.5 - DEMO_FINAL.cx) * out;
  const s = 0.4 + (DEMO_FINAL.s - 0.4) * k2;
  const fb = 0.74 + (DEMO_FINAL.fb - 0.74) * k2;
  const turn = 1 - (1 - DEMO_FINAL.turn) * k3;
  const tilt = 4.5 * (1 - seg(t, 1.5, 4));
  const horizonY = t < 17.5 ? 0.56 : 0.5 + (0.36 - 0.5) * seg(t, 19, 20.5);
  const lm = cx < 1.12 ? demoPose({ cx, s, fb, turn, hand: k4 }, aspect) : null;
  return { t, lm, s, tilt, horizonY };
}

export function paintDemo(ctx, w, h, f) {
  const hy = f.horizonY * h;
  let g = ctx.createLinearGradient(0, 0, 0, hy);
  g.addColorStop(0, '#5f9fd6');
  g.addColorStop(1, '#cfe3f3');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, hy + 1);
  g = ctx.createLinearGradient(0, hy, 0, h);
  g.addColorStop(0, '#6e8f55');
  g.addColorStop(1, '#3a5a32');
  ctx.fillStyle = g;
  ctx.fillRect(0, hy, w, h - hy);
  ctx.fillStyle = '#56774a';
  ctx.beginPath();
  ctx.moveTo(0, hy);
  for (let x = 0; x <= w + 1; x += w / 24) ctx.lineTo(x, hy - (Math.sin(x * 0.05) * 0.5 + 0.7) * h * 0.012);
  ctx.lineTo(w, hy);
  ctx.closePath();
  ctx.fill();
  if (f.lm) paintFigure(ctx, w, h, f.lm, f.s);
}

/* ---------- scene demos: ?demo&scene=food|pet|city|night|sunset ---------- */
// A painted scene plus scripted sensor readings, over a 12-second loop: the first
// seconds show the hint for that scene, then the phone "moves" until it is ready.

export const DEMO_SCENES = ['food', 'pet', 'city', 'night', 'sunset'];
const SCENE_LOOP = 12;

export function demoSceneFrame(scene, time) {
  const t = ((time % SCENE_LOOP) + SCENE_LOOP) % SCENE_LOOP;
  const a = seg(t, 3, 6);
  const f = { scene, t, lm: null, s: 0, tilt: 0, horizonY: 0.6, sensors: {} };
  if (scene === 'food') {
    // level → 45° from above → straight down but crooked → straight down and level
    const elev = -45 * a - 43 * seg(t, 7, 9);
    f.sensors = { elev, flatDev: elev < -70 ? 12 - 10 * seg(t, 10, 11) : null };
  } else if (scene === 'pet') {
    f.sensors = { elev: -50 + 42 * a };
  } else if (scene === 'city') {
    f.sensors = { elev: 14 - 14 * a };
  } else if (scene === 'night') {
    f.sensors = { shake: 30 - 26 * a };
  } else if (scene === 'sunset') {
    f.horizonY = 0.42 + 0.26 * a;
  }
  return f;
}

function circle(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function ellipse(ctx, x, y, rx, ry, color, rot = 0) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
}

function vgrad(ctx, y0, y1, stops) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}

function buildings(ctx, w, h, base, wall, lit, rate) {
  const tops = [0.38, 0.22, 0.3, 0.14, 0.27, 0.35];
  const bw = w / tops.length;
  tops.forEach((top, k) => {
    const x = k * bw;
    ctx.fillStyle = wall[k % wall.length];
    ctx.fillRect(x + 2, top * h, bw - 4, base * h - top * h);
    for (let y = top * h + 12; y < base * h - 14; y += 22) {
      for (let wx = x + 10; wx < x + bw - 14; wx += 16) {
        const on = ((wx * 7 + y * 13 + k * 31) % 100) / 100 < rate;
        ctx.fillStyle = on ? lit : 'rgba(0,0,0,0.25)';
        ctx.fillRect(wx, y, 7, 10);
      }
    }
  });
}

export function paintSceneDemo(ctx, w, h, f) {
  if (f.scene === 'food') {
    ctx.fillStyle = vgrad(ctx, 0, h, ['#9a6a45', '#6e4a2f']);
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(60,35,20,0.25)';
    ctx.lineWidth = 2;
    for (let y = 18; y < h; y += 38) { ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(w * 0.3, y + 8, w * 0.6, y - 8, w, y + 4); ctx.stroke(); }
    const cx = w * 0.5, cy = h * 0.52, r = w * 0.34;
    circle(ctx, cx, cy, r, '#f4f1ea');
    circle(ctx, cx, cy, r * 0.78, '#ebe6db');
    ellipse(ctx, cx, cy, r * 0.58, r * 0.5, '#e09a3e');
    for (const [dx, dy] of [[-0.25, -0.15], [0.2, -0.22], [0.05, 0.2], [-0.15, 0.22], [0.3, 0.1]]) circle(ctx, cx + dx * r, cy + dy * r, r * 0.11, '#c63b2b');
    for (const [dx, dy, rot] of [[-0.05, -0.05, 0.6], [0.18, 0.05, -0.4], [-0.3, 0.05, 1.2]]) ellipse(ctx, cx + dx * r, cy + dy * r, r * 0.13, r * 0.06, '#4f9a45', rot);
    circle(ctx, w * 0.86, h * 0.14, w * 0.11, '#f2efe9');
    circle(ctx, w * 0.86, h * 0.14, w * 0.085, '#5a3720');
  } else if (f.scene === 'pet') {
    ctx.fillStyle = '#d9cbb8';
    ctx.fillRect(0, 0, w, h * 0.6);
    ctx.fillStyle = '#a98b6b';
    ctx.fillRect(0, h * 0.6, w, h * 0.4);
    const cx = w * 0.5, cy = h * 0.62;
    ellipse(ctx, cx, cy + h * 0.06, w * 0.28, h * 0.12, '#c8894a');
    circle(ctx, cx, cy - h * 0.1, w * 0.17, '#cf9455');
    ellipse(ctx, cx - w * 0.15, cy - h * 0.12, w * 0.06, h * 0.07, '#8a5a2e', 0.3);
    ellipse(ctx, cx + w * 0.15, cy - h * 0.12, w * 0.06, h * 0.07, '#8a5a2e', -0.3);
    circle(ctx, cx - w * 0.06, cy - h * 0.12, w * 0.022, '#1d1a17');
    circle(ctx, cx + w * 0.06, cy - h * 0.12, w * 0.022, '#1d1a17');
    ellipse(ctx, cx, cy - h * 0.07, w * 0.035, w * 0.025, '#2a211b');
  } else if (f.scene === 'city') {
    ctx.fillStyle = vgrad(ctx, 0, h, ['#8fbbe0', '#d6e6f2']);
    ctx.fillRect(0, 0, w, h);
    buildings(ctx, w, h, 0.86, ['#8d96a3', '#a9a397', '#76808c', '#b7b0a2'], '#d9e8f5', 0.5);
    ctx.fillStyle = '#5b5f66';
    ctx.fillRect(0, h * 0.86, w, h * 0.14);
  } else if (f.scene === 'night') {
    ctx.fillStyle = vgrad(ctx, 0, h, ['#05070f', '#121831']);
    ctx.fillRect(0, 0, w, h);
    buildings(ctx, w, h, 0.9, ['#0b0e1c', '#0f1324', '#090b16'], '#f3c76b', 0.22);
    ctx.fillStyle = '#07080d';
    ctx.fillRect(0, h * 0.9, w, h * 0.1);
  } else if (f.scene === 'sunset') {
    const hy = f.horizonY * h;
    ctx.fillStyle = vgrad(ctx, 0, hy, ['#d8643a', '#f39a4c', '#f8c77a']);
    ctx.fillRect(0, 0, w, hy + 1);
    circle(ctx, w * 0.62, hy - h * 0.045, w * 0.07, '#fff1c9');
    ctx.fillStyle = '#2a2130';
    ctx.fillRect(0, hy, w, h - hy);
  }
}

function paintFigure(ctx, w, h, lm, s) {
  const X = (p) => p.x * w, Y = (p) => p.y * h;
  const lw = s * h * 0.07;
  const path = (ids) => {
    ctx.beginPath();
    ids.forEach((i, k) => (k ? ctx.lineTo(X(lm[i]), Y(lm[i])) : ctx.moveTo(X(lm[i]), Y(lm[i]))));
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#2c3442';
  ctx.lineWidth = lw;
  path([23, 25, 27]); ctx.stroke();
  path([24, 26, 28]); ctx.stroke();
  ctx.fillStyle = '#c4553d';
  ctx.strokeStyle = '#c4553d';
  path([11, 12, 24, 23]); ctx.closePath(); ctx.fill();
  ctx.lineWidth = lw * 0.9; ctx.stroke();
  ctx.lineWidth = lw * 0.75;
  path([11, 13, 15]); ctx.stroke();
  path([12, 14, 16]); ctx.stroke();
  ctx.fillStyle = '#e2b48f';
  for (const i of [15, 16]) { ctx.beginPath(); ctx.arc(X(lm[i]), Y(lm[i]), lw * 0.38, 0, Math.PI * 2); ctx.fill(); }
  const r = s * h * 0.062;
  const hx = X(lm[0]), hy = Y(lm[0]) - r * 0.25;
  ctx.beginPath(); ctx.arc(hx, hy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2a211c';
  ctx.beginPath(); ctx.arc(hx, hy - r * 0.3, r * 0.98, Math.PI, 0); ctx.fill();
  ctx.restore();
}
