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

/**
 * Node has no Web Locks API, so lib/sync/clear.ts's exclusive hold and
 * lib/sync/store.ts's shared writer locks need a real implementation here to
 * exercise the fix at all — without one, every test below would hit the
 * fail-closed DeviceClearCoordinationUnsupportedError path instead of the
 * coordination it exists to test.
 *
 * Requests are granted strictly in FIFO order per lock name: a shared request
 * behind a still-pending exclusive one waits for it, even if a later shared
 * request could otherwise be granted immediately — the same anti-starvation
 * behavior real browsers implement, and the property clearLocalStudyData()'s
 * fix depends on (a writer queued behind an in-progress clear must not jump
 * ahead of it just because the clear is itself waiting on something else).
 */
function createLockManager() {
  const lockStates = new Map<
    string,
    {
      sharedCount: number;
      exclusive: boolean;
      queue: { mode: "shared" | "exclusive"; grant: () => void }[];
    }
  >();

  function stateFor(name: string) {
    let state = lockStates.get(name);
    if (!state) {
      state = { sharedCount: 0, exclusive: false, queue: [] };
      lockStates.set(name, state);
    }
    return state;
  }

  function pump(name: string) {
    const state = stateFor(name);
    while (state.queue.length > 0) {
      const head = state.queue[0];
      if (head.mode === "shared") {
        if (state.exclusive) break;
        state.queue.shift();
        state.sharedCount += 1;
        head.grant();
      } else {
        if (state.exclusive || state.sharedCount > 0) break;
        state.queue.shift();
        state.exclusive = true;
        head.grant();
      }
    }
  }

  function release(name: string, mode: "shared" | "exclusive") {
    const state = stateFor(name);
    if (mode === "shared") state.sharedCount -= 1;
    else state.exclusive = false;
    pump(name);
  }

  async function request<T>(
    name: string,
    optionsOrCallback:
      | { mode?: "shared" | "exclusive"; signal?: AbortSignal }
      | (() => T | Promise<T>),
    maybeCallback?: () => T | Promise<T>,
  ): Promise<T> {
    const callback =
      typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback!;
    const options =
      typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
    const mode = options.mode ?? "exclusive";
    const signal = options.signal;
    // Browsers drop a request aborted BEFORE it is granted and ignore an abort
    // that arrives after ("the lock request is dropped if it was not already
    // granted"). clearLocalStudyData()'s acquisition bound depends on exactly
    // that asymmetry: it must be able to withdraw a still-queued request
    // without ever disturbing a hold that has already started.
    if (signal?.aborted) throw signal.reason ?? new Error("AbortError");
    const state = stateFor(name);
    await new Promise<void>((resolve, reject) => {
      const entry = { mode, grant: resolve };
      state.queue.push(entry);
      signal?.addEventListener("abort", () => {
        const index = state.queue.indexOf(entry);
        if (index === -1) return; // already granted: an abort does nothing
        state.queue.splice(index, 1);
        // Removing a queued exclusive request can unblock requests behind it.
        pump(name);
        reject(signal.reason ?? new Error("AbortError"));
      });
      pump(name);
    });
    try {
      return await callback();
    } finally {
      release(name, mode);
    }
  }

  return { request } as unknown as LockManager;
}

const sharedLockManager = createLockManager();

// node 24 exposes navigator as a configurable getter with no onLine.
function setOnline(onLine: boolean) {
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine, locks: sharedLockManager },
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

/** Open the app database as another tab would: at whatever version it is on. */
function openExistingDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("bible-brain");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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

// --- 4a. no coordination lock, no automated delete --------------------------

test("clearing refuses when this browser has no Web Locks API, instead of deleting uncoordinated", async () => {
  const {
    DeviceClearCoordinationUnsupportedError,
    DeviceClearFailure,
    clearLocalStudyData,
    describeClearFailure,
  } = await import("@/lib/sync/clear");
  makeCaches(SEED_CACHES);
  makeStorage(SEED_STORAGE());
  assert.ok(
    await localDatabaseExists(),
    "the database exists before the refused attempt",
  );

  // A browser with no navigator.locks at all - old Safari, or (as here) any
  // context this app cannot coordinate a delete safely from.
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: true },
    configurable: true,
  });
  try {
    const error = await failureOf(clearLocalStudyData());
    assert.ok(
      error instanceof DeviceClearCoordinationUnsupportedError,
      "refuses closed instead of deleting without a way to hold writers off",
    );
    await assertNothingDestroyed("no lock coordination available");

    const view = describeClearFailure(new DeviceClearFailure(true, error));
    assert.equal(view.state, "not-cleared");
    assert.equal(
      view.unknown,
      false,
      "this is a settled refusal, not an indeterminate one",
    );
    assert.equal(view.canRetry, true);
    assert.match(view.message, /Nothing was deleted/);
    assert.match(view.message, /cannot coordinate/);
  } finally {
    // Restore real coordination for every test after this one.
    setOnline(true);
  }
});

