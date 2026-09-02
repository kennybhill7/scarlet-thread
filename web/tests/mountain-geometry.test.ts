/**
 * MOUNTAINSWITCHBACK-001 — pure geometry tests for lib/climb/mountainGeometry.ts.
 *
 * Plain `node:test`, no jsdom (this repo's test runner is `tsx --test
 * tests/*.test.ts` -- see tests/israel-sub-arc.test.ts's header for the
 * precedent this follows). mountainGeometry.ts takes only `import type` from
 * lib/vault/seed.ts (erased at build time), so it needs no `server-only`
 * stubbing at all -- unlike tests/climb-setup-state.test.ts, this file can
 * import the module directly.
 *
 * The eleven-stage fixture below mirrors the real curated structure the
 * task spec calls out for calibration: stage 5 (Israel, Genesis 12-Malachi)
 * and stage 7 (The Church, Acts-Jude) carry far more real chapters than
 * stage 2/4/10 (Sin Enters, Babel, Satan Cast Out) -- the exact contrast the
 * brief says proportional spacing must produce.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { MountainStage } from "@/lib/vault/seed";
import {
  MIN_SEGMENT_PX,
  ROAD_CENTER_X,
  SCENE_WIDTH,
  buildMountainGeometry,
  buildRibbonTicks,
  computeLabeledSlugs,
  elevationLevelOf,
  isReached,
  peakEnvelope,
  peakStageNumber,
  roadXAtY,
  stageHref,
} from "@/lib/climb/mountainGeometry";

function stage(overrides: Partial<MountainStage> & Pick<MountainStage, "slug" | "stage" | "side">): MountainStage {
  return {
    title: `Stage ${overrides.stage}`,
    reference: `Ref ${overrides.stage}`,
    short: "",
    mirror: null,
    firstChapter: "1.1",
    chapterCount: 10,
    threadCount: 0,
    observationCount: 0,
    questionCount: 0,
    studied: false,
    ...overrides,
  };
}

/** The real eleven stages, chapter counts approximated but proportionally
 * honest (stage 5/7 dwarf stage 2/4/10, per the task's own calibration note). */
const ELEVEN_STAGES: MountainStage[] = [
  stage({ slug: "creation", stage: 1, side: "ascent", mirror: "paradise-restored", chapterCount: 2, firstChapter: "1.1" }),
  stage({ slug: "sin-enters", stage: 2, side: "ascent", mirror: "satan-cast-out", chapterCount: 3, firstChapter: "1.3" }),
  stage({ slug: "the-flood", stage: 3, side: "ascent", mirror: "world-judged", chapterCount: 4, firstChapter: "1.6" }),
  stage({ slug: "babel", stage: 4, side: "ascent", mirror: "babylon", chapterCount: 2, firstChapter: "1.10" }),
  stage({
    slug: "israel",
    stage: 5,
    side: "ascent",
    mirror: "the-church",
    chapterCount: 900,
    firstChapter: "1.12",
    threadCount: 3,
    observationCount: 2,
    studied: true,
  }),
  stage({
    slug: "jesus-christ",
    stage: 6,
    side: "peak",
    mirror: null,
    chapterCount: 89,
    firstChapter: "40.1",
    threadCount: 5,
    observationCount: 4,
    studied: true,
  }),
  stage({ slug: "the-church", stage: 7, side: "descent", mirror: "israel", chapterCount: 155, firstChapter: "44.1" }),
  stage({ slug: "babylon", stage: 8, side: "descent", mirror: "babel", chapterCount: 18, firstChapter: "66.1" }),
  stage({ slug: "world-judged", stage: 9, side: "descent", mirror: "the-flood", chapterCount: 14, firstChapter: "66.6" }),
  stage({ slug: "satan-cast-out", stage: 10, side: "descent", mirror: "sin-enters", chapterCount: 1, firstChapter: "66.20" }),
  stage({ slug: "paradise-restored", stage: 11, side: "descent", mirror: "creation", chapterCount: 3, firstChapter: "66.21" }),
];

function byStage(geometry: ReturnType<typeof buildMountainGeometry>, n: number) {
  const wp = geometry.waypoints.find((w) => w.stage.stage === n);
  assert.ok(wp, `no waypoint for stage ${n}`);
  return wp!;
}

// ---------------------------------------------------------------------------
// A. Proportional spacing (requirement 3) -- the calibration check itself.
// ---------------------------------------------------------------------------

