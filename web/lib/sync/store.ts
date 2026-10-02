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
  TeachingSection,
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
  syncTeachingSectionV2Schema,
  syncUserConnectionV2Schema,
} from "@/lib/api/sync-v2";

/**
 * The nine v2 study entities `SYNC_ENTITIES_V2` carries (BUILD_PLAN.md:144's
 * original eight, as reconciled by SYNCGAP-001, plus `teachingSection` added
 * by TEACHSECTIONSYNC-001), mapped to the `study-v2.ts` record interface each
 * carries. This is the ONE hand-written list this module needs — TypeScript,
 * not a runtime array, so it is checked at compile time: `V2EntityStores`
 * below is `{ [K in SyncEntityV2]: ... }`, a mapped type OVER `SyncEntityV2`
 * itself, so if SYNC_ENTITIES_V2 grows a tenth entity, `V2EntityRecordMap` is
 * missing that key and every place that indexes it (the IndexedDB schema,
 * the payload-schema dispatch table) fails to compile until this map is
 * updated. Object-store *creation* and the payload-schema *dispatch table*
 * below both key off `SYNC_ENTITIES_V2` at runtime, not off a second
 * hand-typed list of the entity name strings — see the upgrade() callback
 * and v2PayloadSchemas.
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
  teachingSection: TeachingSection;
}

/** One IndexedDB object store per v2 entity, keyed by SyncEntityV2 itself. */
type V2EntityStores = {
  [K in SyncEntityV2]: {
    key: string;
    value: V2EntityRecordMap[K];
    indexes: { updatedAt: string };
  };
};

/**
 * SYNCFLUSH-001 — a `SyncOpV2` as actually stored in `syncQueueV2`, with
 * three extra, LOCAL-ONLY bookkeeping fields layered on top of the wire
 * envelope. This is an ADDITIVE change to the STORED VALUE, not to the
 * `BibleBrainDb` schema's version/upgrade path: IndexedDB enforces no shape
 * on an object store's values (only the `keyPath` is structural), so adding
 * optional fields to what gets `put()` into an existing store needs no
 * `oldVersion` bump, no new `createObjectStore`, and does not touch a single
 * row already on a learner's device — unlike every block in `upgrade()`
 * below, which IS how this module makes a genuinely structural change (a new
 * store, a new index) safely. `rejectionCount`/`lastError`/`parked` are read
 * and written only by this module (`recordV2Rejections`, `listParkedOps`,
 * `getSyncStatusV2`) and by `lib/sync/client.ts`'s `runSyncV2` — they are
 * never sent over the wire: `lib/sync/client.ts`'s push path maps every op
 * back down to the plain `SyncOpV2` envelope before `JSON.stringify`-ing it,
 * because the server's `syncOpV2Schema` is `.strict()` (lib/api/sync-v2.ts)
 * and would reject a push carrying these extra properties.
 *
 * `lastError` holds only the server's own rejection reason string (e.g.
 * "Revision conflict: ...") — never the op's `payload` (the learner's own
 * prose, which this never touches) and never anything this module
 * constructs from it, so it carries no secrets and is safe to show in a
 * future UI or write to a log.
 */
export interface StoredSyncOpV2 extends SyncOpV2 {
  /** How many times the server has rejected this exact op. Absent/0 = never rejected. */
  rejectionCount?: number;
  /** The server's own rejection reason from the most recent rejection. */
  lastError?: string;
  /**
   * Set once `rejectionCount` reaches `V2_OP_PARK_THRESHOLD`. A parked op is
   * never deleted and stays in the outbox exactly like any other pending op
   * (so `countPendingWrites`/clear-device still treats it as unsynced), but
   * `lib/sync/client.ts`'s `runSyncV2` stops counting ITS rejections as a
   * reason to throw `SyncRejectedErrorV2` — see that module's header.
   */
  parked?: boolean;
}

/** After this many rejections of the SAME op, it is parked — see `StoredSyncOpV2.parked`. */
export const V2_OP_PARK_THRESHOLD = 3;

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
    value: StoredSyncOpV2;
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

/**
 * The nine v2 entities MINUS `teachingSection`, frozen exactly as
 * `SYNC_ENTITIES_V2` read at schema version 4 (V2VAULT-001) — NOT derived
 * live from `SYNC_ENTITIES_V2` any more, now that TEACHSECTIONSYNC-001 has
 * grown that array to nine members. The `oldVersion < 4` block below used to
 * loop the live array directly (safe when the array and "what version 4
 * created" were the same eight things); deriving it from the now-nine-member
 * array would try to create the `teachingSection` store a second time in the
 * dedicated `oldVersion < 5` block below, the first time a fresh database
 * (oldVersion 0) runs both blocks back to back in one upgrade transaction.
 * Freezing this list is what makes each version block additive-only and
 * historically accurate, matching V2VAULT-001's own pattern of never
 * touching what an earlier block already did.
 */
