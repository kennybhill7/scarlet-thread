/**
 * VMCACHE-001 — closing two out-of-scope gaps the VERSEMAP-001 rework
 * reported honestly rather than smuggling:
 *
 *   1. /bible/versemap.json was fetched with a bare fetch() in
 *      lib/bible/versemap.ts, never touching the Cache API, so an offline
 *      app launch lost the Spanish parallel pane for all 1,189 chapters —
 *      the retry logic in versemap.ts only helps once connectivity returns.
 *      Fixed by routing that fetch through lib/bible/loader.ts's
 *      fetchWithCache(), the same cache-then-network path index.json and
 *      book files already use (cache bible-brain-scripture-v1).
 *
 *   2. ChapterReader called alignChapter().then() with no .catch(), so the
 *      fail-closed VerseMapUnavailableError became an unhandled promise
 *      rejection and the Spanish column hung on "Cargando…" forever. Fixed
 *      by extracting resolveAlignment() (components/reader/ChapterReader.tsx),
 *      which alignChapter() is awaited inside a try/catch and can never
 *      reject.
 *
 * TEST-ENVIRONMENT NOTE (see tests/verse-selection.test.ts for the fuller
 * version of this note): this repo's test script is `tsx --test
 * tests/*.test.ts` — plain Node, no jsdom, no Cache API. Node 24 has global
 * fetch/Response but NOT a global `caches` (confirmed: `typeof caches` is
 * "undefined" outside a browser/service-worker context), so exercising the
 * cache path for real needs a minimal same-shape CacheStorage/Cache stand-in
 * installed on globalThis for the duration of each test, mirroring the
 * pattern tests/offline-nav.test.ts and tests/device-clear.test.ts already
 * use in this repo. It is removed again in every test's `finally`.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import type { VersionId } from "@/lib/contracts";
import type { AlignmentResult } from "@/components/reader/ChapterReader";

const nodeRequire = createRequire(__filename);

// Same require.cache-seeding technique as tests/verse-selection.test.ts and
// tests/review-setup-state.test.ts: ChapterReader.tsx pulls in a CSS Module
// (not parseable outside a bundler) and sibling UI (Sheet/Chip/StudySession)
// this file has no reason to exercise, so those alone are stubbed -- the
// exported resolveAlignment() loaded below is the real, unmodified function.
const cssProxy = new Proxy(
  {},
  { get: (_target, key) => (typeof key === "string" ? key : undefined) },
);

function seedModule(specifier: string, exports: Record<string, unknown>) {
  const resolved = nodeRequire.resolve(specifier);
  (nodeRequire.cache as Record<string, unknown>)[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    path: path.dirname(resolved),
    paths: [],
    children: [],
    exports: { __esModule: true, ...exports },
  };
  return resolved;
}

seedModule("@/components/reader/ChapterReader.module.css", { default: cssProxy });
// COVENANTTIMELINE-001 — ChapterReader.tsx now also renders
// CovenantTimelineStrip, which pulls in its own CSS Module; stubbed for the
// same reason as ChapterReader's own (not parseable outside a bundler). The
// component itself is left real — it has no other browser-only dependency.
seedModule("@/components/reader/CovenantTimelineStrip.module.css", { default: cssProxy });
seedModule("@/components/ui/Sheet", { Sheet: () => null });
seedModule("@/components/ui/Chip", { Chip: () => null });
seedModule("@/components/notes/StudySession", {
  StudySession: ({ children }: { children: unknown }) => children,
});

const { resolveAlignment } = nodeRequire("@/components/reader/ChapterReader.tsx") as {
  resolveAlignment: (
    fromVersion: VersionId,
    toVersion: VersionId,
    chapterKeyValue: string,
    fromVerseCount: number,
  ) => Promise<AlignmentResult>;
};

const SCRIPTURE_CACHE_NAME = "bible-brain-scripture-v1";

// ---------------------------------------------------------------------------
// Minimal same-shape Cache / CacheStorage stand-ins — open/match/put only,
// which is everything lib/bible/loader.ts's fetchWithCache() calls.
// ---------------------------------------------------------------------------

class MockCache {
  readonly store = new Map<string, Response>();

  async match(key: string): Promise<Response | undefined> {
    const stored = this.store.get(key);
    return stored ? stored.clone() : undefined;
  }

  async put(key: string, response: Response): Promise<void> {
    this.store.set(key, response.clone());
  }
}

class MockCacheStorage {
  readonly named = new Map<string, MockCache>();

  async open(name: string): Promise<MockCache> {
    let cache = this.named.get(name);
    if (!cache) {
      cache = new MockCache();
      this.named.set(name, cache);
    }
    return cache;
  }
}

/** Installs a fresh MockCacheStorage as the global `caches` and returns it. */
function installMockCaches(): MockCacheStorage {
  const storage = new MockCacheStorage();
  Object.defineProperty(globalThis, "caches", {
    value: storage as unknown as CacheStorage,
    configurable: true,
    writable: true,
  });
  return storage;
}

