/**
 * CLIMB-001 (Gate 0.2) — the Climb home ("/") must get Mountain data and
 * review counts from the authenticated DB path, require a signed-in
 * session, and distinguish "the database is unreachable" from "this
 * account genuinely has nothing yet."
 *
 * Two layers are tested here, deliberately, following
 * tests/review-setup-state.test.ts's own reasoning:
 *
 *  1. `loadClimbViewModel` / `resolveSessionState` — the pure discriminators.
 *  2. The RENDERED OUTPUT of the real default-export `ClimbPage`, piped
 *     through `react-dom/server`. Layer 1 alone would be vacuous against the
 *     acceptance criteria: it is possible to return the right *tag* from a
 *     helper while the JSX still renders indistinguishable markup for both
 *     branches. Every claim about what the reader actually sees is asserted
 *     against real HTML.
 *
 * `page.tsx` statically imports `server-only`-guarded modules
 * (`@/lib/auth/config`, `@/lib/db/entries`, `@/lib/db/threads`, `@/lib/db`),
 * `next/navigation`, `@/db/schema`, and the client component `Mountain`
 * (which itself imports `next/navigation`). None of those load under plain
 * `node:test`: `server-only` throws unconditionally outside a bundler, and
 * `@/lib/db` opens a real Neon driver. All of them are neutralised in
 * `require.cache` before the page module loads, mirroring
 * tests/review-setup-state.test.ts and tests/tenant-isolation.test.ts's
 * treatment of the same guard.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Entry, Stage } from "@/lib/contracts";

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
// Swappable stubs behind the seeded modules. The page captures its default
// dependencies at module load, so the indirection (not the function itself)
// is what gets seeded; each test rewrites `stubs.*` before rendering.
// ---------------------------------------------------------------------------

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT:${url}`);
    this.name = "RedirectSignal";
  }
}

type SessionLike = { user?: { id?: string | null } | null } | null;

const genesis: Stage = {
  slug: "genesis-the-beginning",
  title: "Genesis 1–11 — The Beginning",
  stage: 1,
  side: "ascent",
  mirror: "revelation-the-ending",
  chapters: ["1.1"],
  summary: "",
};

const revelation: Stage = {
  slug: "revelation-the-ending",
  title: "Revelation 21–22 — The Ending",
  stage: 11,
  side: "descent",
  mirror: "genesis-the-beginning",
  chapters: ["66.21"],
  summary: "",
};

const twoStages: Stage[] = [genesis, revelation];

function entry(overrides: Partial<Entry>): Entry {
  return {
    id: "e-1",
    kind: "observation",
    body: "A note.",
    chapter: "1.1",
    threads: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

type Stubs = {
  auth: () => Promise<SessionLike>;
  getStages: () => Promise<Stage[]>;
  listEntries: (userId: string, filters: unknown) => Promise<Entry[]>;
  listThreads: (userId: string) => Promise<{ slug: string }[]>;
  dbSelectStages: () => Promise<Stage[]>;
};

const stubs: Stubs = {
  auth: async () => ({ user: { id: "owner-1" } }),
  getStages: async () => twoStages,
  listEntries: async () => [],
  listThreads: async () => [],
  dbSelectStages: async () => twoStages,
};

function resetStubs() {
  stubs.auth = async () => ({ user: { id: "owner-1" } });
  stubs.getStages = async () => twoStages;
  stubs.listEntries = async () => [];
  stubs.listThreads = async () => [];
  stubs.dbSelectStages = async () => twoStages;
}

// CSS Modules resolve every requested class to its own name. ClimbHero.tsx
// (kept exactly as-is; it is not in this task's ownedPaths) statically
// imports its own module CSS, which plain node:test cannot parse.
const cssProxy = new Proxy(
  {},
  {
    get: (_target, key) => (typeof key === "string" ? key : undefined),
  },
);

seedModule("server-only", {});
seedModule("@/components/climb/ClimbHero.module.css", { default: cssProxy });
seedModule("next/navigation", {
  redirect: (url: string): never => {
    throw new RedirectSignal(url);
  },
});
seedModule("@/db/schema", { stages: { __tag: "stages-table" } });
// `db.select().from(stagesTable)` — a tiny chainable fake standing in for
// the real Neon-backed drizzle query builder.
seedModule("@/lib/db", {
  db: {
    select: () => ({
      from: () => stubs.dbSelectStages(),
    }),
  },
});
seedModule("@/lib/auth/config", { auth: () => stubs.auth() });
seedModule("@/lib/db/entries", {
  listEntries: (userId: string, filters: unknown) => stubs.listEntries(userId, filters),
});
seedModule("@/lib/db/threads", {
  listThreads: (userId: string) => stubs.listThreads(userId),
});
// Mountain.tsx is a real Client Component that imports `next/navigation`'s
// `useRouter` (already seeded above) and its own CSS module; stub it to a
// simple marker element so this test exercises the real ClimbPage wiring
// (props, branch selection) without also needing a browser-router shim.
seedModule("@/components/climb/Mountain", {
  Mountain: ({ stages }: { stages: { slug: string }[] }) =>
    createElement(
      "div",
      { "data-testid": "mountain", "data-stage-count": stages.length },
      stages.map((stage) => createElement("span", { key: stage.slug }, stage.slug)),
    ),
});

const pageModule = nodeRequire("@/app/(app)/page.tsx") as {
  default: typeof import("../app/(app)/page").default;
  loadClimbViewModel: typeof import("../app/(app)/page").loadClimbViewModel;
  resolveSessionState: typeof import("../app/(app)/page").resolveSessionState;
};

const { loadClimbViewModel, resolveSessionState } = pageModule;
const ClimbPage = pageModule.default;

/** Renders the real page component to HTML, or reports the redirect it threw. */
async function renderPage(): Promise<
  { kind: "html"; html: string } | { kind: "redirect"; url: string }
