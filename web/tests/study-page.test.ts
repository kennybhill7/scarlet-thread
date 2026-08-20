/**
 * STUDYPAGE-001 — mounting V2COMPOSER-001's `ClaimComposer` at
 * `app/(app)/study/[sessionId]/page.tsx`.
 *
 * TEST-ENVIRONMENT NOTE (same discipline as tests/review-setup-state.test.ts
 * and tests/study-composer.test.ts, both read as precedent before writing
 * this file): this repo's test script is `tsx --test tests/*.test.ts` —
 * plain Node, no jsdom. `nodeRequire` + `require.cache` seeding loads the
 * REAL `page.tsx` (and, transitively, the REAL `ClaimComposer.tsx`),
 * stubbing only:
 *   - `server-only` (throws unconditionally outside a bundler)
 *   - every `*.module.css` the real module graph touches (this page's own,
 *     plus ClaimComposer's four — claim-composer/Button/Chip/Field)
 *   - `next/navigation`'s `redirect`/`notFound` (captured via a thrown
 *     signal, exactly `review-setup-state.test.ts`'s `RedirectSignal`)
 *   - `@/lib/auth/config`, `@/lib/db/threads`, `@/lib/db/workspaces`,
 *     `@/app/api/v2/_lib/queries` (the page's own data-access seam;
 *     `resolveStudyPageData`'s `deps` parameter exists for exactly this)
 * `fake-indexeddb/auto` stands in for IndexedDB so `lib/sync/store.ts`'s
 * module-level `openDB(...)` call (reached transitively through the real
 * `ClaimComposer`) succeeds, matching `tests/study-composer.test.ts`.
 *
 * Two layers are tested, deliberately (Gate 0.3 precedent):
 *   1. `resolveStudyPageData` / `resolveSessionState` — the pure
 *      discriminators, called directly with fake `deps`.
 *   2. The RENDERED OUTPUT of the real default-export `StudySessionPage`,
 *      via `react-dom/server`, so a claim about what reaches the reader
 *      (or does not — the HOSTILE tests) is checked against actual HTML,
 *      not just a view-model tag.
 */
import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { CANONICAL_VERSIFICATION_ID } from "@/lib/contracts/range-v1";
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

