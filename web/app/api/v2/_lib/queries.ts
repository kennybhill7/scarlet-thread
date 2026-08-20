import "server-only";

import { and, desc, eq, isNull, type SQL } from "drizzle-orm";

import {
  applications,
  claimEvidence,
  motifCandidates,
  motifSightings,
  studyClaims,
  studySessions,
  teachingDrafts,
  userConnections,
} from "@/db/schema";
import { db } from "@/lib/db";
import { toIsoTimestamp, toOptionalIsoTimestamp } from "@/lib/db/time";
import type {
  Application,
  ClaimEvidence,
  MotifCandidate,
  MotifSighting,
  StudyClaim,
  StudySession,
  TeachingDraft,
  UserConnection,
} from "@/lib/contracts/study-v2";

/**
 * V2API-001/V2API-002 read-only data access for the v2 resource routes.
 * Every function here takes `workspaceId` as a required argument and every
 * query below includes `eq(<table>.workspaceId, workspaceId)` — that
 * predicate is the whole tenant-isolation guarantee for this task (see
 * `tests/v2-api.test.ts`'s mutation proof, which removes it and confirms a
 * named cross-tenant test fails). Callers (the route handlers in
 * `app/api/v2/**`) get `workspaceId` exclusively from
 * `app/api/v2/_lib/guard.ts`'s `withReadOnlyV2Workspace`, which derives it
 * from the authenticated session — never from anything the caller supplied.
 *
 * V2API-002 soft-delete convention: every list/get function below excludes
 * rows with a non-null `deletedAt` UNLESS the caller explicitly opts in via
 * `filters.includeDeleted`, mirroring `lib/db/entries.ts`'s `EntryFilters`
 * convention (`includeDeleted?: boolean`, `isNull(<table>.deletedAt)` added
 * to the WHERE clause when it is falsy) rather than inventing a second
 * soft-delete convention. None of the v2 routes in this task pass
 * `includeDeleted: true` — there is no learner-facing need yet to see
 * deleted rows through the v2 read surface, so every route call below relies
 * on the default (excluded). The option exists on every list function so a
 * future route can opt in without a second query implementation, exactly
 * like `lib/db/entries.ts` leaves `listEntries` (which supports it) next to
 * `getEntry` (which does not need it exposed).
 *
 * V2API-002 pagination convention: every list function takes an optional
 * `limit`, resolved by `resolveListLimit` below to a bounded page size —
 * default `V2_LIST_DEFAULT_LIMIT` (50), maximum `V2_LIST_MAX_LIMIT` (200).
 * A workspace with more rows than the limit simply has its oldest rows
 * excluded from a single unpaginated response, rather than the response
 * growing unbounded; see this task's report for what a cursor/offset
 * follow-up would add. Rows are ordered `desc(createdAt)` so LIMIT is
 * deterministic instead of depending on physical row order.
 */

export const V2_LIST_DEFAULT_LIMIT = 50;
export const V2_LIST_MAX_LIMIT = 200;

/**
 * Clamps a caller-requested page size into `[1, V2_LIST_MAX_LIMIT]`,
 * defaulting to `V2_LIST_DEFAULT_LIMIT` when omitted. Route-level zod
 * schemas (`app/api/v2/_lib/pagination.ts`) already reject an out-of-range
 * `?limit=` before a query function ever sees it, but every list function
 * here re-clamps anyway so a future caller of this module cannot bypass the
 * bound by skipping the route layer.
 */
export function resolveListLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return V2_LIST_DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.trunc(limit)), V2_LIST_MAX_LIMIT);
}

type ListFilters = { includeDeleted?: boolean; limit?: number };

type StudySessionRow = typeof studySessions.$inferSelect;
type StudyClaimRow = typeof studyClaims.$inferSelect;
type ClaimEvidenceRow = typeof claimEvidence.$inferSelect;
type MotifCandidateRow = typeof motifCandidates.$inferSelect;
type MotifSightingRow = typeof motifSightings.$inferSelect;
type UserConnectionRow = typeof userConnections.$inferSelect;
type ApplicationRow = typeof applications.$inferSelect;
type TeachingDraftRow = typeof teachingDrafts.$inferSelect;

