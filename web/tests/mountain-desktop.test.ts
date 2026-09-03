/**
 * MOUNTAINDESKTOP-001 — coverage for the desktop (>=1100px) assembly:
 * lib/climb/plateGeometry.ts's new desktop-geometry exports,
 * components/climb/MountainDesktop.tsx (the panorama, hover card, scene
 * takeover, progress rail), and the CSS-only breakpoint switch wired into
 * Mountain.tsx/Mountain.module.css.
 *
 * TEST-ENVIRONMENT NOTE (same discipline as tests/mountain-plates.test.ts
 * and tests/israel-sub-arc.test.ts's own headers): this repo's test script
 * is `tsx --test tests/*.test.ts` — plain Node, no jsdom, no bundler. No
 * real click can be simulated and no real `.css`/`.module.css` file can be
 * parsed. Three consequences, matching established precedent elsewhere in
 * this repo:
 *
 *   1. MountainDesktop and its sub-pieces (StageCard, SceneTakeover,
 *      ProgressRail — all exported specifically for this) are "use client"
 *      with real hooks (useState/useMemo), but useState's *initial* value
 *      renders fine under `react-dom/server`'s `renderToStaticMarkup` with
 *      no browser commit phase required (same fact Mountain.tsx's own tests
 *      already document) — so section B below renders the top-level
 *      component directly and inspects its initial (hover-closed,
 *      takeover-closed) markup, and renders the sub-pieces directly with
 *      hand-built props for the hover/open states no click can reach.
 *   2. Interactive DECISIONS that a click would trigger are tested via the
 *      pure, exported `resolveDesktopWaypointClick` function instead of a
 *      simulated click — same technique tests/israel-sub-arc.test.ts already
 *      established for `resolveWaypointAction`.
 *   3. Two things (the CSS breakpoint direction, and reduced-motion CSS) are
 *      genuinely impossible to observe without a real browser, so they're
 *      verified by reading the actual committed `.module.css` source text
 *      via `node:fs` and asserting its content directly — the same
 *      technique tests/plate-geometry.test.ts already uses to check its
 *      baked constants against route.json's raw text.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { MountainStage } from "@/lib/vault/seed";
import {
  DESKTOP_PANORAMA_HEIGHT,
  DESKTOP_PANORAMA_WIDTH,
  DESKTOP_ROPE_STROKE_WIDTHS,
  DESKTOP_STAGE_POSITIONS,
  PLATE_REAL_HEIGHTS_PX,
  ROPE_STROKE_WIDTHS,
  SCENE_SRC,
  buildDesktopPlateGeometry,
  computeDesktopPlateBands,
  computeDesktopWaypoints,
} from "@/lib/climb/plateGeometry";
import { isIsraelWaypoint, resolveWaypointAction } from "@/lib/climb/waypointAction";

const WEB_ROOT = path.join(__dirname, "..");

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

const ELEVEN_STAGES: MountainStage[] = [
  stage({ slug: "creation", stage: 1, side: "ascent", mirror: "paradise-restored", chapterCount: 2 }),
  stage({ slug: "sin-enters", stage: 2, side: "ascent", mirror: "satan-cast-out", chapterCount: 3 }),
  stage({ slug: "the-flood", stage: 3, side: "ascent", mirror: "world-judged", chapterCount: 4 }),
  stage({ slug: "babel", stage: 4, side: "ascent", mirror: "babylon", chapterCount: 2 }),
  stage({ slug: "israel", stage: 5, side: "ascent", mirror: "the-church", chapterCount: 900, studied: true, firstChapter: "1.12" }),
  stage({ slug: "jesus-christ", stage: 6, side: "peak", mirror: null, chapterCount: 89, studied: true }),
  stage({ slug: "the-church", stage: 7, side: "descent", mirror: "israel", chapterCount: 155 }),
  stage({ slug: "babylon", stage: 8, side: "descent", mirror: "babel", chapterCount: 18 }),
  stage({ slug: "world-judged", stage: 9, side: "descent", mirror: "the-flood", chapterCount: 14 }),
  stage({ slug: "satan-cast-out", stage: 10, side: "descent", mirror: "sin-enters", chapterCount: 1 }),
  stage({ slug: "paradise-restored", stage: 11, side: "descent", mirror: "creation", chapterCount: 3 }),
];

// ===========================================================================
// A. Geometry — lib/climb/plateGeometry.ts's new desktop exports.
// ===========================================================================

test("DESKTOP_STAGE_POSITIONS: the 11 hand-placed percentages match this task's brief exactly", () => {
  const expected: Record<number, { x: number; y: number }> = {
    1: { x: 5.81, y: 84.2 },
    2: { x: 14.0, y: 76.6 },
    3: { x: 21.7, y: 62.2 },
    4: { x: 28.9, y: 54.1 },
    5: { x: 43.0, y: 31.2 },
    6: { x: 50.0, y: 19.8 },
    7: { x: 56.9, y: 34.9 },
    8: { x: 64.1, y: 47.0 },
    9: { x: 72.0, y: 57.1 },
    10: { x: 88.9, y: 76.6 },
    11: { x: 96.1, y: 84.5 },
  };
  assert.equal(DESKTOP_STAGE_POSITIONS.size, 11);
  for (const [n, pos] of Object.entries(expected)) {
    const actual = DESKTOP_STAGE_POSITIONS.get(Number(n));
    assert.ok(actual, `missing stage ${n}`);
    assert.equal(actual!.x, pos.x, `stage ${n} x`);
    assert.equal(actual!.y, pos.y, `stage ${n} y`);
  }
});

test("DESKTOP_STAGE_POSITIONS: matches The Climb.dc.html's own STAGES const, read directly from the design doc (not just re-asserted against a second hand-typed copy)", () => {
  const dcPath = path.join(WEB_ROOT, "..", "design", "scarlet-thread-app", "The Climb.dc.html");
  const raw = fs.readFileSync(dcPath, "utf-8");
  // Each STAGES row looks like: `1:  { n: 1, ... x: 5.81, y: 84.2, side: "Ascent" },`
  const rowPattern = /(\d+):\s*\{\s*n:\s*\d+.*?x:\s*(-?[\d.]+),\s*y:\s*(-?[\d.]+),\s*side:/g;
  const found = new Map<number, { x: number; y: number }>();
  let m: RegExpExecArray | null;
  while ((m = rowPattern.exec(raw))) {
    found.set(Number(m[1]), { x: Number(m[2]), y: Number(m[3]) });
  }
  assert.equal(found.size, 11, `expected to parse 11 STAGES rows out of The Climb.dc.html, got ${found.size}`);
  for (const [n, pos] of found) {
    const ours = DESKTOP_STAGE_POSITIONS.get(n);
    assert.ok(ours, `our constant is missing stage ${n}`);
    assert.equal(ours!.x, pos.x, `stage ${n} x drifted from The Climb.dc.html`);
    assert.equal(ours!.y, pos.y, `stage ${n} y drifted from The Climb.dc.html`);
  }
});

test("DESKTOP_PANORAMA_WIDTH/HEIGHT: exactly 1531 x 645, the five real plates' combined pixel size", () => {
  assert.equal(DESKTOP_PANORAMA_WIDTH, 1531);
  assert.equal(DESKTOP_PANORAMA_HEIGHT, 645);
  assert.equal(
    PLATE_REAL_HEIGHTS_PX.reduce((sum, h) => sum + h, 0),
    645,
  );
});

test("computeDesktopPlateBands: native proportional heights (NOT reflowed by content), summing to exactly 100%", () => {
  const bands = computeDesktopPlateBands();
  assert.equal(bands.length, 5);
  assert.equal(bands[0].topPct, 0);
  const last = bands[bands.length - 1];
  assert.ok(Math.abs(last.topPct + last.heightPct - 100) < 0.01, `bands should sum to 100%, got ${last.topPct + last.heightPct}`);
  // plate-1-summit is 240/645 = 37.21% -- the tallest plate, matching its
  // real committed pixel height, not any content-driven reflow.
  assert.ok(Math.abs(bands[0].heightPct - (240 / 645) * 100) < 0.01);
});

test("computeDesktopWaypoints: reuses the same reached/status + href logic as the mobile assembly (no divergent re-implementation)", () => {
  const waypoints = computeDesktopWaypoints(ELEVEN_STAGES);
  assert.equal(waypoints.length, 11);
  const israel = waypoints.find((w) => w.stage.slug === "israel")!;
  const creation = waypoints.find((w) => w.stage.slug === "creation")!;
  assert.equal(israel.status, "begun", "israel is studied=true -> begun");
  assert.equal(creation.status, "current", "creation is the first unstudied stage in order -> current");
  assert.equal(israel.href, "/read/1/12");
  const flood = waypoints.find((w) => w.stage.slug === "the-flood")!;
  assert.equal(flood.mirror?.slug, "world-judged");
});

test("buildDesktopPlateGeometry: rope stroke widths are scaled for the REAL 1531px panorama, distinct from the mobile column's 320px-scaled widths", () => {
  const geometry = buildDesktopPlateGeometry(ELEVEN_STAGES);
  assert.deepEqual(geometry.ropeStrokeWidths, DESKTOP_ROPE_STROKE_WIDTHS);
  assert.notDeepEqual(geometry.ropeStrokeWidths, ROPE_STROKE_WIDTHS, "desktop stroke widths must not equal mobile's");
  assert.ok(geometry.ropePathD.startsWith("M"), "expected a real SVG path, not an empty string");
  assert.ok(geometry.ropeLength > 0);
});

test("SCENE_SRC: all 11 scene images are real files mirrored into web/public/climb/scenes/ (same-origin CSP)", () => {
  assert.equal(SCENE_SRC.size, 11);
  for (const [n, src] of SCENE_SRC) {
    const filePath = path.join(WEB_ROOT, "public", src);
    assert.ok(fs.existsSync(filePath), `stage ${n}: expected a real file at ${filePath}`);
  }
});

// ===========================================================================
// B. MountainDesktop and its sub-pieces.
// ===========================================================================

const nodeRequire = createRequire(__filename);
function seedModule(specifier: string, exports: Record<string, unknown>) {
  const resolved = nodeRequire.resolve(specifier);
  (nodeRequire.cache as Record<string, unknown>)[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    path: path.dirname(resolved),
    paths: [],
    children: [],
    exports: { __esModule: true, ...exports },
  };
  return resolved;
}
const cssProxy = new Proxy({}, { get: (_target, key) => (typeof key === "string" ? key : undefined) });
seedModule("@/components/climb/MountainDesktop.module.css", { default: cssProxy });

const { MountainDesktop, StageCard, SceneTakeover, ProgressRail, resolveDesktopWaypointClick } = nodeRequire(
  "@/components/climb/MountainDesktop",
) as typeof import("../components/climb/MountainDesktop");

function noopSelect() {}

test("RENDER MountainDesktop: the panorama's aspect-ratio is exactly 1531 / 645", () => {
  const html = renderToStaticMarkup(createElement(MountainDesktop, { stages: ELEVEN_STAGES, onSelect: noopSelect }));
  assert.ok(/aspect-ratio:\s*1531\s*\/\s*645/.test(html), html.slice(0, 400));
});

test("RENDER MountainDesktop: five plate <img>s, one per real plate file, top/height percentages summing to 100", () => {
  const html = renderToStaticMarkup(createElement(MountainDesktop, { stages: ELEVEN_STAGES, onSelect: noopSelect }));
  const imgSrcs = [...html.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1]);
  const plateImgSrcs = imgSrcs.filter((s) => s.includes("/climb/plates/"));
  assert.equal(plateImgSrcs.length, 5, `expected 5 plate images, got: ${plateImgSrcs.join(", ")}`);
});

test("RENDER MountainDesktop: 11 real waypoint buttons at the exact desktop percentages, using data-waypoint-status (not data-status, to avoid colliding with the mobile assembly's own exact-count assertions elsewhere)", () => {
  const html = renderToStaticMarkup(createElement(MountainDesktop, { stages: ELEVEN_STAGES, onSelect: noopSelect }));
  assert.equal((html.match(/data-waypoint-status="/g) ?? []).length, 11);
  assert.ok(!html.includes('data-status="'), "desktop waypoints must not use the mobile assembly's data-status attribute name");
  assert.ok(/left:\s*5\.81%/.test(html), "stage 1's exact x%");
  assert.ok(/top:\s*84\.2%/.test(html), "stage 1's exact y%");
  assert.ok(/left:\s*50%/.test(html), "stage 6 (peak) exact x%");
});

test("RENDER MountainDesktop: the rope is three stacked strokes (shadow, gradient face, highlight) using the DESKTOP stroke widths", () => {
  const html = renderToStaticMarkup(createElement(MountainDesktop, { stages: ELEVEN_STAGES, onSelect: noopSelect }));
  assert.ok(html.includes(`stroke-width="${DESKTOP_ROPE_STROKE_WIDTHS.shadow}"`));
  assert.ok(html.includes(`stroke-width="${DESKTOP_ROPE_STROKE_WIDTHS.face}"`));
  assert.ok(html.includes(`stroke-width="${DESKTOP_ROPE_STROKE_WIDTHS.highlight}"`));
});

test("RENDER MountainDesktop: initial render (nothing hovered, no scene open) shows no card, no halo, no takeover", () => {
  const html = renderToStaticMarkup(createElement(MountainDesktop, { stages: ELEVEN_STAGES, onSelect: noopSelect }));
  assert.ok(!html.includes("BEGUN") && !html.includes("NOT YET"), "no card should render with nothing hovered");
  assert.ok(!html.includes("Back to the mountain"), "no scene takeover should render with nothing open");
});

test("RENDER MountainDesktop: the bottom progress rail reflects REAL reached/not-reached per stage, not the mockup's static 3-gold/8-bronze placeholder", () => {
  // Deliberately different reached-count than the mockup's own hardcoded 3.
  const mixed: MountainStage[] = ELEVEN_STAGES.map((s) => ({ ...s, studied: s.stage <= 5 }));
  const html = renderToStaticMarkup(createElement(ProgressRail, { stages: mixed }));
  assert.ok(html.includes("Genesis") && html.includes("Revelation"));
  assert.equal((html.match(/progressDotReached/g) ?? []).length, 5, "5 of 11 stages are studied in this fixture");
  assert.equal((html.match(/progressDotUnreached/g) ?? []).length, 6);
  assert.equal((html.match(/<button/g) ?? []).length, 0, "the progress rail is not interactive, matching the mockup's plain <span> dots");
});

test("RENDER StageCard: real observation/question/thread counts and BEGUN badge for a studied stage, driven by real MountainStage data (not mockup placeholder numbers like '6 observations')", () => {
  const waypoints = computeDesktopWaypoints(ELEVEN_STAGES.map((s) => (s.slug === "creation" ? { ...s, studied: true, observationCount: 41, questionCount: 9, threadCount: 2 } : s)));
  const creation = waypoints.find((w) => w.stage.slug === "creation")!;
  const html = renderToStaticMarkup(createElement(StageCard, { waypoint: creation }));
  assert.ok(html.includes("41 observations"));
  assert.ok(html.includes("9 open questions"));
  assert.ok(html.includes("2 threads"));
  assert.ok(html.includes("BEGUN"));
  // The mockup's own hardcoded Creation numbers ("6 observations · 2
  // questions · 3 threads") must NOT leak through as fixed text.
  assert.ok(!html.includes("6 observations"));
});

test("RENDER StageCard: 'Nothing written here yet.' and NOT YET badge for an unstudied stage", () => {
  const waypoints = computeDesktopWaypoints(ELEVEN_STAGES);
  const babel = waypoints.find((w) => w.stage.slug === "babel")!;
  const html = renderToStaticMarkup(createElement(StageCard, { waypoint: babel }));
  assert.ok(html.includes("Nothing written here yet."));
  assert.ok(html.includes("NOT YET"));
});

test("RENDER StageCard: real mirror stage title/reference render; stage 6 (no mirror) shows the honest 'no mirror' fallback instead of a fabricated pairing", () => {
  const waypoints = computeDesktopWaypoints(ELEVEN_STAGES);
  const flood = waypoints.find((w) => w.stage.slug === "the-flood")!;
  const floodHtml = renderToStaticMarkup(createElement(StageCard, { waypoint: flood }));
  assert.ok(floodHtml.includes("Ref 9") && floodHtml.includes("Stage 9"), "the-flood's real mirror is world-judged (Ref 9)");

  const peak = waypoints.find((w) => w.stage.slug === "jesus-christ")!;
  const peakHtml = renderToStaticMarkup(createElement(StageCard, { waypoint: peak }));
  assert.ok(peakHtml.includes("no mirror"));
});

/** Returns the full `<button ...>` opening tag that contains the given
 * substring (e.g. an aria-label), so attribute order (disabled may render
 * before or after aria-label) never matters. */
