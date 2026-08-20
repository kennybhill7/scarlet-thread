/**
 * STUDYENTRY-001 — the entry point into a NEW v2 study session.
 * `app/(app)/read/[book]/[chapter]/page.tsx` (owned) resolves the reader's
 * workspace id server-side and hands it to `ChapterReader` (owned), which
 * mounts `StudyEntryControl` (components/reader/StudyEntry.tsx, owned) in
 * its own toolbar. Everything a tap on "Study" does funnels through
 * `beginStudyEntry` -> `resolveStudySessionId`, which writes exclusively
 * through V2VAULT-001's existing vault writers (`saveLocalStudySession`,
 * `lib/sync/store.ts`) and SYNCV2ROUTE-001's existing push/pull loop
 * (`syncNowV2`, `lib/sync/client.ts`) — no new write path.
 *
 * TEST-ENVIRONMENT NOTE (same discipline as tests/study-page.test.ts,
 * tests/study-composer.test.ts, tests/verse-selection.test.ts — all read as
 * precedent before writing this file): `tsx --test tests/*.test.ts` is plain
 * Node, no jsdom, no @testing-library. `nodeRequire` + `require.cache`
 * seeding loads the REAL production modules, stubbing only CSS Modules (an
 * asset a bundler resolves, not something Node can parse) and — for the
 * page.tsx block only — the page's own data-access seam
 * (`@/lib/db/workspaces`, `@/lib/auth/config`, `server-only`) and its sibling
 * `ChapterReader` (stubbed to a prop-capturing function so this file can
 * assert exactly what the page hands it, without pulling in ChapterReader's
 * own enormous dependency graph — a file this task does not need to
 * re-verify, since STUDYENTRY-001 only ADDS a `workspaceId` prop to it and a
 * `<StudyEntryControl>` mount, both covered directly below).
 *
 * RESIDUAL GAP (disclosed, not hidden — same shape as every sibling suite's
 * own "RESIDUAL GAP" section): `StudyEntryControl` calls React Router's
 * `useRouter()` unconditionally, which THROWS outside a real Next.js App
 * Router context (no jsdom + router provider here) — unlike `ClaimComposer`
 * (no router calls, SSR-renderable) or the hookless `VerseColumn`, this
 * component cannot be rendered or click-driven in this suite. What IS
 * proved: every function `StudyEntryControl`'s `handleStart` calls —
 * `beginStudyEntry`, and everything it in turn calls — is exercised directly
 * against its real, exported implementation (never a reimplementation), for
 * both the success path and every failure path, including the mutation
 * proof for acceptance criterion 6 below. Closing this gap for real needs
 * jsdom + a router-context test harness added to package.json, which is
 * outside this task's ownedPaths.
 */
import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import type { StudySession, StudySessionWorkflowState } from "@/lib/contracts/study-v2";
import { syncStudySessionV2Schema } from "@/lib/api/sync-v2";

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

// CSS Modules resolve every requested class to its own name, same convention
// as every other file in this suite that loads a real component.
const cssProxy = new Proxy(
  {},
  { get: (_target, key) => (typeof key === "string" ? key : undefined) },
);