function serializeSession(row: StudySessionRow): StudySession {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    range: row.range,
    mode: row.mode,
    workflowState: row.workflowState,
    connectionState: row.connectionState,
    catalogReleaseId: row.catalogReleaseId ?? null,
    readGateAt: toOptionalIsoTimestamp(row.readGateAt),
    currentStep: row.currentStep,
    revision: row.revision,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
    deletedAt: toOptionalIsoTimestamp(row.deletedAt),
  };
}

function serializeClaim(row: StudyClaimRow): StudyClaim {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    sessionId: row.sessionId,
    kind: row.kind,
    epistemicBasis: row.epistemicBasis,
    body: row.body,
    passage: row.passage,
    confidence: row.confidence,
    provenance: row.provenance,
    doctrineStatus: row.doctrineStatus,
    viewpointId: row.viewpointId ?? null,
    status: row.status,
    revision: row.revision,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
    deletedAt: toOptionalIsoTimestamp(row.deletedAt),
  };
}

function serializeEvidence(row: ClaimEvidenceRow): ClaimEvidence {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    claimId: row.claimId,
    evidenceType: row.evidenceType,
    ...(row.canonicalReference ? { canonicalReference: row.canonicalReference } : {}),
    ...(row.displayReference ? { displayReference: row.displayReference } : {}),
    contentBlockId: row.contentBlockId ?? null,
    citationId: row.citationId ?? null,
    connectionId: row.connectionId ?? null,
    note: row.note,
    revision: row.revision,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
    deletedAt: toOptionalIsoTimestamp(row.deletedAt),
  };
}

function serializeMotifCandidate(row: MotifCandidateRow): MotifCandidate {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    label: row.label,
    normalizedKey: row.normalizedKey,
    status: row.status,
    revision: row.revision,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
    deletedAt: toOptionalIsoTimestamp(row.deletedAt),
  };
}

function serializeMotifSighting(row: MotifSightingRow): MotifSighting {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    candidateId: row.candidateId,
    passageUnitKey: row.passageUnitKey,
    exactRange: row.exactRange,
    entryId: row.entryId ?? null,
    claimId: row.claimId ?? null,
    status: row.status,
    revision: row.revision,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
    deletedAt: toOptionalIsoTimestamp(row.deletedAt),
  };
}

function serializeConnection(row: UserConnectionRow): UserConnection {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    fromRange: row.fromRange,
    toRange: row.toRange,
    type: row.type,
    evidenceLabel: row.evidenceLabel,
    rationale: row.rationale,
    threadSlug: row.threadSlug ?? null,
    status: row.status,
    revision: row.revision,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
    deletedAt: toOptionalIsoTimestamp(row.deletedAt),
  };
}

function serializeApplication(row: ApplicationRow): Application {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    sessionId: row.sessionId,
    sourceClaimId: row.sourceClaimId,
    originalAudienceMeaning: row.originalAudienceMeaning,
    enduringPrinciple: row.enduringPrinciple,
    canonicalBridge: row.canonicalBridge,
    applicationClass: row.applicationClass,
    promiseScope: row.promiseScope,
    modernDomain: row.modernDomain,
    situation: row.situation,
    responseType: row.responseType,
    faithfulResponse: row.faithfulResponse,
    cautions: row.cautions,
    availableAfter: toOptionalIsoTimestamp(row.availableAfter),
    status: row.status,
    revision: row.revision,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
    deletedAt: toOptionalIsoTimestamp(row.deletedAt),
  };
}

function serializeTeachingDraft(row: TeachingDraftRow): TeachingDraft {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    sessionId: row.sessionId,
    title: row.title,
    bigIdea: row.bigIdea,
    audience: row.audience,
    durationMinutes: row.durationMinutes,
    gospelConnection: row.gospelConnection,
    status: row.status,
    revision: row.revision,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
    deletedAt: toOptionalIsoTimestamp(row.deletedAt),
  };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function listSessionsV2(
  workspaceId: string,
  filters: ListFilters = {},
): Promise<StudySession[]> {
  const conditions: SQL[] = [eq(studySessions.workspaceId, workspaceId)];
  if (!filters.includeDeleted) conditions.push(isNull(studySessions.deletedAt));

  const rows = await db
    .select()
    .from(studySessions)
    .where(and(...conditions))
    .orderBy(desc(studySessions.createdAt))
    .limit(resolveListLimit(filters.limit));
  return rows.map(serializeSession);
}

