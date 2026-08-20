/**
 * AUTHDISAMBIG-001 — closing the database-outage-vs-signed-out gap at the
 * layout/middleware level.
 *
 * AUTHDB-001 already closed this for the MIDDLEWARE (`web/proxy.ts` ->
 * `lib/auth/config.ts`'s `authorized` callback -> `resolveAuthorizedDecision`,
 * proven in `tests/auth-db-failure.test.ts`). That leaves exactly one other
 * place that calls `auth()` directly, above every page in this route group,
 * with no probe of its own: `app/(app)/layout.tsx`. Its own comment explains
 * why it re-checks at all even though the proxy matcher already covers these
 * routes — the matcher is "a coarse, easily-mis-edited perimeter" — so this
 * file proves the SAME disambiguation now lives there too, not by re-running
 * `tests/review-setup-state.test.ts` / `climb-setup-state.test.ts` /
 * `study-page.test.ts` (which exercise the page-level copies and would pass
 * unchanged whether or not this task did anything), but against
 * `lib/auth/config.ts`'s new `resolveSessionState` and the real
 * `AppShellLayout` component that now calls it.
 *
 * Two parts, deliberately:
 *
 *   PART A — `resolveSessionState`, the pure discriminator now living in
 *   `lib/auth/config.ts` (the shared layer every page-level copy already
 *   converged on independently — see this task's commit message for the
 *   redundancy call on those three copies). Required for real, unstubbed,
 *   the same way `tests/auth-db-failure.test.ts` requires the real
 *   `resolveAuthorizedDecision`.
 *
 *   PART B — the RENDERED OUTPUT of the real default-export `AppShellLayout`,
 *   piped through `react-dom/server`, with `resolveSessionState` stubbed so
 *   every branch (setup-incomplete, signed-out, authenticated) is provable
 *   without a live database. Layer A alone is vacuous with respect to this
 *   task's acceptance criteria: proving the function is correct says nothing
 *   about whether the layout actually calls it, or calls it correctly, on
 *   every branch. `tests/review-setup-state.test.ts`'s own comment makes the
 *   identical point about `ReviewPage` and its `resolveSessionState`.
 *
 * `lib/auth/config.ts` statically imports `server-only`, which throws
 * unconditionally outside a bundler; `app/(app)/layout.tsx` statically
 * imports a CSS Module and two components that themselves import client-only
 * modules (`next/dynamic`, `next-auth/react`, `next/navigation`'s
 * `usePathname`). All of these are neutralised in `require.cache` before the
 * relevant module loads, mirroring `tests/review-setup-state.test.ts` and
 * `tests/tenant-isolation.test.ts`'s treatment of the same class of guard.
 *
 * Module-cache choreography: Part A requires the REAL `@/lib/auth/config`
 * first (only `server-only` seeded, exactly like
 * `tests/auth-db-failure.test.ts`). Its cache entry is then deleted and
 * reseeded as a controllable FAKE before Part B requires
 * `@/app/(app)/layout.tsx`, so the layout's own `resolveSessionState` calls
 * are driven by test-controlled stubs rather than a real database probe.
 * Order matters here — swap it and Part B would bind to the real function
 * instead of the stub.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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

function unseedModule(specifier: string) {
  const resolved = nodeRequire.resolve(specifier);
  delete (nodeRequire.cache as Record<string, unknown>)[resolved];
}

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT:${url}`);
    this.name = "RedirectSignal";
  }
}

const thrower = (message: string) => async (): Promise<never> => {
  throw new Error(message);
};

// ===========================================================================
// PART A — the pure discriminator, required for real.
// ===========================================================================

seedModule("server-only", {});

const realConfigModule = nodeRequire("@/lib/auth/config") as {
  resolveSessionState: typeof import("../lib/auth/config").resolveSessionState;
};
const { resolveSessionState } = realConfigModule;

test("resolveSessionState (lib/auth/config.ts): separates authenticated, signed-out, and setup-incomplete", async () => {
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
      getSession: thrower("AdapterError: getSessionAndUser failed"),
      probeDatabase: async () => [],
    }),
    { status: "setup-incomplete" },
  );

  // A session row that exists but was blanked by the allowlist callback
  // (lib/auth/config.ts's own `session()` callback) is not authenticated.
  assert.deepEqual(
    await resolveSessionState({
      getSession: async () => ({ user: { id: "" } }),
      probeDatabase: async () => [],
    }),
    { status: "signed-out" },
  );
});

test("resolveSessionState (lib/auth/config.ts): the identical null session produces different outcomes depending only on database reachability", async () => {
  const whenHealthy = await resolveSessionState({
    getSession: async () => null,
    probeDatabase: async () => [],
  });
  const whenDead = await resolveSessionState({
    getSession: async () => null,
    probeDatabase: thrower("connect ECONNREFUSED 127.0.0.1:5432"),
  });

  assert.deepEqual(whenHealthy, { status: "signed-out" });
  assert.deepEqual(whenDead, { status: "setup-incomplete" });
  assert.notDeepEqual(
    whenHealthy,
    whenDead,
    "a healthy-DB sign-out and a dead-DB failure must never collapse to the same outcome",
  );
});

// ===========================================================================
// PART B — the real AppShellLayout, rendered, with resolveSessionState
// stubbed. Everything below this line depends on the cache surgery above
// having already captured the REAL resolveSessionState for Part A.
// ===========================================================================

unseedModule("@/lib/auth/config");

type SessionState =
  | { status: "authenticated"; userId: string }
  | { status: "signed-out" }
  | { status: "setup-incomplete" };

type Stubs = {
  resolveSessionState: () => Promise<SessionState>;
};

const stubs: Stubs = {
  resolveSessionState: async () => ({ status: "authenticated", userId: "owner-1" }),
};

function resetStubs() {
  stubs.resolveSessionState = async () => ({ status: "authenticated", userId: "owner-1" });
}

// CSS Modules resolve every requested class to its own name so the rendered
// markup carries recognisable hooks (`class="shell"`, `class="content"`).
const cssProxy = new Proxy(
  {},
  {
    get: (_target, key) => (typeof key === "string" ? key : undefined),
  },
);

seedModule("@/app/(app)/shell.module.css", { default: cssProxy });
seedModule("next/navigation", {
  redirect: (url: string): never => {
    throw new RedirectSignal(url);
  },
});
seedModule("@/lib/auth/config", {
  resolveSessionState: () => stubs.resolveSessionState(),
});
seedModule("@/components/auth/DeviceSessionControls", {
  ProtectedClientMounts: () =>
    createElement("div", { "data-testid": "protected-client-mounts" }),
});
seedModule("@/components/shell/TabBar", {
  TabBar: () => createElement("nav", { "data-testid": "tab-bar" }),
});

const layoutModule = nodeRequire("@/app/(app)/layout.tsx") as {
  default: typeof import("../app/(app)/layout").default;
};
const AppShellLayout = layoutModule.default;

const PAGE_CONTENT_HOOK = 'data-testid="page-content"';
const PAGE_CONTENT_TEXT = "PAGE BODY MARKER";

function pageContentChild() {
  return createElement("p", { "data-testid": "page-content" }, PAGE_CONTENT_TEXT);
}

/** Renders the real layout to HTML, or reports the redirect it threw. */
async function renderLayout(): Promise<
  { kind: "html"; html: string } | { kind: "redirect"; url: string }