function uninstallMockCaches(): void {
  Object.defineProperty(globalThis, "caches", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

/** Wraps a fetch implementation with a call log so "did it touch the network?" is assertable per-path. */
function countingFetch(impl: (path: string) => Promise<Response>) {
  const calls: string[] = [];
  const fn = async (input: RequestInfo | URL) => {
    const path = String(input);
    calls.push(path);
    return impl(path);
  };
  return { calls, fn };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function loadShippedVersemap(): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL("../public/bible/versemap.json", import.meta.url), "utf8"),
  );
}

function bookFixture(name: string, chapters: number): { b: string; c: string[][] } {
  return {
    b: name,
    c: Array.from({ length: chapters }, (_, i) => [`${name} ${i + 1} verse text`]),
  };
}

// ===========================================================================
// Criterion 1 + 5: versemap.json goes through fetchWithCache() (cache
// bible-brain-scripture-v1) and, with the cache warm and the network dead,
// alignment still resolves correctly for Romans 14/16.
// ===========================================================================

test("versemap.json is cached under bible-brain-scripture-v1 by the loader's fetchWithCache, not a bare fetch", async () => {
  installMockCaches();
  const versemap = await import("@/lib/bible/versemap");
  versemap.__resetVerseMapCacheForTests();

  const shipped = await loadShippedVersemap();
  const network = countingFetch(async () => jsonResponse(shipped));
  globalThis.fetch = network.fn;

  try {
    const status = await versemap.getDivergenceStatus("45.16");
    assert.equal(status, "diverges");
    assert.deepEqual(network.calls, ["/bible/versemap.json"], "must fetch versemap.json over the network on first read");

    const cache = (globalThis.caches as unknown as MockCacheStorage).named.get(SCRIPTURE_CACHE_NAME);
    assert.ok(cache, "fetchWithCache must open the bible-brain-scripture-v1 cache, not some other one");
    assert.ok(
      cache!.store.has("/bible/versemap.json"),
      "the response must be cached under the exact request path so an offline caches.match() finds it",
    );
  } finally {
    globalThis.fetch = async () => jsonResponse(shipped);
    versemap.__resetVerseMapCacheForTests();
    uninstallMockCaches();
  }
});

test("OFFLINE PATH (criterion 5): network unavailable but cache warm — alignment still resolves correctly for Romans 14/16", async () => {
  const cacheStorage = installMockCaches();
  const versemap = await import("@/lib/bible/versemap");
  versemap.__resetVerseMapCacheForTests();

  const shipped = await loadShippedVersemap();

  try {
    // Step 1: simulate an earlier online session (or a "Make available
    // offline" prefetch) that warmed the cache.
    const warmingFetch = countingFetch(async () => jsonResponse(shipped));
    globalThis.fetch = warmingFetch.fn;
    await versemap.getDivergenceStatus("45.16"); // triggers the cache-populating fetch
    assert.equal(warmingFetch.calls.length, 1, "sanity: the warm-up read touched the network exactly once");

    // Step 2: a brand new module load (simulates a fresh page load after the
    // device went offline) -- reset versemap's own in-memory promise/failure
    // memo, but the Cache API storage itself (cacheStorage) is untouched, as
    // it would survive a real reload.
    versemap.__resetVerseMapCacheForTests();
    const deadNetwork = countingFetch(async () => {
      throw new Error("simulated offline: network unreachable");
    });
    globalThis.fetch = deadNetwork.fn;

    // Step 3: the real offline assertion. If fetchWithCache did not check
    // the Cache API first, this would throw VerseMapUnavailableError instead
    // of resolving — the exact bug VMCACHE-001 exists to close.
    const rows = await versemap.alignChapter("BSB", "SBL", "45.16", 27);
    assert.equal(rows.find((row) => row.fromVerse === 25)?.toKey, "45.14.24");
    assert.equal(rows.find((row) => row.fromVerse === 26)?.toKey, "45.14.25");
    assert.equal(rows.find((row) => row.fromVerse === 27)?.toKey, "45.14.26");
    assert.ok(
      rows.some((row) => row.fromVerse === null && row.toKey === "45.16.25"),
      "the explicit Spanish-gap row must still be present offline",
    );
    assert.equal(
      deadNetwork.calls.length,
      0,
      "the warm cache must satisfy the read before fetch() is ever called — this is what makes it offline-safe, not offline-lucky",
    );

    // And the non-divergent 1,187-chapter path must still resolve offline too.
    assert.equal(await versemap.getDivergenceStatus("40.1"), "no-divergence");
  } finally {
    globalThis.fetch = async () => jsonResponse(shipped);
    versemap.__resetVerseMapCacheForTests();
    uninstallMockCaches();
  }
  void cacheStorage;
});

// ===========================================================================
// Criterion 2: "Make available offline" (warmVersion) prefetches
// versemap.json alongside the book files.
// ===========================================================================

