/**
 * AUTHDB-001 — "A dead database must not tell the owner they are signed out."
 *
 * REVIEW-001 fixed this at the PAGE level (`app/(app)/review/page.tsx`'s
 * `resolveSessionState`), but `web/proxy.ts` re-exports the SAME `auth` as
 * the Next.js proxy/middleware, with a matcher covering every non-API,
 * non-static, non-sign-in route. For a real browser navigation, the
 * middleware runs and decides BEFORE any page component does — so the
 * page-level fix never even gets a chance to run. This file proves the fix
 * lives where the bug actually is: `lib/auth/config.ts`'s `authorized`
 * callback, which `next-auth/lib/index.js`'s `handleAuth` calls ONLY from
 * the middleware branch (`args[0] instanceof Request`) — a completely
 * different code path from the zero-arg `auth()` call used inside Server
 * Components, which `resolveSessionState` uses and which this file does not
 * touch.
 *
 * Two layers, deliberately:
 *
 *   PART A — `resolveAuthorizedDecision` / `hasSessionCookie` /
 *   `setupIncompleteResponse`, the pure decision exported from
 *   `lib/auth/config.ts`, exercised in-process with injected deps so every
 *   branch (including the "healthy database" ones this sandbox cannot
 *   stand up a real Postgres for) is provable without a live database.
 *
 *   PART B — a genuine end-to-end wire proof: a real production server
 *   (`next start`), a real HTTP request, over a DATABASE_URL pointing at a
 *   port nothing is listening on (127.0.0.1:5432 — the identical value
 *   `tests/security-headers.test.ts`'s wire suite already uses and already
 *   proves is unreachable in this sandbox). This is the strongest available
 *   proof that the MIDDLEWARE — not merely the page, and not merely the
 *   pure function above — fails the right direction against a genuinely
 *   dead database.
 *
 * HONEST LIMIT (stated per AUTHDB-001's own instructions, not smuggled):
 * this sandbox has no real Postgres to stand up, so the "cookie present,
 * database HEALTHY, session simply invalid -> redirect" branch is proven
 * on the wire only via the existing, unmodified
 * `tests/security-headers.test.ts` wire suite's unauthenticated-request
 * cases (which never send a session cookie, so they do not exercise this
 * exact branch) and, for the cookie-present case specifically, via Part A's
 * in-process proof with an injected `probeDatabase` that resolves
 * successfully. That stub behaves identically to a real query for this
 * code's purposes: the branch only ever inspects throw-vs-resolve, never
 * the resolved value, and this is spelled out rather than presented as a
 * live-database proof.
 *
 * `lib/auth/config.ts` statically imports `server-only`, which throws
 * unconditionally outside a bundler — neutralised in `require.cache` first,
 * exactly as `tests/review-setup-state.test.ts` and
 * `tests/tenant-isolation.test.ts` already do for the same guard. Unlike
 * those two files, `@/lib/auth/config` itself is NOT stubbed here — Part A
 * needs the REAL `resolveAuthorizedDecision` under test, not a fake of it.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import test, { after, before, describe } from "node:test";

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

seedModule("server-only", {});

const configModule = nodeRequire("@/lib/auth/config") as {
  hasSessionCookie: typeof import("../lib/auth/config").hasSessionCookie;
  resolveAuthorizedDecision: typeof import("../lib/auth/config").resolveAuthorizedDecision;
  setupIncompleteResponse: typeof import("../lib/auth/config").setupIncompleteResponse;
};

const { hasSessionCookie, resolveAuthorizedDecision, setupIncompleteResponse } = configModule;

// ===========================================================================
// PART A — the pure decision, in-process.
// ===========================================================================

function cookieJar(names: string[]) {
  const set = new Set(names);
  return { cookies: { has: (name: string) => set.has(name) } };
}

const noCookies = cookieJar([]);
const plainSessionCookie = cookieJar(["authjs.session-token"]);
const secureSessionCookie = cookieJar(["__Secure-authjs.session-token"]);

/**
 * `isAllowedEmail` (called inside `resolveAuthorizedDecision`) defaults to
 * `process.env.AUTH_ALLOWED_EMAIL`, unset in this sandbox. Tests that need a
 * session to actually count as "allowed" set it explicitly and restore it
 * afterward — never relying on whatever the ambient environment happens to
 * have, per the no-derive-from-ambient-state spirit of this project's test
 * conventions.
 */