function buttonTagContaining(html: string, needle: string): string {
  const needleIdx = html.indexOf(needle);
  assert.ok(needleIdx !== -1, `expected to find ${needle} in html`);
  const tagStart = html.lastIndexOf("<button", needleIdx);
  const tagEnd = html.indexOf(">", needleIdx);
  assert.ok(tagStart !== -1 && tagEnd !== -1, `could not locate enclosing <button> tag for ${needle}`);
  return html.slice(tagStart, tagEnd + 1);
}

test("RENDER SceneTakeover: prev disabled at stage 1, next disabled at stage 11, both enabled in the middle", () => {
  const waypoints = computeDesktopWaypoints(ELEVEN_STAGES);
  const noop = () => {};
  const first = waypoints.find((w) => w.stage.stage === 1)!;
  const firstHtml = renderToStaticMarkup(
    createElement(SceneTakeover, { waypoint: first, onClose: noop, onPrev: noop, onNext: noop, onJump: noop, onReadOn: noop }),
  );
  const firstPrevTag = buttonTagContaining(firstHtml, 'aria-label="Previous stage"');
  assert.ok(firstPrevTag.includes("disabled"), `expected prev disabled at stage 1: ${firstPrevTag}`);
  const firstNextTag = buttonTagContaining(firstHtml, 'aria-label="Next stage"');
  assert.ok(!firstNextTag.includes("disabled"), `expected next enabled at stage 1: ${firstNextTag}`);

  const last = waypoints.find((w) => w.stage.stage === 11)!;
  const lastHtml = renderToStaticMarkup(
    createElement(SceneTakeover, { waypoint: last, onClose: noop, onPrev: noop, onNext: noop, onJump: noop, onReadOn: noop }),
  );
  const lastNextTag = buttonTagContaining(lastHtml, 'aria-label="Next stage"');
  assert.ok(lastNextTag.includes("disabled"), `expected next disabled at stage 11: ${lastNextTag}`);
  const lastPrevTag = buttonTagContaining(lastHtml, 'aria-label="Previous stage"');
  assert.ok(!lastPrevTag.includes("disabled"), `expected prev enabled at stage 11: ${lastPrevTag}`);

  const middle = waypoints.find((w) => w.stage.stage === 6)!;
  const middleHtml = renderToStaticMarkup(
    createElement(SceneTakeover, { waypoint: middle, onClose: noop, onPrev: noop, onNext: noop, onJump: noop, onReadOn: noop }),
  );
  const midPrevTag = buttonTagContaining(middleHtml, 'aria-label="Previous stage"');
  const midNextTag = buttonTagContaining(middleHtml, 'aria-label="Next stage"');
  assert.ok(!midPrevTag.includes("disabled"), `expected prev enabled at stage 6: ${midPrevTag}`);
  assert.ok(!midNextTag.includes("disabled"), `expected next enabled at stage 6: ${midNextTag}`);
});

