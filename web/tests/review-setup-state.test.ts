/**
 * Gate 0.3 — the review page must distinguish "the database is unreachable"
 * from "this account genuinely has nothing yet."
 *
 * Two layers are tested here, deliberately:
 *
 *  1. `loadReviewViewModel` / `resolveSessionState` — the pure discriminators.
 *  2. The RENDERED OUTPUT of the real default-export `ReviewPage`, piped
 *     through `react-dom/server`. Layer 1 alone is vacuous with respect to the
 *     acceptance criteria: an earlier version of this file passed 5/5 even
 *     after the setup-incomplete branch was mutated to render markup identical
 *     to an empty account. Every claim about what "the reader sees" is now
 *     asserted against actual HTML.
 *
 * `page.tsx` statically imports `server-only`-guarded modules
 * (`@/lib/auth/config`, `@/lib/db/review`, `@/lib/db/entries`,
 * `@/lib/db/threads`), `next/link`, `next/navigation` and a CSS Module
 * (`./review.module.css`), none of which plain `node:test` can load:
 * `server-only` throws unconditionally outside a bundler, and there is no
 * CSS-module loader here, so requiring it unseeded fails with
 * "Unexpected token '.'" on the CSS file's own first selector. All of them are
 * neutralised in `require.cache` before the page module loads, mirroring
 * `tests/tenant-isolation.test.ts`'s treatment of the same guard.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Entry, ReviewSnapshot, Thread } from "@/lib/contracts";

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

const emptySnapshot: ReviewSnapshot = {
  chaptersRead: 0,
  totalChapters: 1_189,
  stagesStudied: 0,
  totalStages: 0,
  openQuestions: 0,
  streak: 0,
  threads: [],
  coldThreads: [],
  orphanEntries: [],
  mirrorBreaks: [],
};

type Stubs = {
  auth: () => Promise<SessionLike>;
  getReviewSnapshot: (userId: string) => Promise<ReviewSnapshot>;
  listEntries: (userId: string, filters: unknown) => Promise<Entry[]>;
  listThreads: (userId: string) => Promise<Thread[]>;
};

const stubs: Stubs = {
  auth: async () => ({ user: { id: "owner-1" } }),
  getReviewSnapshot: async () => emptySnapshot,
  listEntries: async () => [],
  listThreads: async () => [],
};

function resetStubs() {
  stubs.auth = async () => ({ user: { id: "owner-1" } });
  stubs.getReviewSnapshot = async () => emptySnapshot;
  stubs.listEntries = async () => [];
  stubs.listThreads = async () => [];
}

// CSS Modules resolve every requested class to its own name so the rendered
// markup carries recognisable hooks (`class="setupNotice"`).
const cssProxy = new Proxy(
  {},
  {
    get: (_target, key) => (typeof key === "string" ? key : undefined),
  },
);

seedModule("server-only", {});
seedModule("@/app/(app)/review/review.module.css", { default: cssProxy });
seedModule("next/link", {
  default: ({ href, children, className }: { href: string; children?: unknown; className?: string }) =>
    createElement("a", { href, className }, children as never),
});
seedModule("next/navigation", {
  redirect: (url: string): never => {
    throw new RedirectSignal(url);
  },
});
seedModule("@/lib/auth/config", { auth: () => stubs.auth() });
seedModule("@/lib/db/review", {
  getReviewSnapshot: (userId: string) => stubs.getReviewSnapshot(userId),
});
seedModule("@/lib/db/entries", {
  listEntries: (userId: string, filters: unknown) => stubs.listEntries(userId, filters),
});
seedModule("@/lib/db/threads", { listThreads: (userId: string) => stubs.listThreads(userId) });

const pageModule = nodeRequire("@/app/(app)/review/page.tsx") as {
  default: typeof import("../app/(app)/review/page").default;
  loadReviewViewModel: typeof import("../app/(app)/review/page").loadReviewViewModel;
  resolveSessionState: typeof import("../app/(app)/review/page").resolveSessionState;
};

const { loadReviewViewModel, resolveSessionState } = pageModule;
const ReviewPage = pageModule.default;

/** Renders the real page component to HTML, or reports the redirect it threw. */
async function renderPage(): Promise<
  { kind: "html"; html: string } | { kind: "redirect"; url: string }
