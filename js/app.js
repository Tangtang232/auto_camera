// 拍好: camera, frame loop, and the UI around the guidance logic.

import { coverCrop, SHOT_NAME } from './geom.js';
import { analyze, findHorizon, finish } from './guide.js';
import { prepareReference, compareToReference, compareScene, alignImages, grayOf, boneLimb } from './match.js';
import { drawOverlay, COLOR, scoreColor } from './draw.js';
import { demoFrame, paintDemo, demoPose, DEMO_FINAL } from './demo.js';
import * as pose from './pose.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const el = {
  app: $('app'), stage: $('stage'), vf: $('vf'), video: $('video'), demo: $('demoCanvas'),
  onion: $('onion'), overlay: $('overlay'),
  sceneBadge: $('sceneBadge'), sceneText: $('sceneText'), demoBadge: $('demoBadge'),
  hint: $('hint'), hintText: $('hintText'), hintWhy: $('hintWhy'),
  refPanel: $('refPanel'), refThumb: $('refThumb'), refThumbBtn: $('refThumbBtn'), onionBtn: $('onionBtn'),
  refFile: $('refFile'), refFile2: $('refFile2'), refClear: $('refClear'), refEmpty: $('refEmpty'), refDemo: $('refDemo'),
  motionChip: $('motionChip'),
  camError: $('camError'), camErrTitle: $('camErrTitle'), camErrText: $('camErrText'), camRetry: $('camRetry'), camDemo: $('camDemo'),
  flash: $('flash'),
  thumbBtn: $('thumbBtn'), thumbImg: $('thumbImg'), countBadge: $('countBadge'),
  shutter: $('shutter'), ringArc: $('ringArc'), readyLabel: $('readyLabel'), flipBtn: $('flipBtn'),
  voiceBtn: $('voiceBtn'), helpBtn: $('helpBtn'), modeBtns: [...document.querySelectorAll('[data-mode]')],
  sheet: $('sheet'), sheetClose: $('sheetClose'), grid: $('grid'), sheetEmpty: $('sheetEmpty'),
  saveBtn: $('saveBtn'), delBtn: $('delBtn'),
  help: $('help'), helpClose: $('helpClose'), toast: $('toast'), hapticLabel: $('hapticLabel'),
};

const RING = 2 * Math.PI * 40;
const params = new URLSearchParams(location.search);
const pct = (v) => Math.round(v * 100);

