/**
 * MIRRORSPLIT-001 — proportional scroll sync between the Mirror Split's two
 * reading panes.
 *
 * HONESTY NOTE (see this task's report): Ken's product strategy doc
 * describes Mirror Split as "scroll-locked at their matching beats," which
 * reads as a claim about verse-level thematic correlation — e.g. "this
 * exact verse in Genesis 3 lines up with this exact verse in Revelation
 * 20." No such correlation data exists anywhere in this codebase (unlike
 * lib/bible/versemap.ts's English<->Spanish VERSE alignment, which is real,
 * sourced data built by tools/build_bible.py). This file does not invent
 * one. What it implements instead is honest and real: PERCENTAGE-THROUGH-
 * CONTENT sync — 40% down the left pane keeps the right pane at 40% down
 * its own (differently-sized) content. That is the only claim the feature
 * makes, and it is what components/mirror/MirrorSplitView.tsx's own on-page
 * copy says in those words.
 *
 * Pure, DOM-free math plus a tiny feedback-loop guard — no React, no
 * "use client" — so both are unit-testable and mutation-provable without a
 * browser.
 */

export type PaneId = "left" | "right";

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * How far through its own content a pane is scrolled, 0 (top) to 1
 * (bottom). A pane with nothing to scroll (`scrollHeight <= clientHeight` —
 * a short passage that fits the viewport, or metrics read before layout has
 * happened) is defined as 0 rather than dividing by zero or by a negative
 * number.
 */
export function scrollFraction(metrics: ScrollMetrics): number {
  const max = metrics.scrollHeight - metrics.clientHeight;
  if (max <= 0) return 0;
  return clamp01(metrics.scrollTop / max);
}

/**
 * The scrollTop the OTHER pane should be set to so it sits at the same
 * fraction-through-content as `source` — the actual "matching-index math"
 * this feature ships (see the file header for what it deliberately does
 * NOT claim). Rounded to a whole pixel; fractional scrollTop is legal in
 * browsers but is pointless precision for this purpose and would make
 * round-trip assertions in tests fragile for no benefit.
 */
export function mirroredScrollTop(
  source: ScrollMetrics,
  target: Pick<ScrollMetrics, "scrollHeight" | "clientHeight">,
): number {
  const fraction = scrollFraction(source);
  const max = Math.max(0, target.scrollHeight - target.clientHeight);
  return Math.round(fraction * max);
}

/**
 * Breaks the feedback loop that would otherwise exist between two panes
 * each mirroring the other's scroll: when pane A's scroll handler
 * programmatically sets pane B's scrollTop, the browser fires pane B's own
 * `scroll` event too. Without a guard, B's handler would immediately
 * compute A's mirrored position from B's new position and set THAT — which
 * is (1) redundant, since A is already exactly where it should be, and (2)
 * a source of drift on rounding across repeated round trips.
 *
 * `arm(pane)` marks the NEXT `scroll` event on that pane as one WE caused,
 * not the reader. `shouldIgnore(pane)` consumes that mark exactly once, so
 * a genuine reader-driven scroll on that same pane immediately afterward is
 * never silently swallowed too.
 */
export class ScrollSyncGuard {
  private suppressed: PaneId | null = null;

  arm(pane: PaneId): void {
    this.suppressed = pane;
  }

  shouldIgnore(pane: PaneId): boolean {
    if (this.suppressed !== pane) return false;
    this.suppressed = null;
    return true;
  }
}
