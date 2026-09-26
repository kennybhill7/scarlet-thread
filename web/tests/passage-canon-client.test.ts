/**
 * RANGEPICKER-002 — lib/bible/passageCanonClient.ts: the lazy, cached,
 * error-tolerant browser loader for the `PassageCanon`.
 *
 * Part 1 drives the framework-free store with injected `loadIndex` / `loadBook`
 * fakes (state machine, dedup, no failure memo, concurrency bound, fail-closed
 * on inconsistent data). Part 2 runs the REAL `lib/bible/loader.ts` behind an
 * injected `globalThis.fetch` that serves the actual shipped files from
 * `public/bible`, to prove the fetch footprint (1 index + 66 books, once), the
 * module-scope cache reuse, the graceful error copy, and — with a minimal
 * in-memory Cache Storage — that a canon warmed online is rebuilt offline.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";

import type { BibleIndex, BookData, BookMeta } from "@/lib/contracts";
import { __resetBookCacheForTests, __resetIndexCacheForTests } from "@/lib/bible/loader";
import { buildPassageCanon } from "@/lib/bible/passageCanon";
import {
  PASSAGE_CANON_ERROR_MESSAGE,
  __resetDefaultPassageCanonStoreForTests,
  createPassageCanonStore,
  getDefaultPassageCanonStore,
  type PassageCanonState,
} from "@/lib/bible/passageCanonClient";

// ---------------------------------------------------------------------------
// Part 1 — injected loaders
// ---------------------------------------------------------------------------

function meta(n: number, chapters: number): BookMeta {
  return { n, name: `Book ${n}`, abbr: `B${n}`, chapters, testament: n <= 2 ? "OT" : "NT" } as BookMeta;
}
const FAKE_INDEX = { books: [meta(1, 2), meta(2, 1), meta(3, 3), meta(4, 1)] } as unknown as BibleIndex;
// chapter i has (n + i) verses
function fakeBook(n: number, chapters: number): BookData {
  return { b: `Book ${n}`, c: Array.from({ length: chapters }, (_, i) => Array.from({ length: n + i + 1 }, () => "v")) } as unknown as BookData;
}

function fakeDeps() {
  const calls = { index: 0, books: [] as number[], inFlight: 0, maxInFlight: 0 };
  const failures = { index: false, book: null as number | null, badChapterCount: false };
  return {
    calls,
    failures,
    deps: {
      concurrency: 2,
      loadIndex: async () => {
        calls.index += 1;
        if (failures.index) throw new Error("offline");
        return FAKE_INDEX;
      },
      loadBook: async (_version: string, n: number) => {
        calls.books.push(n);
        calls.inFlight += 1;
        calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        calls.inFlight -= 1;
        if (failures.book === n) throw new Error(`book ${n} unavailable`);
        const chapters = FAKE_INDEX.books[n - 1].chapters;
        return fakeBook(n, failures.badChapterCount && n === 3 ? chapters + 1 : chapters);
      },
    },
  };
}

test("STORE: nothing is fetched at creation (lazy), and the server snapshot is always idle", () => {
  const { deps, calls } = fakeDeps();
  const store = createPassageCanonStore(deps);
  assert.deepEqual(store.getSnapshot(), { status: "idle" });
  assert.deepEqual(store.getServerSnapshot(), { status: "idle" });
  assert.equal(calls.index, 0);
  assert.deepEqual(calls.books, []);
});

test("STORE: idle -> loading (synchronously on load()) -> ready, with a canon built from the loaded books", async () => {
  const { deps } = fakeDeps();
  const store = createPassageCanonStore(deps);
  const seen: string[] = [];
  const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot().status));

  const pending = store.load();
  assert.equal(store.getSnapshot().status, "loading", "loading must be visible before any await resolves");
  const canon = await pending;

  const state = store.getSnapshot();
  assert.equal(state.status, "ready");
  assert.equal(state.status === "ready" ? state.canon : null, canon);
  assert.deepEqual(seen, ["loading", "ready"]);
  assert.deepEqual(
    canon.map((b) => [b.n, b.verseCounts]),
    [
      [1, [2, 3]],
      [2, [3]],
      [3, [4, 5, 6]],
      [4, [5]],
    ],
    "verse counts come from each book's data, in index order",
  );
  unsubscribe();
});

test("STORE: concurrent load() calls share one in-flight build; a later load() after ready is served from the module-scope cache (zero new loads)", async () => {
  const { deps, calls } = fakeDeps();
  const store = createPassageCanonStore(deps);
  const [a, b] = await Promise.all([store.load(), store.load()]);
  assert.equal(a, b);
  assert.equal(calls.index, 1);
  assert.deepEqual([...calls.books].sort(), [1, 2, 3, 4], "each book exactly once");

  const before = { index: calls.index, books: calls.books.length };
  const again = await store.load();
  assert.equal(again, a, "same canon object");
  assert.deepEqual({ index: calls.index, books: calls.books.length }, before, "no reload once ready");
});

test("STORE: book loads respect the concurrency bound", async () => {
  const { deps, calls } = fakeDeps();
  await createPassageCanonStore({ ...deps, concurrency: 2 }).load();
  assert.ok(calls.maxInFlight <= 2, `max in flight ${calls.maxInFlight} exceeds 2`);
  assert.ok(calls.maxInFlight >= 2, "and the bound is actually used, not serialised");
});

test("STORE: a failed index load -> error state with the honest message; NOT memoised, so a retry loads again and succeeds", async () => {
  const { deps, calls, failures } = fakeDeps();
  const store = createPassageCanonStore(deps);
  failures.index = true;
  await assert.rejects(() => store.load(), /offline/);
  const errored = store.getSnapshot();
  assert.equal(errored.status, "error");
  assert.equal(errored.status === "error" ? errored.message : "", PASSAGE_CANON_ERROR_MESSAGE);
  assert.equal(PASSAGE_CANON_ERROR_MESSAGE, "Couldn’t load the Bible index — check your connection");

  failures.index = false;
  await store.load();
  assert.equal(store.getSnapshot().status, "ready");
  assert.equal(calls.index, 2, "the failure was not cached");
});

test("STORE: one book failing -> error (never a partial canon); retry then succeeds", async () => {
  const { deps, failures } = fakeDeps();
  const store = createPassageCanonStore(deps);
  failures.book = 3;
  await assert.rejects(() => store.load(), /book 3 unavailable/);
  assert.equal(store.getSnapshot().status, "error");
  failures.book = null;
  await store.load();
  const state = store.getSnapshot();
  assert.equal(state.status === "ready" ? state.canon.length : -1, 4);
});

test("STORE: fails closed when a book's data disagrees with the index (a picker must never offer chapters the corpus cannot show)", async () => {
  const { deps, failures } = fakeDeps();
  const store = createPassageCanonStore(deps);
  failures.badChapterCount = true;
  await assert.rejects(() => store.load(), /index says 3 chapters, data has 4/);
  assert.equal(store.getSnapshot().status, "error");
});

test("STORE: subscribers are notified error -> loading -> ready on retry, and an unsubscribed listener hears nothing", async () => {
  const { deps, failures } = fakeDeps();
  const store = createPassageCanonStore(deps);
  const seen: string[] = [];
  const gone: string[] = [];
  const un1 = store.subscribe(() => seen.push(store.getSnapshot().status));
  const un2 = store.subscribe(() => gone.push(store.getSnapshot().status));
  un2();
  failures.index = true;
  await store.load().catch(() => {});
  failures.index = false;
  await store.load();
  assert.deepEqual(seen, ["loading", "error", "loading", "ready"]);
  assert.deepEqual(gone, []);
  un1();
});

// ---------------------------------------------------------------------------
// Part 2 — the real loader behind an injected fetch (and optional Cache Storage)
// ---------------------------------------------------------------------------

const webPath = (p: string) => new URL(`../${p}`, import.meta.url);
const realIndex: BibleIndex = JSON.parse(readFileSync(webPath("public/bible/index.json"), "utf8"));

function serve(path: string): Response {
  const file = path === "/bible/index.json" ? "public/bible/index.json" : `public${path}`;
  try {
    return new Response(readFileSync(webPath(file)), { status: 200 });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

const realFetch = globalThis.fetch;
const realCaches = (globalThis as { caches?: unknown }).caches;

function installFetch(handler: (path: string) => Response | Promise<Response>) {
  const paths: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const path = typeof input === "string" ? input : String((input as { url?: string }).url ?? input);
    paths.push(path);
    return handler(path);
  }) as typeof fetch;
  return paths;
}

/** Just enough CacheStorage for lib/bible/loader.ts: open/delete, match/put by path string. */
function installFakeCaches() {
  const buckets = new Map<string, Map<string, { status: number; text: string }>>();
  const open = async (name: string) => {
    if (!buckets.has(name)) buckets.set(name, new Map());
    const bucket = buckets.get(name)!;
    return {
      match: async (path: string) => {
        const hit = bucket.get(path);
        return hit ? new Response(hit.text, { status: hit.status }) : undefined;
      },
      put: async (path: string, response: Response) => {
        bucket.set(path, { status: response.status, text: await response.text() });
      },
    };
  };
  (globalThis as { caches?: unknown }).caches = { open, delete: async (name: string) => buckets.delete(name) };
}

