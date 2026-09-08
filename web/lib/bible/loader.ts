/**
 * Bible text loading. Every /public/bible/{version}/{book}.json file is
 * immutable FOR A GIVEN CORPUS REVISION — re-running tools/build_bible.py (or
 * build_spanish.py) replaces content at the same URLs and now also bumps
 * index.json's "revision" field, a deterministic hash of the built content
 * (CODEX_AUDIT.md A-020). Per-book/versemap fetches stay cache-forever, not
 * cache-and-revalidate, because within one revision they truly never change;
 * index.json itself is the one file allowed to change, so it alone is
 * fetched network-first, and a revision change wipes the shared cache (see
 * loadIndex() / reconcileCacheRevision() below) so a rebuild is naturally
 * visible instead of being masked by a cache that never re-checks.
 *
 * Two layers, both optional and additive:
 *   1. In-memory Map   — instant on repeat reads within a session.
 *   2. Cache API        — survives reload and works with no network at all.
 *      Populated opportunistically on read, and can be pre-warmed by the
 *      service worker for "make everything available offline".
 *
 * If neither cache has it, fetch() hits the CDN. If that fails too (offline,
 * never visited this chapter before), callers get a typed error, never a
 * silent blank page.
 *
 * Track A owns this file.
 */

import type { BibleIndex, BookData, VersionId } from "@/lib/contracts";

/**
 * NOTE ON NOT NAMING THIS CACHE PER-REVISION: the obvious-looking design is
 * "bible-brain-scripture-v1-<revision>", deleting old-named caches the way
 * public/sw.js's activate handler already deletes stale
 * "bible-brain-shell-*" caches. That was rejected here on purpose: this exact
 * literal is duplicated (unavoidably — sw.js is a plain script, not part of
 * the TS build graph, see its own SCRIPTURE_CACHE_NAME comment) in
 * public/sw.js's offline chapter-rescue read path (CODEX_AUDIT A-013) and
 * asserted verbatim by tests/versemap-offline.test.ts and
 * tests/offline-nav.test.ts, both outside this task's owned paths. Renaming
 * the Cache Storage bucket per revision would either break A-013's real
 * offline read (sw.js's hardcoded name no longer matching what this file
 * writes) or require touching those tests. So invalidation here works INSIDE
 * one stably-named cache instead: a revision marker entry records which
 * corpus revision the cache currently holds, and reconcileCacheRevision()
 * deletes-and-recreates the whole bucket (still under this same name) the
 * moment that marker stops matching the index.json just fetched — the same
 * "stale cache -> gone" outcome as sw.js's prefix-delete pattern, just keyed
 * by content inside one bucket rather than by a family of bucket names.
 */
const CACHE_NAME = "bible-brain-scripture-v1";

const INDEX_PATH = "/bible/index.json";

/** Records which corpus revision CACHE_NAME's contents currently belong to. */
const REVISION_MARKER_PATH = "/__bible-brain-cache-revision__";

const indexMemo = new Map<string, Promise<BibleIndex>>();
const bookMemo = new Map<string, Promise<BookData>>();

export class ScriptureUnavailableError extends Error {
  constructor(
    public readonly path: string,
    cause: unknown,
  ) {
    super(`Could not load ${path} — offline and not yet cached.`);
    this.name = "ScriptureUnavailableError";
    this.cause = cause;
  }
}

function hasCacheApi(): boolean {
  return typeof caches !== "undefined";
}

/**
 * Exported so other Track A modules that fetch immutable files from
 * /public/bible/* — today just lib/bible/versemap.ts, for versemap.json —
 * share this exact cache-then-network-then-cache-put path and the same
 * bible-brain-scripture-v1 cache, instead of a bare fetch() that leaves the
 * file unavailable offline (VMCACHE-001).
 */
export async function fetchWithCache(path: string): Promise<Response> {
  if (hasCacheApi()) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(path);
    if (cached) return cached;

    let response: Response;
    try {
      response = await fetch(path);
    } catch (error) {
      throw new ScriptureUnavailableError(path, error);
    }

    // Caching is best-effort from here. A successful network read must not
    // fail just because storage is full or unavailable (private browsing,
    // quota exceeded) -- that would make "read online" fail the same way as
    // "read offline with nothing cached", which is a worse failure than no
    // caching at all (CODEX_AUDIT.md A-002).
    if (response.ok) {
      cache.put(path, response.clone()).catch(() => {
        // Swallowed deliberately -- this chapter is still readable this
        // session, it just won't be available offline until a retry succeeds.
      });
    }
    return response;
  }

  try {
    return await fetch(path);
  } catch (error) {
    throw new ScriptureUnavailableError(path, error);
  }
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetchWithCache(path);
  if (!response.ok) {
    throw new ScriptureUnavailableError(path, new Error(`HTTP ${response.status}`));
  }
  return (await response.json()) as T;
}

