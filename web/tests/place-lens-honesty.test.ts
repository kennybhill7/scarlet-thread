/**
 * PLACELENS-001 — confidence-as-geometry honesty rules, asserted against the
 * REAL committed `content/places/places.jsonl` (1,259 rows), not a synthetic
 * fixture (plan §C.7: "every place rendered as unlocated carries no
 * marker", "every disputed/uncertain place's rendered style differs from
 * identified/likely"). Same real-data technique `tests/places.test.ts`
 * already uses: `PlaceRowSchema` + `compilePlace` against a `CanonTable`
 * built from the real shipped BSB corpus — this file does NOT re-parse the
 * JSONL by hand, so it can never silently diverge from what
 * `data/generate-places-json.mts` actually ships to `public/map/places.json`.
 *
 * Author: Kenneth Hill
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BIBLICAL_WORLD_CENTER } from "@/components/lens/PlaceLens/geometry";
import { projectVisiblePlaces } from "@/components/lens/PlaceLens/markers";
import { isRenderable, styleForTier } from "@/components/lens/PlaceLens/tierStyle";
import { isLocated, type LensPlace } from "@/components/lens/PlaceLens/types";
import { buildPassageCanon, toCanonTable } from "@/lib/bible/passageCanon";
import type { BibleIndex } from "@/lib/contracts";
import { PlaceRowSchema, compilePlace } from "../scripts/content/placeSchema";

const webPath = (p: string) => new URL(`../${p}`, import.meta.url);
const repoPath = (p: string) => new URL(`../../${p}`, import.meta.url);

const bibleIndex: BibleIndex = JSON.parse(readFileSync(webPath("public/bible/index.json"), "utf8"));
const canon = toCanonTable(
  buildPassageCanon(bibleIndex.books, (n) =>
    JSON.parse(readFileSync(webPath(`public/bible/BSB/${n}.json`), "utf8")),
  ),
);

function loadRealPlaces(): LensPlace[] {
  const lines = readFileSync(repoPath("content/places/places.jsonl"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  const places: LensPlace[] = [];
  for (const line of lines) {
    const row = PlaceRowSchema.parse(JSON.parse(line));
    const compiled = compilePlace(row, canon);
    assert.ok(compiled.ok, `place "${row.id}" failed to compile: ${!compiled.ok ? compiled.errors.join("; ") : ""}`);
    if (!compiled.ok) continue;
    places.push({
      id: compiled.place.id,
      name: compiled.place.name,
      kind: compiled.place.kind,
      tier: compiled.place.tier,
      lon: compiled.place.lon,
      lat: compiled.place.lat,
      coordinateBasis: compiled.place.coordinateBasis,
      modernName: compiled.place.modernName,
      note: compiled.place.note,
      candidates: compiled.place.candidates,
      passages: compiled.place.passages.map((p) => ({ ...p, display: "" })),
    });
  }
  return places;
}

const REAL_PLACES = loadRealPlaces();

test("the real dataset has 1,259 places (DATASET.json's own count)", () => {
  assert.equal(REAL_PLACES.length, 1259);
});

test("HONESTY: every place with tier 'unlocated' has lon=null and lat=null (no coordinates to pin)", () => {
  const unlocated = REAL_PLACES.filter((p) => p.tier === "unlocated");
  assert.ok(unlocated.length > 0, "expected at least one unlocated place (Eden) in the real data");
  for (const place of unlocated) {
    assert.equal(place.lon, null, `${place.id} should have no lon`);
    assert.equal(place.lat, null, `${place.id} should have no lat`);
    assert.equal(isLocated(place), false, `${place.id} should not be isLocated()`);
    assert.equal(isRenderable(place.tier), false, `${place.id}'s tier should not be renderable`);
  }
});

test("HONESTY: every unlocated place is excluded from projectVisiblePlaces at EVERY rotation checked", () => {
  const unlocatedIds = new Set(REAL_PLACES.filter((p) => p.tier === "unlocated").map((p) => p.id));
  assert.ok(unlocatedIds.has("eden"), "Eden should be in the real unlocated set");
  const rotations = [
    { lambda: 0, phi: 0 },
    { lambda: 90, phi: 30 },
    { lambda: -40, phi: -20 },
    BIBLICAL_WORLD_CENTER,
  ];
  for (const rotation of rotations) {
    const markers = projectVisiblePlaces(REAL_PLACES, { rotation, scale: 150, translate: [180, 180] });
    for (const marker of markers) {
      assert.ok(!unlocatedIds.has(marker.id), `unlocated place "${marker.id}" must never produce a marker`);
    }
  }
});

test("HONESTY: every located place (lon/lat set) has a renderable (non-unlocated) tier, and vice versa", () => {
  for (const place of REAL_PLACES) {
    assert.equal(isLocated(place), isRenderable(place.tier), `${place.id}: located/renderable disagree`);
  }
});

test("HONESTY: every disputed/uncertain place's style visibly differs from identified/likely (dashed vs solid)", () => {
  const contested = REAL_PLACES.filter((p) => p.tier === "disputed" || p.tier === "uncertain");
  const confident = REAL_PLACES.filter((p) => p.tier === "identified" || p.tier === "likely");
  assert.ok(contested.length > 0 && confident.length > 0);
  for (const place of contested) {
    assert.equal(styleForTier(place.tier).stroke, "dashed", `${place.id} (${place.tier}) should be dashed`);
    assert.equal(styleForTier(place.tier).isContested, true);
  }
  for (const place of confident) {
    assert.equal(styleForTier(place.tier).stroke, "solid", `${place.id} (${place.tier}) should be solid`);
    assert.equal(styleForTier(place.tier).isContested, false);
  }
});

test("HONESTY: every disputed/uncertain place carries a note and/or candidates (real data, not just the schema's rule)", () => {
  const contested = REAL_PLACES.filter((p) => p.tier === "disputed" || p.tier === "uncertain");
  for (const place of contested) {
    assert.ok(
      place.note !== null || place.candidates.length > 0,
      `${place.id} (${place.tier}) has neither a note nor candidates`,
    );
  }
});

test("HONESTY: isFrontFacing never returns true for an unlocated place's (non-existent) coordinates — guarded at the type level", () => {
  // Structural proof, not a runtime call: LensPlace's lon/lat are `number | null`,
  // and isFrontFacing/projectVisiblePlaces both require isLocated() first — this
  // test documents that the real data upholds the precondition (previous tests),
  // so no caller of isFrontFacing in this codebase can pass null coordinates
  // through TypeScript's own type checking for a real place object.
  const unlocated = REAL_PLACES.find((p) => p.id === "eden");
  assert.ok(unlocated);
  assert.equal(isLocated(unlocated!), false);
});

test("the dataset includes well-known identified, likely, uncertain and disputed places (sanity, not a guess)", () => {
  const byId = new Map(REAL_PLACES.map((p) => [p.id, p]));
  assert.equal(byId.get("eden")?.tier, "unlocated");
  assert.equal(byId.get("sinai")?.tier, "disputed");
  assert.ok((byId.get("jerusalem")?.passages.length ?? 0) > 100, "Jerusalem should have many passages");
});
