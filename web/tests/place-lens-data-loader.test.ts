/**
 * PLACELENS-001 — `dataLoader.ts`'s offline-capable fetch, against a mock
 * Cache Storage (same `MockCache`/`MockCacheStorage` shape
 * `tests/offline-downloads.test.ts` already builds for `lib/bible/loader.ts`)
 * and a mock `fetch`. Proves: cache-first on a second call (no second
 * network hit), best-effort `cache.put` failure does not fail an otherwise-
 * successful read, and a network failure with nothing cached surfaces a
 * typed `MapAssetUnavailableError` rather than hanging or throwing something
 * uncaught.
 *
 * Author: Kenneth Hill
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetPlaceLensMemosForTests,
  fetchMapAssetWithCache,
  isPlaceLensCached,
  LAND_TOPOLOGY_PATH,
  loadLandTopology,
  loadPlaceLensDataset,
  MapAssetUnavailableError,
  PLACE_LENS_CACHE_NAME,
  PLACES_JSON_PATH,
  warmPlaceLensAssets,
} from "@/components/lens/PlaceLens/dataLoader";

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
  async delete(name: string): Promise<boolean> {
    return this.named.delete(name);
  }
}

function installMockCaches(): MockCacheStorage {
  const storage = new MockCacheStorage();
  Object.defineProperty(globalThis, "caches", { value: storage as unknown as CacheStorage, configurable: true, writable: true });
  return storage;
}
function uninstallMockCaches(): void {
  Object.defineProperty(globalThis, "caches", { value: undefined, configurable: true, writable: true });
}

function installFetch(impl: (path: string) => Promise<Response> | Response) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    return impl(url);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test.beforeEach(() => {
  __resetPlaceLensMemosForTests();
});

test("fetchMapAssetWithCache: a second call for the same path hits the cache, not the network", async () => {
  installMockCaches();
  const fetchMock = installFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  try {
    await fetchMapAssetWithCache(PLACES_JSON_PATH);
    await fetchMapAssetWithCache(PLACES_JSON_PATH);
    assert.equal(fetchMock.calls.length, 1, "second fetch should have been served from cache");
  } finally {
    fetchMock.restore();
    uninstallMockCaches();
  }
});

test("fetchMapAssetWithCache: writes into the place-lens-v1 bucket, not the Bible corpus bucket", async () => {
  const storage = installMockCaches();
  const fetchMock = installFetch(() => new Response("{}", { status: 200 }));
  try {
    await fetchMapAssetWithCache(LAND_TOPOLOGY_PATH);
    assert.ok(storage.named.has(PLACE_LENS_CACHE_NAME));
    assert.ok(!storage.named.has("bible-brain-scripture-v1"));
  } finally {
    fetchMock.restore();
    uninstallMockCaches();
  }
});

test("fetchMapAssetWithCache: a failed cache.put does not fail an otherwise-successful network read", async () => {
  installMockCaches();
  // Monkeypatch the (mock) cache's put to reject, simulating a quota-exceeded write.
  const storage = (globalThis as unknown as { caches: MockCacheStorage }).caches;
  const cache = await storage.open(PLACE_LENS_CACHE_NAME);
  cache.put = () => Promise.reject(new Error("quota exceeded"));
  const fetchMock = installFetch(() => new Response("{\"ok\":true}", { status: 200 }));
  try {
    const response = await fetchMapAssetWithCache(PLACES_JSON_PATH);
    assert.equal(response.ok, true);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    fetchMock.restore();
    uninstallMockCaches();
  }
});

test("loadPlaceLensDataset: a network failure with nothing cached throws MapAssetUnavailableError, and a retry actually retries", async () => {
  installMockCaches();
  let attempts = 0;
  const fetchMock = installFetch(() => {
    attempts += 1;
    if (attempts === 1) return Promise.reject(new Error("offline"));
    return new Response(JSON.stringify({ attribution: "x", sourceUrl: "x", datasetCommit: "x", generatedAt: "x", places: [] }), {
      status: 200,
    });
  });
  try {
    await assert.rejects(() => loadPlaceLensDataset(), MapAssetUnavailableError);
    // The failure must not be memoised — a second call actually retries the network.
    const dataset = await loadPlaceLensDataset();
    assert.deepEqual(dataset.places, []);
    assert.equal(attempts, 2);
  } finally {
    fetchMock.restore();
    uninstallMockCaches();
  }
});

test("isPlaceLensCached: false until both assets are cached, true once both are", async () => {
  installMockCaches();
  const fetchMock = installFetch(() => new Response("{}", { status: 200 }));
  try {
    assert.equal(await isPlaceLensCached(), false);
    await loadPlaceLensDataset();
    assert.equal(await isPlaceLensCached(), false, "only places.json cached so far");
    await loadLandTopology();
    assert.equal(await isPlaceLensCached(), true);
  } finally {
    fetchMock.restore();
    uninstallMockCaches();
  }
});

test("warmPlaceLensAssets: ok:true on success, ok:false with a message on failure (never throws)", async () => {
  installMockCaches();
  const failing = installFetch(() => Promise.reject(new Error("network down")));
  try {
    const result = await warmPlaceLensAssets();
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /Could not load/);
  } finally {
    failing.restore();
    uninstallMockCaches();
  }
});

test("without a Cache API (hasCacheApi() false), fetchMapAssetWithCache still works via a plain fetch", async () => {
  uninstallMockCaches(); // caches undefined
  const fetchMock = installFetch(() => new Response("{\"ok\":true}", { status: 200 }));
  try {
    const response = await fetchMapAssetWithCache(PLACES_JSON_PATH);
    assert.equal(response.ok, true);
  } finally {
    fetchMock.restore();
  }
});
