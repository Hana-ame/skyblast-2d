// SkyBlast 2D Service Worker — 支持手机端 PWA 安装与离线启动
const CACHE_NAME = 'skyblast-2d-pwa-v3';
const CORE_ASSETS = [
  './',
  './index.html',
  './editor.html',
  './admin.html',
  './noita.html',
  './tuning.html',
  './replay.html',
  './css/style.css',
  './bundle.js',
  './editor-bundle.js',
  './admin-bundle.js',
  './noita-bundle.js',
  './tune-bundle.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(event.request, { ignoreSearch: true }).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html', { ignoreSearch: true });
          }
          return new Response('', { status: 504, statusText: 'Offline' });
        })
      )
  );
});