test("RENDER SceneTakeover: a real bottom dot rail of exactly 11 stages, with only the open stage marked active", () => {
  const waypoints = computeDesktopWaypoints(ELEVEN_STAGES);
  const noop = () => {};
  const stage4 = waypoints.find((w) => w.stage.stage === 4)!;
  const html = renderToStaticMarkup(
    createElement(SceneTakeover, { waypoint: stage4, onClose: noop, onPrev: noop, onNext: noop, onJump: noop, onReadOn: noop }),
  );
  assert.equal((html.match(/Jump to stage \d+/g) ?? []).length, 11);
  assert.equal((html.match(/sceneNavDotActive/g) ?? []).length, 1);
});

test("RENDER SceneTakeover: real title/reference/summary content, driven by MountainStage data, not the mockup's hand-authored per-stage prose", () => {
  const waypoints = computeDesktopWaypoints(
    ELEVEN_STAGES.map((s) => (s.slug === "creation" ? { ...s, summary: "A totally different, made-up test summary sentence." } : s)),
  );
  const creation = waypoints.find((w) => w.stage.slug === "creation")!;
  const noop = () => {};
  const html = renderToStaticMarkup(
    createElement(SceneTakeover, { waypoint: creation, onClose: noop, onPrev: noop, onNext: noop, onJump: noop, onReadOn: noop }),
  );
  assert.ok(html.includes("A totally different, made-up test summary sentence."));
  assert.ok(html.includes("Read Ref 1"));
  // The mockup's own hardcoded Creation prose must not leak through.
  assert.ok(!html.includes("Light divided from darkness"));
});

