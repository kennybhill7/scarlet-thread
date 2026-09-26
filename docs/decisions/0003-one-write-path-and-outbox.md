# ADR 0003: One write path: IndexedDB outbox, then sync push

- Date: 2026-09-25
- Status: Accepted (with two named exceptions and one open question, below)

## Context

The app is local-first: learner work (entries, threads, claims, connections, applications, teaching drafts) must be writable offline and must reach Postgres exactly once, in order, without a second mutation path that could bypass the server's checks. BUILD_PLAN.md states this as design tenet 7 ("One write path. Sync push is the sole browser mutation path for learner entities; resource routes are read-only. The browser never both enqueues an op and calls an independent REST mutation.") and §3.4 ("All browser writes go through sync push").

## Decision

1. **Local half.** Every browser write to a learner entity is one IndexedDB transaction that writes the entity store and the outbox together. v1 writers put to `entries`/`threads`/`progress`/`logs`/`people` plus `syncQueue`; v2 writers (`web/lib/sync/store.ts`, the function around lines 484-530) validate the payload against `v2PayloadSchemas[entity]`, then put the entity and its `SyncOpV2` into `syncQueueV2` in a single transaction, so neither survives without the other. All writers hold a shared Web Lock (`WRITE_LOCK_NAME`) so a device-clear (`lib/sync/clear.ts`) can hold it exclusively.
2. **Server half.** The outbox is drained by `POST /api/sync/push` (v1) and `POST /api/sync/v2/push` (v2). The v2 route authenticates, validates with `syncPushV2Schema` from `lib/api/sync-v2.ts`, and delegates all persistence, tenant-ownership and idempotency checks to `pushSyncOpsV2` in `lib/db/sync-v2.ts`. The route adds no persistence logic of its own.
3. **Read-only resource routes.** v2 GET routes go through `withReadOnlyV2Workspace` (`app/api/v2/_lib/guard.ts`), which rejects every non-GET via the single predicate `assertReadOnlyV2ResourceRequest` and derives the workspace from the session, never from request input. Mutating verbs on those routes call `rejectMutation`.

Named exceptions:

- **Motif confirm/dismiss** (`POST /api/motifs/[id]`, RADARUI-001) is a server-side transition on a server-computed candidate, not a client-authored edit; it also atomically writes a v1 `threads` row the v2 wire format has no entity for. Consequence held in `pushSyncOpsV2`: sync push must not be able to set `motif.status` to `promoted` (MOTIFSTATUS-001).
- Client-only reads are not writes and are unrestricted.

## Consequences

- One place to add validation, idempotency and tenant checks (`pushSyncOpsV2`); a second write path is a defect by definition.
- Offline writes cannot be lost between "entity saved" and "op queued" (same transaction).
- The local vault is a write buffer, not a read model: v2 entities on the study page are still read from the server. Making reads local-first is separate work (STUDYOFFLINE-001 in the product plan).
- OPEN, UNVERIFIED: v1 REST mutation routes still exist server-side (`POST /api/entries`, `PATCH`/`DELETE /api/entries/[id]`, `POST /api/threads`). A search of `components/`, `lib/` and `app/` found no client caller of them, but they are reachable by an authenticated request and are a second write path in the tenet-7 sense. Whether to remove them or document them as an exception is undecided; nobody has read each route body for what it enforces.
- Whether the v2 push route rejects stale `baseRevision` and surfaces a conflict to the client was not verified for this record (product plan §1.3 lists it as unverified too).
