/**
 * CONNECTIONEXPLORER-001 -- `app/(app)/threads/[slug]/page.tsx` (workspace
 * resolution + auth guard) and `components/threads/ThreadDetail.tsx` (the
 * Connection Explorer: `selectConnectionsForThread`, `filterConnectionsByType`,
 * and the hookless `ConnectionsPanel`).
 *
 * STAGEFILTER-001 -- extends both files with a second, composable filter
 * dimension: `resolveThreadStages` (page.tsx, parallel to
 * `resolveThreadWorkspace`) and `refKeyToChapterKey`/`stageSlugForRange`/
 * `filterConnectionsByStage`/`filterConnections` (ThreadDetail.tsx). Because
 * `resolveThreadStages`'s default deps now call the REAL `db.select().from(
 * stagesTable)` (page.tsx now statically imports `@/db/schema` and
 * `@/lib/db` for the first time), this file seeds fakes for both, following
 * `tests/climb-setup-state.test.ts`'s own precedent for the identical
 * `app/(app)/page.tsx` query -- a tiny chainable `{ select: () => ({ from:
 * () => stubs.getStages() }) }` stand-in, never a real Neon connection.
 *
 * TEST-ENVIRONMENT NOTE (same discipline as tests/study-page.test.ts,
 * tests/connect-pane.test.ts, and tests/review-setup-state.test.ts, all read
 * as precedent before writing this file): this repo's test script is
 * `tsx --test tests/*.test.ts` -- plain Node, no jsdom. Techniques used here,
 * all against REAL production modules, never a reimplementation:
 *
 *   1. `nodeRequire` + `require.cache` seeding loads the REAL
 *      `ThreadDetail.tsx` (and, transitively, `ClaimComposer.tsx`'s
 *      `optionsFrom`/`humanizeToken`, `components/ui/Chip.tsx`,
 *      `lib/bible/range.ts`), stubbing only the CSS Modules that chain
 *      touches, plus "fake-indexeddb/auto" so `lib/sync/store.ts`'s
 *      module-level `openDB(...)` call succeeds (`ThreadDetail.tsx` imports
 *      `listLocalV2Entities` from it).
 *   2. `ThreadDetail.tsx` is loaded ONCE, before the page module is
 *      required -- `app/(app)/threads/[slug]/page.tsx` imports
 *      `@/components/threads/ThreadDetail` itself (unstubbed), so requiring
 *      the page afterward reuses the SAME already-cached real module Node's
 *      `require.cache` now holds. No stub-swapping, no risk of the page
 *      silently getting a fake component.
 *   3. `ConnectionsPanel` is hookless (`ThreadDetail.tsx`'s own header
 *      comment), so it is called directly as a plain function to inspect
 *      the real returned element tree -- the exact technique
 *      `tests/claim-panes.test.ts` uses for `PromoteFields` and
 *      `tests/connect-pane.test.ts` uses for `EvidenceLabelField`.
 *   4. `react-dom/server`'s `renderToStaticMarkup` renders the real default-
 *      export `ThreadPage` to actual HTML for the auth-guard/workspace-
 *      resolution RENDER tests. `useEffect` never fires under SSR, so the
 *      real `ThreadDetail`'s data-loading effect never runs here -- its
 *      "Loading thread..." initial state is what these tests observe, which
 *      is sufficient to prove the real component mounted without a runtime
 *      crash. Verifying the RESOLVED VALUES (which userId resolves the
 *      workspace, which workspace a connection is scoped against) is done
 *      at the PURE-FUNCTION layer below instead (`resolveSessionState`,
 *      `resolveThreadWorkspace`, `selectConnectionsForThread`) -- the
 *      rendered-HTML layer cannot observe a prop value ThreadDetail never
 *      echoes into its initial markup, so it is not asked to.
 */
import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import type { CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Stage } from "@/lib/contracts";
import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import {
  CONNECTION_TYPES,
  EVIDENCE_LABELS,
  type ConnectionType,
  type EvidenceLabel,
  type UserConnection,
} from "@/lib/contracts/study-v2";

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
// as tests/study-page.test.ts / tests/connect-pane.test.ts.
const cssProxy = new Proxy(
  {},
  { get: (_target, key) => (typeof key === "string" ? key : undefined) },
);

seedModule("server-only", {});
seedModule("@/components/threads/thread-detail.module.css", { default: cssProxy });
seedModule("@/components/ui/Button.module.css", { default: cssProxy });
seedModule("@/components/ui/Chip.module.css", { default: cssProxy });
seedModule("@/components/ui/Field.module.css", { default: cssProxy });
seedModule("@/components/study/claim-composer.module.css", { default: cssProxy });

// ---------------------------------------------------------------------------
// Swappable stubs behind the page's data-access seam. The page captures its
// default dependencies at module load, so the indirection (not the function
// itself) is what gets seeded; each test rewrites `stubs.*` first.
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

// Fixture stages -- deliberately out of `.stage` order in the array itself,
// so any test relying on natural-order sorting actually exercises it rather
// than getting it for free from insertion order. Chapters chosen to line up
// with `sampleConnection`'s own fromRange/toRange starts below (Genesis
// 3:15 -> "1.3", John 3:16 -> "43.3") so the range-to-stage mapping tests
// have a real, non-coincidental match to assert against.
const genesisStage: Stage = {
  slug: "genesis-the-fall",
  title: "Genesis 3 — The Fall",
  stage: 1,
  side: "ascent",
  mirror: "john-the-gospel",
  chapters: ["1.1", "1.2", "1.3"],
  summary: "",
};

