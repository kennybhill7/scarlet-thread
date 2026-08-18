import { redirect } from "next/navigation";

import { stages as stagesTable } from "@/db/schema";
import type { Entry, Stage } from "@/lib/contracts";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { listEntries } from "@/lib/db/entries";
import { listThreads } from "@/lib/db/threads";
import type { MountainStage } from "@/lib/vault/seed";
import { ClimbHero } from "@/components/climb/ClimbHero";
import { Mountain } from "@/components/climb/Mountain";

/**
 * Gate 0.2 — the Climb home no longer reads web/data/seed/*.json through
 * lib/vault/seed.ts's `getMountain()`/`getReview()` (a build-time bridge over
 * a gitignored personal-data file, see that module's header). Only the
 * `MountainStage` TYPE is imported from it now, so Mountain.tsx's own prop
 * contract stays intact without pulling in the seed bridge's runtime code.
 *
 * Data now comes from the authenticated user's rows in Postgres, via the
 * same `entries`/`threads` tables lib/db/review.ts already reads for
 * /review. There is no `lib/db/stages.ts` yet — `stages` is a small, global
 * (not user-scoped) reference table, so it is queried directly here rather
 * than inventing a one-call wrapper module outside this task's owned paths.
 */

// ---------------------------------------------------------------------------
// splitLabel — ported from lib/vault/seed.ts's private (unexported) helper
// of the same name. That function cannot be imported (it isn't exported,
// and doing so would be a value import from the seed bridge anyway), so the
// handful of lines are duplicated here. Keep in sync if the title format
// ("Reference — Short label") ever changes.
// ---------------------------------------------------------------------------
function splitLabel(title: string): { reference: string; short: string } {
  for (const dash of [" — ", " – ", " - "]) {
    const idx = title.indexOf(dash);
    if (idx !== -1) {
      return { reference: title.slice(0, idx).trim(), short: title.slice(idx + dash.length).trim() };
    }
  }
  return { reference: title, short: "" };
}

/**
 * Same aggregation lib/vault/seed.ts's `getMountain()` used to do over the
 * JSON seed, now over real `Entry` rows for one signed-in user. Entries are
 * anchored to a chapter (a stage's opening chapter, per the importer's
 * documented approximation carried over from the seed bridge), so stages
 * are matched back via that same anchor rather than a stored stage slug.
 */
function buildMountainStages(stageRows: Stage[], entryRows: Entry[]): MountainStage[] {
  const threadsByStage = new Map<string, Set<string>>();
  const obsByStage = new Map<string, number>();
  const qByStage = new Map<string, number>();
  const studiedChapters = new Set(entryRows.map((entry) => entry.chapter));

  const anchorToStage = new Map(
    stageRows.filter((stage) => stage.chapters[0]).map((stage) => [stage.chapters[0], stage.slug]),
  );

  for (const entry of entryRows) {
    const slug = anchorToStage.get(entry.chapter);
    if (!slug) continue;
    if (entry.kind === "observation") obsByStage.set(slug, (obsByStage.get(slug) ?? 0) + 1);
    // Matches lib/db/review.ts's own definition of "open" -- an answered
    // question isn't open.
    if (entry.kind === "question" && !entry.answeredAt) {
      qByStage.set(slug, (qByStage.get(slug) ?? 0) + 1);
    }
    if (!threadsByStage.has(slug)) threadsByStage.set(slug, new Set());
    entry.threads.forEach((t) => threadsByStage.get(slug)!.add(t));
  }

  return stageRows
    .map((stage) => {
      const { reference, short } = splitLabel(stage.title);
      return {
        slug: stage.slug,
        title: stage.title,
        reference,
        short,
        stage: stage.stage,
        side: stage.side,
        mirror: stage.mirror,
        firstChapter: stage.chapters[0] ?? null,
        threadCount: threadsByStage.get(stage.slug)?.size ?? 0,
        observationCount: obsByStage.get(stage.slug) ?? 0,
        questionCount: qByStage.get(stage.slug) ?? 0,
        studied: stage.chapters.some((chapter) => studiedChapters.has(chapter)),
      };
    })
    .sort((a, b) => a.stage - b.stage);
}

export interface ClimbData {
  stages: MountainStage[];
  stagesWithWork: number;
  totalStages: number;
  threadCount: number;
  openQuestions: number;
}

export type ClimbViewModel =
  | { status: "setup-incomplete" }
  | { status: "ok"; data: ClimbData };

export type ClimbDataDeps = {
  getStages: () => Promise<Stage[]>;
  getEntries: (userId: string) => Promise<Entry[]>;
  getThreadCount: (userId: string) => Promise<number>;
};

