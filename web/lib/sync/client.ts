"use client";

import { z } from "zod";

import type { SyncOp, SyncResponse } from "@/lib/contracts";
import { syncResponseSchema } from "@/lib/api/sync";
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
import type { SyncOpV2 } from "@/lib/contracts/sync-v2";
import {
  captureStudyConflictsV2,
  getLastPull,
  getPendingOps,
  getPendingV2Ops,
  listStudyConflictsV2,
  mergeRemoteChanges,
  mergeRemoteChangesV2,
  recordV2Rejections,
  removePendingOps,
  removePendingV2Ops,
  setLastPull,
  subscribeLocalV2Writes,
} from "@/lib/sync/store";

export class SyncRejectedError extends Error {
  constructor(
    readonly rejected: SyncResponse["rejected"],
    message = "Some changes could not be synced",
  ) {
    super(message);
    this.name = "SyncRejectedError";
  }
}

const MAX_PUSH_OPS = 100;
const MAX_PUSH_BYTES = 1_000_000;

export function batchSyncOps(ops: SyncOp[]) {
  const batches: SyncOp[][] = [];
  let current: SyncOp[] = [];
  let currentBytes = 10;

  for (const op of ops) {
    const opBytes = new TextEncoder().encode(JSON.stringify(op)).byteLength + 1;
    if (
      current.length > 0 &&
      (current.length >= MAX_PUSH_OPS ||
        currentBytes + opBytes > MAX_PUSH_BYTES)
    ) {
      batches.push(current);
      current = [];
      currentBytes = 10;
    }
    current.push(op);
    currentBytes += opBytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function readResponse(response: Response): Promise<SyncResponse> {
  if (!response.ok) {
    throw new Error(`Sync request failed with status ${response.status}`);
  }
  const parsed = syncResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Sync server returned an invalid response");
  }
  return parsed.data;
}

async function runSync() {
  const priority = {
    "thread:upsert": 0,
    "entry:upsert": 1,
    "progress:upsert": 1,
    "log:upsert": 1,
    "person:upsert": 1,
    "stage:upsert": 1,
    "entry:delete": 2,
    "progress:delete": 2,
    "log:delete": 2,
    "person:delete": 2,
    "stage:delete": 2,
    "thread:delete": 3,
  } as const;
  const pending = (await getPendingOps()).sort((a, b) => {
    const aKey = `${a.entity}:${a.op}` as keyof typeof priority;
    const bKey = `${b.entity}:${b.op}` as keyof typeof priority;
    const byDependency = priority[aKey] - priority[bKey];
    return (
      byDependency ||
      Date.parse(a.updatedAt) - Date.parse(b.updatedAt)
    );
  });
  const pushedIds: string[] = [];

  if (pending.length > 0) {
    for (const batch of batchSyncOps(pending)) {
      const pushed = await readResponse(
        await fetch("/api/sync/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ops: batch }),
        }),
      );
      const rejectedIds = new Set(pushed.rejected.map((item) => item.id));
      const acceptedIds = batch
        .filter((op) => !rejectedIds.has(op.id))
        .map((op) => op.id);
      await mergeRemoteChanges(
        pushed.entries,
        pushed.threads,
        pushed.progress,
        pushed.logs,
        pushed.people,
      );
      await setLastPull(pushed.serverTime);
      await removePendingOps(acceptedIds);
      pushedIds.push(...acceptedIds);
      if (pushed.rejected.length > 0) {
        throw new SyncRejectedError(pushed.rejected);
      }
    }
  }

  const since = await getLastPull();
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  const pulled = await readResponse(await fetch(`/api/sync/pull${query}`));
  await mergeRemoteChanges(
    pulled.entries,
    pulled.threads,
    pulled.progress,
    pulled.logs,
    pulled.people,
  );
  await setLastPull(pulled.serverTime);

  return {
    pushed: pushedIds.length,
    pulled:
      pulled.entries.length +
      pulled.threads.length +
      pulled.progress.length +
      pulled.logs.length +
      pulled.people.length,
    serverTime: pulled.serverTime,
  };
}

