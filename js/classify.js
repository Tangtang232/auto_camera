// Scene classifier: MediaPipe Image Classifier with EfficientNet-Lite0 (int8, ImageNet labels).
// Runs on the phone about once a second; scene.js turns its labels into food / pet / city.

import { vision } from './pose.js';

const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/int8/1/efficientnet_lite0.tflite';

let classifier = null;
let loading = null;

export function loadClassifier() {
  if (!loading) {
    loading = (async () => {
      const { lib, fileset } = await vision();
      classifier = await lib.ImageClassifier.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        maxResults: 10,
      });
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

export const classifierReady = () => !!classifier;

// source: a canvas or image. Returns [{index, score, name}], best first, or null if not loaded.
export function classify(source) {
  if (!classifier) return null;
  const r = classifier.classify(source);
  const c = r && r.classifications && r.classifications[0];
  return c ? c.categories.map((k) => ({ index: k.index, score: k.score, name: k.categoryName })) : [];
}
