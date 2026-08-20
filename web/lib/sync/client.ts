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
  getLastPull,
  getPendingOps,
  getPendingV2Ops,
  mergeRemoteChanges,
  removePendingOps,
  removePendingV2Ops,
  setLastPull,
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
 * Pull-side scope note (SCOPE-BOUNDARY-001): `/api/sync/v2/pull` is called
 * and its snapshot is returned to the caller, proving the route is live and
 * reachable end to end. It is deliberately NOT written into the local v2
 * entity object stores here. `lib/sync/store.ts`'s only v2 write path,
 * `saveLocalV2EntityByName`, always enqueues a fresh outbound op for
 * whatever it writes (by design, for locally-authored edits) — reusing it
 * for a server-authored pull would re-enqueue every pulled row as a new
 * "local change" on a `baseRevision` one behind what the server just
 * returned, which the server would then permanently re-reject as a revision
 * conflict on every subsequent sync. Closing this needs a merge function in
 * `lib/sync/store.ts` (read-only for this task) that writes an entity
 * WITHOUT enqueueing an outbox op — the v2 analogue of `mergeRemoteChanges`.
 * A future task should add it and call it from here.
 */
async function runSyncV2() {
  const pending = await getPendingV2Ops();
  const pushedIds: string[] = [];
  const rejected: SyncResponseV2["rejected"] = [];

  if (pending.length > 0) {
    for (const batch of batchSyncOpsV2(pending)) {
      const pushed = await readResponseV2(
        await fetch("/api/sync/v2/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ops: batch }),
        }),
      );
      const rejectedIds = new Set(pushed.rejected.map((item) => item.opId));
      const acceptedIds = batch
        .filter((op) => !rejectedIds.has(op.opId))
        .map((op) => op.opId);
      await removePendingV2Ops(acceptedIds);
      pushedIds.push(...acceptedIds);
      rejected.push(...pushed.rejected);
    }
  }

  const pulled = await readResponseV2(await fetch("/api/sync/v2/pull"));

  if (rejected.length > 0) {
    throw new SyncRejectedErrorV2(rejected);
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