const defaultDataDeps: ClimbDataDeps = {
  getStages: () => db.select().from(stagesTable),
  getEntries: (userId) => listEntries(userId, {}),
  getThreadCount: async (userId) => (await listThreads(userId)).length,
};

/**
 * The one seam between the page and the database. Errors here (missing
 * DATABASE_URL, connection failure, anything else) collapse to
 * "setup-incomplete" rather than reaching the JSX, which is what lets a
 * genuinely empty account still render the ordinary Climb Hero/Mountain
 * with honest zero counts -- the two must never look the same to the reader.
 */
export async function loadClimbViewModel(
  userId: string,
  deps: ClimbDataDeps = defaultDataDeps,
): Promise<ClimbViewModel> {
  try {
    const [stageRows, entryRows, threadCount] = await Promise.all([
      deps.getStages(),
      deps.getEntries(userId),
      deps.getThreadCount(userId),
    ]);

    const stages = buildMountainStages(stageRows, entryRows);
    const stagesWithWork = stages.filter((stage) => stage.observationCount > 0).length;
    const openQuestions = stages.reduce((sum, stage) => sum + stage.questionCount, 0);

    return {
      status: "ok",
      data: { stages, stagesWithWork, totalStages: stages.length, threadCount, openQuestions },
    };
  } catch {
    return { status: "setup-incomplete" };
  }
}

// ---------------------------------------------------------------------------
// Session resolution — telling "signed out" apart from "database down".
// Same shape as app/(app)/review/page.tsx's `resolveSessionState` (see that
// file's comment block for the full rationale): `auth()` uses a
// database-backed session strategy, so a dead database can surface as a
// null session indistinguishable from a real signed-out visitor. A null
// session is therefore verified against the database directly before it is
// trusted.
//
// SCOPE NOTE (SCOPE-BOUNDARY-001): this only helps requests that reach this
// component. Both `web/proxy.ts` (middleware, matches "/") and
// `app/(app)/layout.tsx` (the shared shell above every screen in this
// group, including this one) call `auth()` without this probe, so a normal
// browser navigation to "/" during a database outage may be redirected to
// /sign-in one or two layers above this file before `ClimbPage` ever runs.
// Closing that hole requires editing proxy.ts and/or layout.tsx and/or
// lib/auth/config.ts, none of which are in this task's ownedPaths (layout.tsx
// isn't even in readOnlyPaths). Reported, not silently left implied.
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
    // auth() threw outright (adapter error surfaced instead of swallowed).
    // A generic 500 would be another wrong label; name the real problem.
    return { status: "setup-incomplete" };
  }

  const userId = session?.user?.id;
  if (userId) return { status: "authenticated", userId };

  // No session. Either genuinely signed out, or the session lookup silently
  // failed because the database is unreachable. Ask the database directly.
  try {
    await deps.probeDatabase();
  } catch {
    return { status: "setup-incomplete" };
  }

  return { status: "signed-out" };
}

/**
 * The one "we cannot reach your data" screen. Deliberately shares nothing
 * with the ordinary Climb Hero/Mountain markup below: different headline, an
 * explicit notice, and neither the hero stats nor the mountain graph. If
 * this ever renders the same words as an empty account,
 * tests/climb-setup-state.test.ts fails.
 */
function SetupIncomplete({ detail }: { detail: string }) {
  return (
    <div style={{ padding: "2rem 1.25rem" }}>
      <p style={{ opacity: 0.7, margin: 0 }}>Scarlet Thread</p>
      <h1 style={{ margin: "0.25rem 0 0.75rem" }}>Setup incomplete</h1>
      <p data-testid="setup-notice" style={{ margin: 0 }}>
        {detail}
      </p>
    </div>
  );
}

export default async function ClimbPage() {
  const sessionState = await resolveSessionState();

  if (sessionState.status === "setup-incomplete") {
    return (
      <SetupIncomplete detail="The Climb couldn't reach the database to check your sign-in. You have not been signed out — this is a configuration problem. Check the database connection and try again." />
    );
  }

  // Guard: no session and the database answered fine, so this really is a
  // signed-out visitor. Never render a word of the mountain below this line.
  if (sessionState.status !== "authenticated") redirect("/sign-in");

  const view = await loadClimbViewModel(sessionState.userId);

  if (view.status === "setup-incomplete") {
    return (
      <SetupIncomplete detail="The Climb couldn't reach your data. This is a configuration problem, not an empty account — check the database connection and try again." />
    );
  }

  const { stages, stagesWithWork, totalStages, threadCount, openQuestions } = view.data;

  return (
    <div>
      <ClimbHero
        stagesWithWork={stagesWithWork}
        totalStages={totalStages}
        threadCount={threadCount}
        openQuestions={openQuestions}
      />
      <Mountain stages={stages} />
    </div>
  );
}
