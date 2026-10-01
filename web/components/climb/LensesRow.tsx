import Link from "next/link";

import styles from "./LensesRow.module.css";

/**
 * NAV-001 — the Journey page's "Lenses" row (plan §A.2: "A Lenses row under
 * the Mountain: Story Map (arcs), Places (earth), Mirror (paired stages),
 * Threads (yours)"). Four real links, in the plan's own order.
 *
 * HONESTY ABOUT WHAT EACH LINK REALLY POINTS AT (see this task's own report
 * for the full accounting):
 *   - Story Map  -> `/map` (STORYMAP-001, a real overview page).
 *   - Places     -> `/places` (NAV-001's own minimal new route, mounting
 *                   PLACELENS-001's `PlaceLens` -- nothing hosted it before
 *                   this task).
 *   - Mirror     -> `/mirror/[stageSlug]` has no index page of its own (every
 *                   stage pairs with another EXCEPT the peak, stage 6 -- see
 *                   that route's own `NoMirrorPair` branch). `buildLensLinks`
 *                   below picks the real, lowest-numbered stage that DOES
 *                   have a mirror pair from the real stage data the caller
 *                   already loaded, rather than a hardcoded slug.
 *   - Threads    -> `/threads/[slug]` also has no index page. `buildLensLinks`
 *                   links to the learner's own most recent real thread when
 *                   one exists; a learner with none yet is sent to `/review`
 *                   instead (the closest real existing surface that already
 *                   shows this learner's threads -- cold threads, motif
 *                   candidates) rather than a fabricated destination.
 */

export interface LensStage {
  stage: number;
  slug: string;
  mirror: string | null;
}

export interface LensLink {
  key: "story-map" | "places" | "mirror" | "threads";
  label: string;
  href: string;
}

export interface BuildLensLinksParams {
  stages: LensStage[];
  /** This learner's most recently created real thread's slug, or null if they have none yet. */
  firstThreadSlug: string | null;
}

/** Pure — no I/O, directly unit-testable. */
export function buildLensLinks({ stages, firstThreadSlug }: BuildLensLinksParams): LensLink[] {
  const mirrorStage = [...stages].sort((a, b) => a.stage - b.stage).find((stage) => stage.mirror !== null);

  return [
    { key: "story-map", label: "Story Map", href: "/map" },
    { key: "places", label: "Places", href: "/places" },
    { key: "mirror", label: "Mirror", href: mirrorStage ? `/mirror/${mirrorStage.slug}` : "/" },
    { key: "threads", label: "Threads", href: firstThreadSlug ? `/threads/${firstThreadSlug}` : "/review" },
  ];
}

export interface LensesRowProps {
  lenses: LensLink[];
}

/** Hookless — a pure function of `lenses`. */
export function LensesRow({ lenses }: LensesRowProps) {
  return (
    <nav className={styles.row} aria-label="Lenses" data-testid="lenses-row">
      {lenses.map((lens) => (
        <Link key={lens.key} href={lens.href} className={styles.lens} data-tap data-lens-key={lens.key}>
          {lens.label}
        </Link>
      ))}
    </nav>
  );
}