const OWNER_EMAIL = "owner@example.test";

async function withAllowedEmail<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.AUTH_ALLOWED_EMAIL;
  process.env.AUTH_ALLOWED_EMAIL = OWNER_EMAIL;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.AUTH_ALLOWED_EMAIL;
    else process.env.AUTH_ALLOWED_EMAIL = previous;
  }
}

const healthyProbe = async () => {
  /* resolves: database answered */
};
const deadProbe = async () => {
  throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
};
const explodingProbe = async () => {
  throw new Error("probeDatabase must never be called on the no-cookie fast path");
};

test("hasSessionCookie recognises the plain and __Secure- session cookie names", () => {
  assert.equal(hasSessionCookie(plainSessionCookie), true);
  assert.equal(hasSessionCookie(secureSessionCookie), true);
});

test("hasSessionCookie is false with no session cookie, even with other cookies present", () => {
  assert.equal(hasSessionCookie(cookieJar(["authjs.csrf-token", "some-other-cookie"])), false);
  assert.equal(hasSessionCookie(noCookies), false);
});

test("DECISION: an authenticated, allowed session is let through without touching the database", async () => {
  const decision = await withAllowedEmail(() =>
    resolveAuthorizedDecision(
      noCookies,
      { user: { id: "owner-1", email: OWNER_EMAIL } },
      { hasSessionCookie, probeDatabase: explodingProbe },
    ),
  );
  assert.equal(decision, true);
});

test("DECISION: no session cookie at all redirects (false) with ZERO database access — the fast path", async () => {
  const decision = await resolveAuthorizedDecision(
    noCookies,
    null,
    { hasSessionCookie, probeDatabase: explodingProbe },
  );
  assert.equal(decision, false, "a request with no session cookie must never probe the database");
});

test("DECISION: a session cookie with a HEALTHY database and no valid session redirects (false) — genuinely signed out", async () => {
  let probed = false;
  const decision = await resolveAuthorizedDecision(
    plainSessionCookie,
    null,
    {
      hasSessionCookie,
      probeDatabase: async () => {
        probed = true;
        await healthyProbe();
      },
    },
  );
  assert.equal(probed, true, "the ambiguous case must ask the database");
  assert.equal(decision, false);
});

test("DECISION: a session cookie with an UNREACHABLE database returns the setup-incomplete response, not a redirect", async () => {
  const decision = await resolveAuthorizedDecision(
    plainSessionCookie,
    null,
    { hasSessionCookie, probeDatabase: deadProbe },
  );
  assert.ok(decision instanceof Response, "expected a Response overriding the default redirect");
  assert.equal((decision as Response).status, 503);
});

test("DECISION: the __Secure- cookie name triggers the same ambiguous-case probe as the plain name", async () => {
  let probed = false;
  const decision = await resolveAuthorizedDecision(
    secureSessionCookie,
    null,
    {
      hasSessionCookie,
      probeDatabase: async () => {
        probed = true;
        throw new Error("dead");
      },
    },
  );
  assert.equal(probed, true);
  assert.ok(decision instanceof Response);
  assert.equal((decision as Response).status, 503);
});

test("DECISION: a blank user id (allowlist-revoked) is treated as signed out, not authenticated", async () => {
  // lib/auth/config.ts's session() callback blanks session.user.id to "" once
  // the configured owner email stops matching. Preserved behaviour: this must
  // still be indistinguishable from "no session" for the authorized check.
  const decision = await resolveAuthorizedDecision(
    noCookies,
    { user: { id: "", email: "someone-else@example.test" } },
    { hasSessionCookie, probeDatabase: explodingProbe },
  );
  assert.equal(decision, false);
});

