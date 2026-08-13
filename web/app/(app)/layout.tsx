"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { TabBar } from "@/components/shell/TabBar";
import styles from "./shell.module.css";

/*
 * Browser-only on purpose. lib/sync/store.ts opens IndexedDB at module scope
 * (store.ts:58), so *server-rendering* SyncRegistration throws
 * "ReferenceError: indexedDB is not defined" and takes the whole route with it
 * — verified: mounting it through a static import here fails `next build`
 * while prerendering /read. `ssr: false` keeps that module out of the server
 * graph entirely, and it is only legal inside a Client Component, which is why
 * this layout is one. The layout renders chrome only, so nothing server-side
 * is lost. Both can go once store.ts opens its database lazily.
 */
const SyncRegistration = dynamic(
  () =>
    import("@/components/sync/SyncRegistration").then(
      (module) => module.SyncRegistration,
    ),
  { ssr: false },
);

/**
 * The dark shell every protected screen renders inside. Route protection
 * itself happens in web/proxy.ts, not here — this layout only supplies chrome.
 */
export default function AppShellLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      {/* One mount for the whole protected tree (A-031). Deliberately NOT in
          app/layout.tsx or the (auth) group: an unauthenticated /sign-in
          visitor must never fire /api/sync/*. SyncRegistration renders null,
          so its position here is for readers, not for the DOM. */}
      <SyncRegistration />
      <div className={styles.content}>{children}</div>
      <TabBar />
    </div>
  );
}
