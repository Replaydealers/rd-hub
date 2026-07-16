// Service Worker - kein Caching, immer frisch vom Server
// Version: rd-hub-v79 (RD Hub v2.9.2)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  );
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request));
});
