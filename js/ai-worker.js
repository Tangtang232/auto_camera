// Background AI work, kept off the main thread so the viewfinder never stalls:
//   score    rate the 90 GAIC crops of a 256×256 frame
//   develop  crop (optional) + auto-correct + style a captured photo, return a JPEG

import { bestBox, boxesContaining } from './frame.js';
import { measureTone, pickStyle, planDevelop, develop } from './develop.js';

const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
const MODEL = new URL('../models/gaic_mobilenetv2.onnx', import.meta.url).href;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const S = 256;

let loading = null;
function loadModel() {
  if (!loading) {
    loading = (async () => {
      const ort = await import(`${ORT}ort.wasm.min.mjs`);
      ort.env.wasm.wasmPaths = ORT;
      ort.env.wasm.numThreads = 1; // GitHub Pages can't enable cross-origin isolation for threads
      const session = await ort.InferenceSession.create(MODEL, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      return { ort, session };
    })();
    loading.catch(() => { loading = null; }); // let a later call retry
  }
  return loading;
}

// One inference at a time on the shared session.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

async function score(rgba) {
  const { ort, session } = await loadModel();
  const n = S * S;
  const f = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    f[i] = (rgba[i * 4] / 255 - MEAN[0]) / STD[0];
    f[n + i] = (rgba[i * 4 + 1] / 255 - MEAN[1]) / STD[1];
    f[2 * n + i] = (rgba[i * 4 + 2] / 255 - MEAN[2]) / STD[2];
  }
  return serial(async () => {
    const out = await session.run({ image: new ort.Tensor('float32', f, [1, 3, S, S]) });
    return Float32Array.from(out.scores.data);
  });
}

// keep: optional {x0, y0, x1, y1} the crop must contain (the person in the shot).
async function developPhoto({ blob, style, crop, scene, keep }) {
  const bmp = await createImageBitmap(blob);
  let box = null;
  const ids = boxesContaining(keep || null);
  if (crop && ids.length) {
    try {
      const small = new OffscreenCanvas(S, S);
      const sctx = small.getContext('2d', { willReadFrequently: true });
      sctx.drawImage(bmp, 0, 0, S, S);
      const pick = bestBox(await score(sctx.getImageData(0, 0, S, S).data), ids);
      if (!pick.aligned) box = pick.box;
    } catch (err) {
      console.warn('AI crop unavailable, keeping the full frame', err);
    }
  }
  const sx = box ? Math.round(box.x * bmp.width) : 0;
  const sy = box ? Math.round(box.y * bmp.height) : 0;
  const sw = box ? Math.round(box.w * bmp.width) : bmp.width;
  const sh = box ? Math.round(box.h * bmp.height) : bmp.height;
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  bmp.close();

  const img = ctx.getImageData(0, 0, sw, sh);
  const tone = measureTone(img.data, 16);
  const key = style === 'auto' ? pickStyle(scene, tone) : style;
  const plan = planDevelop(tone, key);
  if (plan) {
    develop(img.data, plan);
    ctx.putImageData(img, 0, 0);
  }
  const out = plan || box ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 }) : null;
  return { blob: out, style: key, crop: box, w: sw, h: sh };
}

self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    let result = true;
    if (type === 'load') await loadModel();
    else if (type === 'score') result = await score(e.data.rgba);
    else if (type === 'develop') result = await developPhoto(e.data);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
