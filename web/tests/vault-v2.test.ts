import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";

import { SYNC_ENTITIES_V2, type SyncEntityV2 } from "@/lib/contracts/sync-v2";
import { CANONICAL_VERSIFICATION_ID } from "@/lib/contracts/range-v1";
import type {
  Application,
  ClaimEvidence,
  MotifCandidate,
  MotifSighting,
  StudyClaim,
  StudySession,
  TeachingDraft,
  TeachingSection,
  UserConnection,
} from "@/lib/contracts/study-v2";

/**
 * V2VAULT-001 — the offline vault for the v2 study entities (eight at the
 * time this file was first written; TEACHSECTIONSYNC-001 later added a ninth,
 * `teachingSection`, on its own additive version-5 bump — see
 * lib/sync/store.ts's `V2_ENTITIES_AT_SCHEMA_VERSION_4`).
 *
 * Test order is load-bearing for exactly one reason: the very first test
 * below opens the real "bible-brain" IndexedDB database RAW, at version 1,
 * before lib/sync/store.ts is ever imported in this file/process — that is
 * the only way to prove the version-5 upgrade preserves a genuine pre-
 * existing v1 vault rather than starting from a database this same process
 * already created at version 5. Every test after it may freely import
 * lib/sync/store.ts (its module-level `database` singleton is created once,
 * already at version 5, and reused for the rest of this file) — matching the
 * same file-isolation model tests/device-clear.test.ts documents.
 */

const DB_NAME = "bible-brain";
const isoNow = () => new Date().toISOString();

function sampleRange() {
  return {
    versificationId: CANONICAL_VERSIFICATION_ID,
    start: "1.1.1",
    end: "1.1.1",
  } as const;
}

/**
 * One valid payload per v2 entity, exhaustively switched over SyncEntityV2 —
 * if SYNC_ENTITIES_V2 ever grows a ninth value, this switch fails to compile
 * (no `default` case; TypeScript's exhaustiveness check via the `never`
 * assignment below), which is a deliberate second tripwire alongside the
 * production `Record<SyncEntityV2, ZodTypeAny>` in lib/sync/store.ts.
 */
