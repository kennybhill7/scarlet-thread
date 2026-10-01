/**
 * RANGEPICKER-002 / PICKERCANON-001 — lib/bible/passageCanonClient.ts: the
 * lazy, cached, error-tolerant browser loader for the `PassageCanon`.
 *
 * Rewritten for PICKERCANON-001: the store no longer fetches all 66 BSB book
 * files to learn verse counts — it fetches `public/bible/canon.json` (a
 * compact, generated, pinned file; see tests/canon-counts-drift.test.ts)
 * alongside `index.json`. Part 1 drives the framework-free store with
 * injected `loadIndex` / `loadCanonCounts` fakes (state machine, dedup, no
 * failure memo, fail-closed on inconsistent/invalid canon.json data). Part 2
 * runs the REAL `lib/bible/loader.ts` behind an injected `globalThis.fetch`
 * that serves the actual shipped files from `public/bible`, to prove the
 * fetch footprint is now 2 requests (index.json + canon.json), not 67, that
 * the resulting canon is identical to one built directly from the real BSB
 * files, the module-scope cache reuse, the graceful error copy, and — with a
 * minimal in-memory Cache Storage — that a canon warmed online is rebuilt
 * offline.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";

import type { BibleIndex, BookData, BookMeta } from "@/lib/contracts";
import { CANONICAL_VERSIFICATION_ID } from "@/lib/contracts/range-v1";
import { __resetBookCacheForTests, __resetIndexCacheForTests } from "@/lib/bible/loader";
import { buildPassageCanon } from "@/lib/bible/passageCanon";
import {
  CANON_COUNTS_PATH,
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
// book n chapter i (1-based) has (n + i) verses — matches the old fixture's shape so expectations stay legible.
const FAKE_COUNTS = {
  versificationId: CANONICAL_VERSIFICATION_ID,
  books: {
    "1": [2, 3],
    "2": [3],
    "3": [4, 5, 6],
    "4": [5],
  },
};

function fakeDeps() {
  const calls = { index: 0, counts: 0 };
  const failures = { index: false, counts: false, badShape: null as "notObject" | "badVersification" | "unexpectedBook" | "badChapterCount" | "nonPositive" | null };
  return {
    calls,
    failures,
    deps: {
      loadIndex: async () => {
        calls.index += 1;
        if (failures.index) throw new Error("offline");
        return FAKE_INDEX;
      },
      loadCanonCounts: async (): Promise<unknown> => {
        calls.counts += 1;
        if (failures.counts) throw new Error("canon.json unavailable");
        switch (failures.badShape) {
          case "notObject":
            return "not an object";
          case "badVersification":
            return { ...FAKE_COUNTS, versificationId: "something-else" };
          case "unexpectedBook":
            return { ...FAKE_COUNTS, books: { ...FAKE_COUNTS.books, "99": [1] } };
          case "badChapterCount":
            return { ...FAKE_COUNTS, books: { ...FAKE_COUNTS.books, "3": [4, 5] } }; // index says 3 chapters
          case "nonPositive":
            return { ...FAKE_COUNTS, books: { ...FAKE_COUNTS.books, "3": [4, 5, 0] } };
          default:
            return FAKE_COUNTS;
        }
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
  assert.equal(calls.counts, 0);
});

test("STORE: idle -> loading (synchronously on load()) -> ready, with a canon built from the loaded counts", async () => {
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
    "verse counts come from canon.json, in index order",
  );
  unsubscribe();
});

test("STORE: concurrent load() calls share one in-flight build; a later load() after ready is served from the module-scope cache (zero new fetches)", async () => {
  const { deps, calls } = fakeDeps();
  const store = createPassageCanonStore(deps);
  const [a, b] = await Promise.all([store.load(), store.load()]);
  assert.equal(a, b);
  assert.equal(calls.index, 1);
  assert.equal(calls.counts, 1);

  const before = { index: calls.index, counts: calls.counts };
  const again = await store.load();
  assert.equal(again, a, "same canon object");
  assert.deepEqual({ index: calls.index, counts: calls.counts }, before, "no reload once ready");
});

test("STORE: index is loaded before canon.json, never raced (a revision change seen by the index must not race a stale cached canon.json)", async () => {
  const { deps } = fakeDeps();
  const order: string[] = [];
  const store = createPassageCanonStore({
    loadIndex: async () => {
      order.push("index-start");
      const result = await deps.loadIndex();
      order.push("index-end");
      return result;
    },
    loadCanonCounts: async () => {
      order.push("counts-start");
      return deps.loadCanonCounts();
    },
  });
  await store.load();
  assert.deepEqual(order, ["index-start", "index-end", "counts-start"]);
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

test("STORE: a failed canon.json load -> error; retry then succeeds", async () => {
  const { deps, failures } = fakeDeps();
  const store = createPassageCanonStore(deps);
  failures.counts = true;
  await assert.rejects(() => store.load(), /canon\.json unavailable/);
  assert.equal(store.getSnapshot().status, "error");
  failures.counts = false;
  await store.load();
  assert.equal(store.getSnapshot().status, "ready");
});

test("STORE: fails closed when canon.json is not an object", async () => {
  const { deps, failures } = fakeDeps();
  const store = createPassageCanonStore(deps);
  failures.badShape = "notObject";
  await assert.rejects(() => store.load(), /not an object/);
  assert.equal(store.getSnapshot().status, "error");
});

test("STORE: fails closed on the wrong versificationId", async () => {
  const { deps, failures } = fakeDeps();
  const store = createPassageCanonStore(deps);
  failures.badShape = "badVersification";
  await assert.rejects(() => store.load(), /versificationId/);
  assert.equal(store.getSnapshot().status, "error");
});

test("STORE: fails closed on a book canon.json does not expect", async () => {
  const { deps, failures } = fakeDeps();
  const store = createPassageCanonStore(deps);
  failures.badShape = "unexpectedBook";
  await assert.rejects(() => store.load(), /unexpected book 99/);
  assert.equal(store.getSnapshot().status, "error");
});

test("STORE: fails closed when a book's chapter count disagrees with the index (a picker must never offer chapters the corpus cannot show)", async () => {
  const { deps, failures } = fakeDeps();
  const store = createPassageCanonStore(deps);
  failures.badShape = "badChapterCount";
  await assert.rejects(() => store.load(), /index says 3 chapters, counts have 2/);
  assert.equal(store.getSnapshot().status, "error");
});

test("STORE: fails closed on a non-positive-integer verse count", async () => {
  const { deps, failures } = fakeDeps();
  const store = createPassageCanonStore(deps);
  failures.badShape = "nonPositive";
  await assert.rejects(() => store.load(), /invalid verse count/);
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

test("REAL LOADER: first need fetches index.json + canon.json ONCE EACH (not all 66 books) and builds the real canon; a second consumer reuses the module-scope canon with zero fetches", async () => {
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
  assert.deepEqual(canon, expected, "identical to a canon built directly from the shipped BSB files");
  assert.equal(canon[0].verseCounts.length, 50, "Genesis has 50 chapters");
  assert.equal(canon[0].verseCounts[2], 24, "Genesis 3 has 24 verses");

  assert.deepEqual(paths, ["/bible/index.json", CANON_COUNTS_PATH], "exactly 2 fetches: index.json then canon.json, never a book file");

  assert.equal(getDefaultPassageCanonStore(), store, "one app-wide store");
  const before = paths.length;
  assert.equal(await getDefaultPassageCanonStore().load(), canon);
  assert.equal(paths.length, before, "cache reuse: no further fetch");
});

test("REAL LOADER: a fresh store over an already-warm loader memo re-fetches canon.json but NOT the index (loader.ts's own index memo is reused)", async () => {
  resetAll();
  const paths = installFetch(serve);
  await getDefaultPassageCanonStore().load();
  assert.equal(paths.filter((p) => p === "/bible/index.json").length, 1);
  __resetDefaultPassageCanonStoreForTests(); // drop only OUR module-scope canon, not loader.ts's memo
  await getDefaultPassageCanonStore().load();
  // loader.ts's loadIndex() memo means the index is fetched only once across both loads; fetchWithCache
  // (no in-process memo, only Cache API, which this test does not install) refetches canon.json each time
  // our module-scope canon is dropped.
  assert.equal(paths.filter((p) => p === "/bible/index.json").length, 1, "index fetched once total");
  assert.equal(paths.filter((p) => p === CANON_COUNTS_PATH).length, 2, "canon.json fetched once per store build");
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
  assert.equal(
    state.status === "error" ? state.message : "",
    "Couldn’t load the Bible index — check your connection",
  );

  online = true;
  await store.load();
  assert.equal(store.getSnapshot().status, "ready");
});

test("REAL LOADER: an HTTP 404 on canon.json is an error, not a silently empty canon", async () => {
  resetAll();
  installFetch((path) => (path === CANON_COUNTS_PATH ? new Response("nope", { status: 404 }) : serve(path)));
  const store = getDefaultPassageCanonStore();
  await assert.rejects(() => store.load());
  assert.equal(store.getSnapshot().status, "error");
});

test("REAL LOADER + Cache Storage: a canon warmed online is rebuilt fully OFFLINE from the existing bible-brain-scripture-v1 cache", async () => {
  resetAll();
  installFakeCaches();
  const onlinePaths = installFetch(serve);
  await getDefaultPassageCanonStore().load();
  assert.deepEqual(onlinePaths, ["/bible/index.json", CANON_COUNTS_PATH]);
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
  // canon.json is served from Cache API too (fetchWithCache), so no further network attempt is made for it.
  assert.deepEqual(offlinePaths, ["/bible/index.json"], "canon.json came from Cache Storage; only the index probed the (dead) network");
});
