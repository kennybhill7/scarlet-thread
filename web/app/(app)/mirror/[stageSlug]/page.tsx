import { notFound, redirect } from "next/navigation";

import { stages as stagesTable } from "@/db/schema";
import type { Stage } from "@/lib/contracts";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { listThreads } from "@/lib/db/threads";
import { resolveMirrorPair, resolveOpeningChapter, splitStageLabel } from "@/lib/mirror/stagePair";
import { MirrorSplitView, type MirrorPaneStage } from "@/components/mirror/MirrorSplitView";

/**
 * MIRRORSPLIT-001 — "read a mirror pair in one view... scroll-locked at
 * their matching beats," Ken's product strategy doc's own description of
 * this feature. See `components/mirror/MirrorSplitView.tsx`'s header for
 * the reuse decision (VerseColumn + ChapterReader.module.css, not
 * ChapterReader itself) and `lib/mirror/scrollSync.ts`'s header for the
 * honesty scoping this route ships instead of a verse-level correlation
 * that does not exist anywhere in this codebase: two real reading panes,
 * scroll synced as a percentage through each pane's own content.
 *
 * AUTH: `app/(app)/layout.tsx` already gates the whole `(app)` route group
 * with its own `resolveSessionState` call, and `web/proxy.ts` gates it a
 * layer above that again. Neither file is in this task's owned or
 * read-only paths, so — following the exact precedent
 * `app/(app)/threads/[slug]/page.tsx` and `app/(app)/review/page.tsx` each
 * document for the identical situation — this file does not rely on either
 * silently covering it. It duplicates the same `resolveSessionState` shape
 * those two pages (and `app/(app)/page.tsx`) already carry, rather than
 * inventing a new auth pattern for one more route.
 *
 * `stages` is global reference data (`db/schema.ts`), not user-scoped, so
 * — matching `app/(app)/page.tsx`'s and `app/(app)/threads/[slug]/page.tsx`'s
 * own documented reasoning — it is queried directly here
 * (`db.select().from(stagesTable)`) rather than a caller-supplied id. This
 * route needs no `workspaceId` at all: Mirror Split v1 is read-only
 * comparison of curated Scripture text, not a study-capture surface (see
 * this task's report for that scope boundary), so unlike
 * `app/(app)/threads/[slug]/page.tsx` there is no workspace resolution step
 * here.
 */

type MirrorPageProps = {
  params: Promise<{ stageSlug: string }>;
};

const stageSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Session resolution — identical shape to `app/(app)/threads/[slug]/
// page.tsx`'s own copy (itself matching `app/(app)/review/page.tsx` and
// `app/(app)/page.tsx`), duplicated again here rather than inventing a new
// one, because `lib/auth/config.ts` and `app/(app)/layout.tsx` are outside
// this task's owned paths.
//
// SCOPE NOTE (SCOPE-BOUNDARY-001, same residual gap the three sibling pages
// above each already disclose): `web/proxy.ts` and `app/(app)/layout.tsx`
// both call `auth()` without this database-outage probe, one or two layers
// above this file, so a normal browser navigation during a database outage
// may already be redirected to /sign-in before `MirrorPage` ever runs. Not
// this task's to close.
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
// Stage resolution — same shape/discipline as
// `app/(app)/threads/[slug]/page.tsx`'s `resolveThreadStages`: global
// reference data, unscoped, collapsing any read failure to
// "setup-incomplete" rather than letting it reach the JSX.
// ---------------------------------------------------------------------------

export type MirrorStagesDeps = {
  getStages: () => Promise<Stage[]>;
};

const defaultMirrorStagesDeps: MirrorStagesDeps = {
  getStages: () => db.select().from(stagesTable),
};

export type MirrorStagesResolution =
  | { status: "setup-incomplete" }
  | { status: "ready"; stages: Stage[] };

export async function resolveMirrorStages(
  deps: MirrorStagesDeps = defaultMirrorStagesDeps,
): Promise<MirrorStagesResolution> {
  try {
    const stages = await deps.getStages();
    return { status: "ready", stages };
  } catch {
    return { status: "setup-incomplete" };
  }
}

// ---------------------------------------------------------------------------
// Honest non-happy-path screens. Each is deliberately distinct markup (own
// data-testid, own copy) from the ordinary MirrorSplitView render and from
// each other, matching this route group's established habit
// (app/(app)/page.tsx, app/(app)/review/page.tsx) of never letting two
// different failure reasons look identical to the reader.
// ---------------------------------------------------------------------------