function resetAll() {
  __resetIndexCacheForTests();
  __resetBookCacheForTests();
  __resetDefaultPassageCanonStoreForTests();
}

afterEach(() => {
  globalThis.fetch = realFetch;
  (globalThis as { caches?: unknown }).caches = realCaches;
  resetAll();
});

test("REAL LOADER: first need fetches index.json + all 66 BSB books once each and builds the real canon; a second consumer reuses the module-scope canon with zero fetches", async () => {
  resetAll();
  const paths = installFetch(serve);
  const store = getDefaultPassageCanonStore();
  assert.equal(paths.length, 0, "lazy: nothing fetched before load()");

  const canon = await store.load();
  assert.equal(canon.length, 66);
  const expected = buildPassageCanon(
    realIndex.books,
    (n) => JSON.parse(readFileSync(webPath(`public/bible/BSB/${n}.json`), "utf8")) as BookData,
  );
  assert.deepEqual(canon, expected, "identical to a canon built directly from the shipped files");
  assert.equal(canon[0].verseCounts.length, 50, "Genesis has 50 chapters");
  assert.equal(canon[0].verseCounts[2], 24, "Genesis 3 has 24 verses");

  assert.equal(paths.filter((p) => p === "/bible/index.json").length, 1);
  const bookPaths = paths.filter((p) => /^\/bible\/BSB\/\d+\.json$/.test(p));
  assert.equal(bookPaths.length, 66);
  assert.equal(new Set(bookPaths).size, 66, "each book once");
  assert.equal(paths.length, 67);

  assert.equal(getDefaultPassageCanonStore(), store, "one app-wide store");
  const before = paths.length;
  assert.equal(await getDefaultPassageCanonStore().load(), canon);
  assert.equal(paths.length, before, "cache reuse: no further fetch");
});

