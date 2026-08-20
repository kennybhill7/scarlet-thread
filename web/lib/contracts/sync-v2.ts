/**
 * v2 sync contract — Phase 1 (SYNCV2-001, extended by SYNCGAP-001).
 *
 * BUILD_PLAN.md tenet 7 / §3.4 and THEOLOGY_MASTER_BUILD_PLAN.md §14 ("Sync
 * v2"): sync push is the SOLE browser mutation path for learner entities; v2
 * resource routes are read-only. Today's frozen `SyncEntity`
 * (`lib/contracts.ts`) covers only `entry | thread | person | progress | log
 * | stage` — the eight v2 study entities BUILD_PLAN.md:144 adds have no sync
 * representation at all. This module is that representation.
 *
 * Per tenet 4 ("Additive contracts only") and the pattern `range-v1.ts` and
 * `study-v2.ts` already established: `lib/contracts.ts` stays byte-stable
 * and its v1 `SyncEntity` is untouched; this is a new versioned module.
 * Types and the runtime vocabulary only — Zod validation lives in
 * `lib/api/sync-v2.ts`, matching the existing `lib/contracts.ts` (types) /
 * `lib/api/sync.ts` (Zod) split.
 *
 * This task deliberately does NOT wire persistence: `lib/db/sync.ts` and
 * `db/schema.ts` are read-only for it. That follows once this contract is
 * agreed, so the two can be reviewed separately.
 *
 * ---------------------------------------------------------------------------
 * Resolved gap (SYNCGAP-001): `claim_evidence` and `motif_sightings` sync
 * entities.
 *
 * SYNCV2-001 originally left this open: THEOLOGY_MASTER_BUILD_PLAN.md §14's
 * prose named `evidence` as one of the "related offline creations" kinds,
 * but BUILD_PLAN.md:144's literal `SyncEntity` list only named six values,
 * omitting both `claim_evidence` (`ClaimEvidence` in `study-v2.ts`,
 * `claim_evidence` in `db/schema.ts`) and `motif_sightings`
 * (`MotifSighting`, `motif_sightings`) — a genuine list-vs-list conflict
 * between the two documents, not a "one is silent" case.
 *
 * Resolution: **each is its own top-level sync entity** (`evidence` and
 * `motifSighting`), never nested inside its parent's payload as an
 * aggregate/child array. Reasons:
 *
 * 1. THEOLOGY_MASTER_BUILD_PLAN.md §14's own prose already names `evidence`
 *    as a *sibling* in the "session, claim, evidence, motif, and
 *    connection" related-creation list — grouped with its parent via
 *    `mutationGroupId`, not folded inside it. That is the "own entity"
 *    shape, not the aggregate shape. Per BUILD_PLAN.md's own stated
 *    precedence for disagreements ("the master plan wins"), the master
 *    plan's shape governs once the two are reconciled to name the same
 *    entities.
 * 2. `ClaimEvidence` and `MotifSighting` both carry their own `revision`
 *    column in `db/schema.ts` and `study-v2.ts` — independent optimistic-
 *    concurrency state that only makes sense if each row can be pushed,
 *    conflict-checked, and idempotently retried on its own, exactly like
 *    `claim` and `motif` already are. An aggregate array folded into the
 *    parent's payload would have no way to carry a per-child `baseRevision`
 *    through the existing `SyncOpV2` envelope without inventing a second,
 *    parallel revision-conflict mechanism this task does not own.
 * 3. The atomic-group mechanics this module already built —
 *    `mutationGroupId`, `dependsOn`, `groupOpsByMutationGroupId`,
 *    `findDanglingDependsOnOpIds` — exist *specifically* to express "these
 *    related ops must be treated as one bounded unit" without requiring
 *    payload nesting. Reusing them for `evidence`/`motifSighting` needs no
 *    new mechanism; nesting would have required inventing one solely for
 *    these two entities while every other v2 entity uses the flat op shape.
 *
 * `claim_evidence` payloads name their parent via `claimId`;
 * `motif_sightings` payloads name theirs via `candidateId` — exactly like
 * `claim` already names its `sessionId`. A push that instead nests evidence
 * or sightings inside their parent's payload (the aggregate shape that was
 * NOT chosen) is rejected: every payload schema below is `.strict()`, so an
 * extra `evidence`/`sightings` array key on a `claim`/`motif` payload fails
 * validation rather than being silently accepted or ignored (see
 * `lib/api/sync-v2.ts` and `tests/sync-v2.test.ts` for the enforcing schemas
 * and the test that proves it).
 *
 * One remaining, narrower, out-of-scope gap: `db/schema.ts`'s
 * `claim_evidence` table (added by SCHEMAFU-001, after `study-v2.ts`'s
 * `ClaimEvidence` interface was written by STUDYV2-001) carries a
 * `connectionId` column that `study-v2.ts`'s own header already flags as
 * missing from its `ClaimEvidence` interface (gap #5 there). `study-v2.ts`
 * is read-only for this task, so `syncClaimEvidenceV2Schema` below mirrors
 * that interface as written (no `connectionId`) rather than inventing a
 * field absent from its read-only source of truth; closing that gap needs a
 * task that owns `study-v2.ts`.
 * ---------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// The v2 sync entity vocabulary — BUILD_PLAN.md:144's eight-item list (as
// reconciled by SYNCGAP-001), as a runtime-checkable const array (never a
// hand-retyped string literal union living next to it).
// ---------------------------------------------------------------------------

export const SYNC_ENTITIES_V2 = [
  "session",
  "claim",
  "evidence",
  "motif",
  "motifSighting",
  "connection",
  "application",
  "teachingDraft",
] as const;

export type SyncEntityV2 = (typeof SYNC_ENTITIES_V2)[number];

export function isSyncEntityV2(value: string): value is SyncEntityV2 {
  return (SYNC_ENTITIES_V2 as readonly string[]).includes(value);
}

export const SYNC_MUTATIONS_V2 = ["upsert", "delete"] as const;
export type SyncMutationV2 = (typeof SYNC_MUTATIONS_V2)[number];
export function isSyncMutationV2(value: string): value is SyncMutationV2 {
  return (SYNC_MUTATIONS_V2 as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The push envelope — master plan §14's protocol JSON example, field for
// field: opId, deviceId, entity, entityId, mutation, baseRevision,
// mutationGroupId, dependsOn, payload, clientTime.
// ---------------------------------------------------------------------------

export interface SyncOpV2 {
  /** Client-generated idempotency key for this operation. */
  opId: string;
  /** Which device produced this op (§14 `devices` table). */
  deviceId: string;
  entity: SyncEntityV2;
  /** The entity's own primary key (`db/schema.ts` v2 tables key on plain text ids, not necessarily UUIDs). */
  entityId: string;
  mutation: SyncMutationV2;
  /**
   * The revision the client believes is current, for optimistic-concurrency
   * conflict detection. §14 explicitly leaves "create baseRevision
   * semantics" undefined ("Define retention, maximum batch/log sizes,
   * conflict-payload limits, create baseRevision semantics, delete conflicts
   * ...") — flagged rather than silently resolved. This module treats `null`
   * as "no prior revision to compare against" (a create), which is the only
   * reading consistent with `revision` starting at 1 in `db/schema.ts`; a
   * later task that wires persistence must confirm or replace this reading.
   */
  baseRevision: number | null;
  /** Ties a related-creation group into one bounded atomic unit (§14). */
  mutationGroupId: string;
  /** opIds that must be applied before this one, for when true atomicity is not possible (§14). */
  dependsOn: string[];
  payload: unknown;
  /** Client clock at the time of the change (§14's protocol field name; the v2 analogue of v1 `SyncOp.updatedAt`). */
  clientTime: string;
}

export interface SyncPushRequestV2 {
  ops: SyncOpV2[];
}