/**
 * A missing/malformed revision (an index.json built before A-020, or a
 * corrupt marker read) is treated as its own stable value rather than as a
 * wildcard — two loads that both fail to find a real revision still agree
 * with each other and don't force a wipe on every single load.
 */
function normaliseRevision(index: BibleIndex): string {
  return typeof index.revision === "string" && index.revision.length > 0
    ? index.revision
    : "unversioned";
}

/**
 * Deletes and recreates CACHE_NAME when the revision just read from a fresh
 * index.json does not match the revision recorded (in REVISION_MARKER_PATH,
 * inside that same cache) the last time this cache was populated —
 * CODEX_AUDIT A-020: without this, a corpus rebuild's new chapter JSON would
 * sit at the same URLs forever behind an already-cache-first-forever cache
 * that never learns anything changed. Best-effort like every other cache
 * write in this file (see fetchWithCache's own comment on A-002): a failure
 * here must leave the cache exactly as stale as before, never corrupt it
 * further, so every step is wrapped and nothing here ever throws.
 */
async function reconcileCacheRevision(index: BibleIndex): Promise<void> {
  const revision = normaliseRevision(index);
  try {
    const cache = await caches.open(CACHE_NAME);
    const marker = await cache.match(REVISION_MARKER_PATH);
    const recorded = marker ? await marker.text() : null;
    if (recorded === revision) return;

    await caches.delete(CACHE_NAME);
    const fresh = await caches.open(CACHE_NAME);
    await fresh.put(REVISION_MARKER_PATH, new Response(revision));
  } catch {
    // Storage unavailable/quota-exceeded — see fetchWithCache's A-002 note.
  }
}

/**
 * index.json is the one file in this system that legitimately changes: a
 * corpus rebuild ships a new "revision". Every other fetch in this file goes
 * through fetchWithCache's cache-first-forever strategy, which is exactly
 * wrong for this one file — once cached, it would never be re-read from the
 * network, so a device could never learn a rebuild happened at all. So
 * index.json alone is network-first with a cache fallback for when there is
 * genuinely no network: try live network first (to see a new revision as
 * soon as one ships), reconcile CACHE_NAME against whatever revision comes
 * back, THEN cache the response as this session's offline fallback, and only
 * fall back to whatever is already cached when the network attempt itself
 * fails.
 *
 * Deliberately does NOT go through the shared fetchWithCache() — that
 * function's cache-first behavior, its exact request-path footprint, and its
 * single bible-brain-scripture-v1 cache are asserted directly by
 * tests/versemap-offline.test.ts for loadBook()/versemap.ts's fetches, and
 * this function must not add an extra network call to those paths.
 */
async function loadIndexUncached(): Promise<BibleIndex> {
  if (!hasCacheApi()) {
    try {
      const response = await fetch(INDEX_PATH);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as BibleIndex;
    } catch (error) {
      throw new ScriptureUnavailableError(INDEX_PATH, error);
    }
  }

  let networkResponse: Response | null = null;
  try {
    const response = await fetch(INDEX_PATH);
    if (response.ok) networkResponse = response;
  } catch {
    // Offline or unreachable — fall through to whatever is cached below.
  }

  if (networkResponse) {
    const index = (await networkResponse.clone().json()) as BibleIndex;
    await reconcileCacheRevision(index);
    const cache = await caches.open(CACHE_NAME);
    cache.put(INDEX_PATH, networkResponse).catch(() => {
      // Best-effort, same discipline as fetchWithCache: this session still
      // has `index` in memory: only the offline-fallback copy is missing.
    });
    return index;
  }

  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(INDEX_PATH);
  if (cached) return (await cached.json()) as BibleIndex;
  throw new ScriptureUnavailableError(
    INDEX_PATH,
    new Error("index.json not cached and network unavailable"),
  );
}

/** The version/book manifest. Fetched once per session, memoised after. */
export function loadIndex(): Promise<BibleIndex> {
  const key = "index";
  const cached = indexMemo.get(key);
  if (cached) return cached;

  const promise = loadIndexUncached();
  indexMemo.set(key, promise);
  promise.catch(() => indexMemo.delete(key)); // don't memoise a failure
  return promise;
}

/**
 * @internal test-only: forces the next loadIndex() call to re-run
 * loadIndexUncached() (network-first, revision reconciliation included)
 * instead of reusing this module's session-lifetime memo. Mirrors
 * lib/bible/versemap.ts's own __resetVerseMapCacheForTests() -- without it,
 * exercising "a second, later load sees a new revision" from a test would
 * need a genuinely separate module instance per simulated session, which
 * loadIndex()'s real design intentionally does not need in production (one
 * page load = one revision check).
 */
export function __resetIndexCacheForTests(): void {
  indexMemo.clear();
}

