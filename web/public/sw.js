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
 *
 * CODEX_AUDIT.md A-013: a /read/{book}/{chapter} route is a Next.js dynamic
 * server route, so an exact-URL cache miss used to mean "hard fail" even when
 * the chapter's book JSON was sitting right there in loader.ts's own cache --
 * open one chapter online, go offline, tap into a *different* chapter of the
 * same book, and the browser showed its own network-error page. The fetch
 * handler below adds one narrow, offline-only fallback for that shape of
 * request: it reads (never writes) the scripture cache lib/bible/loader.ts
 * owns and renders a small standalone HTML page with the verses already
 * embedded, or an honest "not downloaded" notice if that book was never
 * cached either. Every other route, and every online request, is byte-for-
 * byte unchanged -- see the narrow trigger condition in the fetch handler.
 */

const CACHE_NAME = "bible-brain-shell-v1";

/**
 * The cache name lib/bible/loader.ts owns and writes. Duplicated here as a
 * literal, not imported -- this file is a plain script served from public/,
 * not part of the Next.js/TypeScript build graph, so it cannot import from
 * lib/bible/loader.ts. This worker only ever reads that cache; it never
 * calls .put() on it, so it cannot race or fight the loader's own writes.
 */
const SCRIPTURE_CACHE_NAME = "bible-brain-scripture-v1";

/**
 * Mirrors VersionId in lib/contracts.ts, BSB first because it's the app's
 * default (lib/bible/lastRead.ts). A Service Worker has no access to
 * localStorage, so it can't know which version the reader last had open --
 * it just checks every known version's cached copy of the requested book and
 * uses whichever one it finds.
 */
const SCRIPTURE_VERSIONS = ["BSB", "KJV", "ASV", "YLT", "SBL"];

const READ_CHAPTER_PATH = /^\/read\/(\d+)\/(\d+)\/?$/;

/** Parses a /read/{book}/{chapter} pathname, or null for anything else. */
function parseReadChapterPath(pathname) {
  const match = READ_CHAPTER_PATH.exec(pathname);
  if (!match) return null;
  const book = Number.parseInt(match[1], 10);
  const chapter = Number.parseInt(match[2], 10);
  if (!Number.isInteger(book) || book < 1 || book > 66) return null;
  if (!Number.isInteger(chapter) || chapter < 1) return null;
  return { book, chapter };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/** Shared chrome so the two fallback pages look like one honest feature, not two. */
function offlinePageShell({ title, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 1.5rem; background: #0f1923; color: #e7edf3; font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .offline-banner { background: #17222d; border: 1px solid #2e75b6; color: #9fc4e6; border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1.25rem; font-size: 0.95rem; }
  h1 { font-size: 1.4rem; margin: 0 0 1rem; }
  p.verse { margin: 0 0 0.6rem; }
  sup { color: #2e75b6; margin-right: 0.35rem; }
  nav { margin-top: 1.5rem; display: flex; gap: 1rem; }
  nav a { color: #2e75b6; text-decoration: none; }
  nav a:hover { text-decoration: underline; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function chapterNav(book, chapter) {
  const previous = chapter > 1 ? `<a href="/read/${book}/${chapter - 1}">‹ Previous chapter</a>` : "";
  const next = `<a href="/read/${book}/${chapter + 1}">Next chapter ›</a>`;
  return `<nav>${previous}${next}</nav>`;
}

/** Book data cached (CODEX_AUDIT.md A-013's core case): render the actual verses. */
function offlineChapterDocument(book, chapter, bookData) {
  const verses = Array.isArray(bookData.c) ? bookData.c[chapter - 1] : null;
  const bookName = typeof bookData.b === "string" && bookData.b ? bookData.b : `Book ${book}`;

  if (!Array.isArray(verses)) {
    return offlinePageShell({
      title: `${bookName} ${chapter} — offline`,
      bodyHtml: `
<div class="offline-banner">You're offline. ${escapeHtml(bookName)} is downloaded, but it has no cached chapter ${chapter}.</div>
<h1>${escapeHtml(bookName)} ${chapter}</h1>
${chapterNav(book, chapter)}`,
    });
  }

  const versesHtml = verses
    .map((text, i) => `<p class="verse"><sup>${i + 1}</sup>${escapeHtml(text)}</p>`)
    .join("\n");

  return offlinePageShell({
    title: `${bookName} ${chapter}`,
    bodyHtml: `
<div class="offline-banner">You're offline. Showing the copy of ${escapeHtml(bookName)} already downloaded to this device.</div>
<h1>${escapeHtml(bookName)} ${chapter}</h1>
${versesHtml}
${chapterNav(book, chapter)}`,
  });
}

/** Book data NOT cached: an explicit notice, never a blank page or a browser error. */
function offlineBookMissingDocument(book, chapter) {
  return offlinePageShell({
    title: "Offline — not downloaded",
    bodyHtml: `
<div class="offline-banner">You're offline, and Book ${book} hasn't been downloaded to this device yet.</div>
<h1>Chapter unavailable offline</h1>
<p>Connect to the internet once to load Book ${book}, chapter ${chapter} — after that it will keep working offline.</p>`,
  });
}

/**
 * The one offline rescue this worker performs: a /read/{book}/{chapter}
 * navigation whose exact HTML/RSC response was never cached (this chapter
 * was never itself visited) but whose book JSON already lives in the
 * scripture cache lib/bible/loader.ts owns. Reads that cache only -- never
 * fetches it over the network, never writes to it. Returns null for any path
 * that isn't a chapter route, so the caller falls through to the untouched
 * Response.error() behavior.
 */
async function offlineChapterFallback(pathname) {
  const parsed = parseReadChapterPath(pathname);
  if (!parsed) return null;
  const { book, chapter } = parsed;

  const scriptureCache = await caches.open(SCRIPTURE_CACHE_NAME);
  let bookData = null;
  for (const version of SCRIPTURE_VERSIONS) {
    const cached = await scriptureCache.match(`/bible/${version}/${book}.json`);
    if (!cached) continue;
    try {
      bookData = await cached.json();
      break;
    } catch {
      // Corrupt/partial cache entry for this version -- try the next one
      // rather than treating a decode failure as "book not downloaded".
    }
  }

  const html = bookData
    ? offlineChapterDocument(book, chapter, bookData)
    : offlineBookMissingDocument(book, chapter);

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

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
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          // Exact-URL cache miss on a real navigation only -- soft (RSC)
          // fetches and asset requests keep the old Response.error() exactly
          // as before; only a document-level navigation reaches the chapter
          // rescue, and only /read/{book}/{chapter} paths get anything back
          // from it (anything else resolves to null below).
          if (request.mode === "navigate") {
            return offlineChapterFallback(url.pathname).then((fallback) => fallback ?? Response.error());
          }
          return Response.error();
        }),
      ),
  );
});
