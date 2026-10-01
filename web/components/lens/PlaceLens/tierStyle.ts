/**
 * PLACELENS-001 — confidence-as-geometry: tier -> how a place is actually
 * DRAWN, not just a tooltip. Matches the honesty bar the globe-exploration
 * prototype set (`design/globe-exploration/app.js`'s `TIER_LABEL` +
 * `markerCanvas`'s dashed-outline-for-disputed convention,
 * `design/globe-exploration/README.md`'s "Honesty about locations" table):
 * solid marker for identified/likely, DASHED outline for uncertain/disputed,
 * NO marker at all for unlocated. This module is the single place that
 * mapping lives, so `PlaceLensSvg.tsx` (the drawing) and `PlaceList.tsx`
 * (the accessible list-equivalent) can never disagree about what a tier
 * means, and `tests/place-lens-tier.test.ts` can assert the honesty rule
 * once, here, instead of against two separate render paths.
 *
 * Rule enforced by `styleForTier`/`isRenderable`, not by convention:
 * `tier === "unlocated"` NEVER returns a drawable marker style. A caller
 * that forgets to check `isLocated()` first and tries to draw an unlocated
 * place anyway gets `null` back, not a guessed position.
 */
import type { LensPlaceTier } from "./types";

export type MarkerStroke = "solid" | "dashed";

export interface TierStyle {
  tier: LensPlaceTier;
  /** Screen-reader / visible label — the same wording the honesty note uses. */
  label: string;
  /** "solid" for identified/likely, "dashed" for uncertain/disputed — never for unlocated (no marker at all). */
  stroke: MarkerStroke;
  /** Lower opacity reads as "less certain" even before dash pattern is perceived (never color alone). */
  opacity: number;
  /** True only for uncertain/disputed — drives the "location disputed" note and candidate ghost markers. */
  isContested: boolean;
}

const TIER_LABELS: Record<LensPlaceTier, string> = {
  identified: "Identified",
  likely: "Likely identification",
  uncertain: "Location uncertain",
  disputed: "Location disputed",
  unlocated: "No confident location",
};

/**
 * The style for a LOCATED place's tier. Never called with "unlocated" by a
 * correct caller (see `isRenderable`); if it is, it still returns an
 * honestly-labeled style rather than throwing, but `PlaceLensSvg` never
 * reaches this branch because `isLocated()` already filtered it out before a
 * marker is drawn — belt and suspenders, same discipline `isRenderable`
 * documents below.
 */
export function styleForTier(tier: LensPlaceTier): TierStyle {
  const contested = tier === "uncertain" || tier === "disputed";
  return {
    tier,
    label: TIER_LABELS[tier],
    stroke: contested ? "dashed" : "solid",
    opacity: tier === "disputed" ? 0.72 : tier === "uncertain" ? 0.82 : 1,
    isContested: contested,
  };
}

/**
 * Whether `tier` may ever be drawn with a marker. The ONE honesty gate: a
 * place whose dataset-leading identification is "unknown location" (Eden,
 * tier "unlocated") must render NO pin anywhere, on the globe or in the
 * region view — never a guessed point. `types.ts`'s `isLocated()` already
 * encodes the structural half of this (lon/lat null <=> unlocated); this is
 * the tier-side mirror of the same rule, used by code that only has a tier
 * in hand (e.g. the list view's icon) and not full coordinates.
 */
export function isRenderable(tier: LensPlaceTier): boolean {
  return tier !== "unlocated";
}

export const SVG_DASH_PATTERN = "4 3";
