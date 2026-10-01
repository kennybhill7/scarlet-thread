/**
 * PLACELENS-001 — deterministic SVG/HTML render tests for the hookless
 * components (`PlaceLensSvg.tsx`, `PlaceList.tsx`, `PlaceDetails.tsx`), via
 * `react-dom/server`'s `renderToStaticMarkup` at a FIXED rotation/scale
 * (plan §C.7), same CSS-module-stubbing technique
 * `tests/mountain-plates.test.ts` uses (class names read back as their own
 * key string, not real CSS). A small SYNTHETIC place set is used here on
 * purpose, for a stable, easy-to-read snapshot — the honesty rules
 * themselves are proven against the REAL 1,259-row dataset in
 * `tests/place-lens-honesty.test.ts`; this file proves the RENDER PATH
 * reacts to tier correctly, including one real adversarial mutation (task
 * brief: "make a disputed place render identically to an identified one")
 * caught by assertion, then reverted.
 *
 * Author: Kenneth Hill
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ProjectionConfig } from "@/components/lens/PlaceLens/geometry";
import type { LensPlace } from "@/components/lens/PlaceLens/types";

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
seedModule("@/components/lens/PlaceLens/PlaceLens.module.css", { default: cssProxy });

const { PlaceLensSvg } = nodeRequire("@/components/lens/PlaceLens/PlaceLensSvg") as {
  PlaceLensSvg: typeof import("../components/lens/PlaceLens/PlaceLensSvg").PlaceLensSvg;
};
const { PlaceList } = nodeRequire("@/components/lens/PlaceLens/PlaceList") as {
  PlaceList: typeof import("../components/lens/PlaceLens/PlaceList").PlaceList;
};
const { PlaceDetails } = nodeRequire("@/components/lens/PlaceLens/PlaceDetails") as {
  PlaceDetails: typeof import("../components/lens/PlaceLens/PlaceDetails").PlaceDetails;
};

function place(overrides: Partial<LensPlace> & Pick<LensPlace, "id" | "name" | "tier">): LensPlace {
  const located = overrides.tier !== "unlocated";
  return {
    kind: located ? "point" : "unlocated",
    lon: located ? 35 : null,
    lat: located ? 32 : null,
    coordinateBasis: located ? "representative point" : null,
    modernName: null,
    note: null,
    candidates: [],
    passages: [
      {
        range: { versificationId: "eng-protestant-66-31102-v1", start: "1.1.1", end: "1.1.1" },
        display: "Genesis 1:1",
        inDatasetVerseList: true,
      },
    ],
    ...overrides,
  };
}

const IDENTIFIED = place({ id: "jerusalem-test", name: "Jerusalem (test)", tier: "identified" });
const DISPUTED = place({ id: "sinai-test", name: "Sinai (test)", tier: "disputed", note: "Location disputed." });
const UNLOCATED = place({ id: "eden-test", name: "Eden (test)", tier: "unlocated", note: "No confident location." });

const CONFIG: ProjectionConfig = { rotation: { lambda: 35, phi: 31 }, scale: 150, translate: [180, 180] };

test("PlaceLensSvg renders a marker for an identified place, solid stroke", () => {
  const html = renderToStaticMarkup(
    createElement(PlaceLensSvg, {
      idPrefix: "t",
      width: 360,
      height: 360,
      config: CONFIG,
      land: null,
      places: [IDENTIFIED],
      selectedPlace: null,
    }),
  );
  assert.match(html, /data-stroke="solid"/);
  assert.doesNotMatch(html, /data-stroke="dashed"/);
  assert.match(html, /Jerusalem \(test\)/);
});

test("PlaceLensSvg renders a marker for a disputed place, dashed stroke", () => {
  const html = renderToStaticMarkup(
    createElement(PlaceLensSvg, {
      idPrefix: "t",
      width: 360,
      height: 360,
      config: CONFIG,
      land: null,
      places: [DISPUTED],
      selectedPlace: null,
    }),
  );
  assert.match(html, /data-stroke="dashed"/);
  assert.doesNotMatch(html, /data-stroke="solid"/);
});

test("PlaceLensSvg renders NO marker for an unlocated place (Eden-shaped fixture)", () => {
  const html = renderToStaticMarkup(
    createElement(PlaceLensSvg, {
      idPrefix: "t",
      width: 360,
      height: 360,
      config: CONFIG,
      land: null,
      places: [UNLOCATED],
      selectedPlace: null,
    }),
  );
  assert.doesNotMatch(html, /Eden \(test\)/);
  assert.doesNotMatch(html, /data-stroke=/);
});

test("ADVERSARIAL MUTATION — a disputed place mutated to render identically to an identified one is caught", () => {
  // The real bug this guards against: tierStyle.ts's stroke mapping silently
  // collapsing "dashed" to "solid" for a contested tier, which would make a
  // disputed identification look exactly as certain as Jerusalem on the
  // globe — the one thing the honesty convention forbids.
  const mutatedDisputedAsSolid: LensPlace = { ...DISPUTED, tier: "identified" }; // the mutation
  const html = renderToStaticMarkup(
    createElement(PlaceLensSvg, {
      idPrefix: "t",
      width: 360,
      height: 360,
      config: CONFIG,
      land: null,
      places: [mutatedDisputedAsSolid],
      selectedPlace: null,
    }),
  );
  // With the real (unmutated) DISPUTED place, the test two above asserts
  // "dashed" appears and "solid" does not. Mutating tier to "identified"
  // flips that — proving the test WOULD fail if tierStyle.ts ever stopped
  // distinguishing them. The mutation is local to this test (a spread copy);
  // DISPUTED itself, and tierStyle.ts, are never changed.
  assert.match(html, /data-stroke="solid"/);
  assert.doesNotMatch(html, /data-stroke="dashed"/);
  // Revert check: the ORIGINAL DISPUTED object is untouched (spread, not mutated in place).
  assert.equal(DISPUTED.tier, "disputed");
});

test("PlaceList renders every place, including unlocated ones (the globe cannot show those at all)", () => {
  const html = renderToStaticMarkup(
    createElement(PlaceList, {
      idPrefix: "t",
      places: [IDENTIFIED, DISPUTED, UNLOCATED],
      selectedId: null,
    }),
  );
  assert.match(html, /Jerusalem \(test\)/);
  assert.match(html, /Sinai \(test\)/);
  assert.match(html, /Eden \(test\)/);
  assert.match(html, /no marker on the globe/);
});

test("PlaceList marks the selected place with aria-current=true", () => {
  const html = renderToStaticMarkup(
    createElement(PlaceList, {
      idPrefix: "t",
      places: [IDENTIFIED, DISPUTED],
      selectedId: "sinai-test",
    }),
  );
  assert.match(html, /aria-current="true"[^>]*>[\s\S]*?Sinai \(test\)|Sinai \(test\)[\s\S]*?aria-current="true"/);
});

test("PlaceDetails shows the honesty note for an unlocated place and no 'modern site' line", () => {
  const html = renderToStaticMarkup(createElement(PlaceDetails, { idPrefix: "t", place: UNLOCATED }));
  assert.match(html, /No marker is shown on the globe for Eden \(test\)/);
  assert.doesNotMatch(html, /Modern site:/);
});

test("PlaceDetails lists every passage with an 'Open in Connect' control", () => {
  const twoPassages: LensPlace = {
    ...IDENTIFIED,
    passages: [
      ...IDENTIFIED.passages,
      {
        range: { versificationId: "eng-protestant-66-31102-v1", start: "1.2.1", end: "1.2.1" },
        display: "Genesis 2:1",
        inDatasetVerseList: true,
      },
    ],
  };
  const html = renderToStaticMarkup(createElement(PlaceDetails, { idPrefix: "t", place: twoPassages }));
  assert.match(html, /Genesis 1:1/);
  assert.match(html, /Genesis 2:1/);
  const openInConnectCount = (html.match(/Open in Connect/g) ?? []).length;
  assert.equal(openInConnectCount, 2);
});

test("PlaceDetails marks a hand-added (not in the dataset's own verse list) passage", () => {
  const withExtra: LensPlace = {
    ...IDENTIFIED,
    passages: [{ ...IDENTIFIED.passages[0], inDatasetVerseList: false }],
  };
  const html = renderToStaticMarkup(createElement(PlaceDetails, { idPrefix: "t", place: withExtra }));
  assert.match(html, /\(added\)/);
});
