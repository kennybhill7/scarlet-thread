/**
 * PLACELENS-001 — `tierStyle.ts` in isolation: every tier's label/stroke/
 * contested mapping, synthetic (the real-data version of this rule lives in
 * `tests/place-lens-honesty.test.ts`).
 *
 * Author: Kenneth Hill
 */
import assert from "node:assert/strict";
import test from "node:test";

import { isRenderable, styleForTier } from "@/components/lens/PlaceLens/tierStyle";
import { PLACE_TIERS } from "@/components/lens/PlaceLens/types";

test("every tier has a distinct, plain-language label", () => {
  const labels = PLACE_TIERS.map((tier) => styleForTier(tier).label);
  assert.equal(new Set(labels).size, labels.length, "labels must be unique per tier");
  assert.equal(styleForTier("disputed").label, "Location disputed");
  assert.equal(styleForTier("uncertain").label, "Location uncertain");
  assert.equal(styleForTier("unlocated").label, "No confident location");
});

test("solid tiers: identified, likely", () => {
  assert.equal(styleForTier("identified").stroke, "solid");
  assert.equal(styleForTier("likely").stroke, "solid");
  assert.equal(styleForTier("identified").isContested, false);
  assert.equal(styleForTier("likely").isContested, false);
});

test("dashed/contested tiers: uncertain, disputed", () => {
  assert.equal(styleForTier("uncertain").stroke, "dashed");
  assert.equal(styleForTier("disputed").stroke, "dashed");
  assert.equal(styleForTier("uncertain").isContested, true);
  assert.equal(styleForTier("disputed").isContested, true);
});

test("disputed is drawn with lower opacity than identified (confidence reads even without color)", () => {
  assert.ok(styleForTier("disputed").opacity < styleForTier("identified").opacity);
  assert.ok(styleForTier("uncertain").opacity < styleForTier("identified").opacity);
});

test("isRenderable is false ONLY for unlocated", () => {
  for (const tier of PLACE_TIERS) {
    assert.equal(isRenderable(tier), tier !== "unlocated", tier);
  }
});
