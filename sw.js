// Offline cache for the VR scenes.
//
// Cache-first on purpose: once the house is on the phone it should load with no
// network at all — on a plane, in a basement, on someone else's wifi. The cost is
// that updates only land when CACHE bumps, so bump the version on every deploy.
const CACHE = 'vr-house-v5';

const PRECACHE = [
  './',
  './index.html',
  './house.html',
  './study.html',
  './vantage.html',
  './scene-house.js',
  './living-room.html',
  './lib/three.module.min.js',
  './lib/three.core.min.js',   // three.module.min.js imports this at runtime
  './manifest.webmanifest',
  './study.webmanifest',
  './vantage.webmanifest',
  './office.html',
  './office.webmanifest',
  './rooms/office/room.json',
  './rooms/office/wall_n.jpg',
  './rooms/office/wall_s.jpg',
  './rooms/office/wall_w.jpg',
  './rooms/office/wall_e.jpg',
  './rooms/office/floor.jpg',
  './rooms/office/ceiling.jpg',
  './samila.html',
  './samila.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;

  // Leave anything we don't own alone — only same-origin reads are ours to cache.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then(hit => {
      if (hit) return hit;

      return fetch(request)
        .then(response => {
          // Stash anything that came back cleanly, so pages added later work offline too.
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          // Offline and uncached. For a page load, the house is a better answer
          // than the browser's dinosaur; for an asset, let the failure surface.
          if (request.mode === 'navigate') return caches.match('./house.html');
          throw new Error('offline and not cached: ' + request.url);
        });
    })
  );
});
