/**
 * CODEX_AUDIT.md A-023 — public/sw.js's fetch handler started the shell
 * cache write with `caches.open(CACHE_NAME).then((cache) => cache.put(...))`
 * without ever handing that promise to `event.waitUntil()`. Because
 * `event.respondWith()`'s own chain resolves (delivering the response to the
 * page) as soon as `fetch()` settles, the browser is free to recycle the
 * worker before that background write finishes — a real, successful
 * network response could reach the page while the JS/CSS/font bytes it just
 * fetched were still only half-written to the cache, or never written at
 * all, so "visit once online, it works offline after" silently failed to
 * hold for anything slow enough to lose that race.
 *
 * TEST-ENVIRONMENT NOTE (same discipline as tests/offline-nav.test.ts, read
 * in full as precedent before writing this file, including its own
 * A-013-era comment on why this technique exists): public/sw.js is a plain
 * script served from public/, not a TypeScript module, so it cannot be
 * imported. This suite loads its REAL source text into a node:vm context
 * with a minimal ServiceWorkerGlobalScope mock and dispatches synthetic
 * FetchEvents at the *actual* registered "fetch" listener — i.e. it drives
 * sw.js's real logic, not a reimplementation of it. tests/offline-nav.test.ts
 * already does exactly this for the A-013 chapter-rescue path; this file
 * extends the same harness with a controllable `waitUntil` (tracking every
 * promise handed to it and whether each has settled) specifically to prove
 * the A-023 mechanism — that the cache-put promise is actually passed to
 * waitUntil() and is still pending at a point where, before this fix, the
 * response had already been handed back.
 *
 * tests/offline-nav.test.ts's own harness intentionally does NOT mock
 * `waitUntil` (its FetchEventLike only has request/respondWith, because
 * before this fix sw.js's fetch handler never called it) — this file is the
 * first to need it, so it is not reused verbatim; extending that other,
 * out-of-scope test file's harness in place was avoided on purpose (see this
 * task's SCOPE-BOUNDARY-001 discipline). sw.js's own waitUntil call is
 * written defensively (`typeof event.waitUntil === "function"`) for exactly
 * this reason: a fetch-event mock that only provides request/respondWith
 * (tests/offline-nav.test.ts's) must keep working unmodified, while a mock
 * that DOES provide waitUntil (this file's) can verify the real mechanism.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const SW_PATH = path.join(process.cwd(), "public", "sw.js");
const SW_SOURCE = readFileSync(SW_PATH, "utf8");

/** Mirrors the literal in public/sw.js — this worker's own shell cache, the one A-023's fix covers. */
const SHELL_CACHE_NAME = "bible-brain-shell-v1";

type RequestMode = "navigate" | "same-origin" | "cors" | "no-cors";

interface MockRequest {
  method: string;
  url: string;
  mode: RequestMode;
}

function makeRequest(url: string, mode: RequestMode = "same-origin", method = "GET"): MockRequest {
  return { method, url, mode };
}

type CacheKey = MockRequest | string;

function keyFor(request: CacheKey): string {
  return typeof request === "string" ? request : request.url;
}

class MockCache {
  private readonly store = new Map<string, Response>();
  /** How many times .put() actually resolved — distinguishes "attempted" from "finished". */
  putCount = 0;

  async match(request: CacheKey): Promise<Response | undefined> {
    const stored = this.store.get(keyFor(request));
    return stored ? stored.clone() : undefined;
  }

  async put(request: CacheKey, response: Response): Promise<void> {
    this.store.set(keyFor(request), response);
    this.putCount += 1;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }
}

class MockCacheStorage {
  private readonly named = new Map<string, MockCache>();

  async open(name: string): Promise<MockCache> {
    let cache = this.named.get(name);
    if (!cache) {
      cache = new MockCache();
      this.named.set(name, cache);
    }
    return cache;
  }

  get(name: string): MockCache | undefined {
    return this.named.get(name);
  }
}

interface FetchEventLike {
  request: MockRequest;
  respondWith(value: Promise<Response> | Response): void;
  waitUntil?(value: Promise<unknown>): void;
}

/**
 * Tracks every promise handed to waitUntil() and whether it has settled yet
 * — the actual mechanism A-023 fixes. `settledCount` is read synchronously
 * right after respondWith()'s own value resolves, which is exactly the
 * moment the ORIGINAL (buggy) code let the browser believe the fetch event
 * was done and free to recycle the worker.
 */