test("REAL LOADER: a fresh store over an already-warm loader memo (another screen read the books) costs no new fetches", async () => {
  resetAll();
  const paths = installFetch(serve);
  await getDefaultPassageCanonStore().load();
  const warm = paths.length;
  __resetDefaultPassageCanonStoreForTests(); // drop only OUR module-scope canon, not loader.ts's memo
  await getDefaultPassageCanonStore().load();
  assert.equal(paths.length, warm, "loader.ts's own memo served every book and the index");
});

test("REAL LOADER: network down -> error state with the exact honest copy; recovering the network then a retry succeeds", async () => {
  resetAll();
  let online = false;
  installFetch((path) => {
    if (!online) throw new TypeError("Failed to fetch");
    return serve(path);
  });
  const store = getDefaultPassageCanonStore();
  await assert.rejects(() => store.load());
  const state: PassageCanonState = store.getSnapshot();
  assert.equal(state.status, "error");
  assert.equal(state.status === "error" ? state.message : "", "Couldn’t load the Bible index — check your connection");

  online = true;
  await store.load();
  assert.equal(store.getSnapshot().status, "ready");
});

test("REAL LOADER: an HTTP 404 on one book is an error, not a silently shorter canon", async () => {
  resetAll();
  installFetch((path) => (path === "/bible/BSB/40.json" ? new Response("nope", { status: 404 }) : serve(path)));
  const store = getDefaultPassageCanonStore();
  await assert.rejects(() => store.load());
  assert.equal(store.getSnapshot().status, "error");
});

test("REAL LOADER + Cache Storage: a canon warmed online is rebuilt fully OFFLINE from the existing bible-brain-scripture-v1 cache", async () => {
  resetAll();
  installFakeCaches();
  const onlinePaths = installFetch(serve);
  await getDefaultPassageCanonStore().load();
  assert.equal(onlinePaths.length, 67);
  await new Promise((resolve) => setTimeout(resolve, 50)); // loader.ts's cache.put()s are fire-and-forget

  // New "session": both loader memos and our canon are gone, and the network is dead.
  resetAll();
  const offlinePaths = installFetch(() => {
    throw new TypeError("offline");
  });
  const canon = await getDefaultPassageCanonStore().load();
  assert.equal(canon.length, 66);
  assert.equal(canon[0].verseCounts[2], 24);
  // index.json is network-first (it is the one mutable file): exactly one failed attempt, then the cached copy.
  assert.deepEqual(offlinePaths, ["/bible/index.json"], "every book came from Cache Storage; only the index probed the (dead) network");
});
