import { and, eq, isNull } from "drizzle-orm";

import {
  applications,
  claimEvidence,
  dailyLogs,
  motifCandidates,
  motifSightings,
  people,
  studyClaims,
  studySessions,
  teachingDrafts,
  userConnections,
} from "@/db/schema";
import { unauthorized, serverError } from "@/lib/api/response";
import { auth } from "@/lib/auth/config";
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
import { db } from "@/lib/db";
import { listEntries } from "@/lib/db/entries";
import { listThreads } from "@/lib/db/threads";
import { toIsoTimestamp, toOptionalIsoTimestamp } from "@/lib/db/time";
import { getOrCreatePersonalWorkspace } from "@/lib/db/workspaces";
import { buildVaultArchive } from "@/lib/export/vault";

// ---------------------------------------------------------------------------
// EXPORTROUTE-001 — the door EXPORTV2-001 reported missing: this route now
// queries all eight v2 tables and hands them, plus the resolved workspaceId,
// to buildVaultArchive (lib/export/vault.ts, a readOnlyPath for this task).
//
// workspaceId is resolved from the SESSION via lib/db/workspaces.ts's
// getOrCreatePersonalWorkspace(userId) — never from anything a caller could
// supply (this route accepts no request body/query at all, so there is no
// caller-supplied workspace id to reject in the first place; the risk this
// guards against is accidentally deriving workspaceId from something other
// than the authenticated session, e.g. userId itself).
//
// Every v2 query below is scoped `eq(<table>.workspaceId, workspaceId)` —
// the same shape app/api/v2/_lib/queries.ts already established for the v2
// read routes (V2API-001/002) — but deliberately does NOT reuse those
// exported functions: they cap results at V2_LIST_MAX_LIMIT (200) and
// exclude soft-deleted rows by default, both wrong for a full-ownership
// export (see vault.ts's own header: v2 export includes every row,
// tombstoned or not, so a learner's export is genuinely everything they
// ever wrote). So this route queries the tables directly, unbounded, with no
// deletedAt filter, and serializes each row into its lib/contracts/study-v2
// shape itself — the same per-row mapping queries.ts's serialize* functions
// use, just without the limit/soft-delete narrowing that module's read
// routes need for a different purpose.
//
// buildVaultArchive itself re-scopes every v2 row to `workspaceId` again
// before rendering (vault.ts's own tenant-isolation guarantee, proven by
// tests/export-v2.test.ts's hostile cases) — that is intentional
// defense-in-depth, not redundancy this route may skip: querying every
// workspace's rows unscoped here would still produce a correct archive
// (vault.ts would filter it down) but would fetch unrelated learners' data
// out of the database on every export request, which is its own problem
// independent of what ends up in the response body. This route's own
// workspaceId predicate is what keeps the query itself scoped.
// ---------------------------------------------------------------------------

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

function serializeMotif(row: MotifCandidateRow): MotifCandidate {
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

function serializeSighting(row: MotifSightingRow): MotifSighting {
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

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  try {
    const userId = session.user.id;
    // Resolved from the session, never from a caller-supplied value — see
    // header comment. Called unconditionally (even for a learner with no v2
    // data yet) so the workspaceId this route passes to buildVaultArchive is
    // always the caller's own, real personal workspace.
    const workspaceId = await getOrCreatePersonalWorkspace(userId);

    const [
      entries,
      threads,
      peopleRows,
      logRows,
      sessionRows,
      claimRows,
      evidenceRows,
      motifRows,
      sightingRows,
      connectionRows,
      applicationRows,
      teachingDraftRows,
    ] = await Promise.all([
      listEntries(userId, { includeDeleted: false }),
      listThreads(userId),
      db
        .select()
        .from(people)
        .where(and(eq(people.userId, userId), isNull(people.deletedAt))),
      db
        .select()
        .from(dailyLogs)
        .where(eq(dailyLogs.userId, userId)),
      db
        .select()
        .from(studySessions)
        .where(eq(studySessions.workspaceId, workspaceId)),
      db
        .select()
        .from(studyClaims)
        .where(eq(studyClaims.workspaceId, workspaceId)),
      db
        .select()
        .from(claimEvidence)
        .where(eq(claimEvidence.workspaceId, workspaceId)),
      db
        .select()
        .from(motifCandidates)
        .where(eq(motifCandidates.workspaceId, workspaceId)),
      db
        .select()
        .from(motifSightings)
        .where(eq(motifSightings.workspaceId, workspaceId)),
      db
        .select()
        .from(userConnections)
        .where(eq(userConnections.workspaceId, workspaceId)),
      db
        .select()
        .from(applications)
        .where(eq(applications.workspaceId, workspaceId)),
      db
        .select()
        .from(teachingDrafts)
        .where(eq(teachingDrafts.workspaceId, workspaceId)),
    ]);

    const archive = buildVaultArchive({
      entries,
      threads,
      people: peopleRows.map((person) => ({
        slug: person.slug,
        name: person.name,
        body: person.body,
        chapters: person.chapters,
        threads: person.threadSlugs,
        createdAt: toIsoTimestamp(person.createdAt),
        updatedAt: toIsoTimestamp(person.updatedAt),
      })),
      logs: logRows.map((log) => ({
        date: log.date,
        chapter: log.chapter,
        steps: {
          read: log.read,
          observe: log.observe,
          link: log.link,
          ask: log.ask,
          pray: log.pray,
        },
        sentence: log.sentence,
        carrying: log.carrying,
        prayer: log.prayer,
        updatedAt: toIsoTimestamp(log.updatedAt),
      })),
      workspaceId,
      session: sessionRows.map(serializeSession),
      claim: claimRows.map(serializeClaim),
      evidence: evidenceRows.map(serializeEvidence),
      motif: motifRows.map(serializeMotif),
      motifSighting: sightingRows.map(serializeSighting),
      connection: connectionRows.map(serializeConnection),
      application: applicationRows.map(serializeApplication),
      teachingDraft: teachingDraftRows.map(serializeTeachingDraft),
    });

    return new Response(new Blob([archive]), {
      headers: {
        "content-type": "application/zip",
        "content-disposition":
          'attachment; filename="scarlet-thread-vault.zip"',
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return serverError(error);
  }
}
