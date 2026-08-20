import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import {
  applications,
  studyClaims,
  studySessions,
  syncReceipts,
  teachingDrafts,
  userConnections,
  motifCandidates,
  workspaces,
} from "@/db/schema";
import { groupOpsByMutationGroupId, parseSyncOpV2Payload } from "@/lib/api/sync-v2";
import type { SyncOpV2 } from "@/lib/contracts/sync-v2";
import type {
  Application,
  MotifCandidate,
  StudyClaim,
  StudySession,
  TeachingDraft,
  UserConnection,
} from "@/lib/contracts/study-v2";
import { db } from "@/lib/db";

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
 * therefore persists exactly those six; `claimEvidence` and `motifSightings`
 * (both already present in `db/schema.ts` via SCHEMAFU-001/SCHEMAV2-001) have
 * no sync entity to receive ops for yet and are untouched here. Once
 * SYNCGAP-001 (or its reconciled successor) lands on master, extending the
 * `TABLE_BY_ENTITY`-shaped set of `plan*Op` functions below by two more
 * follows the exact same pattern as the six here.
 *
 * A second unmerged dependency this task's own `readOnlyPaths` names,
 * `lib/db/workspaces.ts` (WORKSPACE-001), is also absent from `master` as of
 * this run — so it cannot be imported. `resolveWorkspaceOwnership` below is a
 * narrow, inline equivalent of the one check this module actually needs
 * (does workspace `X` belong to acting user `U`?), reading the `workspaces`
 * table directly rather than duplicating WORKSPACE-001's fuller
 * create/idempotent-provisioning surface. Once WORKSPACE-001 merges, a
 * follow-up can swap this for its `assertWorkspaceOwnership` and delete the
 * local copy — tracked so the two do not silently diverge.
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
// own is rejected before anything is read or written for it. See the module
// header for why this is inline rather than importing WORKSPACE-001.
// ---------------------------------------------------------------------------

async function resolveWorkspaceOwnership(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.createdBy, userId),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
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
  const owns = await resolveWorkspaceOwnership(userId, workspaceId);
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

async function planMotifOp(userId: string, op: SyncOpV2): Promise<PlanOutcome> {
  let payload: MotifCandidate;
  try {
    payload = parseSyncOpV2Payload<MotifCandidate>(op);
  } catch (error) {
    return { ok: false, reason: messageOf(error) };
  }
  const [current] = await db
    .select({ workspaceId: motifCandidates.workspaceId, revision: motifCandidates.revision })
    .from(motifCandidates)
    .where(eq(motifCandidates.id, op.entityId))
    .limit(1);
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
