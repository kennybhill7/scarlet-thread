/**
 * MOUNTAINSWITCHBACK-001 — pure geometry for "The Switchback" camera
 * direction (design/MOUNTAIN_JOURNEY_BRIEF.md, ratified 2026-09-01: 1a over
 * 1b/1c). No React, no DOM, no `server-only` import here on purpose — this
 * module is imported by both the client "use client" Mountain.tsx shell and
 * by plain `node:test` (this repo's test runner has no jsdom, see
 * tests/israel-sub-arc.test.ts's header) so every function here must be
 * callable with nothing but a `MountainStage[]` array.
 *
 * Only the TYPE comes from lib/vault/seed.ts (`import type`, erased at
 * build time) — importing the value would drag in that module's
 * `server-only` guard, which throws outside a bundler. Same discipline
 * app/(app)/page.tsx's own header already documents for this exact type.
 *
 * ---------------------------------------------------------------------------
 * The two axes, kept deliberately independent:
 *
 *  - DISTANCE ALONG THE ROAD (`y`, top of the scene to bottom) is cumulative,
 *    proportional to each stage's real `chapterCount` — "Gen 12-Malachi is a
 *    long, lonely traverse" per the brief's calibration note. This is why
 *    stage 5 ("Israel") and stage 7 ("The Church") produce a visibly longer
 *    stretch than stage 2/4/10's short ones (Sin Enters, Babel, Satan Cast
 *    Out) — see mountainGeometry.test.ts's calibration assertions.
 *  - ELEVATION (`elevationLevelOf`) is the OLD Mountain.tsx's `elevationOf`
 *    shape, kept on purpose: peak - 1 - |stage - peak|, symmetric in STAGE
 *    INDEX, not chapter count. That symmetry is exactly what makes a mirror
 *    pair (Genesis 3 / Revelation 20, etc.) land on the same elevation band
 *    regardless of how lopsided their chapter counts are — "mirror pairs
 *    read as matching altitude across the two faces" per the spec.
 * ---------------------------------------------------------------------------
 */
import type { MountainStage } from "@/lib/vault/seed";

export const SCENE_WIDTH = 320;
export const ROAD_CENTER_X = SCENE_WIDTH / 2;
export const ROAD_AMPLITUDE = 92;
export const ROAD_MARGIN_TOP = 70;
export const ROAD_MARGIN_BOTTOM = 70;
/**
 * getReview()'s own `totalChapters` (lib/vault/seed.ts) is 1189 across all
 * 11 stages combined. At this scale the whole scene lands a bit under
 * 1900px tall including margins and the short-stage floor below — long
 * enough to carry a real scroll journey, short enough to stay a phone-sane
 * page rather than an absurd multi-screen scroll.
 */
export const PX_PER_CHAPTER = 1.4;
/** Floor so a 1-2 chapter stage (Satan Cast Out, Rev 20) still gets a
 * waypoint visibly separated from its neighbor instead of overlapping it. */
export const MIN_SEGMENT_PX = 60;
/** One full left-right-left switchback cycle every this many px of travel. */
export const SWITCHBACK_WAVELENGTH_PX = 260;
export const ROAD_SAMPLE_STEP_PX = 24;
export const RIDGE_LAYER_COUNT = 3;

export interface MountainWaypoint {
  stage: MountainStage;
  x: number;
  y: number;
  /** 0 = valley floor, higher = higher on the mountain. Peak stage gets the max. */
  elevationLevel: number;
  radius: number;
  filled: boolean;
  reached: boolean;
  /** Whether this waypoint's title/reference render as visible text (req. 4). */
  labeled: boolean;
  href: string;
  ariaLabel: string;
  mirrorSlug: string | null;
  /** Length of this waypoint's altitude tick — equal for a mirror pair. */
  tickLength: number;
}

export interface RidgeLayer {
  side: "left" | "right";
  /** 0 = nearest/darkest, RIDGE_LAYER_COUNT-1 = farthest/haziest. */
  depth: number;
  path: string;
  opacity: number;
}

export interface MountainGeometry {
  width: number;
  totalHeight: number;
  peakStage: number;
  waypoints: MountainWaypoint[];
  roadPath: string;
  roadLength: number;
  ridgeLayers: RidgeLayer[];
}

export interface RibbonTick {
  slug: string;
  title: string;
  reference: string;
  leftFraction: number;
  filled: boolean;
  reached: boolean;
  labeled: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Ported from the pre-existing Mountain.tsx's own `elevationOf` (same
 * formula, same reasoning documented there: peak stays high and far,
 * elevation is symmetric around it in stage-index terms). Kept as a
 * standalone export here because it is now load-bearing for the mirror-pair
 * altitude match, not just the old ridge line's vertical placement.
 */
