/**
 * ISRAELPROTO-001 — the Israel sub-arc navigation prototype
 * (`components/prototype/*`, `lib/prototype/israel-sub-arc.ts`,
 * `app/(app)/prototype/israel-sub-arc/page.tsx`). Isolated from the real
 * Mountain/stages data on purpose — see `lib/prototype/israel-sub-arc.ts`'s
 * own header for why.
 *
 * TEST-ENVIRONMENT NOTE (same discipline as `tests/teach-pane.test.ts` and
 * `tests/climb-setup-state.test.ts`, both read as precedent before writing
 * this file): this repo's test script is `tsx --test tests/*.test.ts` —
 * plain Node, no jsdom, no bundler, so no real `.css`/`.module.css` file can
 * be parsed.
 *
 *   1. `IsraelSubArcRidge` and `IsraelSubArcDetail` are both HOOKLESS
 *      ("props in, markup out" — `TeachSection.tsx`'s `TeachOutlinePanel`
 *      precedent), so they render directly through `react-dom/server`'s
 *      `renderToStaticMarkup` with controlled props, no CSS Module stub
 *      needed (neither file imports one).
 *   2. `IsraelSubArcPrototype` (the stateful "use client" shell) imports
 *      `@/components/ui/Sheet`, which imports `./Sheet.module.css` — that
 *      one real CSS Module is neutralised in `require.cache` before the
 *      shell module loads, mirroring `tests/climb-setup-state.test.ts`'s
 *      treatment of `ClimbHero.module.css`. `useEffect` never fires under
 *      `renderToStaticMarkup` (no browser commit phase), so `Sheet`'s
 *      `showModal()` call never runs here — the rendered markup below is
 *      always the CLOSED state, which is enough to prove the banner, the
 *      heading, and the ridge all land on one page together.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ISRAEL_SUB_ARC_BANNER,
  ISRAEL_SUB_ARC_PHASES,
  ISRAEL_SUB_ARC_PLACEHOLDER_NOTE,
  elevationOf,
  phaseBySlug,
} from "@/lib/prototype/israel-sub-arc";
import { IsraelSubArcDetail } from "@/components/prototype/IsraelSubArcDetail";
import { IsraelSubArcRidge } from "@/components/prototype/IsraelSubArcRidge";

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
seedModule("@/components/ui/Sheet.module.css", { default: cssProxy });

// ---------------------------------------------------------------------------
// A. The data itself — the content Ken supplied, unchanged by any UI layer.
// ---------------------------------------------------------------------------

test("ISRAEL_SUB_ARC_PHASES: exactly six phases, in order, Patriarchs through Return", () => {
  assert.equal(ISRAEL_SUB_ARC_PHASES.length, 6);
  assert.deepEqual(
    ISRAEL_SUB_ARC_PHASES.map((p) => p.slug),
    ["patriarchs", "exodus", "conquest", "kingdom", "exile", "return"],
  );
  assert.deepEqual(
    ISRAEL_SUB_ARC_PHASES.map((p) => p.order),
    [1, 2, 3, 4, 5, 6],
  );
});

test("ISRAEL_SUB_ARC_PHASES: each phase carries its real chapter range", () => {
  assert.equal(phaseBySlug("patriarchs")?.range, "Genesis 12–50");
  assert.equal(phaseBySlug("exodus")?.range, "Exodus–Deuteronomy");
  assert.equal(phaseBySlug("conquest")?.range, "Joshua–Judges");
  assert.equal(phaseBySlug("kingdom")?.range, "Samuel–Kings, Psalms");
  assert.equal(phaseBySlug("exile")?.range, "Kings–Prophets");
  assert.equal(phaseBySlug("return")?.range, "Ezra–Malachi");
});

test("ISRAEL_SUB_ARC_PHASES: Kingdom is the only peak", () => {
  const peaks = ISRAEL_SUB_ARC_PHASES.filter((p) => p.peak);
  assert.deepEqual(peaks.map((p) => p.slug), ["kingdom"]);
});

test("elevationOf: ascends to the peak then descends -- Kingdom (order 4) is strictly higher than every neighbor", () => {
  const peakOrder = 4;
  const levels = ISRAEL_SUB_ARC_PHASES.map((p) => elevationOf(p.order, peakOrder));
  assert.deepEqual(levels, [0, 1, 2, 3, 2, 1]);
  const kingdomLevel = levels[3];
  assert.ok(levels.every((level, i) => i === 3 || level < kingdomLevel));
});

// ---------------------------------------------------------------------------
// B. IsraelSubArcRidge -- hookless, props in / markup out.
// ---------------------------------------------------------------------------

function noop() {}

test("RENDER IsraelSubArcRidge: all six phases render, in the given order, each with its own name and chapter range in its accessible label", () => {
  const html = renderToStaticMarkup(
    createElement(IsraelSubArcRidge, { phases: ISRAEL_SUB_ARC_PHASES, selectedSlug: null, onSelect: noop }),
  );
  let cursor = -1;
  for (const phase of ISRAEL_SUB_ARC_PHASES) {
    const label = `${phase.name} — ${phase.range}`;
    assert.ok(html.includes(label), `missing accessible label for ${phase.slug}: ${label}`);
    const index = html.indexOf(label);
    assert.ok(index > cursor, `${phase.slug} rendered out of order`);
    cursor = index;
  }
});

test("RENDER IsraelSubArcRidge: Kingdom's accessible label calls out the peak; no other phase's does", () => {
  const html = renderToStaticMarkup(
    createElement(IsraelSubArcRidge, { phases: ISRAEL_SUB_ARC_PHASES, selectedSlug: null, onSelect: noop }),
  );
  assert.ok(html.includes("Kingdom — Samuel–Kings, Psalms, the sub-arc&#x27;s peak"));
  for (const phase of ISRAEL_SUB_ARC_PHASES.filter((p) => !p.peak)) {
    assert.ok(!html.includes(`${phase.name} — ${phase.range}, the sub-arc&#x27;s peak`));
  }
});

test("RENDER IsraelSubArcRidge: Kingdom's point renders a larger, filled circle than the other five (the 'peak' visual treatment)", () => {
  const html = renderToStaticMarkup(
    createElement(IsraelSubArcRidge, { phases: ISRAEL_SUB_ARC_PHASES, selectedSlug: null, onSelect: noop }),
  );
  // Kingdom: r=14, filled gold. Every other point: r=9, hollow shell-bg.
  assert.ok(/r="14"[^>]*fill="var\(--gold\)"/.test(html), "expected Kingdom's r=14 gold-filled circle");
  const hollowMatches = html.match(/r="9"[^>]*fill="var\(--shell-bg\)"/g) ?? [];
  assert.equal(hollowMatches.length, 5, "expected exactly five hollow r=9 circles");
});

test("RENDER IsraelSubArcRidge: every point is a focusable, labeled button -- keyboard reachable, not mouse-only", () => {
  const html = renderToStaticMarkup(
    createElement(IsraelSubArcRidge, { phases: ISRAEL_SUB_ARC_PHASES, selectedSlug: null, onSelect: noop }),
  );
  const roleButtonCount = (html.match(/role="button"/g) ?? []).length;
  const tabIndexCount = (html.match(/tabindex="0"/g) ?? []).length;
  const focusableCount = (html.match(/focusable="true"/g) ?? []).length;
  assert.equal(roleButtonCount, 6);
  assert.equal(tabIndexCount, 6);
  assert.equal(focusableCount, 6);
});

test("RENDER IsraelSubArcRidge: keyboard focus has a visible ring, not only a hidden outline", () => {
  const html = renderToStaticMarkup(
    createElement(IsraelSubArcRidge, { phases: ISRAEL_SUB_ARC_PHASES, selectedSlug: null, onSelect: noop }),
  );
  assert.ok(html.includes(".israel-sub-arc-phase:focus .israel-sub-arc-focus-ring"));
  assert.equal((html.match(/class="israel-sub-arc-focus-ring"/g) ?? []).length, 6);
  assert.equal((html.match(/stroke="var\(--shell-crimson-text\)"/g) ?? []).length, 6);
});

test("RENDER IsraelSubArcRidge: the selected phase (and only it) renders aria-pressed=true", () => {
  const html = renderToStaticMarkup(
    createElement(IsraelSubArcRidge, { phases: ISRAEL_SUB_ARC_PHASES, selectedSlug: "kingdom", onSelect: noop }),
  );
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 5);
});

// ---------------------------------------------------------------------------
// C. IsraelSubArcDetail -- hookless, props in / markup out.
// ---------------------------------------------------------------------------

test("RENDER IsraelSubArcDetail: phase=null renders nothing", () => {
  const html = renderToStaticMarkup(createElement(IsraelSubArcDetail, { phase: null, onBack: noop }));
  assert.equal(html, "");
});

test("RENDER IsraelSubArcDetail: a selected phase shows its name, its real chapter range, and the honest placeholder note -- never fabricated content", () => {
  const exodus = phaseBySlug("exodus")!;
  const html = renderToStaticMarkup(createElement(IsraelSubArcDetail, { phase: exodus, onBack: noop }));
  assert.ok(html.includes("Exodus"));
  assert.ok(html.includes("Exodus–Deuteronomy"));
  assert.ok(html.includes(ISRAEL_SUB_ARC_PLACEHOLDER_NOTE));
});

test("RENDER IsraelSubArcDetail: Kingdom is labeled 'Peak of the sub-arc'; a non-peak phase is labeled with its position instead", () => {
  const kingdom = phaseBySlug("kingdom")!;
  const kingdomHtml = renderToStaticMarkup(createElement(IsraelSubArcDetail, { phase: kingdom, onBack: noop }));
  assert.ok(kingdomHtml.includes("Peak of the sub-arc"));

  const patriarchs = phaseBySlug("patriarchs")!;
  const patriarchsHtml = renderToStaticMarkup(
    createElement(IsraelSubArcDetail, { phase: patriarchs, onBack: noop }),
  );
  assert.ok(patriarchsHtml.includes("Phase 1 of 6"));
  assert.ok(!patriarchsHtml.includes("Peak of the sub-arc"));
});

test("RENDER IsraelSubArcDetail: an obvious, labeled way back out is always present alongside the content", () => {
  const kingdom = phaseBySlug("kingdom")!;
  const html = renderToStaticMarkup(createElement(IsraelSubArcDetail, { phase: kingdom, onBack: noop }));
  assert.ok(html.includes('aria-label="Back to the arc"'));
  assert.ok(html.includes("Back to the arc"));
});

// ---------------------------------------------------------------------------
// D. IsraelSubArcPrototype -- the composed shell (banner + heading + ridge).
// ---------------------------------------------------------------------------

test("RENDER IsraelSubArcPrototype: the honest prototype banner is present", async () => {
  const { IsraelSubArcPrototype } = await import("@/components/prototype/IsraelSubArcPrototype");
  const html = renderToStaticMarkup(createElement(IsraelSubArcPrototype));
  assert.ok(html.includes('data-testid="israel-sub-arc-banner"'));
  assert.ok(html.includes(ISRAEL_SUB_ARC_BANNER));
});

test("RENDER IsraelSubArcPrototype: the ridge (all six phases) renders on the same page as the banner", async () => {
  const { IsraelSubArcPrototype } = await import("@/components/prototype/IsraelSubArcPrototype");
  const html = renderToStaticMarkup(createElement(IsraelSubArcPrototype));
  for (const phase of ISRAEL_SUB_ARC_PHASES) {
    assert.ok(html.includes(phase.name), `missing ${phase.name} on the composed page`);
  }
});
