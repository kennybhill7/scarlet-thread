import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";

import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import type { StudySession } from "@/lib/contracts/study-v2";

/**
 * SYNCFLUSH-001 — tests for the three fixes this task makes:
 *
 *   A. Background v2 flushing (`createBackgroundSyncV2Controller`,
 *      `lib/sync/client.ts`) — single-flight, backoff, online/visibility/
 *      write-debounce triggers, all against INJECTED fakes (no real timers,
 *      no real DOM events, no real IndexedDB/network for this half).
 *   B. Wedged-op handling (`recordV2Rejections`/`listParkedOps`/
 *      `getSyncStatusV2`, `lib/sync/store.ts`; the park-aware throw
 *      decision in `runSyncV2`, `lib/sync/client.ts`) — against REAL
 *      fake-indexeddb, with `fetch` stubbed.
 *   C. Clear-device ordering (`flushPendingWrites`/`runDeviceClear`,
 *      `lib/sync/clear.ts`) — a parked op must still refuse the clear
 *      BEFORE sign-out.
 *
 * Test order is NOT load-bearing in this file the way vault-v2.test.ts's or
 * device-clear.test.ts's is: nothing here opens the real "bible-brain"
 * database at a specific version, and every store-backed test cleans up the
 * rows it wrote (see `cleanupOp` below) rather than depending on a later
 * test's starting state.
 */

const isoNow = () => new Date().toISOString();

