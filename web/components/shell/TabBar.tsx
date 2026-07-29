"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./TabBar.module.css";

const TABS = [
  { href: "/", label: "Climb", icon: "▲" },
  { href: "/read", label: "Read", icon: "☰" },
  { href: "/review", label: "Review", icon: "◈" },
] as const;

/**
 * Bottom tab bar. Three destinations, deliberately — the daily loop, the
 * text itself, and the weekly reflection. Anything that isn't one of those
 * three lives inside one of them rather than earning a fourth tab.
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