> {
  try {
    const element = await AppShellLayout({ children: pageContentChild() });
    return { kind: "html", html: renderToStaticMarkup(element as never) };
  } catch (error) {
    if (error instanceof RedirectSignal) return { kind: "redirect", url: error.url };
    throw error;
  }
}

const SETUP_HEADLINE = "Setup incomplete";
const SETUP_NOTICE_HOOK = 'data-testid="setup-notice"';
const SHELL_HOOK = 'class="shell"';
const TAB_BAR_HOOK = 'data-testid="tab-bar"';
const CLIENT_MOUNTS_HOOK = 'data-testid="protected-client-mounts"';

// ===========================================================================
// FINDING 1 — a database outage at the layout layer must render "setup
// incomplete", never silently redirect to /sign-in disguised as a sign-out.
// This is the acceptance-criterion test: mutate `app/(app)/layout.tsx` to
// treat `sessionState.status !== "authenticated"` as the only branch (the
// pre-AUTHDISAMBIG-001 shape) and this test fails.
// ===========================================================================

test("LAYOUT setup-incomplete: renders the setup notice, never a redirect, never the shell or children", async () => {
  resetStubs();
  stubs.resolveSessionState = async () => ({ status: "setup-incomplete" });

  const result = await renderLayout();

  assert.equal(
    result.kind,
    "html",
    result.kind === "redirect"
      ? `a database outage redirected to ${(result as { url: string }).url} instead of rendering setup-incomplete`
      : "expected html",
  );
  if (result.kind !== "html") return;

  assert.ok(result.html.includes(SETUP_HEADLINE), `setup headline missing:\n${result.html}`);
  assert.ok(result.html.includes(SETUP_NOTICE_HOOK), `setup notice hook missing:\n${result.html}`);
  assert.ok(
    result.html.includes("not been signed out"),
    `reader was not told they are still signed in:\n${result.html}`,
  );
  assert.ok(
    !result.html.includes(SHELL_HOOK),
    `setup-incomplete rendered the protected shell:\n${result.html}`,
  );
  assert.ok(
    !result.html.includes(TAB_BAR_HOOK),
    `setup-incomplete mounted the TabBar:\n${result.html}`,
  );
  assert.ok(
    !result.html.includes(CLIENT_MOUNTS_HOOK),
    `setup-incomplete mounted the client sync component:\n${result.html}`,
  );
  assert.ok(
    !result.html.includes(PAGE_CONTENT_TEXT),
    `setup-incomplete rendered the child page's own content:\n${result.html}`,
  );
});