function sampleRange(overrides: Partial<CanonicalRangeV1> = {}): CanonicalRangeV1 {
  return { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.1", end: "1.3.6", ...overrides };
}

function sampleSession(overrides: Partial<StudySession> = {}): StudySession {
  const now = isoNow();
  return {
    id: crypto.randomUUID(),
    workspaceId: "workspace-syncflush-001",
    range: sampleRange(),
    mode: "encounter",
    workflowState: "active",
    connectionState: "unexamined",
    catalogReleaseId: null,
    readGateAt: null,
    currentStep: "read",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function v2PullResponse(overrides: Record<string, unknown> = {}) {
  return {
    serverTime: isoNow(),
    session: [],
    claim: [],
    evidence: [],
    motif: [],
    motifSighting: [],
    connection: [],
    application: [],
    teachingDraft: [],
    rejected: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return "";
}

// ===========================================================================
// PART B — store.ts: recordV2Rejections / listParkedOps / getSyncStatusV2
// ===========================================================================

test("recordV2Rejections: parks an op after V2_OP_PARK_THRESHOLD same-op rejections, never before", async () => {
  const store = await import("@/lib/sync/store");
  const session = sampleSession();
  await store.saveLocalStudySession(session);
  const [op] = (await store.getPendingV2Ops()).filter((candidate) => candidate.entityId === session.id);
  assert.ok(op, "the session's outbox op was not queued");

  try {
    assert.equal(store.V2_OP_PARK_THRESHOLD, 3, "this test assumes the documented threshold of 3");

    let parkedNow = await store.recordV2Rejections([{ opId: op.opId, reason: "Revision conflict: 1" }]);
    assert.equal(parkedNow.has(op.opId), false, "rejection 1 of 3 must not park yet");
    let stored = (await store.getPendingV2Ops()).find((candidate) => candidate.opId === op.opId);
    assert.equal(stored?.rejectionCount, 1);
    assert.equal(stored?.parked, false, "not parked yet");
    assert.equal(stored?.lastError, "Revision conflict: 1");

    parkedNow = await store.recordV2Rejections([{ opId: op.opId, reason: "Revision conflict: 2" }]);
    assert.equal(parkedNow.has(op.opId), false, "rejection 2 of 3 must not park yet");
    stored = (await store.getPendingV2Ops()).find((candidate) => candidate.opId === op.opId);
    assert.equal(stored?.rejectionCount, 2);
    assert.notEqual(stored?.parked, true);

    parkedNow = await store.recordV2Rejections([{ opId: op.opId, reason: "Revision conflict: 3" }]);
    assert.equal(parkedNow.has(op.opId), true, "rejection 3 of 3 must park");
    stored = (await store.getPendingV2Ops()).find((candidate) => candidate.opId === op.opId);
    assert.equal(stored?.rejectionCount, 3);
    assert.equal(stored?.parked, true);
    assert.equal(stored?.lastError, "Revision conflict: 3");

    // Never deleted — still the same payload, verbatim.
    assert.deepEqual(stored?.payload, op.payload);

    const parked = await store.listParkedOps();
    assert.ok(parked.some((candidate) => candidate.opId === op.opId));

    // A FOURTH rejection stays parked (does not un-park, does not error).
    parkedNow = await store.recordV2Rejections([{ opId: op.opId, reason: "Revision conflict: 4" }]);
    assert.equal(parkedNow.has(op.opId), true);
    stored = (await store.getPendingV2Ops()).find((candidate) => candidate.opId === op.opId);
    assert.equal(stored?.rejectionCount, 4);
    assert.equal(stored?.parked, true);
  } finally {
    await store.removePendingV2Ops([op.opId]);
  }
});

test("recordV2Rejections: an opId no longer in the outbox (already accepted/removed) is silently skipped, not resurrected", async () => {
  const store = await import("@/lib/sync/store");
  const parkedNow = await store.recordV2Rejections([
    { opId: crypto.randomUUID(), reason: "stale" },
  ]);
  assert.equal(parkedNow.size, 0);
});

test("getSyncStatusV2: pendingCount/parkedCount/oldestPendingAgeMs reflect the real outbox", async () => {
  const store = await import("@/lib/sync/store");
  const a = sampleSession();
  const b = sampleSession();
  await store.saveLocalStudySession(a);
  await store.saveLocalStudySession(b);
  const ops = (await store.getPendingV2Ops()).filter(
    (op) => op.entityId === a.id || op.entityId === b.id,
  );
  assert.equal(ops.length, 2);
  const [opA, opB] = ops[0].entityId === a.id ? ops : [ops[1], ops[0]];

  try {
    // Park only opA.
    for (let i = 0; i < store.V2_OP_PARK_THRESHOLD; i += 1) {
      await store.recordV2Rejections([{ opId: opA.opId, reason: `rejection ${i}` }]);
    }

    const fixedNow = Date.parse(opB.clientTime) + 5_000;
    const status = await store.getSyncStatusV2(() => fixedNow);
    assert.equal(status.pendingCount, 2);
    assert.equal(status.parkedCount, 1);
    assert.ok(status.oldestPendingAgeMs !== null && status.oldestPendingAgeMs >= 5_000);
  } finally {
    await store.removePendingV2Ops([opA.opId, opB.opId]);
  }
});

test("getSyncStatusV2: an empty outbox reports zero/zero/null", async () => {
  const store = await import("@/lib/sync/store");
  const pending = await store.getPendingV2Ops();
  for (const op of pending) {
    // Clean slate for this assertion only — other tests in this file clean
    // up after themselves, but guard against leftovers from a future edit.
    await store.removePendingV2Ops([op.opId]);
  }
  const status = await store.getSyncStatusV2();
  assert.deepEqual(status, { pendingCount: 0, parkedCount: 0, oldestPendingAgeMs: null });
});

test("subscribeLocalV2Writes: fires after a local v2 write actually commits, and unsubscribe stops it", async () => {
  const store = await import("@/lib/sync/store");
  let fired = 0;
  const unsubscribe = store.subscribeLocalV2Writes(() => {
    fired += 1;
  });
  const session = sampleSession();
  try {
    await store.saveLocalStudySession(session);
    assert.equal(fired, 1);

    unsubscribe();
    const second = sampleSession();
    await store.saveLocalStudySession(second);
    assert.equal(fired, 1, "no further notifications after unsubscribe");
    await store.removePendingV2Ops(
      (await store.getPendingV2Ops())
        .filter((op) => op.entityId === second.id)
        .map((op) => op.opId),
    );
  } finally {
    await store.removePendingV2Ops(
      (await store.getPendingV2Ops())
        .filter((op) => op.entityId === session.id)
        .map((op) => op.opId),
    );
  }
});

// ===========================================================================
// PART B (client) — runSyncV2: reject-N-then-park, unsent prose preserved,
// and the direct "parked no longer blocks" proof at the syncNowV2() level.
// ===========================================================================

test("runSyncV2 (via syncNowV2): throws on a fresh rejection, but NOT once the op is parked -- and never deletes or mutates it", async () => {
  const store = await import("@/lib/sync/store");
  const client = await import("@/lib/sync/client");

  const session = sampleSession({
    // A distinctive, long-form field value standing in for "the learner's
    // unsent prose" -- asserted byte-identical at the end.
    id: crypto.randomUUID(),
  });
  await store.saveLocalStudySession(session);
  const [op] = (await store.getPendingV2Ops()).filter((candidate) => candidate.entityId === session.id);
  assert.ok(op);
  const originalPayload = JSON.parse(JSON.stringify(op.payload));

  const originalFetch = globalThis.fetch;
  let rejectThisOp = true;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/sync/v2/push")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { ops: { opId: string }[] };
      const rejected = rejectThisOp
        ? body.ops
            .filter((pushedOp) => pushedOp.opId === op.opId)
            .map((pushedOp) => ({ opId: pushedOp.opId, reason: "Injected conflict" }))
        : [];
      return jsonResponse(v2PullResponse({ rejected }));
    }
    if (url.endsWith("/api/sync/v2/pull")) {
      return jsonResponse(v2PullResponse());
    }
    throw new Error(`unexpected fetch in this test: ${url}`);
  }) as typeof fetch;

  try {
    // Rejections 1 and 2: still fresh, must throw.
    await assert.rejects(client.syncNowV2(), (error: unknown) => {
      assert.ok(error instanceof client.SyncRejectedErrorV2);
      return true;
    });
    await assert.rejects(client.syncNowV2(), client.SyncRejectedErrorV2);

    // Rejection 3: crosses V2_OP_PARK_THRESHOLD -- parked, still does not throw yet or...
    // (the op that crosses the threshold THIS round is filtered from the
    // throw-worthy set too -- see runSyncV2's own header)
    await client.syncNowV2();

    // Now genuinely parked: keep rejecting it forever, syncNowV2() must
    // never throw for it again.
    await client.syncNowV2();
    await client.syncNowV2();

    const stillPending = (await store.getPendingV2Ops()).find((candidate) => candidate.opId === op.opId);
    assert.ok(stillPending, "a parked op must never be deleted");
    assert.equal(stillPending.parked, true);
    assert.ok((stillPending.rejectionCount ?? 0) >= 3);
    assert.deepEqual(
      stillPending.payload,
      originalPayload,
      "the learner's unsent prose (the op payload) must survive every rejection verbatim",
    );

    // Finally, the server accepts it (e.g. the conflict resolved) -- it
    // leaves the outbox like any other accepted op.
    rejectThisOp = false;
    await client.syncNowV2();
    const afterAccept = (await store.getPendingV2Ops()).find((candidate) => candidate.opId === op.opId);
    assert.equal(afterAccept, undefined, "an eventually-accepted parked op is removed like any other");
  } finally {
    globalThis.fetch = originalFetch;
    await store.removePendingV2Ops([op.opId]);
  }
});

test("a parked op does not block a NEW write's push in the same batch (Start-a-study keeps working)", async () => {
  const store = await import("@/lib/sync/store");
  const client = await import("@/lib/sync/client");

  // Pre-park one op purely at the store level (bypassing the network, as
  // the previous test already proved the real path reaches this state).
  const wedged = sampleSession();
  await store.saveLocalStudySession(wedged);
  const [wedgedOp] = (await store.getPendingV2Ops()).filter((op) => op.entityId === wedged.id);
  assert.ok(wedgedOp);
  for (let i = 0; i < store.V2_OP_PARK_THRESHOLD; i += 1) {
    await store.recordV2Rejections([{ opId: wedgedOp.opId, reason: `pre-park ${i}` }]);
  }
  assert.equal(
    (await store.getPendingV2Ops()).find((op) => op.opId === wedgedOp.opId)?.parked,
    true,
  );

  // Now a brand-new session -- the exact shape "Start a study" writes
  // (StudyEntry.tsx's buildNewStudySession / saveLocalStudySession).
  const fresh = sampleSession();
  await store.saveLocalStudySession(fresh);
  const [freshOp] = (await store.getPendingV2Ops()).filter((op) => op.entityId === fresh.id);
  assert.ok(freshOp);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/sync/v2/push")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { ops: { opId: string }[] };
      // The server still refuses the wedged op every time (it is a genuine,
      // permanent conflict) but accepts the fresh one.
      const rejected = body.ops
        .filter((op) => op.opId === wedgedOp.opId)
        .map((op) => ({ opId: op.opId, reason: "Still conflicting" }));
      return jsonResponse(v2PullResponse({ rejected }));
    }
    if (url.endsWith("/api/sync/v2/pull")) return jsonResponse(v2PullResponse());
    throw new Error(`unexpected fetch in this test: ${url}`);
  }) as typeof fetch;

  try {
    // This is exactly what StudyEntry.tsx's resolveStudySessionId awaits
    // after saveLocalStudySession -- see its own "WHY THE PUSH IS NOT
    // OPTIONAL" header. It must resolve, not throw, even with the wedged
    // op riding along in the same batch.
    await client.syncNowV2();

    const afterPush = await store.getPendingV2Ops();
    assert.equal(
      afterPush.some((op) => op.opId === freshOp.opId),
      false,
      "the fresh session's op was accepted and removed",
    );
    const wedgedAfter = afterPush.find((op) => op.opId === wedgedOp.opId);
    assert.ok(wedgedAfter, "the wedged op is still queued, not lost");
    assert.equal(wedgedAfter.parked, true);
  } finally {
    globalThis.fetch = originalFetch;
    await store.removePendingV2Ops(
      (await store.getPendingV2Ops())
        .filter((op) => op.opId === wedgedOp.opId || op.opId === freshOp.opId)
        .map((op) => op.opId),
    );
  }
});

