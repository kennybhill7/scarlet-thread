import { notFound, redirect } from "next/navigation";

import { stages as stagesTable } from "@/db/schema";
import type { Stage } from "@/lib/contracts";
import { ThreadDetail } from "@/components/threads/ThreadDetail";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { listThreads } from "@/lib/db/threads";
import { getOrCreatePersonalWorkspace } from "@/lib/db/workspaces";

/**
 * CONNECTIONEXPLORER-001 — this page previously mounted `ThreadDetail` with
 * only the route's own `slug`, no server-resolved identity at all. That
 * was fine while `ThreadDetail` only ever read/wrote v1 `Thread`/`Entry`
 * rows (both unscoped by `workspaceId` in `lib/contracts.ts`), but this task
 * adds a NEW read of `UserConnection` rows (`lib/contracts/study-v2.ts`),
 * which ARE `workspaceId`-scoped. `ThreadDetail` must never derive or accept
 * a workspace id from anywhere a caller could smuggle one in — the same rule
 * `app/(app)/study/[sessionId]/page.tsx`'s own "WORKSPACE RESOLUTION" block
 * comment documents for that sibling page, copied here rather than
 * reinvented, since that file is this task's named precedent to follow.
 *
 * This page's dynamic segment is `[slug]` (which THREAD), never
 * `[workspaceId]`, and the component below never destructures
 * `searchParams` — there is no code path through which a caller could even
 * attempt to hand this page a workspace id. `workspaceId` is derived exactly
 * once, server-side, via `getOrCreatePersonalWorkspace(userId)` — the same
 * function `resolveStudyPageData` uses one layer down in the study page, and
 * the same one `app/api/v2/_lib/guard.ts`'s `withReadOnlyV2Workspace` uses
 * for every v2 read route — and passed to `ThreadDetail` as a plain prop.
 *
 * AUTH (acceptance criterion 2): `app/(app)/layout.tsx` already gates the
 * whole `(app)` route group with its own `resolveSessionState` call, and
 * `web/proxy.ts` gates it a layer above that again. Neither of those two
 * files is in this task's owned or read-only paths, so this file does NOT
 * rely on either silently covering it -- it duplicates the same
 * `resolveSessionState` shape `app/(app)/review/page.tsx` and
 * `app/(app)/study/[sessionId]/page.tsx` each already carry as their own
 * redundant, defense-in-depth check (see either file's own comment block for
 * the full rationale: a bare `auth()` call cannot tell "genuinely signed
 * out" apart from "the database is unreachable so the session lookup came
 * back null anyway"). This is this codebase's established habit, named
 * explicitly in this task's own spec ("do not invent a new auth pattern") --
 * not a gap being reintroduced.
 *
 * `ThreadDetail` itself still resolves WHICH thread (and whether it exists
 * on this device at all) entirely client-side, against the local IndexedDB
 * vault, exactly as it did before this task -- that half of this page is
 * unchanged.
 *
 * STAGEFILTER-001 -- adds a SECOND server-resolved prop, `stages`, alongside
 * `workspaceId`. `stages` is global reference data (`db/schema.ts`'s
 * `stages` table), not workspace-scoped, so it is queried the SAME way
 * `app/(app)/page.tsx` already does it -- `db.select().from(stagesTable)`,
 * no `WHERE`, no wrapper module (that file's own header comment explains why
 * a one-call `lib/db/stages.ts` wrapper isn't worth inventing for a table
 * this small; this task follows that same precedent rather than starting a
 * second one). Resolved by its own `resolveThreadStages`, parallel to (not
 * merged into) `resolveThreadWorkspace` below -- kept separate so this
 * task's addition never touches `resolveThreadWorkspace`'s own already-
 * tested return shape. Any failure to load stages (dead database, etc.)
 * collapses this page to the SAME "setup-incomplete" screen as a failed
 * workspace lookup, matching `app/(app)/page.tsx`'s own habit of collapsing
 * to one honest "can't reach your data" screen rather than trying to render
 * a partially degraded page.
 */

type ThreadPageProps = {
  params: Promise<{ slug: string }>;
};

const threadSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Session resolution -- identical shape to `app/(app)/study/[sessionId]/
// page.tsx`'s own `resolveSessionState` (and `app/(app)/review/page.tsx`'s
// copy of the same), duplicated again here rather than inventing a new one,
// because `lib/auth/config.ts` and `app/(app)/layout.tsx` are outside this
// task's owned paths (the latter isn't even in readOnlyPaths).
//
// SCOPE NOTE (SCOPE-BOUNDARY-001): same residual gap as the two sibling
// pages above -- `web/proxy.ts` and `app/(app)/layout.tsx` both call `auth()`
// without this probe, one or two layers above this file, so a normal
// browser navigation during a database outage may already be redirected to
// /sign-in before `ThreadPage` ever runs. Not this task's to close.
// ---------------------------------------------------------------------------

const PROBE_USER_ID = "00000000-0000-0000-0000-000000000000";

export type SessionState =
  | { status: "authenticated"; userId: string }
  | { status: "signed-out" }
  | { status: "setup-incomplete" };

export type SessionDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } | null } | null>;
  probeDatabase: () => Promise<unknown>;
};

const defaultSessionDeps: SessionDeps = {
  getSession: auth,
  probeDatabase: () => listThreads(PROBE_USER_ID),
};

