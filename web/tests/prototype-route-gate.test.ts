/**
 * NAV-001 — `app/(app)/prototype/israel-sub-arc/page.tsx` must 404 outside a
 * local dev server (plan §A.2: "Removed from production nav: `/prototype/*`
 * (behind an env flag)"), and still render the real prototype component in
 * dev. `@/next.config`'s `isDevEnvironment` is stubbed (via `require.cache`
 * seeding, same technique every other test in this suite uses) rather than
 * mutated through `process.env.NODE_ENV` directly, so this test cannot leak
 * global env state into any other test file sharing this process.
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

class NotFoundSignal extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundSignal";
  }
}

let devFlag = false;

seedModule("next/navigation", {
  notFound: (): never => {
    throw new NotFoundSignal();
  },
});
seedModule("@/next.config", {
  isDevEnvironment: () => devFlag,
});
seedModule("@/components/prototype/IsraelSubArcPrototype", {
  IsraelSubArcPrototype: () => createElement("div", { "data-testid": "israel-sub-arc-prototype" }),
});

const pageModule = nodeRequire("@/app/(app)/prototype/israel-sub-arc/page.tsx") as {
  default: () => unknown;
};

test("outside dev, the prototype route 404s rather than rendering", () => {
  devFlag = false;
  assert.throws(() => pageModule.default(), NotFoundSignal, "expected notFound() to fire outside dev");
});

test("inside a local dev server, the real prototype component still renders", () => {
  devFlag = true;
  const element = pageModule.default();
  const html = renderToStaticMarkup(element as never);
  assert.ok(html.includes('data-testid="israel-sub-arc-prototype"'), `prototype did not render in dev:\n${html}`);
});