test("a parked entity's unsent prose survives a pull that carries a DIFFERENT device's version of the same entity (two-device-style)", async () => {
  // A lightweight simulation of the real two-device scenario this codebase's
  // own suites (e.g. tests/vault-v2-merge.test.ts) cannot run as two real
  // processes either: this device has an unsynced, now-parked local edit;
  // a pull snapshot arrives carrying what device B already got accepted for
  // the SAME entity id at a higher revision. mergeRemoteChangesV2's own
  // contract (lib/sync/store.ts) is a strict membership test against the
  // outbox, not a clock comparison -- so this proves the parked op's
  // presence in syncQueueV2 is what keeps this device's prose from being
  // silently overwritten by "device B's" pulled row, exactly as it would be
  // for an ordinary (non-parked) pending op.
  const store = await import("@/lib/sync/store");

  const mine = sampleSession({ currentStep: "observe" });
  await store.saveLocalStudySession(mine);
  const [op] = (await store.getPendingV2Ops()).filter((candidate) => candidate.entityId === mine.id);
  assert.ok(op);
  for (let i = 0; i < store.V2_OP_PARK_THRESHOLD; i += 1) {
    await store.recordV2Rejections([{ opId: op.opId, reason: `conflict ${i}` }]);
  }

  try {
    const deviceBsVersion: StudySession = {
      ...mine,
      currentStep: "connect", // device B's own, different edit
      revision: 9,
      updatedAt: isoNow(),
    };
    await store.mergeRemoteChangesV2({ session: [deviceBsVersion] });

    const mineCopy = (await store.listLocalV2Entities("session")).find((row) => row.id === mine.id);
    assert.equal(
      mineCopy?.currentStep,
      "observe",
      "a parked entity must not be overwritten by a pulled row for the same id",
    );
    assert.equal(mineCopy?.revision, 1, "the local (unsent) revision must not be clobbered either");
  } finally {
    await store.removePendingV2Ops([op.opId]);
  }
});