test("RENDER SceneTakeover: a stage with no summary renders no summary block (no fabricated placeholder text either)", () => {
  const waypoints = computeDesktopWaypoints(ELEVEN_STAGES);
  const babel = waypoints.find((w) => w.stage.slug === "babel")!;
  const noop = () => {};
  const html = renderToStaticMarkup(
    createElement(SceneTakeover, { waypoint: babel, onClose: noop, onPrev: noop, onNext: noop, onJump: noop, onReadOn: noop }),
  );
  assert.ok(!html.includes("What the text puts in front of you"));
});

// ===========================================================================
// C. resolveDesktopWaypointClick — the pure "waypoint click" decision.
// ===========================================================================

test("resolveDesktopWaypointClick: stage 5 opens the sub-arc directly (skips the takeover); every other stage opens the takeover at its own stage number", () => {
  for (const stage of ELEVEN_STAGES) {
    const result = resolveDesktopWaypointClick(stage);
    if (stage.stage === 5) {
      assert.deepEqual(result, { kind: "open-israel-sub-arc" });
    } else {
      assert.deepEqual(result, { kind: "open-takeover", stageNumber: stage.stage });
    }
  }
});

test("resolveDesktopWaypointClick agrees with resolveWaypointAction/isIsraelWaypoint on exactly which stage is special (both assemblies must never disagree)", () => {
  for (const stage of ELEVEN_STAGES) {
    const desktopResult = resolveDesktopWaypointClick(stage);
    const mobileAction = resolveWaypointAction(stage, "/x");
    assert.equal(desktopResult.kind === "open-israel-sub-arc", mobileAction.kind === "open-israel-sub-arc", `stage ${stage.stage}`);
    assert.equal(desktopResult.kind === "open-israel-sub-arc", isIsraelWaypoint(stage), `stage ${stage.stage}`);
  }
});

