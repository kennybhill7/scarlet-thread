/**
 * MOUNTAINPLATES-001 — pure geometry tests for lib/climb/plateGeometry.ts.
 *
 * Plain `node:test`, no jsdom (this repo's test runner is `tsx --test
 * tests/*.test.ts` -- see tests/israel-sub-arc.test.ts's header for the
 * precedent this follows). plateGeometry.ts takes only `import type` from
 * lib/vault/seed.ts, so it needs no `server-only` stubbing.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import type { MountainStage } from "@/lib/vault/seed";
import {
  BAND_STAGE_NUMBERS,
  PLATE_COLUMN_WIDTH,
  PLATE_NAMES,
  buildPlateGeometry,
  catmullRomToBezierPath,
  computePlateBands,
  computeWaypointStatuses,
} from "@/lib/climb/plateGeometry";
import { MIN_SEGMENT_PX, segmentPx } from "@/lib/climb/mountainGeometry";

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

/** Real eleven stages, real-ish chapter counts. */
const ELEVEN_STAGES: MountainStage[] = [
  stage({ slug: "creation", stage: 1, side: "ascent", mirror: "paradise-restored", chapterCount: 2 }),
  stage({ slug: "sin-enters", stage: 2, side: "ascent", mirror: "satan-cast-out", chapterCount: 3 }),
  stage({ slug: "the-flood", stage: 3, side: "ascent", mirror: "world-judged", chapterCount: 4 }),
  stage({ slug: "babel", stage: 4, side: "ascent", mirror: "babylon", chapterCount: 2 }),
  stage({ slug: "israel", stage: 5, side: "ascent", mirror: "the-church", chapterCount: 900, studied: true }),
  stage({ slug: "jesus-christ", stage: 6, side: "peak", mirror: null, chapterCount: 89, studied: true }),
  stage({ slug: "the-church", stage: 7, side: "descent", mirror: "israel", chapterCount: 155 }),
  stage({ slug: "babylon", stage: 8, side: "descent", mirror: "babel", chapterCount: 18 }),
  stage({ slug: "world-judged", stage: 9, side: "descent", mirror: "the-flood", chapterCount: 14 }),
  stage({ slug: "satan-cast-out", stage: 10, side: "descent", mirror: "sin-enters", chapterCount: 1 }),
  stage({ slug: "paradise-restored", stage: 11, side: "descent", mirror: "creation", chapterCount: 3 }),
];

function byStageNumber(geometry: ReturnType<typeof buildPlateGeometry>, n: number) {
  const wp = geometry.waypoints.find((w) => w.stage.stage === n);
  assert.ok(wp, `no waypoint for stage ${n}`);
  return wp!;
}

// ---------------------------------------------------------------------------
// A. Band assignment is derivable from route.json's own data, not asserted.
// ---------------------------------------------------------------------------

test("BAND_STAGE_NUMBERS is exactly what route.json's own pts/plate-boundary data implies (re-derived here from the raw file, not the baked constants)", () => {
  const routeJsonPath = path.join(
    __dirname,
    "..",
    "..",
    "design",
    "scarlet-thread-app",
    "assets",
    "plates",
    "route.json",
  );
  const raw = fs.readFileSync(routeJsonPath, "utf-8");
  const route = JSON.parse(raw) as { pts: [number, number][] };
  assert.equal(route.pts.length, 11, "route.json should carry one point per stage, 1-11");

  // Real committed plate pixel heights (design/scarlet-thread-app/assets/
  // plates/plate-*.jpg, all 1531px wide), independently re-stated here (not
  // imported from plateGeometry.ts) so this test cannot pass by circularity.
  const REAL_HEIGHTS_PX = [240, 85, 85, 86, 149];
  const SCALE = 1531 / 1000;
  const boundaries: number[] = [0];
  for (const h of REAL_HEIGHTS_PX) boundaries.push(boundaries[boundaries.length - 1] + h / SCALE);

  function plateIndexForY(y: number): number {
    for (let i = 0; i < 5; i++) {
      if (y >= boundaries[i] && y <= boundaries[i + 1]) return i;
    }
    throw new Error(`y=${y} fell outside all five plate boundaries ${JSON.stringify(boundaries)}`);
  }

  const derivedBands: number[][] = [[], [], [], [], []];
  route.pts.forEach(([, y], idx) => {
    const stageNumber = idx + 1;
    derivedBands[plateIndexForY(y)].push(stageNumber);
  });

  assert.deepEqual(
    derivedBands,
    BAND_STAGE_NUMBERS.map((b) => [...b]),
    `route.json's own points, checked against the real plate pixel boundaries, disagree with BAND_STAGE_NUMBERS:\nderived=${JSON.stringify(derivedBands)}\nbaked=${JSON.stringify(BAND_STAGE_NUMBERS)}`,
  );

  // The mirror-pair structure this derivation is supposed to match: stage N
  // and stage 12-N always land in the same derived band.
  for (let n = 1; n <= 5; n++) {
    const bandOfN = derivedBands.findIndex((b) => b.includes(n));
    const bandOfMirror = derivedBands.findIndex((b) => b.includes(12 - n));
    assert.equal(bandOfN, bandOfMirror, `stage ${n} and its mirror stage ${12 - n} landed on different plates`);
  }
});