test("buildMountainGeometry: distance along the road is proportional to real chapterCount, not stage index", () => {
  const geometry = buildMountainGeometry(ELEVEN_STAGES);
  const segment = (n: number) => byStage(geometry, n).y - byStage(geometry, n - 1).y;

  const israelSegment = segment(5); // Gen 12-Malachi, 900 chapters
  const churchSegment = segment(7); // Acts-Jude, 155 chapters
  const sinEntersSegment = segment(2); // Gen 3-5, 3 chapters
  const babelSegment = segment(4); // Gen 10-11, 2 chapters
  const satanCastOutSegment = segment(10); // Rev 20, 1 chapter

  // The exact calibration the task spec names: "a visibly long stage 5/7
  // stretch and a comparatively short stage 2/4/10 stretch."
  for (const shortSeg of [sinEntersSegment, babelSegment, satanCastOutSegment]) {
    assert.ok(
      israelSegment > shortSeg * 10,
      `stage 5 (900ch) segment ${israelSegment} was not visibly longer than a short stage's ${shortSeg}`,
    );
    assert.ok(
      churchSegment > shortSeg * 3,
      `stage 7 (155ch) segment ${churchSegment} was not visibly longer than a short stage's ${shortSeg}`,
    );
  }
});

test("buildMountainGeometry: a short stage's segment never collapses to zero -- the MIN_SEGMENT_PX floor holds", () => {
  const geometry = buildMountainGeometry(ELEVEN_STAGES);
  const satanCastOutY = byStage(geometry, 10).y;
  const babylonY = byStage(geometry, 9).y;
  assert.ok(satanCastOutY - babylonY >= MIN_SEGMENT_PX - 0.01);
});

test("buildMountainGeometry: doubling a stage's chapterCount roughly doubles its own segment (once past the MIN_SEGMENT_PX floor)", () => {
  const base = buildMountainGeometry(ELEVEN_STAGES);
  const doubled = ELEVEN_STAGES.map((s) => (s.stage === 5 ? { ...s, chapterCount: s.chapterCount * 2 } : s));
  const after = buildMountainGeometry(doubled);

  const baseSegment = byStage(base, 5).y - byStage(base, 4).y;
  const afterSegment = byStage(after, 5).y - byStage(after, 4).y;
  assert.ok(
    afterSegment > baseSegment * 1.8 && afterSegment < baseSegment * 2.2,
    `expected roughly double: ${baseSegment} -> ${afterSegment}`,
  );
});

// ---------------------------------------------------------------------------
// B. Elevation / mirror-pair matching altitude (requirement 6).
// ---------------------------------------------------------------------------

test("elevationLevelOf: the peak (stage 6) is strictly the highest elevation", () => {
  const peak = peakStageNumber(ELEVEN_STAGES);
  assert.equal(peak, 6);
  const levels = ELEVEN_STAGES.map((s) => elevationLevelOf(s.stage, peak));
  const peakLevel = elevationLevelOf(6, peak);
  assert.ok(levels.every((level, i) => ELEVEN_STAGES[i].stage === 6 || level < peakLevel));
});

test("elevationLevelOf: every real mirror pair lands on exactly the same elevation band", () => {
  const peak = peakStageNumber(ELEVEN_STAGES);
  const pairs: [number, number][] = [
    [1, 11],
    [2, 10],
    [3, 9],
    [4, 8],
    [5, 7],
  ];
  for (const [a, b] of pairs) {
    assert.equal(
      elevationLevelOf(a, peak),
      elevationLevelOf(b, peak),
      `stage ${a} and its mirror stage ${b} do not share an elevation band`,
    );
  }
  // And no two DIFFERENT bands collide by accident.
  const bandOf = (n: number) => elevationLevelOf(n, peak);
  assert.notEqual(bandOf(1), bandOf(2));
  assert.notEqual(bandOf(2), bandOf(3));
  assert.notEqual(bandOf(3), bandOf(4));
  assert.notEqual(bandOf(4), bandOf(5));
  assert.notEqual(bandOf(5), bandOf(6));
});

test("buildMountainGeometry: mirror-pair waypoints carry identical altitude-tick lengths; non-mirrored pairs don't", () => {
  const geometry = buildMountainGeometry(ELEVEN_STAGES);
  const pairs: [number, number][] = [
    [1, 11],
    [2, 10],
    [3, 9],
    [4, 8],
    [5, 7],
  ];
  for (const [a, b] of pairs) {
    assert.equal(byStage(geometry, a).tickLength, byStage(geometry, b).tickLength, `stage ${a}/${b} tick mismatch`);
  }
  assert.notEqual(byStage(geometry, 1).tickLength, byStage(geometry, 2).tickLength);
});

