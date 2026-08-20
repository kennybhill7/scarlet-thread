import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { privateJson, serverError, unauthorized } from "@/lib/api/response";
import { auth } from "@/lib/auth/config";
import { motifCandidates, motifSightings } from "@/db/schema";
import { db } from "@/lib/db";
import { listEntries } from "@/lib/db/entries";
import {
  MOTIF_CANDIDATE_PENDING_STATUS,
  persistMotifCandidates,
} from "@/lib/db/radar";
import { listThreads } from "@/lib/db/threads";
import { getOrCreatePersonalWorkspace } from "@/lib/db/workspaces";

/**
 * RADARUI-001 — the seam between the radar's word-frequency pass
 * (`lib/db/radar.ts`, RADAR-001) and the person reading it. Nothing called
 * `persistMotifCandidates`/`dismissMotifCandidate`/`promoteMotifCandidate`
 * before this task; this route (list) plus `[id]/route.ts` (act) are that
 * wiring.
 *
 * GET /api/motifs — "the offered candidates for the acting workspace"
 * (acceptance criterion 1). Two steps, in order:
 *
 *  1. Recompute-and-persist: fetch this learner's entries/threads (the same
 *     v1 reads `app/(app)/review/page.tsx` already performs for its
 *     unpersisted "Thread radar" hint section) and run them through
 *     `persistMotifCandidates`, exactly like `review/page.tsx`'s
 *     `computeMotifCandidates` call always has — the only change is that the
 *     result now lands in `motif_candidates`/`motif_sightings` instead of
 *     being thrown away after one render. `persistMotifCandidates` is
 *     dedup-safe (RADARPERSIST-001 acceptance criterion 5): re-running it
 *     never creates a second row for a normalizedKey that already has a live
 *     one, so calling it on every GET is safe, not wasteful-and-risky.
 *  2. Read: return every LIVE, PENDING candidate for this workspace, newest
 *     first, each carrying its real current sightings (queried fresh from
 *     `motif_sightings`, not the in-memory pass above, so a candidate that
 *     was persisted on an earlier visit and has since gained more sightings
 *     reports its true count).
 *
 * This route is deliberately a GET with a side effect (the persist step) —
 * not a REST mutation of a learner-authored entity. The words the radar
 * counts are the learner's own already-synced entry text; what this route
 * writes is a DERIVED, recomputed-on-every-read artifact of that text, the
 * same category of lazy materialization `lib/db/workspaces.ts`'s own
 * `getOrCreatePersonalWorkspace` already performs from inside a GET-shaped
 * caller (`app/api/v2/_lib/guard.ts`'s `withReadOnlyV2Workspace`). It is not
 * the kind of write BUILD_PLAN tenet 7 is about — see `[id]/route.ts`'s
 * header for the tenet-7 decision that DOES matter here (confirm/dismiss).
 *
 * Bounded page size (V2API-002's own convention, applied here even though
 * this task's acceptance criteria do not require it): default AND maximum
 * are both `LIST_LIMIT` below — there is no caller-supplied page size to
 * widen it. A workspace with more live pending candidates than this simply
 * shows its newest ones; nothing about the third-sighting rule requires
 * showing every candidate ever computed at once.
 */
const LIST_LIMIT = 50;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  try {
    const workspaceId = await getOrCreatePersonalWorkspace(session.user.id);

    const [entries, threads] = await Promise.all([
      listEntries(session.user.id, {}),
      listThreads(session.user.id),
    ]);
    await persistMotifCandidates(workspaceId, entries, threads);

    const candidateRows = await db
      .select()
      .from(motifCandidates)
      .where(
        and(
          eq(motifCandidates.workspaceId, workspaceId),
          eq(motifCandidates.status, MOTIF_CANDIDATE_PENDING_STATUS),
          isNull(motifCandidates.deletedAt),
        ),
      )
      .orderBy(desc(motifCandidates.createdAt))
      .limit(LIST_LIMIT);

    // One sightings query per candidate rather than a single `IN (...)`
    // query -- this route's list is bounded to `LIST_LIMIT` candidates, so
    // the N+1 cost is small and fixed, and it keeps every WHERE clause this
    // route issues in the same `=` / `is null` / `and` shape every other
    // hand-written query in this codebase uses (queries.ts, radar.ts,
    // workspaces.ts) rather than introducing `IN` as a one-off.
    const data = await Promise.all(
      candidateRows.map(async (row) => {
        const sightingRows = await db
          .select({ passageUnitKey: motifSightings.passageUnitKey })
          .from(motifSightings)
          .where(
            and(
              eq(motifSightings.workspaceId, workspaceId),
              eq(motifSightings.candidateId, row.id),
              isNull(motifSightings.deletedAt),
            ),
          );
        const passages = sightingRows.map((s) => s.passageUnitKey).sort();
        return {
          id: row.id,
          label: row.label,
          normalizedKey: row.normalizedKey,
          passages,
          sightingCount: passages.length,
        };
      }),
    );

    return privateJson({ data });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST() {
  return privateJson(
    { error: { code: "METHOD_NOT_ALLOWED", message: "GET only — act on one candidate via /api/motifs/[id]" } },
    { status: 405 },
  );
}
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