const exodusStage: Stage = {
  slug: "exodus-the-rescue",
  title: "Exodus 1–2 — The Rescue",
  stage: 2,
  side: "ascent",
  mirror: null,
  chapters: ["2.1", "2.2"],
  summary: "",
};

const johnStage: Stage = {
  slug: "john-the-gospel",
  title: "John 3 — The Gospel",
  stage: 7,
  side: "descent",
  mirror: "genesis-the-fall",
  chapters: ["43.3"],
  summary: "",
};

const threeStages: Stage[] = [johnStage, genesisStage, exodusStage];

type Stubs = {
  auth: () => Promise<SessionLike>;
  listThreads: (userId: string) => Promise<unknown[]>;
  getOrCreatePersonalWorkspace: (userId: string) => Promise<string>;
  getStages: () => Promise<Stage[]>;
};

const stubs: Stubs = {
  auth: async () => ({ user: { id: "owner-1" } }),
  listThreads: async () => [],
  getOrCreatePersonalWorkspace: async () => "workspace-legit",
  getStages: async () => threeStages,
};

function resetStubs() {
  stubs.auth = async () => ({ user: { id: "owner-1" } });
  stubs.listThreads = async () => [];
  stubs.getOrCreatePersonalWorkspace = async () => "workspace-legit";
  stubs.getStages = async () => threeStages;
}

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
// `app/(app)/threads/[slug]/page.tsx` now queries `stages` directly, the
// same way `app/(app)/page.tsx` does -- `db.select().from(stagesTable)`.
// Faked exactly like `tests/climb-setup-state.test.ts` fakes the identical
// call for that sibling page: `@/db/schema` need only supply a tagged
// placeholder for `stagesTable` (never consulted for identity, only passed
// through `.from()`), and `@/lib/db` need only supply a `db` whose
// `.select().from()` chain resolves to the stubbed rows -- never a real
// Neon connection.
seedModule("@/db/schema", { stages: { __tag: "stages-table" } });
seedModule("@/lib/db", {
  db: {
    select: () => ({
      from: () => stubs.getStages(),
    }),
  },
});

// ---------------------------------------------------------------------------
// Load the REAL ThreadDetail module first (see header note 2) -- captures
// the pure helpers and the hookless panel this file tests directly.
// ---------------------------------------------------------------------------

const threadDetailModule = nodeRequire("@/components/threads/ThreadDetail.tsx") as {
  ConnectionsPanel: (props: {
    connections: UserConnection[];
    stages: Stage[];
    activeType: ConnectionType | null;
    onSelectType: (type: ConnectionType | null) => void;
    activeStageSlug: string | null;
    onSelectStage: (stageSlug: string | null) => void;
  }) => unknown;
  selectConnectionsForThread: (
    connections: UserConnection[],
    params: { threadSlug: string; workspaceId: string },
  ) => UserConnection[];
  filterConnectionsByType: (
    connections: UserConnection[],
    type: ConnectionType | null,
  ) => UserConnection[];
  refKeyToChapterKey: (refKey: string) => string | null;
  stageSlugForRange: (range: CanonicalRangeV1, stages: Stage[]) => string | null;
  filterConnectionsByStage: (
    connections: UserConnection[],
    stageSlug: string | null,
    stages: Stage[],
  ) => UserConnection[];
  filterConnections: (
    connections: UserConnection[],
    filters: { type: ConnectionType | null; stageSlug: string | null },
    stages: Stage[],
  ) => UserConnection[];
};
const {
  ConnectionsPanel,
  selectConnectionsForThread,
  filterConnectionsByType,
  refKeyToChapterKey,
  stageSlugForRange,
  filterConnectionsByStage,
  filterConnections,
} = threadDetailModule;

// ---------------------------------------------------------------------------
// Load the real page module. Its own `import { ThreadDetail } from
// "@/components/threads/ThreadDetail"` resolves to the same absolute path
// already cached above -- the real component, not a stub.
// ---------------------------------------------------------------------------

const pageModule = nodeRequire("@/app/(app)/threads/[slug]/page.tsx") as {
  default: (props: { params: Promise<{ slug: string }> }) => Promise<unknown>;
  resolveSessionState: typeof import("../app/(app)/threads/[slug]/page").resolveSessionState;
  resolveThreadWorkspace: typeof import("../app/(app)/threads/[slug]/page").resolveThreadWorkspace;
  resolveThreadStages: typeof import("../app/(app)/threads/[slug]/page").resolveThreadStages;
};
const { resolveSessionState, resolveThreadWorkspace, resolveThreadStages } = pageModule;
const ThreadPage = pageModule.default;

/** Renders the real page component, or reports what it threw/signalled. */
async function renderPage(
  routeParams: Record<string, unknown>,
): Promise<
  | { kind: "html"; html: string }
  | { kind: "redirect"; url: string }
  | { kind: "not-found" }
> {
  try {
    const element = await ThreadPage({ params: Promise.resolve(routeParams) as never });
    return { kind: "html", html: renderToStaticMarkup(element as never) };
  } catch (error) {
    if (error instanceof RedirectSignal) return { kind: "redirect", url: error.url };
    if (error instanceof NotFoundSignal) return { kind: "not-found" };
    throw error;
  }
}

