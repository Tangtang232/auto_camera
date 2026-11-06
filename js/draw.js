// Draws the guidance layer over the viewfinder: thirds grid, level, skeleton,
// target outline, arrow, horizon. Everything comes in photo coords (0..1) and is
// mirrored here for the front camera, so the logic never has to think about it.

import { BONES, mid } from './geom.js';

export const COLOR = {
  good: '#3ee08f',
  warn: '#ffc145',
  bad: '#ff6464',
  tip: '#9ecbff',
  idle: 'rgba(255,255,255,0.92)',
  ghost: 'rgba(255,255,255,0.92)',
};

export const scoreColor = (s) => (s >= 0.75 ? COLOR.good : s >= 0.45 ? COLOR.warn : COLOR.bad);

export function drawOverlay(ctx, W, H, dpr, o) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const X = (p) => (o.mirror ? 1 - p.x : p.x) * W;
  const Y = (p) => p.y * H;
  drawGrid(ctx, W, H, dpr);
  if (o.edge) drawEdge(ctx, W, H, dpr);
  if (o.horizon) drawHorizon(ctx, W, H, dpr, o.horizon);
  if (o.box) drawBox(ctx, H, dpr, X(o.box), o.box);
  if (o.aiFrame) drawAiFrame(ctx, W, H, dpr, o.aiFrame, o.mirror);
  if (o.ghost) drawSkeleton(ctx, o.ghost, X, Y, dpr, () => COLOR.ghost, true);
  if (o.lm) drawSkeleton(ctx, o.lm, X, Y, dpr, o.boneColor || (() => COLOR.idle), false);
  if (o.arrow) drawArrow(ctx, X(o.arrow.from), Y(o.arrow.from), X(o.arrow.to), Y(o.arrow.to), dpr, o.time || 0);
  if (o.tilt != null) drawLevel(ctx, W, H, dpr, o.tilt);
}

