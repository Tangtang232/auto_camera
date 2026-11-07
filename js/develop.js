// 拍后自动出片: automatic correction plus a look, all built from parameters
// (no third-party LUT files). Works on raw RGBA arrays so it runs in a worker and in tests.
//
// Style fields: exposure, contrast, saturation, warmth, fade (all roughly -0.2..0.2),
// shadowTint / highlightTint ([r, g, b] added in shadows / highlights), grain,
// wb (how much of the automatic white balance to apply, default 1: a sunset should stay warm),
// shoulder (0..1, rolls off the brightest tones so they don't clip).

export const STYLES = {
  clear: {
    name: '清透', exposure: 0.07, contrast: -0.08, saturation: -0.04, warmth: -0.02, fade: 0.02,
    shadowTint: [-0.01, 0.008, 0.022], highlightTint: [0, 0.004, 0.01], grain: 0,
  },
  cream: {
    name: '奶油', exposure: 0.05, contrast: -0.14, saturation: -0.18, warmth: 0.05, fade: 0.06,
    shadowTint: [0.02, 0.01, -0.004], highlightTint: [0.03, 0.016, -0.01], grain: 0,
  },
  film: {
    name: '胶片', exposure: 0, contrast: 0.12, saturation: -0.1, warmth: 0.03, fade: 0.07,
    shadowTint: [-0.02, 0.014, 0.03], highlightTint: [0.04, 0.014, -0.026], grain: 0.035,
  },
  // Portrait looks for templates (and the viewer's style strip).
  japan: {
    name: '日系', exposure: 0.1, contrast: -0.12, saturation: -0.12, warmth: -0.03, fade: 0.05,
    shadowTint: [-0.012, 0.012, 0.016], highlightTint: [0, 0.006, 0.01], grain: 0,
  },
  moody: {
    name: '暗调', exposure: -0.08, contrast: 0.14, saturation: -0.16, warmth: 0.02, fade: 0.05, shoulder: 0.4,
    shadowTint: [-0.014, 0.008, 0.022], highlightTint: [0.03, 0.012, -0.018], grain: 0.015,
  },
  // 照着调色: only the automatic correction here; colorTransfer() then moves the colors
  // toward the reference photo.
  match: {
    name: '参考色调', exposure: 0, contrast: 0, saturation: 0, warmth: 0, fade: 0,
    shadowTint: [0, 0, 0], highlightTint: [0, 0, 0], grain: 0,
  },
  // Scene looks, picked automatically by pickStyle().
  food: {
    name: '美食', exposure: 0.06, contrast: 0.1, saturation: 0.16, warmth: 0.05, fade: 0, wb: 0.5,
    shadowTint: [0.01, 0.004, -0.006], highlightTint: [0.02, 0.01, -0.01], grain: 0,
  },
  pet: {
    name: '萌宠', exposure: 0.08, contrast: -0.04, saturation: 0.04, warmth: 0.04, fade: 0.02,
    shadowTint: [0.008, 0.004, 0], highlightTint: [0.02, 0.012, 0], grain: 0,
  },
  city: {
    name: '城市', exposure: 0.02, contrast: 0.12, saturation: -0.08, warmth: -0.04, fade: 0.02,
    shadowTint: [-0.012, 0.004, 0.02], highlightTint: [0.01, 0.006, 0], grain: 0,
  },
  night: {
    name: '夜景', exposure: 0.04, contrast: 0.1, saturation: -0.04, warmth: -0.02, fade: 0, wb: 0.3, shoulder: 0.5,
    shadowTint: [-0.01, 0.006, 0.024], highlightTint: [0.03, 0.014, -0.012], grain: 0,
  },
  sunset: {
    name: '日落', exposure: 0, contrast: 0.06, saturation: 0.1, warmth: 0.07, fade: 0.02, wb: 0, shoulder: 0.6,
    shadowTint: [0.01, -0.004, 0.012], highlightTint: [0.04, 0.016, -0.02], grain: 0,
  },
};
export const STYLE_KEYS = ['original', 'japan', 'cream', 'film', 'moody', 'clear'];
export const STYLE_NAMES = {
  original: '原图', clear: '清透', cream: '奶油', film: '胶片', japan: '日系', moody: '暗调', match: '参考色调',
  food: '美食', pet: '萌宠', city: '城市', night: '夜景', sunset: '日落',
};
const BY_SCENE = { person: 'cream', food: 'food', pet: 'pet', city: 'city', night: 'night', sunset: 'sunset' };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Luma percentiles and channel means, sampling every `step`-th pixel.
export function measureTone(data, step = 4) {
  const hist = new Uint32Array(256);
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4 * step) {
    const R = data[i], G = data[i + 1], B = data[i + 2];
    hist[Math.round(0.299 * R + 0.587 * G + 0.114 * B)]++;
    r += R; g += G; b += B; n++;
  }
  const pct = (p) => {
    const target = n * p;
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v / 255; }
    return 1;
  };
  r /= n; g /= n; b /= n;
  return { lo: pct(0.005), hi: pct(0.995), mean: [r / 255, g / 255, b / 255], luma: (0.299 * r + 0.587 * g + 0.114 * b) / 255, warm: r / Math.max(b, 1) };
}

