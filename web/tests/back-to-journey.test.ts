/**
 * NAV-001 — `components/climb/BackToJourney.tsx`: a persistent, real link
 * back to "/" (the Journey tab's route), rendered via
 * `react-dom/server`'s `renderToStaticMarkup` (no jsdom, same technique as
 * this task's other new component tests).
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
seedModule("@/components/climb/BackToJourney.module.css", { default: cssProxy });

const { BackToJourney } = nodeRequire("@/components/climb/BackToJourney") as {
  BackToJourney: typeof import("../components/climb/BackToJourney").BackToJourney;
};

test("RENDER: BackToJourney links to / and reads Journey, with a real tap target", () => {
  const html = renderToStaticMarkup(createElement(BackToJourney) as never);

  const tagMatch = html.match(/<a[^>]*data-testid="back-to-journey"[^>]*>/);
  assert.ok(tagMatch, `BackToJourney link not found:\n${html}`);
  assert.ok(tagMatch![0].includes('href="/"'), `wrong href:\n${tagMatch![0]}`);
  // A-040: a plain <Link> needs data-tap to reach globals.css's 44px floor
  // (same rule ClimbHero's Settings link already follows).
  assert.match(tagMatch![0], /data-tap/, `missing data-tap:\n${tagMatch![0]}`);
  assert.ok(html.includes("Journey"), `missing "Journey" label:\n${html}`);
});