// ===========================================================================
// FINDING 2 — a genuinely signed-out visitor still redirects, unaffected by
// this change.
// ===========================================================================

test("LAYOUT signed-out: redirects to /sign-in and renders no journal content", async () => {
  resetStubs();
  stubs.resolveSessionState = async () => ({ status: "signed-out" });

  const result = await renderLayout();

  assert.equal(
    result.kind,
    "redirect",
    result.kind === "html"
      ? `a genuinely signed-out visitor was not redirected; the layout rendered:\n${result.html}`
      : "expected a redirect",
  );
  if (result.kind !== "redirect") return;
  assert.equal(result.url, "/sign-in");
});

// ===========================================================================
// FINDING 3 — the ordinary authenticated path is unaffected: shell, both
// mounts, and the child page's own content all render.
// ===========================================================================

test("LAYOUT authenticated: renders the shell, both mounts, and the child page's content", async () => {
  resetStubs();
  stubs.resolveSessionState = async () => ({ status: "authenticated", userId: "owner-1" });

  const result = await renderLayout();

  assert.equal(
    result.kind,
    "html",
    result.kind === "redirect" ? `authenticated visitor was redirected to ${result.url}` : "expected html",
  );
  if (result.kind !== "html") return;

  assert.ok(result.html.includes(SHELL_HOOK), `shell markup missing:\n${result.html}`);
  assert.ok(result.html.includes(TAB_BAR_HOOK), `TabBar not mounted:\n${result.html}`);
  assert.ok(result.html.includes(CLIENT_MOUNTS_HOOK), `client sync mount missing:\n${result.html}`);
  assert.ok(result.html.includes(PAGE_CONTENT_HOOK), `child page content missing:\n${result.html}`);
  assert.ok(result.html.includes(PAGE_CONTENT_TEXT), `child page text missing:\n${result.html}`);
  assert.ok(!result.html.includes(SETUP_HEADLINE), `authenticated visitor saw a setup-incomplete screen:\n${result.html}`);
});

// ===========================================================================
// FINDING 4 — distinguishability: setup-incomplete and signed-out must never
// collapse to the same observable outcome at this layer either.
// ===========================================================================

test("LAYOUT distinguishability: setup-incomplete and signed-out never produce the same outcome", async () => {
  resetStubs();
  stubs.resolveSessionState = async () => ({ status: "setup-incomplete" });
  const whenDown = await renderLayout();

  resetStubs();
  stubs.resolveSessionState = async () => ({ status: "signed-out" });
  const whenSignedOut = await renderLayout();

  assert.equal(whenDown.kind, "html", "database outage must not redirect");
  assert.equal(whenSignedOut.kind, "redirect", "genuine sign-out must still redirect");
  assert.notEqual(
    whenDown.kind,
    whenSignedOut.kind,
    "a database outage and a genuine sign-out must never look identical at the layout layer",
  );
});
