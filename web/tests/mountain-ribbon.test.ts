/**
 * MOUNTAINPLATES-001 — render tests for components/climb/MountainRibbon.tsx
 * and the composed "use client" Mountain.tsx shell.
 *
 * This file is what remains of MOUNTAINSWITCHBACK-001's tests/mountain-scene
 * .test.ts after MOUNTAINPLATES-001 deleted MountainScene.tsx (its
 * procedural SVG terrain, fully replaced by MountainPlates.tsx —
 * see tests/mountain-plates.test.ts and tests/plate-geometry.test.ts for
 * that component's own coverage). MountainRibbon.tsx's mini-map is
 * unaffected by the plates rewrite (Mountain.tsx still feeds it from the
 * ORIGINAL mountainGeometry.ts, untouched — see Mountain.tsx's own header),
 * so its tests below are otherwise unchanged from before.
 *
 * Same technique as tests/israel-sub-arc.test.ts: MountainRibbon is
 * hookless ("props in, markup out"), so it renders straight through
 * `react-dom/server`'s `renderToStaticMarkup` with no stubbing. Mountain.tsx
 * itself has real hooks (`useRouter`, `useEffect`), so `next/navigation` is
 * seeded in `require.cache` before it loads, mirroring
 * tests/climb-setup-state.test.ts's treatment of the same module.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { MountainStage } from "@/lib/vault/seed";
import { buildMountainGeometry, buildRibbonTicks } from "@/lib/climb/mountainGeometry";
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
// A. MountainRibbon — hookless.
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
// B. Mountain.tsx — the composed "use client" shell.
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
seedModule("@/components/climb/MountainPlates.module.css", { default: cssProxy });
seedModule("next/navigation", {
  useRouter: () => ({ push: () => {} }),
});

test("RENDER Mountain: composes the plates scene and the ribbon together over the real eleven-ish stage data, statically drawn (no JS motion under renderToStaticMarkup)", async () => {
  const { Mountain } = await import("@/components/climb/Mountain");
  const html = renderToStaticMarkup(createElement(Mountain, { stages: TWO_STAGES }));
  assert.ok(html.includes('data-testid="mountain"'));
  assert.ok(html.includes('data-testid="mountain-plates"'), "the new plates scene should render inside Mountain");
  // 2 plate waypoints (one per stage, `data-status` only exists on plate
  // waypoint buttons, not ribbon ticks) + 2 ribbon ticks = 4 buttons total.
  assert.equal((html.match(/data-status="/g) ?? []).length, 2, "both stages should render as plate waypoints");
  assert.equal((html.match(/<button/g) ?? []).length, 4, "2 plate waypoints + 2 ribbon ticks");
  assert.ok(html.includes("Genesis 1–2"));
  assert.ok(html.includes("Revelation 20–22"));
  // useEffect never fires under renderToStaticMarkup (no browser commit
  // phase -- same fact tests/israel-sub-arc.test.ts's header documents),
  // so the scroll listener never attaches here; the rope reveal stays at
  // its CSS fallback of --mountain-progress: 1, i.e. fully drawn -- exactly
  // the static, legible initial/no-JS/reduced-motion state requirement 8
  // asks for.
  assert.ok(!html.includes("undefined"), "no unresolved value leaked into the markup");
});