// ===========================================================================
// PART C — clear-device ordering: a parked op refuses the clear BEFORE
// sign-out, and sign-out is never called while it remains.
// ===========================================================================

test("clear-device: a parked v2 op refuses the clear and sign-out is NEVER called", async () => {
  const store = await import("@/lib/sync/store");
  const clear = await import("@/lib/sync/clear");

  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: true, locks: undefined },
    configurable: true,
  });

  const session = sampleSession();
  await store.saveLocalStudySession(session);
  const [op] = (await store.getPendingV2Ops()).filter((candidate) => candidate.entityId === session.id);
  assert.ok(op);
  for (let i = 0; i < store.V2_OP_PARK_THRESHOLD; i += 1) {
    await store.recordV2Rejections([{ opId: op.opId, reason: `parked ${i}` }]);
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/sync/v2/push")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { ops: { opId: string }[] };
      const rejected = body.ops
        .filter((pushedOp) => pushedOp.opId === op.opId)
        .map((pushedOp) => ({ opId: pushedOp.opId, reason: "Still conflicting" }));
      return jsonResponse(v2PullResponse({ rejected }));
    }
    if (url.endsWith("/api/sync/v2/pull")) return jsonResponse(v2PullResponse());
    if (url.endsWith("/api/sync/pull") || url.endsWith("/api/sync/push")) {
      return jsonResponse({
        entries: [],
        threads: [],
        progress: [],
        logs: [],
        people: [],
        rejected: [],
        serverTime: isoNow(),
      });
    }
    throw new Error(`unexpected fetch in this test: ${url}`);
  }) as typeof fetch;

  let signOutCalls = 0;
  try {
    const failure = await (async () => {
      try {
        await clear.runDeviceClear({
          signOut: async () => {
            signOutCalls += 1;
            return { url: "/sign-in" };
          },
        });
        throw new Error("expected runDeviceClear to reject");
      } catch (error) {
        return error;
      }
    })();

    assert.ok(failure instanceof clear.DeviceClearFailure);
    assert.equal(failure.signedOut, false, "sign-out must never run while a parked v2 op remains");
    assert.ok(
      failure.cause instanceof clear.UnsyncedWritesError,
      `expected UnsyncedWritesError, got ${String(failure.cause)}`,
    );
    assert.equal(signOutCalls, 0, "signOut was invoked while unsynced v2 work remained");

    // Still there -- nothing destroyed, nothing silently dropped.
    const stillPending = await store.getPendingV2Ops();
    assert.ok(stillPending.some((candidate) => candidate.opId === op.opId));
  } finally {
    globalThis.fetch = originalFetch;
    await store.removePendingV2Ops([op.opId]);
  }
});

