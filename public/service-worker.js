const CACHE_NAME = 'electoral-sja-v12';
const APP_SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/db-local.js',
  '/js/api.js',
  '/js/sync.js',
  '/js/notificaciones.js',
  '/js/views/login.js',
  '/js/views/comando.js',
  '/js/views/mesa.js',
  '/js/views/concejal.js',
  '/js/views/admin.js',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Estrategia: el "shell" de la app (HTML/CSS/JS) se sirve cache-first para que
// abra instantaneo y funcione offline. Las llamadas a /api/* NUNCA se cachean
// aca -- esas las maneja la logica de cola/sync en db-local.js + sync.js.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/')) {
    return; // dejar pasar tal cual, sin intervencion del service worker
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request)
          .then((response) => {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            return response;
          })
          .catch(() => caches.match('/index.html'))
      );
    })
  );
});
