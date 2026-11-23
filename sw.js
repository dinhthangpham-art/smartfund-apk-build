// SmartFund service worker — cache-first cho toàn bộ app shell, để dùng được khi không có mạng.
// Khi sửa app.js/style.css/index.html, nhớ tăng số CACHE_VERSION để trình duyệt tải bản mới.
const CACHE_VERSION = 'smartfund-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Google Fonts: thử mạng trước, lỗi thì bỏ qua (app vẫn chạy được với font hệ thống)
  if (req.url.indexOf('fonts.googleapis.com') !== -1 || req.url.indexOf('fonts.gstatic.com') !== -1) {
    event.respondWith(
      fetch(req).catch(() => new Response('', { status: 200 }))
    );
    return;
  }

  // App shell: cache-first, có mạng thì âm thầm cập nhật cache cho lần sau
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
