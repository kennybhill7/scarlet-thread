import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
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
 * `session.user.id` rather than `session` is the condition on purpose —
 * lib/auth/config.ts blanks that id when the session's email is no longer on
 * the allowlist, so an existing database session fails closed here too.
 *
 * The client-only sync mount lives in the ProtectedClientMounts component
 * because `next/dynamic` with `ssr: false` is only legal in a Client Component,
 * and making THIS file the client component (as an earlier revision did) threw
 * the server auth check away. See components/auth/DeviceSessionControls.tsx
 * for why that component lives in that particular file.
 */
export default async function AppShellLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) {
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