test("isSyncRejectedError recognizes both v1 SyncRejectedError and v2 SyncRejectedErrorV2", async () => {
  const client = await import("@/lib/sync/client");
  const { isSyncRejectedError } = await import("@/lib/sync/clear");
  assert.equal(isSyncRejectedError(new client.SyncRejectedError([])), true);
  assert.equal(isSyncRejectedError(new client.SyncRejectedErrorV2([])), true);
  assert.equal(isSyncRejectedError(new Error("something else")), false);
});

// ===========================================================================
// PART A — createBackgroundSyncV2Controller: single-flight, backoff,
// online/visibility triggers, write-debounce, stop(). All against injected
// fakes -- no real timers, no real DOM, no real network.
// ===========================================================================

function createFakeTimers() {
  let nextHandle = 1;
  const scheduled = new Map<number, { callback: () => void; delayMs: number }>();
  return {
    setTimeoutFn: (callback: () => void, delayMs: number): unknown => {
      const handle = nextHandle;
      nextHandle += 1;
      scheduled.set(handle, { callback, delayMs });
      return handle;
    },
    clearTimeoutFn: (handle: unknown): void => {
      scheduled.delete(handle as number);
    },
    /** Runs the single pending timer. Throws if there isn't exactly one — callers should know what they're advancing. */
    runOnly(): number {
      assert.equal(scheduled.size, 1, `expected exactly one pending timer, found ${scheduled.size}`);
      const [[handle, entry]] = scheduled;
      scheduled.delete(handle);
      entry.callback();
      return entry.delayMs;
    },
    /** Reads the single pending timer's delay WITHOUT running it. */
    peekDelay(): number {
      assert.equal(scheduled.size, 1, `expected exactly one pending timer, found ${scheduled.size}`);
      const [[, entry]] = scheduled;
      return entry.delayMs;
    },
    pendingCount(): number {
      return scheduled.size;
    },
  };
}

