"use client";

import { openDB, type DBSchema } from "idb";
import type { ZodTypeAny } from "zod";

import type {
  DailyLog,
  Entry,
  Person,
  ReadingProgress,
  SyncOp,
  Thread,
} from "@/lib/contracts";
import {
  syncEntrySchema,
  syncLogSchema,
  syncPersonSchema,
  syncProgressSchema,
  syncThreadSchema,
} from "@/lib/api/sync";
import { SYNC_ENTITIES_V2, type SyncEntityV2, type SyncOpV2 } from "@/lib/contracts/sync-v2";
import type {
  Application,
  ClaimEvidence,
  MotifCandidate,
  MotifSighting,
  StudyClaim,
  StudySession,
  TeachingDraft,
  UserConnection,
} from "@/lib/contracts/study-v2";
import {
  syncApplicationV2Schema,
  syncClaimEvidenceV2Schema,
  syncMotifCandidateV2Schema,
  syncMotifSightingV2Schema,
  syncStudyClaimV2Schema,
  syncStudySessionV2Schema,
  syncTeachingDraftV2Schema,
  syncUserConnectionV2Schema,
} from "@/lib/api/sync-v2";

/**
 * The eight v2 study entities BUILD_PLAN.md:144 (as reconciled by
 * SYNCGAP-001) added to `SYNC_ENTITIES_V2`, mapped to the `study-v2.ts`
 * record interface each carries. This is the ONE hand-written list this
 * module needs — TypeScript, not a runtime array, so it is checked at
 * compile time: `V2EntityStores` below is `{ [K in SyncEntityV2]: ... }`,
 * a mapped type OVER `SyncEntityV2` itself, so if SYNC_ENTITIES_V2 grows a
 * ninth entity, `V2EntityRecordMap` is missing that key and every place
 * that indexes it (the IndexedDB schema, the payload-schema dispatch table)
 * fails to compile until this map is updated. Object-store *creation* and
 * the payload-schema *dispatch table* below both key off `SYNC_ENTITIES_V2`
 * at runtime, not off a second hand-typed list of the entity name strings —
 * see the upgrade() callback and v2PayloadSchemas.
 */
interface V2EntityRecordMap {
  session: StudySession;
  claim: StudyClaim;
  evidence: ClaimEvidence;
  motif: MotifCandidate;
  motifSighting: MotifSighting;
  connection: UserConnection;
  application: Application;
  teachingDraft: TeachingDraft;
}

/** One IndexedDB object store per v2 entity, keyed by SyncEntityV2 itself. */
type V2EntityStores = {
  [K in SyncEntityV2]: {
    key: string;
    value: V2EntityRecordMap[K];
    indexes: { updatedAt: string };
  };
};

interface BibleBrainDb extends DBSchema, V2EntityStores {
  entries: {
    key: string;
    value: Entry;
    indexes: { chapter: string; updatedAt: string };
  };
  threads: {
    key: string;
    value: Thread;
    indexes: { updatedAt: string };
  };
  progress: {
    key: string;
    value: ReadingProgress;
    indexes: { readAt: string };
  };
  logs: {
    key: string;
    value: DailyLog;
    indexes: { updatedAt: string };
  };
  people: {
    key: string;
    value: Person;
    indexes: { updatedAt: string };
  };
  syncQueue: {
    key: string;
    value: SyncOp;
    indexes: { updatedAt: string };
  };
  /**
   * The v2 outbox, separate from v1's `syncQueue` because its op shape
   * (`SyncOpV2`) is a different envelope entirely (opId/deviceId/mutation/
   * baseRevision/mutationGroupId/dependsOn/clientTime vs v1's id/entity/
   * entityId/op/updatedAt) — see lib/contracts/sync-v2.ts. This is what a
   * future v2 sync route (SYNCV2ROUTE-001, gated behind MOTIFSTATUS-001)
   * reads and calls pushSyncOpsV2 with; wiring that push/pull loop is out
   * of this task's scope (lib/sync/client.ts is read-only here).
   */
  syncQueueV2: {
    key: string;
    value: SyncOpV2;
    indexes: { clientTime: string };
  };
  meta: {
    key: string;
    value: { key: string; value: string };
  };
}

