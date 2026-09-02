/**
 * MOUNTAINPLATES-001 — pure geometry for "the Switchback: real plates, drawn
 * path" (design/scarlet-thread-app/Scarlet Thread App.dc.html, section 15,
 * "Answering MOUNTAIN_IMPLEMENTATION_GAP.md"). Five stacked photographic
 * "plate" images (design/scarlet-thread-app/assets/plates/plate-*.jpg,
 * mirrored into web/public/climb/plates/ so the app can actually serve them
 * same-origin, per next.config.ts's `img-src 'self' data:` CSP) with a rope
 * + waypoints drawn on top in SVG. No React, no DOM — same discipline as
 * mountainGeometry.ts's own header: this module is imported by both the
 * client Mountain.tsx shell and by plain `node:test` (no jsdom here), so
 * every function must be callable with nothing but a `MountainStage[]`.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE BAKED CONSTANTS BELOW COME FROM (read once, cited inline after):
 *
 * design/scarlet-thread-app/assets/plates/route.json (read directly,
 * 2026-09-02) is `{ d, pts, bandTops }` in a ~1000-unit-wide reference frame
 * (matches the real plate width of 1531px at scale 1531/1000 = 1.531).
 * `pts` is 11 points, one per stage, IN STAGE ORDER 1-11 — that ordering,
 * not `bandTops`, is what this module keys off. (`bandTops` in that file is
 * a set of six *contour gridlines* the design doc draws for illustration —
 * evenly spaced ~56 units apart starting at the summit's own y — it is NOT
 * the plate boundary list; do not confuse the two. The real plate
 * boundaries below come from the five plates' own committed pixel heights.)
 *
 * The five plates (design/scarlet-thread-app/assets/plates/plate-*.jpg) are
 * all 1531px wide; their real heights are 240 / 85 / 85 / 86 / 149px
 * (summit / upper / mid / lower / foothills, summing to 645px). Dividing
 * each by the same 1.531 scale factor gives each plate's span in the
 * route.json reference frame — PLATE_REF_BOUNDARIES below.
 *
 * Checking each of route.json's 11 `pts` y-values against those boundaries
 * gives an unambiguous per-stage plate assignment, and it exactly matches
 * the mirror-pair structure already in the data model (stage N mirrors
 * stage 12-N): plate-1-summit carries stages 5/6/7, plate-2-upper 4/8,
 * plate-3-mid 3/9 (the Flood/World Judged pair — the design doc's own
 * example), plate-4-lower 2/10, plate-5-foothills 1/11. See
 * BAND_STAGE_NUMBERS. tests/plate-geometry.test.ts re-derives this
 * assignment straight from route.json at test time (not from these baked
 * constants), so it is provably not a guess.
 * ---------------------------------------------------------------------------
 */
import type { MountainStage } from "@/lib/vault/seed";
import { MIN_SEGMENT_PX, SCENE_WIDTH, isReached, segmentPx, stageHref } from "@/lib/climb/mountainGeometry";

// ---------------------------------------------------------------------------
// Plates
// ---------------------------------------------------------------------------

export const PLATE_NAMES = [
  "plate-1-summit",
  "plate-2-upper",
  "plate-3-mid",
  "plate-4-lower",
  "plate-5-foothills",
] as const;
export type PlateName = (typeof PLATE_NAMES)[number];

/** Public path each plate is served from (mirrored into web/public/climb/plates/). */
export const PLATE_SRC: Record<PlateName, string> = {
  "plate-1-summit": "/climb/plates/plate-1-summit.jpg",
  "plate-2-upper": "/climb/plates/plate-2-upper.jpg",
  "plate-3-mid": "/climb/plates/plate-3-mid.jpg",
  "plate-4-lower": "/climb/plates/plate-4-lower.jpg",
  "plate-5-foothills": "/climb/plates/plate-5-foothills.jpg",
};

/** Real committed plate pixel heights, all at 1531px width (see header). */
const PLATE_REAL_HEIGHTS_PX: readonly number[] = [240, 85, 85, 86, 149];
/** route.json's reference frame is 1000 units wide; the real plates are
 * 1531px wide, so this is the reference-space -> real-pixel scale factor. */
