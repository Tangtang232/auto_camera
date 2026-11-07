// 人像分割: MediaPipe's multiclass selfie segmentation (Apache-2.0) labels every pixel as
// background, hair, body skin, face skin, clothes or other. At capture we keep two small masks:
// the person (everything but background) and the skin, for portrait.js.

import { vision } from './pose.js';
import { paintFigure } from './figure.js';

const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
const BG = 0, BODY_SKIN = 2, FACE_SKIN = 3;

let segmenter = null;
let loading = null;

export function loadSegmenter() {
  if (!loading) {
    loading = (async () => {
      const { lib, fileset } = await vision();
      segmenter = await lib.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

export const segmenterReady = () => !!segmenter;

// Mask size for a photo: small enough to store with it, big enough for the worker to refine.
export const maskSize = (w, h) => (w <= h ? [288, Math.round((288 * h) / w)] : [Math.round((288 * w) / h), 288]);

const toByte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

// source: the captured photo (canvas). Returns {w, h, person, skin} (Uint8Array, 0..255).
export function segmentPhoto(source) {
  if (!segmenter) return null;
  const [w, h] = maskSize(source.width, source.height);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(source, 0, 0, w, h);
  const result = segmenter.segment(c);
  try {
    const masks = result.confidenceMasks;
    const mw = masks[BG].width, mh = masks[BG].height;
    const bg = masks[BG].getAsFloat32Array();
    const body = masks[BODY_SKIN].getAsFloat32Array();
    const face = masks[FACE_SKIN].getAsFloat32Array();
    const person = new Uint8Array(mw * mh), skin = new Uint8Array(mw * mh);
    for (let i = 0; i < person.length; i++) {
      person[i] = toByte(1 - bg[i]);
      skin[i] = toByte(Math.min(1, body[i] + face[i]));
    }
    return { w: mw, h: mh, person, skin };
  } finally {
    if (result && result.close) result.close();
  }
}

// Demo mode: masks painted from the demo figure (body = person, head and hands = skin).
export function demoSegment(lm, s, photoW, photoH) {
  if (!lm) return null;
  const [w, h] = maskSize(photoW, photoH);
  const paint = (colors) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    paintFigure(ctx, w, h, lm, s, colors);
    const d = ctx.getImageData(0, 0, w, h).data;
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = d[i * 4];
    return out;
  };
  const white = '#ffffff', black = '#000000';
  return {
    w, h,
    person: paint({ legs: white, body: white, skin: white, hair: white }),
    skin: paint({ legs: black, body: black, skin: white, hair: black }),
  };
}
