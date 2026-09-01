import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Chip.module.css";

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  tone?: "gold" | "green";
  /**
   * How many OTHER chapters this tag's thread appears in (the design's
   * "Thread tag — ... count always shown", `design/scarlet-thread-app/
   * Scarlet Thread App.dc.html`'s "Thread lens" redline). Optional and
   * rendered only when provided (SCARLETTHREAD-001): Chip is also the
   * general-purpose filter/toggle control used across ConnectSection,
   * TeachSection, ApplySection, ThreadDetail and ChapterReader, none of
   * which have a real "other chapters" count to show, so forcing this on
   * would mean fabricating a number. No current call site passes it.
   */
  count?: number;
  children: ReactNode;
}

/** A thread name, a version code — anything tappable and short. */
export function Chip({ active, tone = "gold", count, className, children, ...props }: ChipProps) {
  const classes = [styles.chip, styles[tone], active && styles.active, className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={classes} {...props}>
      {children}
      {count !== undefined ? <span className={styles.count}>· {count}</span> : null}
    </button>
  );
}