export function elevationLevelOf(stageNumber: number, peakStage: number): number {
  return peakStage - 1 - Math.abs(stageNumber - peakStage);
}

export function peakStageNumber(stages: readonly MountainStage[]): number {
  const last = stages.at(-1)?.stage ?? 11;
  return Math.floor(last / 2) + 1;
}

/** Same fallback and same URL shape as the pre-existing Mountain.tsx. */
export function stageHref(stage: Pick<MountainStage, "firstChapter">): string {
  const [book, chapter] = (stage.firstChapter ?? "1.1").split(".");
  return `/read/${book}/${chapter}`;
}

/**
 * "Reached" per MountainStage.studied, which IS present on this worktree's
 * type (lib/vault/seed.ts:119, and computed for real from entry rows in
 * app/(app)/page.tsx's buildMountainStages — the live path this app actually
 * renders from day to day). Deliberately not OR'd with observationCount /
 * threadCount on top of that: the live path's `studied` already means
 * "the reader has an entry anchored to one of this stage's chapters," a
 * strictly broader/more honest signal than "has an observation entry"
 * would be, so adding a second OR clause would only ever WIDEN "reached"
 * past what `studied` already means, not correct for a case where it's
 * missing.
 */
export function isReached(stage: MountainStage): boolean {
  return stage.studied;
}

/**
 * Labels resolve for every reached stage (so a learner scrolling back down
 * through ground they've already covered still sees names, not just bare
 * markers) plus the single next unreached stage in front of them — the
 * switchback brief's own "reached stages plus the next one." Every other
 * stage stays a bare marker (still fully described via aria-label).
 */
export function computeLabeledSlugs(stages: readonly MountainStage[]): Set<string> {
  const sorted = [...stages].sort((a, b) => a.stage - b.stage);
  const labeled = new Set<string>();
  let nextClaimed = false;
  for (const stage of sorted) {
    if (isReached(stage)) {
      labeled.add(stage.slug);
    } else if (!nextClaimed) {
      labeled.add(stage.slug);
      nextClaimed = true;
    }
  }
  return labeled;
}

function segmentPx(stage: MountainStage): number {
  return Math.max(MIN_SEGMENT_PX, stage.chapterCount * PX_PER_CHAPTER);
}

/** The switchback itself — a pure sine oscillation in x as travel (y) increases. */
export function roadXAtY(y: number): number {
  return ROAD_CENTER_X + ROAD_AMPLITUDE * Math.sin((y / SWITCHBACK_WAVELENGTH_PX) * Math.PI * 2);
}

function buildRoadPath(
  waypointYs: readonly number[],
  totalHeight: number,
): { path: string; length: number } {
  const samples = new Map<string, number>();
  const addY = (y: number) => samples.set(y.toFixed(3), y);
  for (let y = 0; y <= totalHeight; y += ROAD_SAMPLE_STEP_PX) addY(y);
  addY(totalHeight);
  for (const y of waypointYs) addY(y);

  const ys = Array.from(samples.values()).sort((a, b) => a - b);
  const points = ys.map((y) => ({ x: roadXAtY(y), y }));

  let length = 0;
  const commands = points.map((point, index) => {
    if (index > 0) {
      const prev = points[index - 1];
      length += Math.hypot(point.x - prev.x, point.y - prev.y);
    }
    return `${index === 0 ? "M" : "L"}${round2(point.x)},${round2(point.y)}`;
  });

  return { path: commands.join(" "), length: round2(length) };
}

// mulberry32 — small deterministic PRNG so the ridge silhouettes are stable
// across renders/tests (no Math.random). Not cryptographic; doesn't need to be.
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A smooth bump centered on the peak's own y position: 1 at the peak,
 * decaying outward. Used to make the ridge silhouettes narrow in — like a
 * real pass — right where the terrain data says the summit actually is,
 * instead of at a hand-picked pixel value.
 */
export function peakEnvelope(y: number, peakY: number, totalHeight: number): number {
  const spread = Math.max(totalHeight * 0.28, 200);
  const d = (y - peakY) / spread;
  return Math.exp(-(d * d));
}

