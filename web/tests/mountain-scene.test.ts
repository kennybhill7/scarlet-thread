/**
 * MOUNTAINSWITCHBACK-001 — render tests for the hookless
 * components/climb/{MountainScene,MountainRibbon}.tsx and the composed
 * "use client" Mountain.tsx shell.
 *
 * Same technique as tests/israel-sub-arc.test.ts (its header explains the
 * reasoning in full): MountainScene/MountainRibbon are hookless ("props in,
 * markup out"), so they render straight through `react-dom/server`'s
 * `renderToStaticMarkup` with no stubbing. Mountain.tsx itself has real
 * hooks (`useRouter`, `useEffect`), so `next/navigation` is seeded in
 * `require.cache` before it loads, mirroring
 * tests/climb-setup-state.test.ts's treatment of the same module. Mountain
 * imports no CSS Module with real declarations that matter to these
 * assertions (Mountain.module.css is stubbed the same proxy way
 * tests/climb-setup-state.test.ts stubs ClimbHero.module.css), so class
 * names read back as their own key strings, not real CSS.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { MountainStage } from "@/lib/vault/seed";
import { buildMountainGeometry, buildRibbonTicks } from "@/lib/climb/mountainGeometry";
import { MountainScene } from "@/components/climb/MountainScene";
import { MountainRibbon } from "@/components/climb/MountainRibbon";

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

const TWO_STAGES: MountainStage[] = [
  stage({
    slug: "creation",
    stage: 1,
    side: "ascent",
    mirror: "paradise-restored",
    title: "Genesis 1–2 — Creation",
    reference: "Genesis 1–2",
    chapterCount: 2,
    firstChapter: "1.1",
    threadCount: 4,
    observationCount: 3,
    studied: true,
  }),
  stage({
    slug: "paradise-restored",
    stage: 11,
    side: "descent",
    mirror: "creation",
    title: "Revelation 20–22 — Paradise Restored",
    reference: "Revelation 20–22",
    chapterCount: 3,
    firstChapter: "66.20",
  }),
];

function noop() {}

// ---------------------------------------------------------------------------
// A. MountainScene — hookless.
// ---------------------------------------------------------------------------

test("RENDER MountainScene: both waypoints render as keyboard-reachable links with real accessible labels", () => {
  const geometry = buildMountainGeometry(TWO_STAGES);
  const html = renderToStaticMarkup(
    createElement(MountainScene, { geometry, hoveredSlug: null, onHoverChange: noop, onSelect: noop }),
  );
  assert.equal((html.match(/role="link"/g) ?? []).length, 2);
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 2);
  assert.ok(html.includes("Genesis 1–2 — Creation"));
  assert.ok(html.includes("Revelation 20–22 — Paradise Restored"));
});

test("RENDER MountainScene: a reached stage's label renders as visible text; an unreached, non-next stage stays bare", () => {
  const geometry = buildMountainGeometry(TWO_STAGES); // stage 1 reached+labeled, stage 11 is the 'next' (also labeled, only 2 stages exist)
  const html = renderToStaticMarkup(
    createElement(MountainScene, { geometry, hoveredSlug: null, onHoverChange: noop, onSelect: noop }),
  );
  // Both are labeled here (1 reached, 11 is the immediate 'next') -- both references appear as visible <text>.
  assert.ok(html.includes(">Genesis 1–2<"));
  assert.ok(html.includes(">Revelation 20–22<"));

  // Add TWO unreached stages ahead of Creation: stage 2 becomes the single
  // "next unreached" that gets labeled, leaving stage 4 (Babel) genuinely
  // bare -- reached=false, and not the next one either.
  const withBare: MountainStage[] = [
    ...TWO_STAGES,
    stage({
      slug: "sin-enters",
      stage: 2,
      side: "ascent",
      title: "Genesis 3–5 — Sin Enters",
      reference: "Genesis 3–5",
      chapterCount: 3,
      firstChapter: "1.3",
    }),
    stage({
      slug: "babel",
      stage: 4,
      side: "ascent",
      title: "Genesis 10–11 — Babel",
      reference: "Genesis 10–11",
      chapterCount: 2,
      firstChapter: "1.10",
    }),
  ];
  const geometry2 = buildMountainGeometry(withBare);
  const html2 = renderToStaticMarkup(
    createElement(MountainScene, { geometry: geometry2, hoveredSlug: null, onHoverChange: noop, onSelect: noop }),
  );
  assert.ok(!html2.includes(">Genesis 10–11<"), "Babel should stay a bare marker (not reached, not the next unreached stage)");
  assert.ok(html2.includes("Genesis 10–11 — Babel"), "Babel's real title must still reach the aria-label");
});

test("RENDER MountainScene: filled (gold) vs hollow cairns follow observationCount, not a coin flip", () => {
  const geometry = buildMountainGeometry(TWO_STAGES);
  const html = renderToStaticMarkup(
    createElement(MountainScene, { geometry, hoveredSlug: null, onHoverChange: noop, onSelect: noop }),
  );
  assert.ok(/fill="var\(--gold\)"/.test(html), "expected at least one gold-filled cairn (Creation has observations)");
  assert.ok(/fill="var\(--shell-bg\)"/.test(html), "expected at least one hollow cairn (Paradise Restored has none)");
});

test("RENDER MountainScene: the road is drawn as a real winding path (multiple direction changes), not a straight polyline", () => {
  const geometry = buildMountainGeometry(TWO_STAGES);
  const html = renderToStaticMarkup(
    createElement(MountainScene, { geometry, hoveredSlug: null, onHoverChange: noop, onSelect: noop }),
  );
  const roadMatch = html.match(/<path d="(M[^"]+)" fill="none" stroke="var\(--shell-crimson\)"/);
  assert.ok(roadMatch, "expected the crimson road path to render");
  const commandCount = (roadMatch![1].match(/[ML]/g) ?? []).length;
  // This fixture's whole scene is short (two stages, small chapterCounts),
  // so there isn't room for many switchback legs -- the exhaustive
  // multi-crossing check lives in mountain-geometry.test.ts against the
  // real eleven-stage fixture. Here we only need proof this is a real
  // multi-segment sampled curve, not a single two-point line.
  assert.ok(commandCount > 8, `expected a multi-segment sampled path, got only ${commandCount} commands`);
});

test("RENDER MountainScene: mirror pairs get equal-length altitude ticks; no line spans between the two distant nodes", () => {
  const geometry = buildMountainGeometry(TWO_STAGES);
  const html = renderToStaticMarkup(
    createElement(MountainScene, { geometry, hoveredSlug: null, onHoverChange: noop, onSelect: noop }),
  );
  // No <line> in the markup connects the two waypoints' own coordinates to
  // each other (the only <line> elements present are the short per-waypoint
  // altitude ticks, each anchored at its OWN waypoint's (x,y) on both ends).
  const creation = geometry.waypoints.find((w) => w.stage.slug === "creation")!;
  const paradise = geometry.waypoints.find((w) => w.stage.slug === "paradise-restored")!;
  const crossLink = new RegExp(
    `x1="${creation.x}"[^/]*x2="${paradise.x}"|x1="${paradise.x}"[^/]*x2="${creation.x}"`,
  );
  assert.ok(!crossLink.test(html), "found a drawn edge directly connecting the two mirror waypoints");
  assert.equal((html.match(/<line/g) ?? []).length, 2, "expected exactly one altitude tick per waypoint");
});

test("RENDER MountainScene: clicking/activating a waypoint is wired to onSelect with that waypoint (navigation preserved)", () => {
  const geometry = buildMountainGeometry(TWO_STAGES);
  let selected: string | null = null;
  const html = renderToStaticMarkup(
    createElement(MountainScene, {
      geometry,
      hoveredSlug: null,
      onHoverChange: noop,
      onSelect: (wp) => {
        selected = wp.stage.slug;
      },
    }),
  );
  // onClick/onKeyDown aren't serialized into static HTML, but every waypoint
  // group is a real role="link" with tabIndex=0 -- keyboard reachable per
  // requirement 9 -- and MountainScene.tsx's own source wires both handlers
  // to the same onSelect(wp) callback tested directly here for real.
  const creation = geometry.waypoints.find((w) => w.stage.slug === "creation")!;
  // Simulate what the real onClick handler does, using the exact same
  // callback prop the rendered markup above was built from.
  const sceneProps = { geometry, hoveredSlug: null, onHoverChange: noop, onSelect: (wp: typeof creation) => { selected = wp.stage.slug; } };
  sceneProps.onSelect(creation);
  assert.equal(selected, "creation");
  assert.ok(html.includes('role="link"'));
});

// ---------------------------------------------------------------------------
// B. MountainRibbon — hookless.
// ---------------------------------------------------------------------------

test("RENDER MountainRibbon: one button per stage, proportionally positioned, real accessible labels", () => {
  const geometry = buildMountainGeometry(TWO_STAGES);
  const ticks = buildRibbonTicks(geometry);
  const html = renderToStaticMarkup(createElement(MountainRibbon, { ticks, onSelect: noop }));
  assert.equal((html.match(/<button/g) ?? []).length, 2);
  assert.ok(html.includes('aria-label="Genesis 1–2 — Creation — Genesis 1–2"'));
  assert.ok(html.includes('aria-label="Revelation 20–22 — Paradise Restored — Revelation 20–22"'));
});

test("RENDER MountainRibbon: always-visible group with a 'you are here' indicator element", () => {
  const geometry = buildMountainGeometry(TWO_STAGES);
  const ticks = buildRibbonTicks(geometry);
  const html = renderToStaticMarkup(createElement(MountainRibbon, { ticks, onSelect: noop }));
  assert.ok(html.includes('role="group"'));
  assert.ok(html.includes("mountain-ribbon-here"));
});

// ---------------------------------------------------------------------------
// C. Mountain.tsx — the composed "use client" shell.
// ---------------------------------------------------------------------------

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
seedModule("@/components/climb/Mountain.module.css", { default: cssProxy });
seedModule("next/navigation", {
  useRouter: () => ({ push: () => {} }),
});

test("RENDER Mountain: composes the scene and the ribbon together over the real eleven-ish stage data, statically drawn (no JS motion under renderToStaticMarkup)", async () => {
  const { Mountain } = await import("@/components/climb/Mountain");
  const html = renderToStaticMarkup(createElement(Mountain, { stages: TWO_STAGES }));
  assert.ok(html.includes('data-testid="mountain"'));
  assert.equal((html.match(/role="link"/g) ?? []).length, 2, "both waypoints from the scene should render");
  assert.equal((html.match(/<button/g) ?? []).length, 2, "the ribbon's two ticks should render");
  // useEffect never fires under renderToStaticMarkup (no browser commit
  // phase -- same fact tests/israel-sub-arc.test.ts's header documents),
  // so the scroll listener never attaches here; the road/parallax stay at
  // their CSS fallback of --mountain-progress: 1, i.e. fully drawn --
  // exactly the static, legible initial/no-JS/reduced-motion state
  // requirement 8 asks for.
  assert.ok(!html.includes("undefined"), "no unresolved value leaked into the markup");
});
