import "server-only";

import { eq } from "drizzle-orm";

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
import { getOrCreatePersonalWorkspace } from "@/lib/db/workspaces";

/**
 * SYNCV2ROUTE-001 — the read half of the v2 sync wire, mirroring
 * `lib/db/sync.ts`'s `pullSyncChanges` shape exactly (one array per entity,
 * plus `serverTime`), scoped to the eight v2 entities instead of v1's six.
 *
 * There is no existing `pullSyncChangesV2` to delegate to (`lib/db/sync-v2.ts`
 * is read-only for this task and SYNCPERSIST-001 only built the WRITE side,
 * `pushSyncOpsV2` — see that file's own header, which never mentions a pull
 * function). This is new READ-only query logic, not a second copy of any
 * existing persistence path: it issues one plain `eq(table.workspaceId, ...)`
 * select per v2 table, the same shape `app/api/motifs/route.ts` (V2API-001)
 * already uses for exactly this table set, and writes nothing.
 *
 * Workspace resolution goes through `lib/db/workspaces.ts`'s
 * `getOrCreatePersonalWorkspace` (the same function `app/api/v2/_lib/guard.ts`
 * uses for every v2 resource route) rather than a caller-supplied workspace
 * id — the acting user's OWN workspace is derived from their session-verified
 * `userId`, never from anything the request carries. That is what makes "a
 * pull returns nothing belonging to another account" true structurally,
 * not just by convention: there is no parameter through which a caller could
 * even ask for a different workspace's data.
 *
 * No `deletedAt` filter, matching `pullSyncChanges`'s dominant pattern for
 * entries/threads/progress/logs (only v1 `people` filters it, for a reason
 * specific to that entity) — a soft-deleted v2 row's tombstone must still
 * reach every device so a delete propagates instead of only ever being
 * visible on the device that issued it.
 *
 * `db.batch(...)` for the same reason `pullSyncChanges` uses it: Neon HTTP
 * batch is one transaction, so all eight arrays reflect one consistent
 * snapshot rather than eight independent reads that could interleave with a
 * concurrent write.
 */
export interface SyncChangesV2 {
  serverTime: string;
  session: StudySession[];
  claim: StudyClaim[];
  evidence: ClaimEvidence[];
  motif: MotifCandidate[];
  motifSighting: MotifSighting[];
  connection: UserConnection[];
  application: Application[];
  teachingDraft: TeachingDraft[];
}

export async function pullSyncChangesV2(userId: string): Promise<SyncChangesV2> {
  const workspaceId = await getOrCreatePersonalWorkspace(userId);
  const serverTime = new Date().toISOString();

  const [
    sessionRows,
    claimRows,
    evidenceRows,
    motifRows,
    motifSightingRows,
    connectionRows,
    applicationRows,
    teachingDraftRows,
  ] = await db.batch([
    db.select().from(studySessions).where(eq(studySessions.workspaceId, workspaceId)),
    db.select().from(studyClaims).where(eq(studyClaims.workspaceId, workspaceId)),
    db.select().from(claimEvidence).where(eq(claimEvidence.workspaceId, workspaceId)),
    db.select().from(motifCandidates).where(eq(motifCandidates.workspaceId, workspaceId)),
    db.select().from(motifSightings).where(eq(motifSightings.workspaceId, workspaceId)),
    db.select().from(userConnections).where(eq(userConnections.workspaceId, workspaceId)),
    db.select().from(applications).where(eq(applications.workspaceId, workspaceId)),
    db.select().from(teachingDrafts).where(eq(teachingDrafts.workspaceId, workspaceId)),
  ]);

  return {
    serverTime,
    session: sessionRows as StudySession[],
    claim: claimRows as StudyClaim[],
    evidence: evidenceRows as ClaimEvidence[],
    motif: motifRows as MotifCandidate[],
    motifSighting: motifSightingRows as MotifSighting[],
    connection: connectionRows as UserConnection[],
    application: applicationRows as Application[],
    teachingDraft: teachingDraftRows as TeachingDraft[],
  };
}
