import { notFound, redirect } from "next/navigation";

import { WorkspaceShell } from "@/components/workspace";
import { auth } from "@/lib/auth/config";
import { listThreads } from "@/lib/db/threads";
import { getOrCreatePersonalWorkspace } from "@/lib/db/workspaces";
import type { Application, StudyClaim, StudySession } from "@/lib/contracts/study-v2";
import { getSessionV2, listApplicationsV2, listClaimsV2 } from "@/app/api/v2/_lib/queries";

import styles from "./study.module.css";

/**
 * STUDYPAGE-001 mounted V2COMPOSER-001's `ClaimComposer` directly. This task
 * (WORKSPACESHELL-001) builds the real BUILD_PLAN §4 shell around it:
 * `WorkspaceShell` (`components/workspace/`, an ownedPath here) now mounts
 * in ClaimComposer's place, hosting all eight sections (Read, Observe,
 * Context, Connect, Theology, Conviction, Apply, Teach), driven by the
 * session's `currentStep` and gated per `lib/workspace/gating.ts`. See
 * `WorkspaceShell.tsx`'s own header for why "locked" never removes a
 * section's content from the page, and this task's commit message for the
 * Connect-gate interpretation and what is deliberately out of scope.
 *
 * `WorkspaceShell` (a readOnlyPath's sibling — not a readOnlyPath itself,
 * but not re-verified here beyond what its own file documents) takes
 * `workspaceId` as a prop and, exactly like `ClaimComposer` before it,
 * trusts its caller for that resolution; it does not perform it. This file
 * is still that caller — see "WORKSPACE RESOLUTION" below, unchanged from
 * STUDYPAGE-001.
 *
 * One route, one resumable session: BUILD_PLAN.md:125 — "The workspace
 * routes by sessionId, not book/chapter... resumability... needs it."
 *
 * CLAIMS/APPLICATIONS DATA (new in this task): `resolveStudyPageData` now
 * also fetches this session's own claims and applications, purely to feed
 * the gating machine (`lib/workspace/gating.ts`) real data instead of
 * always-empty arrays. `deps.listSessionClaims`/`listSessionApplications`
 * are OPTIONAL and default to the real `listClaimsV2`/`listApplicationsV2`
 * (`app/api/v2/_lib/queries.ts`, already scoped by both `workspaceId` AND
 * `sessionId` — the same tenant-isolation shape `getSessionV2` already
 * uses). They are called through a small `typeof === "function"` guard
 * rather than unconditionally: `tests/study-page.test.ts` (frozen,
 * read-only here, predates this task) stubs `@/app/api/v2/_lib/queries`
 * with ONLY `getSessionV2` — a real production import of that module always
 * has both functions, so the guard's `false` branch (empty arrays) is
 * reachable ONLY inside that frozen test's stub, never in a real build. Its
 * observable effect there: the RENDER tests' gating computation sees
 * `claims: []`/`applications: []`, same as before this change — none of
 * those tests assert anything about gating, so this is inert for them.
 */

// ---------------------------------------------------------------------------
// WORKSPACE RESOLUTION (acceptance criterion 1) — read before touching this
// file.
//
// This page's dynamic segment is `[sessionId]`, never `[workspaceId]`, and
// the component below never destructures `searchParams` at all — there is
// no code path, route param or query string, through which a caller could
// even ATTEMPT to hand this page a workspace id. `resolveStudyPageData`'s
// own signature enforces the same rule one layer down: it takes `userId`
// (from the resolved session) and `routeSessionId` (the one thing a caller
// legitimately controls here — WHICH session, never WHICH workspace) and
// derives `workspaceId` itself, exactly once, via
// `getOrCreatePersonalWorkspace` (`lib/db/workspaces.ts`, a readOnlyPath) —
// the same function `app/api/v2/_lib/guard.ts`'s `withReadOnlyV2Workspace`
// already uses for every v2 read route. There is no second place in this
// file a workspace id could originate.
//
// `tests/study-page.test.ts` proves this two ways: a HOSTILE test where the
// route's own session id belongs to another workspace (must 404, never
// leak), and a HOSTILE test where a caller smuggles an extra `workspaceId`
// key into `params` itself (must be silently ignored — `resolveStudyPageData`
// has no parameter for it to land in). Its "MUTATION PROOF" section names
// the exact test that fails if this file is ever changed to read a
// caller-supplied workspace id instead.
// ---------------------------------------------------------------------------

export type StudyPageDeps = {
  resolveWorkspaceId: (userId: string) => Promise<string>;
  getStudySession: (workspaceId: string, sessionId: string) => Promise<StudySession | null>;
  /**
   * Optional (new in this task): this session's own claims/applications,
   * for `lib/workspace/gating.ts`. Optional so `tests/study-page.test.ts`
   * (frozen, read-only, predates this field) can keep calling
   * `resolveStudyPageData` with only `resolveWorkspaceId`/`getStudySession`
   * — omitted here means "gate as if nothing exists yet" (empty arrays),
   * never a thrown error.
   */
  listSessionClaims?: (workspaceId: string, sessionId: string) => Promise<StudyClaim[]>;
  listSessionApplications?: (workspaceId: string, sessionId: string) => Promise<Application[]>;
};

/**
 * `listSessionClaims`/`listSessionApplications` are call-guarded
 * (`typeof ... === "function"`) rather than assumed present: see this
 * file's own header comment ("CLAIMS/APPLICATIONS DATA") for exactly why —
 * `tests/study-page.test.ts`'s frozen stub of `@/app/api/v2/_lib/queries`
 * only provides `getSessionV2`, so an unconditional call here would throw
 * under that test even though it never does in a real build.
 */
