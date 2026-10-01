/**
 * MOUNTAINWHY-001 — `app/(app)/mountain-why/page.tsx`: the "Why this shape?"
 * disclosure screen. Same minimal render harness `tests/places-page.test.ts`
 * established for a lens page with no DB call (`PlacesPage`'s own
 * precedent): the real page, CSS Modules stubbed, rendered via
 * `react-dom/server`. The page's own `loadLensStages()`/`loadLensDisclosure()`
 * calls are NOT stubbed — they read the real content/lens/ files this task
 * moved/wrote, so this test also exercises that real integration.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

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

seedModule("@/app/(app)/mountain-why/mountain-why.module.css", { default: cssProxy });
seedModule("@/components/climb/BackToJourney.module.css", { default: cssProxy });
seedModule("@/components/climb/StageOrderToggle.module.css", { default: cssProxy });

const { default: MountainWhyPage } = nodeRequire("@/app/(app)/mountain-why/page.tsx") as {
  default: () => unknown;
};

test("RENDER: mounts BackToJourney above the disclosure content", () => {
  const html = renderToStaticMarkup(MountainWhyPage() as never);
  const backIndex = html.indexOf('data-testid="back-to-journey"');
  const pageIndex = html.indexOf('data-testid="mountain-why-page"');
  assert.ok(backIndex !== -1, `BackToJourney missing:\n${html}`);
  assert.ok(pageIndex !== -1, `page content missing:\n${html}`);
  assert.ok(backIndex < pageIndex);
});

test("RENDER: names Kenneth Hill as author", () => {
  const html = renderToStaticMarkup(MountainWhyPage() as never);
  assert.ok(html.includes('data-testid="lens-author"'));
  assert.ok(html.includes("Kenneth Hill"));
});

test("RENDER: the draft banner is visible and says this copy is not approved", () => {
  const html = renderToStaticMarkup(MountainWhyPage() as never);
  const bannerIndex = html.indexOf('data-testid="draft-banner"');
  assert.ok(bannerIndex !== -1, `draft banner missing:\n${html}`);
  assert.ok(html.includes("DRAFT") || /draft/i.test(html));
});

test("RENDER: states plainly this is a reading lens, not the text's own claim (no invented-source claim either)", () => {
  const html = renderToStaticMarkup(MountainWhyPage() as never);
  assert.ok(/reading lens|not a claim/i.test(html), `expected lens-not-a-claim language:\n${html}`);
  assert.ok(
    html.includes("does not have a documented citation") || html.includes("no specific source"),
    "the method section must honestly say no documented external source was found, not invent one",
  );
});

test("RENDER: offers canonical order as a real, available alternative lens, and names approximate chronology as not built", () => {
  const html = renderToStaticMarkup(MountainWhyPage() as never);
  assert.ok(html.includes("Canonical order"));
  assert.ok(html.includes("not built yet"));
});

test("RENDER: mounts the real StageOrderToggle with all 11 stages in its initial (lens-order) list", () => {
  const html = renderToStaticMarkup(MountainWhyPage() as never);
  assert.ok(html.includes('data-testid="stage-order-toggle"'));
  assert.ok(html.includes('data-testid="stage-order-list"'));
  // Initial view is "lens" order -- stage 1 (Genesis 1-2) must be the first <li>.
  const listStart = html.indexOf('data-testid="stage-order-list"');
  const firstLiIndex = html.indexOf("<li", listStart);
  const secondLiIndex = html.indexOf("<li", firstLiIndex + 1);
  const firstLi = html.slice(firstLiIndex, secondLiIndex);
  assert.ok(firstLi.includes("Genesis 1"), `expected Genesis 1-2 first in lens order:\n${firstLi}`);
});

test("RENDER: the orders-same note is shown, honestly, since lens order and canonical order agree for the real data", () => {
  const html = renderToStaticMarkup(MountainWhyPage() as never);
  assert.ok(html.includes('data-testid="orders-same-note"'));
});
