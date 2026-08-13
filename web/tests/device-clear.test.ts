import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

/**
 * Clear-device: what it destroys, what it must never destroy, and what it must
 * refuse to start.
 *
 * Test order is load-bearing. lib/sync/store.ts holds its IndexedDB handle in
 * a module-level singleton, and the first successful clear closes it for the
 * rest of the process (verified: getPendingOps then throws InvalidStateError).
 * So every test that needs a live store — i.e. the real sync pre-flight — runs
 * before the first successful destroy, and the scoped-deletion test injects a
 * flush instead. Node isolates test *files*, not tests within a file.
 */

const root = process.cwd();
const isoNow = () => new Date().toISOString();

// node 24 exposes navigator as a configurable getter with no onLine.
function setOnline(onLine: boolean) {
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine },
    configurable: true,
  });
}

function makeCaches(names: string[], options: { deletes?: boolean } = {}) {
  const deletes = options.deletes ?? true;
  const map = new Map(names.map((name) => [name, true]));
  const stub = {
    keys: async () => [...map.keys()],
    delete: async (key: string) => (deletes ? map.delete(key) : false),
  };
  Object.defineProperty(globalThis, "caches", {
    value: stub as unknown as CacheStorage,
    configurable: true,
    writable: true,
  });
  return stub;
}

function makeStorage(seed: Record<string, string>) {
  const map = new Map(Object.entries(seed));
  const stub = {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: stub as unknown as Storage,
    configurable: true,
    writable: true,
  });
  return stub;
}

