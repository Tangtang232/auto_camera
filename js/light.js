// Light check on the small analysis image: is the face backlit, is the scene too dark,
// is a large area blowing out? Works on any RGBA {data, width, height}.

const FACE_POINTS = [0, 2, 5, 7, 8]; // nose, eyes, ears

export function measureLight(img, lm) {
  const { data, width: w, height: h } = img;
  const n = w * h;
  const lum = new Float32Array(n);
  let sum = 0;
  let clipped = 0;
  for (let i = 0; i < n; i++) {
    const l = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
    lum[i] = l;
    sum += l;
    if (l > 0.97) clipped++;
  }
  const out = { mean: sum / n, clip: clipped / n, face: null };
  if (!lm) return out;

  const pts = FACE_POINTS.map((i) => lm[i]).filter((p) => p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
  if (pts.length < 3) return out;
  const xs = pts.map((p) => p.x * w);
  const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const cy = lm[0].y * h;
  const fw = Math.max(2, (Math.max(...xs) - Math.min(...xs)) * 1.1);
  const fh = Math.max(2, fw * 1.3);
  const x0 = Math.max(0, Math.floor(cx - fw / 2)), x1 = Math.min(w, Math.ceil(cx + fw / 2));
  const y0 = Math.max(0, Math.floor(cy - fh / 2)), y1 = Math.min(h, Math.ceil(cy + fh / 2));
  let fs = 0;
  let fn = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) { fs += lum[y * w + x]; fn++; }
  }
  if (fn) out.face = fs / fn;
  return out;
}

export function lightRules(m, selfie, out) {
  if (!m) return;
  if (m.face != null && m.face < 0.35 && m.mean - m.face > 0.18) {
    out.push({
      id: 'backlight', level: 'warn', order: 6,
      text: selfie ? '转个身，脸朝着光' : '换个方向，让光照在脸上', why: '逆光了，脸太暗',
      voice: '转个身，脸朝着光',
    });
  } else if (m.mean < 0.14) {
    out.push({ id: 'dark', level: 'warn', order: 7, text: '找亮一点的地方', why: '光线太暗，照片会糊、有噪点' });
  }
  if (m.clip > 0.22) {
    out.push({ id: 'blown', level: 'tip', order: 12, text: '换个角度，避开强光', why: '亮的地方要过曝了' });
  }
}
