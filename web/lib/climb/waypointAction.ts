/**
 * MOUNTAINDESKTOP-001 — pure "which stage-5 gets special treatment" decision,
 * extracted out of components/climb/Mountain.tsx (which originally defined
 * ISRAEL_STAGE_NUMBER/isIsraelWaypoint/resolveWaypointAction directly, per
 * ISRAELFILTER-001's own header there) so that BOTH the mobile shell
 * (Mountain.tsx, which still re-exports these three names unchanged for
 * tests/israel-sub-arc.test.ts) and the new desktop assembly
 * (components/climb/MountainDesktop.tsx) can import it without Mountain.tsx
 * and MountainDesktop.tsx importing each other (Mountain.tsx renders
 * MountainDesktop; MountainDesktop needs this same stage-5 decision for its
 * own waypoint click AND its scene-takeover "read on" CTA — see that file's
 * header). No behavior changed by this move: same stage number, same
 * function bodies, same exported names, just a new home.
 *
 * No React, no DOM — plain functions over `MountainStage`, same discipline
 * as lib/climb/mountainGeometry.ts and lib/climb/plateGeometry.ts (this repo's
 * test runner has no jsdom; every function here must be callable with
 * nothing but a `MountainStage[]`/`MountainStage`).
 */
import type { MountainStage } from "@/lib/vault/seed";

/**
 * Stage 5 ("Israel," Genesis 12 through Malachi, 65% of the app's total
 * reading content per design/STORY_SPINE_DECISIONS.md decision 4) is the one
 * stage of 11 broad enough to get a filtered sub-arc view instead of jumping
 * straight into the chapter reader — on both assemblies.
 */
export const ISRAEL_STAGE_NUMBER = 5;

export function isIsraelWaypoint(stage: Pick<MountainStage, "stage">): boolean {
  return stage.stage === ISRAEL_STAGE_NUMBER;
}

export type WaypointAction = { kind: "open-israel-sub-arc" } | { kind: "navigate"; href: string };

/**
 * Pure decision every waypoint click handler funnels through — the mobile
 * plates, the mobile ribbon, the desktop waypoints, AND the desktop scene
 * takeover's own "read on" CTA (MountainDesktop.tsx) all call this same
 * function rather than re-deciding stage 5 independently, so the four call
 * sites cannot drift out of agreement with each other.
 */
export function resolveWaypointAction(stage: MountainStage, href: string): WaypointAction {
  return isIsraelWaypoint(stage) ? { kind: "open-israel-sub-arc" } : { kind: "navigate", href };
}
