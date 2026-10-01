/**
 * STUDYOFFLINE-001 — `public/sw.js`'s new offline fallback for
 * `/study/{sessionId}` navigations (`offlineStudySessionFallback`), tested
 * with the exact same real-source-in-a-vm harness
 * `tests/offline-nav.test.ts` already established for the sibling
 * `/read/{book}/{chapter}` rescue (`offlineChapterFallback`) — this file
 * does not reimplement that harness differently, it reuses the identical
 * technique so sw.js's REAL registered "fetch" listener is what every
 * assertion below actually drives.
 *
 * The one addition this file's harness needs beyond tests/offline-nav.test.ts's
 * own: a real `indexedDB` in the vm sandbox (via `fake-indexeddb`, already a
 * dependency — `tests/sync-flush.test.ts` et al. already use it for the main
 * thread; this is the same library, just handed to the worker's sandbox
 * instead of the global scope). A FRESH `IDBFactory` per test (not the
 * process-wide `fake-indexeddb/auto` singleton every other suite uses) keeps
 * each test's "bible-brain" database from leaking into the next.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { IDBFactory } from "fake-indexeddb";

const SW_PATH = path.join(process.cwd(), "public", "sw.js");
const SW_SOURCE = readFileSync(SW_PATH, "utf8");

type RequestMode = "navigate" | "same-origin" | "cors" | "no-cors";

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

class MockCache {
  private readonly store = new Map<string, Response>();
  async match(request: CacheKey): Promise<Response | undefined> {
    const stored = this.store.get(keyFor(request));
    return stored ? stored.clone() : undefined;
  }
  async put(request: CacheKey, response: Response): Promise<void> {
    this.store.set(keyFor(request), response);
  }
}

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
}

interface FetchEventLike {
  request: MockRequest;
  respondWith(value: Promise<Response> | Response): void;
}

interface Harness {
  dispatchFetch(request: MockRequest): Promise<Response>;
}

/** Loads the real sw.js source into an isolated context with a FRESH, isolated indexedDB, and wires a fetch-event dispatcher to it. */
function loadServiceWorker(
  fetchImpl: (request: MockRequest) => Promise<Response>,
  options: { indexedDBFactory?: IDBFactory | typeof undefined } = {},
): Harness {
  const listeners = new Map<string, Array<(event: unknown) => unknown>>();

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

  const sandbox: Record<string, unknown> = {
    self: selfMock,
    caches: new MockCacheStorage(),
    fetch: fetchImpl,
    Response,
    URL,
    console,
    indexedDB: options.indexedDBFactory,
  };
  vm.createContext(sandbox);
  vm.runInContext(SW_SOURCE, sandbox as unknown as vm.Context, { filename: "sw.js" });

  const fetchListeners = listeners.get("fetch") ?? [];
  assert.equal(fetchListeners.length, 1, "public/sw.js must register exactly one fetch listener");
  const fetchListener = fetchListeners[0];

  return {
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

function studySession(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-offline-1",
    workspaceId: "workspace-1",
    range: { versificationId: "kjv-based", start: "1.3.1", end: "1.3.6" },
    mode: "encounter",
    workflowState: "active",
    connectionState: "unexamined",
    catalogReleaseId: null,
    readGateAt: null,
    currentStep: "observe",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

/** Seeds a fresh fake-indexeddb "bible-brain" database with the real v2 store layout, mirroring lib/sync/store.ts's own schema. */
async function seedBibleBrainDb(
  factory: IDBFactory,
  rows: { session?: Record<string, unknown>; claims?: Record<string, unknown>[]; applications?: Record<string, unknown>[] },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const openRequest = factory.open("bible-brain", 5);
    openRequest.onupgradeneeded = () => {
      const db = openRequest.result;
      db.createObjectStore("session", { keyPath: "id" });
      db.createObjectStore("claim", { keyPath: "id" });
      db.createObjectStore("application", { keyPath: "id" });
    };
    openRequest.onsuccess = () => {
      const db = openRequest.result;
      const transaction = db.transaction(["session", "claim", "application"], "readwrite");
      if (rows.session) transaction.objectStore("session").put(rows.session);
      for (const claim of rows.claims ?? []) transaction.objectStore("claim").put(claim);
      for (const application of rows.applications ?? []) transaction.objectStore("application").put(application);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
    openRequest.onerror = () => reject(openRequest.error);
  });
}

// ===========================================================================

test("offline navigation to a study session SAVED on this device renders its current step and claims, honestly labeled offline", async () => {
  const factory = new IDBFactory();
  await seedBibleBrainDb(factory, {
    session: studySession({ currentStep: "connect" }),
    claims: [{ id: "c1", sessionId: "session-offline-1", kind: "observation", body: "God is sovereign here.", deletedAt: null }],
    applications: [],
  });

  const harness = loadServiceWorker(offlineFetch, { indexedDBFactory: factory });
  const response = await harness.dispatchFetch(makeRequest("http://localhost:3000/study/session-offline-1", "navigate"));

  assert.equal(response.status, 200);
  assert.notEqual(response.type, "error");
  const body = await response.text();
  assert.match(body, /You(?:&#39;|')re offline/i);
  assert.match(body, /Current step: connect/);
  assert.match(body, /God is sovereign here\./);
  assert.match(body, /could not be checked/i, "must honestly disclose curated lesson content was not checked (criterion 3)");
});

test("offline navigation to a study session id NOT saved on this device shows an honest 'not saved' notice, never a blank page or browser error", async () => {
  const factory = new IDBFactory();
  await seedBibleBrainDb(factory, {}); // the database exists, but has no matching session row

  const harness = loadServiceWorker(offlineFetch, { indexedDBFactory: factory });
  const response = await harness.dispatchFetch(makeRequest("http://localhost:3000/study/no-such-session", "navigate"));

  assert.equal(response.status, 200);
  assert.notEqual(response.type, "error");
  const body = await response.text();
  assert.match(body, /isn(?:&#39;|')t saved on this device yet/i);
  assert.doesNotMatch(body, /Current step:/);
});

test("offline navigation when 'bible-brain' has never been created on this device (fresh install) does not create it, and shows the honest notice", async () => {
  const factory = new IDBFactory();
  // Deliberately never seeded -- the database does not exist on this device at all.

  const harness = loadServiceWorker(offlineFetch, { indexedDBFactory: factory });
  const response = await harness.dispatchFetch(makeRequest("http://localhost:3000/study/session-offline-1", "navigate"));

  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /isn(?:&#39;|')t saved on this device yet/i);

  // SAFETY PROOF: the worker must never have created "bible-brain" as a
  // side effect of checking it. If it did, the real app's own
  // openDB("bible-brain", 5, {...}) would see oldVersion 1 (not 0) the next
  // time it runs and skip recreating its version-1 object stores entirely --
  // see sw.js's own header comment on readLocalStudySession for the full
  // hazard this guards against.
  const databases = await factory.databases();
  assert.equal(
    databases.some((entry) => entry.name === "bible-brain"),
    false,
    "the service worker must never create the real app's database as a side effect of an offline read",
  );
});

test("offline navigation to /study/{id} when indexedDB is unavailable in this worker shows the honest 'can't check' notice, never throws", async () => {
  const harness = loadServiceWorker(offlineFetch, { indexedDBFactory: undefined });
  const response = await harness.dispatchFetch(makeRequest("http://localhost:3000/study/session-offline-1", "navigate"));

  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /can(?:&#39;|')t check its saved study data right now/i);
});

test("a non-navigate offline request to /study/{id} still hard-fails via Response.error(), unchanged (only a real document navigation gets the rescue)", async () => {
  const factory = new IDBFactory();
  await seedBibleBrainDb(factory, { session: studySession() });

  const harness = loadServiceWorker(offlineFetch, { indexedDBFactory: factory });
  const response = await harness.dispatchFetch(makeRequest("http://localhost:3000/study/session-offline-1", "same-origin"));

  assert.equal(response.type, "error");
});

test("online navigation to /study/{id} is unchanged: the live network response passes through untouched, no IndexedDB read at all", async () => {
  const networkBody = "<html><body>live server-rendered study page</body></html>";
  const onlineFetch = async (): Promise<Response> =>
    new Response(networkBody, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });

  // No indexedDBFactory at all -- if the online path touched it, this would throw.
  const harness = loadServiceWorker(onlineFetch, {});
  const response = await harness.dispatchFetch(makeRequest("http://localhost:3000/study/session-offline-1", "navigate"));

  const body = await response.text();
  assert.equal(body, networkBody);
  assert.doesNotMatch(body, /You(?:&#39;|')re offline/i);
});

test("a deleted session saved locally is treated as unavailable offline, not resurrected", async () => {
  const factory = new IDBFactory();
  await seedBibleBrainDb(factory, {
    session: studySession({ deletedAt: "2026-02-01T00:00:00.000Z" }),
  });

  const harness = loadServiceWorker(offlineFetch, { indexedDBFactory: factory });
  const response = await harness.dispatchFetch(makeRequest("http://localhost:3000/study/session-offline-1", "navigate"));

  const body = await response.text();
  assert.match(body, /isn(?:&#39;|')t saved on this device yet/i);
  assert.doesNotMatch(body, /Current step:/);
});