const PLATE_SCALE = 1531 / 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Cumulative plate boundaries in route.json's reference frame: index i is
 * the top of plate i, index i+1 is its bottom. Length 6 (5 plates). */
export const PLATE_REF_BOUNDARIES: readonly number[] = (() => {
  const out: number[] = [0];
  for (const h of PLATE_REAL_HEIGHTS_PX) out.push(round2(out[out.length - 1] + h / PLATE_SCALE));
  return out;
})();

/** Band (plate) -> member stage numbers, verified against route.json's own
 * pts/plate-boundary data (see header + tests/plate-geometry.test.ts). */
export const BAND_STAGE_NUMBERS: readonly (readonly number[])[] = [
  [5, 6, 7],
  [4, 8],
  [3, 9],
  [2, 10],
  [1, 11],
];

function bandIndexForStageNumber(stageNumber: number): number {
  return BAND_STAGE_NUMBERS.findIndex((members) => members.includes(stageNumber));
}

// ---------------------------------------------------------------------------
// Per-stage (x-fraction, y-fraction-within-band), baked from route.json's
// `pts` array (11 points, stage order 1-11 — read directly, 2026-09-02):
//
//   [[142.8,356.7],[225.1,300.7],[306.5,244.9],[383,188.9],[455,132.9],
//    [498.6,105],[526,133],[597.4,188.9],[677.7,244.9],[756.8,300.7],
//    [893.9,356.8]]
//
// x-fraction is pts[i].x / 1000 directly. y-fraction-within-band is
// (pts[i].y - thisStage'sPlateRefTop) / thisPlate'sRefHeight, both computed
// below rather than hand-rounded, so this file stays the single source of
// truth if route.json's raw points ever need re-reading.
// ---------------------------------------------------------------------------
const ROUTE_PTS_REF: readonly { x: number; y: number }[] = [
  { x: 142.8, y: 356.7 }, // stage 1
  { x: 225.1, y: 300.7 }, // stage 2
  { x: 306.5, y: 244.9 }, // stage 3
  { x: 383, y: 188.9 }, // stage 4
  { x: 455, y: 132.9 }, // stage 5
  { x: 498.6, y: 105 }, // stage 6 (peak)
  { x: 526, y: 133 }, // stage 7
  { x: 597.4, y: 188.9 }, // stage 8
  { x: 677.7, y: 244.9 }, // stage 9
  { x: 756.8, y: 300.7 }, // stage 10
  { x: 893.9, y: 356.8 }, // stage 11
];

interface StageFractions {
  bandIndex: number;
  xFraction: number;
  yFractionWithinBand: number;
}

const STAGE_FRACTIONS: ReadonlyMap<number, StageFractions> = new Map(
  ROUTE_PTS_REF.map((pt, idx) => {
    const stageNumber = idx + 1;
    const bandIndex = bandIndexForStageNumber(stageNumber);
    const top = PLATE_REF_BOUNDARIES[bandIndex];
    const bottom = PLATE_REF_BOUNDARIES[bandIndex + 1];
    return [
      stageNumber,
      {
        bandIndex,
        xFraction: round2(pt.x / 1000),
        yFractionWithinBand: round2((pt.y - top) / (bottom - top)),
      },
    ];
  }),
);

// ---------------------------------------------------------------------------
// Column width: reuses mountainGeometry.ts's own SCENE_WIDTH (320) as the
// rope SVG's viewBox width, NOT route.json's 1000-unit frame. The design
// doc's stroke widths (see ROPE_STROKES below) were tuned for display at
// ~1000px; this app renders the mountain in a ~320-CSS-px-wide column (same
// convention mountainGeometry.ts's own SCENE_WIDTH comment documents), so
// reusing that constant keeps the SVG's x-scale close to 1:1 with its real
// rendered width — minimizing the same width-vs-height scale mismatch
// MountainScene.tsx already accepts (viewBox width vs. `width="100%"`).
// xFraction is scale-invariant (0..1), so multiplying by SCENE_WIDTH instead
// of 1000 changes nothing about *where* a waypoint sits, only the unit size.
// ---------------------------------------------------------------------------
export const PLATE_COLUMN_WIDTH = SCENE_WIDTH;

/** design doc's Layer 2 stroke widths (11 / 8 / 1.5) were specified against
 * a 1000-unit-wide reference frame; scaled down proportionally to
 * PLATE_COLUMN_WIDTH so the rope keeps the same width-relative-to-terrain
 * proportion the design doc specified, regardless of column width. */