const V2_ENTITIES_AT_SCHEMA_VERSION_4 = SYNC_ENTITIES_V2.filter(
  (entity): entity is Exclude<SyncEntityV2, "teachingSection"> => entity !== "teachingSection",
);

const database = openDB<BibleBrainDb>("bible-brain", 5, {
  upgrade(db, oldVersion) {
    // Every block below is additive-only (createObjectStore / createIndex),
    // gated on the exact prior version, and NEVER deletes or recreates a
    // store an earlier block already made. That is what makes this an
    // UPGRADE and not a wipe: a database opened at oldVersion 1, 2, 3, or 4
    // keeps every store and every row it already had — idb/IndexedDB run
    // upgrade() once, transactionally, across every version between
    // oldVersion and the new version, so a v1-only database still gets the
    // v2/v3/v4/v5 blocks applied on top of its existing data rather than
    // replacing it. tests/vault-v2.test.ts proves this by opening a real
    // (fake-indexeddb) database at version 1, writing data, then reopening
    // through this exact code path at version 5 and asserting that data
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
      // One object store per v2 entity that existed as of schema version 4 —
      // see V2_ENTITIES_AT_SCHEMA_VERSION_4's own comment for why this no
      // longer loops SYNC_ENTITIES_V2 directly. Every v2 record interface in
      // study-v2.ts carries a plain `id: string` primary key (unlike v1,
      // where thread keys on `slug` and progress on `chapter`), so one
      // keyPath covers all of them.
      for (const entity of V2_ENTITIES_AT_SCHEMA_VERSION_4) {
        const store = db.createObjectStore(entity, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
      const queueV2 = db.createObjectStore("syncQueueV2", { keyPath: "opId" });
      queueV2.createIndex("clientTime", "clientTime");
    }
    if (oldVersion < 5) {
      // TEACHSECTIONSYNC-001 — the ninth v2 entity, added on its own
      // additive version bump exactly like every block above: a database
      // already at version 4 keeps its eight existing v2 stores and every
      // row in them untouched, and gains only this one new store.
      const teachingSectionStore = db.createObjectStore("teachingSection", { keyPath: "id" });
      teachingSectionStore.createIndex("updatedAt", "updatedAt");
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
// application, teachingDraft (V2VAULT-001), and teachingSection
// (TEACHSECTIONSYNC-001). BUILD_PLAN 3.4: entity write and outbox op in ONE
// IndexedDB transaction; tenet 7: every browser write goes through the
// outbox. This is the local half of that contract — the v2 entities
// STUDYV2-001/SYNCV2-001/SYNCGAP-001/TEACHSECTIONSYNC-001 defined were
// otherwise unreachable from an offline device.
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
  teachingSection: syncTeachingSectionV2Schema,
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
  // SYNCFLUSH-001 — fires only after the write above has actually committed
  // (the lock's callback, and therefore this line, never runs until
  // `transaction.done` resolved), so a listener debouncing a sync off of
  // this is never racing the write it is reacting to.
  notifyLocalV2Write();
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

export async function saveLocalTeachingSection(section: TeachingSection): Promise<void> {
  await saveLocalV2Entity("teachingSection", section);
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

export async function getPendingV2Ops(): Promise<StoredSyncOpV2[]> {
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

/**
 * SYNCFLUSH-001 — record that the server rejected these ops on the push
 * that just ran, bumping each op's `rejectionCount` and `lastError` in
 * `syncQueueV2`. Returns the opIds that are parked AFTER this call — either
 * because this rejection pushed them over `V2_OP_PARK_THRESHOLD`, or because
 * they were already parked from an earlier push — so `lib/sync/client.ts`'s
 * `runSyncV2` can tell "a blocking rejection the caller still needs to see"
 * apart from "a parked op we are quietly still retrying."
 *
 * An opId absent from `syncQueueV2` (already accepted/removed, or never
 * queued on this device) is silently skipped: there is nothing left to
 * record a rejection against, and this must never resurrect a deleted op.
 */
export async function recordV2Rejections(
  rejections: { opId: string; reason: string }[],
): Promise<Set<string>> {
  const parkedNow = new Set<string>();
  if (rejections.length === 0) return parkedNow;
  await withWriteLock(async () => {
    const db = await database;
    const transaction = db.transaction("syncQueueV2", "readwrite");
    const store = transaction.objectStore("syncQueueV2");
    for (const { opId, reason } of rejections) {
      const existing = await store.get(opId);
      if (!existing) continue;
      const rejectionCount = (existing.rejectionCount ?? 0) + 1;
      const parked = existing.parked === true || rejectionCount >= V2_OP_PARK_THRESHOLD;
      const updated: StoredSyncOpV2 = {
        ...existing,
        rejectionCount,
        lastError: reason,
        parked,
      };
      await store.put(updated);
      if (parked) parkedNow.add(opId);
    }
    await transaction.done;
  });
  return parkedNow;
}

/**
 * Parked ops this device is still holding — never deleted, never silently
 * resolved. Exposed so a future UI (or support flow) can recover the exact
 * body the learner wrote (`op.payload`) even though it stopped blocking
 * ordinary sync; see `StoredSyncOpV2.parked`'s own comment.
 */
export async function listParkedOps(): Promise<StoredSyncOpV2[]> {
  const ops = await getPendingV2Ops();
  return ops.filter((op) => op.parked === true);
}

/** The small status API SYNCFLUSH-001 asks for — what a sync-status notice needs to decide whether to show itself. */
export interface SyncStatusV2 {
  /** Every op still in the v2 outbox, parked or not. */
  pendingCount: number;
  /** The subset that is parked (see `StoredSyncOpV2.parked`). */
  parkedCount: number;
  /** How long the oldest still-pending op has been waiting, or null when the outbox is empty. */
  oldestPendingAgeMs: number | null;
}

export async function getSyncStatusV2(now: () => number = Date.now): Promise<SyncStatusV2> {
  const ops = await getPendingV2Ops();
  let parkedCount = 0;
  let oldestPendingAgeMs: number | null = null;
  const nowMs = now();
  for (const op of ops) {
    if (op.parked === true) parkedCount += 1;
    const age = nowMs - Date.parse(op.clientTime);
    if (!Number.isNaN(age) && (oldestPendingAgeMs === null || age > oldestPendingAgeMs)) {
      oldestPendingAgeMs = age;
    }
  }
  return { pendingCount: ops.length, parkedCount, oldestPendingAgeMs };
}

/**
 * SYNCFLUSH-001's "clean hook" into a local v2 write, for `lib/sync/client.ts`'s
 * background flush controller to debounce a trigger off of — see that
 * module's `createBackgroundSyncV2Controller`. In-memory only (module-level
 * listener set, exactly like `clear.ts`'s own `notClearedListeners`/
 * `notifyDeviceNotCleared` pair): there is nothing to persist here, a missed
 * notification in one tab costs nothing because the controller's own
 * interval/online/visibility triggers still eventually drain the outbox, and
 * every writer in this module already serializes through `WRITE_LOCK_NAME`,
 * so a listener never observes a half-written transaction.
 */
const localV2WriteListeners = new Set<() => void>();

export function subscribeLocalV2Writes(listener: () => void): () => void {
  localV2WriteListeners.add(listener);
  return () => {
    localV2WriteListeners.delete(listener);
  };
}

function notifyLocalV2Write(): void {
  for (const listener of localV2WriteListeners) listener();
}

/**
 * The shape a pulled `/api/sync/v2/pull` snapshot arrives in: one array per
 * v2 entity (a `SyncResponseV2` from lib/sync/client.ts, minus its
 * `serverTime`/`rejected` fields, which mergeRemoteChangesV2 has no use for
 * and simply ignores if present — structurally, the whole response object
 * satisfies this type, so callers pass it straight through). Each entity's
 * array is `unknown[]`, not the entity's own record interface, on purpose:
 * lib/api/sync-v2.ts's Zod-inferred response type already validated the
 * wire payload before this ever runs (mirroring `saveLocalV2Entity`'s own
 * `record: unknown` input below, which validates against `v2PayloadSchemas`
 * rather than trusting a caller-supplied type), and a second, independently
 * hand-maintained type here would just be another place for the two to
 * drift — see e.g. `ClaimEvidence.canonicalReference`, which is optional in
 * study-v2.ts but nullable over the wire. `Partial` because a test or a
 * future caller may legitimately supply only some entities.
 */
export type SyncSnapshotV2 = { [K in SyncEntityV2]: unknown[] };

/**
 * SYNCV2MERGE-001 — the v2 analogue of `mergeRemoteChanges` above, and the
 * other half of the v2 vault's write surface alongside `saveLocalV2Entity`.
 * Where `saveLocalV2EntityByName` is for a LOCALLY-authored edit and always
 * enqueues a fresh `syncQueueV2` op, this is for a SERVER-authored pull and
 * NEVER enqueues one — reusing the local writer for a pull would re-enqueue
 * every pulled row as a "local change" one revision behind what the server
 * just returned, which the server would then reject as a revision conflict
 * forever (see lib/sync/client.ts's `runSyncV2`, and SYNCV2ROUTE-001's own
 * note explaining why it stopped short of calling this). Proven by
 * tests/vault-v2-merge.test.ts: the outbox is asserted byte-identical
 * (deep-equal, in `getPendingV2Ops()` order) before and after a merge.
 *
 * Conflict rule (BUILD_PLAN.md tenet 4: "Client-clock last-write-wins is
 * retired in Phase 1 ... long-form prose (teaching drafts) must never be
 * silently overwritten"): this deliberately does NOT compare `updatedAt` or
 * `revision` clocks the way v1's `mergeRemoteChanges` above compares
 * `updatedAt` — a clock comparison is exactly the mechanism tenet 4 retires,
 * and a server clock racing ahead of an unsynced local edit is the case that
 * would silently destroy prose. Instead: an entity whose `syncQueueV2`
 * outbox still holds a PENDING op for that same entity+id is a local edit
 * this device has not yet gotten the server to acknowledge — the pulled row
 * for that id is skipped entirely and the local copy (and its queued op)
 * are left untouched, so the next push still carries it. An entity with NO
 * pending op has nothing of this device's own the server does not already
 * know about, so the pulled row is written. This is a strict membership
 * test against the outbox, not a heuristic: it never inspects a timestamp,
 * so a pulled row can never win a race against unsynced local prose no
 * matter how new the server's copy claims to be.
 *
 * Runs under the same `WRITE_LOCK_NAME` every other writer in this module
 * takes (shared mode), and every entity `put` plus the outbox `getAll` read
 * that decides which rows to skip happen inside ONE IndexedDB transaction
 * spanning all eight entity stores and `syncQueueV2` — if any `put` fails,
 * the whole transaction (and therefore the whole merge) rolls back, so a
 * partial merge can never be observed as committed.
 */
export async function mergeRemoteChangesV2(
  snapshot: Partial<SyncSnapshotV2>,
): Promise<void> {
  await withWriteLock(async () => {
    const db = await database;
    const transaction = db.transaction(
      [...SYNC_ENTITIES_V2, "syncQueueV2"],
      "readwrite",
    );
    // Same reasoning as saveLocalV2Entity's own no-op catches below: if a
    // later put in this loop aborts the transaction, this rejects too, but
    // whichever caller awaits mergeRemoteChangesV2() only ever observes the
    // rejection from the `put` call that actually threw — give this its own
    // handler now so that rejection is never reported as an unhandled one.
    transaction.done.catch(() => {});
    // Read-only against syncQueueV2 within this same transaction: decides
    // which pulled rows to skip, never writes here. That absence of any
    // `put`/`delete` against "syncQueueV2" in this function is the whole
    // proof obligation tests/vault-v2-merge.test.ts's outbox-byte-identical
    // assertion exists to pin down.
    const pendingOps = await transaction.objectStore("syncQueueV2").getAll();
    const pendingKeys = new Set(
      pendingOps.map((op) => `${op.entity}:${op.entityId}`),
    );
    for (const entity of SYNC_ENTITIES_V2) {
      const rows = (snapshot[entity] ?? []) as V2SyncableEntity[];
      if (rows.length === 0) continue;
      const store = transaction.objectStore(entity);
      for (const row of rows) {
        if (pendingKeys.has(`${entity}:${row.id}`)) continue;
        await store.put(row as never);
      }
    }
    await transaction.done;
  });
}

/** Durable, device-local review data. Kept separately so hydration and the
 * original outbox remain untouched until the learner explicitly reconciles. */
export interface StudyConflictV2 {
  key: string;
  entity: SyncEntityV2;
  entityId: string;
  local: Record<string, unknown>;
  remote: Record<string, unknown>;
  opIds: string[];
}
const conflictPrefix = "studyConflictV2:";

export async function captureStudyConflictsV2(snapshot: Partial<SyncSnapshotV2>): Promise<void> {
  await withWriteLock(async () => {
    const db = await database;
    const tx = db.transaction([...SYNC_ENTITIES_V2, "syncQueueV2", "meta"], "readwrite");
    tx.done.catch(() => {});
    const ops = await tx.objectStore("syncQueueV2").getAll();
    for (const saved of await tx.objectStore("meta").getAll()) {
      if (!saved.key.startsWith(conflictPrefix)) continue;
      const conflict = JSON.parse(saved.value) as StudyConflictV2;
      if (!ops.some(op => op.entity === conflict.entity && op.entityId === conflict.entityId)) {
        await tx.objectStore("meta").delete(saved.key);
      }
    }
    for (const entity of SYNC_ENTITIES_V2) {
      for (const row of snapshot[entity] ?? []) {
        const remote = row as Record<string, unknown>;
        const pending = ops.filter(op => op.entity === entity && op.entityId === remote.id);
        if (!pending.some(op => op.lastError?.startsWith("Revision conflict:"))) continue;
        const local = await tx.objectStore(entity).get(String(remote.id));
        if (!local || local.workspaceId !== remote.workspaceId) continue;
        const key = `${conflictPrefix}${entity}:${remote.id}`;
        const conflict: StudyConflictV2 = {
          key, entity, entityId: String(remote.id),
          local: local as unknown as Record<string, unknown>, remote,
          opIds: pending.map(op => op.opId),
        };
        await tx.objectStore("meta").put({ key, value: JSON.stringify(conflict) });
      }
    }
    await tx.done;
  });
}

export async function listStudyConflictsV2(): Promise<StudyConflictV2[]> {
  const db = await database;
  return (await db.getAll("meta"))
    .filter(row => row.key.startsWith(conflictPrefix))
    .map(row => JSON.parse(row.value) as StudyConflictV2);
}

/** Atomically archives both reviewed versions, replaces this entity's stale
 * ops, and queues a NEW idempotency key against the reviewed server revision.
 * Rejects a stale review if another tab/edit/pull changed either version.
 * A later server edit still causes ordinary optimistic-concurrency rejection. */
export async function resolveStudyConflictV2(review: StudyConflictV2, fields: Record<string, unknown>): Promise<void> {
  const deviceId = await getOrCreateDeviceId();
  await withWriteLock(async () => {
    const db = await database;
    const tx = db.transaction([review.entity, "syncQueueV2", "meta"], "readwrite");
    tx.done.catch(() => {});
    try {
      const saved = await tx.objectStore("meta").get(review.key);
      const local = await tx.objectStore(review.entity).get(review.entityId);
      const ops = await tx.objectStore("syncQueueV2").getAll();
      const pending = ops.filter(op => op.entity === review.entity && op.entityId === review.entityId);
      if (saved?.value !== JSON.stringify(review) || JSON.stringify(local) !== JSON.stringify(review.local) ||
          JSON.stringify(pending.map(op => op.opId)) !== JSON.stringify(review.opIds)) {
        throw new Error("These notes changed while you were reviewing. Reopen the comparison and try again.");
      }
      // Don't split a related mutation group or strand dependents. Ordinary
      // single-entity editor writes have neither; complex groups stay safe.
      const ids = new Set(review.opIds);
      if (ops.some(op => !ids.has(op.opId) && (op.dependsOn.some(id => ids.has(id)) ||
          pending.some(old => old.mutationGroupId === op.mutationGroupId)))) {
        throw new Error("These notes belong to a related set of changes and cannot be reconciled separately yet.");
      }
      const payload = v2PayloadSchemas[review.entity].parse({
        ...fields, id: review.entityId, workspaceId: review.local.workspaceId,
        createdAt: review.local.createdAt, revision: Number(review.remote.revision) + 1,
        updatedAt: new Date().toISOString(),
      }) as V2SyncableEntity;
      const op = opForV2(review.entity, payload, deviceId);
      op.baseRevision = Number(review.remote.revision);
      await tx.objectStore("meta").put({ key: `studyConflictArchiveV2:${op.opId}`, value: JSON.stringify(review) });
      await tx.objectStore(review.entity).put(payload as never);
      for (const id of review.opIds) await tx.objectStore("syncQueueV2").delete(id);
      await tx.objectStore("syncQueueV2").put(op);
      await tx.objectStore("meta").delete(review.key);
      await tx.done;
    } catch (error) {
      try { tx.abort(); } catch { /* already aborted */ }
      throw error;
    }
  });
  notifyLocalV2Write();
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
