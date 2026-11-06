// On-device body pose detection with MediaPipe Pose Landmarker.
// The library and model download once, then the service worker keeps them for offline use.
// Nothing about the camera image leaves the phone.

const VERSION = '0.10.14';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let lib = null;
let fileset = null;
let videoLandmarker = null;
let imageLandmarker = null;
let lastTs = 0;

async function create(runningMode) {
  lib ??= await import(`${BASE}/vision_bundle.mjs`);
  fileset ??= await lib.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    return await lib.PoseLandmarker.createFromOptions(fileset, options('GPU'));
  } catch (err) {
    console.warn('GPU delegate unavailable, falling back to CPU', err);
    return lib.PoseLandmarker.createFromOptions(fileset, options('CPU'));
  }
}

export async function loadPose() {
  videoLandmarker ??= await create('VIDEO');
}

export function detectVideo(source, ts) {
  if (!videoLandmarker) return null;
  if (ts <= lastTs) ts = lastTs + 1;
  lastTs = ts;
  const r = videoLandmarker.detectForVideo(source, ts);
  return r.landmarks && r.landmarks[0] ? r.landmarks[0].map((p) => ({ ...p })) : null;
}

export async function detectImage(source) {
  imageLandmarker ??= await create('IMAGE');
  const r = imageLandmarker.detect(source);
  return r.landmarks && r.landmarks[0] ? r.landmarks[0].map((p) => ({ ...p })) : null;
}
