// 出片模板的姿势: builds the 33 MediaPipe Pose landmarks from a handful of joint angles,
// so template poses come from parameters instead of from someone else's photo.
//
// Units: a standing person is 1 tall. x points to the image right, y points down; the lowest
// point of the feet sits at y = 0 and the hip center at x = 0. Angles are in degrees from
// straight down, positive toward the image right. Facing the camera, the subject's left side
// (landmarks 11, 13, 23 …) is on the image right.

const LEN = { torso: 0.295, upperArm: 0.177, foreArm: 0.15, thigh: 0.24, shin: 0.235, shoulder: 0.105, hip: 0.065, neck: 0.12 };
const rad = (d) => (d * Math.PI) / 180;
const add = (p, v) => ({ x: p.x + v.x, y: p.y + v.y });
const seg = (len, deg) => ({ x: len * Math.sin(rad(deg)), y: len * Math.cos(rad(deg)) });
// Rotates a local offset (x right, y down); positive degrees tip the top toward the image right.
const rot = (v, deg) => {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
};

// Face points around the ear line: [index, x, y, depth toward the camera].
const FACE = [
  [0, 0, 0.01, 0.06],
  [1, 0.015, -0.005, 0.045], [2, 0.025, -0.01, 0.04], [3, 0.035, -0.005, 0.03],
  [4, -0.015, -0.005, 0.045], [5, -0.025, -0.01, 0.04], [6, -0.035, -0.005, 0.03],
  [7, 0.055, 0, -0.02], [8, -0.055, 0, -0.02],
  [9, 0.012, 0.03, 0.045], [10, -0.012, 0.03, 0.045],
];

/**
 * spec (all optional):
 *   turn     1 = square to the camera, 0.5 = three-quarter view (shrinks shoulder and hip width)
 *   lean     torso tilt; hipTilt  tilt of the hip line (weight on one leg)
 *   head     {tilt, yaw (-1..1, + = face turned toward the image right), down (degrees)}
 *   arms     {left, right}: {up, lo, kUp, kLo}  upper arm / forearm angle, length factors
 *            (below 1 = pointing toward the camera, so it looks shorter)
 *   legs     {left, right}: {up, lo, kUp, kLo, toe}  thigh / shin angle, length factors, toe offset
 */
export function rig(spec = {}) {
  const s = { turn: 1, lean: 0, hipTilt: 0, ...spec };
  const head = { tilt: 0, yaw: 0, down: 0, ...s.head };
  const arms = s.arms || {};
  const legs = s.legs || {};
  const p = new Array(33);
  const hip = { x: 0, y: 0 };
  const sh = add(hip, rot({ x: 0, y: -LEN.torso }, s.lean));
  const sw = LEN.shoulder * s.turn, hw = LEN.hip * s.turn;
  p[11] = add(sh, rot({ x: sw, y: 0 }, s.lean));
  p[12] = add(sh, rot({ x: -sw, y: 0 }, s.lean));
  p[23] = add(hip, rot({ x: hw, y: 0 }, s.hipTilt));
  p[24] = add(hip, rot({ x: -hw, y: 0 }, s.hipTilt));

  for (const [side, shI, elI, wrI, pinI, idxI, thI] of [[1, 11, 13, 15, 17, 19, 21], [-1, 12, 14, 16, 18, 20, 22]]) {
    const a = { up: 8 * side, lo: 4 * side, kUp: 1, kLo: 1, ...(side > 0 ? arms.left : arms.right) };
    p[elI] = add(p[shI], seg(LEN.upperArm * a.kUp, a.up));
    p[wrI] = add(p[elI], seg(LEN.foreArm * a.kLo, a.lo));
    const d = seg(1, a.lo); // along the forearm
    const n = { x: d.y * side, y: -d.x * side }; // across it, toward the little finger
    p[idxI] = add(p[wrI], { x: d.x * 0.05, y: d.y * 0.05 });
    p[pinI] = add(p[wrI], { x: d.x * 0.04 + n.x * 0.01, y: d.y * 0.04 + n.y * 0.01 });
    p[thI] = add(p[wrI], { x: d.x * 0.03 - n.x * 0.012, y: d.y * 0.03 - n.y * 0.012 });
  }

  for (const [side, hipI, kneeI, ankI, heelI, toeI] of [[1, 23, 25, 27, 29, 31], [-1, 24, 26, 28, 30, 32]]) {
    const g = { up: side, lo: 0, kUp: 1, kLo: 1, toe: 0.02 * side, ...(side > 0 ? legs.left : legs.right) };
    p[kneeI] = add(p[hipI], seg(LEN.thigh * g.kUp, g.up));
    p[ankI] = add(p[kneeI], seg(LEN.shin * g.kLo, g.lo));
    p[heelI] = add(p[ankI], { x: 0, y: 0.025 });
    p[toeI] = add(p[ankI], { x: g.toe, y: 0.04 });
  }

  const tilt = s.lean + head.tilt;
  const center = add(sh, rot({ x: 0, y: -LEN.neck }, tilt));
  const yaw = rad(head.yaw * 70), down = rad(head.down);
  for (const [i, x, y, z] of FACE) {
    const local = { x: x * Math.cos(yaw) + z * Math.sin(yaw), y: y * Math.cos(down) + z * Math.sin(down) };
    p[i] = add(center, rot(local, tilt));
  }

  // Feet on the ground (y = 0), hip center at x = 0.
  const ground = Math.max(...[27, 28, 29, 30, 31, 32].map((i) => p[i].y));
  return p.map((q) => ({ x: q.x, y: q.y - ground }));
}

// Puts a rigged pose into the frame: cx = hip center (0..1 of the width), fb = ground line
// (0..1 of the height, can be below the frame for half-length shots), s = size of a standing
// person as a fraction of the frame height. Same mapping as demoPose().
export function placePose(points, { cx, s, fb }, aspect) {
  return points.map((q) => ({ x: cx + (q.x * s) / aspect, y: fb + q.y * s, z: 0, visibility: 0.99 }));
}

// Linear blend between two landmark lists (for the demo's "getting into the pose").
export function blendPose(a, b, k) {
  return a.map((p, i) => ({ ...p, x: p.x + (b[i].x - p.x) * k, y: p.y + (b[i].y - p.y) * k }));
}