// Gentle automatic correction: levels (capped), gray-world white balance (±10%, scaled by wb),
// mid-tone gamma.
export function autoParams(t, wb = 1) {
  const black = Math.min(t.lo, 0.15);
  const white = Math.max(t.hi, 0.82);
  const gray = (t.mean[0] + t.mean[1] + t.mean[2]) / 3;
  const gains = t.mean.map((m) => 1 + (Math.min(1.1, Math.max(0.9, gray / Math.max(m, 0.01))) - 1) * wb);
  const leveled = clamp01((t.luma - black) / (white - black));
  const gamma = leveled > 0.02 ? Math.min(1.25, Math.max(0.8, Math.log(0.46) / Math.log(leveled))) : 1;
  return { black, white, gains, gamma };
}

export function pickStyle(scene, tone) {
  if (BY_SCENE[scene]) return BY_SCENE[scene];
  if (tone.warm > 1.18) return 'film';
  return 'clear';
}

// Per-channel lookup tables for white balance, levels, gamma, exposure, contrast, warmth and fade.
export function buildCurves(auto, style) {
  const s = style || { exposure: 0, contrast: 0, warmth: 0, fade: 0 };
  const warm = [1 + s.warmth, 1, 1 - s.warmth];
  return [0, 1, 2].map((c) => {
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      // White balance first, so stretching the levels doesn't widen a color cast.
      let v = clamp01((i / 255) * auto.gains[c]);
      v = clamp01((v - auto.black) / (auto.white - auto.black));
      v = v ** auto.gamma;
      v = 1 - (1 - v) ** (1 + s.exposure * 2);
      v = clamp01(v + s.contrast * (v - 0.5) * 4 * v * (1 - v));
      if (s.shoulder && v > 0.6) { const t = (v - 0.6) / 0.4; v -= s.shoulder * 0.12 * t * t; }
      v = clamp01(v * warm[c]);
      v = s.fade + v * (1 - s.fade);
      lut[i] = Math.round(v * 255);
    }
    return lut;
  });
}

export function planDevelop(tone, styleKey) {
  if (styleKey === 'original') return null;
  const style = STYLES[styleKey] || STYLES.clear;
  return {
    curves: buildCurves(autoParams(tone, style.wb ?? 1), style),
    saturation: style.saturation,
    shadowTint: style.shadowTint,
    highlightTint: style.highlightTint,
    grain: style.grain,
  };
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Applies a plan from planDevelop() in place.
export function develop(data, plan, seed = 7) {
  if (!plan) return data;
  const [cr, cg, cb] = plan.curves;
  const sat = 1 + plan.saturation;
  const [sr, sg, sb] = plan.shadowTint.map((v) => v * 255);
  const [hr, hg, hb] = plan.highlightTint.map((v) => v * 255);
  const grain = plan.grain * 255;
  const rand = grain ? rng(seed) : null;
  for (let i = 0; i < data.length; i += 4) {
    let r = cr[data[i]], g = cg[data[i + 1]], b = cb[data[i + 2]];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    r = y + (r - y) * sat;
    g = y + (g - y) * sat;
    b = y + (b - y) * sat;
    const t = y / 255, ws = (1 - t) * (1 - t), wh = t * t;
    r += sr * ws + hr * wh;
    g += sg * ws + hg * wh;
    b += sb * ws + hb * wh;
    if (rand) {
      const n = (rand() - 0.5) * grain;
      r += n; g += n; b += n;
    }
    data[i] = r; data[i + 1] = g; data[i + 2] = b; // Uint8ClampedArray clamps and rounds
  }
  return data;
}

// Box blur in place, `passes` times (two passes look close to a Gaussian). Edges clamp.
function boxBlur(a, w, h, r, passes = 2) {
  const line = new Float32Array(Math.max(w, h));
  const d = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let s = 0;
      for (let i = -r; i <= r; i++) s += a[o + Math.min(w - 1, Math.max(0, i))];
      for (let x = 0; x < w; x++) {
        line[x] = s / d;
        s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
      }
      for (let x = 0; x < w; x++) a[o + x] = line[x];
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += a[Math.min(h - 1, Math.max(0, i)) * w + x];
      for (let y = 0; y < h; y++) {
        line[y] = s / d;
        s += a[Math.min(h - 1, y + r + 1) * w + x] - a[Math.max(0, y - r) * w + x];
      }
      for (let y = 0; y < h; y++) a[y * w + x] = line[y];
    }
  }
}

// Night shots: smooth only the color (chroma) channels. Color blotches go away,
// brightness and detail stay as they were.
export function chromaDenoise(data, w, h, r = 2) {
  const n = w * h;
  const Y = new Float32Array(n), cb = new Float32Array(n), cr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const R = data[i * 4], G = data[i * 4 + 1], B = data[i * 4 + 2];
    const y = 0.299 * R + 0.587 * G + 0.114 * B;
    Y[i] = y; cb[i] = B - y; cr[i] = R - y;
  }
  boxBlur(cb, w, h, r);
  boxBlur(cr, w, h, r);
  for (let i = 0; i < n; i++) {
    const R = Y[i] + cr[i], B = Y[i] + cb[i];
    data[i * 4] = R;
    data[i * 4 + 1] = (Y[i] - 0.299 * R - 0.114 * B) / 0.587;
    data[i * 4 + 2] = B;
  }
  return data;
}

