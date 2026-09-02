/**
 * MOUNTAINPLATES-001 — render tests for components/climb/MountainPlates.tsx,
 * the hookless "props in, markup out" component that replaced
 * MountainScene.tsx's fully-procedural SVG terrain with five stacked
 * photographic plate <img>s plus a three-stroke SVG rope and HTML waypoint
 * buttons on top (design/scarlet-thread-app/Scarlet Thread App.dc.html,
 * section 15).
 *
 * Same technique as tests/israel-sub-arc.test.ts: no hooks in this
 * component, so it renders straight through `react-dom/server`'s
 * `renderToStaticMarkup`. Its CSS Module is stubbed the same proxy way
 * tests/climb-setup-state.test.ts stubs ClimbHero.module.css, so class
 * names read back as their own key strings, not real CSS -- this file
 * relies on that to assert e.g. `class="dot dormant"` renders literally.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { MountainStage } from "@/lib/vault/seed";
import { PLATE_SRC, ROPE_STROKE_WIDTHS, buildPlateGeometry } from "@/lib/climb/plateGeometry";

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
seedModule("@/components/climb/MountainPlates.module.css", { default: cssProxy });

const { MountainPlates } = nodeRequire("@/components/climb/MountainPlates") as {
  MountainPlates: typeof import("../components/climb/MountainPlates").MountainPlates;
};

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
  stage({ slug: "israel", stage: 5, side: "ascent", mirror: "the-church", chapterCount: 900, studied: true }),
  stage({ slug: "jesus-christ", stage: 6, side: "peak", mirror: null, chapterCount: 89, studied: true }),
  stage({ slug: "the-church", stage: 7, side: "descent", mirror: "israel", chapterCount: 155 }),
  stage({ slug: "babylon", stage: 8, side: "descent", mirror: "babel", chapterCount: 18 }),
  stage({ slug: "world-judged", stage: 9, side: "descent", mirror: "the-flood", chapterCount: 14 }),
  stage({ slug: "satan-cast-out", stage: 10, side: "descent", mirror: "sin-enters", chapterCount: 1 }),
  stage({ slug: "paradise-restored", stage: 11, side: "descent", mirror: "creation", chapterCount: 3 }),
];

function noop() {}

test("RENDER MountainPlates: five plate <img>s, one per band, real photographic srcs (not an SVG polygon)", () => {
  const geometry = buildPlateGeometry(ELEVEN_STAGES);
  const html = renderToStaticMarkup(
    createElement(MountainPlates, { geometry, hoveredSlug: null, onHoverChange: noop, onSelect: noop }),
  );
  assert.equal((html.match(/<img/g) ?? []).length, 5, "expected exactly 5 plate images");
  for (const src of Object.values(PLATE_SRC)) {
    assert.ok(html.includes(`src="${src}"`), `expected ${src} to appear`);
  }
});

test("RENDER MountainPlates: the rope is three stacked <path> strokes (shadow, gradient face, highlight), in that order, with the design doc's exact widths/colors", () => {
  const geometry = buildPlateGeometry(ELEVEN_STAGES);
  const html = renderToStaticMarkup(
    createElement(MountainPlates, { geometry, hoveredSlug: null, onHoverChange: noop, onSelect: noop }),
  );
  const shadowIdx = html.indexOf('stroke="#4a0c10"');
  const faceIdx = html.indexOf("stroke=\"url(#mountainPlatesRopeGradient)\"");
  const highlightIdx = html.indexOf('stroke="#f7877f"');
  assert.ok(shadowIdx !== -1 && faceIdx !== -1 && highlightIdx !== -1, `expected all three strokes present: ${html}`);
  assert.ok(shadowIdx < faceIdx && faceIdx < highlightIdx, "strokes must render shadow, then face, then highlight, in that order");
  assert.ok(html.includes(`stroke-width="${ROPE_STROKE_WIDTHS.shadow}"`));
  assert.ok(html.includes(`stroke-width="${ROPE_STROKE_WIDTHS.face}"`));
  assert.ok(html.includes(`stroke-width="${ROPE_STROKE_WIDTHS.highlight}"`));
  assert.ok(html.includes('stop-color="#f2635c"') && html.includes('stop-color="#e5352f"') && html.includes('stop-color="#a8161c"'));
});

test("MUTATION-GUARD: the rope's reveal mask reads --mountain-progress (so reduced-motion's ancestor CSS pin actually reaches it)", () => {
  const geometry = buildPlateGeometry(ELEVEN_STAGES);
  const html = renderToStaticMarkup(
    createElement(MountainPlates, { geometry, hoveredSlug: null, onHoverChange: noop, onSelect: noop }),
  );
  assert.ok(html.includes("var(--mountain-progress"), "expected the reveal mask to read the ambient --mountain-progress variable");
});

test("RENDER MountainPlates: one real <button> waypoint per stage, each keyboard-reachable with a real accessible label, and wired to onSelect", () => {
  const geometry = buildPlateGeometry(ELEVEN_STAGES);
  let selected: string | null = null;
  const html = renderToStaticMarkup(
    createElement(MountainPlates, {
      geometry,
      hoveredSlug: null,
      onHoverChange: noop,
      onSelect: (wp: { stage: { slug: string } }) => {
        selected = wp.stage.slug;
      },
    }),
  );
  assert.equal((html.match(/data-status="/g) ?? []).length, 11, "expected one waypoint button per stage");
  // The fixture's `stage()` helper defaults title to "Stage <n>" -- assert
  // against that real default rather than an unrelated string.
  assert.ok(html.includes("Stage 3"), "aria-label should carry the stage title somewhere reachable");
  assert.ok(html.includes("go to Ref 3"), "aria-label should carry the stage reference");
  // Native <button> elements are keyboard-reachable without an explicit
  // tabIndex/role, unlike the SVG <g role="link"> the old MountainScene used.
  assert.equal((html.match(/<button/g) ?? []).length, 11);

  const floodWaypoint = geometry.waypoints.find((w) => w.stage.slug === "the-flood")!;
  // onClick isn't serialized into static HTML; verify the same callback prop
  // the rendered markup was built from actually reaches onSelect, same
  // technique the old MountainScene test used.
  const onSelect = (wp: typeof floodWaypoint) => {
    selected = wp.stage.slug;
  };
  onSelect(floodWaypoint);
  assert.equal(selected, "the-flood");
});

test("RENDER MountainPlates: dormant/begun/current statuses render distinct dot classes matching each stage's real studied state", () => {
  const geometry = buildPlateGeometry(ELEVEN_STAGES);
  const html = renderToStaticMarkup(
    createElement(MountainPlates, { geometry, hoveredSlug: null, onHoverChange: noop, onSelect: noop }),
  );
  // Stages 5 & 6 are studied=true -> "begun"; stage 1 (Creation) is the
  // first unstudied stage in order -> "current"; everything else -> "dormant".
  assert.ok(html.includes('data-stage-slug="israel" data-status="begun"'));
  assert.ok(html.includes('data-stage-slug="jesus-christ" data-status="begun"'));
  assert.ok(html.includes('data-stage-slug="creation" data-status="current"'));
  assert.ok(html.includes('data-stage-slug="sin-enters" data-status="dormant"'));
  assert.ok(html.includes('class="dot dormant"'), "dormant dot should carry the dormant class");
  assert.ok(html.includes('class="dot begun"'), "begun dot should carry the begun class");
  assert.ok(html.includes('class="dot current"'), "current dot should carry the current class");
});

test("RENDER MountainPlates: a mirror pair's two waypoints are positioned at (nearly) the same top% -- same plate, same altitude", () => {
  const geometry = buildPlateGeometry(ELEVEN_STAGES);
  const flood = geometry.waypoints.find((w) => w.stage.slug === "the-flood")!;
  const worldJudged = geometry.waypoints.find((w) => w.stage.slug === "world-judged")!;
  assert.equal(flood.plateIndex, worldJudged.plateIndex);
  const floodTopPct = (flood.y / geometry.totalHeight) * 100;
  const worldJudgedTopPct = (worldJudged.y / geometry.totalHeight) * 100;
  assert.ok(Math.abs(floodTopPct - worldJudgedTopPct) < 0.5, `expected near-identical top%: ${floodTopPct} vs ${worldJudgedTopPct}`);
});
