// Light check on the small analysis image: is the face backlit, is the scene too dark,
// is a large area blowing out, is the sky warm (sunset)? Works on any RGBA {data, width, height}.

const FACE_POINTS = [0, 2, 5, 7, 8]; // nose, eyes, ears

// The face as a normalized box {x0, y0, x1, y1}, centered on the nose. aspect = width / height.
export function faceBox(lm, aspect = 3 / 4) {
  if (!lm) return null;
  const pts = FACE_POINTS.map((i) => lm[i]).filter((p) => p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p.x);
  const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const cy = lm[0].y;
  const fw = Math.max(0.01, (Math.max(...xs) - Math.min(...xs)) * 1.1);
  const fh = fw * 1.3 * aspect;
  return {
    x0: Math.max(0, cx - fw / 2), x1: Math.min(1, cx + fw / 2),
    y0: Math.max(0, cy - fh / 2), y1: Math.min(1, cy + fh / 2),
  };
}

export function measureLight(img, lm) {
  const { data, width: w, height: h } = img;
  const n = w * h;
  const lum = new Float32Array(n);
  const topRows = Math.max(1, Math.round(h * 0.3));
  const bottomFrom = Math.floor(h * 0.6);
  let sum = 0, clipped = 0;
  let tr = 0, tg = 0, tb = 0, tn = 0, bs = 0, bn = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    lum[i] = l;
    sum += l;
    if (l > 0.97) clipped++;
    const y = Math.floor(i / w);
    if (y < topRows) { tr += r; tg += g; tb += b; tn++; } else if (y >= bottomFrom) { bs += l; bn++; }
  }
  const out = {
    mean: sum / n, clip: clipped / n, face: null,
    top: [tr / tn, tg / tn, tb / tn], bottom: bn ? bs / bn : sum / n,
  };
  const f = faceBox(lm, w / h);
  if (!f) return out;
  const x0 = Math.floor(f.x0 * w), x1 = Math.max(x0 + 1, Math.ceil(f.x1 * w));
  const y0 = Math.floor(f.y0 * h), y1 = Math.max(y0 + 1, Math.ceil(f.y1 * h));
  let fs = 0, fn = 0;
  for (let y = y0; y < Math.min(h, y1); y++) {
    for (let x = x0; x < Math.min(w, x1); x++) { fs += lum[y * w + x]; fn++; }
  }
  if (fn) out.face = fs / fn;
  return out;
}

// opt: {scene, sunset}. At sunset a dark face is often the point (a silhouette),
// and in a night scene "find more light" is not helpful advice.
export function lightRules(m, selfie, out, opt = {}) {
  if (!m) return;
  const { scene = null, sunset = false } = opt;
  if (m.face != null && m.face < 0.35 && m.mean - m.face > 0.18) {
    if (sunset) {
      out.push({ id: 'backlight', level: 'tip', order: 12, text: '想拍清脸就换个方向，想拍剪影就这样拍', why: '夕阳在背后，脸会暗' });
    } else {
      out.push({
        id: 'backlight', level: 'warn', order: 6,
        text: selfie ? '转个身，脸朝着光' : '换个方向，让光照在脸上', why: '逆光了，脸太暗',
        voice: '转个身，脸朝着光',
      });
    }
  } else if (m.mean < 0.14 && scene !== 'night') {
    out.push({ id: 'dark', level: 'warn', order: 7, text: '找亮一点的地方', why: '光线太暗，照片会糊、有噪点' });
  }
  if (m.clip > 0.22 && !sunset && scene !== 'night') {
    out.push({ id: 'blown', level: 'tip', order: 12, text: '换个角度，避开强光', why: '亮的地方要过曝了' });
  }
}