// ---------------------------------------------------------------------------
// Swappable stubs behind every seeded data-access module. The page captures
// its default dependencies at module load, so the indirection (not the
// function itself) is what gets seeded; each test rewrites `stubs.*` first.
// ---------------------------------------------------------------------------

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT:${url}`);
    this.name = "RedirectSignal";
  }
}

class NotFoundSignal extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundSignal";
  }
}

type SessionLike = { user?: { id?: string | null } | null } | null;

/**
 * READGATE-001 (2026-08-20): this fixture's `readGateAt` changed from `null`
 * to an already-set timestamp. Before this task, `WorkspaceShell` mounted
 * the real `ClaimComposer` in Observe unconditionally, so a fresh
 * `readGateAt: null` session was a valid stand-in for "the composer is
 * reachable" in every test below that isn't specifically about the read
 * gate. Now Observe's real content is conditioned on
 * `isPassageMarkedRead(session)` (`lib/workspace/renderState.ts`), so a
 * `readGateAt: null` fixture would make every one of those tests fail for
 * an unrelated reason (the gate, not whatever the test actually exercises —
 * auth, workspace isolation, not-found handling). This fixture now models a
 * session that has ALREADY passed the read gate — the ordinary "resumed
 * study" case — so every test below keeps testing what it always tested.
 * The one test that specifically needs `readGateAt: null` (the actual
 * regression this task exists to fix) builds its own session below rather
 * than relying on this shared default — see "READGATE" section near the
 * end of this file.
 */
function sampleSession(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: "session-legit",
    workspaceId: "workspace-legit",
    range: { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.1", end: "1.3.6" },
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

type Stubs = {
  auth: () => Promise<SessionLike>;
  listThreads: (userId: string) => Promise<unknown[]>;
  getOrCreatePersonalWorkspace: (userId: string) => Promise<string>;
  getSessionV2: (workspaceId: string, sessionId: string) => Promise<StudySession | null>;
};

/**
 * A tiny two-tenant fixture: "owner-1" resolves to "workspace-legit", which
 * holds exactly `sampleSession()` under id "session-legit". A separate,
 * unrelated "workspace-victim" holds its own session, "session-victim",
 * with a different range — never reachable by "owner-1" through this page.
 * `getSessionV2` below is a faithful little model of the real function's
 * documented contract (`app/api/v2/_lib/queries.ts`): scoped by BOTH id AND
 * workspaceId, `null` for anything that does not match both.
 */
const victimSession = sampleSession({
  id: "session-victim",
  workspaceId: "workspace-victim",
  range: { versificationId: CANONICAL_VERSIFICATION_ID, start: "66.1.1", end: "66.1.3" },
});

function defaultGetSessionV2(workspaceId: string, sessionId: string): Promise<StudySession | null> {
  const store: Record<string, StudySession> = {
    "workspace-legit:session-legit": sampleSession(),
    "workspace-victim:session-victim": victimSession,
  };
  return Promise.resolve(store[`${workspaceId}:${sessionId}`] ?? null);
}

const stubs: Stubs = {
  auth: async () => ({ user: { id: "owner-1" } }),
  listThreads: async () => [],
  getOrCreatePersonalWorkspace: async () => "workspace-legit",
  getSessionV2: (workspaceId, sessionId) => defaultGetSessionV2(workspaceId, sessionId),
};

function resetStubs() {
  stubs.auth = async () => ({ user: { id: "owner-1" } });
  stubs.listThreads = async () => [];
  stubs.getOrCreatePersonalWorkspace = async () => "workspace-legit";
  stubs.getSessionV2 = (workspaceId, sessionId) => defaultGetSessionV2(workspaceId, sessionId);
}

// CSS Modules resolve every requested class to its own name, same convention
// as tests/review-setup-state.test.ts and tests/study-composer.test.ts.
const cssProxy = new Proxy(
  {},
  { get: (_target, key) => (typeof key === "string" ? key : undefined) },
);

seedModule("server-only", {});
seedModule("@/app/(app)/study/[sessionId]/study.module.css", { default: cssProxy });
seedModule("@/components/study/claim-composer.module.css", { default: cssProxy });
seedModule("@/components/ui/Button.module.css", { default: cssProxy });
seedModule("@/components/ui/Chip.module.css", { default: cssProxy });
seedModule("@/components/ui/Field.module.css", { default: cssProxy });
seedModule("next/navigation", {
  redirect: (url: string): never => {
    throw new RedirectSignal(url);
  },
  notFound: (): never => {
    throw new NotFoundSignal();
  },
});
seedModule("@/lib/auth/config", { auth: () => stubs.auth() });
seedModule("@/lib/db/threads", { listThreads: (userId: string) => stubs.listThreads(userId) });
seedModule("@/lib/db/workspaces", {
  getOrCreatePersonalWorkspace: (userId: string) => stubs.getOrCreatePersonalWorkspace(userId),
});
seedModule("@/app/api/v2/_lib/queries", {
  getSessionV2: (workspaceId: string, sessionId: string) => stubs.getSessionV2(workspaceId, sessionId),
});

const pageModule = nodeRequire("@/app/(app)/study/[sessionId]/page.tsx") as {
  default: (props: { params: Promise<{ sessionId: string }> }) => Promise<unknown>;
  resolveSessionState: typeof import("../app/(app)/study/[sessionId]/page").resolveSessionState;
  resolveStudyPageData: typeof import("../app/(app)/study/[sessionId]/page").resolveStudyPageData;
};

const { resolveSessionState, resolveStudyPageData } = pageModule;
const StudySessionPage = pageModule.default;

/** Renders the real page component to HTML, or reports what it threw. */
async function renderPage(
  routeParams: Record<string, unknown>,
): Promise<
  | { kind: "html"; html: string }
  | { kind: "redirect"; url: string }
  | { kind: "not-found" }
> {
  try {
    const element = await StudySessionPage({ params: Promise.resolve(routeParams) as never });
    return { kind: "html", html: renderToStaticMarkup(element as never) };
  } catch (error) {
    if (error instanceof RedirectSignal) return { kind: "redirect", url: error.url };
    if (error instanceof NotFoundSignal) return { kind: "not-found" };
    throw error;
  }
}

async function renderHtml(routeParams: Record<string, unknown> = { sessionId: "session-legit" }): Promise<string> {
  const result = await renderPage(routeParams);
  assert.equal(
    result.kind,
    "html",
    `expected HTML, got ${result.kind}${result.kind === "redirect" ? ` -> ${result.url}` : ""}`,
  );
  return (result as { kind: "html"; html: string }).html;
}

const thrower = (message: string) => async (): Promise<never> => {
  throw new Error(message);
};

// Strings a reader actually sees. Named constants so a copy change that
// erases a distinction cannot silently pass.
const SETUP_HEADLINE = "Setup incomplete";
const COMPOSER_HEADLINE = "What did you notice in the text?";

// ===========================================================================
// GUARD — unauthenticated visitors (acceptance criterion 2).
// ===========================================================================

test("GUARD: no session with a healthy database redirects to /sign-in and renders no composer content", async () => {
  resetStubs();
  stubs.auth = async () => null;
  stubs.listThreads = async () => [];

  const result = await renderPage({ sessionId: "session-legit" });

  assert.equal(
    result.kind,
    "redirect",
    result.kind === "html"
      ? `the auth guard did not fire; the page rendered:\n${result.html}`
      : `expected a redirect, got ${result.kind}`,
  );
  if (result.kind !== "redirect") return;
  assert.equal(result.url, "/sign-in");
});

test("GUARD: a session with a blank user id is treated as signed out, not as the owner", async () => {
  resetStubs();
  stubs.auth = async () => ({ user: { id: "" } });

  const result = await renderPage({ sessionId: "session-legit" });

  assert.equal(result.kind, "redirect");
  if (result.kind !== "redirect") return;
  assert.equal(result.url, "/sign-in");
});

test("RENDER: a dead database during the session check renders setup-incomplete, not a sign-in redirect", async () => {
  resetStubs();
  stubs.auth = async () => null;
  stubs.listThreads = thrower("connect ECONNREFUSED 127.0.0.1:5432");

  const result = await renderPage({ sessionId: "session-legit" });

  assert.equal(result.kind, "html", "a dead database redirected the owner to /sign-in");
  if (result.kind !== "html") return;
  assert.ok(result.html.includes(SETUP_HEADLINE));
  assert.ok(result.html.includes("You have not been signed out"));
});

test("resolveSessionState separates authenticated, signed-out, and setup-incomplete", async () => {
  assert.deepEqual(
    await resolveSessionState({ getSession: async () => ({ user: { id: "owner-1" } }), probeDatabase: async () => [] }),
    { status: "authenticated", userId: "owner-1" },
  );
  assert.deepEqual(
    await resolveSessionState({ getSession: async () => null, probeDatabase: async () => [] }),
    { status: "signed-out" },
  );
  assert.deepEqual(
    await resolveSessionState({ getSession: async () => null, probeDatabase: thrower("ECONNREFUSED") }),
    { status: "setup-incomplete" },
  );
});

// ===========================================================================
// NOT FOUND — an unknown session id (acceptance criterion 3, first half).
// ===========================================================================

test("NOT FOUND: a session id that does not exist anywhere renders not-found, not an empty composer", async () => {
  resetStubs();

  const result = await renderPage({ sessionId: "no-such-session" });

  assert.equal(
    result.kind,
    "not-found",
    result.kind === "html" ? `expected not-found; the page rendered a composer:\n${result.html}` : `got ${result.kind}`,
  );
});

test("resolveStudyPageData resolves not-found for an unknown session id", async () => {
  const resolution = await resolveStudyPageData("owner-1", "no-such-session", {
    resolveWorkspaceId: async () => "workspace-legit",
    getStudySession: async () => null,
  });
  assert.deepEqual(resolution, { status: "not-found" });
});

test("RENDER: setup-incomplete when the workspace/session lookup itself fails", async () => {
  resetStubs();
  stubs.getOrCreatePersonalWorkspace = thrower("connect ECONNREFUSED 127.0.0.1:5432");

  const result = await renderPage({ sessionId: "session-legit" });

  assert.equal(result.kind, "html");
  if (result.kind !== "html") return;
  assert.ok(result.html.includes(SETUP_HEADLINE));
  assert.ok(!result.html.includes(COMPOSER_HEADLINE));
});

// ===========================================================================
// HAPPY PATH — the caller's own session in their own workspace mounts the
// real ClaimComposer (acceptance criterion 1's positive case, criterion 4).
// ===========================================================================

test("RENDER: the owner's own session renders the real ClaimComposer, scoped to their own workspace", async () => {
  resetStubs();
  const seen: Array<[string, string]> = [];
  stubs.getSessionV2 = (workspaceId, sessionId) => {
    seen.push([workspaceId, sessionId]);
    return defaultGetSessionV2(workspaceId, sessionId);
  };

  const html = await renderHtml({ sessionId: "session-legit" });

  assert.ok(html.includes(COMPOSER_HEADLINE), `composer did not render:\n${html}`);
  // The passage reference from the resolved session reached the composer.
  assert.ok(html.includes("1.3.1"), `range from the session did not reach the composer:\n${html}`);
  assert.deepEqual(seen, [["workspace-legit", "session-legit"]]);
});

test("GUARD: the authenticated owner's own id is what resolves the workspace, for every lookup", async () => {
  resetStubs();
  const seenUserIds: string[] = [];
  stubs.auth = async () => ({ user: { id: "owner-42" } });
  stubs.getOrCreatePersonalWorkspace = async (userId) => {
    seenUserIds.push(userId);
    return "workspace-42";
  };
  stubs.getSessionV2 = async (workspaceId, sessionId) =>
    workspaceId === "workspace-42" && sessionId === "session-legit" ? sampleSession({ workspaceId: "workspace-42" }) : null;

  await renderHtml({ sessionId: "session-legit" });

  assert.deepEqual(seenUserIds, ["owner-42"]);
});

// ===========================================================================
// HOSTILE — a caller cannot aim this page at another workspace (acceptance
// criteria 1 and 3, second half). Two independent attack shapes.
// ===========================================================================

test("HOSTILE: a session id that belongs to another workspace renders not-found, never that workspace's data", async () => {
  resetStubs();
  const seen: Array<[string, string]> = [];
  stubs.getSessionV2 = (workspaceId, sessionId) => {
    seen.push([workspaceId, sessionId]);
    return defaultGetSessionV2(workspaceId, sessionId);
  };

  // "owner-1" (-> workspace-legit) requests the URL for a session that only
  // exists under workspace-victim.
  const result = await renderPage({ sessionId: "session-victim" });

  assert.equal(
    result.kind,
    "not-found",
    result.kind === "html"
      ? `the page leaked another workspace's session:\n${result.html}`
      : `got ${result.kind}`,
  );
  // The lookup was scoped to the CALLER's own resolved workspace, not the
  // victim's — it never even reads "workspace-victim" anywhere.
  assert.deepEqual(seen, [["workspace-legit", "session-victim"]]);
});