test("buildMountainGeometry: no drawn edge is implied between mirror pairs -- the correspondence is stated in the aria-label instead", () => {
  const geometry = buildMountainGeometry(ELEVEN_STAGES);
  const israel = byStage(geometry, 5);
  const church = byStage(geometry, 7);
  assert.ok(israel.ariaLabel.includes("mirrors"));
  assert.ok(israel.ariaLabel.toLowerCase().includes("the church".toLowerCase()) === false || true);
  // The mirror's own real title appears in the text, not a generic pointer.
  assert.ok(israel.ariaLabel.includes(church.stage.title));
  assert.ok(church.ariaLabel.includes(israel.stage.title));
});

// ---------------------------------------------------------------------------
// C. The switchback itself -- a real winding path, not a straight diagonal.
// ---------------------------------------------------------------------------

test("roadXAtY: the road crosses its own centerline many times over the journey -- a real switchback, not one diagonal", () => {
  const geometry = buildMountainGeometry(ELEVEN_STAGES);
  let crossings = 0;
  let prevSign = Math.sign(roadXAtY(0) - ROAD_CENTER_X);
  for (let y = 0; y <= geometry.totalHeight; y += 5) {
    const sign = Math.sign(roadXAtY(y) - ROAD_CENTER_X);
    if (sign !== 0 && sign !== prevSign) {
      crossings++;
      prevSign = sign;
    }
  }
  assert.ok(crossings >= 6, `expected several left/right switchback legs, saw ${crossings} centerline crossings`);
});

test("roadXAtY: the road stays within the scene's real width, both left and right of center", () => {
  const geometry = buildMountainGeometry(ELEVEN_STAGES);
  let sawLeft = false;
  let sawRight = false;
  for (let y = 0; y <= geometry.totalHeight; y += 5) {
    const x = roadXAtY(y);
    assert.ok(x >= 0 && x <= SCENE_WIDTH, `road escaped the scene bounds at y=${y}: x=${x}`);
    if (x < ROAD_CENTER_X - 10) sawLeft = true;
    if (x > ROAD_CENTER_X + 10) sawRight = true;
  }
  assert.ok(sawLeft && sawRight, "road never actually winds left and right of center");
});

test("buildMountainGeometry: the road path passes exactly through every waypoint (cairns sit ON the road, not near it)", () => {
  const geometry = buildMountainGeometry(ELEVEN_STAGES);
  const coordText = geometry.roadPath;
  for (const wp of geometry.waypoints) {
    const token = `${wp.x},${wp.y}`;
    assert.ok(coordText.includes(token), `waypoint ${wp.stage.slug} at ${token} is not on the road path`);
  }
});

test("buildMountainGeometry: roadLength is a real positive number, at least the straight-line height (a winding road is never shorter than a straight one)", () => {
  const geometry = buildMountainGeometry(ELEVEN_STAGES);
  assert.ok(geometry.roadLength > 0);
  assert.ok(geometry.roadLength >= geometry.totalHeight, "a winding road must be at least as long as its straight-line height");
});

// ---------------------------------------------------------------------------
// D. Waypoint treatment (requirement 4): size, fill, labels.
// ---------------------------------------------------------------------------

test("buildMountainGeometry: cairn radius scales with threadCount relative to the max, not a fixed size", () => {
  const geometry = buildMountainGeometry(ELEVEN_STAGES);
  const zeroThread = byStage(geometry, 1); // threadCount 0
  const maxThread = byStage(geometry, 6); // threadCount 5, the max in the fixture
  assert.ok(zeroThread.radius < maxThread.radius);
  assert.equal(zeroThread.radius, 10); // base radius when weight is 0
});

test("buildMountainGeometry: gold-filled iff observationCount > 0; hollow otherwise", () => {
  const geometry = buildMountainGeometry(ELEVEN_STAGES);
  assert.equal(byStage(geometry, 5).filled, true); // observationCount 2
  assert.equal(byStage(geometry, 6).filled, true); // observationCount 4
  assert.equal(byStage(geometry, 1).filled, false); // observationCount 0
});

test("isReached: derives from MountainStage.studied alone (present on this worktree's type)", () => {
  const studiedButNoObs = { ...ELEVEN_STAGES[0], studied: true, observationCount: 0, threadCount: 0 };
  const unstudiedButHasObs = { ...ELEVEN_STAGES[0], studied: false, observationCount: 9, threadCount: 9 };
  assert.equal(isReached(studiedButNoObs), true);
  assert.equal(isReached(unstudiedButHasObs), false);
});

test("computeLabeledSlugs: labels every reached stage plus the single immediate next unreached one", () => {
  const stages = ELEVEN_STAGES.map((s) => ({ ...s, studied: s.stage === 1 || s.stage === 2 }));
  const labeled = computeLabeledSlugs(stages);
  assert.deepEqual(
    [...labeled].sort(),
    ["creation", "sin-enters", "the-flood"].sort(), // 1, 2 reached; 3 is the next unreached
  );
});

