/**
 * Bible text loading. Every /public/bible/{version}/{book}.json file is
 * immutable once built — re-running tools/build_bible.py replaces content but
 * the app has no notion of "updated" scripture, so caching is cache-forever,
 * not cache-and-revalidate.
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

const CACHE_NAME = "bible-brain-scripture-v1";

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

/** The version/book manifest. Fetched once per session, memoised after. */
export function loadIndex(): Promise<BibleIndex> {
  const key = "index";
  const cached = indexMemo.get(key);
  if (cached) return cached;

  const promise = loadJson<BibleIndex>("/bible/index.json");
  indexMemo.set(key, promise);
  promise.catch(() => indexMemo.delete(key)); // don't memoise a failure
  return promise;
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
  for (let i = 0; i < books.length; i += 1) {
    await loadBook(version, books[i]);
    onProgress?.(i + 1, books.length);
  }
}

/** Approximate cached footprint, for a Settings screen. */
export async function cacheSizeEstimate(): Promise<number | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  return estimate.usage ?? null;
}