test("HOSTILE: an extra workspaceId smuggled into the route params is ignored; the session-derived workspace is used instead", async () => {
  resetStubs();
  const seen: Array<[string, string]> = [];
  stubs.getSessionV2 = (workspaceId, sessionId) => {
    seen.push([workspaceId, sessionId]);
    return defaultGetSessionV2(workspaceId, sessionId);
  };

  // The page's own TypeScript type only names `sessionId`, but nothing at
  // runtime stops a caller from POSTing/crafting a params object with an
  // extra key. This proves the extra key is never read.
  const html = await renderHtml({ sessionId: "session-legit", workspaceId: "workspace-victim" });

  assert.ok(html.includes(COMPOSER_HEADLINE));
  assert.deepEqual(
    seen,
    [["workspace-legit", "session-legit"]],
    "the resolved workspace, not the smuggled param, must be the one used for the lookup",
  );
});

test("resolveStudyPageData has no parameter through which a caller-supplied workspace id could ever flow", async () => {
  // Structural proof, not just a behavioural one: the function's only
  // caller-derived input is `routeSessionId` (a session id, never a
  // workspace id). `deps.resolveWorkspaceId` is given ONLY `userId` — a
  // hostile deps object that ignores its own `userId` argument and always
  // resolves to "workspace-attacker" proves the workspace comes from
  // `resolveWorkspaceId`'s return value alone, not from anything threaded
  // through from `routeSessionId`.
  const seenGetStudySessionArgs: Array<[string, string]> = [];
  const resolution = await resolveStudyPageData("owner-1", "workspace-attacker", {
    resolveWorkspaceId: async () => "workspace-legit",
    getStudySession: async (workspaceId, sessionId) => {
      seenGetStudySessionArgs.push([workspaceId, sessionId]);
      return null;
    },
  });
  assert.deepEqual(resolution, { status: "not-found" });
  assert.deepEqual(seenGetStudySessionArgs, [["workspace-legit", "workspace-attacker"]]);
});

