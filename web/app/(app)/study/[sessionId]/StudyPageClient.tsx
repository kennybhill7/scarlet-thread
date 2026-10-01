"use client";

import { useEffect, useState } from "react";

import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import type { PublishedLessonMatch } from "@/lib/content/publishedLessons";
import type { Application, StudyClaim, StudySession } from "@/lib/contracts/study-v2";

import {
  pendingEntityIdsFromOps,
  reconcileStudyWorkspace,
  type ReconciledStudyWorkspace,
} from "./offlineHydration";

/**
 * STUDYOFFLINE-001 — the client-side half of acceptance criterion 1 ("the
 * study page's client-rendered content should show real data from the local
 * vault FIRST (or simultaneously), then reconcile with whatever the server
 * has"). Mounted by `page.tsx` in place of mounting `WorkspaceShell` directly
 * (that file's own Server Component logic — `resolveStudyPageData`,
 * `resolveSessionState`, the `setup-incomplete`/`redirect`/`notFound()`
 * branches — is UNCHANGED by this task; see its own header comment for why
 * this component only ever replaces the final "ready" render).
 *
 * ARCHITECTURE DECISION (restated in this task's final report, as asked):
 * `page.tsx` stays a Server Component and keeps doing the real,
 * tenant-scoped Postgres resolution it always has — that is still the
 * authoritative source for "does this session exist, and does it belong to
 * this caller's workspace" (tests/study-page.test.ts's HOSTILE tests prove
 * this must never move client-side). This component is a THIN client layer
 * on top of that already-resolved, already-authorized data: it never fetches
 * `/api/v2/*` itself and never makes its own authorization decision — it
 * only reads THIS DEVICE's own local vault (`lib/sync/store.ts`, already
 * scoped to whatever workspace this device's sync session wrote under) and
 * reconciles it against the props the server already gave it, via the pure
 * `reconcileStudyWorkspace` (`./offlineHydration.ts`).
 *
 * Why not move the fetch entirely client-side (a "thin server shell" that
 * renders this component unconditionally, independent of
 * `resolveStudyPageData`'s own ready/not-found/setup-incomplete outcome)?
 * Two reasons: (1) `tests/study-page.test.ts`'s HOSTILE tests require a
 * synchronous, server-side `notFound()` for a session that does not exist or
 * belongs to another workspace — a client-side effect cannot reproduce that
 * under that suite's `renderToStaticMarkup` harness (effects never run), and
 * weakening that guarantee is explicitly out of scope ("a learner who IS
 * online and hits the server component fresh must see identical behavior").
 * (2) It is unnecessary: the one case that genuinely cannot go through
 * `page.tsx` at all — a FRESH navigation to `/study/[id]` with no network
 * reachable, e.g. `StudyEntry.tsx`'s offline "start a study" — never reaches
 * React in this app's architecture anyway. Next's client router falls back
 * to a full (MPA) document navigation when its RSC fetch fails on a network
 * error (confirmed against this repo's installed Next 16 —
 * `node_modules/next/dist/client/components/router-reducer/
 * ppr-navigations.js`'s own "network error ... Initiate an MPA navigation"),
 * and that document request is exactly what `public/sw.js`'s fetch handler
 * intercepts when offline — answering straight from this same local vault
 * (`offlineStudySessionFallback`) WITHOUT this component, `page.tsx`, or the
 * Postgres-backed Server Component ever running. This component's own job is
 * therefore narrower and safer than "work with no server response at all":
 * it only has to reconcile LOCAL data against a server response that DID
 * arrive — the harder "no server reachable yet" case is the service worker's
 * job, not this component's.
 */

export interface StudyPageClientProps {
  workspaceId: string;
  session: StudySession;
  claims: StudyClaim[];
  applications: Application[];
  curatedLesson: PublishedLessonMatch | null;
}

/**
 * Injectable only for tests — production always uses the real
 * `lib/sync/store.ts` via a lazy `import()`, matching
 * `StudyEntry.tsx`/`SyncStatusNotice.tsx`'s own established discipline for
 * keeping IndexedDB untouched until a component that needs it actually
 * mounts.
 */
export interface StudyPageClientDeps {
  loadLocalWorkspace: (sessionId: string) => Promise<{
    session: StudySession | null;
    claims: StudyClaim[];
    applications: Application[];
    pendingOps: { entity: string; entityId: string }[];
  }>;
  isOffline: () => boolean;
}