export async function getSessionV2(
  workspaceId: string,
  id: string,
): Promise<StudySession | null> {
  const [row] = await db
    .select()
    .from(studySessions)
    .where(
      and(
        eq(studySessions.id, id),
        eq(studySessions.workspaceId, workspaceId),
        isNull(studySessions.deletedAt),
      ),
    )
    .limit(1);
  return row ? serializeSession(row) : null;
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

export async function listClaimsV2(
  workspaceId: string,
  filters: ListFilters & { sessionId?: string } = {},
): Promise<StudyClaim[]> {
  const conditions: SQL[] = [eq(studyClaims.workspaceId, workspaceId)];
  if (filters.sessionId) {
    conditions.push(eq(studyClaims.sessionId, filters.sessionId));
  }
  if (!filters.includeDeleted) conditions.push(isNull(studyClaims.deletedAt));

  const rows = await db
    .select()
    .from(studyClaims)
    .where(and(...conditions))
    .orderBy(desc(studyClaims.createdAt))
    .limit(resolveListLimit(filters.limit));
  return rows.map(serializeClaim);
}

export async function getClaimV2(
  workspaceId: string,
  id: string,
): Promise<StudyClaim | null> {
  const [row] = await db
    .select()
    .from(studyClaims)
    .where(
      and(
        eq(studyClaims.id, id),
        eq(studyClaims.workspaceId, workspaceId),
        isNull(studyClaims.deletedAt),
      ),
    )
    .limit(1);
  return row ? serializeClaim(row) : null;
}

/**
 * Evidence for one claim. Returns `null` (not an empty array) when the claim
 * itself does not resolve inside `workspaceId` — the caller (the route) must
 * turn that into a 404 rather than a 200 with an empty list, so a probe for
 * another workspace's claim id cannot be told apart from "this claim has no
 * evidence yet" by response shape alone. A soft-deleted parent claim does
 * not resolve either (`getClaimV2` already excludes it), so evidence under a
 * deleted claim id 404s the same way — a learner who deletes a claim cannot
 * still reach its evidence by re-fetching the claim id directly.
 */
export async function listClaimEvidenceV2(
  workspaceId: string,
  claimId: string,
  filters: ListFilters = {},
): Promise<ClaimEvidence[] | null> {
  const claim = await getClaimV2(workspaceId, claimId);
  if (!claim) return null;

  const conditions: SQL[] = [
    eq(claimEvidence.workspaceId, workspaceId),
    eq(claimEvidence.claimId, claimId),
  ];
  if (!filters.includeDeleted) conditions.push(isNull(claimEvidence.deletedAt));

  const rows = await db
    .select()
    .from(claimEvidence)
    .where(and(...conditions))
    .orderBy(desc(claimEvidence.createdAt))
    .limit(resolveListLimit(filters.limit));
  return rows.map(serializeEvidence);
}

// ---------------------------------------------------------------------------
// Motif candidates + sightings
// ---------------------------------------------------------------------------

export async function listMotifCandidatesV2(
  workspaceId: string,
  filters: ListFilters = {},
): Promise<MotifCandidate[]> {
  const conditions: SQL[] = [eq(motifCandidates.workspaceId, workspaceId)];
  if (!filters.includeDeleted) conditions.push(isNull(motifCandidates.deletedAt));

  const rows = await db
    .select()
    .from(motifCandidates)
    .where(and(...conditions))
    .orderBy(desc(motifCandidates.createdAt))
    .limit(resolveListLimit(filters.limit));
  return rows.map(serializeMotifCandidate);
}

export async function getMotifCandidateV2(
  workspaceId: string,
  id: string,
): Promise<MotifCandidate | null> {
  const [row] = await db
    .select()
    .from(motifCandidates)
    .where(
      and(
        eq(motifCandidates.id, id),
        eq(motifCandidates.workspaceId, workspaceId),
        isNull(motifCandidates.deletedAt),
      ),
    )
    .limit(1);
  return row ? serializeMotifCandidate(row) : null;
}

/**
 * Sightings for one motif candidate. Same null-vs-empty-array contract as
 * `listClaimEvidenceV2`: `null` means the parent candidate did not resolve
 * (wrong workspace, deleted, or unknown id) and the route must 404 rather
 * than return an empty list.
 */
export async function listMotifSightingsV2(
  workspaceId: string,
  candidateId: string,
  filters: ListFilters = {},
): Promise<MotifSighting[] | null> {
  const candidate = await getMotifCandidateV2(workspaceId, candidateId);
  if (!candidate) return null;

  const conditions: SQL[] = [
    eq(motifSightings.workspaceId, workspaceId),
    eq(motifSightings.candidateId, candidateId),
  ];
  if (!filters.includeDeleted) conditions.push(isNull(motifSightings.deletedAt));

  const rows = await db
    .select()
    .from(motifSightings)
    .where(and(...conditions))
    .orderBy(desc(motifSightings.createdAt))
    .limit(resolveListLimit(filters.limit));
  return rows.map(serializeMotifSighting);
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export async function listConnectionsV2(
  workspaceId: string,
  filters: ListFilters = {},
): Promise<UserConnection[]> {
  const conditions: SQL[] = [eq(userConnections.workspaceId, workspaceId)];
  if (!filters.includeDeleted) conditions.push(isNull(userConnections.deletedAt));

  const rows = await db
    .select()
    .from(userConnections)
    .where(and(...conditions))
    .orderBy(desc(userConnections.createdAt))
    .limit(resolveListLimit(filters.limit));
  return rows.map(serializeConnection);
}

export async function getConnectionV2(
  workspaceId: string,
  id: string,
): Promise<UserConnection | null> {
  const [row] = await db
    .select()
    .from(userConnections)
    .where(
      and(
        eq(userConnections.id, id),
        eq(userConnections.workspaceId, workspaceId),
        isNull(userConnections.deletedAt),
      ),
    )
    .limit(1);
  return row ? serializeConnection(row) : null;
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export async function listApplicationsV2(
  workspaceId: string,
  filters: ListFilters & { sessionId?: string } = {},
): Promise<Application[]> {
  const conditions: SQL[] = [eq(applications.workspaceId, workspaceId)];
  if (filters.sessionId) {
    conditions.push(eq(applications.sessionId, filters.sessionId));
  }
  if (!filters.includeDeleted) conditions.push(isNull(applications.deletedAt));

  const rows = await db
    .select()
    .from(applications)
    .where(and(...conditions))
    .orderBy(desc(applications.createdAt))
    .limit(resolveListLimit(filters.limit));
  return rows.map(serializeApplication);
}

export async function getApplicationV2(
  workspaceId: string,
  id: string,
): Promise<Application | null> {
  const [row] = await db
    .select()
    .from(applications)
    .where(
      and(
        eq(applications.id, id),
        eq(applications.workspaceId, workspaceId),
        isNull(applications.deletedAt),
      ),
    )
    .limit(1);
  return row ? serializeApplication(row) : null;
}

// ---------------------------------------------------------------------------
// Teaching drafts
// ---------------------------------------------------------------------------

export async function listTeachingDraftsV2(
  workspaceId: string,
  filters: ListFilters & { sessionId?: string } = {},
): Promise<TeachingDraft[]> {
  const conditions: SQL[] = [eq(teachingDrafts.workspaceId, workspaceId)];
  if (filters.sessionId) {
    conditions.push(eq(teachingDrafts.sessionId, filters.sessionId));
  }
  if (!filters.includeDeleted) conditions.push(isNull(teachingDrafts.deletedAt));

  const rows = await db
    .select()
    .from(teachingDrafts)
    .where(and(...conditions))
    .orderBy(desc(teachingDrafts.createdAt))
    .limit(resolveListLimit(filters.limit));
  return rows.map(serializeTeachingDraft);
}

export async function getTeachingDraftV2(
  workspaceId: string,
  id: string,
): Promise<TeachingDraft | null> {
  const [row] = await db
    .select()
    .from(teachingDrafts)
    .where(
      and(
        eq(teachingDrafts.id, id),
        eq(teachingDrafts.workspaceId, workspaceId),
        isNull(teachingDrafts.deletedAt),
      ),
    )
    .limit(1);
  return row ? serializeTeachingDraft(row) : null;
}