> {
  try {
    const element = await ReviewPage();
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
const EMPTY_ACCOUNT_HEADLINE = "What has been recurring in your study";
const SETUP_NOTICE_HOOK = 'data-testid="setup-notice"';
const EMPTY_TEACHING_COPY = "Nothing marked yet";
const EMPTY_ORPHANS_COPY = "No orphans. Everything is connected to something.";

// ===========================================================================
// FINDING 1 — rendering. Both branches must be distinguishable in the HTML a
// reader receives, not merely in the view model's tag.
// ===========================================================================

test("RENDER: an unreachable database renders the setup-incomplete screen, not empty-state copy", async () => {
  resetStubs();
  stubs.getReviewSnapshot = thrower("connect ECONNREFUSED 127.0.0.1:5432");

  const html = await renderHtml();

  assert.ok(html.includes(SETUP_HEADLINE), `setup headline missing from rendered output:\n${html}`);
  assert.ok(html.includes(SETUP_NOTICE_HOOK), `setup notice element missing:\n${html}`);
  assert.ok(html.includes("not an empty account"), `setup notice copy missing:\n${html}`);
  // It must NOT look like an ordinary empty account.
  assert.ok(!html.includes(EMPTY_ACCOUNT_HEADLINE), `setup screen reused the empty-account headline:\n${html}`);
  assert.ok(!html.includes(EMPTY_TEACHING_COPY), `setup screen reused empty-state teaching copy:\n${html}`);
  assert.ok(!html.includes(EMPTY_ORPHANS_COPY), `setup screen reused empty-state orphan copy:\n${html}`);
});

test("RENDER: a genuinely empty account renders the normal empty-state copy and no setup notice", async () => {
  resetStubs();

  const html = await renderHtml();

  assert.ok(html.includes(EMPTY_ACCOUNT_HEADLINE), `empty-account headline missing:\n${html}`);
  assert.ok(html.includes(EMPTY_TEACHING_COPY), `empty-state teaching copy missing:\n${html}`);
  assert.ok(html.includes(EMPTY_ORPHANS_COPY), `empty-state orphan copy missing:\n${html}`);
  assert.ok(html.includes("Every thread has at least one entry running into it."));
  assert.ok(html.includes("All eleven mirror pairs point both ways."));
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
  // And the difference is the one a reader can act on, not incidental.
  assert.ok(setupHtml.includes(SETUP_HEADLINE) && !emptyAccountHtml.includes(SETUP_HEADLINE));
  assert.ok(
    emptyAccountHtml.includes(EMPTY_ACCOUNT_HEADLINE) && !setupHtml.includes(EMPTY_ACCOUNT_HEADLINE),
  );
});

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
// FINDING 4 — the auth guard. Deleting it must break a named test.
// ===========================================================================

test("GUARD: no session with a healthy database redirects to /sign-in and renders no journal content", async () => {
  resetStubs();
  stubs.auth = async () => null;
  // Database is fine — so this really is a signed-out visitor.
  stubs.listThreads = async () => [];
  // If the guard is removed the page falls through to these, which must never
  // be reached, and the assertions below catch the rendered output.
  stubs.getReviewSnapshot = async () => emptySnapshot;

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
      ? `a blank user id rendered the journal:\n${result.html}`
      : "expected a redirect",
  );
  if (result.kind !== "redirect") return;
  assert.equal(result.url, "/sign-in");
});

test("GUARD: the authenticated owner's id is the one passed to every DB read", async () => {
  resetStubs();
  const seen: string[] = [];
  stubs.auth = async () => ({ user: { id: "owner-42" } });
  stubs.getReviewSnapshot = async (userId: string) => {
    seen.push(`snapshot:${userId}`);
    return emptySnapshot;
  };
  stubs.listEntries = async (userId: string) => {
    seen.push(`entries:${userId}`);
    return [];
  };
  stubs.listThreads = async (userId: string) => {
    seen.push(`threads:${userId}`);
    return [];
  };

  await renderHtml();

  assert.deepEqual(seen.sort(), [
    "entries:owner-42",
    "snapshot:owner-42",
    "threads:owner-42",
  ]);
});

// ===========================================================================
// FINDING 3 — cold threads must show titles, not slugs.
// ===========================================================================

const coldThreadFixture: ReviewSnapshot = {
  ...emptySnapshot,
  threads: [
    { slug: "covenant-faithfulness", title: "Covenant Faithfulness", inbound: 0 },
    { slug: "exile-and-return", title: "Exile and Return", inbound: 3 },
  ],
  coldThreads: ["covenant-faithfulness"],
};

test("cold threads carry titles, not slugs, in the view model", async () => {
  const view = await loadReviewViewModel("user-1", {
    getSnapshot: async () => coldThreadFixture,
    getEntries: async () => [],
    getThreads: async () => [],
  });

  assert.equal(view.status, "ok");
  if (view.status !== "ok") return;
  assert.deepEqual(view.data.coldThreads, ["Covenant Faithfulness"]);
});

test("RENDER: cold threads display the title, never the raw slug", async () => {
  resetStubs();
  stubs.getReviewSnapshot = async () => coldThreadFixture;

  const html = await renderHtml();

  assert.ok(html.includes("<li>Covenant Faithfulness</li>"), `title not rendered:\n${html}`);
  assert.ok(
    !html.includes("<li>covenant-faithfulness</li>"),
    `the raw slug leaked into the cold-thread list:\n${html}`,
  );
});

test("a cold thread with no known title falls back to its slug rather than rendering blank", async () => {
  const view = await loadReviewViewModel("user-1", {
    getSnapshot: async () => ({ ...emptySnapshot, coldThreads: ["orphaned-slug"] }),
    getEntries: async () => [],
    getThreads: async () => [],
  });

  assert.equal(view.status, "ok");
  if (view.status !== "ok") return;
  assert.deepEqual(view.data.coldThreads, ["orphaned-slug"]);
});

// ===========================================================================
// Original view-model coverage (unchanged behaviour).
// ===========================================================================

test("a DB read failure renders setup-incomplete, not a JSON-shaped hole", async () => {
  const view = await loadReviewViewModel("user-1", {
    getSnapshot: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
    },
    getEntries: async () => [],
    getThreads: async () => [],
  });

  assert.equal(view.status, "setup-incomplete");
});