/**
 * The REAL local-vault read `defaultDeps.loadLocalWorkspace` uses, pulled out
 * to its own named export specifically so it has a test seam independent of
 * React: this repo's test harness is plain `node:test` with no jsdom (see
 * every other suite's own header comment), so a component's `useEffect`
 * never runs under `renderToStaticMarkup` and cannot be driven from a test —
 * exactly the same constraint `components/sync/SyncStatusNotice.tsx` already
 * documents and works around (its own test file renders it with an injected
 * `status` prop rather than ever letting its poll loop fire). This function
 * is that same escape hatch here: `tests/study-page-client.test.ts` calls it
 * directly against real `fake-indexeddb`, proving the actual IndexedDB
 * integration (not just the pure merge logic, already covered in
 * `tests/study-offline-hydration.test.ts`) really round-trips, independent of
 * whether `useEffect` can be exercised in this harness at all.
 */
export async function loadLocalStudyWorkspace(sessionId: string): ReturnType<StudyPageClientDeps["loadLocalWorkspace"]> {
  const store = await import("@/lib/sync/store");
  const [sessions, claims, applications, pendingOps] = await Promise.all([
    store.listLocalV2Entities("session"),
    store.listLocalV2Entities("claim"),
    store.listLocalV2Entities("application"),
    store.getPendingV2Ops(),
  ]);
  return {
    session: sessions.find((row) => row.id === sessionId) ?? null,
    claims,
    applications,
    pendingOps,
  };
}

const defaultDeps: StudyPageClientDeps = {
  loadLocalWorkspace: loadLocalStudyWorkspace,
  isOffline: () => typeof navigator !== "undefined" && navigator.onLine === false,
};

/** True while the reconciled view still matches the server-only snapshot this component started from — used only to skip a no-op re-render. */
function sameAsServer(
  reconciled: ReconciledStudyWorkspace,
  server: { claims: StudyClaim[]; applications: Application[] },
): boolean {
  return (
    reconciled.sessionSource === "server" &&
    reconciled.claims.length === server.claims.length &&
    reconciled.applications.length === server.applications.length &&
    reconciled.claims.every((claim, index) => claim === server.claims[index]) &&
    reconciled.applications.every((application, index) => application === server.applications[index])
  );
}

export function StudyPageClient({
  workspaceId,
  session: serverSession,
  claims: serverClaims,
  applications: serverApplications,
  curatedLesson,
  deps = defaultDeps,
}: StudyPageClientProps & { deps?: StudyPageClientDeps }) {
  const [state, setState] = useState<ReconciledStudyWorkspace>({
    session: serverSession,
    claims: serverClaims,
    applications: serverApplications,
    sessionSource: "server",
  });
  const [curatedLessonStatus, setCuratedLessonStatus] = useState<"known" | "unknown-offline">(
    deps.isOffline() ? "unknown-offline" : "known",
  );

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const local = await deps.loadLocalWorkspace(serverSession.id);
        if (cancelled) return;
        const pendingIds = pendingEntityIdsFromOps(local.pendingOps);
        const reconciled = reconcileStudyWorkspace(
          serverSession.id,
          { session: serverSession, claims: serverClaims, applications: serverApplications },
          { session: local.session, claims: local.claims, applications: local.applications },
          pendingIds,
        );
        if (!sameAsServer(reconciled, { claims: serverClaims, applications: serverApplications })) {
          setState(reconciled);
        }
      } catch {
        // Fail closed (this task's own discipline, and WorkspaceShell's
        // established one): IndexedDB unavailable or broken leaves this
        // component showing exactly what the server already rendered —
        // never a thrown error into the page the server successfully built.
      }
    }

    void hydrate();

    // A learner who goes offline WHILE this exact page stays mounted (no new
    // navigation — the one case genuinely reachable through React rather
    // than public/sw.js's own fallback, see this file's header) gets the
    // honest notice too, the moment it happens rather than only at mount.
    function handleOffline() {
      if (!cancelled) setCuratedLessonStatus("unknown-offline");
    }
    if (typeof window !== "undefined") {
      window.addEventListener("offline", handleOffline);
    }

    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener("offline", handleOffline);
      }
    };
    // serverSession.id is this effect's real key: a client-side navigation
    // from one /study/[id] page to another (without a full reload) must
    // re-hydrate against the NEW session, never keep merging against the
    // previous one's closed-over server snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSession.id]);

  if (!state.session) {
    // Not reachable through `page.tsx` today (it only ever passes a real,
    // already-resolved `session` prop — see this file's header) — fails
    // closed rather than crashing WorkspaceShell, which requires a session,
    // should a future caller ever reuse this component differently.
    return (
      <p role="status" data-testid="study-page-client-no-session">
        This study session is not available right now. Reconnect and reload this page.
      </p>
    );
  }

  return (
    <WorkspaceShell
      applications={state.applications}
      claims={state.claims}
      curatedLesson={curatedLesson}
      curatedLessonStatus={curatedLessonStatus}
      session={state.session}
      workspaceId={workspaceId}
    />
  );
}
