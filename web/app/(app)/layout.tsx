import type { ReactNode } from "react";
import { TabBar } from "@/components/shell/TabBar";
import styles from "./shell.module.css";

/**
 * The dark shell every protected screen renders inside. Route protection
 * itself happens in web/proxy.ts, not here — this layout only supplies chrome.
 */
export default function AppShellLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <div className={styles.content}>{children}</div>
      <TabBar />
    </div>
  );
}