const prefs = {
  get(k, d) {
    try { const v = localStorage.getItem(`paihao.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(`paihao.${k}`, JSON.stringify(v)); } catch { /* storage blocked */ }
  },
};

const freshStab = () => ({ shownId: null, shownAt: 0, candId: null, candAt: 0, hint: null });

const state = {
  mode: 'guide',
  facing: 'environment',
  demo: params.has('demo'),
  demoStart: 0,
  demoNow: null,
  voice: prefs.get('voice', false),
  aspect: 3 / 4,
  sized: false,
  dpr: 1,
  stream: null,
  camToken: 0,
  poseState: 'idle', // idle | loading | ready | failed
  rawLm: null,
  lm: null,
  lastSeen: 0,
  lastVideoTime: -1,
  tilt: null,
  tiltAt: 0,
  motionOn: false,
  horizon: null,
  horizonAt: 0,
  align: null,
  ref: null,
  photos: [],
  frame: 0,
  stab: freshStab(),
  spokeAt: 0,
};

const ana = document.createElement('canvas');
const actx = ana.getContext('2d');
const small = document.createElement('canvas');
const sctx = small.getContext('2d', { willReadFrequently: true });
const octx = el.overlay.getContext('2d');
const dctx = el.demo.getContext('2d');

const isSelfie = () => !state.demo && state.facing === 'user';
const isMirror = isSelfie;

/* ---------- layout ---------- */

function layout() {
  const landscape = matchMedia('(orientation: landscape) and (pointer: coarse)').matches;
  el.app.classList.toggle('landscape', landscape);
  const aspect = landscape ? 4 / 3 : 3 / 4;
  const r = el.stage.getBoundingClientRect();
  let w = r.width;
  let h = w / aspect;
  if (h > r.height) { h = r.height; w = h * aspect; }
  w = Math.max(1, Math.floor(w));
  h = Math.max(1, Math.floor(h));
  el.vf.style.width = `${w}px`;
  el.vf.style.height = `${h}px`;
  state.dpr = Math.min(window.devicePixelRatio || 1, 3);
  el.overlay.width = Math.round(w * state.dpr);
  el.overlay.height = Math.round(h * state.dpr);
  if (aspect !== state.aspect || !state.sized) {
    state.sized = true;
    state.aspect = aspect;
    const portrait = aspect < 1;
    ana.width = portrait ? 360 : 480;
    ana.height = portrait ? 480 : 360;
    small.width = portrait ? 48 : 64;
    small.height = portrait ? 64 : 48;
    el.demo.width = portrait ? 600 : 800;
    el.demo.height = portrait ? 800 : 600;
    state.lm = null;
    state.rawLm = null;
    state.horizon = null;
    state.align = null;
    if (state.ref) prepareRefData();
  }
}

/* ---------- camera ---------- */

const CAM_ERRORS = {
  NotAllowedError: ['没有摄像头权限', '请在 iPhone「设置 → Safari 浏览器 → 摄像头」里选「允许」，再回来点「重试」。'],
  SecurityError: ['没有摄像头权限', '请在 iPhone「设置 → Safari 浏览器 → 摄像头」里选「允许」，再回来点「重试」。'],
  NotFoundError: ['没找到摄像头', '这台设备上没有能用的摄像头，可以先看看演示。'],
  OverconstrainedError: ['没找到摄像头', '这台设备上没有能用的摄像头，可以先看看演示。'],
  NotReadableError: ['摄像头正被占用', '先关掉正在用摄像头的其他 App，再点「重试」。'],
  insecure: ['需要用 https 打开', '浏览器只允许 https 页面使用摄像头。'],
  unsupported: ['这个浏览器用不了摄像头', '请用 iPhone 上的 Safari 打开。'],
};

async function startCamera() {
  if (state.demo) return;
  const token = ++state.camToken;
  stopCamera();
  el.camError.hidden = true;
  if (!window.isSecureContext) return cameraFailed('insecure');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return cameraFailed('unsupported');
  const facingMode = { ideal: state.facing };
  const attempts = [{ facingMode, width: { ideal: 3840 }, height: { ideal: 2160 } }, { facingMode }];
  let stream = null;
  let lastErr = null;
  for (const video of attempts) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      break;
    } catch (e) {
      lastErr = e;
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') break;
    }
  }
  if (token !== state.camToken) { if (stream) stream.getTracks().forEach((t) => t.stop()); return; }
  if (!stream) return cameraFailed(lastErr && lastErr.name);
  state.stream = stream;
  el.video.srcObject = stream;
  el.video.classList.toggle('mirror', isMirror());
  state.lastVideoTime = -1;
  try { await el.video.play(); } catch { /* autoplay is allowed for muted inline video */ }
}

function stopCamera() {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null;
  el.video.srcObject = null;
}

function cameraFailed(name) {
  const [title, text] = CAM_ERRORS[name] || ['打不开摄像头', '点「重试」再来一次。还不行的话，可以先看看演示。'];
  el.camErrTitle.textContent = title;
  el.camErrText.textContent = text;
  el.camError.hidden = false;
}

function startDemo() {
  state.demo = true;
  state.camToken++;
  stopCamera();
  state.demoStart = performance.now();
  el.video.hidden = true;
  el.demo.hidden = false;
  el.demoBadge.hidden = false;
  el.camError.hidden = true;
  el.motionChip.hidden = true;
  state.lm = null;
  state.rawLm = null;
  state.stab = freshStab();
  renderRefUI();
}

function sourceInfo() {
  if (state.demo) return { el: el.demo, w: el.demo.width, h: el.demo.height };
  const v = el.video;
  if (!state.stream || v.readyState < 2 || !v.videoWidth) return null;
  return { el: v, w: v.videoWidth, h: v.videoHeight };
}

/* ---------- AI model ---------- */

async function loadModel() {
  if (state.poseState === 'loading' || state.poseState === 'ready') return;
  state.poseState = 'loading';
  try {
    await pose.loadPose();
    state.poseState = 'ready';
  } catch (e) {
    console.error(e);
    state.poseState = 'failed';
    toast('AI 模型没加载上。检查网络后，点左上角重试');
  }
}

/* ---------- level (motion sensor) ---------- */

function initMotion() {
  if (typeof DeviceMotionEvent === 'undefined') return;
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    el.motionChip.hidden = false; // iOS asks only from a tap
  } else {
    addEventListener('devicemotion', onMotion);
    state.motionOn = true;
  }
}

async function requestMotion() {
  el.motionChip.hidden = true;
  if (state.motionOn) return;
  try {
    const r = await DeviceMotionEvent.requestPermission();
    if (r === 'granted') {
      addEventListener('devicemotion', onMotion);
      state.motionOn = true;
    } else {
      toast('不开水平仪也能拍，只是少了“拿正”的提示');
    }
  } catch { /* refused or not from a tap */ }
}

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null || a.y == null) return;
  const g = Math.hypot(a.x, a.y, a.z || 0) || 9.8;
  state.tiltAt = performance.now();
  if (Math.abs(a.z || 0) / g > 0.8) { state.tilt = null; return; } // lying flat: no horizon to level
  // Rotation in the screen plane; deviation from the nearest upright/sideways position.
  // Works whichever sign convention the browser uses for gravity.
  const th = (Math.atan2(-a.x, a.y) * 180) / Math.PI;
  const dev = th - 90 * Math.round(th / 90);
  state.tilt = state.tilt == null ? dev : state.tilt + (dev - state.tilt) * 0.25;
}

function currentTilt() {
  if (state.demo) return state.demoNow ? state.demoNow.tilt : null;
  return performance.now() - state.tiltAt < 1500 ? state.tilt : null;
}

/* ---------- frame loop ---------- */

function smooth(prev, raw, now) {
  if (!raw) return prev && now - state.lastSeen < 400 ? prev : null;
  state.lastSeen = now;
  if (!prev || prev.length !== raw.length) return raw;
  const k = 0.5;
  return raw.map((p, i) => ({
    x: prev[i].x + (p.x - prev[i].x) * k,
    y: prev[i].y + (p.y - prev[i].y) * k,
    z: p.z,
    visibility: p.visibility,
  }));
}

function sampleSmall(now) {
  sctx.drawImage(ana, 0, 0, small.width, small.height);
  const img = sctx.getImageData(0, 0, small.width, small.height);
  const h = findHorizon(img);
  if (h.y != null) {
    state.horizon = state.horizon && state.horizon.y != null
      ? { ...h, y: state.horizon.y + (h.y - state.horizon.y) * 0.4 }
      : h;
    state.horizonAt = now;
  } else if (now - state.horizonAt > 800) {
    state.horizon = null;
  }
  const d = state.ref && state.ref.data;
  if (state.mode === 'match' && d && !d.prep && d.gray && d.w === small.width && d.h === small.height) {
    state.align = alignImages(d.gray, grayOf(img), small.width, small.height);
  }
}

function evaluate() {
  const selfie = isSelfie();
  const tilt = currentTilt();
  if (state.mode === 'match') {
    const d = state.ref && state.ref.data;
    if (!d) return { kind: 'empty', ...finish('none', null, []) };
    if (d.prep) return { kind: 'match', ...compareToReference(d.prep, state.lm, state.aspect, selfie, tilt) };
    if (state.align) return { kind: 'scene', ...compareScene(state.align, selfie, tilt, small.width, small.height) };
    return { kind: 'scene', ...finish('none', null, []) };
  }
  return {
    kind: 'guide',
    ...analyze({ lm: state.lm, aspect: state.aspect, selfie, tilt, horizon: state.lm ? null : state.horizon }),
  };
}

function loop(now) {
  requestAnimationFrame(loop);
  state.frame++;
  if (state.demo) {
    state.demoNow = demoFrame((now - state.demoStart) / 1000, state.aspect);
    paintDemo(dctx, el.demo.width, el.demo.height, state.demoNow);
  }
  const src = sourceInfo();
  if (!src) {
    octx.clearRect(0, 0, el.overlay.width, el.overlay.height);
    if (!el.camError.hidden) renderHint(null);
    return;
  }
  const crop = coverCrop(src.w, src.h, state.aspect);
  actx.drawImage(src.el, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, ana.width, ana.height);

  let raw = state.rawLm;
  if (state.demo) {
    raw = state.demoNow.lm;
  } else if (state.poseState === 'ready') {
    const vt = el.video.currentTime;
    if (vt !== state.lastVideoTime) {
      state.lastVideoTime = vt;
      try { raw = pose.detectVideo(ana, now); } catch (e) { console.error(e); raw = null; }
    }
  }
  state.rawLm = raw;
  state.lm = smooth(state.lm, raw, now);

  if (state.frame % 5 === 0) sampleSmall(now);
  present(evaluate(), now);
}

/* ---------- presenting a result ---------- */

function readyHint(result) {
  const tip = result.hints.find((h) => h.level === 'tip');
  let why = '按下快门';
  if (result.similarity != null) why = `和参考图 ${pct(result.similarity)}% 像`;
  if (tip) why = `还可以：${tip.text}`;
  return { id: 'ready', level: 'good', text: '可以拍了', why };
}

function idleHint(result) {
  if (result.kind === 'match' || result.kind === 'scene') {
    return { id: 'idle', level: 'idle', text: '慢慢对齐参考图', why: result.similarity != null ? `现在 ${pct(result.similarity)}% 像` : '' };
  }
  if (!state.demo && state.poseState === 'loading') {
    return { id: 'idle', level: 'idle', text: 'AI 正在准备', why: '第一次打开要下载约 6 MB 的模型' };
  }
  return { id: 'idle', level: 'idle', text: '对准要拍的人或风景', why: '' };
}

// One hint at a time, and no flicker: a new hint must hold for 280 ms,
// and a shown hint stays at least 900 ms unless the frame becomes ready.
function pickHint(result, now) {
  const s = state.stab;
  if (result.kind === 'empty') { s.shownId = null; s.hint = null; return null; }
  const blocking = result.hints.find((h) => h.level !== 'tip');
  const id = blocking ? blocking.id : result.ready ? 'ready' : result.hints[0] ? result.hints[0].id : 'idle';
  if (id !== s.candId) { s.candId = id; s.candAt = now; }
  const settled = now - s.candAt > 280;
  const held = now - s.shownAt < 900 && s.shownId !== 'ready' && s.shownId !== 'idle' && id !== 'ready';
  let changed = false;
  if (s.shownId == null || (id !== s.shownId && settled && !held)) {
    changed = s.shownId !== id;
    s.shownId = id;
    s.shownAt = now;
  }
  const cur = result.hints.find((h) => h.id === s.shownId);
  if (cur) s.hint = cur;
  else if (s.shownId === 'ready') s.hint = readyHint(result);
  else if (s.shownId === 'idle' || !s.hint) s.hint = idleHint(result);
  if (changed) onHintChanged(s.hint);
  return s.hint;
}

function onHintChanged(h) {
  if (!h) return;
  if (h.id === 'ready') { haptic(); speak('可以拍了'); return; }
  if (h.level === 'idle') return;
  speak(h.voice || h.text);
}

let lastHintKey = '';
function renderHint(h) {
  if (!h) {
    if (lastHintKey !== '') { el.hint.hidden = true; lastHintKey = ''; }
    return;
  }
  const key = `${h.id}|${h.level}|${h.text}|${h.why || ''}`;
  if (key === lastHintKey) return;
  const idChanged = el.hint.dataset.id !== h.id || el.hint.hidden;
  lastHintKey = key;
  el.hint.hidden = false;
  el.hint.dataset.level = h.level;
  el.hint.dataset.id = h.id;
  el.hintText.textContent = h.text;
  el.hintWhy.textContent = h.why || '';
  if (idChanged) {
    el.hint.classList.remove('pop');
    void el.hint.offsetWidth;
    el.hint.classList.add('pop');
  }
}

let lastRing = '';
function setRing(v, tone) {
  const off = (RING * (1 - Math.max(0, Math.min(1, v)))).toFixed(1);
  const key = off + tone;
  if (key === lastRing) return;
  lastRing = key;
  el.ringArc.style.strokeDashoffset = off;
  el.shutter.dataset.state = tone;
}

let lastBadge = '';
let lastLabel = '';
function present(result, now) {
  const hint = pickHint(result, now);
  renderHint(hint);

  const shownReady = state.stab.shownId === 'ready';
  const tone = shownReady ? 'good' : hint && (hint.level === 'bad' || hint.level === 'warn') ? hint.level : 'idle';
  const isMatch = result.similarity != null;
  let value = 0;
  if (isMatch) value = result.similarity;
  else if (result.scene !== 'none') value = shownReady ? 1 : Math.min(result.score, 0.9);
  setRing(value, tone);

  const label = isMatch ? `${pct(result.similarity)}% 像` : '';
  if (label + tone !== lastLabel) {
    lastLabel = label + tone;
    el.readyLabel.textContent = label;
    el.readyLabel.hidden = !label;
    el.readyLabel.dataset.tone = tone;
  }

  let badge;
  let level = 'idle';
  if (!state.demo && state.poseState === 'failed') { badge = 'AI 没加载上 · 点我重试'; level = 'bad'; }
  else if (state.mode === 'match') {
    if (!state.ref) badge = '照着拍';
    else if (state.ref.busy) badge = '正在分析参考图…';
    else if (state.ref.data && !state.ref.data.prep) { badge = '照着拍 · 对齐构图'; level = tone; }
    else { badge = '照着拍 · 对齐姿势'; level = tone; }
  } else if (!state.demo && state.poseState !== 'ready') badge = 'AI 加载中…';
  else if (result.scene === 'person') { badge = `人像 · ${SHOT_NAME[result.person.shot]}`; level = tone; }
  else if (result.scene === 'landscape') { badge = '风景'; level = tone; }
  else badge = '寻找拍摄对象';
  if (badge + level !== lastBadge) {
    lastBadge = badge + level;
    el.sceneText.textContent = badge;
    el.sceneBadge.dataset.level = level;
  }

  const cur = hint ? result.hints.find((h) => h.id === hint.id) : null;
  const ghost = result.kind === 'match' && state.ref && state.ref.data ? state.ref.data.lm : null;
  const toneColor = COLOR[tone] || COLOR.idle;
  const boneColor = result.kind === 'match'
    ? (a, b) => {
      const id = boneLimb(a, b);
      const s = id ? result.limbScores[id] : undefined;
      return s == null ? toneColor : scoreColor(s);
    }
    : () => toneColor;
  let horizon = null;
  if (result.kind === 'guide' && result.scene === 'landscape' && state.horizon && state.horizon.y != null) {
    horizon = { y: state.horizon.y, target: cur && cur.horizon ? cur.horizon.target : null };
  }
  drawOverlay(octx, el.overlay.width, el.overlay.height, state.dpr, {
    mirror: isMirror(),
    time: now,
    tilt: currentTilt(),
    lm: state.lm,
    boneColor,
    ghost,
    arrow: cur && cur.arrow ? cur.arrow : null,
    box: cur && cur.box ? cur.box : null,
    edge: cur && cur.edge ? cur.edge : null,
    horizon,
  });
}

/* ---------- capture & photos ---------- */

const urls = new Map();
function photoUrl(p) {
  if (!urls.has(p.id)) urls.set(p.id, URL.createObjectURL(p.blob));
  return urls.get(p.id);
}

async function capture() {
  const src = sourceInfo();
  if (!src) { toast('相机还没准备好'); return; }
  const crop = coverCrop(src.w, src.h, state.aspect);
  const c = document.createElement('canvas');
  c.width = Math.round(crop.sw);
  c.height = Math.round(crop.sh);
  c.getContext('2d').drawImage(src.el, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, c.width, c.height);
  el.flash.classList.remove('on');
  void el.flash.offsetWidth;
  el.flash.classList.add('on');
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
  if (!blob) { toast('没拍上，再按一次'); return; }
  const photo = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, blob, ts: Date.now(), w: c.width, h: c.height, saved: false };
  state.photos.push(photo);
  store.putPhoto(photo).catch(() => {});
  updateThumb(true);
  if (!prefs.get('firstShotTold', false)) {
    prefs.set('firstShotTold', true);
    toast('拍好了。照片先放在 App 里，点左下角存到相册', 3600);
  }
}

function updateThumb(bump) {
  const last = state.photos[state.photos.length - 1];
  const unsaved = state.photos.filter((p) => !p.saved).length;
  el.thumbImg.hidden = !last;
  if (last) el.thumbImg.src = photoUrl(last);
  el.countBadge.hidden = !unsaved;
  el.countBadge.textContent = String(unsaved);
  el.thumbBtn.setAttribute('aria-label', unsaved ? `还有 ${unsaved} 张没存到相册` : '本次拍的照片');
  if (bump) {
    el.thumbBtn.classList.remove('bump');
    void el.thumbBtn.offsetWidth;
    el.thumbBtn.classList.add('bump');
  }
}

const selected = new Set();
let delArmed = false;
let delTimer = 0;

function openSheet() {
  selected.clear();
  state.photos.forEach((p) => { if (!p.saved) selected.add(p.id); });
  delArmed = false;
  buildGrid();
  el.sheet.hidden = false;
}

function closeSheet() { el.sheet.hidden = true; }

function buildGrid() {
  const items = [...state.photos].reverse().map((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ph';
    b.dataset.id = p.id;
    b.setAttribute('aria-pressed', String(selected.has(p.id)));
    b.setAttribute('aria-label', `${new Date(p.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 拍的照片`);
    const img = document.createElement('img');
    img.src = photoUrl(p);
    img.alt = '';
    const check = document.createElement('span');
    check.className = 'check';
    check.setAttribute('aria-hidden', 'true');
    b.append(img, check);
    if (p.saved) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = '已存';
      b.append(tag);
    }
    return b;
  });
  el.grid.replaceChildren(...items);
  el.sheetEmpty.hidden = state.photos.length > 0;
  updateSheetButtons();
}

function updateSheetButtons() {
  const n = selected.size;
  el.saveBtn.disabled = !n;
  el.delBtn.disabled = !n;
  el.saveBtn.textContent = n ? `存到相册（${n}）` : '存到相册';
  el.delBtn.textContent = delArmed && n ? `确认删除 ${n} 张` : n ? `删除（${n}）` : '删除';
  el.delBtn.classList.toggle('danger', delArmed);
}

// navigator.share must start inside the tap, so nothing here awaits before it.
function saveSelected() {
  const list = state.photos.filter((p) => selected.has(p.id));
  if (!list.length) return;
  const files = list.map((p) => new File([p.blob], `paihao-${p.ts}.jpg`, { type: 'image/jpeg' }));
  const done = () => {
    list.forEach((p) => { p.saved = true; store.putPhoto(p).catch(() => {}); });
    selected.clear();
    buildGrid();
    updateThumb(false);
  };
  if (navigator.canShare && navigator.canShare({ files })) {
    navigator.share({ files })
      .then(() => { done(); toast('好了'); })
      .catch((e) => { if (e && e.name !== 'AbortError') toast('分享菜单没打开，再点一次试试'); });
  } else {
    files.forEach((f) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f);
      a.download = f.name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
    done();
    toast('照片已下载');
  }
}

function deleteSelected() {
  if (!selected.size) return;
  if (!delArmed) {
    delArmed = true;
    updateSheetButtons();
    clearTimeout(delTimer);
    delTimer = setTimeout(() => { delArmed = false; updateSheetButtons(); }, 3000);
    return;
  }
  clearTimeout(delTimer);
  const ids = [...selected];
  state.photos = state.photos.filter((p) => !selected.has(p.id));
  ids.forEach((id) => { const u = urls.get(id); if (u) URL.revokeObjectURL(u); urls.delete(id); });
  store.removePhotos(ids).catch(() => {});
  selected.clear();
  delArmed = false;
  buildGrid();
  updateThumb(false);
}

/* ---------- 照着拍 reference ---------- */

function setMode(m) {
  if (state.mode === m) return;
  state.mode = m;
  el.modeBtns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
  state.stab = freshStab();
  renderRefUI();
}

function renderRefUI() {
  const match = state.mode === 'match';
  const ref = state.ref;
  el.refEmpty.hidden = !match || !!ref;
  el.refDemo.hidden = !state.demo;
  el.refPanel.hidden = !match || !ref;
  el.onion.hidden = !(match && ref && ref.onion);
  if (ref) {
    if (el.refThumb.getAttribute('src') !== ref.url) el.refThumb.src = ref.url;
    if (el.onion.getAttribute('src') !== ref.url) el.onion.src = ref.url;
    el.onionBtn.setAttribute('aria-pressed', String(ref.onion));
  }
  el.onion.classList.toggle('mirror', isMirror());
}

async function setReferenceFromFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch {
    URL.revokeObjectURL(url);
    toast('这张图打不开，换一张试试');
    return;
  }
  setReference({ url, img, owned: true });
}

function setReference(r) {
  clearReference();
  state.ref = { ...r, onion: true, busy: true, data: null };
  state.stab = freshStab();
  renderRefUI();
  prepareRefData();
}

function clearReference() {
  if (state.ref && state.ref.owned) URL.revokeObjectURL(state.ref.url);
  state.ref = null;
  state.align = null;
  state.stab = freshStab();
  renderRefUI();
}

async function prepareRefData() {
  const ref = state.ref;
  if (!ref) return;
  const aspect = state.aspect;
  ref.busy = true;
  ref.data = null;
  state.align = null;
  const iw = ref.img.naturalWidth || ref.img.width;
  const ih = ref.img.naturalHeight || ref.img.height;
  const crop = coverCrop(iw, ih, aspect);
  const W = aspect < 1 ? 540 : 720;
  const H = Math.round(W / aspect);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.getContext('2d').drawImage(ref.img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, W, H);
  const s = document.createElement('canvas');
  s.width = small.width;
  s.height = small.height;
  const sc = s.getContext('2d', { willReadFrequently: true });
  sc.drawImage(c, 0, 0, s.width, s.height);
  const gray = grayOf(sc.getImageData(0, 0, s.width, s.height));

  let lm = ref.preset ? ref.preset(aspect) : null;
  if (!lm) {
    try { lm = await pose.detectImage(c); } catch (e) {
      console.warn(e);
      toast('AI 模型没加载上，先按构图对齐');
    }
  }
  if (state.ref !== ref || state.aspect !== aspect) return;
  const prep = lm ? prepareReference(lm, aspect) : null;
  ref.data = { lm: prep ? lm : null, prep, gray, w: s.width, h: s.height };
  ref.busy = false;
  state.stab = freshStab();
  renderRefUI();
  toast(prep ? '认出参考图里的人了，对齐虚线就行' : '参考图里没认出人，按半透明叠图对齐构图', 3000);
}

function useDemoReference() {
  const c = document.createElement('canvas');
  c.width = el.demo.width;
  c.height = el.demo.height;
  const lm = demoPose(DEMO_FINAL, state.aspect);
  paintDemo(c.getContext('2d'), c.width, c.height, { lm, s: DEMO_FINAL.s, horizonY: 0.56 });
  const url = c.toDataURL('image/jpeg', 0.85);
  const img = new Image();
  img.src = url;
  img.decode().then(() => setReference({ url, img, owned: false, preset: (a) => demoPose(DEMO_FINAL, a) }));
}

/* ---------- feedback: haptics, voice, toast ---------- */

function haptic() {
  try {
    if (navigator.vibrate) {
      if (!navigator.userActivation || navigator.userActivation.hasBeenActive) navigator.vibrate(25);
      return;
    }
    el.hapticLabel.click(); // iOS 18+: toggling a switch control gives a light tap
  } catch { /* no haptics here */ }
}

function speak(text) {
  if (!state.voice || !('speechSynthesis' in window) || !text) return;
  const now = performance.now();
  if (now - state.spokeAt < 1500) return;
  state.spokeAt = now;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/TA/g, '对方'));
    u.lang = 'zh-CN';
    u.rate = 1.1;
    speechSynthesis.speak(u);
  } catch { /* speech unavailable */ }
}

function renderVoice() {
  el.voiceBtn.setAttribute('aria-pressed', String(state.voice));
  el.voiceBtn.setAttribute('aria-label', state.voice ? '语音提示：开' : '语音提示：关');
}

function setVoice(on) {
  state.voice = on;
  prefs.set('voice', on);
  renderVoice();
  if (on) { state.spokeAt = 0; speak('语音提示打开了'); } else { try { speechSynthesis.cancel(); } catch { /* ignore */ } }
  toast(on ? '语音提示：开' : '语音提示：关', 1400);
}

let toastTimer = 0;
function toast(msg, ms = 2600) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  el.toast.classList.remove('show');
  void el.toast.offsetWidth;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
}

async function keepAwake() {
  try { if (navigator.wakeLock && !document.hidden) await navigator.wakeLock.request('screen'); } catch { /* optional */ }
}

/* ---------- wiring ---------- */

function bindUI() {
  el.shutter.addEventListener('click', capture);
  el.flipBtn.addEventListener('click', () => {
    if (state.demo) { toast('演示模式只有一个画面'); return; }
    state.facing = state.facing === 'user' ? 'environment' : 'user';
    state.lm = null;
    state.rawLm = null;
    state.stab = freshStab();
    startCamera();
    renderRefUI();
  });
  el.modeBtns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  el.voiceBtn.addEventListener('click', () => setVoice(!state.voice));
  el.helpBtn.addEventListener('click', () => { el.help.hidden = false; });
  el.helpClose.addEventListener('click', () => { el.help.hidden = true; });
  el.help.addEventListener('click', (e) => { if (e.target === el.help) el.help.hidden = true; });
  el.thumbBtn.addEventListener('click', openSheet);
  el.sheetClose.addEventListener('click', closeSheet);
  el.sheet.addEventListener('click', (e) => { if (e.target === el.sheet) closeSheet(); });
  el.grid.addEventListener('click', (e) => {
    const b = e.target.closest('.ph');
    if (!b) return;
    const id = b.dataset.id;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    b.setAttribute('aria-pressed', String(selected.has(id)));
    delArmed = false;
    updateSheetButtons();
  });
  el.saveBtn.addEventListener('click', saveSelected);
  el.delBtn.addEventListener('click', deleteSelected);
  const onRefFile = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    setReferenceFromFile(f);
  };
  el.refFile.addEventListener('change', onRefFile);
  el.refFile2.addEventListener('change', onRefFile);
  el.refDemo.addEventListener('click', useDemoReference);
  el.refClear.addEventListener('click', clearReference);
  el.onionBtn.addEventListener('click', () => {
    if (!state.ref) return;
    state.ref.onion = !state.ref.onion;
    renderRefUI();
  });
  // Press and hold the reference thumbnail to see it at full strength.
  el.refThumbBtn.addEventListener('pointerdown', () => { el.onion.hidden = false; el.onion.classList.add('peek'); });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) {
    el.refThumbBtn.addEventListener(t, () => { el.onion.classList.remove('peek'); renderRefUI(); });
  }
  el.motionChip.addEventListener('click', requestMotion);
  el.vf.addEventListener('click', () => { if (!el.motionChip.hidden) requestMotion(); });
  el.sceneBadge.addEventListener('click', () => {
    if (state.poseState === 'failed') { state.poseState = 'idle'; loadModel(); }
  });
  el.camRetry.addEventListener('click', startCamera);
  el.camDemo.addEventListener('click', startDemo);
  addEventListener('keydown', (e) => {
    if (e.code === 'Space' && el.sheet.hidden && el.help.hidden && e.target === document.body) {
      e.preventDefault();
      capture();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    keepAwake();
    if (!state.demo) {
      const live = state.stream && state.stream.getVideoTracks().some((t) => t.readyState === 'live');
      if (!live) startCamera();
    }
  });
  addEventListener('resize', layout);
}

function boot() {
  layout();
  bindUI();
  renderVoice();
  store.allPhotos().then((list) => {
    if (!list.length) return;
    const known = new Set(state.photos.map((p) => p.id));
    state.photos = list.filter((p) => !known.has(p.id)).concat(state.photos);
    updateThumb(false);
  }).catch(() => {});
  if (params.get('mode') === 'match') setMode('match');
  if (state.demo) {
    startDemo();
    if (state.mode === 'match') useDemoReference(); // ?demo&mode=match previews 照着拍 end to end
  } else {
    initMotion();
    startCamera();
    loadModel();
  }
  keepAwake();
  if ('serviceWorker' in navigator && window.isSecureContext && !params.has('nosw')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  requestAnimationFrame(loop);
}

boot();