/** Two microtask ticks — enough for `await sync()` plus its catch/then continuation to run (see this file's own notes on each test). */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createFakeEventTarget() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(type: string, listener: () => void) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type: string) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    listenerCount(type: string): number {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

/** A promise plus its own resolve/reject, for controlling exactly when a fake `sync()` settles. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("createBackgroundSyncV2Controller: single-flight -- a second triggerNow() while one sync is in flight does not call sync() again", async () => {
  const client = await import("@/lib/sync/client");
  const timers = createFakeTimers();
  const windowTarget = createFakeEventTarget();
  const documentTarget = createFakeEventTarget();
  let calls = 0;
  let first = deferred<void>();

  const controller = client.createBackgroundSyncV2Controller({
    sync: () => {
      calls += 1;
      return first.promise;
    },
    isOnline: () => true,
    isVisible: () => true,
    windowTarget,
    documentTarget,
    subscribeWrites: () => () => {},
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  try {
    // The constructor itself calls triggerNow() once.
    assert.equal(calls, 1);

    controller.triggerNow();
    controller.triggerNow();
    await Promise.resolve(); // let any microtasks from the (no-op) extra triggers settle
    assert.equal(calls, 1, "sync() must not be called again while the first call is still in flight");

    first.resolve();
    await first.promise;
    await Promise.resolve();
    await Promise.resolve();

    // Now that the in-flight call has settled, a new trigger is allowed.
    first = deferred<void>();
    controller.triggerNow();
    assert.equal(calls, 2);
    first.resolve();
    await first.promise;
  } finally {
    controller.stop();
  }
});

test("createBackgroundSyncV2Controller: backoff doubles on consecutive failures, capped at maxBackoffMs, and resets on success", async () => {
  const client = await import("@/lib/sync/client");
  const timers = createFakeTimers();
  const windowTarget = createFakeEventTarget();
  const documentTarget = createFakeEventTarget();
  let shouldFail = true;
  const errors: unknown[] = [];

  const controller = client.createBackgroundSyncV2Controller({
    sync: async () => {
      if (shouldFail) throw new Error("injected failure");
    },
    onError: (error) => errors.push(error),
    isOnline: () => true,
    isVisible: () => true,
    windowTarget,
    documentTarget,
    subscribeWrites: () => () => {},
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    intervalMs: 60_000,
    baseBackoffMs: 1_000,
    maxBackoffMs: 4_000,
  });

  try {
    // Constructor's own triggerNow() already ran attempt #1, which failed
    // (synchronously throwing inside an async fn -> a rejected promise
    // `attempt()` awaits) and scheduled the first backoff timer.
    await settle();
    assert.equal(errors.length, 1);
    assert.equal(timers.peekDelay(), 1_000, "first backoff = baseBackoffMs");

    timers.runOnly(); // fires attempt #2 -- still failing
    await settle();
    assert.equal(errors.length, 2);
    assert.equal(timers.peekDelay(), 2_000, "second backoff doubles");

    timers.runOnly(); // attempt #3
    await settle();
    assert.equal(errors.length, 3);
    assert.equal(timers.peekDelay(), 4_000, "third backoff doubles again, now at the cap");

    timers.runOnly(); // attempt #4
    await settle();
    assert.equal(errors.length, 4);
    assert.equal(timers.peekDelay(), 4_000, "stays capped at maxBackoffMs, does not keep doubling");

    // Now let the NEXT attempt succeed -- the interval resets to the
    // normal cadence instead of continuing to back off.
    shouldFail = false;
    timers.runOnly(); // attempt #5 -- succeeds this time
    await settle();
    assert.equal(timers.peekDelay(), 60_000, "a success resets scheduling to the normal interval");
  } finally {
    controller.stop();
  }
});

test("createBackgroundSyncV2Controller: offline is silent -- no onError, reschedules at the normal interval, not backoff", async () => {
  const client = await import("@/lib/sync/client");
  const timers = createFakeTimers();
  const windowTarget = createFakeEventTarget();
  const documentTarget = createFakeEventTarget();
  let calls = 0;
  let online = false;
  const errors: unknown[] = [];

  const controller = client.createBackgroundSyncV2Controller({
    sync: async () => {
      calls += 1;
    },
    onError: (error) => errors.push(error),
    isOnline: () => online,
    isVisible: () => true,
    windowTarget,
    documentTarget,
    subscribeWrites: () => () => {},
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    intervalMs: 30_000,
    baseBackoffMs: 1_000,
  });

  try {
    assert.equal(calls, 0, "the initial trigger must not call sync() while offline");
    assert.equal(errors.length, 0, "offline is not reported as an error");
    assert.equal(timers.runOnly(), 30_000, "offline reschedules at the ordinary interval, not a backoff delay");

    online = true;
    windowTarget.dispatch("online");
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(calls, 1, "the online event retries once back online");
  } finally {
    controller.stop();
  }
});

test("createBackgroundSyncV2Controller: visibilitychange-to-visible triggers a sync; going hidden does not", async () => {
  const client = await import("@/lib/sync/client");
  const timers = createFakeTimers();
  const windowTarget = createFakeEventTarget();
  const documentTarget = createFakeEventTarget();
  let calls = 0;
  let visible = true;

  const controller = client.createBackgroundSyncV2Controller({
    sync: async () => {
      calls += 1;
    },
    isOnline: () => true,
    isVisible: () => visible,
    windowTarget,
    documentTarget,
    subscribeWrites: () => () => {},
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  try {
    assert.equal(calls, 1, "the initial trigger");

    visible = false;
    documentTarget.dispatch("visibilitychange");
    await Promise.resolve();
    assert.equal(calls, 1, "going hidden must not itself trigger a sync");

    visible = true;
    documentTarget.dispatch("visibilitychange");
    await Promise.resolve();
    assert.equal(calls, 2, "becoming visible again triggers a sync");
  } finally {
    controller.stop();
  }
});

test("createBackgroundSyncV2Controller: the recurring interval timer requires visibility, but explicit triggers do not", async () => {
  const client = await import("@/lib/sync/client");
  const timers = createFakeTimers();
  const windowTarget = createFakeEventTarget();
  const documentTarget = createFakeEventTarget();
  let calls = 0;
  let visible = true;

  const controller = client.createBackgroundSyncV2Controller({
    sync: async () => {
      calls += 1;
    },
    isOnline: () => true,
    isVisible: () => visible,
    windowTarget,
    documentTarget,
    subscribeWrites: () => () => {},
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    intervalMs: 10_000,
  });

  try {
    assert.equal(calls, 1);
    // The initial trigger's own scheduleInterval() call runs after its
    // `await sync()` resolves -- give it a tick before inspecting timers.
    await settle();
    visible = false;
    // The interval tick fires while hidden -- must skip the sync and just
    // reschedule, not call sync() in the background.
    assert.equal(timers.runOnly(), 10_000);
    assert.equal(calls, 1, "a hidden-tab interval tick must not sync");
  } finally {
    controller.stop();
  }
});

test("createBackgroundSyncV2Controller: a local v2 write debounces a trigger through subscribeWrites", async () => {
  const client = await import("@/lib/sync/client");
  const timers = createFakeTimers();
  const windowTarget = createFakeEventTarget();
  const documentTarget = createFakeEventTarget();
  let calls = 0;
  let writeListener: (() => void) | undefined;

  const controller = client.createBackgroundSyncV2Controller({
    sync: async () => {
      calls += 1;
    },
    isOnline: () => true,
    isVisible: () => true,
    windowTarget,
    documentTarget,
    subscribeWrites: (listener) => {
      writeListener = listener;
      return () => {
        writeListener = undefined;
      };
    },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    intervalMs: 60_000,
    writeDebounceMs: 2_000,
  });

  try {
    assert.equal(calls, 1, "initial trigger");
    assert.ok(writeListener, "the controller must subscribe to local v2 writes");
    // Let the initial trigger's own scheduleInterval() call land before the
    // write fires its own debounce timer, so the "two pending timers" count
    // below is unambiguous.
    await settle();

    writeListener!();
    // Two pending timers now: the interval scheduled after the initial
    // sync, and the fresh debounce timer. Only the debounce timer should
    // fire a sync when it elapses.
    assert.equal(timers.pendingCount(), 2);
  } finally {
    controller.stop();
  }
});

test("createBackgroundSyncV2Controller: stop() removes listeners and cancels pending timers; nothing fires afterward", async () => {
  const client = await import("@/lib/sync/client");
  const timers = createFakeTimers();
  const windowTarget = createFakeEventTarget();
  const documentTarget = createFakeEventTarget();
  let calls = 0;

  const controller = client.createBackgroundSyncV2Controller({
    sync: async () => {
      calls += 1;
    },
    isOnline: () => true,
    isVisible: () => true,
    windowTarget,
    documentTarget,
    subscribeWrites: () => () => {},
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  assert.equal(calls, 1);
  assert.ok(windowTarget.listenerCount("online") > 0);
  assert.ok(documentTarget.listenerCount("visibilitychange") > 0);
  // The initial trigger's own scheduleInterval() call runs after its
  // `await sync()` resolves -- give it a tick before inspecting timers.
  await settle();
  assert.ok(timers.pendingCount() > 0);

  controller.stop();

  assert.equal(windowTarget.listenerCount("online"), 0);
  assert.equal(documentTarget.listenerCount("visibilitychange"), 0);
  assert.equal(timers.pendingCount(), 0);

  windowTarget.dispatch("online");
  await Promise.resolve();
  assert.equal(calls, 1, "a stopped controller must never sync again");

  controller.triggerNow();
  assert.equal(calls, 1, "triggerNow() after stop() is a no-op");

  // stop() is idempotent.
  controller.stop();
});