test("MUTATION-GUARD: BAND_STAGE_NUMBERS has exactly 5 bands covering stages 1-11 with no overlap or gap", () => {
  assert.equal(BAND_STAGE_NUMBERS.length, PLATE_NAMES.length);
  const all = BAND_STAGE_NUMBERS.flat().sort((a, b) => a - b);
  assert.deepEqual(all, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

// ---------------------------------------------------------------------------
// B. Reflow — band heights (and therefore waypoint y) scale with chapterCount.
// ---------------------------------------------------------------------------

test("computePlateBands: a band's real height is the sum of segmentPx() across its member stages", () => {
  const bands = computePlateBands(ELEVEN_STAGES);
  // plate-1-summit holds stages 5, 6, 7 (900, 89, 155 chapters -- all well
  // past the MIN_SEGMENT_PX floor at PX_PER_CHAPTER=1.4).
  const summit = bands.find((b) => b.name === "plate-1-summit")!;
  const expected = (900 + 89 + 155) * 1.4;
  assert.ok(Math.abs(summit.heightPx - expected) < 0.5, `expected ~${expected}, got ${summit.heightPx}`);
});

test("REFLOW: growing a stage's chapterCount grows its OWN plate band's height by EXACTLY that stage's segmentPx delta, and moves its waypoint's y proportionally", () => {
  const base = buildPlateGeometry(ELEVEN_STAGES);
  // Stage 3 (the Flood) shares plate-3-mid with its mirror stage 9. Both
  // start small enough that segmentPx() floors at MIN_SEGMENT_PX (60px) --
  // deliberately: this proves the reflow tracks the real per-stage
  // segmentPx() delta (an exact algebraic relationship), not merely "grew
  // by some multiplier", which the MIN_SEGMENT_PX floor would otherwise
  // make a fragile assertion (a small starting chapterCount can be doubled
  // many times over without moving off the floor at all).
  const grownStage3 = ELEVEN_STAGES.find((s) => s.stage === 3)!;
  const doubled = ELEVEN_STAGES.map((s) => (s.stage === 3 ? { ...s, chapterCount: s.chapterCount * 20 } : s));
  const after = buildPlateGeometry(doubled);

  const expectedDelta = segmentPx(doubled.find((s) => s.stage === 3)!) - segmentPx(grownStage3);
  assert.ok(expectedDelta > 0, "test setup error: chosen multiplier did not actually grow segmentPx");

  const baseMid = base.bands.find((b) => b.name === "plate-3-mid")!;
  const afterMid = after.bands.find((b) => b.name === "plate-3-mid")!;
  assert.ok(
    Math.abs(afterMid.heightPx - baseMid.heightPx - expectedDelta) < 0.5,
    `expected plate-3-mid to grow by exactly stage 3's segmentPx delta (${expectedDelta}): ${baseMid.heightPx} -> ${afterMid.heightPx}`,
  );

  // Bands before plate-3-mid (summit, upper) must be untouched -- reflow is
  // local to the band whose member stage changed.
  const baseSummit = base.bands.find((b) => b.name === "plate-1-summit")!;
  const afterSummit = after.bands.find((b) => b.name === "plate-1-summit")!;
  assert.equal(baseSummit.heightPx, afterSummit.heightPx);

  // The waypoint for the CHANGED stage moves down by roughly the band's
  // growth (its y-fraction-within-band times the extra height).
  const baseWp3 = byStageNumber(base, 3);
  const afterWp3 = byStageNumber(after, 3);
  assert.ok(afterWp3.y > baseWp3.y, "stage 3's own waypoint should move down as its band grows");

  // Bands AFTER plate-3-mid shift down by exactly the growth (cumulative topPx).
  const growth = afterMid.heightPx - baseMid.heightPx;
  const baseLower = base.bands.find((b) => b.name === "plate-4-lower")!;
  const afterLower = after.bands.find((b) => b.name === "plate-4-lower")!;
  assert.ok(
    Math.abs(afterLower.topPx - (baseLower.topPx + growth)) < 0.5,
    `plate-4-lower's top should shift down by exactly the growth: expected ~${baseLower.topPx + growth}, got ${afterLower.topPx}`,
  );
});

test("a short stage's band never collapses below MIN_SEGMENT_PX even with chapterCount near zero", () => {
  const withTinyStage = ELEVEN_STAGES.map((s) => (s.stage === 10 ? { ...s, chapterCount: 0 } : s));
  const bands = computePlateBands(withTinyStage);
  const foothillsAdjacent = bands.find((b) => b.stageNumbers.includes(10))!;
  // Stage 10 shares plate-4-lower with stage 2 (chapterCount 3); the band's
  // total still can't be less than stage 2's own floored segment.
  assert.ok(foothillsAdjacent.heightPx >= MIN_SEGMENT_PX - 0.01);
});

// ---------------------------------------------------------------------------
// C. Waypoints land within their own band's real pixel range.
// ---------------------------------------------------------------------------

test("every waypoint's y falls within its own plate band's [topPx, topPx+heightPx] range", () => {
  const geometry = buildPlateGeometry(ELEVEN_STAGES);
  for (const wp of geometry.waypoints) {
    const band = geometry.bands[wp.plateIndex];
    assert.ok(
      wp.y >= band.topPx - 0.01 && wp.y <= band.topPx + band.heightPx + 0.01,
      `stage ${wp.stage.stage}'s y=${wp.y} fell outside its band ${band.name}'s range [${band.topPx}, ${band.topPx + band.heightPx}]`,
    );
  }
});

test("every waypoint's x falls within [0, PLATE_COLUMN_WIDTH]", () => {
  const geometry = buildPlateGeometry(ELEVEN_STAGES);
  for (const wp of geometry.waypoints) {
    assert.ok(wp.x >= 0 && wp.x <= PLATE_COLUMN_WIDTH, `stage ${wp.stage.stage}'s x=${wp.x} out of range`);
  }
});

test("a mirror pair's two waypoints land on the same plate (plateIndex) and are on opposite sides (ascent left of center, descent right)", () => {
  const geometry = buildPlateGeometry(ELEVEN_STAGES);
  const flood = byStageNumber(geometry, 3);
  const worldJudged = byStageNumber(geometry, 9);
  assert.equal(flood.plateIndex, worldJudged.plateIndex, "the Flood and World Judged must share one plate");
  assert.ok(flood.x < PLATE_COLUMN_WIDTH / 2, "the Flood (ascent) should sit left of center");
  assert.ok(worldJudged.x > PLATE_COLUMN_WIDTH / 2, "World Judged (descent) should sit right of center");
});

// ---------------------------------------------------------------------------
// D. The rope path: well-formed, passes through every waypoint.
// ---------------------------------------------------------------------------

test("catmullRomToBezierPath: the emitted path's M/C endpoints pass exactly through every input point", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 5 },
    { x: 20, y: -5 },
    { x: 30, y: 8 },
  ];
  const d = catmullRomToBezierPath(points);
  assert.ok(/^M0,0/.test(d), `expected path to start at the first point: ${d}`);
  for (const pt of points) {
    // Every input point appears as a curve endpoint -- "x,y" immediately
    // preceding a space+C or the string's end.
    const needle = `${pt.x},${pt.y}`;
    assert.ok(d.includes(needle), `expected "${needle}" to appear as an endpoint in: ${d}`);
  }
  // Well-formed: only M and C commands, each C followed by exactly 3 coordinate pairs.
  assert.ok(/^M[\d.-]+,[\d.-]+( C[\d.-]+,[\d.-]+ [\d.-]+,[\d.-]+ [\d.-]+,[\d.-]+)*$/.test(d), `path did not match the expected M/C grammar: ${d}`);
});