export async function resolveSessionState(
  deps: SessionDeps = defaultSessionDeps,
): Promise<SessionState> {
  let session: Awaited<ReturnType<SessionDeps["getSession"]>>;
  try {
    session = await deps.getSession();
  } catch {
    return { status: "setup-incomplete" };
  }

  const userId = session?.user?.id;
  if (userId) return { status: "authenticated", userId };

  try {
    await deps.probeDatabase();
  } catch {
    return { status: "setup-incomplete" };
  }

  return { status: "signed-out" };
}

// ---------------------------------------------------------------------------
// Workspace resolution (acceptance criterion 2) -- the one seam between this
// page and the database past authentication. `routeSlug` is never consulted
// here at all; it stays entirely client-side inside `ThreadDetail`. Any
// thrown error (dead database, `getOrCreatePersonalWorkspace` failing, etc.)
// collapses to "setup-incomplete" rather than reaching the JSX, matching
// every other page in this route group.
// ---------------------------------------------------------------------------

export type ThreadWorkspaceDeps = {
  resolveWorkspaceId: (userId: string) => Promise<string>;
};

const defaultThreadWorkspaceDeps: ThreadWorkspaceDeps = {
  resolveWorkspaceId: getOrCreatePersonalWorkspace,
};

export type ThreadWorkspaceResolution =
  | { status: "setup-incomplete" }
  | { status: "ready"; workspaceId: string };

export async function resolveThreadWorkspace(
  userId: string,
  deps: ThreadWorkspaceDeps = defaultThreadWorkspaceDeps,
): Promise<ThreadWorkspaceResolution> {
  try {
    const workspaceId = await deps.resolveWorkspaceId(userId);
    return { status: "ready", workspaceId };
  } catch {
    return { status: "setup-incomplete" };
  }
}

// ---------------------------------------------------------------------------
// Stage resolution (STAGEFILTER-001) -- the second server-resolved prop,
// same shape/discipline as `resolveThreadWorkspace` above, deliberately kept
// as its own function with its own minimal deps type rather than folded into
// `ThreadWorkspaceDeps` (see this file's header comment) -- so a caller (or
// test) that only cares about workspace resolution never has to also supply
// an unrelated `getStages`. `stages` is global reference data, so unlike
// `resolveWorkspaceId` this needs no `userId` at all.
// ---------------------------------------------------------------------------

export type ThreadStagesDeps = {
  getStages: () => Promise<Stage[]>;
};

const defaultThreadStagesDeps: ThreadStagesDeps = {
  // Global reference data, unscoped -- matches app/(app)/page.tsx's own
  // `getStages: () => db.select().from(stagesTable)` exactly.
  getStages: () => db.select().from(stagesTable),
};

export type ThreadStagesResolution =
  | { status: "setup-incomplete" }
  | { status: "ready"; stages: Stage[] };

export async function resolveThreadStages(
  deps: ThreadStagesDeps = defaultThreadStagesDeps,
): Promise<ThreadStagesResolution> {
  try {
    const stages = await deps.getStages();
    return { status: "ready", stages };
  } catch {
    return { status: "setup-incomplete" };
  }
}

/**
 * The one "we cannot reach your data" screen. This route has no CSS Module
 * of its own (unlike `app/(app)/review/page.tsx` / `app/(app)/study/
 * [sessionId]/page.tsx`, both of which own theirs) and adding one is outside
 * this task's owned paths, so this mirrors `app/(app)/layout.tsx`'s own
 * `SetupIncomplete` instead: plain inline styles, no shared class names with
 * `ThreadDetail`'s own markup below.
 */
function SetupIncomplete({ detail }: { detail: string }) {
  return (
    <div style={{ padding: "2rem 1.25rem" }}>
      <p style={{ opacity: 0.7, margin: 0 }}>Thread</p>
      <h1 style={{ margin: "0.25rem 0 0.75rem" }}>Setup incomplete</h1>
      <p data-testid="setup-notice" style={{ margin: 0 }}>
        {detail}
      </p>
    </div>
  );
}

export default async function ThreadPage({ params }: ThreadPageProps) {
  const { slug } = await params;
  if (!threadSlug.test(slug) || slug.length > 120) notFound();

  const sessionState = await resolveSessionState();

  if (sessionState.status === "setup-incomplete") {
    return (
      <SetupIncomplete detail="Thread couldn't reach the database to check your sign-in. You have not been signed out — this is a configuration problem. Check the database connection and try again." />
    );
  }

  // Guard: no session and the database answered fine, so this really is a
  // signed-out visitor. Never construct or render ThreadDetail below this
  // line.
  if (sessionState.status !== "authenticated") redirect("/sign-in");

  const [resolution, stagesResolution] = await Promise.all([
    resolveThreadWorkspace(sessionState.userId),
    resolveThreadStages(),
  ]);

  if (resolution.status === "setup-incomplete" || stagesResolution.status === "setup-incomplete") {
    return (
      <SetupIncomplete detail="Thread couldn't reach your data. This is a configuration problem, not a missing thread — check the database connection and try again." />
    );
  }

  return (
    <ThreadDetail slug={slug} stages={stagesResolution.stages} workspaceId={resolution.workspaceId} />
  );
}
