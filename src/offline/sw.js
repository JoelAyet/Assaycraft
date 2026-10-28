/*
 * Assaycraft offline cache: a service worker that keeps a copy of the app, so it opens without an
 * internet connection after the first visit. vite.config.ts fills in the version and the list of
 * files when the app is built. Notebooks are not stored here: they stay in their folder or in the
 * browser's storage.
 */
const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = `assaycraft-${VERSION}`;
// The app page is kept under the app's own address: hosts such as Cloudflare answer index.html with a
// redirect to it, and browsers refuse to open a page from a redirected response.
const APP = new URL('./', self.registration.scope).href;
const keyOf = (file) => (file === 'index.html' ? APP : file);

// Browsers refuse redirected responses for page loads, so serve a plain copy instead.
const plain = (response) =>
  response && response.redirected
    ? response.blob().then((body) => new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers }))
    : response;

// Versions before this fix kept a redirected app page, which made the app fail to open (ERR_FAILED).
// Such a version cannot ask the page to update, so this one takes over without waiting.
const brokenCopy = () =>
  caches
    .keys()
    .then((keys) => Promise.all(keys.filter((key) => /^assaycraft-/.test(key) && key !== CACHE).map((key) => caches.open(key))))
    .then((old) => Promise.all(old.map((cache) => cache.match('index.html').then((hit) => !!hit && hit.redirected))))
    .then((found) => found.some(Boolean));

// A built file's name carries a hash of its contents, so one an older version kept is the same file:
// an update downloads only what changed (the PDF and HEIC readers are large and rarely change).
const keptBefore = (file) => (file.startsWith('assets/') ? caches.match(file) : Promise.resolve(undefined));

self.addEventListener('install', (event) => {
  // Download this version. It is used once the open pages agree to reload (see src/lib/offline.ts).
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all(
          FILES.map((file) =>
            keptBefore(file).then((kept) =>
              kept
                ? cache.put(file, kept)
                : fetch(new Request(keyOf(file), { cache: 'reload' })).then((response) => {
                    if (!response.ok) throw new Error(`Could not keep ${file} for offline use`);
                    return Promise.resolve(plain(response)).then((copy) => cache.put(keyOf(file), copy));
                  }),
            ),
          ),
        ),
      )
      .then(brokenCopy)
      .then((broken) => broken && self.skipWaiting()),
  );
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
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Calendar files (a private calendar link opened in the browser, another calendar fetched) are never the app.
  if (url.pathname.startsWith('/cal/') || url.pathname === '/ical') return;
  // Opening the app (any address in it) gets the app page; its files come from the cache; anything else from the network.
  const navigate = request.mode === 'navigate';
  const key = navigate ? APP : request;
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(key, { ignoreSearch: navigate }))
      .then((hit) => (hit ? plain(hit) : fetch(request))),
  );
});
