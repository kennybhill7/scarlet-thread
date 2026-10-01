/**
 * NAV-001 — `app/(app)/places/page.tsx`: the new minimal host page for
 * PLACELENS-001's `PlaceLens`, mounted nowhere before this task. Renders the
 * real default export via `react-dom/server` (no jsdom), stubbing only:
 *   - the two CSS Modules it touches (`places.module.css`,
 *     `BackToJourney.module.css`)
 *   - `@/components/lens/PlaceLens` — PLACELENS-001's own lazy `next/dynamic`
 *     entry point, which this test replaces with a marker element rather
 *     than exercising the real client-only globe/dataLoader module graph
 *     (already covered by `tests/place-lens-*.test.ts`); this file's job is
 *     "does the host page wire BackToJourney + PlaceLens together," not
 *     "does PlaceLens itself render correctly."
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

seedModule("@/app/(app)/places/places.module.css", { default: cssProxy });
seedModule("@/components/climb/BackToJourney.module.css", { default: cssProxy });
seedModule("@/components/lens/PlaceLens", {
  default: () => createElement("div", { "data-testid": "place-lens-marker" }),
});

const { default: PlacesPage } = nodeRequire("@/app/(app)/places/page.tsx") as {
  default: () => unknown;
};

test("RENDER: PlacesPage mounts BackToJourney above the real PlaceLens entry point", () => {
  const html = renderToStaticMarkup(PlacesPage() as never);

  const backIndex = html.indexOf('data-testid="back-to-journey"');
  const lensIndex = html.indexOf('data-testid="place-lens-marker"');
  assert.ok(backIndex !== -1, `BackToJourney missing:\n${html}`);
  assert.ok(lensIndex !== -1, `PlaceLens entry point missing:\n${html}`);
  assert.ok(backIndex < lensIndex, `BackToJourney must render above PlaceLens:\n${html}`);
});
