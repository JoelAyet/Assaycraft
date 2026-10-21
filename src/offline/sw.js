/*
 * Assaycraft offline cache: a service worker that keeps a copy of the app, so it opens without an
 * internet connection after the first visit. vite.config.ts fills in the version and the list of
 * files when the app is built. Notebooks are not stored here: they stay in their folder or in the
 * browser's storage.
 */
const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = `assaycraft-${VERSION}`;

self.addEventListener('install', (event) => {
  // Download this version. It is used once the open pages agree to reload (see src/lib/offline.ts).
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => /^(assaycraft|labcraft|genecraft)-/.test(key) && key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'update') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  // Opening the app (any address in it) gets the app page; its files come from the cache; anything else from the network.
  const navigate = request.mode === 'navigate';
  const key = navigate ? new URL('index.html', self.registration.scope).href : request;
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(key, { ignoreSearch: navigate }))
      .then((hit) => hit || fetch(request)),
  );
});