/**
 * @internal test-only: clears loadBook()'s in-memory memo. In a real browser
 * this Map never needs clearing mid-session — it only ever holds entries for
 * the page's current lifetime, and a revision change is only ever noticed on
 * a FRESH page load (a new JS heap, this Map already empty). A test that
 * simulates "a fresh session" with __resetIndexCacheForTests() alone but
 * calls loadBook()/warmVersion() more than once in the same Node process
 * needs this too, or a book fetched under a stale revision keeps being
 * served from this in-memory memo even after reconcileCacheRevision() has
 * correctly wiped the underlying Cache Storage entry.
 */
export function __resetBookCacheForTests(): void {
  bookMemo.clear();
}

/** One book, one translation. bookNumber is 1-66, canonical order. */
export function loadBook(version: VersionId, bookNumber: number): Promise<BookData> {
  const key = `${version}/${bookNumber}`;
  const cached = bookMemo.get(key);
  if (cached) return cached;

  const promise = loadJson<BookData>(`/bible/${version}/${bookNumber}.json`);
  bookMemo.set(key, promise);
  promise.catch(() => bookMemo.delete(key));
  return promise;
}

/** One chapter's verses, 0-indexed array (verse N is chapter[N-1]). */
export async function loadChapter(
  version: VersionId,
  bookNumber: number,
  chapter: number,
): Promise<string[]> {
  const book = await loadBook(version, bookNumber);
  const verses = book.c[chapter - 1];
  if (!verses) {
    throw new RangeError(`${book.b} has no chapter ${chapter} in ${version}`);
  }
  return verses;
}

/**
 * True once a book has been fetched at least once (this session or cached
 * from a prior one). The reader uses this to show "download for offline"
 * only where it's meaningful, not to gate reading.
 */
export async function isBookCached(version: VersionId, bookNumber: number): Promise<boolean> {
  if (!hasCacheApi()) return bookMemo.has(`${version}/${bookNumber}`);
  const cache = await caches.open(CACHE_NAME);
  const match = await cache.match(`/bible/${version}/${bookNumber}.json`);
  return match !== undefined;
}

function completionMarkerPath(version: VersionId): string {
  return `/__bible-brain-download-complete__/${version}`;
}

/**
 * Records that warmVersion() finished every book of `version` without a
 * failure. Written into CACHE_NAME itself (the same cache the books just
 * landed in), so a corpus revision bump — which wipes and renames nothing
 * about CACHE_NAME's identity but does clear its contents via
 * reconcileCacheRevision() — clears this marker along with the now-stale
 * books, instead of needing separate cache-busting logic of its own. Never
 * throws: a failed marker write should only ever cost "Settings shows
 * 'Download' again next launch even though the books are still cached",
 * which is the fail-closed direction (CODEX_AUDIT A-002 discipline), never
 * the reverse.
 */
async function markVersionComplete(version: VersionId): Promise<void> {
  if (!hasCacheApi()) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(completionMarkerPath(version), new Response("1"));
  } catch {
    // See doc comment above — best-effort.
  }
}

/**
 * True only once EVERY book of `version` has been downloaded in one
 * complete, uninterrupted warmVersion() run — not merely "book 1 happens to
 * be cached" (CODEX_AUDIT A-022: reading Genesis used to make Settings claim
 * the whole translation was ready for a flight). `bookNumbers` is used for
 * the in-memory (no Cache API) fallback, where there is no persisted marker
 * to read and completeness can only be judged by what this session itself
 * fetched.
 */
export async function isVersionFullyCached(
  version: VersionId,
  bookNumbers: number[],
): Promise<boolean> {
  if (!hasCacheApi()) {
    return bookNumbers.length > 0 && bookNumbers.every((n) => bookMemo.has(`${version}/${n}`));
  }
  const cache = await caches.open(CACHE_NAME);
  const marker = await cache.match(completionMarkerPath(version));
  return marker !== undefined;
}

/** Pre-fetches every book of a version. Used by "Make available offline". */
export async function warmVersion(
  version: VersionId,
  books: number[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  // versemap.json isn't per-version data, but a translation downloaded for
  // offline reading is exactly the moment the parallel Spanish pane needs to
  // keep working offline too (VMCACHE-001) -- without this, alignChapter()
  // fails closed on Romans 14/16 the first time the device goes offline,
  // even though every book file downloaded fine. Best-effort: a failure here
  // (or an already-warm cache, the common case on a second version download)
  // must never abort the book download the user actually asked for.
  await fetchWithCache("/bible/versemap.json").catch(() => {});
  // Every loadBook() call below is intentionally NOT caught here — a real
  // failure must reject this promise so the caller (OfflineDownloads.tsx)
  // can show an actionable error instead of a "downloading" status that
  // never resolves (CODEX_AUDIT A-021). Only a full, uninterrupted pass
  // reaches the marker write below.
  for (let i = 0; i < books.length; i += 1) {
    await loadBook(version, books[i]);
    onProgress?.(i + 1, books.length);
  }
  await markVersionComplete(version);
}

/** Approximate cached footprint, for a Settings screen. */
export async function cacheSizeEstimate(): Promise<number | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  return estimate.usage ?? null;
}