function sampleRange(overrides: Partial<CanonicalRangeV1> = {}): CanonicalRangeV1 {
  return { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.1", end: "1.3.6", ...overrides };
}

function sampleSession(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: "session-existing",
    workspaceId: "workspace-1",
    range: sampleRange(),
    mode: "encounter",
    workflowState: "active",
    connectionState: "unexamined",
    catalogReleaseId: null,
    readGateAt: null,
    currentStep: "observe",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

// ===========================================================================
// SECTION 1 — load the real StudyEntry.tsx. Only ChapterReader's own CSS
// Module (StudyEntry.tsx styles itself from it -- see that file's import
// comment for why) and Chip's CSS Module need stubbing; everything else
// (lib/sync/store's real vault writers, lib/sync/client's real syncNowV2,
// lib/bible/reference, next/navigation) loads for real, exactly BUILD_PLAN
// tenet 7 and acceptance criterion 2 require this file to actually use.
// ===========================================================================
seedModule("@/components/reader/ChapterReader.module.css", { default: cssProxy });
seedModule("@/components/ui/Chip.module.css", { default: cssProxy });

type StudyEntryDeps = {
  listSessions: () => Promise<StudySession[]>;
  saveSession: (session: StudySession) => Promise<void>;
  pushChanges: () => Promise<unknown>;
  now: () => string;
  newId: () => string;
};
type StudyEntryResult =
  | { status: "created"; sessionId: string }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

const studyEntryModule = nodeRequire("@/components/reader/StudyEntry.tsx") as {
  buildEntryRange: (
    book: number,
    chapter: number,
    verseCount: number,
    selectedVerse: string | null,
  ) => CanonicalRangeV1 | null;
  findExistingActiveSession: (
    sessions: StudySession[],
    workspaceId: string,
    range: CanonicalRangeV1,
  ) => StudySession | null;
  resolveStudySessionId: (
    workspaceId: string,
    range: CanonicalRangeV1,
    deps: StudyEntryDeps,
  ) => Promise<string>;
  beginStudyEntry: (
    workspaceId: string | null,
    range: CanonicalRangeV1 | null,
    deps?: StudyEntryDeps,
  ) => Promise<StudyEntryResult>;
};
const { buildEntryRange, findExistingActiveSession, resolveStudySessionId, beginStudyEntry } = studyEntryModule;

// ---------------------------------------------------------------------------
// A tiny in-memory fake of StudyEntryDeps, for tests that need to control
// failure/success independently of a real IndexedDB round trip. The
// PIPELINE section further down uses the REAL store instead.
// ---------------------------------------------------------------------------
function fakeDeps(overrides: Partial<StudyEntryDeps> = {}): { deps: StudyEntryDeps; saved: StudySession[] } {
  const saved: StudySession[] = [];
  const deps: StudyEntryDeps = {
    listSessions: async () => [...saved],
    saveSession: async (session) => {
      saved.push(session);
    },
    pushChanges: async () => ({}),
    now: () => "2026-08-20T12:00:00.000Z",
    newId: () => `generated-${saved.length + 1}`,
    ...overrides,
  };
  return { deps, saved };
}

// ===========================================================================
// buildEntryRange — the passage a tap anchors to.
// ===========================================================================

test("buildEntryRange: no verse selected spans the whole loaded chapter", () => {
  const range = buildEntryRange(1, 3, 24, null);
  assert.deepEqual(range, { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.1", end: "1.3.24" });
});

test("buildEntryRange: a selected verse anchors to just that verse", () => {
  const range = buildEntryRange(1, 3, 24, "1.3.15");
  assert.deepEqual(range, { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.15", end: "1.3.15" });
});

test("buildEntryRange: an unloaded chapter (verseCount 0) returns null rather than a zero-verse range", () => {
  assert.equal(buildEntryRange(1, 3, 0, null), null);
});

// ===========================================================================
// findExistingActiveSession — the dedup predicate (acceptance criterion 3).
// ===========================================================================

test("findExistingActiveSession: matches an active session with the identical range in the same workspace", () => {
  const session = sampleSession();
  const found = findExistingActiveSession([session], "workspace-1", sampleRange());
  assert.equal(found?.id, session.id);
});

test("findExistingActiveSession: a different workspace's identical range is never matched", () => {
  const session = sampleSession({ workspaceId: "workspace-other" });
  assert.equal(findExistingActiveSession([session], "workspace-1", sampleRange()), null);
});

test("findExistingActiveSession: a different range in the same workspace is never matched", () => {
  const session = sampleSession({ range: sampleRange({ start: "1.4.1", end: "1.4.10" }) });
  assert.equal(findExistingActiveSession([session], "workspace-1", sampleRange()), null);
});

test("findExistingActiveSession: a closed or archived session for the same range is never matched (a new pass is not a duplicate)", () => {
  for (const workflowState of ["closed", "archived"] as StudySessionWorkflowState[]) {
    const session = sampleSession({ workflowState });
    assert.equal(
      findExistingActiveSession([session], "workspace-1", sampleRange()),
      null,
      `workflowState "${workflowState}" should not be treated as a dedup match`,
    );
  }
});

test("findExistingActiveSession: a soft-deleted session for the same range is never matched", () => {
  const session = sampleSession({ deletedAt: "2026-01-02T00:00:00.000Z" });
  assert.equal(findExistingActiveSession([session], "workspace-1", sampleRange()), null);
});

// ===========================================================================
// resolveStudySessionId — create-or-reuse, with the injectable fake deps.
// ===========================================================================

test("resolveStudySessionId: no existing session -> builds one via buildStudySessionDraft, saves it, and pushes", async () => {
  const pushed: string[] = [];
  const { deps, saved } = fakeDeps({ pushChanges: async () => void pushed.push("pushed") });

  const sessionId = await resolveStudySessionId("workspace-1", sampleRange(), deps);

  assert.equal(saved.length, 1, "exactly one session should have been saved");
  assert.equal(saved[0].id, sessionId);
  assert.equal(saved[0].workspaceId, "workspace-1");
  assert.deepEqual(saved[0].range, sampleRange());
  // Built by V2COMPOSER-001's own buildStudySessionDraft, not a duplicate
  // literal here -- mode/workflowState/connectionState/currentStep/revision
  // match its documented output exactly.
  assert.equal(saved[0].mode, "encounter");
  assert.equal(saved[0].workflowState, "active");
  assert.equal(saved[0].connectionState, "unexamined");
  assert.equal(saved[0].currentStep, "observe");
  assert.equal(saved[0].revision, 1);
  assert.deepEqual(pushed, ["pushed"], "resolveStudySessionId must push before returning");
});

test("resolveStudySessionId: an existing active session for the same range is reused -- no second save", async () => {
  const existing = sampleSession({ id: "session-reuse-me" });
  const pushed: string[] = [];
  const { deps, saved } = fakeDeps({
    listSessions: async () => [existing],
    pushChanges: async () => void pushed.push("pushed"),
  });

  const sessionId = await resolveStudySessionId("workspace-1", sampleRange(), deps);

  assert.equal(sessionId, "session-reuse-me");
  assert.equal(saved.length, 0, "no new session should be saved when an active one already covers this range");
  assert.deepEqual(pushed, ["pushed"], "the reuse path must still push (the existing row may itself be unsynced)");
});

test("resolveStudySessionId: a save failure rejects rather than resolving to a session id", async () => {
  const { deps } = fakeDeps({
    saveSession: async () => {
      throw new Error("IndexedDB write failed");
    },
  });

  await assert.rejects(() => resolveStudySessionId("workspace-1", sampleRange(), deps));
});

test("resolveStudySessionId: a push failure rejects rather than resolving to a session id (offline write must not silently succeed)", async () => {
  const { deps } = fakeDeps({
    pushChanges: async () => {
      throw new Error("network unreachable");
    },
  });

  await assert.rejects(() => resolveStudySessionId("workspace-1", sampleRange(), deps));
});

// ===========================================================================
// beginStudyEntry — the exact function StudyEntryControl's click handler
// calls. Never throws; every outcome is a StudyEntryResult.
// ===========================================================================

test("beginStudyEntry: null workspaceId -> unavailable, no write attempted", async () => {
  const { deps, saved } = fakeDeps();
  const result = await beginStudyEntry(null, sampleRange(), deps);
  assert.equal(result.status, "unavailable");
  assert.equal(saved.length, 0);
});

test("beginStudyEntry: null range (chapter still loading) -> unavailable, no write attempted", async () => {
  const { deps, saved } = fakeDeps();
  const result = await beginStudyEntry("workspace-1", null, deps);
  assert.equal(result.status, "unavailable");
  assert.equal(saved.length, 0);
});

test("beginStudyEntry: happy path -> created, with the session id resolveStudySessionId actually produced", async () => {
  const { deps, saved } = fakeDeps();
  const result = await beginStudyEntry("workspace-1", sampleRange(), deps);
  assert.equal(result.status, "created");
  assert.ok(result.status === "created" && result.sessionId === saved[0]?.id);
});

// ===========================================================================
// MUTATION-GUARD (acceptance criterion 6) — a save/push failure must NEVER
// produce a "created" result. This is the exact property this task's commit
// mutation-proves by hand: break beginStudyEntry's catch branch so it
// fabricates a "created" result instead, run this file, watch these two
// NAMED tests fail, restore, watch them pass again.
// ===========================================================================

test("MUTATION-GUARD: a save failure must resolve beginStudyEntry to status 'error', never 'created'", async () => {
  const { deps } = fakeDeps({
    saveSession: async () => {
      throw new Error("IndexedDB write failed");
    },
  });
  const result = await beginStudyEntry("workspace-1", sampleRange(), deps);
  assert.equal(
    result.status,
    "error",
    `a save failure must never navigate: got status "${result.status}"${
      "sessionId" in result ? ` (sessionId ${(result as { sessionId: string }).sessionId})` : ""
    }`,
  );
});

test("MUTATION-GUARD: a push failure must resolve beginStudyEntry to status 'error', never 'created'", async () => {
  const { deps } = fakeDeps({
    pushChanges: async () => {
      throw new Error("network unreachable");
    },
  });
  const result = await beginStudyEntry("workspace-1", sampleRange(), deps);
  assert.equal(
    result.status,
    "error",
    `a push failure must never navigate: got status "${result.status}"${
      "sessionId" in result ? ` (sessionId ${(result as { sessionId: string }).sessionId})` : ""
    }`,
  );
});

// ===========================================================================
// PIPELINE — resolveStudySessionId against the REAL local vault writer/
// reader (lib/sync/store.ts's saveLocalStudySession / listLocalV2Entities),
// with only the network boundary (pushChanges) faked. Proves acceptance
// criterion 2 ("through the existing vault writers only") end to end, and
// acceptance criterion 3 (double-start dedup) against real IndexedDB rather
// than an in-memory array.
// ===========================================================================

test("PIPELINE: a created session round-trips through the real IndexedDB vault writer and validates against the real wire schema", async () => {
  const store = await import("@/lib/sync/store");
  const workspaceId = `workspace-pipeline-${crypto.randomUUID()}`;
  const range = sampleRange({ start: "43.3.16", end: "43.3.16" }); // John 3:16

  const sessionId = await resolveStudySessionId(workspaceId, range, {
    listSessions: () => store.listLocalV2Entities("session"),
    saveSession: store.saveLocalStudySession,
    pushChanges: async () => ({}),
    now: () => new Date().toISOString(),
    newId: () => crypto.randomUUID(),
  });

  const rows = await store.listLocalV2Entities("session");
  const saved = rows.find((row) => row.id === sessionId);
  assert.ok(saved, "the created session was not found via the real vault reader");
  assert.equal(saved?.workspaceId, workspaceId);
  assert.deepEqual(saved?.range, range);

  const parsed = syncStudySessionV2Schema.safeParse(saved);
  assert.equal(
    parsed.success,
    true,
    `a session built by resolveStudySessionId failed the real wire schema: ${
      parsed.success ? "" : JSON.stringify(parsed.error.issues)
    }`,
  );

  // The outbox op V2VAULT-001's writer enqueues alongside the entity itself
  // -- proves this really went through saveLocalStudySession's one-transaction
  // write, not a hand-rolled put().
  const pending = await store.getPendingV2Ops();
  const op = pending.find((candidate) => candidate.entityId === sessionId);
  assert.ok(op, "no syncQueueV2 op was queued for the created session");
  assert.equal(op?.entity, "session");
  await store.removePendingV2Ops(pending.map((p) => p.opId));
});

test("PIPELINE: starting a study twice for the identical range reuses the same session -- no duplicate row in real IndexedDB", async () => {
  const store = await import("@/lib/sync/store");
  const workspaceId = `workspace-pipeline-dedup-${crypto.randomUUID()}`;
  const range = sampleRange({ start: "1.1.1", end: "1.1.31" }); // Genesis 1
  const deps = {
    listSessions: () => store.listLocalV2Entities("session"),
    saveSession: store.saveLocalStudySession,
    pushChanges: async () => ({}),
    now: () => new Date().toISOString(),
    newId: () => crypto.randomUUID(),
  };

  const firstId = await resolveStudySessionId(workspaceId, range, deps);
  const secondId = await resolveStudySessionId(workspaceId, range, deps);

  assert.equal(secondId, firstId, "starting a study twice for the same range must resolve to the same session");

  const rows = await store.listLocalV2Entities("session");
  const matching = rows.filter((row) => row.workspaceId === workspaceId);
  assert.equal(matching.length, 1, `expected exactly one session for this workspace/range, found ${matching.length}`);

  const pending = await store.getPendingV2Ops();
  await store.removePendingV2Ops(pending.filter((op) => op.entityId === firstId).map((op) => op.opId));
});

// ===========================================================================
// SECTION 2 — load the real page.tsx. `server-only`, the page's own
// data-access seam (`@/lib/db/workspaces`, `@/lib/auth/config`), and
// `@/components/reader/ChapterReader` (stubbed to a prop-capturing function,
// so this file proves exactly what the page hands it without re-verifying
// ChapterReader's own enormous, separately-tested dependency graph) are
// stubbed; `next/navigation`'s `notFound` is captured via a thrown signal,
// the same technique tests/study-page.test.ts already establishes.
// ===========================================================================

class NotFoundSignal extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundSignal";
  }
}

type SessionLike = { user?: { id?: string | null } | null } | null;

type PageStubs = {
  auth: () => Promise<SessionLike>;
  getOrCreatePersonalWorkspace: (userId: string) => Promise<string>;
};

const pageStubs: PageStubs = {
  auth: async () => ({ user: { id: "reader-1" } }),
  getOrCreatePersonalWorkspace: async () => "workspace-resolved",
};

function resetPageStubs() {
  pageStubs.auth = async () => ({ user: { id: "reader-1" } });
  pageStubs.getOrCreatePersonalWorkspace = async () => "workspace-resolved";
}

let capturedChapterReaderProps: Record<string, unknown> | null = null;

seedModule("server-only", {});
seedModule("@/lib/auth/config", { auth: () => pageStubs.auth() });
seedModule("@/lib/db/workspaces", {
  getOrCreatePersonalWorkspace: (userId: string) => pageStubs.getOrCreatePersonalWorkspace(userId),
});
seedModule("@/components/reader/ChapterReader", {
  ChapterReader: (props: Record<string, unknown>) => {
    capturedChapterReaderProps = props;
    return null;
  },
});
seedModule("next/navigation", {
  notFound: (): never => {
    throw new NotFoundSignal();
  },
});

const pageModule = nodeRequire("@/app/(app)/read/[book]/[chapter]/page.tsx") as {
  default: (props: { params: Promise<{ book: string; chapter: string }> }) => Promise<unknown>;
  resolveWorkspaceId: (deps?: {
    getSession: () => Promise<SessionLike>;
    resolveWorkspaceId: (userId: string) => Promise<string>;
  }) => Promise<string | null>;
};
const { resolveWorkspaceId } = pageModule;
const ReadChapterPage = pageModule.default;

// ===========================================================================
// resolveWorkspaceId — the page's own server-side derivation. NEVER a
// caller-supplied id: notice the function takes no route param/searchParams
// argument at all, only injectable auth/workspace-lookup deps, mirroring
// study/[sessionId]/page.tsx's own resolveStudyPageData/resolveSessionState
// convention exactly.
// ===========================================================================

test("resolveWorkspaceId: no authenticated session -> null", async () => {
  const result = await resolveWorkspaceId({
    getSession: async () => null,
    resolveWorkspaceId: async () => "should-never-be-reached",
  });
  assert.equal(result, null);
});

test("resolveWorkspaceId: session present but carries no user id -> null", async () => {
  const result = await resolveWorkspaceId({
    getSession: async () => ({ user: {} }),
    resolveWorkspaceId: async () => "should-never-be-reached",
  });
  assert.equal(result, null);
});

test("resolveWorkspaceId: a healthy session resolves the workspace id via getOrCreatePersonalWorkspace", async () => {
  const result = await resolveWorkspaceId({
    getSession: async () => ({ user: { id: "reader-42" } }),
    resolveWorkspaceId: async (userId) => `workspace-for-${userId}`,
  });
  assert.equal(result, "workspace-for-reader-42");
});

test("resolveWorkspaceId: a database failure during workspace lookup collapses to null, not a thrown error", async () => {
  const result = await resolveWorkspaceId({
    getSession: async () => ({ user: { id: "reader-1" } }),
    resolveWorkspaceId: async () => {
      throw new Error("database unreachable");
    },
  });
  assert.equal(result, null);
});

test("resolveWorkspaceId: auth() itself throwing also collapses to null, not a thrown error", async () => {
  const result = await resolveWorkspaceId({
    getSession: async () => {
      throw new Error("database unreachable");
    },
    resolveWorkspaceId: async () => "should-never-be-reached",
  });
  assert.equal(result, null);
});

// ===========================================================================
// ReadChapterPage (default export) — the real server component, rendered.
// ===========================================================================

test("PAGE: an invalid chapter still 404s exactly as before this task (URL validation unchanged)", async () => {
  resetPageStubs();
  capturedChapterReaderProps = null;

  await assert.rejects(
    () => ReadChapterPage({ params: Promise.resolve({ book: "1", chapter: "0" }) }),
    NotFoundSignal,
  );
  assert.equal(capturedChapterReaderProps, null, "ChapterReader must not be reached for an invalid chapter");
});

test("PAGE: a valid chapter passes the server-resolved workspaceId to ChapterReader -- never a route param, there is none to smuggle one through", async () => {
  resetPageStubs();
  capturedChapterReaderProps = null;

  const element = await ReadChapterPage({ params: Promise.resolve({ book: "1", chapter: "3" }) });
  renderToStaticMarkup(element as never);

  assert.ok(capturedChapterReaderProps, "ChapterReader was not rendered for a valid chapter");
  const props: Record<string, unknown> = capturedChapterReaderProps;
  assert.equal(props.book, 1);
  assert.equal(props.chapter, 3);
  assert.equal(props.workspaceId, "workspace-resolved");
});

test("PAGE: a database outage during workspace resolution still renders the chapter, with workspaceId null (reading must keep working)", async () => {
  resetPageStubs();
  pageStubs.getOrCreatePersonalWorkspace = async () => {
    throw new Error("database unreachable");
  };
  capturedChapterReaderProps = null;

  const element = await ReadChapterPage({ params: Promise.resolve({ book: "1", chapter: "3" }) });
  renderToStaticMarkup(element as never);

  assert.ok(capturedChapterReaderProps, "ChapterReader should still render when workspace resolution fails");
  const props: Record<string, unknown> = capturedChapterReaderProps;
  assert.equal(props.workspaceId, null);
});