function buildRidgeLayers(
  totalHeight: number,
  peakY: number,
): RidgeLayer[] {
  const layers: RidgeLayer[] = [];
  for (let depth = 0; depth < RIDGE_LAYER_COUNT; depth++) {
    for (const side of ["left", "right"] as const) {
      const rng = mulberry32(1000 * (depth + 1) + (side === "left" ? 7 : 13));
      const baseInset = 30 + depth * 20;
      const amplitude = 34 - depth * 8;
      const period = 140 + depth * 70;
      const points: { x: number; y: number }[] = [];
      for (let y = 0; y <= totalHeight; y += period / 4) {
        const jag = (rng() - 0.5) * amplitude;
        const bulge = peakEnvelope(y, peakY, totalHeight) * (20 - depth * 5);
        const inset = Math.max(2, baseInset + jag - bulge);
        const x = side === "left" ? inset : SCENE_WIDTH - inset;
        points.push({ x: Math.min(SCENE_WIDTH - 2, Math.max(2, x)), y });
      }
      const edgeX = side === "left" ? 0 : SCENE_WIDTH;
      const d = [
        `M${edgeX},0`,
        ...points.map((p) => `L${round2(p.x)},${round2(p.y)}`),
        `L${edgeX},${round2(totalHeight)}`,
        "Z",
      ].join(" ");
      // Farther layers (higher depth) fade toward the sky -- atmospheric
      // perspective via opacity against the shared shell stone tokens
      // (MountainScene.tsx picks progressively lighter fills per depth too).
      layers.push({ side, depth, path: d, opacity: round2(0.85 - depth * 0.2) });
    }
  }
  return layers;
}

export function buildMountainGeometry(stages: readonly MountainStage[]): MountainGeometry {
  const sorted = [...stages].sort((a, b) => a.stage - b.stage);
  const peak = peakStageNumber(sorted);
  const labeled = computeLabeledSlugs(sorted);
  const bySlug = new Map(sorted.map((s) => [s.slug, s]));
  const maxThread = Math.max(1, ...sorted.map((s) => s.threadCount));

  let cursorY = ROAD_MARGIN_TOP;
  const withY = sorted.map((stage) => {
    cursorY += segmentPx(stage);
    return { stage, y: cursorY };
  });
  const totalHeight = cursorY + ROAD_MARGIN_BOTTOM;

  const waypoints: MountainWaypoint[] = withY.map(({ stage, y }) => {
    const x = roadXAtY(y);
    const elevationLevel = elevationLevelOf(stage.stage, peak);
    const weight = stage.threadCount / maxThread;
    const radius = round2(10 + weight * 10);
    const filled = stage.observationCount > 0;
    const reached = isReached(stage);
    const mirror = stage.mirror ? (bySlug.get(stage.mirror) ?? null) : null;
    const tickLength = 16 + elevationLevel * 9;

    const parts = [`${stage.title} — go to ${stage.reference}`];
    parts.push(stage.stage === peak ? "the summit" : `elevation band ${elevationLevel + 1} of ${peak}`);
    if (mirror) parts.push(`mirrors ${mirror.title}, the same elevation on the far face`);
    parts.push(reached ? "studied" : "not yet studied");

    return {
      stage,
      x: round2(x),
      y: round2(y),
      elevationLevel,
      radius,
      filled,
      reached,
      labeled: labeled.has(stage.slug),
      href: stageHref(stage),
      ariaLabel: parts.join(" — "),
      mirrorSlug: stage.mirror,
      tickLength,
    };
  });

  const peakWaypoint = waypoints.find((w) => w.stage.stage === peak) ?? waypoints[0];
  const peakY = peakWaypoint ? peakWaypoint.y : totalHeight / 2;

  const { path: roadPath, length: roadLength } = buildRoadPath(
    waypoints.map((w) => w.y),
    totalHeight,
  );
  const ridgeLayers = buildRidgeLayers(totalHeight, peakY);

  return {
    width: SCENE_WIDTH,
    totalHeight: round2(totalHeight),
    peakStage: peak,
    waypoints,
    roadPath,
    roadLength,
    ridgeLayers,
  };
}

/** Small proportional strip for the always-visible mini-map ribbon (req. 7). */
export function buildRibbonTicks(geometry: MountainGeometry): RibbonTick[] {
  const total = geometry.totalHeight || 1;
  return geometry.waypoints.map((wp) => ({
    slug: wp.stage.slug,
    title: wp.stage.title,
    reference: wp.stage.reference,
    leftFraction: round2(wp.y / total),
    filled: wp.filled,
    reached: wp.reached,
    labeled: wp.labeled,
  }));
}

/** How far the reader has scrolled through the whole scene, 0-1, clamped. */
export function scrollProgressFor(rectTop: number, rectHeight: number, viewportHeight: number): number {
  const travel = Math.max(1, rectHeight - viewportHeight);
  return Math.min(1, Math.max(0, -rectTop / travel));
}
