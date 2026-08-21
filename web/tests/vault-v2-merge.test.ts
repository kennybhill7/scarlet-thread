import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";

import { CANONICAL_VERSIFICATION_ID } from "@/lib/contracts/range-v1";
import type {
  MotifCandidate,
  StudySession,
  TeachingDraft,
  TeachingSection,
} from "@/lib/contracts/study-v2";

/**
 * SYNCV2MERGE-001 — proves `mergeRemoteChangesV2` (lib/sync/store.ts), the
 * v2 pull-merge writer, and its wiring into `syncNowV2` (lib/sync/client.ts).
 *
 * SYNCV2ROUTE-001 wired `/api/sync/v2/pull` but deliberately stopped short of
 * writing what it returned into the local vault: `saveLocalV2EntityByName`,
 * the vault's only v2 write path at the time, always enqueues a fresh
 * `syncQueueV2` outbox op for whatever it writes — correct for a
 * locally-authored edit, and a permanent revision-conflict trap for a
 * server-authored pull (every pulled row would come back as a "local change"
 * one revision behind what the server just sent). This file's central
 * assertion, repeated in more than one shape below, is that a merge NEVER
 * touches the outbox: `tests 1 and 6` capture `getPendingV2Ops()` serialized
 * to JSON before a merge and assert it is byte-identical afterward.
 *
 * File-process isolation matches tests/vault-v2.test.ts's own documented
 * model: Node's test runner gives each `*.test.ts` file its own child
 * process, so this file's in-memory fake-indexeddb "bible-brain" database
 * starts empty and is never shared with vault-v2.test.ts or any other test
 * file.
 */

const isoNow = () => new Date().toISOString();
const WORKSPACE_ID = "workspace-syncv2merge-001";

function sampleRange() {
  return {
    versificationId: CANONICAL_VERSIFICATION_ID,
    start: "1.1.1",
    end: "1.1.1",
  } as const;
}

