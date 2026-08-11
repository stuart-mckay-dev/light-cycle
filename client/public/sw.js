/**
 * Light Cycle service worker.
 *
 * Deliberately minimal. Its only job at Goalpost 1 is to make the app
 * installable and to survive a flaky mobile connection mid-ride — it is NOT an
 * offline-first cache. Map tiles and the Geolocation API both need the network,
 * so a cached shell with no signal is a dead game anyway.
 *
 * Strategy:
 *   - App shell (navigation requests): network-first, falling back to cache.
 *     A rider who loses signal at a light still gets the app back on refresh.
 *   - Static build assets (hashed JS/CSS): cache-first — the hash makes them
 *     immutable, so a hit is always correct.
 *   - Everything else (Mapbox tiles, APIs): straight to the network, untouched.
 *     Tiles are large and Mapbox does its own caching; duplicating that here
 *     would blow the storage quota during a long ride.
 */

const VERSION = 'v1';
const SHELL_CACHE = `light-cycle-shell-${VERSION}`;
const ASSET_CACHE = `light-cycle-assets-${VERSION}`;

const SHELL_URLS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      // A failed precache must not block activation — the app still works online.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never intercept cross-origin traffic — Mapbox tiles, styles, APIs.
  if (url.origin !== self.location.origin) return;

  // App shell: network-first so a deploy is picked up on the next load.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Hashed build output: cache-first.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
