// 城市: straighten leaning buildings. A phone pointed up at a building makes its vertical
// lines lean in toward the top. The motion sensor tells how far the phone pointed up, so the
// photo can be re-projected as if the phone had been held upright, then the empty corners
// are cropped away. Works on raw RGBA, so it runs in the worker and in tests.

export const PERSPECTIVE = {
  focal: 0.9, // focal length as a fraction of the photo's longer side. An estimate for the iPhone
  //            main camera (about 26 mm equivalent) after the video crop; tune after testing.
  amount: 0.7, // straighten most of the lean, not all of it: fully straight looks unnatural
  min: 3, // degrees: less than this is not worth fixing
  max: 20, // degrees: more than this stretches the top of the photo too much
};

export const shouldCorrect = (elev) => elev != null && Math.abs(elev) >= PERSPECTIVE.min && Math.abs(elev) <= PERSPECTIVE.max;

// Maps a row of the upright view back to the photo. For an output row at v, every pixel comes
// from the same photo row (sy), and x is scaled about the center by k: sx = cx + (u - cx) * k.
// phi: how far the camera pointed up (radians, negative = down); f: focal length in pixels.
// The view is shifted so the photo's center stays in the middle.
export function rowSource(v, w, h, phi, f) {
  const cy = h / 2;
  const c = Math.cos(phi), s = Math.sin(phi);
  const y = (v - cy) / f - Math.tan(phi);
  const zr = -y * s + c;
  const yr = y * c + s;
  return { sy: cy + (f * yr) / zr, k: 1 / zr };
}

// img: {data, width, height}. Returns the straightened, cropped image, or null if no crop fits.
export function correctVertical(img, elevDeg, opt = {}) {
  const { focal = PERSPECTIVE.focal, amount = PERSPECTIVE.amount } = opt;
  const { data, width: w, height: h } = img;
  const phi = (elevDeg * amount * Math.PI) / 180;
  const f = focal * Math.max(w, h);
  const cx = w / 2;
  const inside = (u, v) => {
    const r = rowSource(v, w, h, phi, f);
    const sx = cx + (u - cx) * r.k;
    return r.sy >= 0 && r.sy <= h && sx >= 0 && sx <= w;
  };

  // The largest rectangle with the photo's shape whose corners all land inside the photo
  // (the valid area is convex, so the corners are enough). Try a few vertical offsets.
  let best = null;
  for (let step = -15; step <= 15; step++) {
    const oy = (step / 100) * h;
    const fits = (sc) => {
      const hw = (w * sc) / 2, hh = (h * sc) / 2, my = h / 2 + oy;
      return inside(cx - hw, my - hh) && inside(cx + hw, my - hh) && inside(cx - hw, my + hh) && inside(cx + hw, my + hh);
    };
    if (!fits(0.3)) continue;
    let lo = 0.3, hi = 1;
    for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
    if (!best || lo > best.sc) best = { sc: lo, oy };
  }
  if (!best) return null;

  const W = Math.max(1, Math.floor(w * best.sc)), H = Math.max(1, Math.floor(h * best.sc));
  const left = cx - W / 2, top = h / 2 + best.oy - H / 2;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let j = 0; j < H; j++) {
    const r = rowSource(top + j + 0.5, w, h, phi, f);
    const y = Math.min(h - 1, Math.max(0, r.sy - 0.5));
    const y0 = Math.floor(y), y1 = Math.min(h - 1, y0 + 1), fy = y - y0;
    for (let i = 0; i < W; i++) {
      const x = Math.min(w - 1, Math.max(0, cx + (left + i + 0.5 - cx) * r.k - 0.5));
      const x0 = Math.floor(x), x1 = Math.min(w - 1, x0 + 1), fx = x - x0;
      const a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, d = (y1 * w + x1) * 4;
      const o = (j * W + i) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const top2 = data[a + ch] + (data[b + ch] - data[a + ch]) * fx;
        const bot2 = data[c + ch] + (data[d + ch] - data[c + ch]) * fx;
        out[o + ch] = top2 + (bot2 - top2) * fy;
      }
    }
  }
  return { data: out, width: W, height: H };
}
