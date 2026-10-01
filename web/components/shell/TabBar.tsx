"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./TabBar.module.css";

const TABS = [
  { href: "/", label: "Journey", icon: "▲" },
  { href: "/read", label: "Read", icon: "☰" },
  { href: "/review", label: "Review", icon: "◈" },
] as const;

/**
 * Bottom tab bar. Three destinations, deliberately — the daily loop, the
 * text itself, and the weekly reflection. Anything that isn't one of those
 * three lives inside one of them rather than earning a fourth tab.
 *
 * NAV-001 — relabeled "Climb" to "Journey" (plan §A.2: "Three tabs, unchanged
 * in number, relabeled in job"). The route is unchanged ("/"); only the word
 * a reader sees changed. This label is also the one real, persistent
 * "back to Journey" control present on every screen in the `(app)` route
 * group (`app/(app)/layout.tsx` mounts this TabBar once, below `children`,
 * on every page) — the Lenses row (`components/climb/LensesRow.tsx`) and the
 * new `/places` lens page lean on that fact rather than each re-implementing
 * their own nav chrome, except where this task's own brief asked for an
 * explicit, surface-level control in addition to it (see
 * `components/climb/BackToJourney.tsx`'s own header).
 */
export function TabBar() {
  const pathname = usePathname();

  return (
    <nav className={styles.bar} aria-label="Primary">
      {TABS.map((tab) => {
        const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? `${styles.tab} ${styles.active}` : styles.tab}
            aria-current={active ? "page" : undefined}
          >
            <span className={styles.icon} aria-hidden="true">
              {tab.icon}
            </span>
            <span className={styles.label}>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
