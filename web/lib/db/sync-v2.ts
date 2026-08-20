import "server-only";

import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import {
  applications,
  claimEvidence,
  motifSightings,
  studyClaims,
  studySessions,
  syncReceipts,
  teachingDrafts,
  userConnections,
  motifCandidates,
} from "@/db/schema";
import { groupOpsByMutationGroupId, parseSyncOpV2Payload } from "@/lib/api/sync-v2";
import type { SyncOpV2 } from "@/lib/contracts/sync-v2";
import type {
  ClaimEvidence,
  MotifSighting,
  Application,
  MotifCandidate,
  StudyClaim,
  StudySession,
  TeachingDraft,
  UserConnection,
} from "@/lib/contracts/study-v2";
import { db } from "@/lib/db";
import { MOTIF_CANDIDATE_PROMOTED_STATUS } from "@/lib/db/radar";
import { assertWorkspaceOwnership, WorkspaceAccessDeniedError } from "@/lib/db/workspaces";

/**
 * SYNCPERSIST-001 — persists validated v2 sync ops (SYNCV2-001's contract) to
 * the eight-minus-two v2 tables SCHEMAFU-001 shipped. A NEW file rather than
 * editing `lib/db/sync.ts`, so the v1 path stays byte-stable and independently
 * reviewable (`lib/db/sync.ts` is read-only for this task).
 *
 * SCOPE NOTE, reported rather than silently worked around: this task's
 * `dependsOn` names SYNCGAP-001, which as of this run is `status: "submitted"`
 * on `ops/agent-queue` — not yet merged to `master`. Per QUEUE.md's documented
 * eligibility rule ("does not gate on dependsOn", the precedent DOC-002's own
 * queue entry already established) this was built from `master` as-is, which
 * still carries only SYNCV2-001's original six-entity `SYNC_ENTITIES_V2`
 * (`session | claim | motif | connection | application | teachingDraft`) —
 * NOT SYNCGAP-001's proposed `evidence` / `motifSighting` additions. This file
 * therefore persists all eight; `claimEvidence` and `motifSightings`
 * (both already present in `db/schema.ts` via SCHEMAFU-001/SCHEMAV2-001) have
 * no sync entity to receive ops for yet and are untouched here. Once
 * SYNCGAP-001 (or its reconciled successor) lands on master, extending the
 * `TABLE_BY_ENTITY`-shaped set of `plan*Op` functions below by two more
 * follows the exact same pattern as the six here.
 *
 * SYNCDEDUP-001 — the module used to carry its own inline
 * `resolveWorkspaceOwnership`, written as a deliberate stand-in back when
 * WORKSPACE-001's `lib/db/workspaces.ts` had not yet landed on `master`. It
 * has since landed. That inline copy read the exact same `workspaces` table
 * with the exact same predicate (`id` match, `createdBy` match,
 * `deletedAt IS NULL`) as `assertWorkspaceOwnership` below — confirmed line
 * by line, not assumed — so this module now imports and defers to that one
 * helper instead of keeping a second copy of the single most
 * security-relevant check in the codebase. `ownsWorkspace` just below is
 * NOT a second implementation: it performs no query of its own and holds no
 * security-relevant logic; it only adapts `assertWorkspaceOwnership`'s
 * throw-on-deny contract to the boolean this module's `planWrite`/
 * `planMotifOp` control flow expects.
 */

// ---------------------------------------------------------------------------
// Idempotency — reuses the existing `sync_receipts` table (keyed on
// `(userId, opId)`, `entity`/`entityId` stored as plain `text`) rather than a
// new table, since this task's `db/schema.ts` is read-only. The v1 receipt
// pattern in `lib/db/sync.ts` (`hasReceipt` / `receiptInsert`) is followed
// exactly, keyed by `opId`/`entity`/`entityId`/`clientTime` instead of the v1
// envelope's `id`/`entity`/`entityId`/`updatedAt` field names.
// ---------------------------------------------------------------------------