function syncResponse() {
  return new Response(
    JSON.stringify({
      entries: [],
      threads: [],
      progress: [],
      logs: [],
      people: [],
      rejected: [],
      serverTime: isoNow(),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const SEED_CACHES = [
  "bible-brain-scripture-v1",
  "bible-brain-shell-v1",
  "unrelated-cache",
];
const SEED_STORAGE = () => ({
  "bible-brain:last-read": '{"book":1}',
  unrelated: "keep",
});

async function assertNothingDestroyed(message: string) {
  const databases = (await indexedDB.databases()).map((info) => info.name);
  assert.ok(databases.includes("bible-brain"), `${message}: database kept`);
  assert.deepEqual(
    (await caches.keys()).sort(),
    [...SEED_CACHES].sort(),
    `${message}: caches kept`,
  );
  assert.equal(
    localStorage.getItem("bible-brain:last-read"),
    '{"book":1}',
    `${message}: last-read kept`,
  );
  assert.equal(localStorage.getItem("unrelated"), "keep");
}

// --- 1. offline refuses, and refuses before anything happens ----------------

test("clearing refuses while offline and destroys nothing", async () => {
  const store = await import("@/lib/sync/store");
  const { DeviceClearFailure, DeviceOfflineError, runDeviceClear } =
    await import("@/lib/sync/clear");
  await store.getPendingOps(); // forces the local database into existence
  setOnline(false);
  makeCaches(SEED_CACHES);
  makeStorage(SEED_STORAGE());

  let signOutCalls = 0;
  await assert.rejects(
    runDeviceClear({
      signOut: async () => {
        signOutCalls += 1;
        return { url: "/sign-in" };
      },
    }),
    (error: unknown) =>
      error instanceof DeviceClearFailure &&
      error.signedOut === false &&
      error.cause instanceof DeviceOfflineError,
  );
  assert.equal(signOutCalls, 0, "offline never reaches sign-out");
  await assertNothingDestroyed("offline");
});

// --- 2. a failed sync clears nothing and never signs out --------------------

test("a failed sync clears nothing and never signs out", async () => {
  const store = await import("@/lib/sync/store");
  const { DeviceClearFailure, runDeviceClear } = await import(
    "@/lib/sync/clear"
  );
  setOnline(true);
  makeCaches(SEED_CACHES);
  makeStorage(SEED_STORAGE());
  const now = isoNow();
  await store.saveLocalThread({
    slug: "unsynced-before-clear",
    title: "Unsynced before clear",
    definition: "",
    seeing: "",
    createdAt: now,
    updatedAt: now,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("nope", { status: 500 });
  let signOutCalls = 0;
  try {
    await assert.rejects(
      runDeviceClear({
        signOut: async () => {
          signOutCalls += 1;
          return { url: "/sign-in" };
        },
      }),
      (error: unknown) =>
        error instanceof DeviceClearFailure && error.signedOut === false,
    );
    assert.equal(signOutCalls, 0, "sync strictly precedes sign-out");
    assert.equal((await store.getPendingOps()).length, 1, "the write survives");
    await assertNothingDestroyed("failed sync");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- 3. a rejected write clears nothing -------------------------------------

test("a server-rejected write clears nothing", async () => {
  const store = await import("@/lib/sync/store");
  const { SyncRejectedError } = await import("@/lib/sync/client");
  const { DeviceClearFailure, runDeviceClear } = await import(
    "@/lib/sync/clear"
  );
  setOnline(true);
  makeCaches(SEED_CACHES);
  makeStorage(SEED_STORAGE());
  const [pending] = await store.getPendingOps();
  assert.ok(pending, "the unsynced write from the previous test is still here");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        entries: [],
        threads: [],
        progress: [],
        logs: [],
        people: [],
        rejected: [{ id: pending.id, reason: "Injected rejection" }],
        serverTime: isoNow(),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  let signOutCalls = 0;
  try {
    await assert.rejects(
      runDeviceClear({
        signOut: async () => {
          signOutCalls += 1;
          return { url: "/sign-in" };
        },
      }),
      (error: unknown) =>
        error instanceof DeviceClearFailure &&
        error.signedOut === false &&
        error.cause instanceof SyncRejectedError,
    );
    assert.equal(signOutCalls, 0);
    await assertNothingDestroyed("rejected sync");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- 4. a failed sign-out clears nothing ------------------------------------

test("a failed sign-out clears nothing", async () => {
  const { DeviceClearFailure, runDeviceClear } = await import(
    "@/lib/sync/clear"
  );
  setOnline(true);
  makeCaches(SEED_CACHES);
  makeStorage(SEED_STORAGE());

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => syncResponse();
  try {
    await assert.rejects(
      runDeviceClear({
        signOut: async () => {
          throw new Error("sign-out unavailable");
        },
      }),
      (error: unknown) =>
        error instanceof DeviceClearFailure && error.signedOut === false,
    );
    await assertNothingDestroyed("failed sign-out");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- 5. signed out but not cleared: the shared-device signal ----------------

test("a failed clear after a successful sign-out is reported as not cleared", async () => {
  const { DeviceClearFailure, DeviceClearIncompleteError, runDeviceClear } =
    await import("@/lib/sync/clear");
  setOnline(true);
  makeCaches(SEED_CACHES, { deletes: false });
  makeStorage(SEED_STORAGE());

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => syncResponse();
  try {
    await assert.rejects(
      runDeviceClear({ signOut: async () => ({ url: "/sign-in" }) }),
      (error: unknown) =>
        error instanceof DeviceClearFailure &&
        error.signedOut === true &&
        error.cause instanceof DeviceClearIncompleteError &&
        error.cause.remaining.includes("caches"),
    );
    assert.deepEqual(
      (await caches.keys()).sort(),
      [...SEED_CACHES].sort(),
      "the undeletable caches are what verification caught",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the UI copy for that state never claims the device was cleared", () => {
  const src = fs.readFileSync(
    path.join(root, "components/auth/DeviceSessionControls.tsx"),
    "utf8",
  );
  assert.match(src, /this device was NOT cleared/);
  assert.match(src, /not-cleared/);
  assert.doesNotMatch(src, /device was cleared/i);
  assert.doesNotMatch(src, /Cleared\.["`]/);
});

// --- 6. a successful clear is correctly scoped ------------------------------

test("a successful clear removes app data and keeps everything else", async () => {
  const { runDeviceClear } = await import("@/lib/sync/clear");
  setOnline(true);
  // The store singleton died with the clear in test 5, so the local database
  // is recreated raw here and the pre-flight is injected. Ordering of the real
  // pre-flight is proven by tests 2-4.
  await new Promise<void>((resolve) => {
    const request = indexedDB.open("bible-brain", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("entries");
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });
  assert.ok(
    (await indexedDB.databases()).some((info) => info.name === "bible-brain"),
    "the database exists before clearing",
  );

  makeCaches([
    "bible-brain-scripture-v1",
    "bible-brain-shell-v1",
    "unrelated-cache",
    "other-app-v2",
  ]);
  makeStorage({
    "bible-brain:last-read": '{"book":1}',
    "bible-brain:something-else": "x",
    unrelated: "keep",
  });

  const result = await runDeviceClear({
    signOut: async () => ({ url: "/sign-in" }),
    flush: async () => {},
  });

  assert.deepEqual(result, { redirectTo: "/sign-in" });
  assert.ok(
    !(await indexedDB.databases()).some((info) => info.name === "bible-brain"),
    "the app database is gone",
  );
  assert.deepEqual((await caches.keys()).sort(), [
    "other-app-v2",
    "unrelated-cache",
  ]);
  assert.equal(localStorage.getItem("bible-brain:last-read"), null);
  assert.equal(localStorage.getItem("bible-brain:something-else"), null);
  assert.equal(localStorage.getItem("unrelated"), "keep");
});

// --- 7. a blocked delete fails loudly instead of hanging --------------------

test("a delete blocked by another tab fails instead of hanging", async () => {
  const { DeviceClearIncompleteError, clearLocalStudyData } = await import(
    "@/lib/sync/clear"
  );
  const blocker = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open("bible-brain", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("entries");
    request.onsuccess = () => resolve(request.result);
  });
  try {
    await assert.rejects(
      clearLocalStudyData({ deleteTimeoutMs: 100 }),
      (error: unknown) =>
        error instanceof DeviceClearIncompleteError &&
        error.remaining.includes("indexeddb"),
    );
  } finally {
    blocker.close();
  }
});