let inFlight: ReturnType<typeof runSync> | null = null;

export function syncNow() {
  if (!inFlight) {
    inFlight = runSync().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

export function installOnlineSync(onError?: (error: unknown) => void) {
  const run = () => {
    void syncNow().catch((error) => onError?.(error));
  };
  window.addEventListener("online", run);
  return () => window.removeEventListener("online", run);
}

// ---------------------------------------------------------------------------
// v2 — SYNCV2ROUTE-001. Drives the push loop off exactly what V2VAULT-001's
// `lib/sync/store.ts` exposes for the v2 outbox: `getPendingV2Ops` /
// `removePendingV2Ops` around `syncQueueV2`. `lib/sync/store.ts` is
// read-only for this task, so this reuses those two functions as they stand
// rather than adding a new store-level API.
//
// The response envelope is validated against the SAME per-entity payload
// schemas `lib/api/sync-v2.ts` already exports (`syncStudySessionV2Schema`
// et al.) — not a second, hand-typed copy of what a valid v2 record looks
// like — mirroring how `lib/api/sync.ts`'s `syncResponseSchema` validates
// v1's response with the same schemas the push side uses.
// ---------------------------------------------------------------------------

const syncResponseV2Schema = z
  .object({
    serverTime: z.string().min(1),
    session: z.array(syncStudySessionV2Schema),
    claim: z.array(syncStudyClaimV2Schema),
    evidence: z.array(syncClaimEvidenceV2Schema),
    motif: z.array(syncMotifCandidateV2Schema),
    motifSighting: z.array(syncMotifSightingV2Schema),
    connection: z.array(syncUserConnectionV2Schema),
    application: z.array(syncApplicationV2Schema),
    teachingDraft: z.array(syncTeachingDraftV2Schema),
    rejected: z.array(
      z.object({ opId: z.string(), reason: z.string() }).strict(),
    ),
  })
  .strict();

export type SyncResponseV2 = z.infer<typeof syncResponseV2Schema>;

export class SyncRejectedErrorV2 extends Error {
  constructor(
    readonly rejected: SyncResponseV2["rejected"],
    message = "Some v2 changes could not be synced",
  ) {
    super(message);
    this.name = "SyncRejectedErrorV2";
  }
}

const MAX_PUSH_OPS_V2 = 100;
const MAX_PUSH_BYTES_V2 = 1_000_000;

/** Same size-bounded batching `batchSyncOps` does for v1, applied to the v2
 *  envelope shape. Ops are batched in the order `getPendingV2Ops` returns
 *  them (its `clientTime` index — i.e. creation order), which is also the
 *  order a related-creation group's members were written locally, so a
 *  parent (e.g. a session) lands in the same or an earlier batch than a
 *  child created after it. */
export function batchSyncOpsV2(ops: SyncOpV2[]) {
  const batches: SyncOpV2[][] = [];
  let current: SyncOpV2[] = [];
  let currentBytes = 10;

  for (const op of ops) {
    const opBytes = new TextEncoder().encode(JSON.stringify(op)).byteLength + 1;
    if (
      current.length > 0 &&
      (current.length >= MAX_PUSH_OPS_V2 ||
        currentBytes + opBytes > MAX_PUSH_BYTES_V2)
    ) {
      batches.push(current);
      current = [];
      currentBytes = 10;
    }
    current.push(op);
    currentBytes += opBytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * The wire-only shape of an op, stripped of `StoredSyncOpV2`'s local
 * bookkeeping fields (`rejectionCount`/`lastError`/`parked`, SYNCFLUSH-001)
 * before it is ever `JSON.stringify`-ed into a push body. The server's
 * `syncOpV2Schema` (`lib/api/sync-v2.ts`) is `.strict()`, so sending those
 * extra properties would get the WHOLE push rejected by the server's own
 * Zod parse rather than by `planWrite`'s intended conflict logic — this
 * keeps the wire protocol exactly what it was before this task, per that
 * task's own "keep ... server semantics unchanged" instruction.
 */
function toWireOpV2(op: SyncOpV2): SyncOpV2 {
  return {
    opId: op.opId,
    deviceId: op.deviceId,
    entity: op.entity,
    entityId: op.entityId,
    mutation: op.mutation,
    baseRevision: op.baseRevision,
    mutationGroupId: op.mutationGroupId,
    dependsOn: op.dependsOn,
    payload: op.payload,
    clientTime: op.clientTime,
  };
}

async function readResponseV2(response: Response): Promise<SyncResponseV2> {
  if (!response.ok) {
    throw new Error(`v2 sync request failed with status ${response.status}`);
  }
  const parsed = syncResponseV2Schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("v2 sync server returned an invalid response");
  }
  return parsed.data;
}

/**
 * The v2 push half: drains `syncQueueV2` (`getPendingV2Ops`) through the
 * live `/api/sync/v2/push` route (SYNCV2ROUTE-001) this task wires up, and
 * removes exactly the ops the server accepted (`removePendingV2Ops`) — a
 * rejected op (e.g. MOTIFSTATUS-001's promotion refusal firing through this
 * exact path) stays queued and is surfaced via `SyncRejectedErrorV2` rather
 * than silently dropped or silently retried forever.
 *
 * Pull-side (SYNCV2MERGE-001, closing the gap SYNCV2ROUTE-001 flagged above
 * its original scope): `/api/sync/v2/pull` is called and its snapshot is
 * applied to the local v2 entity object stores through
 * `mergeRemoteChangesV2` — the v2 analogue of `mergeRemoteChanges`, which
 * writes each pulled row WITHOUT enqueueing a fresh `syncQueueV2` op. Reusing
 * `saveLocalV2EntityByName` (the local-write path) here would have
 * re-enqueued every pulled row as a new "local change" on a `baseRevision`
 * one behind what the server just returned, which the server would then
 * permanently re-reject as a revision conflict on every subsequent sync —
 * see `mergeRemoteChangesV2`'s own header in `lib/sync/store.ts` for the
 * full conflict rule (an entity with a still-pending outbox op is left
 * untouched by the pull; BUILD_PLAN.md tenet 4 forbids silently overwriting
 * unsynced long-form prose with a clock comparison). This makes v2 sync
 * two-way end to end: a second device's pushed change now lands here on the
 * next pull.
 *
 * SYNCFLUSH-001 — the wedge fix (New risk #3 in
 * design/OPEN_QUESTIONS_AUDIT_2026-09-25.md): before this task, EVERY
 * rejection threw `SyncRejectedErrorV2`, forever, because a rejected op is
 * (correctly) never removed and `mergeRemoteChangesV2` (correctly) never
 * overwrites an entity with a pending op — so a single op the server will
 * never accept (a genuine conflict, not a transient one) wedged this
 * function into throwing on every future call, which is `StudyEntry.tsx`'s
 * ONLY caller of this, which is "Start a study"'s only path to the server.
 * Now: every rejection is recorded via `recordV2Rejections` (bumping that
 * op's `rejectionCount` in `syncQueueV2`); once an op's rejections reach
 * `V2_OP_PARK_THRESHOLD` (3, whether that happened just now or on an earlier
 * call), it is "parked" — still queued, still retried on the next push
 * (nothing here stops trying it; if whatever caused the conflict resolves
 * server-side, a parked op can still succeed and quietly leave the outbox
 * like any other accepted op), but its rejection no longer counts toward
 * `blockingRejections` below, so it no longer throws. A FRESH rejection
 * (rejectionCount 1 or 2) still throws exactly as before — this only stops
 * the PERMANENT wedge, it does not hide a brand-new conflict on first sight.
 */
async function runSyncV2() {
  // Once both versions are available, hold EVERY op for that entity. Later
  // local edits must not accidentally acquire the server revision and bypass
  // the learner's review. Pending membership still protects hydration.
  const conflicts = await listStudyConflictsV2();
  const held = new Set(conflicts.map(conflict => `${conflict.entity}:${conflict.entityId}`));
  const queued = await getPendingV2Ops();
  const heldGroups = new Set(queued.filter(op => held.has(`${op.entity}:${op.entityId}`)).map(op => op.mutationGroupId));
  // Keep related groups/dependents intact while one member awaits review.
  let changed = true;
  while (changed) {
    changed = false;
    const heldIds = new Set(queued.filter(op => heldGroups.has(op.mutationGroupId)).map(op => op.opId));
    for (const op of queued) {
      if (!heldGroups.has(op.mutationGroupId) && op.dependsOn.some(id => heldIds.has(id))) {
        heldGroups.add(op.mutationGroupId); changed = true;
      }
    }
  }
  const pending = queued.filter(op => !heldGroups.has(op.mutationGroupId));
  const pushedIds: string[] = [];
  const blockingRejections: SyncResponseV2["rejected"] = [];

  if (pending.length > 0) {
    for (const batch of batchSyncOpsV2(pending)) {
      const pushed = await readResponseV2(
        await fetch("/api/sync/v2/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ops: batch.map(toWireOpV2) }),
        }),
      );
      const rejectedIds = new Set(pushed.rejected.map((item) => item.opId));
      const acceptedIds = batch
        .filter((op) => !rejectedIds.has(op.opId))
        .map((op) => op.opId);
      await removePendingV2Ops(acceptedIds);
      pushedIds.push(...acceptedIds);

      if (pushed.rejected.length > 0) {
        const parkedNow = await recordV2Rejections(pushed.rejected);
        for (const rejection of pushed.rejected) {
          if (!parkedNow.has(rejection.opId)) {
            blockingRejections.push(rejection);
          }
        }
      }
    }
  }

  const pulled = await readResponseV2(await fetch("/api/sync/v2/pull"));
  await captureStudyConflictsV2(pulled);
  await mergeRemoteChangesV2(pulled);

  if (blockingRejections.length > 0) {
    throw new SyncRejectedErrorV2(blockingRejections);
  }

  return {
    pushed: pushedIds.length,
    pulled:
      pulled.session.length +
      pulled.claim.length +
      pulled.evidence.length +
      pulled.motif.length +
      pulled.motifSighting.length +
      pulled.connection.length +
      pulled.application.length +
      pulled.teachingDraft.length,
    serverTime: pulled.serverTime,
  };
}

let inFlightV2: ReturnType<typeof runSyncV2> | null = null;

export function syncNowV2() {
  if (!inFlightV2) {
    inFlightV2 = runSyncV2().finally(() => {
      inFlightV2 = null;
    });
  }
  return inFlightV2;
}

export function installOnlineSyncV2(onError?: (error: unknown) => void) {
  const run = () => {
    void syncNowV2().catch((error) => onError?.(error));
  };
  window.addEventListener("online", run);
  return () => window.removeEventListener("online", run);
}

// ---------------------------------------------------------------------------
// Background v2 flushing — SYNCFLUSH-001, New risk #1 in
// design/OPEN_QUESTIONS_AUDIT_2026-09-25.md ("v2 study writes are not synced
// until a new study is started from the reader"). Before this task,
// `syncNowV2()`'s only caller anywhere was `StudyEntry.tsx`'s "Start a
// study" tap — every claim/evidence/application/connection/teaching-draft
// edit a learner made through the other workspace sections sat in
// `syncQueueV2` until they next tapped "Study", and `installOnlineSyncV2`
// (just above) had zero callers. This is the thing that actually drains the
// outbox in the background: `components/sync/SyncRegistration.tsx` mounts
// it once, alongside the existing v1 `installOnlineSync`.
// ---------------------------------------------------------------------------

/** The subset of EventTarget this controller needs — real `window`/`document` satisfy it; tests inject a fake. */
interface SyncEventTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface BackgroundSyncV2Deps {
  /** Defaults to the real `syncNowV2`. Injectable so tests never touch IndexedDB or the network. */
  sync?: () => Promise<unknown>;
  /** Called with every sync failure (network, HTTP, or a genuine `SyncRejectedErrorV2`). Never thrown. */
  onError?: (error: unknown) => void;
  /** Defaults to `navigator.onLine !== false`. */
  isOnline?: () => boolean;
  /** Defaults to `document.visibilityState !== "hidden"`. */
  isVisible?: () => boolean;
  /** Fires "online". Defaults to `window` when present. */
  windowTarget?: SyncEventTarget | null;
  /** Fires "visibilitychange". Defaults to `document` when present. */
  documentTarget?: SyncEventTarget | null;
  /** A clean hook into a local v2 write (`lib/sync/store.ts`), debounced below. Defaults to `subscribeLocalV2Writes`. */
  subscribeWrites?: (listener: () => void) => () => void;
  /** The recurring interval while visible and online. Default 60s, per this task's own spec. */
  intervalMs?: number;
  /** How long to wait, after a local v2 write, before syncing. Default 2s. */
  writeDebounceMs?: number;
  /** The first backoff delay after a failure. Doubles each consecutive failure, capped at `maxBackoffMs`. Default 2s. */
  baseBackoffMs?: number;
  /** The backoff ceiling. Default 5 minutes. */
  maxBackoffMs?: number;
  setTimeoutFn?: (callback: () => void, delayMs: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface BackgroundSyncV2Controller {
  /** Removes every listener and cancels every pending timer. Idempotent. */
  stop(): void;
  /** Runs a sync right now (still single-flight, still silent when offline) — exposed for tests and for a future manual "sync now" affordance. */
  triggerNow(): void;
}

/**
 * Wires `syncNowV2()` into: an immediate run on creation, the `online`
 * event, `visibilitychange` (only the transition TO visible), a 60s
 * interval while the tab is visible, and a debounced trigger after a local
 * v2 write (`subscribeLocalV2Writes`). Every path funnels through the SAME
 * `attempt()`, which — on top of `syncNowV2()`'s own module-level
 * single-flight guard (`inFlightV2` above, shared by every caller in the
 * whole app) — also refuses to start a SECOND attempt from this controller
 * while its own is still in flight, so the backoff bookkeeping below can
 * never see two overlapping outcomes race each other.
 *
 * Silent when offline: `attempt()` checks `isOnline()` BEFORE calling
 * `sync()` and simply reschedules the normal interval instead — no error,
 * nothing thrown, nothing logged. Backoff only ever follows a REAL attempt
 * that actually failed (network error, non-2xx, or a genuine
 * `SyncRejectedErrorV2` for a fresh, non-parked conflict — see `runSyncV2`'s
 * own header for what counts as "fresh" now that parked ops stop blocking
 * it) — offline is not a failure, it is the expected steady state of an
 * offline-first app, and treating it as one would back off the very first
 * reconnect attempt for no reason.
 *
 * Never throws into React: every call this makes is wrapped so a rejection
 * reaches only `onError` (optional, and itself never awaited or allowed to
 * throw back into here), never the caller of `triggerNow()`/the event
 * listeners this installs. Never logs a body or a secret: the only thing
 * passed to `onError` is whatever `sync()` itself threw, which — per
 * `runSyncV2`'s contract — is at most a `SyncRejectedErrorV2` (server
 * rejection reasons only, see `StoredSyncOpV2.lastError`'s own comment in
 * `lib/sync/store.ts`) or a plain network/HTTP `Error`'s message.
 *
 * Timer-driven attempts (the recurring interval, and backoff retries after
 * a failure) additionally require `isVisible()` — a hidden tab reschedules
 * without syncing rather than spending a request in the background. The
 * four EXPLICIT triggers (the initial run, `online`, `visibilitychange`-to-
 * visible, and the debounced write trigger) always run when online,
 * regardless of visibility, because each already represents a concrete
 * reason to sync right now.
 */
export function createBackgroundSyncV2Controller(
  deps: BackgroundSyncV2Deps = {},
): BackgroundSyncV2Controller {
  const sync = deps.sync ?? syncNowV2;
  const onError = deps.onError;
  const isOnline =
    deps.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  const isVisible =
    deps.isVisible ??
    (() => typeof document === "undefined" || document.visibilityState !== "hidden");
  const windowTarget =
    deps.windowTarget ?? (typeof window === "undefined" ? null : (window as SyncEventTarget));
  const documentTarget =
    deps.documentTarget ?? (typeof document === "undefined" ? null : (document as SyncEventTarget));
  const subscribeWrites = deps.subscribeWrites ?? subscribeLocalV2Writes;
  const intervalMs = deps.intervalMs ?? 60_000;
  const writeDebounceMs = deps.writeDebounceMs ?? 2_000;
  const baseBackoffMs = deps.baseBackoffMs ?? 2_000;
  const maxBackoffMs = deps.maxBackoffMs ?? 5 * 60_000;
  const setTimeoutFn = deps.setTimeoutFn ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimeoutFn = deps.clearTimeoutFn ?? ((handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]));

  let stopped = false;
  let inFlight = false;
  let consecutiveFailures = 0;
  let intervalTimer: unknown;
  let writeDebounceTimer: unknown;

  function scheduleInterval(delayMs: number) {
    if (stopped) return;
    if (intervalTimer !== undefined) clearTimeoutFn(intervalTimer);
    intervalTimer = setTimeoutFn(() => {
      void attempt({ requireVisible: true });
    }, delayMs);
  }

  async function attempt(options: { requireVisible?: boolean } = {}): Promise<void> {
    if (stopped) return;
    if (options.requireVisible && !isVisible()) {
      scheduleInterval(intervalMs);
      return;
    }
    if (!isOnline()) {
      // Silent, not a failure — see header. The next `online` event (or the
      // next visible interval tick, which re-checks `isOnline()` itself)
      // retries; nothing here needs to remember that this attempt was
      // skipped.
      scheduleInterval(intervalMs);
      return;
    }
    if (inFlight) return; // this controller's own single-flight guard — see header.
    inFlight = true;
    try {
      await sync();
      consecutiveFailures = 0;
      scheduleInterval(intervalMs);
    } catch (error) {
      consecutiveFailures += 1;
      try {
        onError?.(error);
      } catch {
        // onError must never be able to break the scheduler.
      }
      const backoff = Math.min(maxBackoffMs, baseBackoffMs * 2 ** (consecutiveFailures - 1));
      scheduleInterval(backoff);
    } finally {
      inFlight = false;
    }
  }

  function triggerNow(): void {
    if (stopped) return;
    void attempt();
  }

  const onOnline = () => triggerNow();
  const onVisibilityChange = () => {
    if (isVisible()) triggerNow();
  };

  windowTarget?.addEventListener("online", onOnline);
  documentTarget?.addEventListener("visibilitychange", onVisibilityChange);

  const unsubscribeWrites = subscribeWrites(() => {
    if (stopped) return;
    if (writeDebounceTimer !== undefined) clearTimeoutFn(writeDebounceTimer);
    writeDebounceTimer = setTimeoutFn(() => {
      writeDebounceTimer = undefined;
      triggerNow();
    }, writeDebounceMs);
  });

  // The "sync on mount" half of this task's spec. Runs through the same
  // `attempt()` as everything else, so an immediately-offline mount is
  // silent rather than surfacing a spurious error.
  triggerNow();

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      if (intervalTimer !== undefined) clearTimeoutFn(intervalTimer);
      if (writeDebounceTimer !== undefined) clearTimeoutFn(writeDebounceTimer);
      windowTarget?.removeEventListener("online", onOnline);
      documentTarget?.removeEventListener("visibilitychange", onVisibilityChange);
      unsubscribeWrites();
    },
    triggerNow,
  };
}

/** Convenience wrapper matching `installOnlineSyncV2`'s own call shape, for `SyncRegistration.tsx`. */
export function installBackgroundSyncV2(
  onError?: (error: unknown) => void,
): BackgroundSyncV2Controller {
  return createBackgroundSyncV2Controller({ onError });
}
