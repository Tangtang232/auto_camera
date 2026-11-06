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
