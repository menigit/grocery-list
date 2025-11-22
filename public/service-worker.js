const CACHE_NAME = 'grocery-cache-v1';
const urlsToCache = [
  './',
  './index.html',
  './voucher.html',
  './manifest.json',
  './icons/app_logo_192.png',
  './icons/app_logo_512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
