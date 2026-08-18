/**
 * CODEX_AUDIT.md A-013 — offline navigation to a never-visited chapter.
 *
 * public/sw.js is a plain script served from public/, not a TypeScript
 * module, so it cannot be imported. This suite instead loads its real source
 * text into a `node:vm` context with a minimal ServiceWorkerGlobalScope
 * mock (self/addEventListener, a Cache Storage mock, a controllable global
 * fetch) and dispatches synthetic FetchEvents at the *actual* registered
 * "fetch" listener — i.e. it drives sw.js's real logic, not a reimplementation
 * of it. Every assertion below is about what that listener's respondWith()
 * value actually is: status, body text, and (via the mock Cache Storage)
 * exactly which caches were read.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const SW_PATH = path.join(process.cwd(), "public", "sw.js");
const SW_SOURCE = readFileSync(SW_PATH, "utf8");

/** Mirrors the literal in public/sw.js — loader.ts's cache, read-only here. */
const SCRIPTURE_CACHE_NAME = "bible-brain-scripture-v1";
/** Mirrors the literal in public/sw.js — this worker's own shell cache. */
const SHELL_CACHE_NAME = "bible-brain-shell-v1";

type RequestMode = "navigate" | "same-origin" | "cors" | "no-cors";

/**
 * A plain object, not a real DOM Request. Node's global `Request` refuses
 * `mode: "navigate"` (the Fetch spec reserves it for browser-internal
 * navigations), but sw.js only ever reads .method/.url/.mode off whatever
 * object the fetch event carries, so a plain object drives the same code
 * paths a real navigation Request would.
 */
interface MockRequest {
  method: string;
  url: string;
  mode: RequestMode;
}

function makeRequest(url: string, mode: RequestMode = "navigate", method = "GET"): MockRequest {
  return { method, url, mode };
}

type CacheKey = MockRequest | string;

function keyFor(request: CacheKey): string {
  return typeof request === "string" ? request : request.url;
}

/** Minimal same-shape stand-in for the real Cache interface — match/put only, sw.js uses nothing else. */
class MockCache {
  private readonly store = new Map<string, Response>();

  async match(request: CacheKey): Promise<Response | undefined> {
    const stored = this.store.get(keyFor(request));
    return stored ? stored.clone() : undefined;
  }

  async put(request: CacheKey, response: Response): Promise<void> {
    this.store.set(keyFor(request), response);
  }

  /** Test-only convenience, not part of the Cache interface sw.js consumes. */
  seed(url: string, response: Response): void {
    this.store.set(url, response);
  }
}

/** Minimal same-shape stand-in for the real CacheStorage — open/match only. */
class MockCacheStorage {
  private readonly named = new Map<string, MockCache>();

  private get(name: string): MockCache {
    let cache = this.named.get(name);
    if (!cache) {
      cache = new MockCache();
      this.named.set(name, cache);
    }
    return cache;
  }

  async open(name: string): Promise<MockCache> {
    return this.get(name);
  }

  async match(request: CacheKey): Promise<Response | undefined> {
    for (const cache of this.named.values()) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    return undefined;
  }

  /** Test-only direct access to seed a named cache before dispatching a request. */
  seed(name: string, url: string, response: Response): void {
    this.get(name).seed(url, response);
  }
}

interface FetchEventLike {
  request: MockRequest;
  respondWith(value: Promise<Response> | Response): void;
}

interface Harness {
  dispatchFetch(request: MockRequest): Promise<Response>;
  fetchCallCount: number;
}

/** Loads the real sw.js source into an isolated context and wires a fetch-event dispatcher to it. */
function loadServiceWorker(fetchImpl: (request: MockRequest) => Promise<Response>, cacheStorage = new MockCacheStorage()): Harness {
  const listeners = new Map<string, Array<(event: unknown) => unknown>>();
  let fetchCallCount = 0;

  const selfMock = {
    addEventListener(type: string, handler: (event: unknown) => unknown) {
      const existing = listeners.get(type) ?? [];
      existing.push(handler);
      listeners.set(type, existing);
    },
    location: { origin: "http://localhost:3000" },
    skipWaiting() {},
    clients: { claim: async () => {} },
  };

  const wrappedFetch = async (request: MockRequest) => {
    fetchCallCount += 1;
    return fetchImpl(request);
  };

  const sandbox: Record<string, unknown> = {
    self: selfMock,
    caches: cacheStorage,
    fetch: wrappedFetch,
    Response,
    URL,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SW_SOURCE, sandbox as unknown as vm.Context, { filename: "sw.js" });

  const fetchListeners = listeners.get("fetch") ?? [];
  assert.equal(fetchListeners.length, 1, "public/sw.js must register exactly one fetch listener");
  const fetchListener = fetchListeners[0];

  return {
    get fetchCallCount() {
      return fetchCallCount;
    },
    async dispatchFetch(request: MockRequest): Promise<Response> {
      let captured: Promise<Response> | Response | undefined;
      let handled = false;
      const event: FetchEventLike = {
        request,
        respondWith(value) {
          handled = true;
          captured = value;
        },
      };
      fetchListener(event);
      assert.ok(handled, "fetch event was not handled — respondWith() was never called");
      return await (captured as Promise<Response> | Response);
    },
  };
}

async function offlineFetch(): Promise<Response> {
  throw new TypeError("network unreachable");
}