const defaultStudyPageDeps: StudyPageDeps = {
  resolveWorkspaceId: getOrCreatePersonalWorkspace,
  getStudySession: getSessionV2,
  listSessionClaims: (workspaceId, sessionId) =>
    typeof listClaimsV2 === "function"
      ? listClaimsV2(workspaceId, { sessionId })
      : Promise.resolve([]),
  listSessionApplications: (workspaceId, sessionId) =>
    typeof listApplicationsV2 === "function"
      ? listApplicationsV2(workspaceId, { sessionId })
      : Promise.resolve([]),
};

export type StudyPageResolution =
  | { status: "setup-incomplete" }
  | { status: "not-found" }
  | {
      status: "ready";
      workspaceId: string;
      session: StudySession;
      claims: StudyClaim[];
      applications: Application[];
    };

/**
 * The one seam between this page and the database for everything past
 * authentication. `routeSessionId` scopes WHICH session; `workspaceId` is
 * never a parameter here at all — see the block comment above.
 *
 * `getStudySession` (`getSessionV2`, `app/api/v2/_lib/queries.ts` —
 * see its own doc comment) already scopes its query by BOTH `id` AND
 * `workspaceId`, so a session id that exists but belongs to a different
 * workspace returns `null` from the exact same code path as an id that
 * does not exist anywhere — this function, and the page below, never tell
 * the two apart (acceptance criterion 3, mirroring
 * `app/api/v2/sessions/[id]/route.ts`'s own documented rule).
 *
 * Any thrown error (dead database, `getOrCreatePersonalWorkspace` failing,
 * etc.) collapses to "setup-incomplete" rather than reaching the JSX,
 * matching every other page in this route group
 * (`app/(app)/review/page.tsx`, `app/(app)/page.tsx`) — a real database
 * outage must never be reported as "this session does not exist."
 */
export async function resolveStudyPageData(
  userId: string,
  routeSessionId: string,
  deps: StudyPageDeps = defaultStudyPageDeps,
): Promise<StudyPageResolution> {
  let workspaceId: string;
  let session: StudySession | null;
  let claims: StudyClaim[] = [];
  let applications: Application[] = [];
  try {
    workspaceId = await deps.resolveWorkspaceId(userId);
    session = await deps.getStudySession(workspaceId, routeSessionId);
    if (session) {
      claims = deps.listSessionClaims ? await deps.listSessionClaims(workspaceId, session.id) : [];
      applications = deps.listSessionApplications
        ? await deps.listSessionApplications(workspaceId, session.id)
        : [];
    }
  } catch {
    return { status: "setup-incomplete" };
  }
  if (!session) return { status: "not-found" };
  return { status: "ready", workspaceId, session, claims, applications };
}

// ---------------------------------------------------------------------------
// Session resolution — telling "signed out" apart from "database down".
// Identical shape to `app/(app)/review/page.tsx`'s `resolveSessionState`
// (see that file's comment block for the full rationale) and
// `app/(app)/page.tsx`'s copy of the same — this is the established
// per-page convention in this route group, duplicated again here rather
// than inventing a new one, because `lib/auth/config.ts` and
// `app/(app)/layout.tsx` are outside this task's owned paths (the latter
// isn't even in readOnlyPaths).
//
// SCOPE NOTE (SCOPE-BOUNDARY-001): same residual gap as the two sibling
// pages above — `web/proxy.ts` and `app/(app)/layout.tsx` both call `auth()`
// without this probe, one or two layers above this file, so a normal
// browser navigation during a database outage may already be redirected to
// /sign-in before `StudySessionPage` ever runs. Not this task's to close.
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

/**
 * The one "we cannot reach your data" screen, deliberately sharing nothing
 * with the composer markup below it — same discipline as the sibling pages'
 * own `SetupIncomplete`.
 */
function SetupIncomplete({ detail }: { detail: string }) {
  return (
    <div className={styles.wrap}>
      <p className={styles.eyebrow}>Study</p>
      <h1 className={styles.title}>Setup incomplete</h1>
      <p className={styles.setupNotice} data-testid="setup-notice">
        {detail}
      </p>
    </div>
  );
}

interface StudyPageProps {
  /**
   * The ONLY caller-controlled input this page accepts. Deliberately no
   * `searchParams` prop — see "WORKSPACE RESOLUTION" above.
   */
  params: Promise<{ sessionId: string }>;
}

export default async function StudySessionPage({ params }: StudyPageProps) {
  const sessionState = await resolveSessionState();

  if (sessionState.status === "setup-incomplete") {
    return (
      <SetupIncomplete detail="Study couldn't reach the database to check your sign-in. You have not been signed out — this is a configuration problem. Check the database connection and try again." />
    );
  }

  // Guard: no session and the database answered fine, so this really is a
  // signed-out visitor (acceptance criterion 2). Never construct or render
  // the composer below this line.
  if (sessionState.status !== "authenticated") redirect("/sign-in");

  const { sessionId } = await params;
  const resolution = await resolveStudyPageData(sessionState.userId, sessionId);

  if (resolution.status === "setup-incomplete") {
    return (
      <SetupIncomplete detail="Study couldn't reach your data. This is a configuration problem, not a missing session — check the database connection and try again." />
    );
  }

  // A session id that does not exist, or that resolved to a different
  // workspace than the signed-in caller's own, renders not-found rather
  // than an empty composer pointed at nothing (acceptance criterion 3).
  if (resolution.status === "not-found") notFound();

  return (
    <div className={styles.wrap}>
      <WorkspaceShell
        workspaceId={resolution.workspaceId}
        session={resolution.session}
        claims={resolution.claims}
        applications={resolution.applications}
      />
    </div>
  );
}