test("DECISION: an allowed email with a blank id (defensive double-check) still fails closed", async () => {
  const decision = await withAllowedEmail(() =>
    resolveAuthorizedDecision(
      plainSessionCookie,
      { user: { id: "", email: OWNER_EMAIL } },
      { hasSessionCookie, probeDatabase: healthyProbe },
    ),
  );
  assert.equal(decision, false);
});

test("DISTINGUISHABILITY: the identical null session produces different outcomes depending only on database reachability", async () => {
  const deps = (probeDatabase: () => Promise<unknown>) => ({ hasSessionCookie, probeDatabase });

  const whenHealthy = await resolveAuthorizedDecision(plainSessionCookie, null, deps(healthyProbe));
  const whenDead = await resolveAuthorizedDecision(plainSessionCookie, null, deps(deadProbe));

  assert.equal(whenHealthy, false, "healthy DB + no session => genuinely signed out => redirect");
  assert.ok(whenDead instanceof Response, "dead DB + no session => setup incomplete, never a redirect");
  assert.notEqual(
    whenHealthy,
    whenDead,
    "a healthy-DB sign-out and a dead-DB failure must never collapse to the same outcome",
  );
});

test("setupIncompleteResponse never claims the visitor is signed out, and carries no journal content", () => {
  const response = setupIncompleteResponse();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
});

test("setupIncompleteResponse's body tells the reader they are NOT signed out", async () => {
  const response = setupIncompleteResponse();
  const body = await response.clone().text();
  assert.ok(body.includes("not been signed out"), body);
  assert.ok(body.toLowerCase().includes("configuration"), body);
  assert.ok(!body.toLowerCase().includes("sign in"), `must not tell the reader to sign in:\n${body}`);
});

// ===========================================================================
// PART B — wire proof: a real `next start`, a real HTTP request, a database
// nothing is listening for. Proves the MIDDLEWARE specifically: /read has no
// bespoke setup-incomplete page logic of its own (unlike /review), so any
// non-redirect, non-500-crash response here can only have come from
// web/proxy.ts's `auth` / lib/auth/config.ts's `authorized` callback running
// before the page ever executes.
// ===========================================================================

const WEB_ROOT = process.cwd();
const BUILD_ID_PATH = path.join(WEB_ROOT, ".next", "BUILD_ID");
const WIRE_PORT = 3971;
const BASE_URL = `http://localhost:${WIRE_PORT}`;
const READY_TIMEOUT_MS = 30_000;
/** A postgres:// URL over a port nothing listens on in this sandbox —
 *  identical in spirit to tests/security-headers.test.ts's wire fixture,
 *  which already establishes (via its own passing `/ -> 307` wire case,
 *  asserted against this same class of dead URL) that no server on this
 *  box answers here. */
const DEAD_DATABASE_URL = "postgresql://wire-test:wire-test@127.0.0.1:5432/wire-test";

/**
 * Not a sanctioned skip: reaching a missing build must fail LOUDLY
 * (SILENT-SKIP-001 — see agent-graph/LESSONS.md), not quietly pass nothing.
 */
const buildPresent = existsSync(BUILD_ID_PATH);

async function isPortBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => resolve(error.code === "EADDRINUSE"));
    probe.once("listening", () => probe.close(() => resolve(false)));
    probe.listen(port, "127.0.0.1");
  });
}

