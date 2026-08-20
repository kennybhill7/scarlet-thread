import "server-only";

import { z } from "zod";

import { invalidRequest, notFound, privateJson, serverError, unauthorized } from "@/lib/api/response";
import { auth } from "@/lib/auth/config";
import { and, eq, isNull } from "drizzle-orm";
import { motifCandidates } from "@/db/schema";
import { db } from "@/lib/db";
import {
  MOTIF_CANDIDATE_PENDING_STATUS,
  MotifCandidateNotFoundError,
  MotifDismissalAlreadyResolvedError,
  MotifThreadSlugCollisionError,
  dismissMotifCandidate,
  promoteMotifCandidate,
} from "@/lib/db/radar";
import { getOrCreatePersonalWorkspace } from "@/lib/db/workspaces";

/**
 * POST /api/motifs/[id] — the only two things a learner can do with an
 * offered motif candidate: confirm it (promote to a thread) or dismiss it.
 * RADARUI-001.
 *
 * ---------------------------------------------------------------------
 * TENET 7 DECISION (acceptance criterion 2) — read before changing this file
 * ---------------------------------------------------------------------
 * BUILD_PLAN.md tenet 7: "Sync push is the sole browser mutation path for
 * learner entities... The browser never both enqueues an op and calls an
 * independent REST mutation." §3.4 restates it for the v2 surface
 * specifically: new v2 routes are read-only; "No independent REST
 * mutations."
 *
 * DECISION: this route is a genuine, narrow, DELIBERATE exception to that
 * rule, not a violation of it slipped in unnoticed. It does not live under
 * `app/api/v2/` and does not go through `app/api/v2/_lib/guard.ts` (that
 * guard's `rejectMutation` enforces tenet 7 for the resource routes it
 * fronts; this route is not one of them, by design — see this task's own
 * `ownedPaths`, which name `web/app/api/motifs/`, never anything under
 * `web/app/api/v2/` or `web/app/api/sync/`).
 *
 * Why an exception rather than routing through sync push:
 *
 * 1. Sync push's contract is "the client holds a local copy of an entity's
 *    field values and asks the server to accept them if the base revision
 *    still matches" (optimistic concurrency over a client-authored state).
 *    Confirm/dismiss are not edits to client-held field values at all — they
 *    are the learner picking one of exactly two SERVER-DEFINED transitions
 *    on a candidate the server itself computed
 *    (`persistMotifCandidates`/`computeMotifCandidates`, `lib/db/radar.ts`).
 *    There is no learner-authored payload to carry.
 *
 * 2. Promotion is not a single-entity field update — it is one atomic
 *    transaction across the candidate row, every one of its sighting rows,
 *    AND a new v1 `threads` row (`promoteMotifCandidate`'s own header:
 *    "every write below... is issued as ONE `db.batch([...])` call"), with a
 *    real failure mode (`MotifThreadSlugCollisionError`) that must roll back
 *    every earlier write in the same batch. The v2 sync-push wire format
 *    (`lib/contracts/sync-v2.ts`'s `SYNC_ENTITIES_V2`) has no `"thread"`
 *    entity at all — `threads` is a v1 table, sync'd (if at all) through the
 *    *separate* v1 path in `lib/db/sync.ts`, which the v2 wire format cannot
 *    reach. Decomposing this transaction into independent per-entity sync
 *    ops would either lose its atomicity or require inventing exactly the
 *    kind of second, ad hoc write mechanism tenet 7 exists to prevent — just
 *    relocated one layer down, inside the sync planner instead of a route.
 *
 * 3. `promoteMotifCandidate` is written as a privileged SERVER operation, not
 *    a client-authored upsert: it re-derives the sighting count itself from
 *    the database rather than trusting a caller-supplied number, and refuses
 *    outright (`MotifPromotionNotConfirmedError`) unless
 *    `options.learnerConfirmed === true` is supplied by the CALLER (this
 *    route), before touching the database at all. Generic sync-push upsert
 *    semantics (`lib/db/sync-v2.ts`'s `planMotifOp`, which accepts an
 *    arbitrary client-supplied `status: string` with no enumerated values —
 *    see `syncMotifCandidateV2Schema` — and no re-validation of "does this
 *    candidate genuinely have >= 3 live sightings") could not honor either
 *    guarantee without duplicating this route's own logic inside the sync
 *    planner anyway.
 *
 * Because sync push has never had, and after this task still does not have,
 * ANY way to set a motif candidate's status (`motif`/`motifSighting` sync
 * ops are wired in `lib/db/sync-v2.ts` but that module is not called from
 * any live route yet — `pushSyncOpsV2` has no caller in `app/`), this route
 * is not a SECOND mutation path competing with a first one for this entity —
 * it is the only one. Tenet 7's actual concern (one entity, two independently
 * evolving write paths that can diverge) does not arise here. If a future
 * task wires `pushSyncOpsV2` behind a live `/api/sync/push`-v2 route, THAT
 * task must either exclude `motif.status` transitions from the generic
 * upsert (leaving this route the sole writer of that field) or fold this
 * route's confirm/dismiss logic into the sync planner — silently allowing
 * both to write `status` would reopen exactly the hazard this decision
 * closes. Flagged here so it is not rediscovered from scratch.
 *
 * RESIDUAL DOC GAP (SCOPE-BOUNDARY-001 — reported, not silently left):
 * `BUILD_PLAN.md` §3.4 currently reads "No independent REST mutations" with
 * no exception noted, and `BUILD_PLAN.md` is a readOnlyPath for this task —
 * it cannot be edited here. The disagreement between that line and this
 * route's existence is real and is disclosed in this task's commit message
 * and completion report, not hidden. A follow-up doc task should add one
 * sentence to §3.4 carving out motif-candidate confirm/dismiss by name, the
 * same way this comment does in code.
 * ---------------------------------------------------------------------
 *
 * The UI wording lives in `components/motif-radar.tsx` — this route deals
 * only in the two action verbs, never in the sentence a learner reads.
 */