> {
  try {
    const element = await ClimbPage();
    return { kind: "html", html: renderToStaticMarkup(element as never) };
  } catch (error) {
    if (error instanceof RedirectSignal) return { kind: "redirect", url: error.url };
    throw error;
  }
}

async function renderHtml(): Promise<string> {
  const result = await renderPage();
  assert.equal(result.kind, "html", `expected HTML, got redirect to ${(result as { url?: string }).url}`);
  return (result as { kind: "html"; html: string }).html;
}

const thrower = (message: string) => async (): Promise<never> => {
  throw new Error(message);
};

// Strings the reader actually sees. Kept as named constants so a copy change
// that erases the distinction cannot silently pass.
const SETUP_HEADLINE = "Setup incomplete";
const CLIMB_HEADLINE = "The Mountain";
const SETUP_NOTICE_HOOK = 'data-testid="setup-notice"';
const MOUNTAIN_HOOK = 'data-testid="mountain"';

// ===========================================================================
// FINDING 1 — rendering. Both branches must be distinguishable in the HTML a
// reader receives, not merely in the view model's tag.
// ===========================================================================

test("RENDER: an unreachable database renders the setup-incomplete screen, not the mountain", async () => {
  resetStubs();
  stubs.dbSelectStages = thrower("connect ECONNREFUSED 127.0.0.1:5432");

  const html = await renderHtml();

  assert.ok(html.includes(SETUP_HEADLINE), `setup headline missing from rendered output:\n${html}`);
  assert.ok(html.includes(SETUP_NOTICE_HOOK), `setup notice element missing:\n${html}`);
  assert.ok(html.includes("not an empty account"), `setup notice copy missing:\n${html}`);
  // It must NOT look like an ordinary (possibly empty) account.
  assert.ok(!html.includes(CLIMB_HEADLINE), `setup screen reused the Climb Hero headline:\n${html}`);
  assert.ok(!html.includes(MOUNTAIN_HOOK), `setup screen rendered the mountain:\n${html}`);
});

test("RENDER: a genuinely empty account renders the ordinary Climb Hero and mountain, not setup-incomplete", async () => {
  resetStubs();
  // A genuinely empty account: no entries, no threads. Stages are seeded
  // global content, unaffected by the account's own emptiness.
  stubs.listEntries = async () => [];
  stubs.listThreads = async () => [];

  const html = await renderHtml();

  assert.ok(html.includes(CLIMB_HEADLINE), `Climb Hero headline missing:\n${html}`);
  assert.ok(html.includes(MOUNTAIN_HOOK), `mountain missing from an empty account:\n${html}`);
  assert.ok(html.includes('data-stage-count="2"'), `mountain did not receive the seeded stages:\n${html}`);
  // It must NOT be mislabelled as a configuration problem.
  assert.ok(!html.includes(SETUP_HEADLINE), `empty account was labelled as a setup failure:\n${html}`);
  assert.ok(!html.includes(SETUP_NOTICE_HOOK), `empty account rendered the setup notice:\n${html}`);
});

test("RENDER: the setup-incomplete screen and an empty account produce different markup", async () => {
  resetStubs();
  const emptyAccountHtml = await renderHtml();

  resetStubs();
  stubs.listEntries = thrower("missing DATABASE_URL");
  const setupHtml = await renderHtml();

  assert.notEqual(
    setupHtml,
    emptyAccountHtml,
    "a setup failure rendered byte-identical markup to a genuinely empty account",
  );
  assert.ok(setupHtml.includes(SETUP_HEADLINE) && !emptyAccountHtml.includes(SETUP_HEADLINE));
  assert.ok(emptyAccountHtml.includes(MOUNTAIN_HOOK) && !setupHtml.includes(MOUNTAIN_HOOK));
});

