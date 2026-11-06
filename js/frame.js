// AI 推荐取景: the 90 candidate crops the GAIC model scores, and how to turn the
// best one into guidance. Boxes are normalized {x, y, w, h} in the frame.
//
// GAIC's reference generate_bboxes() calls the vertical axis "x" and the horizontal
// axis "y". This was confirmed against the sampling grid inside the ONNX model
// (90/90 boxes match) and by a content-side test, so rows come from x and columns from y.

const BINS = 12;

export const GAIC_BOXES = (() => {
  const out = [];
  for (let x1 = 0; x1 < 4; x1++) {
    for (let y1 = 0; y1 < 4; y1++) {
      for (let x2 = 8; x2 < 12; x2++) {
        for (let y2 = 8; y2 < 12; y2++) {
          const rows = x2 - x1, cols = y2 - y1, r = cols / rows;
          if (rows * cols > 0.4999 * BINS * BINS && r > 0.5 && r < 2) {
            out.push({ x: (0.5 + y1) / BINS, y: (0.5 + x1) / BINS, w: cols / BINS, h: rows / BINS, rows, cols });
          }
        }
      }
    }
  }
  return out;
})();

// Crops with the same shape as the viewfinder: stepping closer (or zooming) gives exactly that view.
export const SAME_ASPECT = GAIC_BOXES.map((b, i) => (b.rows === b.cols ? i : -1)).filter((i) => i >= 0);
// The largest same-shape crop, centered: this is "keep the frame as it is".
export const FULL = SAME_ASPECT.reduce((best, i) => (GAIC_BOXES[i].w > GAIC_BOXES[best].w ? i : best), SAME_ASPECT[0]);

// Candidates that fully contain a rect {x0, y0, x1, y1} (e.g. the person), so a
// recommended crop never cuts the subject out. Null rect: no constraint.
export function boxesContaining(r, ids = SAME_ASPECT, pad = 0.02) {
  if (!r) return ids;
  return ids.filter((i) => {
    const b = GAIC_BOXES[i];
    return b.x <= r.x0 + pad && b.y <= r.y0 + pad && b.x + b.w >= r.x1 - pad && b.y + b.h >= r.y1 - pad;
  });
}

// Pick the best crop among ids. Keeps the previous pick unless a new one is clearly better,
// and treats "keep the frame" as good enough when it scores close to the best.
export function bestBox(scores, ids = SAME_ASPECT, prev = null) {
  let best = ids[0];
  let lo = Infinity, hi = -Infinity;
  for (const i of ids) {
    if (scores[i] > scores[best]) best = i;
    lo = Math.min(lo, scores[i]);
    hi = Math.max(hi, scores[i]);
  }
  const tol = 0.12 * (hi - lo);
  if (prev != null && ids.includes(prev) && scores[best] - scores[prev] < tol) best = prev;
  const aligned = ids.includes(FULL) && scores[FULL] >= scores[best] - tol;
  return { index: best, box: GAIC_BOXES[best], aligned };
}

// Turn the recommended crop into one hint. In person scenes the pose and placement
// rules lead, so this stays a tip; elsewhere it is the main guidance.
export function frameHint(pick, scene, selfie) {
  if (!pick || pick.aligned) return null;
  const b = pick.box;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const dx = cx - 0.5, dy = cy - 0.5;
  let text;
  if (Math.abs(dx) > 0.06 || Math.abs(dy) > 0.06) {
    if (selfie) text = '按箭头挪一下手机';
    else if (Math.abs(dx) >= Math.abs(dy)) text = `手机往${dx > 0 ? '右' : '左'}转一点`;
    else text = dy < 0 ? '手机往上抬一点' : '手机往下压一点';
  } else {
    text = selfie ? '手机拿近一点' : '往前走一点';
  }
  return {
    id: 'ai-frame',
    level: scene === 'person' ? 'tip' : 'warn',
    order: scene === 'person' ? 9 : 2,
    text,
    why: '对准 AI 推荐的取景框',
    arrow: { from: { x: cx, y: cy }, to: { x: 0.5, y: 0.5 } },
    frame: b,
  };
}
