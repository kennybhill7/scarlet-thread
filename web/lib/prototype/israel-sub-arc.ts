/**
 * ISRAELPROTO-001 — pure data + geometry for the Israel sub-arc prototype.
 *
 * Ken (product owner) flagged the real Mountain's stage 5 ("Israel," Genesis
 * 12 through Malachi, 39 books) as carrying the same visual weight as a
 * two-chapter stage like Babel, and wants it broken into six sub-phases —
 * but he also flagged this as the riskiest UX bet in the whole redesign
 * ("tap Israel → tap a phase → tap a chapter" could turn the app from
 * climbing a mountain into drilling into a file system). This module, and
 * everything under `components/prototype/` and
 * `app/(app)/prototype/israel-sub-arc/`, exists so he can click through the
 * navigation FEEL before anything commits to a real schema change.
 *
 * DELIBERATELY NOT the real data model: no row here comes from or writes to
 * `db/schema.ts`, `data/seed/stages.json`, or any migration. This is
 * structure only, supplied by Ken directly (real book names, real chapter
 * ranges) — no invented king names, dates, or prophet-to-reign
 * correlations. That belongs to a separate, not-yet-built "timeline rail"
 * feature.
 */

export interface IsraelSubArcPhase {
  /** Stable id for keys, aria-labels, and the selected-phase URL-free state. */
  slug: string;
  /** Display/ridge order, 1-6, Patriarchs through Return. */
  order: number;
  name: string;
  /** Human chapter range — real book names only, no verse-level claims. */
  range: string;
  /**
   * Kingdom only. The sub-arc's own peak: the Davidic covenant is cut here,
   * and most of the prophetic books look back from this vantage point — see
   * this task's own spec. Gets the same "peak" visual treatment the real
   * Mountain gives its stage 6.
   */
  peak: boolean;
}

export const ISRAEL_SUB_ARC_PHASES: readonly IsraelSubArcPhase[] = [
  { slug: "patriarchs", order: 1, name: "Patriarchs", range: "Genesis 12–50", peak: false },
  { slug: "exodus", order: 2, name: "Exodus", range: "Exodus–Deuteronomy", peak: false },
  { slug: "conquest", order: 3, name: "Conquest", range: "Joshua–Judges", peak: false },
  { slug: "kingdom", order: 4, name: "Kingdom", range: "Samuel–Kings, Psalms", peak: true },
  { slug: "exile", order: 5, name: "Exile", range: "Kings–Prophets", peak: false },
  { slug: "return", order: 6, name: "Return", range: "Ezra–Malachi", peak: false },
];

export const ISRAEL_SUB_ARC_PLACEHOLDER_NOTE =
  "Chapters, threads, and observations for this phase would live here.";

export const ISRAEL_SUB_ARC_BANNER =
  "Prototype — testing navigation feel only, not wired into your real study data.";

/** Fixed at Kingdom (order 4) per Ken's own six-phase ordering — not derived from array length the way Mountain.tsx derives its stage-6 peak from stage count, since this arc's peak position is content Ken specified directly. */
export const ISRAEL_SUB_ARC_PEAK_ORDER = 4;

/**
 * Ridge elevation — same ascent-to-a-peak-then-descent shape as
 * Mountain.tsx's own `elevationOf`, ported rather than imported (that
 * function is unexported, and Mountain.tsx is explicitly out of scope for
 * this task to touch or depend on). Higher return value = higher on the
 * ridge.
 */
export function elevationOf(order: number, peakOrder: number): number {
  return peakOrder - 1 - Math.abs(order - peakOrder);
}

export function phaseBySlug(slug: string): IsraelSubArcPhase | undefined {
  return ISRAEL_SUB_ARC_PHASES.find((phase) => phase.slug === slug);
}