const ROPE_REF_STROKE_WIDTHS = { shadow: 11, face: 8, highlight: 1.5 } as const;
const ROPE_STROKE_SCALE = PLATE_COLUMN_WIDTH / 1000;
export const ROPE_STROKE_WIDTHS = {
  shadow: round2(ROPE_REF_STROKE_WIDTHS.shadow * ROPE_STROKE_SCALE),
  face: round2(ROPE_REF_STROKE_WIDTHS.face * ROPE_STROKE_SCALE),
  highlight: round2(ROPE_REF_STROKE_WIDTHS.highlight * ROPE_STROKE_SCALE),
};

/** design doc's Layer 2 exact stroke colors/opacities/offsets — see this
 * task's brief and Scarlet Thread App.dc.html section 15's "the rope". */
export const ROPE_SHADOW_COLOR = "#4a0c10";
export const ROPE_HIGHLIGHT_COLOR = "#f7877f";
export const ROPE_GRADIENT_STOPS = [
  { offset: 0, color: "#f2635c" },
  { offset: 0.42, color: "#e5352f" },
  { offset: 1, color: "#a8161c" },
] as const;

// ---------------------------------------------------------------------------
// Reflow: each band's real rendered height is the sum of its member stages'
// segmentPx() (mountainGeometry.ts's own proportional-spacing formula) — a
// band with more combined chapters renders taller, exactly like the
// switchback road's own segments do.
// ---------------------------------------------------------------------------

export interface PlateBand {
  name: PlateName;
  stageNumbers: readonly number[];
  /** Real rendered height in px, reflowed from member stages' chapterCount. */
  heightPx: number;
  /** Cumulative offset from the top of the column. */
  topPx: number;
}

export function computePlateBands(stages: readonly MountainStage[]): PlateBand[] {
  const byStageNumber = new Map(stages.map((s) => [s.stage, s]));
  let top = 0;
  return BAND_STAGE_NUMBERS.map((stageNumbers, i) => {
    const members = stageNumbers
      .map((n) => byStageNumber.get(n))
      .filter((s): s is MountainStage => s !== undefined);
    // No data for this band in a partial fixture (e.g. a test with < 11
    // stages) -- still reserve a real MIN_SEGMENT_PX so the column never
    // collapses to zero height for a band nothing landed in.
    const heightPx = members.length > 0 ? members.reduce((sum, s) => sum + segmentPx(s), 0) : MIN_SEGMENT_PX;
    const band: PlateBand = { name: PLATE_NAMES[i], stageNumbers, heightPx: round2(heightPx), topPx: round2(top) };
    top += heightPx;
    return band;
  });
}

/**
 * No extra top/bottom margin beyond the summed band heights: route.json's
 * own y-fractions already reserve headroom above the summit (stage 6 sits
 * at ~67% down plate-1, not at its very top -- "there's headroom/sky above
 * it in the art", per this task's brief) and well above the bottom of
 * plate-5 (stage 1/11 sit at ~34% down plate-5, leaving the foothills'
 * lower two-thirds as walk-off room below the last waypoint). That built-in
 * breathing room is why no additional margin constant is added here.
 */
export function totalColumnHeight(bands: readonly PlateBand[]): number {
  const last = bands.at(-1);
  return last ? round2(last.topPx + last.heightPx) : 0;
}

// ---------------------------------------------------------------------------
// Waypoints
// ---------------------------------------------------------------------------

export type WaypointStatus = "dormant" | "begun" | "current";

/**
 * dormant/begun/current per the design doc's own Layer 3 example (stages
 * 1-2 rendered "begun" at 15px solid bone, stage 3 rendered "current" at
 * 22px scarlet, the rest "dormant" at 12px translucent bone) mapped onto
 * this app's real data: "begun" = MountainStage.studied (has real entries
 * anchored to it, same `isReached` mountainGeometry.ts already uses),
 * "current" = the single next unstudied stage in stage order (the
 * learner's "next" -- an actual generalization of MountainScene's own
 * computeLabeledSlugs "reached stages plus the next one" logic, split into
 * separate buckets instead of one boolean).
 */
