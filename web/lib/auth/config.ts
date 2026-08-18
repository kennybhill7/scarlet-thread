import "server-only";

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { NextResponse } from "next/server";

import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { isAllowedEmail } from "@/lib/auth/allowlist";
import { db } from "@/lib/db";
import { listThreads } from "@/lib/db/threads";

// ---------------------------------------------------------------------------
// AUTHDB-001 — telling "signed out" apart from "database down", one layer
// ABOVE app/(app)/review/page.tsx's own probe (see that file's comment block
// for the identical mechanism at the page level). `authorized` below is
// next-auth's MIDDLEWARE-ONLY hook: next-auth/lib/index.js's `handleAuth`
// only calls it from the direct-Request branch that web/proxy.ts's
// `export { auth as proxy }` wires up as the Next.js proxy/middleware. The
// zero-arg `auth()` call used inside Server Components (e.g. review/page.tsx)
// is a completely different branch of that same file and is untouched by
// anything here — this is what actually runs BEFORE any page component,
// which is the whole reason REVIEW-001's page-level fix alone did not close
// the gap for a real browser navigation.
//
// Mechanism: with `session: { strategy: "database" }`, next-auth's session
// lookup is itself a database read. @auth/core/lib/actions/session.js wraps
// that read in its own try/catch and swallows a throw silently (logs and
// returns an otherwise-normal, cookie-only response), so a live session
// whose DB read fails collapses to the exact same `auth: null` that a
// visitor with no session at all produces. Trusting that null and
// redirecting to /sign-in tells the real owner they are signed out when the
// database is actually just unreachable.
//
// The fix: only ask the database directly (a second, cheap read) when there
// is a session cookie for the null to be ambiguous ABOUT. A request that
// never sent a session cookie was never claiming to be signed in, healthy
// database or not, and must keep taking the exact same no-DB-touch fast
// path it takes today — tests/security-headers.test.ts's wire suite asserts
// this fast path (anonymous request, deliberately dead DATABASE_URL,
// redirects to /sign-in with zero DB access) and must not be weakened.
// ---------------------------------------------------------------------------

/** Every cookie name next-auth may use for the database-session token. */
const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
] as const;

/**
 * A user id that cannot exist. A normal tenant-scoped read against it is
 * empty on a healthy database and reveals nothing; only its throw/no-throw
 * behaviour is used to tell the database's health apart from the session's
 * validity — mirrors the identical probe in
 * app/(app)/review/page.tsx's `resolveSessionState`.
 */
const PROBE_USER_ID = "00000000-0000-0000-0000-000000000000";

/** Structural, not next-auth's own `NextRequest` type, so tests can pass a bare stub. */
export type CookieBearer = { cookies: { has(name: string): boolean } };

export function hasSessionCookie(request: CookieBearer): boolean {
  return SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));
}

/** Structural session shape — enough to check identity, nothing next-auth-specific required. */
export type SessionLike = {
  user?: { id?: string | null; email?: string | null } | null;
} | null;

export type AuthorizedDeps = {
  hasSessionCookie: (request: CookieBearer) => boolean;
  /** Throws on a database that cannot be reached; resolves (value ignored) otherwise. */
  probeDatabase: () => Promise<unknown>;
};

const defaultAuthorizedDeps: AuthorizedDeps = {
  hasSessionCookie,
  probeDatabase: () => listThreads(PROBE_USER_ID),
};

/** The one "we cannot reach your data" response. Carries no journal content. */
export function setupIncompleteResponse(): NextResponse {
  return new NextResponse(
    "Setup incomplete: this app could not reach its database. You have " +
      "not been signed out — this is a configuration problem, not an " +
      "authentication failure. Check the database connection and try again.",
    {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    },
  );
}

/**
 * The pure middleware auth decision, factored out so every branch is
 * independently testable without booting next-auth, a request, or a
 * database. State of each branch, spelled out per AUTHDB-001's requirement:
 *
 *  - authenticated + allowed email       -> `true`               (FAILS CLOSED: only path in)
 *  - no session cookie at all            -> `false` (redirect)    (FAILS CLOSED: never touches the DB)
 *  - cookie present, database unreachable -> `setupIncompleteResponse()` (FAILS CLOSED on identity —
 *    never authenticated, no journal content in this response; OPENS UP only the error message)
 *  - cookie present, database healthy, no valid session -> `false` (redirect) (FAILS CLOSED: genuinely signed out)
 */
export async function resolveAuthorizedDecision(
  request: CookieBearer,
  session: SessionLike,
  deps: AuthorizedDeps = defaultAuthorizedDeps,
): Promise<boolean | NextResponse> {
  if (session?.user?.id && isAllowedEmail(session.user.email)) return true;

  if (!deps.hasSessionCookie(request)) return false;

  try {
    await deps.probeDatabase();
  } catch {
    return setupIncompleteResponse();
  }

  return false;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [Google],
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  session: {
    strategy: "database",
  },
  callbacks: {
    signIn({ profile, user }) {
      // This is a private, single-user journal. Missing configuration denies all.
      return (
        profile?.email_verified === true &&
        isAllowedEmail(profile.email ?? user.email)
      );
    },
    authorized({ request, auth: session }) {
      return resolveAuthorizedDecision(request, session);
    },
    session({ session, user }) {
      if (session.user) {
        // API routes check this ID. Clearing it makes an existing database
        // session fail closed if the configured owner email ever changes.
        session.user.id = isAllowedEmail(session.user.email) ? user.id : "";
      }
      return session;
    },
  },
});