class WaitUntilTracker {
  private pending: Array<Promise<unknown>> = [];
  settledCount = 0;

  track(promise: Promise<unknown>): void {
    this.pending.push(promise);
    promise.then(
      () => {
        this.settledCount += 1;
      },
      () => {
        this.settledCount += 1;
      },
    );
  }

  get trackedCount(): number {
    return this.pending.length;
  }

  /** Waits for every tracked promise to settle — what a real browser does before recycling the worker. */
  async drain(): Promise<void> {
    await Promise.allSettled(this.pending);
  }
}

interface Harness {
  dispatchFetch(request: MockRequest): Promise<Response>;
  fetchCallCount: number;
  tracker: WaitUntilTracker;
  cacheStorage: MockCacheStorage;
}

/** Loads the real sw.js source into an isolated context and wires a fetch-event dispatcher to it, WITH a working waitUntil. */
function loadServiceWorker(
  fetchImpl: (request: MockRequest) => Promise<Response>,
  cacheStorage = new MockCacheStorage(),
): Harness {
  const listeners = new Map<string, Array<(event: unknown) => unknown>>();
  const tracker = new WaitUntilTracker();
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
    tracker,
    cacheStorage,
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
        waitUntil(value) {
          tracker.track(value);
        },
      };
      fetchListener(event);
      assert.ok(handled, "fetch event was not handled — respondWith() was never called");
      return await (captured as Promise<Response> | Response);
    },
  } as unknown as Harness;
}

function textResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": "text/plain" }, ...init });
}

// ===========================================================================
// The core A-023 mechanism: the cache-put promise is handed to waitUntil().
// ===========================================================================

test("a successful shell fetch hands its cache-write promise to event.waitUntil()", async () => {
  const onlineFetch = async () => textResponse("shell bytes");
  const harness = loadServiceWorker(onlineFetch);

  const response = await harness.dispatchFetch(makeRequest("http://localhost:3000/app.js"));
  assert.equal(await response.text(), "shell bytes");

  assert.equal(
    harness.tracker.trackedCount,
    1,
    "the fetch handler must call event.waitUntil() exactly once for the cache write",
  );
});

test("the write waitUntil() is handed is genuinely still pending at the moment respondWith()'s own value has already resolved -- the exact race A-023 closes", async () => {
  // A cache.put() that resolves AFTER this test has already read the
  // response is the whole point: before the fix, nothing kept the worker
  // alive for it, so the browser was free to kill it right here.
  let releaseWrite: (() => void) | undefined;
  const slowWrite = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });

  const cacheStorage = new MockCacheStorage();
  const realOpen = cacheStorage.open.bind(cacheStorage);
  cacheStorage.open = async (name: string) => {
    const cache = await realOpen(name);
    const realPut = cache.put.bind(cache);
    cache.put = async (request: CacheKey, response: Response) => {
      await slowWrite; // the write does not actually land until released below
      await realPut(request, response);
    };
    return cache;
  };

  const onlineFetch = async () => textResponse("slow-to-cache shell bytes");
  const harness = loadServiceWorker(onlineFetch, cacheStorage);

  const response = await harness.dispatchFetch(makeRequest("http://localhost:3000/app.js"));
  assert.equal(await response.text(), "slow-to-cache shell bytes");

  // This is the moment the OLD code considered the fetch event fully done.
  assert.equal(harness.tracker.trackedCount, 1, "waitUntil() must have been called already");
  assert.equal(
    harness.tracker.settledCount,
    0,
    "the write must still be pending here -- if it had already 'settled' with nothing outstanding, waitUntil() would have nothing real to extend",
  );

  releaseWrite!();
  await harness.tracker.drain();
  assert.equal(harness.tracker.settledCount, 1, "the tracked write must eventually settle once released");

  const cache = harness.cacheStorage.get(SHELL_CACHE_NAME);
  assert.ok(cache?.has("http://localhost:3000/app.js"), "the shell cache must actually contain the entry once the write lands");
});