/* ---------- 照着调色: Reinhard color transfer in CIELAB ---------- */

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const GAMMA_STEPS = 4096;
const GAMMA = new Uint8ClampedArray(GAMMA_STEPS + 1);
for (let i = 0; i <= GAMMA_STEPS; i++) { const c = i / GAMMA_STEPS; GAMMA[i] = Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)); }
const XN = 0.95047, ZN = 1.08883;
const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
const finv = (t) => { const c = t * t * t; return c > 0.008856 ? c : (t - 16 / 116) / 7.787; };

function toLab(R, G, B, out) {
  const r = LIN[R], g = LIN[G], b = LIN[B];
  const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / XN);
  const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / ZN);
  out[0] = 116 * fy - 16; out[1] = 500 * (fx - fy); out[2] = 200 * (fy - fz);
}

function fromLab(L, a, bb, data, i) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200;
  const X = XN * finv(fx), Y = finv(fy), Z = ZN * finv(fz);
  const enc = (v) => GAMMA[Math.round(Math.min(1, Math.max(0, v)) * GAMMA_STEPS)];
  data[i] = enc(3.2406 * X - 1.5372 * Y - 0.4986 * Z);
  data[i + 1] = enc(-0.9689 * X + 1.8758 * Y + 0.0415 * Z);
  data[i + 2] = enc(0.0557 * X - 0.204 * Y + 1.057 * Z);
}

// Mean and spread of L, a, b over (every `step`-th pixel of) an RGBA image.
export function colorStats(data, step = 4) {
  const lab = [0, 0, 0];
  const sum = [0, 0, 0], sq = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < data.length; i += 4 * step) {
    toLab(data[i], data[i + 1], data[i + 2], lab);
    for (let c = 0; c < 3; c++) { sum[c] += lab[c]; sq[c] += lab[c] * lab[c]; }
    n++;
  }
  const mean = sum.map((v) => v / n);
  const std = sq.map((v, c) => Math.sqrt(Math.max(1e-6, v / n - mean[c] * mean[c])));
  return { mean, std };
}

// Moves the photo's color statistics toward `target` (from colorStats of the reference).
// Brightness moves only half way, so the reference can't wreck the exposure, and the spread
// is scaled at most 0.6–1.6×.
export function colorTransfer(data, target, strength = [0.5, 0.8, 0.8]) {
  const src = colorStats(data, 4);
  const ratio = target.std.map((t, c) => Math.min(1.6, Math.max(0.6, t / src.std[c])));
  const lab = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    toLab(data[i], data[i + 1], data[i + 2], lab);
    for (let c = 0; c < 3; c++) {
      const moved = (lab[c] - src.mean[c]) * ratio[c] + target.mean[c];
      lab[c] += (moved - lab[c]) * strength[c];
    }
    fromLab(lab[0], lab[1], lab[2], data, i);
  }
  return data;
}

// Backlit portrait: brighten the face with a soft oval, leave the rest alone.
// face: normalized {x0, y0, x1, y1} in this image. Returns true if anything changed.
export function fillLight(data, w, h, face) {
  if (!face) return false;
  const luma = (i) => (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
  const fx0 = Math.max(0, Math.floor(face.x0 * w)), fx1 = Math.min(w, Math.ceil(face.x1 * w));
  const fy0 = Math.max(0, Math.floor(face.y0 * h)), fy1 = Math.min(h, Math.ceil(face.y1 * h));
  if (fx1 - fx0 < 2 || fy1 - fy0 < 2) return false;
  let fs = 0, fn = 0, all = 0, an = 0;
  for (let y = fy0; y < fy1; y++) for (let x = fx0; x < fx1; x++) { fs += luma((y * w + x) * 4); fn++; }
  for (let i = 0; i < data.length; i += 4 * 16) { all += luma(i); an++; }
  const faceL = fs / fn, meanL = all / an;
  if (!(faceL < 0.4 && meanL - faceL > 0.1)) return false;
  const amount = Math.min(0.45, Math.max(0.15, (meanL - faceL) * 1.5));
  const cx = (fx0 + fx1) / 2, cy = (fy0 + fy1) / 2;
  const rx = (fx1 - fx0) * 0.9, ry = (fy1 - fy0) * 0.9; // oval reaches about twice the face size
  const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(w, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(h, Math.ceil(cy + ry));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (d >= 1) continue;
      const t = d < 0.5 ? 1 : 1 - (d - 0.5) / 0.5;
      const wgt = t * t * (3 - 2 * t);
      const i = (y * w + x) * 4;
      const l = Math.max(luma(i), 1 / 255);
      const k = Math.min(3, l ** (1 - amount * wgt) / l);
      data[i] *= k; data[i + 1] *= k; data[i + 2] *= k;
    }
  }
  return true;
}
