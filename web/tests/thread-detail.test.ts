/**
 * CONNECTIONEXPLORER-001 -- `app/(app)/threads/[slug]/page.tsx` (workspace
 * resolution + auth guard) and `components/threads/ThreadDetail.tsx` (the
 * Connection Explorer: `selectConnectionsForThread`, `filterConnectionsByType`,
 * and the hookless `ConnectionsPanel`).
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

type Stubs = {
  auth: () => Promise<SessionLike>;
  listThreads: (userId: string) => Promise<unknown[]>;
  getOrCreatePersonalWorkspace: (userId: string) => Promise<string>;
};

const stubs: Stubs = {
  auth: async () => ({ user: { id: "owner-1" } }),
  listThreads: async () => [],
  getOrCreatePersonalWorkspace: async () => "workspace-legit",
};

function resetStubs() {
  stubs.auth = async () => ({ user: { id: "owner-1" } });
  stubs.listThreads = async () => [];
  stubs.getOrCreatePersonalWorkspace = async () => "workspace-legit";
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

// ---------------------------------------------------------------------------
// Load the REAL ThreadDetail module first (see header note 2) -- captures
// the pure helpers and the hookless panel this file tests directly.
// ---------------------------------------------------------------------------

const threadDetailModule = nodeRequire("@/components/threads/ThreadDetail.tsx") as {
  ConnectionsPanel: (props: {
    connections: UserConnection[];
    activeType: ConnectionType | null;
    onSelectType: (type: ConnectionType | null) => void;
  }) => unknown;
  selectConnectionsForThread: (
    connections: UserConnection[],
    params: { threadSlug: string; workspaceId: string },
  ) => UserConnection[];
  filterConnectionsByType: (
    connections: UserConnection[],
    type: ConnectionType | null,
  ) => UserConnection[];
};
const { ConnectionsPanel, selectConnectionsForThread, filterConnectionsByType } = threadDetailModule;

// ---------------------------------------------------------------------------
// Load the real page module. Its own `import { ThreadDetail } from
// "@/components/threads/ThreadDetail"` resolves to the same absolute path
// already cached above -- the real component, not a stub.
// ---------------------------------------------------------------------------

const pageModule = nodeRequire("@/app/(app)/threads/[slug]/page.tsx") as {
  default: (props: { params: Promise<{ slug: string }> }) => Promise<unknown>;
  resolveSessionState: typeof import("../app/(app)/threads/[slug]/page").resolveSessionState;
  resolveThreadWorkspace: typeof import("../app/(app)/threads/[slug]/page").resolveThreadWorkspace;
};
const { resolveSessionState, resolveThreadWorkspace } = pageModule;
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

test("ConnectionsPanel: an honest empty state when this thread has zero connections", () => {
  const tree = ConnectionsPanel({ connections: [], activeType: null, onSelectType: () => {} });
  assert.equal(byTestId(tree, "connections-empty").length, 1);
  assert.equal(byTestId(tree, "connections-list").length, 0);
  assert.equal(byTestId(tree, "connections-empty-filtered").length, 0);
});

test("ConnectionsPanel: a distinct empty state when the type filter excludes every real connection", () => {
  const tree = ConnectionsPanel({
    connections: [sampleConnection({ type: "quotation" })],
    activeType: "motif",
    onSelectType: () => {},
  });
  assert.equal(byTestId(tree, "connections-empty-filtered").length, 1);
  assert.equal(byTestId(tree, "connections-empty").length, 0, "must not claim there are NO connections at all -- there are, just none of this type");
});

test("ConnectionsPanel: the curated-connections notice renders honestly, in every state -- never a fabricated curated row (acceptance criterion 5)", () => {
  const empty = ConnectionsPanel({ connections: [], activeType: null, onSelectType: () => {} });
  const withRows = ConnectionsPanel({ connections: [sampleConnection()], activeType: null, onSelectType: () => {} });
  for (const tree of [empty, withRows]) {
    const notice = byTestId(tree, "connections-no-curated-notice");
    assert.equal(notice.length, 1);
  }
});

test("ConnectionsPanel: renders a filter chip for every CONNECTION_TYPES value plus All, wired to the active type", () => {
  const tree = ConnectionsPanel({ connections: [], activeType: "motif", onSelectType: () => {} });
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
  const tree = ConnectionsPanel({
    connections: [],
    activeType: null,
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
  const tree = ConnectionsPanel({ connections: [connection], activeType: null, onSelectType: () => {} });

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
  const tree = ConnectionsPanel({ connections: [connection], activeType: null, onSelectType: () => {} });

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
  const tree = ConnectionsPanel({ connections, activeType: "quotation", onSelectType: () => {} });
  const rows = byTestId(tree, "connection-row");
  assert.equal(rows.length, 2);
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
      const tree = ConnectionsPanel({ connections: [connection], activeType: null, onSelectType: () => {} });
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
  const emptyHtml = renderToStaticMarkup(
    ConnectionsPanel({ connections: [], activeType: null, onSelectType: () => {} }) as never,
  );
  const filteredHtml = renderToStaticMarkup(
    ConnectionsPanel({
      connections: [sampleConnection({ type: "quotation" })],
      activeType: "motif",
      onSelectType: () => {},
    }) as never,
  );
  for (const html of [emptyHtml, filteredHtml]) {
    assert.doesNotMatch(html, VERDICT_LANGUAGE, `verdict-language leak:\n${html}`);
  }
});
