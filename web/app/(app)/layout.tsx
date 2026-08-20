import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { resolveSessionState } from "@/lib/auth/config";
import { ProtectedClientMounts } from "@/components/auth/DeviceSessionControls";
import { TabBar } from "@/components/shell/TabBar";
import styles from "./shell.module.css";

/**
 * The dark shell every protected screen renders inside — and the near-data
 * auth boundary for the whole (app) group.
 *
 * This is a Server Component and must stay one. web/proxy.ts already matches
 * these routes, but proxy matchers are a coarse, easily-mis-edited perimeter
 * (the current one excludes anything containing a dot, among other things),
 * and every screen below this layout renders the owner's journal. The check
 * therefore also happens here, next to the data, where it cannot be routed
 * around: no session with a usable user id, no render.
 *
 * AUTHDISAMBIG-001: a bare `auth()` call here could not tell "genuinely
 * signed out" apart from "the database is unreachable so the session lookup
 * came back null anyway" — see `lib/auth/config.ts`'s `resolveSessionState`
 * (the same shape `app/(app)/review/page.tsx`, `app/(app)/page.tsx`, and
 * `app/(app)/study/[sessionId]/page.tsx` each already use, one layer down).
 * A database outage now renders a "setup incomplete" notice here instead of
 * being relabelled a sign-out and redirected — the whole point of this
 * boundary existing a second time above those pages.
 *
 * `session.user.id` rather than `session` is the condition on purpose —
 * lib/auth/config.ts blanks that id when the session's email is no longer on
 * the allowlist, so an existing database session fails closed here too;
 * `resolveSessionState` treats a blanked id exactly like no session.
 *
 * The client-only sync mount lives in the ProtectedClientMounts component
 * because `next/dynamic` with `ssr: false` is only legal in a Client Component,
 * and making THIS file the client component (as an earlier revision did) threw
 * the server auth check away. See components/auth/DeviceSessionControls.tsx
 * for why that component lives in that particular file.
 */
function SetupIncomplete() {
  return (
    <div style={{ padding: "2rem 1.25rem" }}>
      <p style={{ opacity: 0.7, margin: 0 }}>Scarlet Thread</p>
      <h1 style={{ margin: "0.25rem 0 0.75rem" }}>Setup incomplete</h1>
      <p data-testid="setup-notice" style={{ margin: 0 }}>
        This app couldn&apos;t reach the database to check your sign-in. You
        have not been signed out — this is a configuration problem. Check the
        database connection and try again.
      </p>
    </div>
  );
}

export default async function AppShellLayout({
  children,
}: {
  children: ReactNode;
}) {
  const sessionState = await resolveSessionState();

  if (sessionState.status === "setup-incomplete") {
    return <SetupIncomplete />;
  }

  // Guard: no session and the database answered fine, so this really is a
  // signed-out visitor. Never render the shell (or `children`) below this
  // line.
  if (sessionState.status !== "authenticated") {
    redirect("/sign-in");
  }

  return (
    <div className={styles.shell}>
      {/* One mount for the whole protected tree (A-031), and it renders only
          after the auth check above. Deliberately NOT in app/layout.tsx or the
          (auth) group: an unauthenticated /sign-in visitor must never fire
          /api/sync/*. It renders null, so its position here is for readers,
          not for the DOM. */}
      <ProtectedClientMounts />
      <div className={styles.content}>{children}</div>
      <TabBar />
    </div>
  );
}
