// 拍后自动出片: automatic correction plus one of three looks, all built from parameters
// (no third-party LUT files). Works on raw RGBA arrays so it runs in a worker and in tests.

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
};
export const STYLE_KEYS = ['original', 'clear', 'cream', 'film'];
export const STYLE_NAMES = { original: '原图', clear: '清透', cream: '奶油', film: '胶片' };

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

// Gentle automatic correction: levels (capped), gray-world white balance (±10%), mid-tone gamma.
export function autoParams(t) {
  const black = Math.min(t.lo, 0.15);
  const white = Math.max(t.hi, 0.82);
  const gray = (t.mean[0] + t.mean[1] + t.mean[2]) / 3;
  const gains = t.mean.map((m) => Math.min(1.1, Math.max(0.9, gray / Math.max(m, 0.01))));
  const leveled = clamp01((t.luma - black) / (white - black));
  const gamma = leveled > 0.02 ? Math.min(1.25, Math.max(0.8, Math.log(0.46) / Math.log(leveled))) : 1;
  return { black, white, gains, gamma };
}

export function pickStyle(scene, tone) {
  if (scene === 'person') return 'cream';
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
    curves: buildCurves(autoParams(tone), style),
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
