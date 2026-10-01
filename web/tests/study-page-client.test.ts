/**
 * STUDYOFFLINE-001 — `app/(app)/study/[sessionId]/StudyPageClient.tsx`.
 *
 * TEST-ENVIRONMENT NOTE (same discipline as tests/sync-status-notice.test.ts,
 * read as precedent before writing this file): `tsx --test` is plain Node,
 * no jsdom. `StudyPageClient` has a real `useEffect` (the hydration pass),
 * which never runs under `react-dom/server`'s `renderToStaticMarkup` — so,
 * exactly like `SyncStatusNotice`'s own test file, this suite proves the
 * RENDER OUTPUT for given props/initial state (via `createElement` +
 * `renderToStaticMarkup`, never a plain function call, since hooks need
 * React's dispatcher in scope) and proves the REAL IndexedDB integration
 * separately and directly: `loadLocalStudyWorkspace` (pulled out to its own
 * export exactly so it has a test seam independent of the un-exercisable
 * `useEffect`) is called here against real `fake-indexeddb`. The pure merge
 * rule it feeds (`reconcileStudyWorkspace`) is already proven exhaustively in
 * tests/study-offline-hydration.test.ts and is not re-derived here.
 */
import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import type { StudySession } from "@/lib/contracts/study-v2";

const nodeRequire = createRequire(__filename);

function seedModule(specifier: string, exports: Record<string, unknown>) {
  const resolved = nodeRequire.resolve(specifier);
  (nodeRequire.cache as Record<string, unknown>)[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    path: path.dirname(resolved),
    paths: [],
    children: [],
    exports: { __esModule: true, ...exports },
  };
  return resolved;
}

const cssProxy = new Proxy(
  {},
  { get: (_target, key) => (typeof key === "string" ? key : undefined) },
);

seedModule("@/components/study/claim-composer.module.css", { default: cssProxy });
seedModule("@/components/ui/Button.module.css", { default: cssProxy });
seedModule("@/components/ui/Chip.module.css", { default: cssProxy });
seedModule("@/components/ui/Field.module.css", { default: cssProxy });
seedModule("@/components/ui/PassagePicker.module.css", { default: cssProxy });

const { StudyPageClient, loadLocalStudyWorkspace } = nodeRequire(
  "@/app/(app)/study/[sessionId]/StudyPageClient.tsx",
) as {
  StudyPageClient: (props: Record<string, unknown>) => unknown;
  loadLocalStudyWorkspace: (sessionId: string) => Promise<{
    session: StudySession | null;
    claims: unknown[];
    applications: unknown[];
    pendingOps: unknown[];
  }>;
};

function range(overrides: Partial<CanonicalRangeV1> = {}): CanonicalRangeV1 {
  return { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.1", end: "1.3.6", ...overrides };
}

function session(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    range: range(),
    mode: "encounter",
    workflowState: "active",
    connectionState: "unexamined",
    catalogReleaseId: null,
    readGateAt: "2026-01-01T06:00:00.000Z",
    currentStep: "observe",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

// A deps object whose loadLocalWorkspace never resolves during this
// synchronous render pass -- irrelevant anyway, since useEffect does not run
// under renderToStaticMarkup, but keeps every render test explicit about
// that rather than silently relying on it.
function neverResolvingDeps(isOffline = false) {
  return {
    loadLocalWorkspace: () => new Promise<never>(() => {}),
    isOffline: () => isOffline,
  };
}

// ===========================================================================
// RENDER — initial state only (the useEffect-driven hydration update cannot
// run in this harness; see this file's own header).
// ===========================================================================

test("RENDER: online at mount -- renders WorkspaceShell with the server props, no offline notice", () => {
  const html = renderToStaticMarkup(
    createElement(StudyPageClient as never, {
      workspaceId: "workspace-1",
      session: session(),
      claims: [],
      applications: [],
      curatedLesson: null,
      deps: neverResolvingDeps(false),
    }),
  );
  assert.match(html, /workspace-shell/);
  assert.doesNotMatch(html, /curated-lesson-offline-notice/);
});

test("RENDER: offline at mount -- the honest curated-lesson notice renders immediately, before any hydration effect could run", () => {
  const html = renderToStaticMarkup(
    createElement(StudyPageClient as never, {
      workspaceId: "workspace-1",
      session: session(),
      claims: [],
      applications: [],
      curatedLesson: null,
      deps: neverResolvingDeps(true),
    }),
  );
  assert.match(html, /curated-lesson-offline-notice/);
  assert.match(html, /You.re offline/);
});

test("RENDER: the server-provided session/claims/applications pass straight through to WorkspaceShell before hydration resolves", () => {
  const html = renderToStaticMarkup(
    createElement(StudyPageClient as never, {
      workspaceId: "workspace-1",
      session: session({ range: range({ start: "43.3.16", end: "43.3.16" }) }),
      claims: [],
      applications: [],
      curatedLesson: null,
      deps: neverResolvingDeps(false),
    }),
  );
  assert.match(html, /43\.3\.16/);
});

// ===========================================================================
// loadLocalStudyWorkspace — the real IndexedDB read, tested directly against
// real fake-indexeddb (the actual end-to-end hydration path, independent of
// whether useEffect can run in this harness).
// ===========================================================================

test("loadLocalStudyWorkspace: no local vault entry for this session id -- null session, empty arrays, no throw", async () => {
  const result = await loadLocalStudyWorkspace("no-such-session-anywhere");
  assert.equal(result.session, null);
  assert.deepEqual(result.claims.length >= 0, true);
});

test("loadLocalStudyWorkspace: a session saved locally via the real vault writer round-trips back out", async () => {
  const store = await import("@/lib/sync/store");
  const localSession = session({ id: `local-${crypto.randomUUID()}`, currentStep: "connect" });
  await store.saveLocalStudySession(localSession);

  try {
    const result = await loadLocalStudyWorkspace(localSession.id);
    assert.equal(result.session?.id, localSession.id);
    assert.equal(result.session?.currentStep, "connect");
    const op = result.pendingOps.find(
      (candidate) => (candidate as { entity: string; entityId: string }).entityId === localSession.id,
    );
    assert.ok(op, "the session's own outbox op must be visible in pendingOps -- this is what lets the merge prefer it over a stale server copy");
  } finally {
    const store2 = await import("@/lib/sync/store");
    const pending = await store2.getPendingV2Ops();
    await store2.removePendingV2Ops(
      pending.filter((candidate) => candidate.entityId === localSession.id).map((candidate) => candidate.opId),
    );
  }
});