test("a missing DATABASE_URL-style failure on any one dependency also renders setup-incomplete", async () => {
  const view = await loadReviewViewModel("user-1", {
    getSnapshot: async () => emptySnapshot,
    getEntries: async () => {
      throw new Error("missing DATABASE_URL");
    },
    getThreads: async () => [],
  });

  assert.equal(view.status, "setup-incomplete");
});

test("a genuinely empty account is NOT setup-incomplete: it renders the ordinary empty-state data", async () => {
  const view = await loadReviewViewModel("user-1", {
    getSnapshot: async () => emptySnapshot,
    getEntries: async () => [],
    getThreads: async () => [],
  });

  assert.equal(view.status, "ok");
  if (view.status !== "ok") return;
  assert.deepEqual(view.data.snapshot, emptySnapshot);
  assert.deepEqual(view.data.motifCandidates, []);
  assert.deepEqual(view.data.teaching, []);
  assert.deepEqual(view.data.orphanEntries, []);
  assert.deepEqual(view.data.coldThreads, []);
});

test("a populated account composes teaching, radar, and orphan labels from the real DB entry shape", async () => {
  const entries: Entry[] = [
    {
      id: "e-teach",
      kind: "teaching" as const,
      body: "Grace precedes obedience every time.",
      chapter: "45.1",
      threads: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "e-orphan",
      kind: "observation" as const,
      body: "A note linked to nothing yet, long enough to need truncating in the orphan label display.",
      chapter: "1.3",
      threads: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "e-radar-1",
      kind: "observation" as const,
      body: "covenant covenant covenant faithfulness recurs here constantly",
      chapter: "1.1",
      threads: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "e-radar-2",
      kind: "question" as const,
      body: "Why does covenant keep showing up in every single passage",
      chapter: "2.1",
      threads: [],
      answeredAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "e-radar-3",
      kind: "observation" as const,
      body: "Another covenant sighting, third distinct passage now",
      chapter: "3.1",
      threads: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  const view = await loadReviewViewModel("user-1", {
    getSnapshot: async () => ({ ...emptySnapshot, orphanEntries: ["e-orphan"] }),
    getEntries: async () => entries,
    getThreads: async () => [],
  });

  assert.equal(view.status, "ok");
  if (view.status !== "ok") return;

  assert.deepEqual(view.data.teaching, [
    { body: "Grace precedes obedience every time.", chapter: "45.1", threads: [] },
  ]);

  assert.equal(view.data.orphanEntries.length, 1);
  assert.equal(view.data.orphanEntries[0].id, "e-orphan");
  assert.ok(view.data.orphanEntries[0].label.startsWith("1.3 — "));
  assert.ok(view.data.orphanEntries[0].label.endsWith("…"));

  assert.equal(view.data.motifCandidates.length, 1);
  assert.equal(view.data.motifCandidates[0].label, "covenant");
  assert.equal(view.data.motifCandidates[0].passages.length, 3);
});

