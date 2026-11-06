// Offline support. App files: network first, cache as fallback (so updates show up).
// AI library and model: cache first; their URLs are versioned, so they never change.

const APP_CACHE = 'paihao-app-v2';
const CDN_CACHE = 'paihao-cdn-v1';
const MODEL_CACHE = 'paihao-models-v1'; // large, versioned by file name: fetched once
const KEEP = [APP_CACHE, CDN_CACHE, MODEL_CACHE];
const APP_FILES = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/geom.js',
  'js/guide.js',
  'js/match.js',
  'js/draw.js',
  'js/demo.js',
  'js/pose.js',
  'js/store.js',
  'js/light.js',
  'js/frame.js',
  'js/develop.js',
  'js/ai-worker.js',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'storage.googleapis.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  const isModel = url.origin === self.location.origin && url.pathname.includes('/models/');
  if (CDN_HOSTS.includes(url.hostname) || isModel) {
    e.respondWith(caches.open(isModel ? MODEL_CACHE : CDN_CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(APP_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true })),
    );
  }
});