test("buildPlateGeometry: the rope's d string passes through all 11 computed waypoint coordinates", () => {
  const geometry = buildPlateGeometry(ELEVEN_STAGES);
  assert.equal(geometry.waypoints.length, 11);
  for (const wp of geometry.waypoints) {
    const needle = `${wp.x},${wp.y}`;
    assert.ok(geometry.ropePathD.includes(needle), `waypoint (stage ${wp.stage.stage}) at ${needle} missing from rope path`);
  }
});

test("MUTATION-GUARD: the rope path is genuinely multi-segment (11 waypoints -> 10 C commands), not a single straight line", () => {
  const geometry = buildPlateGeometry(ELEVEN_STAGES);
  const cCount = (geometry.ropePathD.match(/C/g) ?? []).length;
  assert.equal(cCount, 10, `expected 10 cubic-bezier segments for 11 points, got ${cCount}`);
});

// ---------------------------------------------------------------------------
// E. Waypoint status (dormant/begun/current).
// ---------------------------------------------------------------------------

test("computeWaypointStatuses: reached stages are 'begun', the single next unreached stage is 'current', the rest are 'dormant'", () => {
  const statuses = computeWaypointStatuses(ELEVEN_STAGES);
  // Stages 5 and 6 are studied=true in the fixture.
  assert.equal(statuses.get("israel"), "begun");
  assert.equal(statuses.get("jesus-christ"), "begun");
  // Stage 1 (Creation) is the first unstudied stage in stage order -> current.
  assert.equal(statuses.get("creation"), "current");
  // Everything else unstudied and not first is dormant.
  assert.equal(statuses.get("sin-enters"), "dormant");
  assert.equal(statuses.get("paradise-restored"), "dormant");
});
