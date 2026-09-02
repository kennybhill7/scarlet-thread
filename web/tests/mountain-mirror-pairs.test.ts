/**
 * MIRRORSPLIT-001 — Mountain.tsx's new always-visible "Mirror pairs" list,
 * the real entry point into /mirror/[stageSlug] (see that component's own
 * header comment for why this is NOT wired into the hover tooltip: `.tip`
 * unmounts on the same mouseleave/blur that would be needed to reach a link
 * inside it).
 *
 * TEST-ENVIRONMENT NOTE (same discipline as tests/climb-setup-state.test.ts,
 * which already exercises Mountain.tsx transitively): plain Node, no jsdom.
 * `nodeRequire` + `require.cache` seeding loads the REAL Mountain.tsx,
 * stubbing only its CSS Module and `next/navigation`/`next/link`.
 * `renderToStaticMarkup` renders the real component to real HTML.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { MountainStage } from "@/lib/vault/seed";

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

const cssProxy = new Proxy(
  {},
  { get: (_target, key) => (typeof key === "string" ? key : undefined) },
);

seedModule("@/components/climb/Mountain.module.css", { default: cssProxy });
seedModule("next/navigation", {
  useRouter: () => ({ push: () => {} }),
});
seedModule("next/link", {
  default: ({ href, children, className }: { href: string; children?: unknown; className?: string }) =>
    createElement("a", { href, className }, children as never),
});

const { Mountain } = nodeRequire("@/components/climb/Mountain") as {
  Mountain: typeof import("../components/climb/Mountain").Mountain;
};

function mkStage(overrides: Partial<MountainStage> & Pick<MountainStage, "slug" | "stage">): MountainStage {
  return {
    title: `Stage ${overrides.stage}`,
    reference: `Ref ${overrides.stage}`,
    short: "",
    side: "ascent",
    mirror: null,
    firstChapter: "1.1",
    // MOUNTAINSWITCHBACK-001 added this required field after this test file
    // was written; a harmless fixture default (unused by the mirror-pairs
    // logic under test), not a change to what's being tested.
    chapterCount: 1,
    threadCount: 0,
    observationCount: 0,
    questionCount: 0,
    studied: false,
    ...overrides,
  };
}

const genesisCreation = mkStage({
  slug: "gen-01-02-creation",
  title: "Genesis 1–2 — God and Righteous People in Paradise",
  reference: "Genesis 1–2",
  stage: 1,
  side: "ascent",
  mirror: "rev-20-22-paradise-restored",
  firstChapter: "1.1",
});
const genesisSin = mkStage({
  slug: "gen-03-05-sin-enters",
  title: "Genesis 3–5 — Satan and Sin Enter",
  reference: "Genesis 3–5",
  stage: 2,
  mirror: "rev-20-satan-cast-out",
  firstChapter: "1.3",
});
const gospels = mkStage({
  slug: "gospels-jesus-christ",
  title: "The Gospels — Jesus Christ (God)",
  reference: "The Gospels",
  stage: 6,
  side: "peak",
  mirror: null,
  firstChapter: "40.1",
});
const revSatan = mkStage({
  slug: "rev-20-satan-cast-out",
  title: "Revelation 20 — Satan and Sin Exit",
  reference: "Revelation 20",
  stage: 10,
  side: "descent",
  mirror: "gen-03-05-sin-enters",
  firstChapter: "66.20",
});
const revParadise = mkStage({
  slug: "rev-20-22-paradise-restored",
  title: "Revelation 20–22 — God and Redeemed People in Paradise",
  reference: "Revelation 20–22",
  stage: 11,
  side: "descent",
  mirror: "gen-01-02-creation",
  firstChapter: "66.21",
});
const brokenMirrorStage = mkStage({
  slug: "broken-stage",
  title: "Broken Stage",
  reference: "Broken",
  stage: 12,
  mirror: "does-not-exist",
});

const elevenLikeStages: MountainStage[] = [
  genesisCreation,
  genesisSin,
  gospels,
  revSatan,
  revParadise,
];

function render(stages: MountainStage[]): string {
  return renderToStaticMarkup(createElement(Mountain, { stages }));
}

test("renders one link per mirror pair, deduplicated (not one row per stage)", () => {
  const html = render(elevenLikeStages);
  const linkCount = (html.match(/href="\/mirror\//g) ?? []).length;
  // 5 stages have a mirror, forming 2 distinct pairs here (creation<->paradise,
  // sin<->satan-cast-out) -- 2 links, not 4.
  assert.equal(linkCount, 2, `expected 2 deduplicated pair links, got ${linkCount} in:\n${html}`);
});

test("each pair link points at /mirror/<slug> for one real side of the pair", () => {
  const html = render(elevenLikeStages);
  assert.ok(html.includes('href="/mirror/gen-01-02-creation"') || html.includes('href="/mirror/rev-20-22-paradise-restored"'));
  assert.ok(html.includes('href="/mirror/gen-03-05-sin-enters"') || html.includes('href="/mirror/rev-20-satan-cast-out"'));
});

test("pair link text is a plain structural reference-vs-reference label, no interpretive commentary", () => {
  const html = render(elevenLikeStages);
  assert.ok(html.includes("Genesis 3–5") && html.includes("Revelation 20"));
  assert.ok(html.includes("↔"));
  // Nothing beyond the two references and the separator -- no "because", no
  // explanation of the connection.
  assert.ok(!html.includes("removed there"));
});

test("stage 6 (the Gospels, mirror: null) contributes no pair row and is not linked", () => {
  const html = render(elevenLikeStages);
  assert.ok(!html.includes('href="/mirror/gospels-jesus-christ"'));
});

test("a mirror slug pointing at an unknown stage is silently excluded, not a crash", () => {
  const html = render([...elevenLikeStages, brokenMirrorStage]);
  assert.ok(!html.includes('href="/mirror/broken-stage"'));
});

test("no stages with a mirror at all renders no 'Mirror pairs' section", () => {
  const noMirrors: MountainStage[] = [mkStage({ slug: "solo", stage: 1, mirror: null })];
  const html = render(noMirrors);
  assert.ok(!html.includes("Mirror pairs"));
});

test("an empty stage list renders without crashing and with no pairs section", () => {
  const html = render([]);
  assert.ok(!html.includes("Mirror pairs"));
});

// ===========================================================================
// MUTATION-GUARD — dedup key. The pair key is built from
// `[stage.slug, stage.mirror].sort().join("~")`; if that were built from
// stage.slug alone (a plausible copy-paste from the `ties` loop above it,
// which also computes a dedup key), every mirrored stage would produce its
// own "row", doubling the list back to one-per-stage instead of one-per-pair.
// This test fails loudly under that mutation.
// ===========================================================================

test("MUTATION-GUARD: the pair count stays at one-per-pair as stage count grows", () => {
  const html = render(elevenLikeStages);
  const linkCount = (html.match(/href="\/mirror\//g) ?? []).length;
  assert.equal(linkCount, 2);
});
