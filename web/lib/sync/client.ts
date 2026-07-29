"use client";

import type { SyncOp, SyncResponse } from "@/lib/contracts";
import { syncResponseSchema } from "@/lib/api/sync";
import {
  getLastPull,
  getPendingOps,
  mergeRemoteChanges,
  removePendingOps,
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