describe("wire: the middleware path against a genuinely unreachable database", () => {
  let server: ChildProcess | undefined;
  let serverLog = "";

  async function waitForReady(): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let lastError = "unknown";
    while (Date.now() < deadline) {
      if (server?.exitCode !== null && server?.exitCode !== undefined) {
        throw new Error(`next start exited early (code ${server.exitCode}):\n${serverLog}`);
      }
      try {
        await fetch(`${BASE_URL}/sign-in`, { redirect: "manual" });
        return;
      } catch (error) {
        lastError = (error as Error).message;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw new Error(
      `next start did not answer on ${BASE_URL} within ${READY_TIMEOUT_MS}ms (last error: ${lastError})\n${serverLog}`,
    );
  }

  before(async () => {
    if (!buildPresent) {
      throw new Error(
        "no production build: .next/BUILD_ID is missing. This wire suite does not " +
          "skip silently — run `npm run build` first (see AUTHDB-001's verification list).",
      );
    }
    if (await isPortBusy(WIRE_PORT)) {
      throw new Error(`port ${WIRE_PORT} is already in use — stop that process and re-run.`);
    }

    server = spawn(
      process.execPath,
      [path.join("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(WIRE_PORT)],
      {
        cwd: WEB_ROOT,
        detached: false,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          // Deliberately unreachable, so a request that reaches the
          // database-backed session/auth lookup genuinely fails, not merely
          // in a mocked sense.
          DATABASE_URL: DEAD_DATABASE_URL,
        },
      },
    );

    const record = (chunk: Buffer) => {
      serverLog += chunk.toString();
    };
    server.stdout?.on("data", record);
    server.stderr?.on("data", record);
    server.once("error", (error) => {
      serverLog += `spawn error: ${error.message}\n`;
    });

    await waitForReady();
  });

  after(async () => {
    if (!server || server.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => server?.once("exit", () => resolve()));
    server.kill();
    const grace = new Promise<void>((resolve) => setTimeout(resolve, 5_000).unref());
    await Promise.race([exited, grace]);
  });

  test("no session cookie: /read still redirects to /sign-in with zero ambiguity (fast path unaffected)", async () => {
    const response = await fetch(`${BASE_URL}/read`, { redirect: "manual" });
    await response.arrayBuffer();
    assert.equal(response.status, 307, serverLog);
    const location = response.headers.get("location") ?? "";
    assert.ok(location.includes("/sign-in"), `expected redirect to /sign-in, got ${location}`);
  });

  test("a session cookie + dead database on /read: NOT a redirect to /sign-in, an honest 503", async () => {
    const response = await fetch(`${BASE_URL}/read`, {
      redirect: "manual",
      headers: { cookie: "authjs.session-token=wire-test-forged-value" },
    });
    const body = await response.text();

    assert.notEqual(response.status, 307, `must not redirect (looks like "signed out"):\n${serverLog}`);
    assert.equal(response.headers.get("location"), null, "must carry no redirect Location header");
    assert.equal(response.status, 503, body || serverLog);
    assert.ok(body.includes("not been signed out"), `unexpected body:\n${body}`);
  });

  test("the same dead-database request against /review ALSO fails at the middleware, before the page's own probe runs", async () => {
    // /review has its own page-level setup-incomplete screen (REVIEW-001).
    // If this response came from that page instead of the middleware, the
    // page's HTML shell (styles.wrap, the "Sunday review" eyebrow) would be
    // present. It is not: proxy.ts's matcher intercepts /review before the
    // page component is ever invoked.
    const response = await fetch(`${BASE_URL}/review`, {
      redirect: "manual",
      headers: { cookie: "authjs.session-token=wire-test-forged-value" },
    });
    const body = await response.text();

    assert.equal(response.status, 503, body || serverLog);
    assert.ok(!body.includes("Sunday review"), "response came from the page, not the middleware, given its shell markup");
    assert.ok(body.includes("not been signed out"), body);
  });

  test("distinguishability on the wire: the only variable between a redirect and a 503 is the session cookie", async () => {
    const withoutCookie = await fetch(`${BASE_URL}/read`, { redirect: "manual" });
    await withoutCookie.arrayBuffer();
    const withCookie = await fetch(`${BASE_URL}/read`, {
      redirect: "manual",
      headers: { cookie: "authjs.session-token=wire-test-forged-value" },
    });
    await withCookie.arrayBuffer();

    assert.equal(withoutCookie.status, 307);
    assert.equal(withCookie.status, 503);
  });
});
