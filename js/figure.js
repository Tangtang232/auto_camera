// Draws a simple person from pose landmarks: the demo's figure, template thumbnails,
// and the see-through silhouette laid over the viewfinder in 照着拍.

import { templatePose } from './templates.js';

const COLORS = { legs: '#2c3442', body: '#c4553d', skin: '#e2b48f', hair: '#2a211c' };

// s: height of a standing person as a fraction of h (sets the line widths).
export function paintFigure(ctx, w, h, lm, s, colors = COLORS) {
  const c = { ...COLORS, ...colors };
  const X = (p) => p.x * w, Y = (p) => p.y * h;
  const lw = s * h * 0.07;
  const path = (ids) => {
    ctx.beginPath();
    ids.forEach((i, k) => (k ? ctx.lineTo(X(lm[i]), Y(lm[i])) : ctx.moveTo(X(lm[i]), Y(lm[i]))));
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = c.legs;
  ctx.lineWidth = lw;
  path([23, 25, 27]); ctx.stroke();
  path([24, 26, 28]); ctx.stroke();
  ctx.fillStyle = c.body;
  ctx.strokeStyle = c.body;
  path([11, 12, 24, 23]); ctx.closePath(); ctx.fill();
  ctx.lineWidth = lw * 0.9; ctx.stroke();
  ctx.lineWidth = lw * 0.75;
  path([11, 13, 15]); ctx.stroke();
  path([12, 14, 16]); ctx.stroke();
  ctx.fillStyle = c.skin;
  for (const i of [15, 16]) { ctx.beginPath(); ctx.arc(X(lm[i]), Y(lm[i]), lw * 0.38, 0, Math.PI * 2); ctx.fill(); }
  const r = s * h * 0.062;
  const hx = (X(lm[7]) + X(lm[8])) / 2 * 0.5 + X(lm[0]) * 0.5, hy = Y(lm[0]) - r * 0.25;
  ctx.beginPath(); ctx.arc(hx, hy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = c.hair;
  ctx.beginPath(); ctx.arc(hx, hy - r * 0.3, r * 0.98, Math.PI, 0); ctx.fill();
  ctx.restore();
}

// Background colors for each look, so a template card hints at its color style.
const LOOK_BG = {
  cream: ['#f4e6d4', '#dcc0a2'],
  japan: ['#e3f0ec', '#b9d4cf'],
  film: ['#ead6b6', '#a88c68'],
  moody: ['#59606b', '#2a2d34'],
};

// A small picture of the template: its pose on a background in the template's colors.
export function templateCard(t, w = 150, h = 200) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const [top, bottom] = LOOK_BG[t.look] || LOOK_BG.cream;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const lm = templatePose(t, w / h);
  const lw = t.frame.s * h * 0.07;
  if (t.prop === 'seat') {
    // a step under the hips, so a seated pose reads as seated
    const y = ((lm[23].y + lm[24].y) / 2) * h + lw * 0.45;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
    ctx.fillRect(0, y, w, h - y);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(0, y, w, 2);
  }
  paintFigure(ctx, w, h, lm, t.frame.s);
  if (t.prop === 'table') {
    // a tabletop in front, at elbow height
    const y = Math.max(lm[13].y, lm[14].y) * h + lw * 0.3;
    ctx.fillStyle = 'rgba(112, 78, 52, 0.85)';
    ctx.fillRect(0, y, w, h - y);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(0, y, w, 2);
  }
  return c.toDataURL('image/png');
}

// A white, see-through version of a pose for the viewfinder overlay.
export function silhouette(lm, s, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const white = '#ffffff';
  paintFigure(c.getContext('2d'), w, h, lm, s, { legs: white, body: white, skin: white, hair: '#e8e8e8' });
  return c.toDataURL('image/png');
}
