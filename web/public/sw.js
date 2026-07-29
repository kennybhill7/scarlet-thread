/**
 * App-shell service worker.
 *
 * Scripture text is already offline-safe on its own -- lib/bible/loader.ts
 * opens the Cache API directly and caches every /bible/{version}/{book}.json
 * response the moment it's fetched, independent of this file. That's the
 * part that actually matters for "read Genesis 3 with no signal."
 *
 * This worker's job is narrower: make the *app itself* -- the JS/CSS bundle,
 * the fonts, the shell -- reload without a network on a device that has
 * opened it before. There's no Next.js build manifest available to precache
 * hashed asset names ahead of time (Turbopack generates them at build time),
 * so this uses a runtime "network-first, fill the cache as you go" strategy
 * rather than a precache list. First visit needs network; every visit after
 * that degrades gracefully.
 *
 * Deliberately NOT caching:
 *   - /api/*     -- always live data (auth, entries, sync). Never serve stale.
 *   - /bible/*   -- loader.ts already owns this cache; double-handling it
 *                   here would just be a second, redundant copy.
 */

const CACHE_NAME = "bible-brain-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME && key.startsWith("bible-brain-shell")).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function shouldHandle(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname.startsWith("/bible/")) return false;
  return true;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!shouldHandle(url)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? Response.error())),
  );
});