function sampleFor(entity: SyncEntityV2): unknown {
  const id = crypto.randomUUID();
  const now = isoNow();
  const workspaceId = "workspace-v2vault-001";
  switch (entity) {
    case "session": {
      const value: StudySession = {
        id,
        workspaceId,
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
      };
      return value;
    }
    case "claim": {
      const value: StudyClaim = {
        id,
        workspaceId,
        sessionId: crypto.randomUUID(),
        kind: "observation",
        epistemicBasis: "text_explicit",
        body: "A seed is promised in the text.",
        passage: sampleRange(),
        confidence: "tentative",
        provenance: "learner",
        doctrineStatus: null,
        viewpointId: null,
        status: "draft",
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      return value;
    }
    case "evidence": {
      const value: ClaimEvidence = {
        id,
        workspaceId,
        claimId: crypto.randomUUID(),
        evidenceType: "passage",
        canonicalReference: sampleRange(),
        contentBlockId: null,
        citationId: null,
        note: "Supporting passage note.",
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      return value;
    }
    case "motif": {
      const value: MotifCandidate = {
        id,
        workspaceId,
        label: "Seed motif",
        normalizedKey: "seed-motif",
        status: "candidate",
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      return value;
    }
    case "motifSighting": {
      const value: MotifSighting = {
        id,
        workspaceId,
        candidateId: crypto.randomUUID(),
        passageUnitKey: "unit-1",
        exactRange: sampleRange(),
        entryId: null,
        claimId: null,
        status: "candidate",
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      return value;
    }
    case "connection": {
      const value: UserConnection = {
        id,
        workspaceId,
        fromRange: sampleRange(),
        toRange: sampleRange(),
        type: "quotation",
        evidenceLabel: "strong",
        rationale: "This rationale is comfortably longer than twenty characters.",
        threadSlug: null,
        status: "draft",
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      return value;
    }
    case "application": {
      const value: Application = {
        id,
        workspaceId,
        sessionId: crypto.randomUUID(),
        sourceClaimId: crypto.randomUUID(),
        originalAudienceMeaning: "What it meant then.",
        enduringPrinciple: "What endures.",
        canonicalBridge: "The bridge to today.",
        applicationClass: "personal",
        promiseScope: "individual",
        modernDomain: "work",
        situation: "A modern situation.",
        responseType: "belief",
        faithfulResponse: "A faithful response.",
        cautions: "",
        availableAfter: null,
        status: "draft",
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      return value;
    }
    case "teachingDraft": {
      const value: TeachingDraft = {
        id,
        workspaceId,
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
      };
      return value;
    }
    case "teachingSection": {
      const value: TeachingSection = {
        id,
        workspaceId,
        draftId: crypto.randomUUID(),
        kind: "outline",
        sortOrder: 0,
        body: "I. The seed promise.",
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      return value;
    }
    default: {
      const exhaustive: never = entity;
      throw new Error(`No sample payload for entity ${exhaustive}`);
    }
  }
}

/** Minimal Web Locks API stand-in — this file's own, scoped copy of the same
 * shared/exclusive semantics tests/device-clear.test.ts implements, since
 * that file's helper is not exported. One lock name only (WRITE_LOCK_NAME),
 * so no name→state map is needed. */
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

async function localDatabaseExists(): Promise<boolean> {
  return (await indexedDB.databases()).some((info) => info.name === DB_NAME);
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

// --- 1. the version-5 upgrade preserves a real pre-existing v1 vault -------

test("opening the version-5 schema upgrades a real v1 vault in place, losing none of its data", async () => {
  assert.equal(
    await localDatabaseExists(),
    false,
    "precondition: no database exists yet in this process",
  );

  // Simulate "an existing vault with v1 data" for real: open at version 1,
  // create exactly the stores lib/sync/store.ts's own oldVersion<1 block
  // creates, and write one row into each — without importing store.ts at
  // all, so this is genuinely independent of the module under test.
  const seededEntryId = crypto.randomUUID();
  const now = isoNow();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const entries = db.createObjectStore("entries", { keyPath: "id" });
      entries.createIndex("chapter", "chapter");
      entries.createIndex("updatedAt", "updatedAt");
      const threads = db.createObjectStore("threads", { keyPath: "slug" });
      threads.createIndex("updatedAt", "updatedAt");
      const queue = db.createObjectStore("syncQueue", { keyPath: "id" });
      queue.createIndex("updatedAt", "updatedAt");
      db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("entries", "readwrite");
      tx.objectStore("entries").put({
        id: seededEntryId,
        kind: "observation",
        body: "Pre-existing v1 entry.",
        chapter: "1.3",
        threads: [],
        createdAt: now,
        updatedAt: now,
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });

  assert.equal(
    await new Promise<number>((resolve) => {
      // Version check: confirm the seeded database really is at version 1
      // before the module under test ever touches it.
      const request = indexedDB.open(DB_NAME);
      request.onsuccess = () => {
        const version = request.result.version;
        request.result.close();
        resolve(version);
      };
    }),
    1,
    "the seeded database is really at version 1 before the upgrade",
  );

  // NOW import the module under test — its openDB("bible-brain", 5, ...)
  // runs the real upgrade() callback against this on-disk (well, in-memory
  // fake-indexeddb) v1 database, oldVersion=1, exactly as a real learner's
  // browser would on their next app load after this ships.
  const store = await import("@/lib/sync/store");

  const survivingEntries = await store.listLocalEntries("1.3");
  assert.equal(survivingEntries.length, 1, "the v1 entry survived the upgrade");
  assert.equal(survivingEntries[0]?.id, seededEntryId);
  assert.equal(survivingEntries[0]?.body, "Pre-existing v1 entry.");

  // And the upgrade actually added the v2 stores: every entity in
  // SYNC_ENTITIES_V2 is now writable and reachable, proving this is a real
  // schema upgrade and not merely "the v1 data happens not to have been
  // touched."
  for (const entity of SYNC_ENTITIES_V2) {
    await store.saveLocalV2EntityByName(entity, sampleFor(entity));
    const rows = await store.listLocalV2Entities(entity);
    assert.equal(rows.length, 1, `${entity}: writable immediately after the upgrade`);
  }
  const pending = await store.getPendingV2Ops();
  await store.removePendingV2Ops(pending.map((op) => op.opId));
});

// --- 2. every SYNC_ENTITIES_V2 entity is reachable at runtime --------------

test("every entity in SYNC_ENTITIES_V2 is reachable through the vault, derived from the contract rather than hand-listed", async () => {
  const store = await import("@/lib/sync/store");

  for (const entity of SYNC_ENTITIES_V2) {
    const sample = sampleFor(entity) as { id: string };
    await store.saveLocalV2EntityByName(entity, sample);
    const rows = await store.listLocalV2Entities(entity);
    assert.ok(
      rows.some((row) => (row as { id: string }).id === sample.id),
      `${entity}: the entity landed in its own object store`,
    );
  }

  const pending = await store.getPendingV2Ops();
  assert.deepEqual(
    new Set(pending.map((op) => op.entity)),
    new Set(SYNC_ENTITIES_V2),
    "every entity in the current contract produced its own outbox op — " +
      "a SYNC_ENTITIES_V2 entity with no dispatch-table entry would have " +
      "thrown inside saveLocalV2EntityByName above instead of reaching here",
  );
  await store.removePendingV2Ops(pending.map((op) => op.opId));
});

test("an off-enum status is rejected before it ever reaches IndexedDB", async () => {
  const store = await import("@/lib/sync/store");
  const now = isoNow();
  await assert.rejects(
    store.saveLocalStudyClaim({
      id: crypto.randomUUID(),
      workspaceId: "workspace-v2vault-001",
      sessionId: crypto.randomUUID(),
      // @ts-expect-error -- deliberately off-enum for this negative test
      kind: "not-a-real-kind",
      epistemicBasis: "text_explicit",
      body: "x",
      passage: sampleRange(),
      confidence: "tentative",
      provenance: "learner",
      doctrineStatus: null,
      status: "draft",
      revision: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }),
  );
});

// --- 3. entity write + outbox op is ONE transaction -------------------------

test("if the outbox write fails, the entity write does not survive either (single-transaction atomicity)", async () => {
  const store = await import("@/lib/sync/store");
  const sample = sampleFor("motif") as MotifCandidate;

  // Force the SECOND put() in saveLocalV2Entity's transaction (the outbox
  // write, into "syncQueueV2") to abort the whole transaction, at the
  // lowest platform layer this module actually calls through — the real
  // IDBObjectStore.prototype.put — rather than mocking anything inside
  // lib/sync/store.ts itself. The entity put (into "motif") is issued FIRST
  // in that same transaction; IndexedDB's atomicity guarantee is exactly
  // what this test is proving, so if it holds, that earlier put must be
  // rolled back too.
  const originalPut = IDBObjectStore.prototype.put;
  let intercepted = false;
  IDBObjectStore.prototype.put = function (
    this: IDBObjectStore,
    ...args: Parameters<typeof originalPut>
  ) {
    // Issue the REAL request first (the transaction is still active, so
    // this is a perfectly normal put), then abort. Calling .put() again
    // AFTER abort() would throw TransactionInactiveError synchronously
    // instead of exercising the rollback this test wants — aborting a
    // transaction that already has an outstanding request is what rolls
    // that request (and every other request already issued on the same
    // transaction, including the entity put issued just before this one)
    // back.
    const request = originalPut.apply(this, args);
    if (this.name === "syncQueueV2" && !intercepted) {
      intercepted = true;
      this.transaction.abort();
    }
    return request;
  };

  try {
    await assert.rejects(
      store.saveLocalV2EntityByName("motif", sample),
      "the write rejects when the outbox half of its transaction aborts",
    );
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }

  assert.ok(intercepted, "the forced abort actually ran during this write");
  const rows = await store.listLocalV2Entities("motif");
  assert.ok(
    !rows.some((row) => row.id === sample.id),
    "the motif candidate must NOT survive — its put() ran first in the same " +
      "transaction as the outbox put() that aborted",
  );
  const pending = await store.getPendingV2Ops();
  assert.ok(
    !pending.some((op) => op.entityId === sample.id),
    "no outbox op for it survives either",
  );
});

// --- 4. every new writer takes WRITE_LOCK_NAME ------------------------------

test("a v2 writer cannot commit while a clear holds the write lock exclusively, and commits once it is released", async () => {
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

    const sample = sampleFor("connection") as UserConnection;
    let committed = false;
    const write = store
      .saveLocalUserConnection(sample)
      .then(() => {
        committed = true;
      });
    write.catch(() => {});

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      committed,
      false,
      "the v2 writer is shut out while the exclusive hold is active",
    );

    releaseHold();
    await clearHold;
    await write;
    assert.equal(committed, true, "the writer commits once the exclusive hold releases");

    const rows = await store.listLocalV2Entities("connection");
    assert.ok(rows.some((row) => row.id === sample.id));
    const pending = await store.getPendingV2Ops();
    await store.removePendingV2Ops(
      pending.filter((op) => op.entityId === sample.id).map((op) => op.opId),
    );
  });
});

// --- 5. clear.ts: an unsynced v2 write blocks the clear, exactly like v1 ---

test("an unsynced v2 write blocks the device clear exactly like an unsynced v1 write does", async () => {
  const store = await import("@/lib/sync/store");
  const clear = await import("@/lib/sync/clear");
  const locks = createLockManager();

  await withNavigatorLocks(locks, async () => {
    // Start from a genuinely empty queue so the count below is attributable
    // only to the write this test makes.
    await store.removePendingOps((await store.getPendingOps()).map((op) => op.id));
    await store.removePendingV2Ops((await store.getPendingV2Ops()).map((op) => op.opId));
    assert.equal(
      await clear.countPendingWrites(),
      0,
      "precondition: the combined v1+v2 queue starts empty",
    );

    const sample = sampleFor("session") as StudySession;
    await store.saveLocalStudySession(sample);
    assert.equal(
      await clear.countPendingWrites(),
      1,
      "the unsynced v2 write is counted by the same guard v1 writes go through",
    );

    const error = await failureOf(clear.clearLocalStudyData({ deleteTimeoutMs: 300 }));
    assert.ok(
      error instanceof clear.DeviceClearUnsyncedError,
      "the destroy refuses to run while v2 writing is unsynced",
    );
    assert.equal(
      (error as InstanceType<typeof clear.DeviceClearUnsyncedError>).pending,
      1,
    );

    assert.ok(await localDatabaseExists(), "nothing was destroyed");
    const survivors = await store.getPendingV2Ops();
    assert.equal(survivors.length, 1, "the unsynced v2 write survives the refused clear");
    assert.equal(survivors[0]?.entityId, sample.id);

    await store.removePendingV2Ops(survivors.map((op) => op.opId));
    assert.equal((await clear.countPendingWrites()), 0);
  });
});