/**
 * Web Locks API name shared with lib/sync/clear.ts's exclusive hold (see that
 * file's clearLocalStudyData()). Every mutation below — the eight v1 writers
 * and the eight v2 writers (V2VAULT-001) alike — takes this in SHARED mode
 * for the duration of its write transaction, so a clear-device holding it
 * EXCLUSIVE — which it does for the whole time a delete could still land —
 * blocks every writer here rather than letting one slip in behind the check
 * that decided it was safe to destroy.
 */
export const WRITE_LOCK_NAME = "bible-brain:write-lock";

/**
 * Guard one mutation with the shared write lock, or run it unprotected when
 * Web Locks is unavailable (old Safari). That fallback is safe on its own:
 * clearLocalStudyData() refuses to run AT ALL without navigator.locks (see
 * lib/sync/clear.ts), so there is never an armed delete for an unlocked write
 * to race here.
 */
async function withWriteLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks) return run();
  return locks.request(WRITE_LOCK_NAME, { mode: "shared" }, () => run());
}

const database = openDB<BibleBrainDb>("bible-brain", 4, {
  upgrade(db, oldVersion) {
    // Every block below is additive-only (createObjectStore / createIndex),
    // gated on the exact prior version, and NEVER deletes or recreates a
    // store an earlier block already made. That is what makes this an
    // UPGRADE and not a wipe: a database opened at oldVersion 1, 2, or 3
    // keeps every store and every row it already had — idb/IndexedDB run
    // upgrade() once, transactionally, across every version between
    // oldVersion and the new version, so a v1-only database still gets the
    // v2/v3/v4 blocks applied on top of its existing data rather than
    // replacing it. tests/vault-v2.test.ts proves this by opening a real
    // (fake-indexeddb) database at version 1, writing data, then reopening
    // through this exact code path at version 4 and asserting that data
    // survived untouched.
    if (oldVersion < 1) {
      const entries = db.createObjectStore("entries", { keyPath: "id" });
      entries.createIndex("chapter", "chapter");
      entries.createIndex("updatedAt", "updatedAt");

      const threads = db.createObjectStore("threads", { keyPath: "slug" });
      threads.createIndex("updatedAt", "updatedAt");

      const queue = db.createObjectStore("syncQueue", { keyPath: "id" });
      queue.createIndex("updatedAt", "updatedAt");
      db.createObjectStore("meta", { keyPath: "key" });
    }
    if (oldVersion < 2) {
      const progress = db.createObjectStore("progress", { keyPath: "chapter" });
      progress.createIndex("readAt", "readAt");
      const logs = db.createObjectStore("logs", { keyPath: "date" });
      logs.createIndex("updatedAt", "updatedAt");
    }
    if (oldVersion < 3) {
      const people = db.createObjectStore("people", { keyPath: "slug" });
      people.createIndex("updatedAt", "updatedAt");
    }
    if (oldVersion < 4) {
      // One object store per v2 entity, derived from SYNC_ENTITIES_V2 at
      // runtime rather than hand-listing "session", "claim", ... here — a
      // hand-list is exactly how SYNCPERSIST-001 shipped against six
      // entities while the contract had grown to eight (V2VAULT-001
      // acceptance criteria). Every v2 record interface in study-v2.ts
      // carries a plain `id: string` primary key (unlike v1, where thread
      // keys on `slug` and progress on `chapter`), so one keyPath covers
      // all eight.
      for (const entity of SYNC_ENTITIES_V2) {
        const store = db.createObjectStore(entity, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
      const queueV2 = db.createObjectStore("syncQueueV2", { keyPath: "opId" });
      queueV2.createIndex("clientTime", "clientTime");
    }
  },
});

function opFor(
  entity: "entry" | "thread",
  entityId: string,
  payload: Entry | Thread,
): SyncOp {
  return {
    id: crypto.randomUUID(),
    entity,
    entityId,
    op: payload.deletedAt ? "delete" : "upsert",
    payload,
    updatedAt: payload.updatedAt,
  };
}

export async function saveLocalEntry(entry: Entry) {
  const validated = syncEntrySchema.safeParse(entry);
  if (!validated.success) {
    throw new Error(
      validated.error.issues[0]?.message ?? "Invalid local entry",
    );
  }
  await withWriteLock(async () => {
    const db = await database;
    const transaction = db.transaction(["entries", "syncQueue"], "readwrite");
    await Promise.all([
      transaction.objectStore("entries").put(entry),
      transaction
        .objectStore("syncQueue")
        .put(opFor("entry", entry.id, entry)),
      transaction.done,
    ]);
  });
}

export async function saveLocalThread(thread: Thread) {
  const validated = syncThreadSchema.safeParse(thread);
  if (!validated.success) {
    throw new Error(
      validated.error.issues[0]?.message ?? "Invalid local thread",
    );
  }
  await withWriteLock(async () => {
    const db = await database;
    const transaction = db.transaction(["threads", "syncQueue"], "readwrite");
    await Promise.all([
      transaction.objectStore("threads").put(thread),
      transaction
        .objectStore("syncQueue")
        .put(opFor("thread", thread.slug, thread)),
      transaction.done,
    ]);
  });
}

export async function markChapterRead(progress: ReadingProgress) {
  const validated = syncProgressSchema.safeParse(progress);
  if (!validated.success) {
    throw new Error(
      validated.error.issues[0]?.message ?? "Invalid reading progress",
    );
  }
  await withWriteLock(async () => {
    const db = await database;
    const transaction = db.transaction(["progress", "syncQueue"], "readwrite");
    const op: SyncOp = {
      id: crypto.randomUUID(),
      entity: "progress",
      entityId: progress.chapter,
      op: "upsert",
      payload: progress,
      updatedAt: progress.readAt,
    };
    await Promise.all([
      transaction.objectStore("progress").put(progress),
      transaction.objectStore("syncQueue").put(op),
      transaction.done,
    ]);
  });
}

export async function saveLocalLog(log: DailyLog) {
  const validated = syncLogSchema.safeParse(log);
  if (!validated.success) {
    throw new Error(
      validated.error.issues[0]?.message ?? "Invalid daily log",
    );
  }
  await withWriteLock(async () => {
    const db = await database;
    const transaction = db.transaction(["logs", "syncQueue"], "readwrite");
    const op: SyncOp = {
      id: crypto.randomUUID(),
      entity: "log",
      entityId: log.date,
      op: "upsert",
      payload: log,
      updatedAt: log.updatedAt,
    };
    await Promise.all([
      transaction.objectStore("logs").put(log),
      transaction.objectStore("syncQueue").put(op),
      transaction.done,
    ]);
  });
}

export async function saveLocalPerson(person: Person) {
  const validated = syncPersonSchema.safeParse(person);
  if (!validated.success) {
    throw new Error(
      validated.error.issues[0]?.message ?? "Invalid person",
    );
  }
  await withWriteLock(async () => {
    const db = await database;
    const transaction = db.transaction(["people", "syncQueue"], "readwrite");
    const op: SyncOp = {
      id: crypto.randomUUID(),
      entity: "person",
      entityId: person.slug,
      op: "upsert",
      payload: person,
      updatedAt: person.updatedAt,
    };
    await Promise.all([
      transaction.objectStore("people").put(person),
      transaction.objectStore("syncQueue").put(op),
      transaction.done,
    ]);
  });
}

// ---------------------------------------------------------------------------
// v2 vault — session, claim, evidence, motif, motifSighting, connection,
// application, teachingDraft (V2VAULT-001). BUILD_PLAN 3.4: entity write and
// outbox op in ONE IndexedDB transaction; tenet 7: every browser write goes
// through the outbox. This is the local half of that contract — the eight v2
// entities STUDYV2-001/SYNCV2-001/SYNCGAP-001 defined were otherwise
// unreachable from an offline device.
// ---------------------------------------------------------------------------

/**
 * One Zod schema per v2 entity, keyed by `SyncEntityV2` (`Record<SyncEntityV2,
 * ZodTypeAny>`) — not a switch/if-chain hand-listing entity names. Growing
 * `SYNC_ENTITIES_V2` without adding a row here fails `npm run typecheck`
 * (TypeScript requires every key of the Record's index type to be present),
 * and `tests/vault-v2.test.ts` separately proves at RUNTIME that every entity
 * in `SYNC_ENTITIES_V2` resolves to a real schema here, so a `SYNC_ENTITIES_V2`
 * that outran this map (e.g. via an `as never` cast slipping past the
 * compile-time check) still fails loudly rather than silently skipping
 * validation for the new entity.
 */
const v2PayloadSchemas: Record<SyncEntityV2, ZodTypeAny> = {
  session: syncStudySessionV2Schema,
  claim: syncStudyClaimV2Schema,
  evidence: syncClaimEvidenceV2Schema,
  motif: syncMotifCandidateV2Schema,
  motifSighting: syncMotifSightingV2Schema,
  connection: syncUserConnectionV2Schema,
  application: syncApplicationV2Schema,
  teachingDraft: syncTeachingDraftV2Schema,
};

/**
 * Every v2 record interface (study-v2.ts) carries these four fields; this is
 * what `opForV2` reads off a validated payload to build the outbox op,
 * regardless of which of the eight entities it is.
 */
interface V2SyncableEntity {
  id: string;
  revision: number;
  updatedAt: string;
  deletedAt?: string | null;
}

/**
 * This tab's stable device identifier (§14's `devices` table; `SyncOpV2.
 * deviceId`), lazily created and cached in the `meta` store under
 * "deviceId". Memoizing the in-flight PROMISE (not just its resolved value)
 * makes every call in this module instance — even ones issued in the same
 * synchronous tick, before the first call has awaited anything — resolve to
 * the SAME id, because they all return the one promise created by the first
 * caller rather than each racing their own read-then-write. A genuinely
 * concurrent FIRST-EVER call from a second tab (a second module instance) is
 * not covered by this — both tabs would each mint and persist their own
 * UUID, and whichever `put` lands last wins the "deviceId" key — but that is
 * an eventually-consistent metadata label, not user content, and outside
 * what this task's acceptance criteria require.
 */
let deviceIdPromise: Promise<string> | null = null;
function getOrCreateDeviceId(): Promise<string> {
  if (!deviceIdPromise) {
    deviceIdPromise = withWriteLock(async () => {
      const db = await database;
      const existing = await db.get("meta", "deviceId");
      if (existing) return existing.value;
      const deviceId = crypto.randomUUID();
      await db.put("meta", { key: "deviceId", value: deviceId });
      return deviceId;
    });
  }
  return deviceIdPromise;
}

/**
 * Build the outbox op for a validated v2 write.
 *
 * `baseRevision`: lib/contracts/sync-v2.ts's own header settles this only
 * for creates ("null ... is the only reading consistent with revision
 * starting at 1 in db/schema.ts"). db/schema.ts's v2 tables all default
 * `revision` to 1, so a payload at `revision === 1` is a create (baseRevision
 * null); anything higher is an edit whose base is the revision before this
 * one (`revision - 1`). Full update-conflict semantics — what the SERVER
 * does with a non-null baseRevision — are explicitly deferred by that same
 * header note to the persistence-wiring task; this only has to produce a
 * well-formed op for that task to consume.
 *
 * `mutationGroupId`/`dependsOn`: a standalone local write is its own
 * one-op group (`mutationGroupId` defaults to its own `opId`, `dependsOn`
 * empty). Expressing a related-creation group (e.g. a session plus the claim
 * created alongside it) as one bounded atomic unit is a domain/UI-layer
 * decision this task does not make on any caller's behalf — see this
 * commit's report.
 */
function opForV2(
  entity: SyncEntityV2,
  payload: V2SyncableEntity,
  deviceId: string,
): SyncOpV2 {
  const opId = crypto.randomUUID();
  return {
    opId,
    deviceId,
    entity,
    entityId: payload.id,
    mutation: payload.deletedAt ? "delete" : "upsert",
    baseRevision: payload.revision > 1 ? payload.revision - 1 : null,
    mutationGroupId: opId,
    dependsOn: [],
    payload,
    clientTime: payload.updatedAt,
  };
}

/**
 * The one write path every v2 entity funnels through. Validates against
 * `v2PayloadSchemas[entity]`, then writes the entity AND its outbox op in a
 * SINGLE IndexedDB transaction spanning the entity's own store and
 * `syncQueueV2` — if either `put` fails, IndexedDB aborts the whole
 * transaction and NEITHER survives (tests/vault-v2.test.ts proves this by
 * forcing the outbox `put` to abort the transaction and asserting the entity
 * `put`, issued first, does not survive either). Takes `WRITE_LOCK_NAME` in
 * shared mode, exactly like the eight v1 writers above, so a clear-device
 * holding it exclusively blocks this until the clear either finishes or
 * refuses (tests/vault-v2.test.ts proves this too, by holding the lock
 * exclusively and asserting the write does not resolve until it is released).
 */
async function saveLocalV2Entity(
  entity: SyncEntityV2,
  record: unknown,
): Promise<void> {
  const schema = v2PayloadSchemas[entity];
  const validated = schema.safeParse(record);
  if (!validated.success) {
    throw new Error(
      validated.error.issues[0]?.message ?? `Invalid local ${entity}`,
    );
  }
  const payload = validated.data as V2SyncableEntity;
  const deviceId = await getOrCreateDeviceId();
  const op = opForV2(entity, payload, deviceId);
  await withWriteLock(async () => {
    const db = await database;
    const transaction = db.transaction([entity, "syncQueueV2"], "readwrite");
    // `payload` is typed as the narrow V2SyncableEntity marker (the four
    // fields opForV2 needs), not the full union of the eight v2 record
    // interfaces — this store's actual runtime value, already validated
    // above against the entity's own schema. `as never` is the standard idb
    // escape hatch for "the value has already been checked to belong to
    // whichever branch of the union this store's name selects."
    const entityPut = transaction.objectStore(entity).put(payload as never);
    const opPut = transaction.objectStore("syncQueueV2").put(op);
    // If either put fails (e.g. the transaction aborts), IndexedDB rejects
    // EVERY outstanding request on that transaction, not just the one that
    // triggered the abort — so both settle to rejected, but Promise.all
    // below only awaits/surfaces the first one it sees. Give each its own
    // no-op catch so the other's rejection does not surface as an unhandled
    // promise rejection once Promise.all has already reported the failure
    // through whichever one it picked up first.
    entityPut.catch(() => {});
    opPut.catch(() => {});
    await Promise.all([entityPut, opPut, transaction.done]);
  });
}

export async function saveLocalStudySession(session: StudySession): Promise<void> {
  await saveLocalV2Entity("session", session);
}

export async function saveLocalStudyClaim(claim: StudyClaim): Promise<void> {
  await saveLocalV2Entity("claim", claim);
}

export async function saveLocalClaimEvidence(evidence: ClaimEvidence): Promise<void> {
  await saveLocalV2Entity("evidence", evidence);
}

export async function saveLocalMotifCandidate(motif: MotifCandidate): Promise<void> {
  await saveLocalV2Entity("motif", motif);
}

export async function saveLocalMotifSighting(sighting: MotifSighting): Promise<void> {
  await saveLocalV2Entity("motifSighting", sighting);
}

export async function saveLocalUserConnection(connection: UserConnection): Promise<void> {
  await saveLocalV2Entity("connection", connection);
}

export async function saveLocalApplication(application: Application): Promise<void> {
  await saveLocalV2Entity("application", application);
}

export async function saveLocalTeachingDraft(draft: TeachingDraft): Promise<void> {
  await saveLocalV2Entity("teachingDraft", draft);
}

/**
 * Generic entry point for callers (and tests) that only have an entity name
 * from `SYNC_ENTITIES_V2` at hand rather than a specific record type —
 * exported so `tests/vault-v2.test.ts` can loop `SYNC_ENTITIES_V2` and prove
 * every current entity is reachable, without hand-listing the eight typed
 * wrappers above a second time.
 */
export async function saveLocalV2EntityByName(
  entity: SyncEntityV2,
  record: unknown,
): Promise<void> {
  await saveLocalV2Entity(entity, record);
}

export async function listLocalV2Entities<E extends SyncEntityV2>(
  entity: E,
): Promise<V2EntityRecordMap[E][]> {
  const db = await database;
  return db.getAll(entity) as Promise<V2EntityRecordMap[E][]>;
}

export async function getPendingV2Ops(): Promise<SyncOpV2[]> {
  const db = await database;
  return db.getAllFromIndex("syncQueueV2", "clientTime");
}

export async function removePendingV2Ops(opIds: string[]): Promise<void> {
  if (opIds.length === 0) return;
  await withWriteLock(async () => {
    const db = await database;
    const transaction = db.transaction("syncQueueV2", "readwrite");
    await Promise.all([
      ...opIds.map((opId) => transaction.store.delete(opId)),
      transaction.done,
    ]);
  });
}

export async function getLocalLog(date: string) {
  const db = await database;
  return db.get("logs", date);
}

export async function listReadingProgress() {
  const db = await database;
  return db.getAll("progress");
}

export async function listLocalEntries(chapter?: string) {
  const db = await database;
  const values = chapter
    ? await db.getAllFromIndex("entries", "chapter", chapter)
    : await db.getAll("entries");
  return values
    .filter((entry) => !entry.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listLocalThreads() {
  const db = await database;
  return (await db.getAll("threads"))
    .filter((thread) => !thread.deletedAt)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function getPendingOps() {
  const db = await database;
  return db.getAllFromIndex("syncQueue", "updatedAt");
}

export async function removePendingOps(ids: string[]) {
  if (ids.length === 0) return;
  await withWriteLock(async () => {
    const db = await database;
    const transaction = db.transaction("syncQueue", "readwrite");
    await Promise.all([
      ...ids.map((id) => transaction.store.delete(id)),
      transaction.done,
    ]);
  });
}

export async function mergeRemoteChanges(
  entries: Entry[],
  threads: Thread[],
  progress: ReadingProgress[] = [],
  logs: DailyLog[] = [],
  people: Person[] = [],
) {
  await withWriteLock(async () => {
    const db = await database;
    const transaction = db.transaction(
      ["entries", "threads", "progress", "logs", "people"],
      "readwrite",
    );

    for (const remote of entries) {
      const local = await transaction.objectStore("entries").get(remote.id);
      if (
        !local ||
        Date.parse(remote.updatedAt) >= Date.parse(local.updatedAt)
      ) {
        await transaction.objectStore("entries").put(remote);
      }
    }
    for (const remote of threads) {
      const local = await transaction.objectStore("threads").get(remote.slug);
      if (
        !local ||
        Date.parse(remote.updatedAt) >= Date.parse(local.updatedAt)
      ) {
        await transaction.objectStore("threads").put(remote);
      }
    }
    for (const remote of progress) {
      const local = await transaction
        .objectStore("progress")
        .get(remote.chapter);
      if (!local || Date.parse(remote.readAt) >= Date.parse(local.readAt)) {
        await transaction.objectStore("progress").put(remote);
      }
    }
    for (const remote of logs) {
      const local = await transaction.objectStore("logs").get(remote.date);
      if (
        !local ||
        Date.parse(remote.updatedAt) >= Date.parse(local.updatedAt)
      ) {
        await transaction.objectStore("logs").put(remote);
      }
    }
    for (const remote of people) {
      const local = await transaction.objectStore("people").get(remote.slug);
      if (
        !local ||
        Date.parse(remote.updatedAt) >= Date.parse(local.updatedAt)
      ) {
        await transaction.objectStore("people").put(remote);
      }
    }
    await transaction.done;
  });
}

export async function getLastPull() {
  const db = await database;
  return (await db.get("meta", "lastPull"))?.value ?? null;
}

export async function setLastPull(value: string) {
  await withWriteLock(async () => {
    const db = await database;
    await db.put("meta", { key: "lastPull", value });
  });
}

export async function closeLocalDatabase() {
  const db = await database;
  db.close();
}
