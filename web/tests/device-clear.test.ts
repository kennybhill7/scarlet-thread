import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

/**
 * Clear-device: what it destroys, what it must never destroy, what it must
 * refuse to start, what it must not claim when it cannot tell, and how the
 * user gets out of every failure.
 *
 * Test order is load-bearing. lib/sync/store.ts holds its IndexedDB handle in
 * a module-level singleton, and the first successful clear closes it for the
 * rest of the process (verified: getPendingOps then throws InvalidStateError).
 * So every test that needs a live store — i.e. the real sync pre-flight — runs
 * before the first successful destroy, and every test after it either injects
 * a flush or recreates the database raw. Node isolates test *files*, not tests
 * within a file.
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

/** Recreate the local database without lib/sync/store, whose handle may be dead. */
function openLocalDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve) => {
    const request = indexedDB.open("bible-brain", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("entries");
    request.onsuccess = () => resolve(request.result);
  });
}

async function localDatabaseExists(): Promise<boolean> {
  return (await indexedDB.databases()).some(
    (info) => info.name === "bible-brain",
  );
}

/** Resolve with the rejection reason, or fail if the promise resolves. */
async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a rejection, but the call succeeded");
    },
    (error: unknown) => error,
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
  assert.ok(await localDatabaseExists(), `${message}: database kept`);
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

// --- 5. runtime recovery: a failed sync is retryable, and the retry works ----

/**
 * The stuck-controls case. A failure that leaves the user with no next move is
 * worse than the failure itself, so this drives the real flow through an
 * injected sync failure and then an injected success, and checks the state the
 * UI would render in between (`canRetry`, and the ordinary "error" state that
 * keeps the button enabled — `busy` is only `clearing`/`rechecking`).
 */