// --- 4b. the late-write TOCTOU, ending (a): silent permanent loss -----------

/**
 * The interleaving the auditors reproduced. t0 the flush drains the shared
 * queue; t1 another tab on this origin saves a note into the same `bible-brain`
 * database; t2 signOut() resolves, so that op can never sync; t3 deleteDB
 * destroys it and the flow returns {redirectTo} as if all was well.
 *
 * signOut is the injection point because in production it is a network
 * round-trip — seconds wide — and it is the only await between the queue check
 * and the destroy.
 */
test("a write saved between the sync flush and the destroy blocks the clear and is not lost", async () => {
  const store = await import("@/lib/sync/store");
  const {
    DEVICE_QUEUE_UNREADABLE_MESSAGE,
    DEVICE_UNSYNCED_NOT_CLEARED_MESSAGE,
    DeviceClearFailure,
    DeviceClearUnsyncedError,
    describeClearFailure,
    notClearedReasonFor,
    runDeviceClear,
  } = await import("@/lib/sync/clear");
  setOnline(true);
  makeCaches(SEED_CACHES);
  makeStorage(SEED_STORAGE());
  assert.equal(
    (await store.getPendingOps()).length,
    0,
    "the queue starts empty, so the real pre-flight genuinely passes",
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => syncResponse();
  let failure: unknown;
  try {
    failure = await failureOf(
      runDeviceClear({
        signOut: async () => {
          const now = isoNow();
          await store.saveLocalThread({
            slug: "saved-in-another-tab",
            title: "Saved in another tab",
            definition: "",
            seeing: "",
            createdAt: now,
            updatedAt: now,
          });
          return { url: "/sign-in" };
        },
      }),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(
    failure instanceof DeviceClearFailure,
    "the flow fails closed instead of resolving a redirect",
  );
  assert.equal(failure.signedOut, true, "the session really is gone by then");
  assert.ok(
    failure.cause instanceof DeviceClearUnsyncedError,
    "and the reason is the re-read queue, not anything the destroy found",
  );
  assert.equal(failure.cause.pending, 1);

  // Nothing was destroyed, and the write that stopped it is still here.
  await assertNothingDestroyed("late write during sign-out");
  assert.deepEqual(
    (await store.getPendingOps()).map((op) => op.entityId),
    ["saved-in-another-tab"],
    "the unsynced write survives",
  );

  const view = describeClearFailure(failure);
  assert.equal(view.state, "not-cleared");
  assert.equal(view.unknown, false, "the destroy never started, so this is settled");
  assert.equal(view.canRetry, true);
  assert.equal(view.message, DEVICE_UNSYNCED_NOT_CLEARED_MESSAGE);
  assert.match(view.message, /Nothing was deleted/);
  assert.match(view.message, /has not reached the server/);
  assert.match(view.message, /Sign in again/);
  assert.equal(notClearedReasonFor(failure), "unsynced");

  // The other way the same guard refuses: the queue could not be read at all,
  // so we do not know. It fails closed the same way but must not hand out an
  // instruction ("sign in and let it sync") that cannot help in that state.
  const unreadable = describeClearFailure(
    new DeviceClearFailure(true, new DeviceClearUnsyncedError(null)),
  );
  assert.equal(unreadable.state, "not-cleared");
  assert.equal(unreadable.unknown, false, "the destroy provably never started");
  assert.equal(unreadable.message, DEVICE_QUEUE_UNREADABLE_MESSAGE);
  assert.notEqual(
    unreadable.message,
    DEVICE_UNSYNCED_NOT_CLEARED_MESSAGE,
    "the unreadable case does not borrow the queued-writing instruction",
  );
  assert.match(unreadable.message, /Nothing was deleted/);
  assert.match(unreadable.message, /browser settings/);
  assert.doesNotMatch(unreadable.message, /Sign in again/);
});

// --- 4c. the late-write TOCTOU, ending (b): blocked, then closed ------------

/**
 * The other ending. Without the queue re-read, deleteDB is issued while an
 * unsynced write is queued; another tab blocks it; the timeout reports UNKNOWN
 * ("Close them, then check again"); the user closes that tab; the browser's
 * still-queued delete destroys the note; the re-check finds an empty device and
 * the UI renders "this device is clear".
 *
 * The fix is upstream of all of it: no deleteDB is ever issued, so there is no
 * queued delete for the tab-close to release.
 */
test("an unsynced write survives the blocked-then-closed sequence and the re-check refuses to certify", async () => {
  const store = await import("@/lib/sync/store");
  const {
    DeviceClearUnknownError,
    DeviceClearUnsyncedError,
    clearLocalStudyData,
  } = await import("@/lib/sync/clear");
  makeCaches(SEED_CACHES);
  makeStorage(SEED_STORAGE());
  assert.equal(
    (await store.getPendingOps()).length,
    1,
    "the unsynced write from the previous test is still queued",
  );

  const blocker = await openExistingDatabase();
  let error: unknown;
  try {
    error = await failureOf(clearLocalStudyData({ deleteTimeoutMs: 100 }));
  } finally {
    blocker.close();
  }
  assert.ok(
    error instanceof DeviceClearUnsyncedError,
    "the destroy is refused before deleteDB is ever issued",
  );
  assert.ok(
    !(error instanceof DeviceClearUnknownError),
    "so the outcome is not the unknown state whose copy says to close tabs and re-check",
  );

  // Closing the blocking tab therefore releases nothing.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(
    await localDatabaseExists(),
    "the database survives the blocking tab closing",
  );
  assert.equal(
    (await store.getPendingOps()).length,
    1,
    "and so does the unsynced write",
  );
  await assertNothingDestroyed("blocked then closed");

  // checkAgain() calls straight into clearLocalStudyData, so the signed-out
  // re-verify cannot reach "verified-clear" while the queue is non-empty.
  const again = await failureOf(clearLocalStudyData({ deleteTimeoutMs: 100 }));
  assert.ok(
    again instanceof DeviceClearUnsyncedError,
    "the re-check reports unsynced writing rather than certifying the device",
  );

  await store.removePendingOps((await store.getPendingOps()).map((op) => op.id));
  assert.equal((await store.getPendingOps()).length, 0);
});

// --- 4d. the exclusion, proven through a REAL writer, not the lock mock -----

/**
 * Test 11a proves the clear holds WRITE_LOCK_NAME for the real duration of the
 * delete — but it proves it by calling the lock mock directly, so it says
 * nothing about whether lib/sync/store.ts's writers actually take that lock.
 * An auditor demonstrated the hole by replacing withWriteLock's body with
 * `return run();` — bypassing the lock for every writer in the module — and the
 * whole suite still passed. That is the same shape of gap (a passing test that
 * never exercises the real interleaving) that let rounds 1 and 2 of this
 * feature ship broken.
 *
 * So this drives a REAL store mutation — saveLocalThread, the same call the
 * "another tab saved a note" tests use — against a held exclusive lock, and
 * checks the queue itself rather than a flag the mock sets. It must fail if
 * withWriteLock is ever bypassed, dropped, or takes the wrong lock name.
 *
 * It runs here, before test 5, because test 5 is the first successful clear and
 * that closes lib/sync/store.ts's module-level IndexedDB handle for the rest of
 * the process — after it, no real writer can commit anything at all.
 */
test("a real store writer cannot commit while a clear holds the write lock exclusively, and commits once it is released", async () => {
  const store = await import("@/lib/sync/store");
  setOnline(true);
  await store.removePendingOps((await store.getPendingOps()).map((op) => op.id));
  assert.equal(
    (await store.getPendingOps()).length,
    0,
    "the queue starts empty, so anything found below came from this writer",
  );

  // Stands in for clearLocalStudyData()'s hold: same lock name, same mode, held
  // open for as long as this test wants — exactly the state the real clear is
  // in while its deleteDB sits blocked.
  let releaseClear!: () => void;
  const clearReleased = new Promise<void>((resolve) => {
    releaseClear = resolve;
  });
  let clearIsHolding!: () => void;
  const clearHolding = new Promise<void>((resolve) => {
    clearIsHolding = resolve;
  });
  const hold = sharedLockManager.request(
    store.WRITE_LOCK_NAME,
    { mode: "exclusive" },
    async () => {
      clearIsHolding();
      await clearReleased;
    },
  );
  await clearHolding;

  const now = isoNow();
  let committed = false;
  const write = store
    .saveLocalThread({
      slug: "written-during-a-clear",
      title: "Written during a clear",
      definition: "",
      seeing: "",
      createdAt: now,
      updatedAt: now,
    })
    .then(() => {
      committed = true;
    });
  write.catch(() => {});

  // try/finally so that a FAILURE of this test releases the hold too: without
  // it, the assertion that catches the regression would also strand an
  // exclusive lock and every later test would fail for the wrong reason.
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      committed,
      false,
      "the real writer is shut out while the clear holds the lock — not merely the mock",
    );
    // getPendingOps takes no lock, so this reads the true state of the queue
    // from underneath the hold: the writer's transaction has not landed.
    assert.equal(
      (await store.getPendingOps()).length,
      0,
      "and nothing of its transaction reached the database",
    );
  } finally {
    releaseClear();
    await hold;
  }
  await write;
  assert.equal(committed, true, "the writer is let through once the hold ends");
  assert.deepEqual(
    (await store.getPendingOps()).map((op) => op.entityId),
    ["written-during-a-clear"],
    "and the write really commits — it was deferred, not dropped",
  );
  assert.ok(
    (await store.listLocalThreads()).some(
      (thread) => thread.slug === "written-during-a-clear",
    ),
    "the record itself is in the store, not just the queue op",
  );

  // Leave the queue as this test found it: test 5 runs the real pre-flight.
  await store.removePendingOps((await store.getPendingOps()).map((op) => op.id));
  assert.equal((await store.getPendingOps()).length, 0);
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
    // The guidance used to be a bare "Close them, then check again" — exactly
    // the action that destroyed a write in round 2 of P0UI-001, because
    // nothing then stopped a write from landing in the window that closing
    // released. WRITE_LOCK_NAME closes that window (see the 11a test below),
    // so the copy says so instead of just repeating the old instruction.
    assert.match(view.message, /will not lose any writing/);
    assert.doesNotMatch(view.message, /Close them, then check again/);
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

// --- 11a. the fix: writers cannot commit while a clear is in progress -------

/**
 * The root fix, exercised directly. Round 2 of P0UI-001 refused the destroy
 * whenever the *pending queue* held a late write, but nothing stopped a write
 * that arrived after that check while deleteDB sat blocked and queued in the
 * browser — closing the blocking tab released it, destroying the write with
 * no trace. The fix is that lib/sync/store.ts's writers take WRITE_LOCK_NAME
 * in shared mode, and clearLocalStudyData() holds it exclusively for the
 * REAL duration of the delete, not just until it stops reporting progress to
 * the caller — so a writer queued behind an in-progress clear cannot run
 * until the delete has genuinely settled, at which point there is nothing
 * left mid-flight for it to race.
 *
 * This must fail against 658cc3d/2ec3457: neither commit's clear.ts touches
 * navigator.locks at all, so nothing there would ever shut a writer out —
 * `granted` would flip `true` immediately instead of waiting on `blocker`.
 */
test("a writer using the shared write lock cannot commit while a clear holds it exclusively, and is let through only once the real delete settles", async () => {
  const store = await import("@/lib/sync/store");
  const { DeviceClearUnknownError, clearLocalStudyData } = await import(
    "@/lib/sync/clear"
  );
  makeCaches(SEED_CACHES);
  makeStorage(SEED_STORAGE());
  // The store singleton died at test 5; recreate the database raw, the same
  // way tests 8/9/10 do, rather than through the (now-dead) store API.
  (await openLocalDatabase()).close();

  // Simulates another tab's live connection: deleteDB blocks on it until it
  // closes.
  const blocker = await openExistingDatabase();

  const clearError = await failureOf(
    clearLocalStudyData({ deleteTimeoutMs: 100 }),
  );
  assert.ok(
    clearError instanceof DeviceClearUnknownError,
    "the report times out while the delete is genuinely still blocked",
  );

  // The report settled, but per the fix the coordination lock must not have:
  // a writer taking WRITE_LOCK_NAME in shared mode — exactly what every
  // lib/sync/store.ts mutation does — is still shut out, because the real
  // deleteDB() has not resolved yet.
  const locks = (globalThis as unknown as { navigator: { locks: LockManager } })
    .navigator.locks;
  let granted = false;
  const writerAttempt = locks.request(
    store.WRITE_LOCK_NAME,
    { mode: "shared" },
    async () => {
      granted = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    granted,
    false,
    "still shut out 20ms after the timed-out report: the real delete has not settled",
  );
  assert.ok(
    await localDatabaseExists(),
    "and nothing has actually been destroyed yet either — the delete is still pending, not finished",
  );

  // Unblock the real delete. Only now can the queued writer proceed.
  blocker.close();
  await writerAttempt;
  assert.equal(
    granted,
    true,
    "granted once the real delete finally settles, not before",
  );
});

// --- 11b. the retry is bounded by its OWN timeout, lock or no lock ----------

/**
 * The liveness hole the exclusive hold opened, and the reason it is not an
 * exotic one: it is the ordinary result of clearing a device with two tabs
 * open.
 *
 * Attempt 1 finds its deleteDB blocked by another connection, reports UNKNOWN
 * at deleteTimeoutMs — and keeps holding WRITE_LOCK_NAME exclusively while it
 * waits for that delete for real (test 11a is that behaviour, and it must stay
 * that way). The user then clicks "Try again and check this device", which is
 * clearLocalStudyData() a second time. Before the fix, the retry's own timeout
 * timer only started INSIDE the lock callback, so a request still queued behind
 * attempt 1 started no timer at all: the retry hung with no bound, no error and
 * no feedback for as long as the blocking tab stayed open — contradicting both
 * this module's "the CALLER is only kept waiting up to deleteTimeoutMs" and
 * DeviceSessionControls' "never a dead end".
 *
 * The bound now covers acquisition as well as the delete, so a caller always
 * gets an answer. It is a DISTINCT answer: nothing about this device changed,
 * a previous attempt is simply still finishing, and the generic unknown copy
 * ("close other tabs, then check again") is the wrong instruction for that.
 */
test("a retry issued while a prior attempt's delete is still blocked is answered within its own timeout instead of hanging on the lock", async () => {
  const store = await import("@/lib/sync/store");
  const {
    DEVICE_CLEAR_BUSY_MESSAGE,
    DEVICE_CLEAR_UNKNOWN_MESSAGE,
    DeviceClearBusyError,
    DeviceClearFailure,
    DeviceClearUnknownError,
    clearLocalStudyData,
    describeClearFailure,
    notClearedReasonFor,
  } = await import("@/lib/sync/clear");
  makeCaches(SEED_CACHES);
  makeStorage(SEED_STORAGE());
  (await openLocalDatabase()).close();

  // Another tab's live connection. deleteDB blocks on it and stays blocked for
  // as long as it is open — the real, ordinary two-tab case.
  const blocker = await openExistingDatabase();
  let settled: unknown;
  let waited = 0;
  try {
    const first = await failureOf(clearLocalStudyData({ deleteTimeoutMs: 100 }));
    assert.ok(
      first instanceof DeviceClearUnknownError,
      "attempt 1 reports unknown at its bound while its delete is genuinely still blocked",
    );

    // Attempt 1 has answered its caller but still holds the lock (it awaits the
    // real deleteDB before returning — test 11a). This is checkAgain(), issued
    // into exactly that state.
    const startedAt = Date.now();
    const retry = clearLocalStudyData({ deleteTimeoutMs: 100 });
    retry.catch(() => {});
    settled = await Promise.race([
      retry.then(
        () => "resolved" as const,
        (error: unknown) => error,
      ),
      new Promise((resolve) =>
        setTimeout(() => resolve("still-pending" as const), 2_000),
      ),
    ]);
    waited = Date.now() - startedAt;
  } finally {
    blocker.close();
  }

  assert.notEqual(
    settled,
    "still-pending",
    "the retry must honour its own deleteTimeoutMs even when the wait is for the lock, not the delete",
  );
  assert.ok(
    waited < 2_000,
    `the caller was answered in ${waited}ms, inside its own bound`,
  );
  assert.ok(
    settled instanceof DeviceClearBusyError,
    "and the answer names the real reason: a previous attempt is still finishing",
  );
  assert.ok(
    !(settled instanceof DeviceClearUnknownError),
    "which is not the same fact as a delete that timed out under this call",
  );

  const view = describeClearFailure(new DeviceClearFailure(true, settled));
  assert.equal(view.state, "not-cleared");
  assert.equal(view.canRetry, true);
  assert.equal(view.message, DEVICE_CLEAR_BUSY_MESSAGE);
  assert.notEqual(
    view.message,
    DEVICE_CLEAR_UNKNOWN_MESSAGE,
    "the busy state does not borrow the unknown state's close-your-tabs instruction",
  );
  assert.match(view.message, /try again in a moment/i);
  assert.equal(notClearedReasonFor(new DeviceClearFailure(true, settled)), "busy");

  // The retry never got the lock, so it destroyed nothing itself; attempt 1's
  // delete completes now that its blocking connection is closed.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(
    !(await localDatabaseExists()),
    "attempt 1's delete finishes once the blocking tab closes",
  );

  // And the withdrawn retry left no hold behind: a writer gets the lock at once.
  let writerGranted = false;
  await Promise.race([
    sharedLockManager.request(
      store.WRITE_LOCK_NAME,
      { mode: "shared" },
      async () => {
        writerGranted = true;
      },
    ),
    new Promise((resolve) => setTimeout(resolve, 500)),
  ]);
  assert.equal(
    writerGranted,
    true,
    "the timed-out attempt does not leave writers queued behind a dead request",
  );
});

// --- 12. the shared-device warning outlives the page it was raised on -------

test("the not-cleared warning is persisted under the swept prefix and retracted by a successful clear", async () => {
  const {
    DEVICE_CLEAR_UNKNOWN_MESSAGE,
    DEVICE_NOT_CLEARED_KEY,
    DEVICE_NOT_CLEARED_MESSAGE,
    DEVICE_UNSYNCED_NOT_CLEARED_MESSAGE,
    LOCAL_KEY_PREFIX,
    clearLocalStudyData,
    forgetDeviceNotCleared,
    messageForNotClearedReason,
    readDeviceNotCleared,
    readDeviceNotClearedOnServer,
    rememberDeviceNotCleared,
    subscribeDeviceNotCleared,
  } = await import("@/lib/sync/clear");

  const storage = makeStorage(SEED_STORAGE());
  assert.equal(readDeviceNotCleared(), null);
  assert.equal(readDeviceNotClearedOnServer(), null, "no flag on the server");

  // A mounted warning is told when the flag changes, including by this tab —
  // a same-window localStorage write raises no `storage` event.
  let notifications = 0;
  const unsubscribe = subscribeDeviceNotCleared(() => {
    notifications += 1;
  });

  // It lives in localStorage, so it outlives the React state that used to be
  // the only record of it: a reload reads exactly this back.
  rememberDeviceNotCleared("incomplete");
  assert.equal(storage.getItem(DEVICE_NOT_CLEARED_KEY), "incomplete");
  assert.equal(readDeviceNotCleared(), "incomplete");
  assert.equal(notifications, 1, "the subscriber was told");

  // The stored value is a fixed reason word, never anything the user wrote, and
  // it sits under the prefix this module's own sweep deletes.
  assert.ok(
    DEVICE_NOT_CLEARED_KEY.startsWith(LOCAL_KEY_PREFIX),
    "a successful clear owns the key",
  );
  assert.deepEqual(
    (["unknown", "incomplete", "unsynced"] as const).map(
      messageForNotClearedReason,
    ),
    [
      DEVICE_CLEAR_UNKNOWN_MESSAGE,
      DEVICE_NOT_CLEARED_MESSAGE,
      DEVICE_UNSYNCED_NOT_CLEARED_MESSAGE,
    ],
    "each reason maps to the copy already tested elsewhere",
  );

  // Garbage in storage is not a warning.
  storage.setItem(DEVICE_NOT_CLEARED_KEY, "something-else");
  assert.equal(readDeviceNotCleared(), null);
  rememberDeviceNotCleared("unknown");
  assert.equal(readDeviceNotCleared(), "unknown");

  // And a clear that actually succeeds retracts it, because the sweep runs
  // over the prefix and the flag is only ever written after destruction.
  makeCaches(["bible-brain-shell-v1", "unrelated-cache"]);
  (await openLocalDatabase()).close();
  const before = notifications;
  await clearLocalStudyData({ deleteTimeoutMs: 2_000 });
  assert.equal(
    storage.getItem(DEVICE_NOT_CLEARED_KEY),
    null,
    "a verified clear removes the warning",
  );
  assert.equal(readDeviceNotCleared(), null);
  assert.ok(
    notifications > before,
    "and the sweep tells any mounted warning it is no longer backed",
  );

  forgetDeviceNotCleared();
  assert.equal(readDeviceNotCleared(), null);

  unsubscribe();
  const settled = notifications;
  rememberDeviceNotCleared("unsynced");
  assert.equal(notifications, settled, "unsubscribing really detaches");
  forgetDeviceNotCleared();
  assert.equal(readDeviceNotCleared(), null);
});

test("the component persists the warning after a destroy attempt and retracts it on success", () => {
  const src = fs.readFileSync(
    path.join(root, "components/auth/DeviceSessionControls.tsx"),
    "utf8",
  );
  // Subscribed, not read once into React state: the flag is external state, so
  // a reload surfaces it and a change (this tab's or another's) updates it.
  assert.match(src, /useSyncExternalStore\(\s*subscribeDeviceNotCleared,\s*readDeviceNotCleared,\s*readDeviceNotClearedOnServer,?\s*\)/);
  assert.match(src, /DEVICE_RESIDUE_MESSAGE/);
  assert.doesNotMatch(
    src,
    /useState<DeviceNotClearedReason/,
    "in-memory-only React state was the defect",
  );

  // Ordering: every write happens after a destroy attempt has already run its
  // localStorage sweep, or the flag would delete itself.
  const writes = [...src.matchAll(/rememberDeviceNotCleared\(reason\)/g)];
  assert.equal(writes.length, 2, "one per failure branch");
  const destroyCalls = [
    src.indexOf("await runDeviceClear({"),
    src.indexOf("await clearLocalStudyData()"),
  ];
  for (const write of writes) {
    assert.ok(
      destroyCalls.some((at) => at > -1 && at < (write.index ?? 0)),
      "the flag is written only after a destroy attempt has run",
    );
  }
  assert.match(src, /forgetDeviceNotCleared\(\)/);

  // The recovered banner carries no destructive one-click action of its own.
  const banner = src.indexOf("{residue ?");
  assert.ok(banner > -1, "the recovered warning is rendered");
  const bannerEnd = src.indexOf(") : null}", banner);
  assert.doesNotMatch(src.slice(banner, bannerEnd), /<button/);
});

// --- 13. small guards on the destroy path -----------------------------------

test("a late delete rejection cannot become an unhandled rejection", async () => {
  const lib = fs.readFileSync(path.join(root, "lib/sync/clear.ts"), "utf8");
  const destruction = lib.slice(
    lib.indexOf("export async function clearLocalStudyData"),
  );
  assert.match(
    destruction,
    /deletion\.catch\(\(\) => \{\}\)/,
    "the delete promise carries its own rejection handler",
  );
  assert.ok(
    destruction.indexOf("deletion.catch(() => {})") <
      destruction.indexOf("await Promise.race("),
    "attached before the race, so the handler exists for the whole window",
  );

  // And the shape really does swallow a rejection arriving after the timeout
  // has already won.
  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown) => void seen.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const deletion = new Promise<boolean>((_resolve, reject) => {
      setTimeout(() => reject(new Error("late delete failure")), 20);
    });
    deletion.catch(() => {});
    const timedOut = await Promise.race([
      deletion,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 5)),
    ]);
    assert.equal(timedOut, true, "the timeout wins the race");
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(seen, [], "and the late rejection is swallowed");
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("the destroy path carries each piece of guidance exactly once", () => {
  const lib = fs.readFileSync(path.join(root, "lib/sync/clear.ts"), "utf8");
  assert.equal(
    (
      lib.match(
        /Unknown, not failed: the delete request outlives this race\./g,
      ) ?? []
    ).length,
    1,
    "the duplicated comment line is gone",
  );
});
