/**
 * v2 sync contract — Phase 1 (SYNCV2-001).
 *
 * BUILD_PLAN.md tenet 7 / §3.4 and THEOLOGY_MASTER_BUILD_PLAN.md §14 ("Sync
 * v2"): sync push is the SOLE browser mutation path for learner entities; v2
 * resource routes are read-only. Today's frozen `SyncEntity`
 * (`lib/contracts.ts`) covers only `entry | thread | person | progress | log
 * | stage` — the six v2 study entities BUILD_PLAN.md:144 adds have no sync
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
 * Known gaps in the source docs, reported rather than silently resolved, per
 * this task's instructions and the precedent `study-v2.ts` already set for
 * doc gaps:
 *
 * 1. THEOLOGY_MASTER_BUILD_PLAN.md §14 prose says "Related offline
 *    creations—session, claim, evidence, motif, and connection—use a
 *    bounded atomic mutationGroupId", naming `evidence` as one of the
 *    related-creation kinds. But BUILD_PLAN.md:144, which is the section
 *    that actually enumerates the `SyncEntity` extension list this task
 *    builds ("Extend `SyncEntity` with the six new entities —
 *    `"session" | "claim" | "motif" | "connection" | "application" |
 *    "teachingDraft"`"), does NOT include `evidence` among the six, and this
 *    task's own acceptance criteria repeat that exact six-item list. `claim
 *    evidence` (`ClaimEvidence` in `study-v2.ts`, `claim_evidence` in
 *    `db/schema.ts`) therefore has no v2 sync entity of its own yet — a
 *    related `session` + `claim` + `claim evidence` offline creation cannot
 *    be pushed as one group until a future task adds it (and decides
 *    whether evidence rides inside its claim's payload or gets a seventh
 *    entity). This module follows BUILD_PLAN.md's explicit six-item list,
 *    the same authority order `study-v2.ts` already used ("no conflict...
 *    one is silent, not contradictory" does not apply here — this IS a
 *    direct list mismatch between the two docs, so BUILD_PLAN.md's own
 *    stated precedence for disagreements, "the master plan wins", would
 *    normally apply; it is not applied here because master plan §14 is
 *    prose describing the intended grouping *behavior*, not a table naming
 *    the entity list the way BUILD_PLAN.md:144 does, and this task's
 *    acceptance criteria pin the literal six).
 * 2. `study-v2.ts` types both `MotifCandidate` and `MotifSighting` as
 *    separate record interfaces (a sighting links a candidate to one
 *    specific passage occurrence), but the six-item vocabulary has only one
 *    `motif` entity. `lib/api/sync-v2.ts`'s `syncMotifCandidateV2Schema`
 *    maps `motif` to `MotifCandidate` only; `MotifSighting` has no sync
 *    entity of its own yet, the same class of gap as `evidence` above.
 *
 * The atomic-group mechanics below (`mutationGroupId`, `dependsOn`) are
 * entity-agnostic and need no change to carry `evidence` or `MotifSighting`
 * once either gets a sync entity.
 * ---------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// The v2 sync entity vocabulary — BUILD_PLAN.md:144's exact six-item list,
// as a runtime-checkable const array (never a hand-retyped string literal
// union living next to it).
// ---------------------------------------------------------------------------

export const SYNC_ENTITIES_V2 = [
  "session",
  "claim",
  "motif",
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