const thrower = (message: string) => async (): Promise<never> => {
  throw new Error(message);
};

const SETUP_HEADLINE = "Setup incomplete";

// ===========================================================================
// A. `resolveSessionState` -- pure, direct calls (mirrors
//    tests/study-page.test.ts's own test of the identical shape).
// ===========================================================================

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
  assert.deepEqual(
    await resolveSessionState({ getSession: thrower("adapter threw"), probeDatabase: async () => [] }),
    { status: "setup-incomplete" },
  );
});

// ===========================================================================
// B. `resolveThreadWorkspace` -- pure, direct calls (acceptance criterion 2).
// ===========================================================================

test("resolveThreadWorkspace resolves the caller's own workspace id", async () => {
  const resolution = await resolveThreadWorkspace("owner-1", {
    resolveWorkspaceId: async (userId) => `workspace-for-${userId}`,
  });
  assert.deepEqual(resolution, { status: "ready", workspaceId: "workspace-for-owner-1" });
});

test("resolveThreadWorkspace collapses a failed lookup to setup-incomplete, never a thrown error", async () => {
  const resolution = await resolveThreadWorkspace("owner-1", {
    resolveWorkspaceId: thrower("connect ECONNREFUSED 127.0.0.1:5432"),
  });
  assert.deepEqual(resolution, { status: "setup-incomplete" });
});

test("HOSTILE: resolveThreadWorkspace is called with the AUTHENTICATED caller's own id, never a smuggled one", async () => {
  const seenUserIds: string[] = [];
  await resolveThreadWorkspace("owner-42", {
    resolveWorkspaceId: async (userId) => {
      seenUserIds.push(userId);
      return "workspace-42";
    },
  });
  assert.deepEqual(seenUserIds, ["owner-42"]);
});

// ===========================================================================
// B2. `resolveThreadStages` -- pure, direct calls (STAGEFILTER-001,
//     acceptance criterion 1), same shape as `resolveThreadWorkspace` above
//     but with its own minimal deps type -- no `userId` involved.
// ===========================================================================

test("resolveThreadStages resolves the real stage rows unchanged", async () => {
  const resolution = await resolveThreadStages({ getStages: async () => threeStages });
  assert.deepEqual(resolution, { status: "ready", stages: threeStages });
});

test("resolveThreadStages collapses a failed lookup to setup-incomplete, never a thrown error", async () => {
  const resolution = await resolveThreadStages({
    getStages: thrower("connect ECONNREFUSED 127.0.0.1:5432"),
  });
  assert.deepEqual(resolution, { status: "setup-incomplete" });
});

// ===========================================================================
// C. RENDER -- the real page component's default export, auth guard and
//    workspace resolution (acceptance criteria 2).
// ===========================================================================

test("GUARD: no session with a healthy database redirects to /sign-in, never mounting ThreadDetail", async () => {
  resetStubs();
  stubs.auth = async () => null;
  stubs.listThreads = async () => [];

  const result = await renderPage({ slug: "seed-of-the-woman" });

  assert.equal(
    result.kind,
    "redirect",
    result.kind === "html" ? `the auth guard did not fire; the page rendered:\n${result.html}` : `got ${result.kind}`,
  );
  if (result.kind !== "redirect") return;
  assert.equal(result.url, "/sign-in");
});

test("GUARD: a session with a blank user id is treated as signed out, not as the owner", async () => {
  resetStubs();
  stubs.auth = async () => ({ user: { id: "" } });

  const result = await renderPage({ slug: "seed-of-the-woman" });

  assert.equal(result.kind, "redirect");
  if (result.kind !== "redirect") return;
  assert.equal(result.url, "/sign-in");
});

test("RENDER: a dead database during the session check renders setup-incomplete, not a sign-in redirect", async () => {
  resetStubs();
  stubs.auth = async () => null;
  stubs.listThreads = thrower("connect ECONNREFUSED 127.0.0.1:5432");

  const result = await renderPage({ slug: "seed-of-the-woman" });

  assert.equal(result.kind, "html", "a dead database redirected the owner to /sign-in");
  if (result.kind !== "html") return;
  assert.ok(result.html.includes(SETUP_HEADLINE));
});

test("RENDER: a workspace-lookup failure renders setup-incomplete", async () => {
  resetStubs();
  stubs.getOrCreatePersonalWorkspace = thrower("connect ECONNREFUSED 127.0.0.1:5432");

  const result = await renderPage({ slug: "seed-of-the-woman" });

  assert.equal(result.kind, "html");
  if (result.kind !== "html") return;
  assert.ok(result.html.includes(SETUP_HEADLINE));
});

test("RENDER: a stages-lookup failure ALSO renders setup-incomplete (STAGEFILTER-001) -- the workspace lookup succeeding is not enough on its own", async () => {
  resetStubs();
  stubs.getStages = thrower("connect ECONNREFUSED 127.0.0.1:5432");

  const result = await renderPage({ slug: "seed-of-the-woman" });

  assert.equal(result.kind, "html");
  if (result.kind !== "html") return;
  assert.ok(result.html.includes(SETUP_HEADLINE), `expected the setup-incomplete screen:\n${result.html}`);
});

