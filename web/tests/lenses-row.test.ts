/**
 * NAV-001 — tests for `components/climb/LensesRow.tsx`: `buildLensLinks`
 * (pure) and the rendered `LensesRow` output (hookless, `renderToStaticMarkup`
 * — same technique as `tests/continue-card.test.ts`/
 * `tests/place-lens-render.test.ts`).
 *
 * Author: Kenneth Hill
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
seedModule("@/components/climb/LensesRow.module.css", { default: cssProxy });

const lensesRowModule = nodeRequire("@/components/climb/LensesRow") as {
  buildLensLinks: typeof import("../components/climb/LensesRow").buildLensLinks;
  LensesRow: typeof import("../components/climb/LensesRow").LensesRow;
};
const { buildLensLinks, LensesRow } = lensesRowModule;

// ===========================================================================
// buildLensLinks — pure logic
// ===========================================================================

test("buildLensLinks: Story Map and Places are always the same two real routes", () => {
  const links = buildLensLinks({ stages: [], firstThreadSlug: null });
  assert.equal(links.find((l) => l.key === "story-map")?.href, "/map");
  assert.equal(links.find((l) => l.key === "places")?.href, "/places");
});

test("buildLensLinks: Mirror links to the lowest-numbered stage with a real mirror pair", () => {
  const links = buildLensLinks({
    stages: [
      { stage: 6, slug: "gospels-jesus-christ", mirror: null }, // the peak -- no pair
      { stage: 2, slug: "gen-03-05-sin-enters", mirror: "rev-20-satan-cast-out" },
      { stage: 10, slug: "rev-20-satan-cast-out", mirror: "gen-03-05-sin-enters" },
    ],
    firstThreadSlug: null,
  });
  assert.equal(links.find((l) => l.key === "mirror")?.href, "/mirror/gen-03-05-sin-enters");
});

test("buildLensLinks: no stage has a mirror pair -> Mirror falls back to / rather than a broken link", () => {
  const links = buildLensLinks({
    stages: [{ stage: 6, slug: "gospels-jesus-christ", mirror: null }],
    firstThreadSlug: null,
  });
  assert.equal(links.find((l) => l.key === "mirror")?.href, "/");
});

test("buildLensLinks: Threads links to the learner's own real thread when one exists", () => {
  const links = buildLensLinks({ stages: [], firstThreadSlug: "seed-of-the-woman" });
  assert.equal(links.find((l) => l.key === "threads")?.href, "/threads/seed-of-the-woman");
});

test("buildLensLinks: Threads falls back to /review when the learner has no threads yet", () => {
  const links = buildLensLinks({ stages: [], firstThreadSlug: null });
  assert.equal(links.find((l) => l.key === "threads")?.href, "/review");
});

// ===========================================================================
// LensesRow — rendered output
// ===========================================================================

test("RENDER: all four lens links render with their real hrefs, in plan order", () => {
  const links = buildLensLinks({
    stages: [{ stage: 2, slug: "gen-03-05-sin-enters", mirror: "rev-20-satan-cast-out" }],
    firstThreadSlug: "seed-of-the-woman",
  });
  const html = renderToStaticMarkup(createElement(LensesRow, { lenses: links }) as never);

  assert.ok(html.includes('data-testid="lenses-row"'));
  for (const [key, href, label] of [
    ["story-map", "/map", "Story Map"],
    ["places", "/places", "Places"],
    ["mirror", "/mirror/gen-03-05-sin-enters", "Mirror"],
    ["threads", "/threads/seed-of-the-woman", "Threads"],
  ] as const) {
    const tagMatch = html.match(new RegExp(`<a[^>]*data-lens-key="${key}"[^>]*>`));
    assert.ok(tagMatch, `missing lens ${key}:\n${html}`);
    assert.ok(
      tagMatch![0].includes(`href="${href}"`),
      `lens ${key} did not carry href ${href}:\n${tagMatch![0]}`,
    );
    assert.ok(html.includes(label), `missing label ${label}:\n${html}`);
  }
  // Order matches plan §A.2: Story Map, Places, Mirror, Threads.
  const order = ["story-map", "places", "mirror", "threads"].map((key) => html.indexOf(`data-lens-key="${key}"`));
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
    `lenses did not render in plan order:\n${html}`,
  );
});
