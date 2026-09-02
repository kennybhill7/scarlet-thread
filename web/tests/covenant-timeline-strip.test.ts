/**
 * COVENANTTIMELINE-001 — components/reader/CovenantTimelineStrip.tsx.
 *
 * TEST-ENVIRONMENT NOTE (same discipline as tests/israel-sub-arc.test.ts and
 * tests/verse-selection.test.ts, both read as precedent first): this repo's
 * test script is `tsx --test tests/*.test.ts` -- plain Node, no jsdom, no
 * bundler, so the real .module.css file can't be parsed. CovenantBadge,
 * TimelineCard, and CovenantTimelineStrip are all hookless (props in,
 * markup out), so they render directly through react-dom/server's
 * renderToStaticMarkup with only the CSS Module neutralised in
 * require.cache first (the same seedModule technique those two files use).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { covenantsForStage } from "@/lib/bible/covenants";
import { getTimeline } from "@/lib/bible/prophetsTimeline";

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
seedModule("@/components/reader/CovenantTimelineStrip.module.css", { default: cssProxy });

const stripModule = nodeRequire("@/components/reader/CovenantTimelineStrip.tsx") as typeof import(
  "@/components/reader/CovenantTimelineStrip"
);
const { CovenantBadge, TimelineCard, CovenantTimelineStrip, confidenceLabel } = stripModule;

// ---------------------------------------------------------------------------
// confidenceLabel
// ---------------------------------------------------------------------------

test("confidenceLabel: text_explicit and inference render distinct, real labels", () => {
  assert.equal(confidenceLabel("text_explicit"), "stated directly in the text");
  assert.equal(confidenceLabel("inference"), "inferred, not directly stated");
  assert.notEqual(confidenceLabel("text_explicit"), confidenceLabel("inference"));
});

// ---------------------------------------------------------------------------
// CovenantBadge
// ---------------------------------------------------------------------------

test("RENDER CovenantBadge: stage 5 (Israel) renders all four covenants in order, not one flattened badge", () => {
  const entry = covenantsForStage("gen-12-malachi-israel")!;
  const html = renderToStaticMarkup(createElement(CovenantBadge, { entry }));
  const order = ["Abrahamic", "Mosaic", "Davidic", "New"];
  let cursor = -1;
  for (const name of order) {
    const index = html.indexOf(name);
    assert.ok(index > cursor, `${name} missing or out of order in:\n${html}`);
    cursor = index;
  }
  // Real sequence, not a single item: four separate list items.
  assert.equal((html.match(/<li/g) ?? []).length, 4);
});

test("RENDER CovenantBadge: stage 1 (Creation) shows the honest 'none instituted' note and no covenant list", () => {
  const entry = covenantsForStage("gen-01-02-creation")!;
  const html = renderToStaticMarkup(createElement(CovenantBadge, { entry }));
  assert.match(html, /none of the five/i);
  assert.doesNotMatch(html, /<ol/);
});

test("RENDER CovenantBadge: stage 11's tradition-dependent caution is visible but never asserts fulfillment as fact", () => {
  const entry = covenantsForStage("rev-20-22-paradise-restored")!;
  const html = renderToStaticMarkup(createElement(CovenantBadge, { entry }));
  assert.match(html, /tradition-dependent/i);
  assert.doesNotMatch(html, /is fulfilled/i);
});

// ---------------------------------------------------------------------------
// TimelineCard
// ---------------------------------------------------------------------------

test("RENDER TimelineCard: Isaiah shows its king list, date range, and a visible (non-tooltip) BC attribution", () => {
  const entry = getTimeline(23)!; // Isaiah
  const html = renderToStaticMarkup(createElement(TimelineCard, { entry }));
  assert.match(html, /Uzziah/);
  assert.match(html, /Hezekiah/);
  assert.match(html, /740/);
  // Visible text, not just a title="" attribute nobody sees.
  assert.match(html, />[^<]*Thiele[^<]*</, `attribution not rendered as visible text:\n${html}`);
  assert.doesNotMatch(html, /title="[^"]*Thiele/, "attribution should not be hidden inside a title attribute only");
});

test("RENDER TimelineCard: Obadiah legibly renders BOTH disputed candidate windows, picks neither, and shows no single date", () => {
  const entry = getTimeline(31)!; // Obadiah
  const html = renderToStaticMarkup(createElement(TimelineCard, { entry }));
  assert.match(html, /disputed among scholars/i);
  assert.match(html, /9th century BC/);
  assert.match(html, /6th century BC/);
  assert.match(html, /850.*840/);
  assert.match(html, /586.*553/);
  // No standalone dateRange paragraph rendered for a disputed book.
  assert.doesNotMatch(html, /class="dateRange"/);
});

test("RENDER TimelineCard: Joel legibly renders both disputed candidate windows", () => {
  const entry = getTimeline(29)!; // Joel
  const html = renderToStaticMarkup(createElement(TimelineCard, { entry }));
  assert.match(html, /disputed among scholars/i);
  assert.match(html, /9th century BC/);
  assert.match(html, /Post-exilic/);
});

// ---------------------------------------------------------------------------
// CovenantTimelineStrip -- the composed component ChapterReader.tsx renders.
// ---------------------------------------------------------------------------

test("RENDER CovenantTimelineStrip: Genesis 3 shows a covenant badge and no timeline card (Genesis is out of the prophets' scope)", () => {
  const html = renderToStaticMarkup(createElement(CovenantTimelineStrip, { book: 1, chapter: 3 }));
  assert.match(html, /covenant-badge/);
  assert.doesNotMatch(html, /timeline-card/);
});

test("RENDER CovenantTimelineStrip: Isaiah 6 shows BOTH a covenant badge (Israel stage) and a timeline card", () => {
  const html = renderToStaticMarkup(createElement(CovenantTimelineStrip, { book: 23, chapter: 6 }));
  assert.match(html, /covenant-badge/);
  assert.match(html, /timeline-card/);
});

test("RENDER CovenantTimelineStrip: Matthew (the Gospels stage) renders NO covenant badge -- hideInReader honored -- and no timeline card", () => {
  const html = renderToStaticMarkup(createElement(CovenantTimelineStrip, { book: 40, chapter: 1 }));
  assert.equal(html, "");
});

test("RENDER CovenantTimelineStrip: 1 Kings renders nothing at all -- no covenant badge (Kings isn't a stage-anchoring book by itself, it's inside the Israel stage) still shows covenant, but no timeline card since Kings isn't in the 14+2", () => {
  const html = renderToStaticMarkup(createElement(CovenantTimelineStrip, { book: 11, chapter: 8 }));
  assert.match(html, /covenant-badge/); // 1 Kings is inside the Genesis-Malachi Israel stage
  assert.doesNotMatch(html, /timeline-card/); // but not one of the 14+2 timeline-covered books
});