test("NOT FOUND: a malformed slug never reaches the session check at all", async () => {
  resetStubs();
  stubs.auth = thrower("must not be called for a malformed slug");

  const result = await renderPage({ slug: "Not A Valid Slug!" });

  assert.equal(result.kind, "not-found");
});

test("RENDER: the authenticated happy path mounts the real ThreadDetail without a runtime crash", async () => {
  resetStubs();
  const result = await renderPage({ slug: "seed-of-the-woman" });

  assert.equal(
    result.kind,
    "html",
    result.kind === "redirect" ? `unexpectedly redirected to ${result.url}` : `got ${result.kind}`,
  );
  if (result.kind !== "html") return;
  // useEffect never fires under SSR (header note 4) -- this is ThreadDetail's
  // own initial "Loading thread..." state, proving it mounted at all.
  assert.ok(result.html.includes("Loading thread"), `ThreadDetail did not mount:\n${result.html}`);
});

test("HOSTILE: an extra slug/workspaceId key smuggled into route params changes nothing -- the session-derived workspace is what resolves", async () => {
  resetStubs();
  const seenUserIds: string[] = [];
  stubs.getOrCreatePersonalWorkspace = async (userId) => {
    seenUserIds.push(userId);
    return "workspace-legit";
  };

  // The page's own TypeScript type only names `slug`; nothing at runtime
  // stops a caller from crafting a params object with an extra key.
  const result = await renderPage({ slug: "seed-of-the-woman", workspaceId: "workspace-victim" });

  assert.equal(result.kind, "html");
  assert.deepEqual(seenUserIds, ["owner-1"], "the smuggled param must never reach workspace resolution");
});

// ===========================================================================
// D. `selectConnectionsForThread` -- pure logic (acceptance criterion 3).
// ===========================================================================