// ===========================================================================
// MUTATION-GUARD — exactly one of the 11 real stages (5) opens the sub-arc
// from a desktop waypoint click, the other ten open the local takeover. If
// the `isIsraelWaypoint` check inside resolveDesktopWaypointClick were
// accidentally inverted or hard-coded wrong, this would go red. (Verified by
// hand: temporarily changing MountainDesktop.tsx's
// `resolveDesktopWaypointClick` to always return `{ kind: "open-takeover",
// stageNumber: stage.stage }` turns this red, exactly as expected; reverted
// before shipping — see this task's final report for the full list of
// mutations tried.)
// ===========================================================================
test("MUTATION-GUARD: exactly one of the 11 real stages (5) opens the sub-arc from its desktop waypoint", () => {
  const opened = ELEVEN_STAGES.filter((s) => resolveDesktopWaypointClick(s).kind === "open-israel-sub-arc");
  assert.deepEqual(opened.map((s) => s.slug), ["israel"]);
});

// ===========================================================================
// D. The breakpoint switch — Mountain.module.css's `.mobileScene`/
//    `.desktopScene`, read as raw text (no browser available to actually
//    evaluate a media query in this test environment).
// ===========================================================================

function extractBraceBlock(source: string, startIndex: number): string {
  const openIdx = source.indexOf("{", startIndex);
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(openIdx, i + 1);
    }
  }
  throw new Error("unterminated brace block");
}