test("a failed sync leaves an actionable retry, and the retry completes", async () => {
  const { DeviceClearFailure, describeClearFailure, runDeviceClear } =
    await import("@/lib/sync/clear");
  setOnline(true);
  makeCaches(SEED_CACHES);
  makeStorage(SEED_STORAGE());

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("nope", { status: 500 });
  let failure: unknown;
  try {
    failure = await failureOf(
      runDeviceClear({ signOut: async () => ({ url: "/sign-in" }) }),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ok(failure instanceof DeviceClearFailure);
  assert.equal(failure.signedOut, false);
  assert.deepEqual(describeClearFailure(failure), {
    state: "error",
    unknown: false,
    canRetry: true,
    message:
      "Nothing was cleared because sync and sign-out could not be confirmed. Please try again.",
  });
  await assertNothingDestroyed("recoverable sync failure");

  // Same controls, same device, sync now succeeds.
  globalThis.fetch = async () => syncResponse();
  try {
    assert.deepEqual(
      await runDeviceClear({ signOut: async () => ({ url: "/sign-in" }) }),
      { redirectTo: "/sign-in" },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ok(!(await localDatabaseExists()), "the retry cleared the device");
  assert.equal(localStorage.getItem("bible-brain:last-read"), null);
  assert.equal(localStorage.getItem("unrelated"), "keep");
});

// --- 6. signed out but not cleared: the shared-device signal ----------------

test("a failed clear after a successful sign-out is reported as not cleared", async () => {
  const {
    DeviceClearFailure,
    DeviceClearIncompleteError,
    describeClearFailure,
    runDeviceClear,
  } = await import("@/lib/sync/clear");
  setOnline(true);
  makeCaches(SEED_CACHES, { deletes: false });
  makeStorage(SEED_STORAGE());

  // The store singleton died with the successful clear in test 5, so the
  // pre-flight is injected. Its ordering is proven by tests 2-5.
  const failure = await failureOf(
    runDeviceClear({
      signOut: async () => ({ url: "/sign-in" }),
      flush: async () => {},
    }),
  );
  assert.ok(failure instanceof DeviceClearFailure);
  assert.equal(failure.signedOut, true);
  assert.ok(failure.cause instanceof DeviceClearIncompleteError);
  assert.ok(failure.cause.remaining.includes("caches"));
  assert.deepEqual(
    (await caches.keys()).sort(),
    [...SEED_CACHES].sort(),
    "the undeletable caches are what verification caught",
  );

  const view = describeClearFailure(failure);
  assert.equal(view.state, "not-cleared");
  assert.equal(view.unknown, false, "this outcome is known, not unknown");
  assert.equal(view.canRetry, true);
  assert.match(view.message, /still stored in this browser/);
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
  // The message is whatever describeClearFailure decided, so the unknown case
  // cannot be shown with the settled-failure wording.
  assert.match(src, /describeClearFailure/);
  // And the state has an exit that re-checks the device rather than a dead end.
  assert.match(src, /void checkAgain\(\)/);
  assert.match(src, /await clearLocalStudyData\(\)/);
});

// --- 7. the copy, the code, and the tests all state one order ---------------

test("the clear-device copy states the same order the code runs", async () => {
  const { CLEAR_DEVICE_CONFIRM, CLEAR_DEVICE_STEPS } = await import(
    "@/lib/sync/clear"
  );
  assert.deepEqual(
    [...CLEAR_DEVICE_STEPS],
    [
      "Sync your writing to the server",
      "Sign out of this account",
      "Delete this app's notes and offline Bible data from this browser",
      "Check that they are really gone, and say so if anything is left",
    ],
  );

  // The confirm dialog numbers them in that order.
  CLEAR_DEVICE_STEPS.forEach((step, index) => {
    assert.ok(
      CLEAR_DEVICE_CONFIRM.includes(`${index + 1}. ${step}.`),
      `confirm text lists step ${index + 1}`,
    );
  });
  const positions = CLEAR_DEVICE_STEPS.map((step) =>
    CLEAR_DEVICE_CONFIRM.indexOf(step),
  );
  assert.deepEqual([...positions].sort((a, b) => a - b), [...positions]);

  // The code performs them in that order: flush, sign-out, destroy, verify.
  const lib = fs.readFileSync(path.join(root, "lib/sync/clear.ts"), "utf8");
  const orchestration = lib.slice(
    lib.indexOf("export async function runDeviceClear"),
  );
  const flushAt = orchestration.indexOf("await flush()");
  const signOutAt = orchestration.indexOf("await deps.signOut()");
  const destroyAt = orchestration.indexOf("await clearLocalStudyData(");
  assert.ok(flushAt > -1, "the flush call is where the test thinks it is");
  assert.ok(signOutAt > flushAt, "sign-out follows the sync flush");
  assert.ok(destroyAt > signOutAt, "destruction follows sign-out");

  const destruction = lib.slice(
    lib.indexOf("export async function clearLocalStudyData"),
  );
  assert.ok(
    destruction.indexOf("deleteDB(LOCAL_DATABASE") <
      destruction.indexOf("// Verification."),
    "verification follows destruction",
  );

  // The component states that order and nothing else.
  const ui = fs.readFileSync(
    path.join(root, "components/auth/DeviceSessionControls.tsx"),
    "utf8",
  );
  assert.match(ui, /window\.confirm\(CLEAR_DEVICE_CONFIRM\)/);
  assert.match(ui, /CLEAR_DEVICE_STEPS\.map/);
  assert.doesNotMatch(
    ui,
    /then sign out\?/,
    "the old hand-written copy put sign-out last",
  );
});

// --- 8. a successful clear is correctly scoped ------------------------------

test("a successful clear removes app data and keeps everything else", async () => {
  const { runDeviceClear } = await import("@/lib/sync/clear");
  setOnline(true);
  // The store singleton is dead, so the local database is recreated raw and
  // the pre-flight is injected. Ordering of the real pre-flight is proven by
  // tests 2-5.
  (await openLocalDatabase()).close();
  assert.ok(await localDatabaseExists(), "the database exists before clearing");

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
  assert.ok(!(await localDatabaseExists()), "the app database is gone");
  assert.deepEqual((await caches.keys()).sort(), [
    "other-app-v2",
    "unrelated-cache",
  ]);
  assert.equal(localStorage.getItem("bible-brain:last-read"), null);
  assert.equal(localStorage.getItem("bible-brain:something-else"), null);
  assert.equal(localStorage.getItem("unrelated"), "keep");
});

// --- 9. the order the copy promises, observed at runtime --------------------

test("nothing is destroyed until after sign-out, and destruction is verified", async () => {
  const { runDeviceClear } = await import("@/lib/sync/clear");
  setOnline(true);
  (await openLocalDatabase()).close();
  makeCaches(SEED_CACHES);
  makeStorage(SEED_STORAGE());

  const order: string[] = [];
  await runDeviceClear({
    flush: async () => {
      order.push("flush");
      assert.ok(await localDatabaseExists(), "nothing destroyed before sync");
      assert.equal(localStorage.getItem("bible-brain:last-read"), '{"book":1}');
    },
    signOut: async () => {
      order.push("sign-out");
      assert.ok(
        await localDatabaseExists(),
        "nothing destroyed before sign-out",
      );
      assert.equal(localStorage.getItem("bible-brain:last-read"), '{"book":1}');
      return { url: "/sign-in" };
    },
  });
  // Resolving is itself the proof of step 4: clearLocalStudyData re-reads
  // every surface after destroying it and throws if anything is left.
  order.push("destroyed-and-verified");

  assert.deepEqual(order, ["flush", "sign-out", "destroyed-and-verified"]);
  assert.ok(!(await localDatabaseExists()));
  assert.equal(localStorage.getItem("bible-brain:last-read"), null);
});

// --- 10. a blocked delete is UNKNOWN, not a clean failure -------------------

test("a delete blocked by another tab reports an unknown state, not a failure", async () => {
  const {
    DEVICE_CLEAR_UNKNOWN_MESSAGE,
    DEVICE_NOT_CLEARED_MESSAGE,
    DeviceClearFailure,
    DeviceClearIncompleteError,
    DeviceClearUnknownError,
    clearLocalStudyData,
    describeClearFailure,
  } = await import("@/lib/sync/clear");
  makeCaches(["bible-brain-shell-v1", "unrelated-cache"]);
  makeStorage(SEED_STORAGE());
  const blocker = await openLocalDatabase();
  try {
    const error = await failureOf(clearLocalStudyData({ deleteTimeoutMs: 100 }));
    assert.ok(
      error instanceof DeviceClearUnknownError,
      "a timeout is an unknown outcome",
    );
    assert.ok(
      !(error instanceof DeviceClearIncompleteError),
      "and must not be reported as a settled incomplete clear",
    );
    assert.equal(error.surface, "indexeddb");
    assert.deepEqual(
      error.alsoRemaining,
      [],
      "the other surfaces really were cleared",
    );

    const view = describeClearFailure(new DeviceClearFailure(true, error));
    assert.equal(view.state, "not-cleared");
    assert.equal(view.unknown, true);
    assert.equal(view.canRetry, true);
    assert.equal(view.message, DEVICE_CLEAR_UNKNOWN_MESSAGE);
    assert.notEqual(
      view.message,
      DEVICE_NOT_CLEARED_MESSAGE,
      "the unknown state does not borrow the settled-failure copy",
    );
    assert.match(view.message, /may still be completing in the background/);
    assert.match(view.message, /NOT cleared until it has been checked/);
  } finally {
    blocker.close();
  }
});

// --- 11. the retry re-reads the device instead of assuming ------------------

test("retrying after an unknown state re-verifies actual state", async () => {
  const { DeviceClearIncompleteError, clearLocalStudyData } = await import(
    "@/lib/sync/clear"
  );
  // The blocking tab from test 10 is closed now. Nothing may be assumed from
  // that: the retry has to destroy and re-read again.
  makeCaches(["bible-brain-shell-v1", "unrelated-cache"], { deletes: false });
  makeStorage(SEED_STORAGE());
  const error = await failureOf(clearLocalStudyData({ deleteTimeoutMs: 2_000 }));
  assert.ok(error instanceof DeviceClearIncompleteError);
  assert.deepEqual(
    error.remaining,
    ["caches"],
    "indexeddb is no longer reported: the re-read found it gone",
  );

  // Third attempt, same device, the cache now deletable.
  makeCaches(["bible-brain-shell-v1", "unrelated-cache"]);
  makeStorage(SEED_STORAGE());
  await clearLocalStudyData({ deleteTimeoutMs: 2_000 });
  assert.deepEqual(await caches.keys(), ["unrelated-cache"]);
  assert.ok(!(await localDatabaseExists()));
  assert.equal(localStorage.getItem("bible-brain:last-read"), null);
});
