// Shared geometry for MediaPipe Pose landmarks (33 points).
// Coordinates are normalized to the photo frame: x to the right, y down, 0..1.
// "Left" always means the subject's own left, the way MediaPipe labels it.

export const P = {
  NOSE: 0, L_EYE: 2, R_EYE: 5, L_EAR: 7, R_EAR: 8,
  L_SH: 11, R_SH: 12, L_EL: 13, R_EL: 14, L_WR: 15, R_WR: 16,
  L_HIP: 23, R_HIP: 24, L_KN: 25, R_KN: 26, L_AN: 27, R_AN: 28,
  L_HEEL: 29, R_HEEL: 30, L_FOOT: 31, R_FOOT: 32,
};

export const BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32],
];

export const SHOT_NAME = { close: '特写', half: '半身', knee: '七分身', full: '全身' };
const SHOT_RANK = { close: 0, half: 1, knee: 2, full: 3 };

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// Some MediaPipe builds report visibility as 0 for every point; treat that as "unknown".
export function visible(p) {
  if (!p) return false;
  const v = p.visibility;
  return v == null || v === 0 || v > 0.3;
}

// Centered crop of a source (sw x sh) to the given aspect (width / height),
// matching CSS object-fit: cover.
export function coverCrop(sw, sh, aspect) {
  if (sw / sh > aspect) {
    const w = sh * aspect;
    return { sx: (sw - w) / 2, sy: 0, sw: w, sh };
  }
  const h = sw / aspect;
  return { sx: 0, sy: (sh - h) / 2, sw, sh: h };
}

// Angle ABC in degrees, measured in physical units (x scaled by aspect).
export function angleAt(a, b, c, aspect) {
  const v1x = (a.x - b.x) * aspect, v1y = a.y - b.y;
  const v2x = (c.x - b.x) * aspect, v2y = c.y - b.y;
  const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (!d) return 180;
  return (Math.acos(clamp((v1x * v2x + v1y * v2y) / d, -1, 1)) * 180) / Math.PI;
}

// Where the person sits in the frame, how much of them is visible, and their proportions.
// Heights are in frame-height units; widths are converted to the same units.
export function personGeometry(lm, aspect) {
  const p = (i) => lm[i];
  const sh = mid(p(P.L_SH), p(P.R_SH));
  const hip = mid(p(P.L_HIP), p(P.R_HIP));
  const eye = mid(p(P.L_EYE), p(P.R_EYE));
  const neck = Math.max(sh.y - eye.y, 0.015);
  const headTop = Math.min(eye.y, p(P.NOSE).y) - neck * 0.65;

  const ok = (i) => {
    const q = p(i);
    return visible(q) && q.y <= 0.99 && q.x >= 0 && q.x <= 1;
  };
  let shot = 'close';
  if (ok(P.L_AN) && ok(P.R_AN)) shot = 'full';
  else if (ok(P.L_KN) || ok(P.R_KN)) shot = 'knee';
  else if (ok(P.L_HIP) || ok(P.R_HIP)) shot = 'half';

  const feet = Math.max(...[27, 28, 29, 30, 31, 32].map((i) => p(i).y));
  const bottom = shot === 'full' ? Math.min(feet + 0.01, 1) : 1;
  const torsoH = Math.max(hip.y - sh.y, 0.001);
  const shoulderW = Math.abs(p(P.L_SH).x - p(P.R_SH).x) * aspect;
  const cx = shot === 'close' ? sh.x : (sh.x + hip.x) / 2;

  return {
    headTop, bottom, height: bottom - headTop,
    cx, cy: (Math.max(headTop, 0) + bottom) / 2,
    shot, rank: SHOT_RANK[shot],
    sh, hip, eye, torsoH, shoulderW,
  };
}