function sampleConnection(overrides: Partial<UserConnection> = {}): UserConnection {
  const fromRange: CanonicalRangeV1 = { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.15", end: "1.3.15" };
  const toRange: CanonicalRangeV1 = { versificationId: CANONICAL_VERSIFICATION_ID, start: "43.3.16", end: "43.3.16" };
  return {
    id: "conn-1",
    workspaceId: "workspace-legit",
    fromRange,
    toRange,
    type: "promise_fulfillment",
    evidenceLabel: "strong",
    rationale:
      "The crushing of the serpent's head reads to me as pointing forward to this verse, on my own comparison of the two texts.",
    threadSlug: "seed-of-the-woman",
    status: "draft",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

test("selectConnectionsForThread includes a connection matching both threadSlug and workspaceId", () => {
  const connection = sampleConnection();
  const result = selectConnectionsForThread([connection], {
    threadSlug: "seed-of-the-woman",
    workspaceId: "workspace-legit",
  });
  assert.deepEqual(result, [connection]);
});

test("selectConnectionsForThread excludes a connection belonging to a different thread", () => {
  const connection = sampleConnection({ threadSlug: "a-different-thread" });
  const result = selectConnectionsForThread([connection], {
    threadSlug: "seed-of-the-woman",
    workspaceId: "workspace-legit",
  });
  assert.deepEqual(result, []);
});

test("selectConnectionsForThread excludes a soft-deleted connection", () => {
  const connection = sampleConnection({ deletedAt: "2026-02-01T00:00:00.000Z" });
  const result = selectConnectionsForThread([connection], {
    threadSlug: "seed-of-the-woman",
    workspaceId: "workspace-legit",
  });
  assert.deepEqual(result, []);
});

test("MUTATION-TARGET criterion 3: selectConnectionsForThread excludes a same-threadSlug connection from ANOTHER workspace -- the cross-tenant leak this filter exists to prevent", () => {
  const legit = sampleConnection({ id: "conn-legit", workspaceId: "workspace-legit" });
  const victim = sampleConnection({ id: "conn-victim", workspaceId: "workspace-victim" });

  const result = selectConnectionsForThread([legit, victim], {
    threadSlug: "seed-of-the-woman",
    workspaceId: "workspace-legit",
  });

  assert.deepEqual(
    result.map((c) => c.id),
    ["conn-legit"],
    "a connection sharing this thread's slug but belonging to a different workspace must never appear",
  );
});

// ===========================================================================
// E. `filterConnectionsByType` -- pure logic (acceptance criterion 4).
// ===========================================================================

test("filterConnectionsByType(null) returns every connection unchanged", () => {
  const connections = [
    sampleConnection({ id: "a", type: "quotation" }),
    sampleConnection({ id: "b", type: "motif" }),
  ];
  assert.deepEqual(filterConnectionsByType(connections, null), connections);
});

test("MUTATION-TARGET criterion 4: filterConnectionsByType narrows to EXACTLY the selected type, nothing else", () => {
  const connections = [
    sampleConnection({ id: "a", type: "quotation" }),
    sampleConnection({ id: "b", type: "motif" }),
    sampleConnection({ id: "c", type: "quotation" }),
  ];
  const result = filterConnectionsByType(connections, "quotation");
  assert.deepEqual(
    result.map((c) => c.id),
    ["a", "c"],
    "must return only the connections whose type matches, in original order",
  );
});

// ===========================================================================
// E2. Stage filter -- pure logic (STAGEFILTER-001, acceptance criteria
//     2/4/5). `threeStages` (defined above, alongside the page-level stubs)
//     is reused here directly -- it is the SAME fixture the render tests use,
//     never a second hand-rolled set, and its chapters were chosen to line
//     up with `sampleConnection`'s own fromRange/toRange starts below.
// ===========================================================================

function range(start: string, end = start): CanonicalRangeV1 {
  return { versificationId: CANONICAL_VERSIFICATION_ID, start, end };
}

test("refKeyToChapterKey derives book.chapter from a book.chapter.verse key", () => {
  assert.equal(refKeyToChapterKey("19.23.4"), "19.23");
  assert.equal(refKeyToChapterKey("1.3.15"), "1.3");
});

test("refKeyToChapterKey returns null for a malformed key, never throwing", () => {
  assert.equal(refKeyToChapterKey("1.3"), null, "a chapter-only key is not a valid range boundary");
  assert.equal(refKeyToChapterKey("1.3.15.2"), null, "too many components");
  assert.equal(refKeyToChapterKey("not-a-key"), null);
  assert.equal(refKeyToChapterKey(""), null);
});

test("MUTATION-TARGET (range-to-stage lookup): stageSlugForRange maps a range's start to the STAGE THAT ACTUALLY COVERS ITS CHAPTER, not just the first stage in the array", () => {
  // `threeStages` is seeded out of `.stage` order (john, genesis, exodus) --
  // a mutant that returned `stages[0].slug` unconditionally would return
  // "john-the-gospel" here, not "genesis-the-fall", and this test would
  // catch it.
  assert.equal(stageSlugForRange(range("1.3.15"), threeStages), "genesis-the-fall");
  assert.equal(stageSlugForRange(range("43.3.16"), threeStages), "john-the-gospel");
  assert.equal(stageSlugForRange(range("2.1.5"), threeStages), "exodus-the-rescue");
});

test("stageSlugForRange returns null (not a crash) for a chapter no known stage covers", () => {
  assert.equal(stageSlugForRange(range("3.1.1"), threeStages), null);
});

test("stageSlugForRange returns null (not a crash) for a malformed range start", () => {
  assert.equal(stageSlugForRange(range("not-a-key"), threeStages), null);
});

test("filterConnectionsByStage(null) returns every connection unchanged -- the pre-STAGEFILTER-001 behaviour", () => {
  const connections = [sampleConnection({ id: "a" }), sampleConnection({ id: "b" })];
  assert.deepEqual(filterConnectionsByStage(connections, null, threeStages), connections);
});

test("MUTATION-TARGET (range-to-stage lookup, mapping decision): filterConnectionsByStage matches a connection whose FROM range is in the selected stage", () => {
  // sampleConnection()'s fromRange is "1.3.15" -> genesis-the-fall.
  const connection = sampleConnection({ id: "from-match" });
  const result = filterConnectionsByStage([connection], "genesis-the-fall", threeStages);
  assert.deepEqual(result.map((c) => c.id), ["from-match"]);
});

test("MUTATION-TARGET (mapping decision, EITHER endpoint): filterConnectionsByStage ALSO matches a connection whose TO range (not fromRange) is in the selected stage", () => {
  // sampleConnection()'s toRange is "43.3.16" -> john-the-gospel. If the
  // implementation only ever consulted fromRange, this would wrongly return
  // an empty list -- the exact regression this test exists to catch.
  const connection = sampleConnection({ id: "to-match" });
  const result = filterConnectionsByStage([connection], "john-the-gospel", threeStages);
  assert.deepEqual(
    result.map((c) => c.id),
    ["to-match"],
    "a connection whose TO range sits in the selected stage must not silently disappear",
  );
});

test("filterConnectionsByStage excludes a connection whose neither range end is in the selected stage", () => {
  const connection = sampleConnection({ id: "no-match" });
  // sampleConnection() never touches exodus-the-rescue (chapters 2.1/2.2).
  const result = filterConnectionsByStage([connection], "exodus-the-rescue", threeStages);
  assert.deepEqual(result, []);
});

test("UNMATCHED-STAGE HANDLING (acceptance criterion 5): a connection whose range matches NO known stage stays visible when no stage filter is active, but disappears under every specific stage filter", () => {
  const orphan = sampleConnection({
    id: "orphan",
    fromRange: range("3.1.1"),
    toRange: range("3.1.1"),
  });

  // Never silently vanishes from the unfiltered view.
  assert.deepEqual(filterConnectionsByStage([orphan], null, threeStages).map((c) => c.id), ["orphan"]);

  // Excluded from every real, specific stage filter -- it never matches a chip.
  for (const stage of threeStages) {
    assert.deepEqual(
      filterConnectionsByStage([orphan], stage.slug, threeStages),
      [],
      `an unmatched-stage connection must not appear under the "${stage.slug}" filter`,
    );
  }
});

test("MUTATION-TARGET (combined-filter composition): filterConnections composes ConnectionType AND stage -- a connection must satisfy BOTH, not either", () => {
  const genesisQuotation = sampleConnection({ id: "genesis-quotation", type: "quotation" }); // from: genesis, to: john
  const exodusQuotation = sampleConnection({
    id: "exodus-quotation",
    type: "quotation",
    fromRange: range("2.1.1"),
    toRange: range("2.1.1"),
  }); // from/to: exodus
  const genesisMotif = sampleConnection({ id: "genesis-motif", type: "motif" }); // from: genesis, to: john

  const result = filterConnections(
    [genesisQuotation, exodusQuotation, genesisMotif],
    { type: "quotation", stageSlug: "genesis-the-fall" },
    threeStages,
  );

  assert.deepEqual(
    result.map((c) => c.id),
    ["genesis-quotation"],
    "must return only the connection matching BOTH the type AND the stage filter -- an AND mutated into an OR would leak the other two",
  );
});

test("MUTATION-TARGET (combined-filter composition): filterConnections narrows by STAGE ALONE when no ConnectionType filter is active -- the stage filter must not be a no-op just because type is null", () => {
  const genesisConnection = sampleConnection({ id: "genesis" }); // from: genesis, to: john
  const exodusConnection = sampleConnection({
    id: "exodus",
    fromRange: range("2.1.1"),
    toRange: range("2.1.1"),
  });

  const result = filterConnections(
    [genesisConnection, exodusConnection],
    { type: null, stageSlug: "genesis-the-fall" },
    threeStages,
  );

  assert.deepEqual(
    result.map((c) => c.id),
    ["genesis"],
    "with no type filter active, the stage filter alone must still narrow the list",
  );
});

test("filterConnections(type: null, stageSlug: null) returns every connection unchanged -- ConnectionType-only filtering keeps working exactly as before this task", () => {
  const connections = [
    sampleConnection({ id: "a", type: "quotation" }),
    sampleConnection({ id: "b", type: "motif" }),
  ];
  assert.deepEqual(
    filterConnections(connections, { type: null, stageSlug: null }, threeStages),
    connections,
  );
  assert.deepEqual(
    filterConnections(connections, { type: "quotation", stageSlug: null }, threeStages),
    filterConnectionsByType(connections, "quotation"),
    "with no stage filter active, filterConnections must behave identically to the original filterConnectionsByType",
  );
});

// ===========================================================================
// F. `ConnectionsPanel` -- hookless, called directly (acceptance criteria
//    4, 5, 6, 7).
// ===========================================================================

type RElement = { type: unknown; key: unknown; props: Record<string, unknown> };

function isElement(node: unknown): node is RElement {
  return typeof node === "object" && node !== null && "props" in (node as object) && "type" in (node as object);
}

function findAll(node: unknown, predicate: (el: RElement) => boolean, out: RElement[] = []): RElement[] {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out);
    return out;
  }
  if (isElement(node)) {
    if (predicate(node)) out.push(node);
    const children = node.props?.children;
    if (children !== undefined) findAll(children, predicate, out);
  }
  return out;
}

function byTestId(tree: unknown, testId: string): RElement[] {
  return findAll(tree, (el) => el.props["data-testid"] === testId);
}

function byField(tree: unknown, field: string): RElement[] {
  return findAll(tree, (el) => el.props["data-field"] === field);
}

// ---------------------------------------------------------------------------
// STAGEFILTER-001 -- default `ConnectionsPanel` args for every test below
// that does not care about the stage filter itself (i.e. every test carried
// over unweakened from CONNECTIONEXPLORER-001/CRIMSONACCENT-001): `stages`
// defaults to the real fixture set, `activeStageSlug` defaults to `null`
// ("all stages", the pre-STAGEFILTER-001 behaviour), so those tests keep
// exercising the exact same effective filtering they did before this task.
// ---------------------------------------------------------------------------

type ConnectionsPanelArgs = Parameters<typeof ConnectionsPanel>[0];

function panel(overrides: Partial<ConnectionsPanelArgs> = {}): ReturnType<typeof ConnectionsPanel> {
  return ConnectionsPanel({
    connections: [],
    stages: threeStages,
    activeType: null,
    onSelectType: () => {},
    activeStageSlug: null,
    onSelectStage: () => {},
    ...overrides,
  });
}

test("ConnectionsPanel: an honest empty state when this thread has zero connections", () => {
  const tree = panel({ connections: [] });
  assert.equal(byTestId(tree, "connections-empty").length, 1);
  assert.equal(byTestId(tree, "connections-list").length, 0);
  assert.equal(byTestId(tree, "connections-empty-filtered").length, 0);
});

test("ConnectionsPanel: a distinct empty state when the type filter excludes every real connection", () => {
  const tree = panel({
    connections: [sampleConnection({ type: "quotation" })],
    activeType: "motif",
  });
  assert.equal(byTestId(tree, "connections-empty-filtered").length, 1);
  assert.equal(byTestId(tree, "connections-empty").length, 0, "must not claim there are NO connections at all -- there are, just none of this type");
});

test("ConnectionsPanel: the curated-connections notice renders honestly, in every state -- never a fabricated curated row (acceptance criterion 5)", () => {
  const empty = panel({ connections: [] });
  const withRows = panel({ connections: [sampleConnection()] });
  for (const tree of [empty, withRows]) {
    const notice = byTestId(tree, "connections-no-curated-notice");
    assert.equal(notice.length, 1);
  }
});

test("ConnectionsPanel: renders a filter chip for every CONNECTION_TYPES value plus All, wired to the active type", () => {
  const tree = panel({ connections: [], activeType: "motif" });
  const chips = findAll(tree, (el) => el.props["data-field"] === "connectionType");
  assert.equal(chips.length, CONNECTION_TYPES.length + 1, "one chip per CONNECTION_TYPES value, plus All");
  const values = chips.map((c) => c.props["data-value"]);
  assert.deepEqual(new Set(values), new Set(["all", ...CONNECTION_TYPES]));
  const motifChip = chips.find((c) => c.props["data-value"] === "motif");
  assert.equal(motifChip?.props["aria-pressed"], true);
  const allChip = chips.find((c) => c.props["data-value"] === "all");
  assert.equal(allChip?.props["aria-pressed"], false);
});

test("ConnectionsPanel: clicking a chip calls onSelectType with that chip's own type", () => {
  const seen: (ConnectionType | null)[] = [];
  const tree = panel({
    connections: [],
    onSelectType: (type) => seen.push(type),
  });
  const chips = findAll(tree, (el) => el.props["data-field"] === "connectionType");
  const motifChip = chips.find((c) => c.props["data-value"] === "motif");
  (motifChip?.props.onClick as () => void)?.();
  const allChip = chips.find((c) => c.props["data-value"] === "all");
  (allChip?.props.onClick as () => void)?.();
  assert.deepEqual(seen, ["motif", null]);
});

test("ConnectionsPanel: each visible row renders type, evidenceLabel, both ranges, and the rationale VERBATIM", () => {
  const connection = sampleConnection({
    type: "type_antitype",
    evidenceLabel: "explicit",
    rationale: "My own reasoning, unedited, exactly as I typed it into the Connect form.",
  });
  const tree = panel({ connections: [connection] });

  const rows = byTestId(tree, "connection-row");
  assert.equal(rows.length, 1);

  const typeField = byField(tree, "type");
  assert.equal(typeField.length, 1);
  assert.equal(typeField[0].props.children, "Type antitype");

  const evidenceField = byField(tree, "evidenceLabel");
  assert.equal(evidenceField.length, 1);
  assert.equal(evidenceField[0].props.children, "Explicit");

  const fromField = byField(tree, "fromRange");
  assert.equal(fromField[0].props.children, "1.3.15-1.3.15");
  const toField = byField(tree, "toRange");
  assert.equal(toField[0].props.children, "43.3.16-43.3.16");

  const rationaleField = byField(tree, "rationale");
  assert.equal(
    rationaleField[0].props.children,
    connection.rationale,
    "the rationale must reach the DOM verbatim -- no summarizing, no rewording",
  );
});

test("CRIMSONACCENT-001: a rendered connection row carries a visible --crimson accent, never on the rationale body text", () => {
  const connection = sampleConnection({
    rationale: "My own reasoning, unedited, exactly as I typed it into the Connect form.",
  });
  const tree = panel({ connections: [connection] });

  const rows = byTestId(tree, "connection-row");
  assert.equal(rows.length, 1);
  const rowStyle = rows[0].props.style as CSSProperties | undefined;
  assert.ok(rowStyle, "connection row must carry a style prop");
  assert.equal(
    rowStyle?.borderLeft,
    "3px solid var(--crimson)",
    `expected the row's own borderLeft to reference var(--crimson), got: ${JSON.stringify(rowStyle)}`,
  );

  // The rationale is the learner's own body text -- it must keep using
  // --page-ink (inherited from ConnectionsPanel's own panelStyle `color`),
  // never --crimson, which BUILD_PLAN reserves as an accent only.
  const rationaleField = byField(tree, "rationale");
  assert.equal(rationaleField.length, 1);
  const rationaleStyle = rationaleField[0].props.style as CSSProperties | undefined;
  assert.ok(
    rationaleStyle === undefined || !JSON.stringify(rationaleStyle).includes("--crimson"),
    `the rationale text must never reference --crimson for its own color, got: ${JSON.stringify(rationaleStyle)}`,
  );
});

test("ConnectionsPanel: only connections passing the active type filter are rendered as rows", () => {
  const connections = [
    sampleConnection({ id: "a", type: "quotation" }),
    sampleConnection({ id: "b", type: "motif" }),
    sampleConnection({ id: "c", type: "quotation" }),
  ];
  const tree = panel({ connections, activeType: "quotation" });
  const rows = byTestId(tree, "connection-row");
  assert.equal(rows.length, 2);
});

// ===========================================================================
// F2. ConnectionsPanel's stage filter chips (STAGEFILTER-001, acceptance
//     criterion 3) -- same interaction pattern as the ConnectionType chips
//     tested above, consistent placement (same panel, second `role="group"`
//     row), options derived from the real `stages` prop.
// ===========================================================================

test("ConnectionsPanel: renders one stage chip per stage passed down, plus 'All stages', in NATURAL STAGE ORDER (never array/insertion order)", () => {
  // threeStages is seeded [john(7), genesis(1), exodus(2)] -- natural order
  // by the `stage` field is genesis(1), exodus(2), john(7).
  const tree = panel({ connections: [], stages: threeStages });
  const chips = findAll(tree, (el) => el.props["data-field"] === "connectionStage");
  assert.equal(chips.length, threeStages.length + 1, "one chip per stage, plus All stages");
  const values = chips.map((c) => c.props["data-value"]);
  assert.deepEqual(
    values,
    ["all", "genesis-the-fall", "exodus-the-rescue", "john-the-gospel"],
    "stage chips must render in ascending `.stage` order, regardless of the order `stages` arrived in",
  );
});

test("ConnectionsPanel: a stage chip's label is the real stage's own title, never a hand-typed list", () => {
  const tree = panel({ connections: [], stages: threeStages });
  const chips = findAll(tree, (el) => el.props["data-field"] === "connectionStage");
  const genesisChip = chips.find((c) => c.props["data-value"] === "genesis-the-fall");
  assert.equal(genesisChip?.props.children, "Genesis 3 — The Fall");
});

test("ConnectionsPanel: the active stage chip is wired to activeStageSlug, same pattern as ConnectionType", () => {
  const tree = panel({ connections: [], stages: threeStages, activeStageSlug: "exodus-the-rescue" });
  const chips = findAll(tree, (el) => el.props["data-field"] === "connectionStage");
  const exodusChip = chips.find((c) => c.props["data-value"] === "exodus-the-rescue");
  assert.equal(exodusChip?.props["aria-pressed"], true);
  const allChip = chips.find((c) => c.props["data-value"] === "all");
  assert.equal(allChip?.props["aria-pressed"], false);
});

test("ConnectionsPanel: clicking a stage chip calls onSelectStage with that chip's own slug", () => {
  const seen: (string | null)[] = [];
  const tree = panel({ connections: [], stages: threeStages, onSelectStage: (slug) => seen.push(slug) });
  const chips = findAll(tree, (el) => el.props["data-field"] === "connectionStage");
  const exodusChip = chips.find((c) => c.props["data-value"] === "exodus-the-rescue");
  (exodusChip?.props.onClick as () => void)?.();
  const allChip = chips.find((c) => c.props["data-value"] === "all");
  (allChip?.props.onClick as () => void)?.();
  assert.deepEqual(seen, ["exodus-the-rescue", null]);
});

test("ConnectionsPanel: the two filters COMPOSE -- only rows passing BOTH the active type and the active stage are rendered", () => {
  const genesisQuotation = sampleConnection({ id: "genesis-quotation", type: "quotation" }); // genesis/john
  const exodusQuotation = sampleConnection({
    id: "exodus-quotation",
    type: "quotation",
    fromRange: { versificationId: CANONICAL_VERSIFICATION_ID, start: "2.1.1", end: "2.1.1" },
    toRange: { versificationId: CANONICAL_VERSIFICATION_ID, start: "2.1.1", end: "2.1.1" },
  });
  const genesisMotif = sampleConnection({ id: "genesis-motif", type: "motif" }); // genesis/john

  const tree = panel({
    connections: [genesisQuotation, exodusQuotation, genesisMotif],
    stages: threeStages,
    activeType: "quotation",
    activeStageSlug: "genesis-the-fall",
  });

  const rows = byTestId(tree, "connection-row");
  assert.equal(rows.length, 1, "only the connection matching BOTH filters may render");
});

test("ConnectionsPanel: ConnectionType-only filtering (no stage filter active) still narrows the list exactly as it did before STAGEFILTER-001", () => {
  const connections = [
    sampleConnection({ id: "a", type: "quotation" }),
    sampleConnection({ id: "b", type: "motif" }),
    sampleConnection({ id: "c", type: "quotation" }),
  ];
  const tree = panel({ connections, activeType: "quotation", activeStageSlug: null });
  const rows = byTestId(tree, "connection-row");
  assert.equal(rows.length, 2, "activeStageSlug: null must never additionally narrow the type-only filter");
});

// ===========================================================================
// G. ASSERTION-LINE (acceptance criterion 7, docs/decisions/
//    2026-08-18-teaching-not-theology.md) -- in the style of
//    tests/claim-panes.test.ts's own ASSERTION-LINE test: no rendered copy,
//    across every ConnectionType/EvidenceLabel combination, asserts a
//    passage's meaning as fact. Only the learner's own rationale reaches the
//    DOM as prose.
// ===========================================================================

const VERDICT_LANGUAGE = /this passage means|the correct (view|interpretation)|this proves|teaches that/i;

test("ASSERTION-LINE: no ConnectionsPanel copy asserts a passage's meaning as fact, for any type/evidence-label combination", () => {
  const rationale = "I noticed this myself comparing the two passages side by side.";
  for (const type of CONNECTION_TYPES as readonly ConnectionType[]) {
    for (const evidenceLabel of EVIDENCE_LABELS as readonly EvidenceLabel[]) {
      const connection = sampleConnection({ id: `${type}-${evidenceLabel}`, type, evidenceLabel, rationale });
      const tree = panel({ connections: [connection] });
      const html = renderToStaticMarkup(tree as never);
      assert.doesNotMatch(
        html,
        VERDICT_LANGUAGE,
        `verdict-language leak for type=${type} evidenceLabel=${evidenceLabel}:\n${html}`,
      );
      assert.ok(html.includes(rationale), `the learner's own rationale did not reach the DOM verbatim for type=${type}:\n${html}`);
    }
  }
});

test("ASSERTION-LINE: the empty and filtered-empty states never assert a passage's meaning either", () => {
  const emptyHtml = renderToStaticMarkup(panel({ connections: [] }) as never);
  const filteredHtml = renderToStaticMarkup(
    panel({
      connections: [sampleConnection({ type: "quotation" })],
      activeType: "motif",
    }) as never,
  );
  for (const html of [emptyHtml, filteredHtml]) {
    assert.doesNotMatch(html, VERDICT_LANGUAGE, `verdict-language leak:\n${html}`);
  }
});