test("BREAKPOINT: Mountain.module.css hides the desktop assembly and shows the mobile one below 1100px, and the reverse at/above it", () => {
  const cssPath = path.join(WEB_ROOT, "components", "climb", "Mountain.module.css");
  const css = fs.readFileSync(cssPath, "utf-8");

  const mediaIdx = css.indexOf("@media (min-width: 1100px)");
  assert.ok(mediaIdx !== -1, "expected a @media (min-width: 1100px) rule in Mountain.module.css");

  const before = css.slice(0, mediaIdx);
  const mobileDefaultIdx = before.indexOf(".mobileScene");
  const desktopDefaultIdx = before.indexOf(".desktopScene");
  assert.ok(mobileDefaultIdx !== -1 && desktopDefaultIdx !== -1, "expected default (non-media) rules for both classes");
  const mobileDefaultBlock = extractBraceBlock(before, mobileDefaultIdx);
  const desktopDefaultBlock = extractBraceBlock(before, desktopDefaultIdx);
  assert.ok(/display:\s*block/.test(mobileDefaultBlock), "mobile assembly should be visible by default (below 1100px)");
  assert.ok(/display:\s*none/.test(desktopDefaultBlock), "desktop assembly should be hidden by default (below 1100px)");

  const mediaBlock = extractBraceBlock(css, mediaIdx);
  const mobileInMediaIdx = mediaBlock.indexOf(".mobileScene");
  const desktopInMediaIdx = mediaBlock.indexOf(".desktopScene");
  assert.ok(mobileInMediaIdx !== -1 && desktopInMediaIdx !== -1, "expected both classes toggled inside the media block");
  const mobileInMediaBlock = extractBraceBlock(mediaBlock, mobileInMediaIdx);
  const desktopInMediaBlock = extractBraceBlock(mediaBlock, desktopInMediaIdx);
  assert.ok(/display:\s*none/.test(mobileInMediaBlock), "mobile assembly should hide at >=1100px");
  assert.ok(/display:\s*block/.test(desktopInMediaBlock), "desktop assembly should show at >=1100px");
});

