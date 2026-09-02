import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Chip.module.css";

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  /**
   * "structural" (CONNREGISTERS-001) — a deeper, bolder gold than the
   * default "gold" tone: `--gold-deep` text/border on the same
   * `--gold-dim-bg` portable badge background, so it stays a real, visible
   * step up from the plain gold every other chip already uses by default,
   * never confusable with it. See `Chip.module.css`'s `.structural` for the
   * verified contrast (recomputed independently, not eyeballed — see that
   * task's report).
   */
  tone?: "gold" | "green" | "structural";
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