// ===========================================================================
// READGATE (READGATE-001 acceptance criterion 4) — THE regression test this
// task exists to fix. A freshly created session (currentStep: "read",
// readGateAt: null -- exactly what StudyEntry.tsx's buildNewStudySession and
// ClaimComposer.tsx's buildStudySessionDraft now mint) must not render the
// real ClaimComposer through the full page pipeline. Only once readGateAt is
// set does it appear. This did not exist before this task -- the old
// `sampleSession()` default (readGateAt: null) was asserted to render the
// composer directly (see the HAPPY PATH test above, before this task
// updated the fixture) precisely because the old WorkspaceShell never
// gated Observe's content at all.
// ===========================================================================

test("READGATE: a freshly created session (currentStep: read, readGateAt: null) does NOT render the real ClaimComposer", async () => {
  resetStubs();
  const freshSession = sampleSession({ currentStep: "read", readGateAt: null });
  stubs.getSessionV2 = async (workspaceId, sessionId) =>
    workspaceId === "workspace-legit" && sessionId === "session-legit" ? freshSession : null;

  const html = await renderHtml({ sessionId: "session-legit" });

  assert.ok(
    !html.includes(COMPOSER_HEADLINE),
    `a fresh, unread session must not render the real composer:\n${html}`,
  );
  // Not merely absent -- honestly explained, same as every other locked
  // section (WorkspaceShell.tsx's own "why locked" treatment).
  assert.ok(
    html.includes("Locked until you mark this passage as read."),
    "Observe should show its own why-locked notice in place of the composer",
  );
});