function bookDataResponse(book: { b: string; c: string[][] }): Response {
  return new Response(JSON.stringify(book), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const GENESIS = {
  b: "Genesis",
  c: [
    ["In the beginning God created the heavens and the earth."],
    ["Now the earth was formless and empty.", "And the Spirit of God was hovering over the waters."],
  ],
};

test("offline navigation to a never-visited chapter renders readable Scripture when the book IS cached", async () => {
  const cacheStorage = new MockCacheStorage();
  cacheStorage.seed(SCRIPTURE_CACHE_NAME, "/bible/BSB/1.json", bookDataResponse(GENESIS));
  // Chapter 2 of book 1 was never itself visited — no shell-cache entry for it.

  const harness = loadServiceWorker(offlineFetch, cacheStorage);
  const response = await harness.dispatchFetch(makeRequest("http://localhost:3000/read/1/2", "navigate"));

  assert.equal(response.status, 200);
  assert.notEqual(response.type, "error", "must not be a network-error Response");
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");

  const body = await response.text();
  assert.match(body, /Genesis 2/, "renders the resolved book name and chapter, not just numbers");
  assert.match(body, /Now the earth was formless and empty\./);
  assert.match(body, /And the Spirit of God was hovering over the waters\./);
  assert.match(body, /You're offline/i, "must honestly disclose this is the offline copy");
});

test("offline navigation to a chapter whose book is NOT cached shows an explicit notice, never a blank page or a browser error", async () => {
  const cacheStorage = new MockCacheStorage();
  // No entry for book 1 in any version — nothing downloaded for this book.

  const harness = loadServiceWorker(offlineFetch, cacheStorage);
  const response = await harness.dispatchFetch(makeRequest("http://localhost:3000/read/1/2", "navigate"));

  assert.equal(response.status, 200, "an honest notice page, not a browser network-error page");
  assert.notEqual(response.type, "error");
  const body = await response.text();
  assert.match(body, /hasn't been downloaded/i);
  assert.doesNotMatch(body, /<sup>/, "must not fabricate verse markup for a book that was never cached");
});

test("the cached-book and uncached-book offline fallbacks are genuinely distinct paths, not one path with cosmetic text", async () => {
  const withBook = new MockCacheStorage();
  withBook.seed(SCRIPTURE_CACHE_NAME, "/bible/BSB/1.json", bookDataResponse(GENESIS));
  const withoutBook = new MockCacheStorage();

  const cachedResponse = await loadServiceWorker(offlineFetch, withBook).dispatchFetch(
    makeRequest("http://localhost:3000/read/1/2", "navigate"),
  );
  const missingResponse = await loadServiceWorker(offlineFetch, withoutBook).dispatchFetch(
    makeRequest("http://localhost:3000/read/1/2", "navigate"),
  );

  const cachedBody = await cachedResponse.text();
  const missingBody = await missingResponse.text();

  assert.match(cachedBody, /Now the earth was formless and empty\./);
  assert.doesNotMatch(missingBody, /Now the earth was formless and empty\./);
  assert.match(missingBody, /hasn't been downloaded/i);
  assert.doesNotMatch(cachedBody, /hasn't been downloaded/i);
});

test("an offline revisit of an already-cached chapter route is served from the exact cache, unaffected by the new fallback", async () => {
  const cacheStorage = new MockCacheStorage();
  const exactUrl = "http://localhost:3000/read/2/1";
  cacheStorage.seed(
    SHELL_CACHE_NAME,
    exactUrl,
    new Response("<html><body>previously cached chapter shell</body></html>", {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
  );
  // Book 2 has no scripture-cache entry at all — if the exact-hit branch were
  // bypassed, the new fallback would render the "not downloaded" notice instead.

  const harness = loadServiceWorker(offlineFetch, cacheStorage);
  const response = await harness.dispatchFetch(makeRequest(exactUrl, "navigate"));

  const body = await response.text();
  assert.match(body, /previously cached chapter shell/);
  assert.doesNotMatch(body, /hasn't been downloaded/i);
});

test("a non-navigate offline request to an uncached /read path still hard-fails via Response.error(), unchanged", async () => {
  const cacheStorage = new MockCacheStorage();
  cacheStorage.seed(SCRIPTURE_CACHE_NAME, "/bible/BSB/1.json", bookDataResponse(GENESIS));

  const harness = loadServiceWorker(offlineFetch, cacheStorage);
  // "same-origin" stands in for the RSC/prefetch fetch Next.js issues for a
  // soft client-side navigation, before it falls back to a real (navigate)
  // MPA request. Only the real navigation gets the chapter rescue.
  const response = await harness.dispatchFetch(makeRequest("http://localhost:3000/read/1/2", "same-origin"));

  assert.equal(response.type, "error", "non-navigate offline misses must be untouched by the new fallback");
});

test("online navigation is unchanged: a successful network response is returned as-is, with no extra fetches", async () => {
  const networkBody = "<html><body>live server-rendered chapter</body></html>";
  let requestedUrl: string | undefined;
  const onlineFetch = async (request: MockRequest): Promise<Response> => {
    requestedUrl = request.url;
    return new Response(networkBody, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };

  const harness = loadServiceWorker(onlineFetch);
  const response = await harness.dispatchFetch(makeRequest("http://localhost:3000/read/1/2", "navigate"));

  assert.equal(response.status, 200);
  const body = await response.text();
  assert.equal(body, networkBody, "the live network response must pass through untouched");
  assert.doesNotMatch(body, /You're offline/i, "the offline fallback must never run when the network succeeds");
  assert.equal(harness.fetchCallCount, 1, "exactly one network fetch — no retry, no extra probe");
  assert.equal(requestedUrl, "http://localhost:3000/read/1/2");
});