function sampleSession(overrides: Partial<StudySession> = {}): StudySession {
  const now = isoNow();
  return {
    id: crypto.randomUUID(),
    workspaceId: WORKSPACE_ID,
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

function sampleTeachingDraft(overrides: Partial<TeachingDraft> = {}): TeachingDraft {
  const now = isoNow();
  return {
    id: crypto.randomUUID(),
    workspaceId: WORKSPACE_ID,
    sessionId: crypto.randomUUID(),
    title: "Seed teaching draft",
    bigIdea: "The big idea.",
    audience: "Adults",
    durationMinutes: 15,
    gospelConnection: "The gospel connection.",
    status: "draft",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function sampleTeachingSection(overrides: Partial<TeachingSection> = {}): TeachingSection {
  const now = isoNow();
  return {
    id: crypto.randomUUID(),
    workspaceId: WORKSPACE_ID,
    draftId: crypto.randomUUID(),
    kind: "outline",
    sortOrder: 0,
    body: "I. The seed promise.",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function sampleMotif(overrides: Partial<MotifCandidate> = {}): MotifCandidate {
  const now = isoNow();
  return {
    id: crypto.randomUUID(),
    workspaceId: WORKSPACE_ID,
    label: "Seed motif",
    normalizedKey: `seed-motif-${crypto.randomUUID()}`,
    status: "candidate",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

/** Minimal Web Locks API stand-in — the same shared/exclusive semantics
 * tests/vault-v2.test.ts's own scoped copy implements (that file's own
 * comment explains why each test file carries its own: device-clear.test.ts's
 * helper is not exported). One lock name only, so no name->state map needed. */
function createLockManager(): LockManager {
  const state = {
    sharedCount: 0,
    exclusive: false,
    queue: [] as { mode: "shared" | "exclusive"; grant: () => void }[],
  };
  function pump() {
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
  function release(mode: "shared" | "exclusive") {
    if (mode === "shared") state.sharedCount -= 1;
    else state.exclusive = false;
    pump();
  }
  async function request<T>(
    _name: string,
    optionsOrCallback: { mode?: "shared" | "exclusive" } | (() => T | Promise<T>),
    maybeCallback?: () => T | Promise<T>,
  ): Promise<T> {
    const callback =
      typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback!;
    const options = typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
    const mode = options.mode ?? "exclusive";
    await new Promise<void>((resolve) => {
      state.queue.push({ mode, grant: resolve });
      pump();
    });
    try {
      return await callback();
    } finally {
      release(mode);
    }
  }
  return { request } as unknown as LockManager;
}

function withNavigatorLocks<T>(locks: LockManager, run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { locks, onLine: true },
    configurable: true,
  });
  return run().finally(() => {
    if (original) {
      Object.defineProperty(globalThis, "navigator", original);
    } else {
      // @ts-expect-error -- restoring "no navigator at all"
      delete globalThis.navigator;
    }
  });
}

// --- 1. the central assertion: outbox is byte-identical across a merge -----

test("a merge writes pulled rows into the local v2 stores and leaves the outbox byte-identical, even alongside a genuine local edit", async () => {
  const store = await import("@/lib/sync/store");

  // A genuine local edit first, so the outbox is non-empty going in — the
  // strongest form of "byte-identical": not merely "still empty", but
  // "still exactly the op the local edit produced, untouched."
  const localSession = sampleSession();
  await store.saveLocalStudySession(localSession);

  const before = JSON.stringify(await store.getPendingV2Ops());

  const pulledSession = sampleSession(); // a different id: no conflict
  const pulledDraft = sampleTeachingDraft();
  // TEACHSECTIONSYNC-001 — the ninth entity is exercised in this SAME central
  // assertion, not a separate one, so the byte-identical outbox check below
  // really does cover it rather than only the eight entities this test
  // covered before this task.
  const pulledSection = sampleTeachingSection();
  await store.mergeRemoteChangesV2({
    session: [pulledSession],
    teachingDraft: [pulledDraft],
    teachingSection: [pulledSection],
  });

  const after = JSON.stringify(await store.getPendingV2Ops());
  assert.equal(after, before, "the outbox must be byte-identical before and after a merge");

  // And the merge actually did its job: all three pulled rows landed locally.
  const sessions = await store.listLocalV2Entities("session");
  assert.ok(sessions.some((row) => row.id === pulledSession.id), "pulled session landed");
  const drafts = await store.listLocalV2Entities("teachingDraft");
  assert.ok(drafts.some((row) => row.id === pulledDraft.id), "pulled teaching draft landed");
  const sections = await store.listLocalV2Entities("teachingSection");
  assert.ok(sections.some((row) => row.id === pulledSection.id), "pulled teaching section landed");

  const pending = await store.getPendingV2Ops();
  await store.removePendingV2Ops(pending.map((op) => op.opId));
});

// --- 2. local edits still enqueue; both behaviors coexist -------------------

test("a local edit still enqueues an outbox op after mergeRemoteChangesV2 exists, and a merge run in between enqueues nothing", async () => {
  const store = await import("@/lib/sync/store");

  await store.mergeRemoteChangesV2({ session: [sampleSession()] });
  assert.equal(
    (await store.getPendingV2Ops()).length,
    0,
    "precondition: the merge above enqueued nothing",
  );

  const localMotif = sampleMotif();
  await store.saveLocalMotifCandidate(localMotif);

  const pending = await store.getPendingV2Ops();
  assert.equal(pending.length, 1, "the local edit enqueued exactly one op");
  assert.equal(pending[0]?.entity, "motif");
  assert.equal(pending[0]?.entityId, localMotif.id);

  await store.removePendingV2Ops(pending.map((op) => op.opId));
});

// --- 3. conflict rule: an unsynced local edit is not clobbered --------------

test("conflict rule: a pulled row for an entity with a still-pending local edit is skipped, and the local copy plus its queued op survive untouched", async () => {
  const store = await import("@/lib/sync/store");

  // Long-form prose (BUILD_PLAN tenet 4's own example) edited locally and not
  // yet acknowledged by the server.
  const draft = sampleTeachingDraft({ bigIdea: "The learner's own unsynced big idea." });
  await store.saveLocalTeachingDraft(draft);
  const [ownOp] = (await store.getPendingV2Ops()).filter((op) => op.entityId === draft.id);
  assert.ok(ownOp, "the local edit produced its own outbox op");

  // A pulled snapshot claims a DIFFERENT body for the same id (e.g. an older
  // or stale server copy) plus one unrelated, non-conflicting row.
  const conflictingPulledDraft = {
    ...draft,
    bigIdea: "Server copy that must not win.",
    updatedAt: new Date(Date.parse(draft.updatedAt) + 60_000).toISOString(), // even a NEWER clock
  };
  const nonConflictingSession = sampleSession();
  await store.mergeRemoteChangesV2({
    teachingDraft: [conflictingPulledDraft],
    session: [nonConflictingSession],
  });

  const [survivor] = (await store.listLocalV2Entities("teachingDraft")).filter(
    (row) => row.id === draft.id,
  );
  assert.equal(
    survivor?.bigIdea,
    "The learner's own unsynced big idea.",
    "the unsynced local prose must not be silently overwritten by the pulled row, " +
      "even though the pulled row's updatedAt is later",
  );

  const stillQueued = (await store.getPendingV2Ops()).some((op) => op.opId === ownOp.opId);
  assert.ok(stillQueued, "the local edit's outbox op must still be queued after the merge");

  // The non-conflicting row in the SAME merge call still lands — this is a
  // decisive per-row rule, not a merge-wide no-op.
  const sessions = await store.listLocalV2Entities("session");
  assert.ok(sessions.some((row) => row.id === nonConflictingSession.id));

  await store.removePendingV2Ops([ownOp.opId]);
});

// --- 3b. conflict rule, teachingSection specifically (TEACHSECTIONSYNC-001) -

test("conflict rule for teachingSection: a pulled row for a section with a still-pending local edit is skipped, and the local copy plus its queued op survive untouched", async () => {
  const store = await import("@/lib/sync/store");

  const section = sampleTeachingSection({ body: "The learner's own unsynced outline point." });
  await store.saveLocalTeachingSection(section);
  const [ownOp] = (await store.getPendingV2Ops()).filter((op) => op.entityId === section.id);
  assert.ok(ownOp, "the local edit produced its own outbox op");

  const conflictingPulledSection = {
    ...section,
    body: "Server copy that must not win.",
    updatedAt: new Date(Date.parse(section.updatedAt) + 60_000).toISOString(), // even a NEWER clock
  };
  await store.mergeRemoteChangesV2({ teachingSection: [conflictingPulledSection] });

  const [survivor] = (await store.listLocalV2Entities("teachingSection")).filter(
    (row) => row.id === section.id,
  );
  assert.equal(
    survivor?.body,
    "The learner's own unsynced outline point.",
    "the unsynced local prose must not be silently overwritten by the pulled row, " +
      "even though the pulled row's updatedAt is later",
  );

  const stillQueued = (await store.getPendingV2Ops()).some((op) => op.opId === ownOp.opId);
  assert.ok(stillQueued, "the local edit's outbox op must still be queued after the merge");

  await store.removePendingV2Ops([ownOp.opId]);
});

// --- 4. single-transaction atomicity: a partial merge cannot survive -------

test("if a put fails partway through, no row from that merge call survives (single-transaction atomicity across entities)", async () => {
  const store = await import("@/lib/sync/store");
  const pulledSession = sampleSession();
  const pulledMotif = sampleMotif();

  // SYNC_ENTITIES_V2 order puts "session" before "motif", so the session put
  // is issued first in mergeRemoteChangesV2's shared transaction; forcing the
  // motif put to abort must roll the already-issued session put back too, if
  // this really is one IndexedDB transaction and not one per entity.
  const originalPut = IDBObjectStore.prototype.put;
  let intercepted = false;
  IDBObjectStore.prototype.put = function (
    this: IDBObjectStore,
    ...args: Parameters<typeof originalPut>
  ) {
    const request = originalPut.apply(this, args);
    if (this.name === "motif" && !intercepted) {
      intercepted = true;
      this.transaction.abort();
    }
    return request;
  };

  try {
    await assert.rejects(
      store.mergeRemoteChangesV2({ session: [pulledSession], motif: [pulledMotif] }),
      "the merge rejects when one entity's put aborts the shared transaction",
    );
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }

  assert.ok(intercepted, "the forced abort actually ran during this merge");
  const sessions = await store.listLocalV2Entities("session");
  assert.ok(
    !sessions.some((row) => row.id === pulledSession.id),
    "the session row must NOT survive — its put ran first in the same transaction " +
      "as the motif put that aborted",
  );
  const motifs = await store.listLocalV2Entities("motif");
  assert.ok(!motifs.some((row) => row.id === pulledMotif.id));

  // And the outbox — never touched by this function to begin with — is
  // trivially still empty; the abort proves nothing else leaked either.
  assert.equal((await store.getPendingV2Ops()).length, 0);
});

// --- 5. the merge takes the same write lock every other writer takes -------

test("a merge cannot commit while a clear holds the write lock exclusively, and commits once it is released", async () => {
  const store = await import("@/lib/sync/store");
  const locks = createLockManager();

  await withNavigatorLocks(locks, async () => {
    let releaseHold!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    let isHolding!: () => void;
    const holding = new Promise<void>((resolve) => {
      isHolding = resolve;
    });
    const clearHold = locks.request(store.WRITE_LOCK_NAME, { mode: "exclusive" }, async () => {
      isHolding();
      await held;
    });
    await holding;

    const pulled = sampleSession();
    let committed = false;
    const merge = store
      .mergeRemoteChangesV2({ session: [pulled] })
      .then(() => {
        committed = true;
      });
    merge.catch(() => {});

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(committed, false, "the merge is shut out while the exclusive hold is active");

    releaseHold();
    await clearHold;
    await merge;
    assert.equal(committed, true, "the merge commits once the exclusive hold releases");

    const sessions = await store.listLocalV2Entities("session");
    assert.ok(sessions.some((row) => row.id === pulled.id));
  });
});

// --- 6. end to end through the client: syncNowV2 actually calls the merge --

test("syncNowV2 applies a pulled snapshot locally via the merge, without enqueueing an outbox op, making v2 sync two-way", async () => {
  const store = await import("@/lib/sync/store");
  const { syncNowV2 } = await import("@/lib/sync/client");

  const before = JSON.stringify(await store.getPendingV2Ops());

  const remoteSession = sampleSession();
  const remoteDraft = sampleTeachingDraft();
  const emptyResponse = (serverTime: string) =>
    new Response(
      JSON.stringify({
        serverTime,
        session: [remoteSession],
        claim: [],
        evidence: [],
        motif: [],
        motifSighting: [],
        connection: [],
        application: [],
        teachingDraft: [remoteDraft],
        rejected: [],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return emptyResponse("2026-08-20T00:00:00.000Z");
  };

  try {
    const result = await syncNowV2();
    assert.equal(result.pushed, 0, "nothing was queued locally, so nothing was pushed");
    assert.equal(result.pulled, 2, "both remote rows were counted as pulled");
    assert.deepEqual(
      requests,
      ["/api/sync/v2/pull"],
      "with an empty outbox, only the pull endpoint is called (no push round trip)",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const after = JSON.stringify(await store.getPendingV2Ops());
  assert.equal(after, before, "a real pull through syncNowV2 must not enqueue any outbox op");

  const sessions = await store.listLocalV2Entities("session");
  assert.ok(
    sessions.some((row) => row.id === remoteSession.id),
    "the pulled session actually landed in the local vault — v2 sync is two-way",
  );
  const drafts = await store.listLocalV2Entities("teachingDraft");
  assert.ok(drafts.some((row) => row.id === remoteDraft.id));
});