// ===========================================================================
// This is the mutation-proof pair for the finding above: the setup-incomplete
// branch is deliberately made to render the empty-account markup instead, and
// a NAMED test must fail. See the builder's report for the paste of both
// runs (mutated red, restored green) — kept here as the test that proves it,
// not the mutation itself (the mutation is not committed).
// ===========================================================================

// ===========================================================================
// FINDING 2 — a dead database must not be reported as "signed out".
// ===========================================================================

test("RENDER: a null session caused by an unreachable database says setup incomplete, not signed out", async () => {
  resetStubs();
  // Exactly the production shape: next-auth swallows the adapter error and
  // hands back `null`, which is indistinguishable from a signed-out visitor
  // until the database is asked directly.
  stubs.auth = async () => null;
  stubs.listThreads = thrower("connect ECONNREFUSED 127.0.0.1:5432");

  const result = await renderPage();

  assert.equal(result.kind, "html", "a dead database redirected the owner to /sign-in");
  if (result.kind !== "html") return;
  assert.ok(result.html.includes(SETUP_HEADLINE), `setup headline missing:\n${result.html}`);
  assert.ok(
    result.html.includes("You have not been signed out"),
    `the reader was not told they are still signed in:\n${result.html}`,
  );
});

test("RENDER: auth() throwing outright also renders setup incomplete, not a signed-out redirect", async () => {
  resetStubs();
  stubs.auth = thrower("AdapterError: getSessionAndUser failed");

  const result = await renderPage();

  assert.equal(result.kind, "html");
  if (result.kind !== "html") return;
  assert.ok(result.html.includes(SETUP_HEADLINE));
});

test("resolveSessionState separates authenticated, signed-out, and setup-incomplete", async () => {
  assert.deepEqual(
    await resolveSessionState({
      getSession: async () => ({ user: { id: "owner-1" } }),
      probeDatabase: async () => [],
    }),
    { status: "authenticated", userId: "owner-1" },
  );

  assert.deepEqual(
    await resolveSessionState({
      getSession: async () => null,
      probeDatabase: async () => [],
    }),
    { status: "signed-out" },
  );

  assert.deepEqual(
    await resolveSessionState({
      getSession: async () => null,
      probeDatabase: thrower("connect ECONNREFUSED 127.0.0.1:5432"),
    }),
    { status: "setup-incomplete" },
  );

  assert.deepEqual(
    await resolveSessionState({
      getSession: thrower("AdapterError"),
      probeDatabase: async () => [],
    }),
    { status: "setup-incomplete" },
  );

  // A session row that exists but was blanked by the allowlist callback is not
  // an authenticated user.
  assert.deepEqual(
    await resolveSessionState({
      getSession: async () => ({ user: { id: "" } }),
      probeDatabase: async () => [],
    }),
    { status: "signed-out" },
  );
});

// ===========================================================================
// FINDING 3 — the auth guard. Deleting it must break a named test.
// ===========================================================================

test("GUARD: no session with a healthy database redirects to /sign-in and renders no mountain content", async () => {
  resetStubs();
  stubs.auth = async () => null;
  // Database is fine — so this really is a signed-out visitor.
  stubs.listThreads = async () => [];
  // If the guard is removed the page falls through to these, which must
  // never be reached, and the assertions below catch the rendered output.
  stubs.dbSelectStages = async () => twoStages;

  const result = await renderPage();

  assert.equal(
    result.kind,
    "redirect",
    result.kind === "html"
      ? `the auth guard did not fire; the page rendered:\n${result.html}`
      : "expected a redirect",
  );
  if (result.kind !== "redirect") return;
  assert.equal(result.url, "/sign-in");
});

test("GUARD: a session with a blank user id is treated as signed out, not as the owner", async () => {
  resetStubs();
  stubs.auth = async () => ({ user: { id: "" } });

  const result = await renderPage();

  assert.equal(
    result.kind,
    "redirect",
    result.kind === "html"
      ? `a blank user id rendered the mountain:\n${result.html}`
      : "expected a redirect",
  );
  if (result.kind !== "redirect") return;
  assert.equal(result.url, "/sign-in");
});

test("GUARD: the authenticated owner's id is the one passed to every DB read", async () => {
  resetStubs();
  const seen: string[] = [];
  stubs.auth = async () => ({ user: { id: "owner-42" } });
  stubs.listEntries = async (userId: string) => {
    seen.push(`entries:${userId}`);
    return [];
  };
  stubs.listThreads = async (userId: string) => {
    seen.push(`threads:${userId}`);
    return [];
  };

  await renderHtml();

  assert.deepEqual(seen.sort(), ["entries:owner-42", "threads:owner-42"]);
});