function SetupIncomplete({ detail }: { detail: string }) {
  return (
    <div style={{ padding: "2rem 1.25rem" }}>
      <p style={{ opacity: 0.7, margin: 0 }}>Mirror pair</p>
      <h1 style={{ margin: "0.25rem 0 0.75rem" }}>Setup incomplete</h1>
      <p data-testid="setup-notice" style={{ margin: 0 }}>
        {detail}
      </p>
    </div>
  );
}

/**
 * Stage 6 (the Gospels) is the seeded example: its `mirror` field is null
 * by design, not a gap to paper over. Requirement 4 of this task: this
 * route must not be reachable for a no-mirror stage without saying so
 * plainly — never a crash, never a silently-wrong comparison.
 */
function NoMirrorPair({ stage }: { stage: Stage }) {
  const label = splitStageLabel(stage.title);
  const name = label.reference || stage.title;
  return (
    <div style={{ padding: "2rem 1.25rem" }}>
      <p style={{ opacity: 0.7, margin: 0 }}>Mirror pair</p>
      <h1 style={{ margin: "0.25rem 0 0.75rem" }}>{name}</h1>
      <p data-testid="no-mirror-notice" style={{ margin: 0 }}>
        This stage has no mirror pair.{label.short ? ` ${label.short} —` : ""} it is the peak of the
        mountain: everything climbs toward it and descends from it, rather than pairing with another
        stage.
      </p>
    </div>
  );
}

/** `stage.mirror` is set but points at a slug this stage set does not contain. */
function BrokenMirror({ stage }: { stage: Stage }) {
  return (
    <div style={{ padding: "2rem 1.25rem" }}>
      <p style={{ opacity: 0.7, margin: 0 }}>Mirror pair</p>
      <h1 style={{ margin: "0.25rem 0 0.75rem" }}>Mirror pair unavailable</h1>
      <p data-testid="broken-mirror-notice" style={{ margin: 0 }}>
        {stage.title}&apos;s mirror reference doesn&apos;t match any known stage. This is a data
        problem with the stages table, not a missing page.
      </p>
    </div>
  );
}

/** A stage's `chapters` array is empty, or its first entry doesn't parse as a RefKey. */
function NoOpeningChapter({ stage }: { stage: Stage }) {
  return (
    <div style={{ padding: "2rem 1.25rem" }}>
      <p style={{ opacity: 0.7, margin: 0 }}>Mirror pair</p>
      <h1 style={{ margin: "0.25rem 0 0.75rem" }}>Mirror pair unavailable</h1>
      <p data-testid="no-chapter-notice" style={{ margin: 0 }}>
        {stage.title} has no opening chapter set up yet, so there is nothing to show here. This is a
        data problem with the stages table, not a missing page.
      </p>
    </div>
  );
}

export default async function MirrorPage({ params }: MirrorPageProps) {
  const { stageSlug } = await params;
  if (!stageSlugPattern.test(stageSlug) || stageSlug.length > 120) notFound();

  const sessionState = await resolveSessionState();

  if (sessionState.status === "setup-incomplete") {
    return (
      <SetupIncomplete detail="Mirror pair couldn't reach the database to check your sign-in. You have not been signed out — this is a configuration problem. Check the database connection and try again." />
    );
  }

  // Guard: no session and the database answered fine, so this really is a
  // signed-out visitor. Never resolve stages or render a pane below this line.
  if (sessionState.status !== "authenticated") redirect("/sign-in");

  const stagesResolution = await resolveMirrorStages();
  if (stagesResolution.status === "setup-incomplete") {
    return (
      <SetupIncomplete detail="Mirror pair couldn't reach your data. This is a configuration problem, not a missing stage — check the database connection and try again." />
    );
  }

  const resolution = resolveMirrorPair(stagesResolution.stages, stageSlug);

  if (resolution.status === "not-found") notFound();
  if (resolution.status === "no-mirror") return <NoMirrorPair stage={resolution.stage} />;
  if (resolution.status === "broken-mirror") return <BrokenMirror stage={resolution.stage} />;

  const leftChapter = resolveOpeningChapter(resolution.stage);
  const rightChapter = resolveOpeningChapter(resolution.partner);
  if (!leftChapter) return <NoOpeningChapter stage={resolution.stage} />;
  if (!rightChapter) return <NoOpeningChapter stage={resolution.partner} />;

  const left: MirrorPaneStage = {
    slug: resolution.stage.slug,
    title: resolution.stage.title,
    book: leftChapter.book,
    chapter: leftChapter.chapter,
  };
  const right: MirrorPaneStage = {
    slug: resolution.partner.slug,
    title: resolution.partner.title,
    book: rightChapter.book,
    chapter: rightChapter.chapter,
  };

  return <MirrorSplitView left={left} right={right} />;
}
