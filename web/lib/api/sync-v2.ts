import { z } from "zod";
import type { ZodType } from "zod";

import { verseRefSchema } from "@/lib/api/entries";
import { threadSlugSchema } from "@/lib/api/threads";
import { CANONICAL_VERSIFICATION_ID } from "@/lib/contracts/range-v1";
import {
  SYNC_ENTITIES_V2,
  SYNC_MUTATIONS_V2,
  type SyncEntityV2,
  type SyncOpV2,
} from "@/lib/contracts/sync-v2";
import {
  CLAIM_CONFIDENCES,
  CLAIM_KINDS,
  CLAIM_PROVENANCES,
  CONNECTION_TYPES,
  DOCTRINE_STATUSES,
  EPISTEMIC_BASES,
  EVIDENCE_LABELS,
  MODERN_DOMAINS,
  RESPONSE_TYPES,
  STUDY_CLAIM_STATUSES,
  STUDY_SESSION_CONNECTION_STATES,
  STUDY_SESSION_MODES,
  STUDY_SESSION_WORKFLOW_STATES,
  USER_CONNECTION_STATUSES,
  isPersonalResonanceEvidenceLabelValid,
} from "@/lib/contracts/study-v2";

const timestampSchema = z.iso.datetime({ offset: true });

// ---------------------------------------------------------------------------
// CanonicalRangeV1 — structural validation only.
//
// `lib/contracts/range-v1.ts`'s own header is explicit: "Parsing, validation,
// formatting, containment/overlap ... live in `lib/bible/range.ts` ... the
// only place that should ever construct or validate one of these." Full
// validation (same-book containment, chapter/verse existence against the
// actual 66-book canon table) needs `lib/bible/range.ts`'s `CanonTable`,
// which this task does not own and does not load. This schema checks shape
// only — versification id, and that `start`/`end` are well-formed canonical
// verse keys (reusing `verseRefSchema`, which already checks chapter
// existence) — and leaves cross-book/containment validation to that single
// owning module rather than duplicating and risking drift from it.
// ---------------------------------------------------------------------------
export const canonicalRangeV1Schema = z
  .object({
    versificationId: z.literal(CANONICAL_VERSIFICATION_ID),
    start: verseRefSchema,
    end: verseRefSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Per-entity payload schemas — one per v2 sync entity, reusing the enum
// arrays `lib/contracts/study-v2.ts` exports rather than retyping any string
// literal, and its two enforced-constraint predicates where they apply.
// Field shapes mirror `lib/contracts/study-v2.ts`'s record interfaces and
// `db/schema.ts`'s v2 tables (both read-only for this task) exactly.
// ---------------------------------------------------------------------------

/** entity: "session" — `StudySession` (`lib/contracts/study-v2.ts`). */
export const syncStudySessionV2Schema = z
  .object({
    id: z.string().min(1).max(200),
    workspaceId: z.string().min(1).max(200),
    range: canonicalRangeV1Schema,
    mode: z.enum(STUDY_SESSION_MODES),
    workflowState: z.enum(STUDY_SESSION_WORKFLOW_STATES),
    connectionState: z.enum(STUDY_SESSION_CONNECTION_STATES),
    catalogReleaseId: z.string().min(1).max(200).nullish(),
    readGateAt: timestampSchema.nullish(),
    currentStep: z.string().min(1).max(500),
    revision: z.number().int().nonnegative(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    deletedAt: timestampSchema.nullish(),
  })
  .strict();

/**
 * entity: "claim" — `StudyClaim` (`lib/contracts/study-v2.ts`). Enforces the
 * interface's own documented rule: "Theology claims only; null for every
 * other ClaimKind" for `doctrineStatus`.
 */
export const syncStudyClaimV2Schema = z
  .object({
    id: z.string().min(1).max(200),
    workspaceId: z.string().min(1).max(200),
    sessionId: z.string().min(1).max(200),
    kind: z.enum(CLAIM_KINDS),
    epistemicBasis: z.enum(EPISTEMIC_BASES),
    body: z.string().min(1).max(100_000),
    passage: canonicalRangeV1Schema,
    confidence: z.enum(CLAIM_CONFIDENCES),
    provenance: z.enum(CLAIM_PROVENANCES),
    doctrineStatus: z.enum(DOCTRINE_STATUSES).nullable(),
    viewpointId: z.string().min(1).max(200).nullish(),
    status: z.enum(STUDY_CLAIM_STATUSES),
    revision: z.number().int().nonnegative(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    deletedAt: timestampSchema.nullish(),
  })
  .strict()
  .superRefine((claim, context) => {
    const isTheology = claim.kind === "theology";
    if (isTheology && claim.doctrineStatus === null) {
      context.addIssue({
        code: "custom",
        path: ["doctrineStatus"],
        message: "Theology claims must carry a doctrineStatus",
      });
    }
    if (!isTheology && claim.doctrineStatus !== null) {
      context.addIssue({
        code: "custom",
        path: ["doctrineStatus"],
        message: "Only theology claims may carry a doctrineStatus",
      });
    }
  });

/**
 * entity: "motif" — `MotifCandidate` (`lib/contracts/study-v2.ts`).
 * `MotifSighting` (the candidate-to-passage occurrence link) has no sync
 * entity of its own in BUILD_PLAN.md:144's six-item list, same class of gap
 * as `claim evidence` — see the header note in `lib/contracts/sync-v2.ts`.
 * `status` is typed as plain text, not a guessed enum, per that same file's
 * documented gap #3 (neither source doc enumerates its values).
 */
export const syncMotifCandidateV2Schema = z
  .object({
    id: z.string().min(1).max(200),
    workspaceId: z.string().min(1).max(200),
    label: z.string().trim().min(1).max(500),
    normalizedKey: z.string().trim().min(1).max(500),
    status: z.string().trim().min(1).max(200),
    revision: z.number().int().nonnegative(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    deletedAt: timestampSchema.nullish(),
  })
  .strict();

/**
 * entity: "connection" — `UserConnection` (`lib/contracts/study-v2.ts`).
 * Reuses `isPersonalResonanceEvidenceLabelValid` (BUILD_PLAN §3.2's first
 * enforced constraint) rather than retyping it, and `rationale`'s "minimum
 * 20 characters" per BUILD_PLAN §3.3.
 */
export const syncUserConnectionV2Schema = z
  .object({
    id: z.string().min(1).max(200),
    workspaceId: z.string().min(1).max(200),
    fromRange: canonicalRangeV1Schema,
    toRange: canonicalRangeV1Schema,
    type: z.enum(CONNECTION_TYPES),
    evidenceLabel: z.enum(EVIDENCE_LABELS),
    rationale: z.string().trim().min(20).max(20_000),
    threadSlug: threadSlugSchema.nullish(),
    status: z.enum(USER_CONNECTION_STATUSES),
    revision: z.number().int().nonnegative(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    deletedAt: timestampSchema.nullish(),
  })
  .strict()
  .superRefine((connection, context) => {
    if (!isPersonalResonanceEvidenceLabelValid(connection)) {
      context.addIssue({
        code: "custom",
        path: ["evidenceLabel"],
        message: "personal_resonance connections require evidenceLabel \"devotional\"",
      });
    }
  });

/**
 * entity: "application" — `Application` (`lib/contracts/study-v2.ts`).
 * `applicationClass`, `promiseScope`, and `status` are typed as plain text,
 * not guessed enums, per that file's documented gaps #2/#3.
 */
export const syncApplicationV2Schema = z
  .object({
    id: z.string().min(1).max(200),
    workspaceId: z.string().min(1).max(200),
    sessionId: z.string().min(1).max(200),
    sourceClaimId: z.string().min(1).max(200),
    originalAudienceMeaning: z.string().min(1).max(100_000),
    enduringPrinciple: z.string().min(1).max(100_000),
    canonicalBridge: z.string().min(1).max(100_000),
    applicationClass: z.string().trim().min(1).max(200),
    promiseScope: z.string().trim().min(1).max(200),
    modernDomain: z.enum(MODERN_DOMAINS),
    situation: z.string().min(1).max(100_000),
    responseType: z.enum(RESPONSE_TYPES),
    faithfulResponse: z.string().min(1).max(100_000),
    cautions: z.string().max(100_000),
    availableAfter: timestampSchema.nullish(),
    status: z.string().trim().min(1).max(200),
    revision: z.number().int().nonnegative(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    deletedAt: timestampSchema.nullish(),
  })
  .strict();

/**
 * entity: "teachingDraft" — `TeachingDraft` (`lib/contracts/study-v2.ts`).
 * `status` is typed as plain text, not a guessed enum, per that file's
 * documented gap #3.
 */
export const syncTeachingDraftV2Schema = z
  .object({
    id: z.string().min(1).max(200),
    workspaceId: z.string().min(1).max(200),
    sessionId: z.string().min(1).max(200),
    title: z.string().trim().min(1).max(200),
    bigIdea: z.string().min(1).max(20_000),
    audience: z.string().min(1).max(2_000),
    durationMinutes: z.number().int().positive().max(600),
    gospelConnection: z.string().min(1).max(20_000),
    status: z.string().trim().min(1).max(200),
    revision: z.number().int().nonnegative(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    deletedAt: timestampSchema.nullish(),
  })
  .strict();

const payloadSchemasByEntity: Record<SyncEntityV2, ZodType> = {
  session: syncStudySessionV2Schema,
  claim: syncStudyClaimV2Schema,
  motif: syncMotifCandidateV2Schema,
  connection: syncUserConnectionV2Schema,
  application: syncApplicationV2Schema,
  teachingDraft: syncTeachingDraftV2Schema,
};

// ---------------------------------------------------------------------------
// The push envelope, master plan §14's protocol JSON example field for
// field. `mutationGroupId` ties a related-creation group (e.g. a session
// plus its claims) into one bounded atomic unit; `dependsOn` orders ops
// across groups when true atomicity is not possible. A push is rejected as
// a whole (via `syncPushV2Schema`'s `superRefine` below) if any op's
// `dependsOn` names an opId absent from the same push.
// ---------------------------------------------------------------------------

export const syncOpV2Schema = z
  .object({
    opId: z.uuid(),
    deviceId: z.uuid(),
    entity: z.enum(SYNC_ENTITIES_V2),
    entityId: z.string().min(1).max(200),
    mutation: z.enum(SYNC_MUTATIONS_V2),
    baseRevision: z.number().int().nonnegative().nullable(),
    mutationGroupId: z.uuid(),
    dependsOn: z.array(z.uuid()).max(50),
    payload: z.unknown(),
    clientTime: timestampSchema,
  })
  .strict()
  .refine((op) => !op.dependsOn.includes(op.opId), {
    message: "An operation cannot depend on itself",
    path: ["dependsOn"],
  });

export const syncPushV2Schema = z
  .object({
    ops: z.array(syncOpV2Schema).max(500),
  })
  .strict()
  .superRefine((push, context) => {
    const knownOpIds = new Set(push.ops.map((op) => op.opId));
    push.ops.forEach((op, opIndex) => {
      op.dependsOn.forEach((dependencyOpId, dependsOnIndex) => {
        if (!knownOpIds.has(dependencyOpId)) {
          context.addIssue({
            code: "custom",
            path: ["ops", opIndex, "dependsOn", dependsOnIndex],
            message: `dependsOn references opId "${dependencyOpId}", which is not present in this push`,
          });
        }
      });
    });
  });

/**
 * The dangling-`dependsOn` check `syncPushV2Schema` runs internally, exposed
 * standalone so it can be unit-tested and reused without re-parsing every op
 * payload. Returns the dangling opIds referenced (empty when the group is
 * well-formed).
 */
export function findDanglingDependsOnOpIds(ops: SyncOpV2[]): string[] {
  const knownOpIds = new Set(ops.map((op) => op.opId));
  const dangling: string[] = [];
  for (const op of ops) {
    for (const dependencyOpId of op.dependsOn) {
      if (!knownOpIds.has(dependencyOpId)) {
        dangling.push(dependencyOpId);
      }
    }
  }
  return dangling;
}

/**
 * Expresses a related-creation group (e.g. a session plus its claims) as a
 * bounded atomic unit: every op sharing one `mutationGroupId` collects into
 * one entry of the returned map. Purely a grouping function — it does not
 * itself enforce atomicity (that is persistence-layer work, deferred; see
 * this task's report) — but it is what makes "these ops form one group"
 * checkable rather than left as an unverifiable claim about the wire shape.
 */
export function groupOpsByMutationGroupId(ops: SyncOpV2[]): Map<string, SyncOpV2[]> {
  const groups = new Map<string, SyncOpV2[]>();
  for (const op of ops) {
    const existing = groups.get(op.mutationGroupId);
    if (existing) {
      existing.push(op);
    } else {
      groups.set(op.mutationGroupId, [op]);
    }
  }
  return groups;
}

/**
 * Validates an op's payload against its entity's schema, then cross-checks
 * a timestamp read out of the payload against the envelope's `clientTime`.
 *
 * This is the SYNC-001 fix's accessor pattern (`lib/db/sync.ts`
 * `parsePayload`), inherited deliberately: `timestampFromPayload` (default
 * `payload.updatedAt`) and `idFromPayload` (default `payload.id`) are
 * accessors, not hardcoded field names, so no v2 entity is exempted from
 * either cross-check by construction. Every one of the six v2 payload
 * schemas above declares both `id` and `updatedAt`, so the defaults cover
 * all of them today — unlike v1, where `progress.readAt` needed an
 * override — but the parameters stay so a future v2 entity whose id or
 * update timestamp lives under a different field name is not silently
 * exempted the way a hardcoded `payload.updatedAt` read would exempt it.
 *
 * Fail-closed by default: a payload missing the accessed field yields
 * `undefined !== op.entityId` / `undefined !== op.clientTime`, so the op is
 * rejected rather than silently accepted.
 */
export function parseSyncOpV2Payload<T = unknown>(
  op: SyncOpV2,
  timestampFromPayload: (payload: unknown) => string | undefined = (payload) =>
    (payload as { updatedAt?: string }).updatedAt,
  idFromPayload: (payload: unknown) => string | undefined = (payload) =>
    (payload as { id?: string }).id,
): T {
  const schema = payloadSchemasByEntity[op.entity];
  const parsed = schema.safeParse(op.payload);
  if (!parsed.success) {
    throw new Error(`Invalid ${op.entity} payload`);
  }
  if (idFromPayload(parsed.data) !== op.entityId) {
    throw new Error("Operation entityId does not match its payload");
  }
  if (timestampFromPayload(parsed.data) !== op.clientTime) {
    throw new Error("Operation timestamp does not match its envelope");
  }
  return parsed.data as T;
}

// ---------------------------------------------------------------------------
// The one-write-path rule (BUILD_PLAN.md tenet 7; master plan §14 "One
// mutation path"): "Sync push is the sole browser mutation path for learner
// entities ... resource routes are read-only. The browser must not both
// enqueue an operation and call an independent REST mutation." Expressed
// here as an enforceable, tested predicate rather than left as prose.
//
// This task owns no route files (`app/api/v2/**` does not exist yet), so
// there is no handler to wire this into today. A future v2 resource-route
// task calls `assertReadOnlyV2ResourceRequest` first, before doing anything
// else, so a request shaped like a mutation is rejected before it can reach
// any handler logic — see this task's report for what remains to wire it in.
// ---------------------------------------------------------------------------

const READ_ONLY_V2_METHODS = ["GET", "HEAD"] as const;
export type ReadOnlyV2Method = (typeof READ_ONLY_V2_METHODS)[number];
export function isReadOnlyV2Method(method: string): method is ReadOnlyV2Method {
  return (READ_ONLY_V2_METHODS as readonly string[]).includes(method);
}

export class V2ResourceRouteMutationRejected extends Error {
  constructor(reason: string) {
    super(`v2 resource routes are read-only; ${reason} must go through sync push instead`);
    this.name = "V2ResourceRouteMutationRejected";
  }
}

/**
 * Throws `V2ResourceRouteMutationRejected` unless `request` is a bodiless
 * read (`GET`/`HEAD`, no body). Covers both angles of "mutation-shaped":
 * a mutating HTTP method (`POST`/`PUT`/`PATCH`/`DELETE`), and a body
 * smuggled onto an otherwise-read-shaped request.
 */
export function assertReadOnlyV2ResourceRequest(request: {
  method: string;
  body?: unknown;
}): void {
  if (!isReadOnlyV2Method(request.method)) {
    throw new V2ResourceRouteMutationRejected(`a ${request.method} request`);
  }
  if (request.body !== undefined && request.body !== null) {
    throw new V2ResourceRouteMutationRejected("a request body on a v2 resource route");
  }
}