export function computeWaypointStatuses(stages: readonly MountainStage[]): Map<string, WaypointStatus> {
  const sorted = [...stages].sort((a, b) => a.stage - b.stage);
  const statuses = new Map<string, WaypointStatus>();
  let nextClaimed = false;
  for (const stage of sorted) {
    if (isReached(stage)) {
      statuses.set(stage.slug, "begun");
    } else if (!nextClaimed) {
      statuses.set(stage.slug, "current");
      nextClaimed = true;
    } else {
      statuses.set(stage.slug, "dormant");
    }
  }
  return statuses;
}

export interface PlateWaypoint {
  stage: MountainStage;
  x: number;
  y: number;
  plateIndex: number;
  plateName: PlateName;
  status: WaypointStatus;
  href: string;
  ariaLabel: string;
}

export function computePlateWaypoints(stages: readonly MountainStage[], bands: readonly PlateBand[]): PlateWaypoint[] {
  const statuses = computeWaypointStatuses(stages);
  const bySlug = new Map(stages.map((s) => [s.slug, s]));
  const sorted = [...stages].sort((a, b) => a.stage - b.stage);

  const waypoints: PlateWaypoint[] = [];
  for (const stage of sorted) {
    const fractions = STAGE_FRACTIONS.get(stage.stage);
    if (!fractions) continue; // stage number outside 1-11 (e.g. a broken test fixture) -- no plate position, skip.
    const band = bands[fractions.bandIndex];
    if (!band) continue;

    const x = round2(fractions.xFraction * PLATE_COLUMN_WIDTH);
    const y = round2(band.topPx + fractions.yFractionWithinBand * band.heightPx);
    const status = statuses.get(stage.slug) ?? "dormant";
    const mirror = stage.mirror ? (bySlug.get(stage.mirror) ?? null) : null;

    const parts = [`${stage.title} — go to ${stage.reference}`];
    if (mirror) parts.push(`mirrors ${mirror.title}, the same altitude on the far face`);
    parts.push(status === "current" ? "you are here" : status === "begun" ? "studied" : "not yet studied");

    waypoints.push({
      stage,
      x,
      y,
      plateIndex: fractions.bandIndex,
      plateName: band.name,
      status,
      href: stageHref(stage),
      ariaLabel: parts.join(" — "),
    });
  }
  return waypoints;
}

// ---------------------------------------------------------------------------
// The rope: a Catmull-Rom spline through the 11 waypoints, converted to a
// cubic-bezier SVG path (uniform tension 1/6, the standard conversion) --
// interpolating, i.e. the emitted curve passes exactly through every input
// point, not just near it.
// ---------------------------------------------------------------------------

interface Pt {
  x: number;
  y: number;
}

export function catmullRomToBezierPath(points: readonly Pt[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${round2(points[0].x)},${round2(points[0].y)}`;

  const p = points;
  const cmds: string[] = [`M${round2(p[0].x)},${round2(p[0].y)}`];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    cmds.push(`C${round2(c1x)},${round2(c1y)} ${round2(c2x)},${round2(c2y)} ${round2(p2.x)},${round2(p2.y)}`);
  }
  return cmds.join(" ");
}

/** Polyline-approximated length of the rope path (sampling the same 11
 * waypoints the bezier passes through is enough for a stroke-dasharray
 * reveal -- it does not need to be exact to the curve's true arc length). */
export function pathLength(points: readonly Pt[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return round2(length);
}

// ---------------------------------------------------------------------------
// The composed geometry
// ---------------------------------------------------------------------------

export interface PlateGeometry {
  columnWidth: number;
  totalHeight: number;
  bands: PlateBand[];
  waypoints: PlateWaypoint[];
  ropePathD: string;
  ropeLength: number;
}

export function buildPlateGeometry(stages: readonly MountainStage[]): PlateGeometry {
  const bands = computePlateBands(stages);
  const waypoints = computePlateWaypoints(stages, bands);
  const ropePoints = waypoints.map((w) => ({ x: w.x, y: w.y }));
  return {
    columnWidth: PLATE_COLUMN_WIDTH,
    totalHeight: totalColumnHeight(bands),
    bands,
    waypoints,
    ropePathD: catmullRomToBezierPath(ropePoints),
    ropeLength: pathLength(ropePoints),
  };
}