// ===========================================================================
// E. Reduced motion — MountainDesktop adds no JS motion listener (structural
//    check on its own source) AND its CSS independently pins the resting
//    state, the exact two-guarantee pattern Mountain.tsx/Mountain.module.css
//    already established for the mobile assembly's scroll-driven rope reveal.
// ===========================================================================

test("REDUCED MOTION: MountainDesktop.tsx attaches no scroll/rAF/timer listener (its only motion is CSS-driven)", () => {
  const srcPath = path.join(WEB_ROOT, "components", "climb", "MountainDesktop.tsx");
  const src = fs.readFileSync(srcPath, "utf-8");
  assert.ok(!src.includes("addEventListener"), "MountainDesktop.tsx should not attach any DOM/window event listener");
  assert.ok(!src.includes("requestAnimationFrame"), "MountainDesktop.tsx should not drive any rAF loop");
  assert.ok(!src.includes("useEffect"), "MountainDesktop.tsx should have no effect at all -- purely derived state + CSS");
});

test("REDUCED MOTION: MountainDesktop.module.css independently pins the halo/card/dot motion to a static resting state", () => {
  const cssPath = path.join(WEB_ROOT, "components", "climb", "MountainDesktop.module.css");
  const css = fs.readFileSync(cssPath, "utf-8");
  const mediaIdx = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(mediaIdx !== -1, "expected a prefers-reduced-motion: reduce rule");
  const block = extractBraceBlock(css, mediaIdx);
  assert.ok(block.includes(".halo") && block.includes(".card"), "expected halo/card covered by the reduced-motion override");
  assert.ok(/animation:\s*none/.test(block), "expected the halo/card fade-in animation pinned off");
  assert.ok(/transition:\s*none/.test(block), "expected dot/button transitions pinned off");
});