test("a cache-write failure is swallowed -- a storage error must not turn a successful network response into a failure", async () => {
  const cacheStorage = new MockCacheStorage();
  const realOpen = cacheStorage.open.bind(cacheStorage);
  cacheStorage.open = async (name: string) => {
    const cache = await realOpen(name);
    cache.put = async () => {
      throw new Error("simulated QuotaExceededError");
    };
    return cache;
  };

  const onlineFetch = async () => textResponse("shell bytes despite a storage failure");
  const harness = loadServiceWorker(onlineFetch, cacheStorage);

  const response = await harness.dispatchFetch(makeRequest("http://localhost:3000/app.js"));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "shell bytes despite a storage failure");

  // The tracked write must settle (fulfilled, via the handler's own .catch())
  // rather than leaving an unhandled rejection hanging off waitUntil().
  await harness.tracker.drain();
  assert.equal(harness.tracker.settledCount, 1);
});

test("waitUntil() is not called at all for a non-ok network response (nothing gets cached)", async () => {
  const errorFetch = async () => textResponse("not found", { status: 404 });
  const harness = loadServiceWorker(errorFetch);

  const response = await harness.dispatchFetch(makeRequest("http://localhost:3000/missing.js"));
  assert.equal(response.status, 404);
  assert.equal(harness.tracker.trackedCount, 0, "a non-ok response must never trigger a cache write");
});

test("waitUntil() is not called for a request sw.js does not handle at all (e.g. /bible/*, owned by loader.ts)", async () => {
  const onlineFetch = async () => textResponse('{"b":"Genesis","c":[]}');
  const harness = loadServiceWorker(onlineFetch);

  // shouldHandle() in sw.js excludes /bible/* -- the fetch listener returns
  // early and never calls respondWith() at all for this path.
  const request = makeRequest("http://localhost:3000/bible/BSB/1.json");
  let handled = false;
  const event: FetchEventLike = {
    request,
    respondWith() {
      handled = true;
    },
    waitUntil(promise) {
      harness.tracker.track(promise);
    },
  };
  // Re-load directly to access the raw listener without the harness's own
  // "respondWith must be called" assertion, since this path deliberately
  // never calls it.
  const listeners: Array<(event: unknown) => unknown> = [];
  const selfMock = {
    addEventListener(type: string, handler: (e: unknown) => unknown) {
      if (type === "fetch") listeners.push(handler);
    },
    location: { origin: "http://localhost:3000" },
    skipWaiting() {},
    clients: { claim: async () => {} },
  };
  const sandbox: Record<string, unknown> = {
    self: selfMock,
    caches: new MockCacheStorage(),
    fetch: onlineFetch,
    Response,
    URL,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SW_SOURCE, sandbox as unknown as vm.Context, { filename: "sw.js" });
  listeners[0](event);

  assert.equal(handled, false, "sw.js must not touch /bible/* at all -- that cache belongs to lib/bible/loader.ts");
  assert.equal(harness.tracker.trackedCount, 0);
});

// ===========================================================================
// Guard against regressing tests/offline-nav.test.ts's harness, which
// intentionally provides only request/respondWith (no waitUntil) -- the
// exact shape sw.js's fetch handler used before A-023. Confirms the
// `typeof event.waitUntil === "function"` guard this fix relies on actually
// prevents a crash against that older mock shape, not just against this
// file's own newer one.
// ===========================================================================

test("the fetch handler still works against a minimal event mock with no waitUntil at all (defensive guard)", async () => {
  const listeners: Array<(event: unknown) => unknown> = [];
  const selfMock = {
    addEventListener(type: string, handler: (e: unknown) => unknown) {
      if (type === "fetch") listeners.push(handler);
    },
    location: { origin: "http://localhost:3000" },
    skipWaiting() {},
    clients: { claim: async () => {} },
  };
  const cacheStorage = new MockCacheStorage();
  const onlineFetch = async () => textResponse("shell bytes, no waitUntil available");
  const sandbox: Record<string, unknown> = {
    self: selfMock,
    caches: cacheStorage,
    fetch: onlineFetch,
    Response,
    URL,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SW_SOURCE, sandbox as unknown as vm.Context, { filename: "sw.js" });

  let captured: Promise<Response> | Response | undefined;
  // Deliberately NO waitUntil on this event object.
  const event = {
    request: makeRequest("http://localhost:3000/app.js"),
    respondWith(value: Promise<Response> | Response) {
      captured = value;
    },
  };
  listeners[0](event);
  const response = await (captured as Promise<Response> | Response);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "shell bytes, no waitUntil available");
});