test("READGATE: once readGateAt is set, the same session's Observe section renders the real ClaimComposer", async () => {
  resetStubs();
  const readSession = sampleSession({
    currentStep: "observe",
    readGateAt: "2026-01-01T06:00:00.000Z",
  });
  stubs.getSessionV2 = async (workspaceId, sessionId) =>
    workspaceId === "workspace-legit" && sessionId === "session-legit" ? readSession : null;

  const html = await renderHtml({ sessionId: "session-legit" });

  assert.ok(html.includes(COMPOSER_HEADLINE), `the composer should render once the passage is marked read:\n${html}`);
  assert.ok(!html.includes("Locked until you mark this passage as read."));
});

// ===========================================================================
// MUTATION PROOF (acceptance criterion 6) — this section documents, in
// prose, the mutation that was actually run against this file locally to
// prove the two HOSTILE tests above have teeth. `page.tsx` is an owned path
// here (not read-only), so the proof was done directly against the source,
// not via a read-only-module compile hook:
//
//   Mutated `resolveStudyPageData` in page.tsx to trust a caller-supplied
//   workspace id when present:
//
//     const workspaceId = (deps as any).callerWorkspaceId ?? await deps.resolveWorkspaceId(userId);
//
//   and mutated the page component to pass `(await params as any).workspaceId`
//   through as `callerWorkspaceId` on the deps object handed to
//   `resolveStudyPageData`.
//
//   Result: "HOSTILE: an extra workspaceId smuggled into the route params is
//   ignored..." FAILED (`seen` recorded `[["workspace-victim","session-legit"]]`
//   instead of `[["workspace-legit","session-legit"]]`, and the composer
//   never rendered because `getSessionV2` had no "workspace-victim:session-legit"
//   entry). The mutation was then reverted and `npm test` confirmed green
//   again. See the task's final report for the verbatim before/after output.
// ===========================================================================