test("warmVersion prefetches versemap.json alongside every book file, into the same cache", async () => {
  installMockCaches();
  const loader = await import("@/lib/bible/loader");

  const shipped = await loadShippedVersemap();
  const network = countingFetch(async (path) => {
    if (path === "/bible/versemap.json") return jsonResponse(shipped);
    const match = /^\/bible\/([A-Z]+)\/(\d+)\.json$/.exec(path);
    assert.ok(match, `unexpected fetch path in warmVersion: ${path}`);
    return jsonResponse(bookFixture(`Book ${match![2]}`, 3));
  });
  globalThis.fetch = network.fn;

  try {
    const version: VersionId = "BSB";
    await loader.warmVersion(version, [1, 2, 3]);

    assert.ok(
      network.calls.includes("/bible/versemap.json"),
      `warmVersion must also fetch versemap.json; calls were: ${JSON.stringify(network.calls)}`,
    );
    assert.ok(network.calls.includes("/bible/BSB/1.json"));
    assert.ok(network.calls.includes("/bible/BSB/2.json"));
    assert.ok(network.calls.includes("/bible/BSB/3.json"));

    const cache = (globalThis.caches as unknown as MockCacheStorage).named.get(SCRIPTURE_CACHE_NAME);
    assert.ok(cache?.store.has("/bible/versemap.json"), "versemap.json must land in the shared scripture cache");
    assert.ok(cache?.store.has("/bible/BSB/1.json"));
  } finally {
    uninstallMockCaches();
  }
});

test("warmVersion does not abort the book download if versemap.json's prefetch fails", async () => {
  installMockCaches();
  const loader = await import("@/lib/bible/loader");

  const network = countingFetch(async (path) => {
    if (path === "/bible/versemap.json") throw new Error("versemap prefetch failed");
    const match = /^\/bible\/([A-Z]+)\/(\d+)\.json$/.exec(path);
    assert.ok(match);
    return jsonResponse(bookFixture(`Book ${match![2]}`, 1));
  });
  globalThis.fetch = network.fn;

  try {
    const version: VersionId = "KJV";
    // Must not throw/reject even though the versemap fetch fails.
    await loader.warmVersion(version, [1, 2]);

    const cache = (globalThis.caches as unknown as MockCacheStorage).named.get(SCRIPTURE_CACHE_NAME);
    assert.ok(cache?.store.has("/bible/KJV/1.json"), "book files must still be downloaded and cached");
    assert.ok(cache?.store.has("/bible/KJV/2.json"));
  } finally {
    uninstallMockCaches();
  }
});

// ===========================================================================
// Criterion 3: ChapterReader's resolveAlignment() never rejects, and reports
// an explicit failure instead of leaving the caller hanging.
// ===========================================================================

test("resolveAlignment resolves (never rejects) with an explicit message when the map is unavailable", async () => {
  // No caches installed and a dead network -- this is exactly the shape of
  // failure that used to become an unhandled promise rejection in
  // ChapterReader before VMCACHE-001.
  const versemap = await import("@/lib/bible/versemap");
  versemap.__resetVerseMapCacheForTests();
  globalThis.fetch = async () => {
    throw new Error("network down");
  };

  let rejected = false;
  let result: Awaited<ReturnType<typeof resolveAlignment>> | undefined;
  try {
    result = await resolveAlignment("BSB", "SBL", "45.16", 27);
  } catch {
    rejected = true;
  } finally {
    globalThis.fetch = async () => jsonResponse(await loadShippedVersemap());
    versemap.__resetVerseMapCacheForTests();
  }

  assert.equal(rejected, false, "resolveAlignment must never reject — that is the exact bug VMCACHE-001 closes");
  assert.ok(result, "resolveAlignment must resolve with a value");
  assert.equal(result!.ok, false);
  if (!result!.ok) {
    assert.match(
      result!.message,
      /unavailable/i,
      "the failure message must be explicit, not a blank/silent state that leaves the UI hanging",
    );
  }
});

test("resolveAlignment resolves with the real aligned rows when the map is available", async () => {
  const versemap = await import("@/lib/bible/versemap");
  versemap.__resetVerseMapCacheForTests();
  const shipped = await loadShippedVersemap();
  globalThis.fetch = async () => jsonResponse(shipped);

  try {
    const result = await resolveAlignment("BSB", "SBL", "45.16", 27);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.rows.find((row) => row.fromVerse === 25)?.toKey, "45.14.24");
    }
  } finally {
    versemap.__resetVerseMapCacheForTests();
  }
});

test("resolveAlignment's identity path for a non-divergent chapter stays cheap: no fetch call at all", async () => {
  const versemap = await import("@/lib/bible/versemap");
  versemap.__resetVerseMapCacheForTests();
  const network = countingFetch(async () => jsonResponse(await loadShippedVersemap()));
  globalThis.fetch = network.fn;

  try {
    const result = await resolveAlignment("BSB", "KJV", "40.1", 25);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.rows.length, 25);
      assert.deepEqual(result.rows[0], { fromVerse: 1, toKey: "40.1.1" });
    }
    assert.equal(network.calls.length, 0, "an English-vs-English pair must never touch the map at all");
  } finally {
    versemap.__resetVerseMapCacheForTests();
  }
});