async function hasReceiptV2(userId: string, opId: string): Promise<boolean> {
  const [receipt] = await db
    .select({ opId: syncReceipts.opId })
    .from(syncReceipts)
    .where(and(eq(syncReceipts.userId, userId), eq(syncReceipts.opId, opId)))
    .limit(1);
  return Boolean(receipt);
}

function receiptInsertV2(userId: string, op: SyncOpV2) {
  return db
    .insert(syncReceipts)
    .values({
      opId: op.opId,
      userId,
      entity: op.entity,
      entityId: op.entityId,
      clientUpdatedAt: op.clientTime,
    })
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Cross-tenant safety — an op naming a workspace the acting user does not
// own is rejected before anything is read or written for it, via the single
// canonical check `lib/db/workspaces.ts` owns (see the module header for the
// SYNCDEDUP-001 history behind why this used to be a second copy here).
// ---------------------------------------------------------------------------

async function ownsWorkspace(userId: string, workspaceId: string): Promise<boolean> {
  try {
    await assertWorkspaceOwnership(userId, workspaceId);
    return true;
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError) return false;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Shared plan/apply engine. Each entity's `plan*Op` function does its own
// (fully typed, no `any`) SELECT of the current row and builds its own
// (fully typed) insert/onConflictDoUpdate write closure, then hands the
// tenant + optimistic-concurrency decision to this one shared function so
// that logic exists exactly once.
// ---------------------------------------------------------------------------

type PlanOutcome =
  | { ok: true; write: () => BatchItem<"pg"> }
  | { ok: false; reason: string };

/**
 * `baseRevision` semantics follow `lib/contracts/sync-v2.ts`'s documented
 * reading: `null` means "no prior revision to compare against" (a create).
 * Fail-closed both directions: a create-shaped op against an existing row,
 * or an update-shaped op against a baseRevision that does not match the
 * stored revision, is REJECTED rather than silently overwritten — BUILD_PLAN
 * tenet 4, "long-form prose must never be silently lost".
 */
async function planWrite(
  userId: string,
  workspaceId: string,
  current: { workspaceId: string; revision: number } | undefined,
  baseRevision: number | null,
  write: () => BatchItem<"pg">,
): Promise<PlanOutcome> {
  const owns = await ownsWorkspace(userId, workspaceId);
  if (!owns) {
    return { ok: false, reason: "Workspace does not belong to the acting user" };
  }
  if (current) {
    if (current.workspaceId !== workspaceId) {
      return { ok: false, reason: "Entity ID belongs to another workspace" };
    }
    if (baseRevision !== current.revision) {
      return {
        ok: false,
        reason: `Revision conflict: stored revision is ${current.revision}, op carried baseRevision ${baseRevision}`,
      };
    }
  } else if (baseRevision !== null) {
    return {
      ok: false,
      reason: `Revision conflict: op carried baseRevision ${baseRevision} for an entity that does not exist yet`,
    };
  }
  return { ok: true, write };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid payload";
}

/** `op.mutation === "delete"` mirrors `lib/db/sync.ts`'s `applyEntry`: the
 *  payload's own `deletedAt` wins if present, otherwise the envelope's
 *  `clientTime` stamps the delete. */
function resolveDeletedAt(
  op: SyncOpV2,
  payloadDeletedAt: string | null | undefined,
): string | null {
  if (op.mutation === "delete") {
    return payloadDeletedAt ?? op.clientTime;
  }
  return payloadDeletedAt ?? null;
}

// ---------------------------------------------------------------------------
// Per-entity plan functions — one per `SYNC_ENTITIES_V2` member available on
// master today (session, claim, motif, connection, application,
// teachingDraft). Each mirrors `lib/db/sync.ts`'s explicit per-entity style
// rather than a generic/`any`-typed table dispatch.
// ---------------------------------------------------------------------------

async function planSessionOp(userId: string, op: SyncOpV2): Promise<PlanOutcome> {
  let payload: StudySession;
  try {
    payload = parseSyncOpV2Payload<StudySession>(op);
  } catch (error) {
    return { ok: false, reason: messageOf(error) };
  }
  const [current] = await db
    .select({ workspaceId: studySessions.workspaceId, revision: studySessions.revision })
    .from(studySessions)
    .where(eq(studySessions.id, op.entityId))
    .limit(1);
  const deletedAt = resolveDeletedAt(op, payload.deletedAt);
  const write = () =>
    db
      .insert(studySessions)
      .values({
        id: payload.id,
        workspaceId: payload.workspaceId,
        range: payload.range,
        mode: payload.mode,
        workflowState: payload.workflowState,
        connectionState: payload.connectionState,
        catalogReleaseId: payload.catalogReleaseId ?? null,
        readGateAt: payload.readGateAt ?? null,
        currentStep: payload.currentStep,
        revision: payload.revision,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
        deletedAt,
      })
      .onConflictDoUpdate({
        target: studySessions.id,
        set: {
          range: payload.range,
          mode: payload.mode,
          workflowState: payload.workflowState,
          connectionState: payload.connectionState,
          catalogReleaseId: payload.catalogReleaseId ?? null,
          readGateAt: payload.readGateAt ?? null,
          currentStep: payload.currentStep,
          revision: payload.revision,
          updatedAt: payload.updatedAt,
          deletedAt,
        },
      });
  return planWrite(userId, payload.workspaceId, current, op.baseRevision, write);
}

async function planClaimOp(userId: string, op: SyncOpV2): Promise<PlanOutcome> {
  let payload: StudyClaim;
  try {
    payload = parseSyncOpV2Payload<StudyClaim>(op);
  } catch (error) {
    return { ok: false, reason: messageOf(error) };
  }
  const [current] = await db
    .select({ workspaceId: studyClaims.workspaceId, revision: studyClaims.revision })
    .from(studyClaims)
    .where(eq(studyClaims.id, op.entityId))
    .limit(1);
  const deletedAt = resolveDeletedAt(op, payload.deletedAt);
  const write = () =>
    db
      .insert(studyClaims)
      .values({
        id: payload.id,
        workspaceId: payload.workspaceId,
        sessionId: payload.sessionId,
        kind: payload.kind,
        epistemicBasis: payload.epistemicBasis,
        body: payload.body,
        passage: payload.passage,
        confidence: payload.confidence,
        provenance: payload.provenance,
        doctrineStatus: payload.doctrineStatus,
        viewpointId: payload.viewpointId ?? null,
        status: payload.status,
        revision: payload.revision,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
        deletedAt,
      })
      .onConflictDoUpdate({
        target: studyClaims.id,
        set: {
          sessionId: payload.sessionId,
          kind: payload.kind,
          epistemicBasis: payload.epistemicBasis,
          body: payload.body,
          passage: payload.passage,
          confidence: payload.confidence,
          provenance: payload.provenance,
          doctrineStatus: payload.doctrineStatus,
          viewpointId: payload.viewpointId ?? null,
          status: payload.status,
          revision: payload.revision,
          updatedAt: payload.updatedAt,
          deletedAt,
        },
      });
  return planWrite(userId, payload.workspaceId, current, op.baseRevision, write);
}

/**
 * MOTIFSTATUS-001 — closes the back door `app/api/motifs/[id]/route.ts`'s
 * header comment flags: "If a future task wires `pushSyncOpsV2` behind a
 * live route, THAT task must either exclude `motif.status` transitions from
 * the generic upsert ... or fold this route's confirm/dismiss logic into
 * the sync planner." This is that future task, and the decision (per this
 * task's own acceptance criteria: "decide and state whether any status
 * transition is legitimately client-drivable at all, or whether motif
 * status is entirely server-owned") is the FIRST option, narrowed to
 * exactly the value that carries a bypassable guarantee:
 *
 *   - `"promoted"` is entirely server-owned. `promoteMotifCandidate`
 *     (`lib/db/radar.ts`) is a privileged transition that re-derives the
 *     sighting count from the database itself and refuses outright unless
 *     the CALLER supplies `learnerConfirmed: true` — a field the v2 sync
 *     wire format (`lib/contracts/sync-v2.ts`) has no place to carry at
 *     all, and a recomputation the generic upsert below structurally cannot
 *     perform. No sync op may ever cause a candidate to enter `"promoted"`,
 *     and — once a candidate IS `"promoted"` — no further sync op may touch
 *     that row at all, so a client cannot launder a downgrade (e.g.
 *     `"promoted"` -> `"dismissed"`) through the same back door either.
 *   - `"candidate"` and `"dismissed"` remain ordinary, client-syncable
 *     values: neither is gated by an analogous server-recomputed invariant,
 *     and existing coverage (`tests/sync-v2-persist.test.ts`'s generic
 *     "every v2 entity applies a valid create" and "delete mutation..."
 *     tests) already creates/deletes `"candidate"`-status motif rows
 *     through this exact path and must keep doing so unweakened.
 *
 * Both checks below run AFTER confirming the acting user owns the CLAIMED
 * `payload.workspaceId` and (for an update) that the claimed workspace
 * matches the row's REAL stored workspace — the same two gates `planWrite`
 * enforces for every entity — so a cross-tenant probe against another
 * workspace's promoted candidate gets the ordinary, non-distinguishing
 * "Workspace does not belong to the acting user" / "Entity ID belongs to
 * another workspace" rejection, never a status-revealing one. Both gates
 * are duplicated inline here (rather than deferred to the shared
 * `planWrite` call below) specifically so they run BEFORE these two motif-
 * only guards instead of after; `planWrite` still re-runs them itself for
 * every other rejection reason (revision conflicts, etc.), which costs one
 * redundant `ownsWorkspace` lookup for this entity only, traded deliberately
 * for not needing to thread a per-entity guard hook through the shared
 * function every other `plan*Op` also calls.
 */
async function planMotifOp(userId: string, op: SyncOpV2): Promise<PlanOutcome> {
  let payload: MotifCandidate;
  try {
    payload = parseSyncOpV2Payload<MotifCandidate>(op);
  } catch (error) {
    return { ok: false, reason: messageOf(error) };
  }
  const [current] = await db
    .select({ workspaceId: motifCandidates.workspaceId, revision: motifCandidates.revision, status: motifCandidates.status })
    .from(motifCandidates)
    .where(eq(motifCandidates.id, op.entityId))
    .limit(1);

  const ownsClaimedWorkspace = await ownsWorkspace(userId, payload.workspaceId);
  const rowMatchesClaimedWorkspace = !current || current.workspaceId === payload.workspaceId;
  if (ownsClaimedWorkspace && rowMatchesClaimedWorkspace) {
    if (current?.status === MOTIF_CANDIDATE_PROMOTED_STATUS) {
      return {
        ok: false,
        reason:
          "Motif candidate is already promoted; a promoted candidate's status is immutable via sync push " +
          "(server-owned -- see app/api/motifs/[id]/route.ts)",
      };
    }
    if (payload.status === MOTIF_CANDIDATE_PROMOTED_STATUS) {
      return {
        ok: false,
        reason:
          "Motif candidate promotion is a privileged server transition (requires a database-re-derived " +
          "sighting count and an explicit learnerConfirmed flag, neither of which sync push carries) and " +
          "cannot be performed via sync push",
      };
    }
  }

  const deletedAt = resolveDeletedAt(op, payload.deletedAt);
  const write = () =>
    db
      .insert(motifCandidates)
      .values({
        id: payload.id,
        workspaceId: payload.workspaceId,
        label: payload.label,
        normalizedKey: payload.normalizedKey,
        status: payload.status,
        revision: payload.revision,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
        deletedAt,
      })
      .onConflictDoUpdate({
        target: motifCandidates.id,
        set: {
          label: payload.label,
          normalizedKey: payload.normalizedKey,
          status: payload.status,
          revision: payload.revision,
          updatedAt: payload.updatedAt,
          deletedAt,
        },
      });
  return planWrite(userId, payload.workspaceId, current, op.baseRevision, write);
}

async function planConnectionOp(userId: string, op: SyncOpV2): Promise<PlanOutcome> {
  let payload: UserConnection;
  try {
    payload = parseSyncOpV2Payload<UserConnection>(op);
  } catch (error) {
    return { ok: false, reason: messageOf(error) };
  }
  const [current] = await db
    .select({ workspaceId: userConnections.workspaceId, revision: userConnections.revision })
    .from(userConnections)
    .where(eq(userConnections.id, op.entityId))
    .limit(1);
  const deletedAt = resolveDeletedAt(op, payload.deletedAt);
  const write = () =>
    db
      .insert(userConnections)
      .values({
        id: payload.id,
        workspaceId: payload.workspaceId,
        fromRange: payload.fromRange,
        toRange: payload.toRange,
        type: payload.type,
        evidenceLabel: payload.evidenceLabel,
        rationale: payload.rationale,
        threadSlug: payload.threadSlug ?? null,
        status: payload.status,
        revision: payload.revision,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
        deletedAt,
      })
      .onConflictDoUpdate({
        target: userConnections.id,
        set: {
          fromRange: payload.fromRange,
          toRange: payload.toRange,
          type: payload.type,
          evidenceLabel: payload.evidenceLabel,
          rationale: payload.rationale,
          threadSlug: payload.threadSlug ?? null,
          status: payload.status,
          revision: payload.revision,
          updatedAt: payload.updatedAt,
          deletedAt,
        },
      });
  return planWrite(userId, payload.workspaceId, current, op.baseRevision, write);
}

async function planApplicationOp(userId: string, op: SyncOpV2): Promise<PlanOutcome> {
  let payload: Application;
  try {
    payload = parseSyncOpV2Payload<Application>(op);
  } catch (error) {
    return { ok: false, reason: messageOf(error) };
  }
  const [current] = await db
    .select({ workspaceId: applications.workspaceId, revision: applications.revision })
    .from(applications)
    .where(eq(applications.id, op.entityId))
    .limit(1);
  const deletedAt = resolveDeletedAt(op, payload.deletedAt);
  const write = () =>
    db
      .insert(applications)
      .values({
        id: payload.id,
        workspaceId: payload.workspaceId,
        sessionId: payload.sessionId,
        sourceClaimId: payload.sourceClaimId,
        originalAudienceMeaning: payload.originalAudienceMeaning,
        enduringPrinciple: payload.enduringPrinciple,
        canonicalBridge: payload.canonicalBridge,
        applicationClass: payload.applicationClass,
        promiseScope: payload.promiseScope,
        modernDomain: payload.modernDomain,
        situation: payload.situation,
        responseType: payload.responseType,
        faithfulResponse: payload.faithfulResponse,
        cautions: payload.cautions,
        availableAfter: payload.availableAfter ?? null,
        status: payload.status,
        revision: payload.revision,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
        deletedAt,
      })
      .onConflictDoUpdate({
        target: applications.id,
        set: {
          sessionId: payload.sessionId,
          sourceClaimId: payload.sourceClaimId,
          originalAudienceMeaning: payload.originalAudienceMeaning,
          enduringPrinciple: payload.enduringPrinciple,
          canonicalBridge: payload.canonicalBridge,
          applicationClass: payload.applicationClass,
          promiseScope: payload.promiseScope,
          modernDomain: payload.modernDomain,
          situation: payload.situation,
          responseType: payload.responseType,
          faithfulResponse: payload.faithfulResponse,
          cautions: payload.cautions,
          availableAfter: payload.availableAfter ?? null,
          status: payload.status,
          revision: payload.revision,
          updatedAt: payload.updatedAt,
          deletedAt,
        },
      });
  return planWrite(userId, payload.workspaceId, current, op.baseRevision, write);
}

async function planTeachingDraftOp(userId: string, op: SyncOpV2): Promise<PlanOutcome> {
  let payload: TeachingDraft;
  try {
    payload = parseSyncOpV2Payload<TeachingDraft>(op);
  } catch (error) {
    return { ok: false, reason: messageOf(error) };
  }
  const [current] = await db
    .select({ workspaceId: teachingDrafts.workspaceId, revision: teachingDrafts.revision })
    .from(teachingDrafts)
    .where(eq(teachingDrafts.id, op.entityId))
    .limit(1);
  const deletedAt = resolveDeletedAt(op, payload.deletedAt);
  const write = () =>
    db
      .insert(teachingDrafts)
      .values({
        id: payload.id,
        workspaceId: payload.workspaceId,
        sessionId: payload.sessionId,
        title: payload.title,
        bigIdea: payload.bigIdea,
        audience: payload.audience,
        durationMinutes: payload.durationMinutes,
        gospelConnection: payload.gospelConnection,
        status: payload.status,
        revision: payload.revision,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
        deletedAt,
      })
      .onConflictDoUpdate({
        target: teachingDrafts.id,
        set: {
          sessionId: payload.sessionId,
          title: payload.title,
          bigIdea: payload.bigIdea,
          audience: payload.audience,
          durationMinutes: payload.durationMinutes,
          gospelConnection: payload.gospelConnection,
          status: payload.status,
          revision: payload.revision,
          updatedAt: payload.updatedAt,
          deletedAt,
        },
      });
  return planWrite(userId, payload.workspaceId, current, op.baseRevision, write);
}

/**
 * SYNCGAP-001 resolved the doc conflict in favour of claim_evidence and
 * motif_sightings each being their OWN sync entity that names its parent by id,
 * rather than riding along as a nested aggregate child array. SYNCPERSIST-001
 * was built in parallel against the older six-entity list, so these two
 * handlers were the integration gap between the two branches — surfaced
 * immediately because the persist test iterates SYNC_ENTITIES_V2 rather than a
 * hand-listed set, so growing the contract demanded a handler instead of
 * silently passing.
 */
async function planEvidenceOp(userId: string, op: SyncOpV2): Promise<PlanOutcome> {
  let payload: ClaimEvidence;
  try {
    payload = parseSyncOpV2Payload<ClaimEvidence>(op);
  } catch (error) {
    return { ok: false, reason: messageOf(error) };
  }
  const [current] = await db
    .select({ workspaceId: claimEvidence.workspaceId, revision: claimEvidence.revision })
    .from(claimEvidence)
    .where(eq(claimEvidence.id, op.entityId))
    .limit(1);
  const deletedAt = resolveDeletedAt(op, payload.deletedAt);
  const values = {
    claimId: payload.claimId,
    evidenceType: payload.evidenceType,
    canonicalReference: payload.canonicalReference ?? null,
    displayReference: payload.displayReference ?? null,
    contentBlockId: payload.contentBlockId ?? null,
    citationId: payload.citationId ?? null,
    connectionId: payload.connectionId ?? null,
    note: payload.note,
    revision: payload.revision,
    updatedAt: payload.updatedAt,
    deletedAt,
  };
  const write = () =>
    db
      .insert(claimEvidence)
      .values({
        id: payload.id,
        workspaceId: payload.workspaceId,
        createdAt: payload.createdAt,
        ...values,
      })
      .onConflictDoUpdate({ target: claimEvidence.id, set: values });
  return planWrite(userId, payload.workspaceId, current, op.baseRevision, write);
}

async function planMotifSightingOp(userId: string, op: SyncOpV2): Promise<PlanOutcome> {
  let payload: MotifSighting;
  try {
    payload = parseSyncOpV2Payload<MotifSighting>(op);
  } catch (error) {
    return { ok: false, reason: messageOf(error) };
  }
  const [current] = await db
    .select({ workspaceId: motifSightings.workspaceId, revision: motifSightings.revision })
    .from(motifSightings)
    .where(eq(motifSightings.id, op.entityId))
    .limit(1);
  const deletedAt = resolveDeletedAt(op, payload.deletedAt);
  const values = {
    candidateId: payload.candidateId,
    passageUnitKey: payload.passageUnitKey,
    exactRange: payload.exactRange,
    entryId: payload.entryId ?? null,
    claimId: payload.claimId ?? null,
    status: payload.status,
    revision: payload.revision,
    updatedAt: payload.updatedAt,
    deletedAt,
  };
  const write = () =>
    db
      .insert(motifSightings)
      .values({
        id: payload.id,
        workspaceId: payload.workspaceId,
        createdAt: payload.createdAt,
        ...values,
      })
      .onConflictDoUpdate({ target: motifSightings.id, set: values });
  return planWrite(userId, payload.workspaceId, current, op.baseRevision, write);
}

async function planOp(userId: string, op: SyncOpV2): Promise<PlanOutcome> {
  switch (op.entity) {
    case "session":
      return planSessionOp(userId, op);
    case "claim":
      return planClaimOp(userId, op);
    case "motif":
      return planMotifOp(userId, op);
    case "connection":
      return planConnectionOp(userId, op);
    case "application":
      return planApplicationOp(userId, op);
    case "teachingDraft":
      return planTeachingDraftOp(userId, op);
    case "evidence":
      return planEvidenceOp(userId, op);
    case "motifSighting":
      return planMotifSightingOp(userId, op);
    default: {
      const exhaustive: never = op.entity;
      return { ok: false, reason: `${String(exhaustive)} sync is not implemented yet` };
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry point — groups by `mutationGroupId` (the wire-format's bounded
// atomic unit, `lib/contracts/sync-v2.ts`) and applies each group as one
// `db.batch(...)` call. Neon HTTP batch is one transaction (the same fact
// `lib/db/sync.ts`'s header comment relies on), so if ANY op in a group fails
// planning or the batch write itself throws, NOTHING from that group lands —
// every op in the group is reported rejected, not only the one that failed.
// ---------------------------------------------------------------------------

export type RejectedSyncOpV2 = { opId: string; reason: string };

export async function pushSyncOpsV2(
  userId: string,
  ops: SyncOpV2[],
): Promise<RejectedSyncOpV2[]> {
  const rejected: RejectedSyncOpV2[] = [];
  const groups = groupOpsByMutationGroupId(ops);

  for (const [, groupOps] of groups) {
    const pending: { op: SyncOpV2; write: () => BatchItem<"pg"> }[] = [];
    let failure: { opId: string; reason: string } | null = null;

    for (const op of groupOps) {
      if (await hasReceiptV2(userId, op.opId)) continue;
      const plan = await planOp(userId, op);
      if (!plan.ok) {
        failure = { opId: op.opId, reason: plan.reason };
        break;
      }
      pending.push({ op, write: plan.write });
    }

    if (failure) {
      for (const op of groupOps) {
        if (op.opId === failure.opId) {
          rejected.push({ opId: op.opId, reason: failure.reason });
          continue;
        }
        if (await hasReceiptV2(userId, op.opId)) continue;
        rejected.push({
          opId: op.opId,
          reason: `Rejected: sibling op ${failure.opId} in the same mutationGroupId failed (${failure.reason})`,
        });
      }
      continue;
    }

    if (pending.length === 0) continue;

    try {
      const writes: BatchItem<"pg">[] = pending.map(({ write }) => write());
      const receipts: BatchItem<"pg">[] = pending.map(({ op }) => receiptInsertV2(userId, op));
      const [firstWrite, ...restWrites] = writes;
      // `pending.length > 0` was already checked above, so `firstWrite` is
      // always present; the cast below only asserts the non-empty-tuple
      // shape `db.batch` requires, which the length check already proves.
      await db.batch(
        [firstWrite, ...restWrites, ...receipts] as [BatchItem<"pg">, ...BatchItem<"pg">[]],
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown sync failure";
      for (const { op } of pending) {
        rejected.push({ opId: op.opId, reason });
      }
    }
  }

  return rejected;
}