// ===========================================================================
// View-model coverage — the pure discriminator, independent of rendering.
// ===========================================================================

test("a DB read failure renders setup-incomplete, not a JSON-shaped hole", async () => {
  const view = await loadClimbViewModel("user-1", {
    getStages: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
    },
    getEntries: async () => [],
    getThreadCount: async () => 0,
  });

  assert.equal(view.status, "setup-incomplete");
});

test("a missing DATABASE_URL-style failure on any one dependency also renders setup-incomplete", async () => {
  const view = await loadClimbViewModel("user-1", {
    getStages: async () => twoStages,
    getEntries: async () => {
      throw new Error("missing DATABASE_URL");
    },
    getThreadCount: async () => 0,
  });

  assert.equal(view.status, "setup-incomplete");
});

test("a genuinely empty account is NOT setup-incomplete: it renders the ordinary zero-count data", async () => {
  const view = await loadClimbViewModel("user-1", {
    getStages: async () => twoStages,
    getEntries: async () => [],
    getThreadCount: async () => 0,
  });

  assert.equal(view.status, "ok");
  if (view.status !== "ok") return;
  assert.equal(view.data.stagesWithWork, 0);
  assert.equal(view.data.totalStages, 2);
  assert.equal(view.data.threadCount, 0);
  assert.equal(view.data.openQuestions, 0);
  assert.deepEqual(
    view.data.stages.map((stage) => stage.slug),
    ["genesis-the-beginning", "revelation-the-ending"],
  );
  assert.equal(view.data.stages[0].observationCount, 0);
  assert.equal(view.data.stages[0].questionCount, 0);
});

test("a populated account aggregates observation/question/thread counts per stage from real entries", async () => {
  const entries: Entry[] = [
    entry({ id: "e-1", kind: "observation", chapter: "1.1", threads: ["thread-a"] }),
    entry({ id: "e-2", kind: "observation", chapter: "1.1", threads: ["thread-b"] }),
    entry({ id: "e-3", kind: "question", chapter: "1.1", threads: ["thread-a"], answeredAt: null }),
    entry({ id: "e-4", kind: "question", chapter: "1.1", threads: [], answeredAt: "2026-01-02T00:00:00.000Z" }),
    entry({ id: "e-5", kind: "observation", chapter: "66.21", threads: [] }),
  ];

  const view = await loadClimbViewModel("user-1", {
    getStages: async () => twoStages,
    getEntries: async () => entries,
    getThreadCount: async () => 2,
  });

  assert.equal(view.status, "ok");
  if (view.status !== "ok") return;

  const [firstStage, secondStage] = view.data.stages;
  assert.equal(firstStage.slug, "genesis-the-beginning");
  assert.equal(firstStage.observationCount, 2);
  // e-4 is answered, so it must NOT count as open.
  assert.equal(firstStage.questionCount, 1);
  assert.equal(firstStage.threadCount, 2);
  assert.equal(firstStage.studied, true);

  assert.equal(secondStage.slug, "revelation-the-ending");
  assert.equal(secondStage.observationCount, 1);
  assert.equal(secondStage.questionCount, 0);
  assert.equal(secondStage.threadCount, 0);

  // stagesWithWork counts stages with at least one observation; openQuestions
  // sums each stage's own (unanswered-only) count.
  assert.equal(view.data.stagesWithWork, 2);
  assert.equal(view.data.openQuestions, 1);
  assert.equal(view.data.threadCount, 2);
});

test("an entry anchored to a chapter no stage opens with is silently excluded, not miscounted", async () => {
  const entries: Entry[] = [entry({ id: "e-orphan", kind: "observation", chapter: "40.1", threads: [] })];

  const view = await loadClimbViewModel("user-1", {
    getStages: async () => twoStages,
    getEntries: async () => entries,
    getThreadCount: async () => 0,
  });

  assert.equal(view.status, "ok");
  if (view.status !== "ok") return;
  assert.equal(view.data.stagesWithWork, 0);
  assert.equal(view.data.stages.every((stage) => stage.observationCount === 0), true);
});

test("stage titles split into reference/short label the same way the seed bridge did", async () => {
  const view = await loadClimbViewModel("user-1", {
    getStages: async () => twoStages,
    getEntries: async () => [],
    getThreadCount: async () => 0,
  });

  assert.equal(view.status, "ok");
  if (view.status !== "ok") return;
  assert.deepEqual(
    view.data.stages.map((stage) => [stage.reference, stage.short]),
    [
      ["Genesis 1–11", "The Beginning"],
      ["Revelation 21–22", "The Ending"],
    ],
  );
});