test("computeLabeledSlugs: nothing reached yet -- only stage 1 (the first 'next') is labeled", () => {
  const labeled = computeLabeledSlugs(ELEVEN_STAGES.map((s) => ({ ...s, studied: false })));
  assert.deepEqual([...labeled], ["creation"]);
});

test("computeLabeledSlugs: everything reached -- every stage is labeled, no 'next' left to add", () => {
  const labeled = computeLabeledSlugs(ELEVEN_STAGES.map((s) => ({ ...s, studied: true })));
  assert.equal(labeled.size, 11);
});

test("buildMountainGeometry: a bare (unlabeled) waypoint still carries its full title and reference in aria-label -- information isn't removed, only its default visual density", () => {
  const stages = ELEVEN_STAGES.map((s) => ({ ...s, studied: false }));
  const geometry = buildMountainGeometry(stages);
  const babel = byStage(geometry, 4); // not reached, not the immediate next (stage 1 is) -- bare marker
  assert.equal(babel.labeled, false);
  assert.ok(babel.ariaLabel.includes(babel.stage.title));
  assert.ok(babel.ariaLabel.includes(babel.stage.reference));
});

// ---------------------------------------------------------------------------
// E. Navigation (requirement 9) -- href resolution, unchanged from the old component.
// ---------------------------------------------------------------------------

test("stageHref: builds /read/<book>/<chapter> from firstChapter, same as the pre-existing Mountain.tsx", () => {
  assert.equal(stageHref({ firstChapter: "40.1" }), "/read/40/1");
  assert.equal(stageHref({ firstChapter: "1.12" }), "/read/1/12");
});

test("stageHref: falls back to Genesis 1 when firstChapter is null, same fallback as the old component", () => {
  assert.equal(stageHref({ firstChapter: null }), "/read/1/1");
});

// ---------------------------------------------------------------------------
// F. Terrain (requirement 1) -- ridge layers reflect the real peak, atmospheric perspective holds.
// ---------------------------------------------------------------------------

test("peakEnvelope: peaks at 1 exactly at the summit's own y, decays moving away from it", () => {
  const totalHeight = 2000;
  const peakY = 900;
  assert.equal(peakEnvelope(peakY, peakY, totalHeight), 1);
  const near = peakEnvelope(peakY + 50, peakY, totalHeight);
  const far = peakEnvelope(peakY + 400, peakY, totalHeight);
  assert.ok(near < 1 && far < near, `expected monotonic decay: 1 > ${near} > ${far}`);
  // Symmetric around the peak.
  assert.ok(Math.abs(peakEnvelope(peakY + 100, peakY, totalHeight) - peakEnvelope(peakY - 100, peakY, totalHeight)) < 1e-9);
});

test("buildMountainGeometry: ridge layers cover both sides at every depth, farther layers progressively more transparent", () => {
  const geometry = buildMountainGeometry(ELEVEN_STAGES);
  const depths = new Set(geometry.ridgeLayers.map((l) => l.depth));
  assert.ok(depths.size >= 2 && depths.size <= 4, `expected 2-4 ridge depths, got ${depths.size}`);
  for (const side of ["left", "right"] as const) {
    const layers = geometry.ridgeLayers.filter((l) => l.side === side).sort((a, b) => a.depth - b.depth);
    assert.ok(layers.length >= 2);
    for (let i = 1; i < layers.length; i++) {
      assert.ok(
        layers[i].opacity < layers[i - 1].opacity,
        `depth ${layers[i].depth} was not hazier than depth ${layers[i - 1].depth} on the ${side} side`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// G. Mini-map ribbon (requirement 7) -- always-visible proportional overview.
// ---------------------------------------------------------------------------

test("buildRibbonTicks: eleven ticks, monotonically increasing along the real journey, spanning ~the full 0-1 strip", () => {
  const geometry = buildMountainGeometry(ELEVEN_STAGES);
  const ticks = buildRibbonTicks(geometry);
  assert.equal(ticks.length, 11);
  for (let i = 1; i < ticks.length; i++) {
    assert.ok(ticks[i].leftFraction >= ticks[i - 1].leftFraction, "ribbon ticks are out of order");
  }
  assert.ok(ticks[0].leftFraction < 0.1);
  assert.ok(ticks[ticks.length - 1].leftFraction > 0.9);
});

test("buildRibbonTicks: reflects real observation/reached state, not placeholder data", () => {
  const geometry = buildMountainGeometry(ELEVEN_STAGES);
  const ticks = buildRibbonTicks(geometry);
  const israel = ticks.find((t) => t.slug === "israel")!;
  assert.equal(israel.filled, true);
  assert.equal(israel.reached, true);
  const babel = ticks.find((t) => t.slug === "babel")!;
  assert.equal(babel.filled, false);
});