function drawGrid(ctx, W, H, dpr) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = dpr;
  ctx.beginPath();
  for (const f of [1 / 3, 2 / 3]) {
    ctx.moveTo(Math.round(W * f) + 0.5, 0); ctx.lineTo(Math.round(W * f) + 0.5, H);
    ctx.moveTo(0, Math.round(H * f) + 0.5); ctx.lineTo(W, Math.round(H * f) + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}

function drawEdge(ctx, W, H, dpr) {
  const g = ctx.createLinearGradient(0, H, 0, H - 34 * dpr);
  g.addColorStop(0, 'rgba(255,100,100,0.7)');
  g.addColorStop(1, 'rgba(255,100,100,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H - 34 * dpr, W, 34 * dpr);
}

function drawHorizon(ctx, W, H, dpr, h) {
  ctx.save();
  ctx.lineWidth = 2 * dpr;
  ctx.setLineDash([10 * dpr, 8 * dpr]);
  ctx.strokeStyle = COLOR.warn;
  ctx.beginPath(); ctx.moveTo(0, h.y * H); ctx.lineTo(W, h.y * H); ctx.stroke();
  if (h.target != null) {
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(62,224,143,0.9)';
    ctx.beginPath(); ctx.moveTo(0, h.target * H); ctx.lineTo(W, h.target * H); ctx.stroke();
    ctx.fillStyle = 'rgba(62,224,143,0.95)';
    ctx.font = `600 ${12 * dpr}px -apple-system, "PingFang SC", sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText('地平线放这里', W - 10 * dpr, h.target * H - 6 * dpr);
  }
  ctx.restore();
}

function drawBox(ctx, H, dpr, x, box) {
  const top = box.top * H, bottom = box.bottom * H;
  const w = (bottom - top) * 0.42;
  ctx.save();
  ctx.strokeStyle = COLOR.ghost;
  ctx.lineWidth = 2.5 * dpr;
  ctx.setLineDash([9 * dpr, 7 * dpr]);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - w / 2, top, w, bottom - top, 14 * dpr);
  else ctx.rect(x - w / 2, top, w, bottom - top);
  ctx.stroke();
  ctx.restore();
}

// The crop the composition model likes best. Strong while it is the hint on screen.
function drawAiFrame(ctx, W, H, dpr, { box, strong }, mirror) {
  const x = (mirror ? 1 - box.x - box.w : box.x) * W;
  const y = box.y * H, w = box.w * W, h = box.h * H;
  ctx.save();
  ctx.lineWidth = (strong ? 2.5 : 1.5) * dpr;
  ctx.setLineDash([10 * dpr, 6 * dpr]);
  ctx.strokeStyle = strong ? '#ffd34d' : 'rgba(255,255,255,0.55)';
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 4 * dpr;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, 10 * dpr);
  else ctx.rect(x, y, w, h);
  ctx.stroke();
  if (strong) {
    ctx.setLineDash([]);
    ctx.font = `600 ${12 * dpr}px -apple-system, "PingFang SC", sans-serif`;
    ctx.fillStyle = '#ffd34d';
    ctx.textBaseline = 'top';
    ctx.fillText('AI 推荐取景', x + 8 * dpr, y + 6 * dpr);
  }
  ctx.restore();
}

const far = (p) => !p || p.y > 1.25 || p.y < -0.25 || p.x < -0.25 || p.x > 1.25;

function drawSkeleton(ctx, lm, X, Y, dpr, colorOf, ghost) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (ghost) ctx.setLineDash([8 * dpr, 7 * dpr]);
  for (const pass of [0, 1]) {
    for (const [a, b] of BONES) {
      const pa = lm[a], pb = lm[b];
      if (far(pa) || far(pb)) continue;
      ctx.beginPath();
      ctx.moveTo(X(pa), Y(pa));
      ctx.lineTo(X(pb), Y(pb));
      if (pass === 0) { ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = (ghost ? 5.5 : 7.5) * dpr; }
      else { ctx.strokeStyle = colorOf(a, b); ctx.lineWidth = (ghost ? 3 : 4.5) * dpr; }
      ctx.stroke();
    }
  }
  const eye = mid(lm[2], lm[5]), sh = mid(lm[11], lm[12]);
  if (!far(lm[0]) && !far(sh)) {
    const r = Math.max(Math.hypot(X(sh) - X(eye), Y(sh) - Y(eye)) * 0.55, 6 * dpr);
    const cx = X(lm[0]), cy = Y(eye);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = (ghost ? 5.5 : 7.5) * dpr; ctx.stroke();
    ctx.strokeStyle = colorOf(0, 0); ctx.lineWidth = (ghost ? 3 : 4.5) * dpr; ctx.stroke();
  }
  if (!ghost) {
    ctx.fillStyle = '#fff';
    for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const p = lm[i];
      if (far(p)) continue;
      ctx.beginPath(); ctx.arc(X(p), Y(p), 3.2 * dpr, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

function drawArrow(ctx, x1, y1, x2, y2, dpr, time) {
  let dx = x2 - x1, dy = y2 - y1;
  let len = Math.hypot(dx, dy);
  if (len < 1) return;
  const minLen = 64 * dpr;
  if (len < minLen) {
    const k = minLen / len, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    x1 = cx - (dx * k) / 2; y1 = cy - (dy * k) / 2; x2 = cx + (dx * k) / 2; y2 = cy + (dy * k) / 2;
    dx = x2 - x1; dy = y2 - y1; len = minLen;
  }
  const ux = dx / len, uy = dy / len, head = 18 * dpr;
  const bx = x2 - ux * head, by = y2 - uy * head;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(bx, by);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 11 * dpr; ctx.stroke();
  ctx.setLineDash([13 * dpr, 9 * dpr]);
  ctx.lineDashOffset = -((time * 0.045 * dpr) % (22 * dpr));
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 5.5 * dpr; ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(bx - uy * head * 0.8, by + ux * head * 0.8);
  ctx.lineTo(bx + uy * head * 0.8, by - ux * head * 0.8);
  ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 6 * dpr;
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();
}

// Two fixed ticks follow the phone; the long line follows the real horizon.
// When they join into one straight line, the phone is level.
function drawLevel(ctx, W, H, dpr, tilt) {
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.16, a = Math.abs(tilt);
  const col = a <= 2 ? COLOR.good : a <= 6 ? COLOR.warn : COLOR.bad;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.moveTo(cx - R - 24 * dpr, cy); ctx.lineTo(cx - R - 7 * dpr, cy);
  ctx.moveTo(cx + R + 7 * dpr, cy); ctx.lineTo(cx + R + 24 * dpr, cy);
  ctx.stroke();
  ctx.translate(cx, cy);
  ctx.rotate((-tilt * Math.PI) / 180);
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.5 * dpr;
  ctx.beginPath(); ctx.moveTo(-R, 0); ctx.lineTo(R, 0); ctx.stroke();
  ctx.restore();
}
