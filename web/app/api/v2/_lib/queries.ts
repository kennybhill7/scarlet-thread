import "server-only";

import { and, eq } from "drizzle-orm";

import { claimEvidence, studyClaims, studySessions } from "@/db/schema";
import { db } from "@/lib/db";
import { toIsoTimestamp, toOptionalIsoTimestamp } from "@/lib/db/time";
import type { ClaimEvidence, StudyClaim, StudySession } from "@/lib/contracts/study-v2";

/**
 * V2API-001 read-only data access for the v2 resource routes. Every function
 * here takes `workspaceId` as a required argument and every query below
 * includes `eq(<table>.workspaceId, workspaceId)` — that predicate is the
 * whole tenant-isolation guarantee for this task (see
 * `tests/v2-api.test.ts`'s mutation proof, which removes it and confirms a
 * named cross-tenant test fails). Callers (the route handlers in
 * `app/api/v2/**`) get `workspaceId` exclusively from
 * `app/api/v2/_lib/guard.ts`'s `withReadOnlyV2Workspace`, which derives it
 * from the authenticated session — never from anything the caller supplied.
 */

type StudySessionRow = typeof studySessions.$inferSelect;
type StudyClaimRow = typeof studyClaims.$inferSelect;
type ClaimEvidenceRow = typeof claimEvidence.$inferSelect;

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

export async function listSessionsV2(workspaceId: string): Promise<StudySession[]> {
  const rows = await db
    .select()
    .from(studySessions)
    .where(eq(studySessions.workspaceId, workspaceId));
  return rows.map(serializeSession);
}

export async function getSessionV2(
  workspaceId: string,
  id: string,
): Promise<StudySession | null> {
  const [row] = await db
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.id, id), eq(studySessions.workspaceId, workspaceId)))
    .limit(1);
  return row ? serializeSession(row) : null;
}

export async function listClaimsV2(
  workspaceId: string,
  filters: { sessionId?: string } = {},
): Promise<StudyClaim[]> {
  const conditions = [eq(studyClaims.workspaceId, workspaceId)];
  if (filters.sessionId) {
    conditions.push(eq(studyClaims.sessionId, filters.sessionId));
  }
  const rows = await db
    .select()
    .from(studyClaims)
    .where(and(...conditions));
  return rows.map(serializeClaim);
}

export async function getClaimV2(
  workspaceId: string,
  id: string,
): Promise<StudyClaim | null> {
  const [row] = await db
    .select()
    .from(studyClaims)
    .where(and(eq(studyClaims.id, id), eq(studyClaims.workspaceId, workspaceId)))
    .limit(1);
  return row ? serializeClaim(row) : null;
}

/**
 * Evidence for one claim. Returns `null` (not an empty array) when the claim
 * itself does not resolve inside `workspaceId` — the caller (the route) must
 * turn that into a 404 rather than a 200 with an empty list, so a probe for
 * another workspace's claim id cannot be told apart from "this claim has no
 * evidence yet" by response shape alone.
 */
export async function listClaimEvidenceV2(
  workspaceId: string,
  claimId: string,
): Promise<ClaimEvidence[] | null> {
  const claim = await getClaimV2(workspaceId, claimId);
  if (!claim) return null;

  const rows = await db
    .select()
    .from(claimEvidence)
    .where(and(eq(claimEvidence.workspaceId, workspaceId), eq(claimEvidence.claimId, claimId)));
  return rows.map(serializeEvidence);
}
