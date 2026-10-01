/**
 * MOUNTAINWHY-001 — Mountain.tsx's new "Why does the mountain have this
 * shape?" link into /mountain-why. Same jsdom-less render harness
 * tests/mountain-mirror-pairs.test.ts already established for this exact
 * component (real Mountain.tsx, CSS Modules + next/navigation + next/link
 * stubbed, rendered with `renderToStaticMarkup`) — a new, separate test file
 * rather than editing that one, since MIRRORSPLIT-001 owns it and this task
 * is only adding one new link, not changing anything MIRRORSPLIT-001 tests.
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

const cssProxy = new Proxy({}, { get: (_target, key) => (typeof key === "string" ? key : undefined) });

seedModule("@/components/climb/Mountain.module.css", { default: cssProxy });
seedModule("@/components/climb/MountainDesktop.module.css", { default: cssProxy });
seedModule("@/components/climb/MountainPlates.module.css", { default: cssProxy });
seedModule("@/components/ui/Sheet.module.css", { default: cssProxy });
seedModule("next/navigation", { useRouter: () => ({ push: () => {} }) });
seedModule("next/link", {
  default: ({ href, children, className, ...rest }: { href: string; children?: unknown; className?: string }) =>
    createElement("a", { href, className, ...rest }, children as never),
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
    chapterCount: 1,
    threadCount: 0,
    observationCount: 0,
    questionCount: 0,
    studied: false,
    ...overrides,
  };
}

const withAMirrorPair: MountainStage[] = [
  mkStage({ slug: "gen-01-02-creation", stage: 1, mirror: "rev-20-22-paradise-restored" }),
  mkStage({ slug: "rev-20-22-paradise-restored", stage: 11, side: "descent", mirror: "gen-01-02-creation" }),
];

const withNoMirrorPairs: MountainStage[] = [mkStage({ slug: "solo", stage: 1, mirror: null })];

function render(stages: MountainStage[]): string {
  return renderToStaticMarkup(createElement(Mountain, { stages }));
}

test("renders a real, always-visible link to /mountain-why when there is at least one mirror pair", () => {
  const html = render(withAMirrorPair);
  assert.ok(html.includes('href="/mountain-why"'), `expected a /mountain-why link in:\n${html}`);
  assert.ok(html.includes("Why does the mountain have this shape?"));
});

test('the /mountain-why link carries data-testid="why-this-shape-link"', () => {
  const html = render(withAMirrorPair);
  assert.ok(html.includes('data-testid="why-this-shape-link"'));
});

test("with zero mirror pairs, the pairs section (and this link, which lives inside it) does not render", () => {
  const html = render(withNoMirrorPairs);
  assert.ok(!html.includes('href="/mountain-why"'));
});
