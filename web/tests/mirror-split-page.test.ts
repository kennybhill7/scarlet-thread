/**
 * MIRRORSPLIT-001 — app/(app)/mirror/[stageSlug]/page.tsx: auth gating,
 * slug validation, and every honest non-happy-path branch
 * (not-found / no-mirror / broken-mirror / no-opening-chapter), plus the
 * happy path handing the right two stages to MirrorSplitView.
 *
 * TEST-ENVIRONMENT NOTE (same discipline as tests/climb-setup-state.test.ts
 * and tests/thread-detail.test.ts, both read as precedent before writing
 * this file): this repo's test script is `tsx --test tests/*.test.ts` —
 * plain Node, no jsdom. `nodeRequire` + `require.cache` seeding loads the
 * REAL `page.tsx`, stubbing only:
 *   - `next/navigation`'s `redirect`/`notFound` (captured via a thrown
 *     signal)
 *   - `@/db/schema`, `@/lib/db` (the `db.select().from(stagesTable)` seam)
 *   - `@/lib/auth/config`, `@/lib/db/threads` (the auth seam)
 *   - `@/components/mirror/MirrorSplitView` — stubbed to a marker element
 *     that records its props, the SAME technique
 *     tests/climb-setup-state.test.ts uses for `@/components/climb/Mountain`
 *     (a real Client Component with its own heavy module graph —
 *     ChapterReader.tsx, its CSS Module, lib/bible/*, lib/bible/lastRead —
 *     that this file has no reason to re-exercise; MirrorSplitView's own
 *     reuse of ChapterReader.tsx's VerseColumn is a manual/visual check,
 *     the same disclosed residual gap tests/verse-selection.test.ts's own
 *     header documents for the rest of this codebase's DOM-free test
 *     environment). This file's job is "did the page resolve and pass the
 *     right two stages," not "does VerseColumn render Scripture correctly"
 *     — that is already covered where VerseColumn is defined.
 *
 * Two layers are tested, matching this route group's established habit:
 *   1. `resolveSessionState` / `resolveMirrorStages` — the pure
 *      discriminators, called directly with fake deps.
 *   2. The RENDERED OUTPUT of the real default-export `MirrorPage`, via
 *      `react-dom/server`, so every claim about what the reader sees is
 *      checked against actual HTML.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Stage } from "@/lib/contracts";

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

function stage(overrides: Partial<Stage> & Pick<Stage, "slug" | "stage">): Stage {
  return {
    title: `Stage ${overrides.stage}`,
    side: "ascent",
    mirror: null,
    chapters: ["1.1"],
    summary: "",
    ...overrides,
  };
}

const genesis = stage({
  slug: "gen-03-05-sin-enters",
  title: "Genesis 3–5 — Satan and Sin Enter",
  stage: 2,
  side: "ascent",
  mirror: "rev-20-satan-cast-out",
  chapters: ["1.3"],
});

const revelation = stage({
  slug: "rev-20-satan-cast-out",
  title: "Revelation 20 — Satan and Sin Exit",
  stage: 10,
  side: "descent",
  mirror: "gen-03-05-sin-enters",
  chapters: ["66.20"],
});

const gospels = stage({
  slug: "gospels-jesus-christ",
  title: "The Gospels — Jesus Christ (God)",
  stage: 6,
  side: "peak",
  mirror: null,
  chapters: ["40.1"],
});

const brokenMirror = stage({
  slug: "broken-stage",
  title: "Broken Stage",
  stage: 12,
  mirror: "does-not-exist",
  chapters: ["1.1"],
});

const noChapterStage = stage({
  slug: "no-chapter-stage",
  title: "No Chapter Stage",
  stage: 13,
  mirror: "gen-03-05-sin-enters",
  chapters: [],
});

const allStages: Stage[] = [genesis, revelation, gospels, brokenMirror, noChapterStage];

type Stubs = {
  auth: () => Promise<SessionLike>;
  listThreads: (userId: string) => Promise<unknown[]>;
  dbSelectStages: () => Promise<Stage[]>;
};

const stubs: Stubs = {
  auth: async () => ({ user: { id: "owner-1" } }),
  listThreads: async () => [],
  dbSelectStages: async () => allStages,
};

function resetStubs() {
  stubs.auth = async () => ({ user: { id: "owner-1" } });
  stubs.listThreads = async () => [];
  stubs.dbSelectStages = async () => allStages;
}

const thrower = (message: string) => async (): Promise<never> => {
  throw new Error(message);
};

seedModule("next/navigation", {
  redirect: (url: string): never => {
    throw new RedirectSignal(url);
  },
  notFound: (): never => {
    throw new NotFoundSignal();
  },
});
seedModule("@/db/schema", { stages: { __tag: "stages-table" } });
// `db.select().from(stagesTable)` -- a tiny chainable fake standing in for
// the real Neon-backed drizzle query builder, same shape
// tests/climb-setup-state.test.ts already uses for the identical seam.
seedModule("@/lib/db", {
  db: {
    select: () => ({
      from: () => stubs.dbSelectStages(),
    }),
  },
});
seedModule("@/lib/auth/config", { auth: () => stubs.auth() });
seedModule("@/lib/db/threads", {
  listThreads: (userId: string) => stubs.listThreads(userId),
});
// MirrorSplitView.tsx transitively imports ChapterReader.tsx (for
// VerseColumn) plus lib/bible/*, none of which this file needs to exercise
// -- see the header comment. Stubbed to a marker element recording exactly
// the two MirrorPaneStage props the page handed it.
seedModule("@/components/mirror/MirrorSplitView", {
  MirrorSplitView: ({
    left,
    right,
  }: {
    left: { slug: string; title: string; book: number; chapter: number };
    right: { slug: string; title: string; book: number; chapter: number };
  }) =>
    createElement(
      "div",
      {
        "data-testid": "mirror-split-view",
        "data-left-slug": left.slug,
        "data-left-book": left.book,
        "data-left-chapter": left.chapter,
        "data-right-slug": right.slug,
        "data-right-book": right.book,
        "data-right-chapter": right.chapter,
      },
      `${left.title} :: ${right.title}`,
    ),
});

const pageModule = nodeRequire("@/app/(app)/mirror/[stageSlug]/page.tsx") as {
  default: (props: { params: Promise<{ stageSlug: string }> }) => Promise<unknown>;
  resolveSessionState: typeof import("../app/(app)/mirror/[stageSlug]/page").resolveSessionState;
  resolveMirrorStages: typeof import("../app/(app)/mirror/[stageSlug]/page").resolveMirrorStages;
};

const { resolveSessionState, resolveMirrorStages } = pageModule;
const MirrorPage = pageModule.default;

type RenderResult =
  | { kind: "html"; html: string }
  | { kind: "redirect"; url: string }
  | { kind: "not-found" };

async function renderPage(stageSlug: string): Promise<RenderResult> {
  try {
    const element = await MirrorPage({ params: Promise.resolve({ stageSlug }) });
    return { kind: "html", html: renderToStaticMarkup(element as never) };
  } catch (error) {
    if (error instanceof RedirectSignal) return { kind: "redirect", url: error.url };
    if (error instanceof NotFoundSignal) return { kind: "not-found" };
    throw error;
  }
}

// ===========================================================================
// Slug validation — malformed slugs never reach the database at all.
// ===========================================================================

test("a malformed slug 404s before any stage lookup happens", async () => {
  resetStubs();
  let called = false;
  stubs.dbSelectStages = async () => {
    called = true;
    return allStages;
  };

  const result = await renderPage("Not A Valid Slug!");

  assert.equal(result.kind, "not-found");
  assert.equal(called, false, "the stages table was queried for an invalid slug");
});

test("an overlong slug 404s", async () => {
  resetStubs();
  const result = await renderPage("a".repeat(200));
  assert.equal(result.kind, "not-found");
});

// ===========================================================================
// Auth gating — same discipline as every sibling page in this route group.
// ===========================================================================

test("GUARD: no session with a healthy database redirects to /sign-in, never touching stages", async () => {
  resetStubs();
  stubs.auth = async () => null;
  stubs.listThreads = async () => [];
  let called = false;
  stubs.dbSelectStages = async () => {
    called = true;
    return allStages;
  };

  const result = await renderPage("gen-03-05-sin-enters");

  assert.equal(result.kind, "redirect", result.kind === "html" ? `rendered:\n${result.html}` : undefined);
  if (result.kind !== "redirect") return;
  assert.equal(result.url, "/sign-in");
  assert.equal(called, false, "stages were queried before the auth guard fired");
});

test("a database outage during the session check renders setup-incomplete, not a sign-out redirect", async () => {
  resetStubs();
  stubs.auth = async () => null;
  stubs.listThreads = thrower("connect ECONNREFUSED 127.0.0.1:5432");

  const result = await renderPage("gen-03-05-sin-enters");

  assert.equal(result.kind, "html");
  if (result.kind !== "html") return;
  assert.ok(result.html.includes("Setup incomplete"));
  assert.ok(result.html.includes("data-testid=\"setup-notice\""));
});

test("a stages read failure renders setup-incomplete, not a crash", async () => {
  resetStubs();
  stubs.dbSelectStages = thrower("connect ECONNREFUSED 127.0.0.1:5432");

  const result = await renderPage("gen-03-05-sin-enters");

  assert.equal(result.kind, "html");
  if (result.kind !== "html") return;
  assert.ok(result.html.includes("Setup incomplete"));
  assert.ok(!result.html.includes("mirror-split-view"));
});

// ===========================================================================
// Requirement 4 — stage 6 and any no-mirror/broken-mirror stage must be
// handled explicitly and honestly, never rendered as garbage or crashed.
// ===========================================================================

test("an unknown slug (valid shape, no matching stage) 404s", async () => {
  resetStubs();
  const result = await renderPage("no-such-stage-at-all");
  assert.equal(result.kind, "not-found");
});

test("stage 6 (the Gospels, mirror: null) renders an honest no-mirror-pair state, not a crash", async () => {
  resetStubs();
  const result = await renderPage("gospels-jesus-christ");

  assert.equal(result.kind, "html");
  if (result.kind !== "html") return;
  assert.ok(result.html.includes("no-mirror-notice"), `no-mirror notice missing:\n${result.html}`);
  assert.ok(result.html.includes("no mirror pair"), `honest copy missing:\n${result.html}`);
  assert.ok(
    !result.html.includes("mirror-split-view"),
    `a no-mirror stage rendered a comparison view:\n${result.html}`,
  );
});

test("a mirror slug pointing at a nonexistent stage renders an honest broken-mirror state, not a crash", async () => {
  resetStubs();
  const result = await renderPage("broken-stage");

  assert.equal(result.kind, "html");
  if (result.kind !== "html") return;
  assert.ok(result.html.includes("broken-mirror-notice"), `broken-mirror notice missing:\n${result.html}`);
  assert.ok(!result.html.includes("mirror-split-view"));
});

test("a stage with no opening chapter renders an honest state naming that stage, not a crash", async () => {
  resetStubs();
  const result = await renderPage("no-chapter-stage");

  assert.equal(result.kind, "html");
  if (result.kind !== "html") return;
  assert.ok(result.html.includes("no-chapter-notice"), `no-chapter notice missing:\n${result.html}`);
  assert.ok(result.html.includes("No Chapter Stage"));
  assert.ok(!result.html.includes("mirror-split-view"));
});

// ===========================================================================
// Happy path — the right two stages, correctly resolved to book/chapter.
// ===========================================================================

test("a real mirror pair renders MirrorSplitView with both sides' book/chapter resolved from chapters[0]", async () => {
  resetStubs();
  const result = await renderPage("gen-03-05-sin-enters");

  assert.equal(result.kind, "html", result.kind === "not-found" ? "404'd" : undefined);
  if (result.kind !== "html") return;
  assert.ok(result.html.includes('data-testid="mirror-split-view"'));
  assert.ok(result.html.includes('data-left-slug="gen-03-05-sin-enters"'));
  assert.ok(result.html.includes('data-left-book="1"'));
  assert.ok(result.html.includes('data-left-chapter="3"'));
  assert.ok(result.html.includes('data-right-slug="rev-20-satan-cast-out"'));
  assert.ok(result.html.includes('data-right-book="66"'));
  assert.ok(result.html.includes('data-right-chapter="20"'));
});

test("resolving from the partner's own slug renders the same pair, sides swapped", async () => {
  resetStubs();
  const result = await renderPage("rev-20-satan-cast-out");

  assert.equal(result.kind, "html");
  if (result.kind !== "html") return;
  assert.ok(result.html.includes('data-left-slug="rev-20-satan-cast-out"'));
  assert.ok(result.html.includes('data-right-slug="gen-03-05-sin-enters"'));
});

// ===========================================================================
// View-model coverage — the pure discriminators, independent of rendering.
// ===========================================================================

test("resolveSessionState separates authenticated, signed-out, and setup-incomplete", async () => {
  assert.deepEqual(
    await resolveSessionState({
      getSession: async () => ({ user: { id: "owner-1" } }),
      probeDatabase: async () => [],
    }),
    { status: "authenticated", userId: "owner-1" },
  );
  assert.deepEqual(
    await resolveSessionState({ getSession: async () => null, probeDatabase: async () => [] }),
    { status: "signed-out" },
  );
  assert.deepEqual(
    await resolveSessionState({
      getSession: async () => null,
      probeDatabase: thrower("connect ECONNREFUSED 127.0.0.1:5432"),
    }),
    { status: "setup-incomplete" },
  );
});

test("resolveMirrorStages collapses any read failure to setup-incomplete", async () => {
  const ok = await resolveMirrorStages({ getStages: async () => allStages });
  assert.deepEqual(ok, { status: "ready", stages: allStages });

  const failed = await resolveMirrorStages({ getStages: thrower("missing DATABASE_URL") });
  assert.equal(failed.status, "setup-incomplete");
});

// ===========================================================================
// Assertion-line discipline (docs/decisions/2026-08-18-teaching-not-
// theology.md) — this route must never leak a stage's curated `summary`
// text (interpretive commentary on WHY a pair mirrors) into any of its
// honest non-happy-path screens.
// ===========================================================================

test("no rendered branch of this page ever includes a stage's summary field", async () => {
  const stageWithSummary = stage({
    slug: "gen-03-05-sin-enters",
    title: "Genesis 3–5 — Satan and Sin Enter",
    stage: 2,
    mirror: null, // exercise the no-mirror branch, which renders this exact stage
    chapters: ["1.3"],
    summary: "What enters here is removed there, by name.",
  });
  resetStubs();
  stubs.dbSelectStages = async () => [stageWithSummary];

  const result = await renderPage("gen-03-05-sin-enters");
  assert.equal(result.kind, "html");
  if (result.kind !== "html") return;
  assert.ok(
    !result.html.includes("What enters here is removed there"),
    `the page rendered app-supplied commentary about the mirror connection:\n${result.html}`,
  );
});