const motifActionSchema = z.object({ action: z.enum(["confirm", "dismiss"]) }).strict();

type RouteContext = { params: Promise<{ id: string }> };

async function loadOwnedPendingCandidate(workspaceId: string, candidateId: string) {
  const [row] = await db
    .select({ id: motifCandidates.id, status: motifCandidates.status })
    .from(motifCandidates)
    .where(
      and(
        eq(motifCandidates.id, candidateId),
        eq(motifCandidates.workspaceId, workspaceId),
        isNull(motifCandidates.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return privateJson(
      { error: { code: "INVALID_JSON", message: "Request body must be valid JSON" } },
      { status: 400 },
    );
  }

  const parsed = motifActionSchema.safeParse(body);
  if (!parsed.success) return invalidRequest(parsed.error);

  const { id: candidateId } = await context.params;

  try {
    // Workspace is derived from the authenticated session ONLY — never from
    // the URL, the body, or any other caller-supplied value (V2API-001's
    // rule, applied identically here even though this is not a v2 route).
    const workspaceId = await getOrCreatePersonalWorkspace(session.user.id);

    // A candidate id belonging to another workspace, or that does not exist
    // at all, resolves to 404 here -- before either learner action runs, and
    // before promoteMotifCandidate/dismissMotifCandidate (both workspace-
    // scoped internally too) are ever reached. Acceptance criterion 5.
    const candidate = await loadOwnedPendingCandidate(workspaceId, candidateId);
    if (!candidate) return notFound();

    // A candidate this route already resolved once (promoted or dismissed
    // on an earlier request) is not "offered" any more -- refuse rather than
    // silently re-resolve it a second time. MOTIFSTATUS-001 gave
    // `dismissMotifCandidate` its own equivalent guard, so this is now
    // genuine defense in depth rather than the only thing standing between a
    // learner and a corrupted status. This check stays: it answers with a
    // precise 409 the UI can render, and it refuses BEFORE touching the
    // database. radar.ts's guard is the backstop for the narrow race this
    // read-then-check cannot close on its own -- two dismisses, or a dismiss
    // and a confirm, arriving close enough together that both read a
    // still-pending row. That loser surfaces below as the same 409, never a
    // 500.
    if (candidate.status !== MOTIF_CANDIDATE_PENDING_STATUS) {
      return privateJson(
        {
          error: {
            code: "MOTIF_CANDIDATE_ALREADY_RESOLVED",
            message: `This suggestion was already "${candidate.status}" -- it can't be acted on again.`,
          },
        },
        { status: 409 },
      );
    }

    // The ONLY place `learnerConfirmed` is ever produced, and the ONE line
    // criterion 6's mutation proof targets: derived strictly from which of
    // the two zod-validated actions the learner explicitly took, never read
    // as a raw boolean off the request body (a client could just say
    // "true"), never defaulted. Hardcoding this to `true` makes a "dismiss"
    // request fall into the promote branch below instead of the dismiss
    // one -- see tests/motif-ui.test.ts's named mutation-proof test.
    const learnerConfirmed = parsed.data.action === "confirm";

    if (learnerConfirmed) {
      const result = await promoteMotifCandidate(workspaceId, session.user.id, candidateId, {
        learnerConfirmed,
      });
      return privateJson({
        data: {
          action: "confirm" as const,
          candidateId,
          threadSlug: result.threadSlug,
          threadTitle: result.threadTitle,
        },
      });
    }

    // Dismissing NEVER touches the sightings or the entries behind them
    // (`dismissMotifCandidate`'s own header) -- only this one candidate
    // row's status flips. Acceptance criterion 4's "visibly non-destructive"
    // half is the UI copy in components/motif-radar.tsx; this is the half
    // that makes the claim true.
    await dismissMotifCandidate(workspaceId, candidateId);
    return privateJson({ data: { action: "dismiss" as const, candidateId } });
  } catch (error) {
    if (error instanceof MotifCandidateNotFoundError) return notFound();
    // radar.ts's own already-resolved guard (MOTIFSTATUS-001), reached only
    // when the read-then-check above lost a race. Same code, same status as
    // this route's own refusal -- a caller must not be able to tell which of
    // the two layers refused, and must never get a 500 for an ordinary
    // double-click.
    if (error instanceof MotifDismissalAlreadyResolvedError) {
      return privateJson(
        {
          error: {
            code: "MOTIF_CANDIDATE_ALREADY_RESOLVED",
            message: `This suggestion was already "${error.status}" -- it can't be acted on again.`,
          },
        },
        { status: 409 },
      );
    }
    if (error instanceof MotifThreadSlugCollisionError) {
      return privateJson(
        { error: { code: "MOTIF_THREAD_SLUG_COLLISION", message: error.message } },
        { status: 409 },
      );
    }
    return serverError(error);
  }
}

function methodNotAllowed() {
  return privateJson(
    { error: { code: "METHOD_NOT_ALLOWED", message: "Only POST is supported on /api/motifs/[id]" } },
    { status: 405 },
  );
}

export async function GET() {
  return methodNotAllowed();
}
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
