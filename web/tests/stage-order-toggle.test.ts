/**
 * MOUNTAINWHY-001 — tests for components/climb/StageOrderToggle.tsx: the
 * pure `rowsForView` selection function (directly unit-tested) and a static
 * initial-render check of the real component (no jsdom; `renderToStaticMarkup`
 * exercises `useState`'s initial value only, same as this repo's other
 * hook-bearing leaf components render fine under this harness).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// StageOrderToggle.tsx imports its own CSS Module ("./StageOrderToggle.module.css"),
// which this jsdom-less `tsx --test` runner cannot execute directly as JS --
// same stubbing pattern tests/mountain-mirror-pairs.test.ts and
// tests/places-page.test.ts already established for every other component
// under test here.
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
seedModule("@/components/climb/StageOrderToggle.module.css", { default: cssProxy });

const { rowsForView, StageOrderToggle } = nodeRequire("@/components/climb/StageOrderToggle") as typeof import("../components/climb/StageOrderToggle");
type OrderedStageRow = import("../components/climb/StageOrderToggle").OrderedStageRow;

const lens: OrderedStageRow[] = [
  { slug: "a", title: "A" },
  { slug: "b", title: "B" },
];
const canonical: OrderedStageRow[] = [
  { slug: "b", title: "B" },
  { slug: "a", title: "A" },
];

test("rowsForView: 'lens' returns the lens-order rows", () => {
  assert.deepEqual(rowsForView("lens", lens, canonical), lens);
});

test("rowsForView: 'canonical' returns the canonical-order rows", () => {
  assert.deepEqual(rowsForView("canonical", lens, canonical), canonical);
});

test("RENDER: initial view is lens order, with both toggle buttons present and the lens button marked active", () => {
  const html = renderToStaticMarkup(
    createElement(StageOrderToggle, { lensOrder: lens, canonicalOrder: canonical, ordersDiffer: true }),
  );
  assert.ok(html.includes('data-testid="order-lens-button"'));
  assert.ok(html.includes('data-testid="order-canonical-button"'));
  // The first <button>...</button> element is the lens-order button (markup
  // order) -- it alone should carry data-active="true" on initial render.
  const firstButtonStart = html.indexOf("<button");
  const firstButtonEnd = html.indexOf("</button>", firstButtonStart);
  const firstButtonHtml = html.slice(firstButtonStart, firstButtonEnd);
  assert.ok(firstButtonHtml.includes('data-testid="order-lens-button"'), firstButtonHtml);
  assert.ok(firstButtonHtml.includes('data-active="true"'), firstButtonHtml);
  // Initial list is lens order: "A" before "B" (each row renders as
  // "<index-span> <title></li>" -- search for the title immediately before
  // its row's closing tag, not a bare ">A<", since the real markup has a
  // literal space between the index span and the title text).
  const listIndex = html.indexOf('data-testid="stage-order-list"');
  const aIndex = html.indexOf(" A</li>", listIndex);
  const bIndex = html.indexOf(" B</li>", listIndex);
  assert.ok(aIndex !== -1 && bIndex !== -1 && aIndex < bIndex, `expected A before B in initial lens order:\n${html}`);
});

test("RENDER: when ordersDiffer is false, the orders-same note renders", () => {
  const html = renderToStaticMarkup(
    createElement(StageOrderToggle, { lensOrder: lens, canonicalOrder: canonical, ordersDiffer: false }),
  );
  assert.ok(html.includes('data-testid="orders-same-note"'));
});

test("RENDER: when ordersDiffer is true, the orders-same note does not render", () => {
  const html = renderToStaticMarkup(
    createElement(StageOrderToggle, { lensOrder: lens, canonicalOrder: canonical, ordersDiffer: true }),
  );
  assert.ok(!html.includes('data-testid="orders-same-note"'));
});
