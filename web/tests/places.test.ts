/**
 * PLACES-001 — the place layer: the COMMITTED data (`content/places/*`), the
 * validator (`scripts/content/placeSchema.ts` + its `validate.ts` wiring), the
 * generator's tier rules (`tools/build-places.mjs`), and the sync
 * (`lib/db/places.ts`, `scripts/sync-places.mts`).
 *
 * Three kinds of test, on purpose:
 *  1. REAL DATA — the committed `places.jsonl` / `DATASET.json` /
 *     `curation.json` and the real shipped BSB corpus. These are the tests that
 *     say the honesty rules hold for every one of the ~1,259 places, not for a
 *     fixture. Bounds are re-derived here from `public/bible/BSB/*.json`, not
 *     from anything the validator produced.
 *  2. MUTATION-CATCHING NEGATIVES — synthetic rows, each broken in exactly the
 *     way one rule forbids; the error text names the rule. If a rule is
 *     dropped from `placeSchema.ts`, its test here fails.
 *  3. SYNC — in-memory fakes that CAPTURE what the real drizzle builders are
 *     handed (no Postgres anywhere: this repo has exactly one, production).
 *
 * Author: Kenneth Hill
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { placeCandidates, placePassages, places } from "@/db/schema";
import { parseOsis } from "@/lib/bible/osis";
import { buildPassageCanon, toCanonTable } from "@/lib/bible/passageCanon";
import { validateCanonicalRange } from "@/lib/bible/range";
import type { BibleIndex, BookData } from "@/lib/contracts";
import { CANONICAL_VERSIFICATION_ID } from "@/lib/contracts/range-v1";
import { findMissingPlaceIds, upsertPlaceRows, type PlaceSyncRow } from "@/lib/db/places";

import { buildReleaseFromValidation } from "../scripts/content/build";
import {
  PLACES_ATTRIBUTION,
  PLACES_SOURCE_ID,
  PlaceRowSchema,
  unresolvedLessonPlaceIds,
  validatePlaceSet,
  type PlaceRow,
} from "../scripts/content/placeSchema";
import { PLACES_DIR, loadPlaces, loadRealCanonTable, loadSourceRegistryIds, runValidation } from "../scripts/content/validate";

const webPath = (p: string) => new URL(`../${p}`, import.meta.url);
const repoPath = (p: string) => new URL(`../../${p}`, import.meta.url);

// ---------------------------------------------------------------------------
// The real corpus, re-read here independently of the validator.
// ---------------------------------------------------------------------------

const bibleIndex: BibleIndex = JSON.parse(readFileSync(webPath("public/bible/index.json"), "utf8"));
const corpusCanon = toCanonTable(
  buildPassageCanon(bibleIndex.books, (n) => JSON.parse(readFileSync(webPath(`public/bible/BSB/${n}.json`), "utf8")) as BookData),
);

const REGISTRY_FILE = repoPath("content/source-registry.json");
const registryIds = loadSourceRegistryIds(REGISTRY_FILE.pathname.replace(/^\/([A-Za-z]:)/, "$1"));

function readPlaceRows(): PlaceRow[] {
  const text = readFileSync(repoPath("content/places/places.jsonl"), "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as PlaceRow);
}
const realRows = readPlaceRows();
const dataset = JSON.parse(readFileSync(repoPath("content/places/DATASET.json"), "utf8")) as {
  attribution: string;
  commit: string;
  licence: string;
  sourceId: string;
  counts: { places: number; byTier: Record<string, number>; curated: number };
  excluded: Record<string, { count: number; ids: string[] }>;
};
const curation = JSON.parse(readFileSync(repoPath("content/places/curation.json"), "utf8")) as {
  places: Record<string, { id: string; tier?: string; note?: string; name?: string }>;
  exclude: Record<string, string>;
};

// ===========================================================================
// 1. REAL DATA
// ===========================================================================

test("REAL: content/places validates end to end with the real canon and registry (loadPlaces), zero errors", () => {
  const result = loadPlaces(PLACES_DIR, registryIds);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.places.length, realRows.length);
});

test("REAL: the committed set is the full dataset build, not the 21-place prototype", () => {
  assert.ok(realRows.length >= 1200, `expected ~1,259 places, got ${realRows.length}`);
  assert.equal(dataset.counts.places, realRows.length);
  const tiers: Record<string, number> = {};
  for (const row of realRows) tiers[row.tier] = (tiers[row.tier] ?? 0) + 1;
  assert.deepEqual(tiers, dataset.counts.byTier);
  for (const tier of ["identified", "likely", "uncertain", "disputed", "unlocated"]) assert.ok((tiers[tier] ?? 0) > 0, `no ${tier} places at all`);
});

test("REAL: every place_passages range parses (parseOsis) and is in bounds of the real BSB corpus", () => {
  let checked = 0;
  const bookCache = new Map<number, BookData>();
  for (const row of realRows) {
    for (const osis of [...row.passages, ...row.extraPassages.map((e) => e.osis)]) {
      const range = parseOsis(osis, corpusCanon);
      assert.ok(range, `${row.id}: "${osis}" does not parse in-bounds`);
      assert.equal(validateCanonicalRange(range, corpusCanon).ok, true);
      // Independent bounds: the verse exists in the corpus file itself.
      const [book, chapter, verse] = range.start.split(".").map(Number);
      let data = bookCache.get(book);
      if (!data) {
        data = JSON.parse(readFileSync(webPath(`public/bible/BSB/${book}.json`), "utf8")) as BookData;
        bookCache.set(book, data);
      }
      assert.ok(data.c[chapter - 1], `${row.id} ${osis}: chapter ${chapter} missing from BSB ${book}`);
      assert.ok(verse >= 1 && verse <= data.c[chapter - 1].length, `${row.id} ${osis}: verse ${verse} out of bounds`);
      assert.ok(data.c[chapter - 1][verse - 1].length > 0, `${row.id} ${osis}: empty verse text`);
      checked += 1;
    }
  }
  assert.ok(checked >= 8000, `expected ~8,694 passage references, checked ${checked}`);
});

test("REAL: every unlocated place has NO coordinates, NO candidates and kind 'unlocated'; every other place has both coordinates", () => {
  const unlocated = realRows.filter((row) => row.tier === "unlocated");
  assert.ok(unlocated.length >= 1);
  for (const row of unlocated) {
    assert.equal(row.lon, null, `${row.id} lon`);
    assert.equal(row.lat, null, `${row.id} lat`);
    assert.equal(row.coordinateBasis, null, `${row.id} coordinateBasis`);
    assert.deepEqual(row.candidates, [], `${row.id} candidates`);
    assert.equal(row.kind, "unlocated");
  }
  for (const row of realRows.filter((r) => r.tier !== "unlocated")) {
    assert.equal(typeof row.lon, "number", `${row.id} lon`);
    assert.equal(typeof row.lat, "number", `${row.id} lat`);
    assert.ok(Math.abs(row.lon as number) <= 180 && Math.abs(row.lat as number) <= 90, `${row.id} out of range`);
    assert.ok(!(row.lon === 0 && row.lat === 0), `${row.id} sits on null island (0,0): a missing coordinate coerced to zero`);
    assert.notEqual(row.kind, "unlocated");
  }
});

test("REAL: every disputed / uncertain place has a plain-language note and/or candidates; every region/route/water place has a note", () => {
  for (const row of realRows) {
    if (row.tier === "disputed" || row.tier === "uncertain") {
      assert.ok(row.note !== null || row.candidates.length > 0, `${row.id} (${row.tier}) has neither note nor candidates`);
    }
    if (row.kind === "region" || row.kind === "route" || row.kind === "water") {
      assert.ok(row.note !== null && row.note.length > 0, `${row.id} (${row.kind}) has no note`);
    }
  }
  assert.ok(realRows.filter((r) => r.tier === "disputed").length > 0);
});

test("REAL: attribution is stored with the data, exactly, and the dataset commit is pinned", () => {
  assert.equal(dataset.attribution, "Place data © OpenBible.info, CC BY 4.0");
  assert.equal(dataset.attribution, PLACES_ATTRIBUTION);
  assert.equal(dataset.licence, "CC BY 4.0");
  assert.equal(dataset.commit, "7eb18a5ee62f27b9b93bd6689ea272d76dd23b8f");
  assert.equal(dataset.sourceId, PLACES_SOURCE_ID);
});

test("REAL: every row cites the dataset's source, which is a well-formed registry entry (7 fields, CC BY 4.0)", () => {
  assert.ok(realRows.every((row) => row.sourceId === PLACES_SOURCE_ID));
  const registry = JSON.parse(readFileSync(repoPath("content/source-registry.json"), "utf8")) as Record<string, unknown>[];
  const entry = registry.find((e) => e.id === PLACES_SOURCE_ID);
  assert.ok(entry, "source-openbible-geocoding missing from content/source-registry.json");
  assert.deepEqual(Object.keys(entry).sort(), ["accessedAt", "author", "id", "licence", "publisher", "title", "url"]);
  assert.equal(entry.accessedAt, "2026-09-25");
  assert.match(String(entry.licence), /^CC BY 4\.0/);
  assert.equal(entry.url, "https://github.com/openbibleinfo/Bible-Geocoding-Data");
  assert.equal(registry.filter((e) => e.id === PLACES_SOURCE_ID).length, 1);
});

test("REAL: place ids are unique slugs; ancient ids are unique", () => {
  assert.equal(new Set(realRows.map((r) => r.id)).size, realRows.length);
  assert.equal(new Set(realRows.map((r) => r.ancientId)).size, realRows.length);
  for (const row of realRows) assert.match(row.id, /^[a-z0-9][a-z0-9-]*$/);
});

test("REAL: coordinates are sane against the actual earth (independent of the dataset)", () => {
  const byId = new Map(realRows.map((r) => [r.id, r]));
  const near = (id: string, lon: number, lat: number, tolerance: number) => {
    const row = byId.get(id);
    assert.ok(row, `${id} missing`);
    assert.ok(Math.abs((row.lon as number) - lon) < tolerance && Math.abs((row.lat as number) - lat) < tolerance, `${id} at ${row.lon},${row.lat}`);
  };
  near("jerusalem", 35.23, 31.78, 0.1);
  near("rome", 12.5, 41.9, 0.2);
  near("nazareth", 35.3, 32.7, 0.1);
  near("corinth", 22.9, 37.9, 0.2);
  near("sinai", 34, 28.5, 1.5);
});

test("REAL: curation.json and the generated rows agree (a stale generated file would fail here)", () => {
  const byId = new Map(realRows.map((r) => [r.id, r]));
  assert.equal(Object.keys(curation.places).length, dataset.counts.curated);
  for (const [friendly, entry] of Object.entries(curation.places)) {
    const row = byId.get(entry.id);
    assert.ok(row, `${friendly} -> ${entry.id} not in places.jsonl`);
    assert.equal(row.tierBasis, "curated");
    if (entry.tier) assert.equal(row.tier, entry.tier);
    if (entry.note !== undefined) assert.equal(row.note, entry.note.trim());
  }
  assert.equal(realRows.filter((r) => r.tierBasis === "curated").length, Object.keys(curation.places).length);
});

test("REAL: Eden is present and UNLOCATED (the Genesis 3 lesson's place), with a note saying why", () => {
  const eden = realRows.find((r) => r.id === "eden");
  assert.ok(eden);
  assert.equal(eden.tier, "unlocated");
  assert.equal(eden.lon, null);
  assert.equal(eden.lat, null);
  assert.match(eden.note ?? "", /No confident location/);
  assert.ok(eden.passages.includes("Gen.3.24"));
});

test("REAL: the Genesis 3 lesson names eden; the real content set validates including placeIds resolution", () => {
  const lesson = readFileSync(repoPath("content/curriculum/genesis/03-the-fall.md"), "utf8");
  assert.match(lesson, /^placeIds:\n {2}- eden$/m);
  const result = runValidation(path.join(process.cwd(), "..", "content", "curriculum"));
  assert.deepEqual(result.placeErrors, []);
  assert.equal(result.ok, true);
  const gen3 = result.results.find((r) => r.filePath.endsWith("03-the-fall.md"));
  assert.deepEqual(gen3?.frontmatter?.placeIds, ["eden"]);
});

test("REAL: the exclusions are accounted for (no place silently dropped)", () => {
  const excluded = Object.values(dataset.excluded).reduce((sum, e) => sum + e.count, 0);
  // 1,342 dataset entries = places + excluded (no-verse entries, not-a-place entries, curated exclusions).
  assert.equal(realRows.length + excluded, 1342);
  for (const e of Object.values(dataset.excluded)) assert.equal(e.ids.length, e.count);
});

// ===========================================================================
// 2. MUTATION-CATCHING NEGATIVES (validator)
// ===========================================================================

const okJson = (value: unknown) => ({ ok: true as const, value });
const goodDataset = {
  name: "OpenBible.info Bible Geocoding Data",
  repo: "https://github.com/openbibleinfo/Bible-Geocoding-Data",
  page: "https://www.openbible.info/geo/",
  licence: "CC BY 4.0",
  attribution: PLACES_ATTRIBUTION,
  sourceId: PLACES_SOURCE_ID,
  commit: "7eb18a5ee62f27b9b93bd6689ea272d76dd23b8f",
  generatedBy: "tools/build-places.mjs",
  note: "synthetic",
  tierRules: { disputedRivalRatio: 0.6 },
  counts: { datasetEntries: 3, places: 1, byTier: { identified: 1 }, curated: 0 },
  excluded: {},
};

function goodRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "test-place",
    name: "Test Place",
    ancientId: "a000000",
    kind: "point",
    tier: "identified",
    tierBasis: "computed",
    computedTier: null,
    lon: 35.2,
    lat: 31.7,
    coordinateBasis: "point",
    modernName: "Somewhere",
    note: null,
    sourceId: PLACES_SOURCE_ID,
    datasetScore: 950,
    voteCount: 5,
    identificationsInDataset: 1,
    candidates: [],
    passages: ["Gen.3.24"],
    extraPassages: [],
    ...overrides,
  };
}

function validateRows(
  rows: Record<string, unknown>[],
  opts: { dataset?: unknown; curation?: unknown; registry?: Set<string> } = {},
) {
  const datasetValue = opts.dataset === undefined ? { ...goodDataset, counts: { ...goodDataset.counts, places: rows.length } } : opts.dataset;
  return validatePlaceSet(
    {
      jsonl: rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
      dataset: datasetValue === null ? undefined : okJson(datasetValue),
      curation: opts.curation === undefined ? undefined : okJson(opts.curation),
    },
    opts.registry ?? new Set([PLACES_SOURCE_ID]),
    corpusCanon,
  );
}
const expectError = (result: { ok: boolean; errors: string[] }, pattern: RegExp) => {
  assert.equal(result.ok, false, "expected the set to be rejected");
  assert.ok(result.errors.some((error) => pattern.test(error)), `no error matching ${pattern}; got:\n${result.errors.join("\n")}`);
};

test("NEG baseline: a well-formed synthetic set is valid (so every negative below fails for its own reason)", () => {
  const result = validateRows([goodRow()]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.places.length, 1);
  assert.deepEqual(result.places[0].passages[0].range, { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.24", end: "1.3.24" });
});

test("NEG: an unlocated place carrying coordinates is rejected (tier 'unlocated' => no lon/lat)", () => {
  expectError(validateRows([goodRow({ tier: "unlocated", kind: "unlocated", coordinateBasis: null, lon: 35.2, lat: 31.7, note: "No confident location." })]), /unlocated place must have NO coordinates/);
});

test("NEG: an unlocated place with even one coordinate, or a candidate, or a coordinateBasis, is rejected", () => {
  const base = { tier: "unlocated", kind: "unlocated", coordinateBasis: null, lon: null, lat: null, note: "No confident location." };
  expectError(validateRows([goodRow({ ...base, lon: 1 })]), /both be set or both be null|NO coordinates/);
  expectError(validateRows([goodRow({ ...base, lat: 1 })]), /both be set or both be null|NO coordinates/);
  expectError(validateRows([goodRow({ ...base, candidates: [{ description: "x", lon: 1, lat: 1, score: 5 }] })]), /no candidates/);
  expectError(validateRows([goodRow({ ...base, coordinateBasis: "point" })]), /no coordinateBasis/);
  assert.deepEqual(validateRows([goodRow(base)]).errors, []);
});

test("NEG: a located tier without coordinates is rejected; lon without lat is rejected; out-of-range coordinates are rejected", () => {
  expectError(validateRows([goodRow({ lon: null, lat: null })]), /must have coordinates/);
  expectError(validateRows([goodRow({ lat: null })]), /both be set or both be null/);
  expectError(validateRows([goodRow({ lon: 181 })]), /lon:/);
  expectError(validateRows([goodRow({ lat: -91 })]), /lat:/);
});

test("NEG: kind and tier must agree on 'unlocated'", () => {
  expectError(validateRows([goodRow({ kind: "unlocated" })]), /kind "unlocated" and tier "identified" disagree/);
  expectError(validateRows([goodRow({ tier: "unlocated", kind: "point", lon: null, lat: null, coordinateBasis: null, note: "n" })]), /disagree/);
});

test("NEG: a disputed or uncertain place needs a note and/or candidates (either alone is enough)", () => {
  for (const tier of ["disputed", "uncertain"]) {
    expectError(validateRows([goodRow({ tier })]), new RegExp(`${tier} place must carry a plain-language note and/or candidates`));
    assert.deepEqual(validateRows([goodRow({ tier, note: "Location disputed." })]).errors, []);
    assert.deepEqual(validateRows([goodRow({ tier, candidates: [{ description: "Other site", lon: 34, lat: 30, score: 100 }] })]).errors, []);
  }
});

test("NEG: a region / route / water place needs a note (one representative point is not an extent)", () => {
  for (const kind of ["region", "route", "water"]) {
    expectError(validateRows([goodRow({ kind })]), new RegExp(`${kind} place must carry a note`));
    assert.deepEqual(validateRows([goodRow({ kind, note: "Representative point only." })]).errors, []);
  }
});

test("NEG: a passage out of bounds of the real canon is rejected (chapter, verse and book)", () => {
  expectError(validateRows([goodRow({ passages: ["Gen.51.1"] })]), /Gen\.51\.1.*not a valid in-bounds reference/);
  expectError(validateRows([goodRow({ passages: ["Gen.3.25"] })]), /Gen\.3\.25.*not a valid in-bounds reference/); // Genesis 3 has 24 verses
  expectError(validateRows([goodRow({ passages: ["Rev.22.22"] })]), /Rev\.22\.22/); // Revelation 22 has 21
  expectError(validateRows([goodRow({ passages: ["Zzz.1.1"] })]), /Zzz\.1\.1/);
  expectError(validateRows([goodRow({ passages: ["Gen.3.0"] })]), /Gen\.3\.0/);
  expectError(validateRows([goodRow({ passages: ["Gen.3.1-Exod.1.1"] })]), /Gen\.3\.1-Exod\.1\.1/);
  assert.deepEqual(validateRows([goodRow({ passages: ["Gen.3.24", "Rev.22.21", "Gen.1.1"] })]).errors, []);
});

test("NEG: the bounds check uses the REAL canon (a permissive canon would accept Gen.51.1) -- injected canon is honoured", () => {
  const permissive = { chapterCount: () => 9999, verseCount: () => 9999 };
  const result = validatePlaceSet(
    { jsonl: JSON.stringify(goodRow({ passages: ["Gen.51.1"] })) + "\n", dataset: okJson(goodDataset), curation: undefined },
    new Set([PLACES_SOURCE_ID]),
    permissive,
  );
  assert.deepEqual(result.errors, []);
});

test("NEG: a place needs at least one passage; duplicates (same osis, or two spellings of one range) are rejected", () => {
  expectError(validateRows([goodRow({ passages: [] })]), /at least one passage/);
  expectError(validateRows([goodRow({ passages: ["Gen.3.24", "Gen.3.24"] })]), /duplicate passage/);
  expectError(validateRows([goodRow({ passages: ["Gen.3.24", "Gen.3.24-Gen.3.24"] })]), /resolves to a range/);
  expectError(validateRows([goodRow({ passages: ["Gen.3.24"], extraPassages: [{ osis: "Gen.3.24", note: "n" }] })]), /duplicate passage/);
});

test("NEG: duplicate place ids are rejected", () => {
  expectError(validateRows([goodRow(), goodRow({ ancientId: "a000001" })]), /duplicate place id/);
});

test("NEG: place ids must be slugs; extra/unknown keys are rejected (strict rows)", () => {
  expectError(validateRows([goodRow({ id: "Has Space" })]), /id/);
  expectError(validateRows([goodRow({ id: "UPPER" })]), /slug/);
  expectError(validateRows([goodRow({ surprise: 1 })]), /unrecognized key/i);
});

test("NEG: attribution and the pinned commit must be present in DATASET.json", () => {
  expectError(validateRows([goodRow()], { dataset: { ...goodDataset, attribution: "Place data from somewhere" } }), /attribution/);
  const { attribution: _drop, ...noAttribution } = goodDataset;
  void _drop;
  expectError(validateRows([goodRow()], { dataset: noAttribution }), /attribution/);
  expectError(validateRows([goodRow()], { dataset: { ...goodDataset, commit: "main" } }), /commit/);
  expectError(validateRows([goodRow()], { dataset: { ...goodDataset, licence: "CC BY-SA 4.0" } }), /licence/);
  expectError(validateRows([goodRow()], { dataset: null }), /DATASET\.json: missing/);
});

test("NEG: DATASET.json's place count must match the rows (stale generated file)", () => {
  expectError(validateRows([goodRow()], { dataset: { ...goodDataset, counts: { ...goodDataset.counts, places: 2 } } }), /counts\.places is 2 but places\.jsonl has 1/);
});

test("NEG: a sourceId absent from the registry is rejected", () => {
  expectError(validateRows([goodRow()], { registry: new Set(["something-else"]) }), /absent from content\/source-registry\.json/);
});

test("NEG: verdict language in a note is rejected", () => {
  expectError(validateRows([goodRow({ note: "This proves the site." })]), /doctrinal verdict/);
});

test("NEG: curation.json and generated rows must agree -- edited curation with stale output is an error, and an uncurated 'curated' row is an error", () => {
  const curated = goodRow({ id: "curated-place", tier: "likely", tierBasis: "curated", computedTier: "identified" });
  const cur = (tier: string) => ({ places: { "Curated Place": { id: "curated-place", tier } }, exclude: {} });
  assert.deepEqual(validateRows([curated], { curation: cur("likely") }).errors, []);
  expectError(validateRows([curated], { curation: cur("disputed") }), /tier "disputed" is not what places\.jsonl has/);
  expectError(validateRows([curated], { curation: { places: {}, exclude: {} } }), /tierBasis "curated" but curation\.json has no entry/);
  expectError(validateRows([goodRow()], { curation: { places: { X: { id: "missing-id", tier: "likely" } }, exclude: {} } }), /id "missing-id" is not in places\.jsonl/);
  expectError(validateRows([goodRow({ tierBasis: "curated" })]), /requires computedTier/);
  expectError(validateRows([goodRow({ computedTier: "likely" })]), /must have computedTier null/);
});

test("NEG: a row that is not valid JSON, or a non-object, is reported with its line number", () => {
  const result = validatePlaceSet(
    { jsonl: JSON.stringify(goodRow()) + "\n{not json\n", dataset: okJson({ ...goodDataset, counts: { ...goodDataset.counts, places: 2 } }), curation: undefined },
    new Set([PLACES_SOURCE_ID]),
    corpusCanon,
  );
  expectError(result, /places\.jsonl line 2: invalid JSON/);
});

test("ZERO ROWS: missing content/places files is a valid, empty result (no error, no canon needed)", () => {
  const result = validatePlaceSet({ jsonl: null, dataset: undefined, curation: undefined }, new Set(), { chapterCount: () => undefined, verseCount: () => undefined });
  assert.deepEqual(result, { ok: true, places: [], declaredIds: [], errors: [] });
  const dir = mkdtempSync(path.join(os.tmpdir(), "places-empty-"));
  try {
    assert.deepEqual(loadPlaces(path.join(dir, "does-not-exist"), new Set()).errors, []);
    assert.equal(loadPlaces(path.join(dir, "does-not-exist"), new Set()).places.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PlaceRowSchema: every committed row parses strict", () => {
  for (const row of realRows) assert.equal(PlaceRowSchema.safeParse(row).success, true, row.id);
});

// ---------------------------------------------------------------------------
// lesson placeIds
// ---------------------------------------------------------------------------

test("LESSON placeIds: an id that names no place is reported per lesson; known ids pass", () => {
  const known = new Set(["eden", "sinai"]);
  assert.deepEqual(unresolvedLessonPlaceIds([{ slug: "a", placeIds: ["eden", "sinai"] }], known), []);
  assert.deepEqual(unresolvedLessonPlaceIds([{ slug: "a", placeIds: ["eden", "nowhere"] }, { slug: "b", placeIds: ["also-nowhere"] }], known), [
    'lesson a: placeIds[] "nowhere" names no place in content/places/places.jsonl',
    'lesson b: placeIds[] "also-nowhere" names no place in content/places/places.jsonl',
  ]);
  assert.deepEqual(unresolvedLessonPlaceIds([{ slug: "a", placeIds: [] }], new Set()), []);
});

function tmpContent(lessonFrontmatterExtra: string, placeRows: Record<string, unknown>[] | null) {
  const root = mkdtempSync(path.join(os.tmpdir(), "places-content-"));
  const curriculum = path.join(root, "curriculum");
  mkdirSync(path.join(curriculum, "genesis"), { recursive: true });
  writeFileSync(
    path.join(curriculum, "genesis", "l.md"),
    `---\npassage:\n  start: "1.3.1"\n  end: "1.3.24"\nstage: 2\nmethodFocus: "x"\nauthor: "Kenneth Hill"\nstatus: published\n${lessonFrontmatterExtra}---\n# T\n\nBody.\n\n## Teach-Back Prompts\n\nBlind explain: say it.\n`,
  );
  writeFileSync(path.join(root, "source-registry.json"), JSON.stringify([{ id: PLACES_SOURCE_ID }]));
  if (placeRows !== null) {
    mkdirSync(path.join(root, "places"));
    writeFileSync(path.join(root, "places", "places.jsonl"), placeRows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeFileSync(path.join(root, "places", "DATASET.json"), JSON.stringify({ ...goodDataset, counts: { ...goodDataset.counts, places: placeRows.length } }));
  }
  return { root, curriculum };
}

test("WIRING: runValidation fails loudly on a lesson placeId that names no place, passes when it resolves, and is unaffected when the lesson has none", () => {
  const cases: [string, Record<string, unknown>[] | null, boolean, RegExp?][] = [
    ["placeIds:\n  - nowhere\n", [goodRow()], false, /placeIds\[\] "nowhere" names no place/],
    ["placeIds:\n  - test-place\n", [goodRow()], true],
    ["placeIds:\n  - test-place\n", null, false, /names no place/], // no content/places at all
    ["", null, true], // no placeIds, no places directory: zero rows, still valid
    ["", [goodRow()], true],
  ];
  for (const [extra, rows, expectOk, pattern] of cases) {
    const { root, curriculum } = tmpContent(extra, rows);
    try {
      const result = runValidation(curriculum, { canon: corpusCanon });
      assert.equal(result.ok, expectOk, JSON.stringify(result.placeErrors));
      if (pattern) assert.ok((result.placeErrors ?? []).some((e) => pattern.test(e)), JSON.stringify(result.placeErrors));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("WIRING: an invalid place row makes runValidation not ok, and buildReleaseFromValidation refuses the release with a places: error", () => {
  const { root, curriculum } = tmpContent("", [goodRow({ tier: "unlocated", kind: "unlocated", coordinateBasis: null, note: "n" })]);
  try {
    const validation = runValidation(curriculum, { canon: corpusCanon });
    assert.equal(validation.ok, false);
    const build = buildReleaseFromValidation(curriculum, validation);
    assert.equal(build.ok, false);
    assert.ok(build.errors.some((e) => /^places: .*NO coordinates/.test(e)), build.errors.join("\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("BUNDLE: the release bundle format is unchanged (schemaVersion 1) and lessonCount/lessons are the only top-level keys", async () => {
  const { compileReleaseBundle } = await import("../scripts/content/build");
  const bundle = compileReleaseBundle([]);
  assert.deepEqual(Object.keys(bundle).sort(), ["lessonCount", "lessons", "schemaVersion"]);
  assert.equal(bundle.schemaVersion, 1);
});

// ===========================================================================
// 3. tools/build-places.mjs -- the generator's tier rules, on synthetic data
// ===========================================================================

type Builder = {
  buildPlaces: (input: { ancientRows: unknown[]; curation: unknown; commit: string }) => { rows: PlaceRow[]; dataset: { counts: { places: number }; excluded: Record<string, { count: number }> }; problems: string[] };
  computeTier: (input: { score: number; votes: number; rivalScores: number[]; siblingRatioMax: number }) => string;
  PINNED_COMMIT: string;
  ATTRIBUTION: string;
};
const builderPromise: Promise<Builder> = import(pathToFileURL(path.join(process.cwd(), "..", "tools", "build-places.mjs")).href);

function ident(score: number, votes: number, lonlat: string | null, extra: Record<string, unknown> = {}) {
  return {
    description: "identification",
    score: { time_total: score, vote_count: votes },
    resolutions: lonlat === null ? [{ type: "special", best_path_score: score }] : [{ lonlat, lonlat_type: "point", type: "settlement", ancient_geometry: "point", description: "Modern site", best_path_score: score }],
    ...(lonlat === null ? { special: "unknown_place" } : {}),
    ...extra,
  };
}
function ancient(friendly: string, idents: unknown[], verses: string[] = ["Gen.3.24"]) {
  return { id: `a${friendly.length}${friendly.charCodeAt(0)}`, friendly_id: friendly, url_slug: friendly.toLowerCase().replace(/ /g, "-"), identifications: idents, verses: verses.map((osis, i) => ({ osis, sort: `01003${String(20 + i).padStart(3, "0")}` })) };
}

test("BUILDER: computeTier rules (disputed rival, uncertain low score, likely single source / mid score, identified)", async () => {
  const { computeTier } = await builderPromise;
  assert.equal(computeTier({ score: 950, votes: 10, rivalScores: [], siblingRatioMax: 0 }), "identified");
  assert.equal(computeTier({ score: 1000, votes: 1, rivalScores: [], siblingRatioMax: 0 }), "likely"); // lone source is never proof
  assert.equal(computeTier({ score: 850, votes: 20, rivalScores: [], siblingRatioMax: 0 }), "likely");
  assert.equal(computeTier({ score: 950, votes: 20, rivalScores: [200], siblingRatioMax: 0 }), "likely"); // weaker rival
  assert.equal(computeTier({ score: 650, votes: 20, rivalScores: [], siblingRatioMax: 0 }), "uncertain");
  assert.equal(computeTier({ score: 950, votes: 20, rivalScores: [600], siblingRatioMax: 0 }), "disputed"); // rival >= 0.6x
  assert.equal(computeTier({ score: 950, votes: 20, rivalScores: [], siblingRatioMax: 0.7 }), "disputed"); // sibling site
  assert.equal(computeTier({ score: 100, votes: 5, rivalScores: [10], siblingRatioMax: 0 }), "uncertain");
});

test("BUILDER: unlocated places get no coordinates and no candidates; not-a-place and no-verse entries are excluded and counted", async () => {
  const { buildPlaces, ATTRIBUTION } = await builderPromise;
  assert.equal(ATTRIBUTION, PLACES_ATTRIBUTION);
  const { rows, dataset: ds, problems } = buildPlaces({
    commit: "c",
    curation: { places: {}, exclude: {} },
    ancientRows: [
      ancient("Nowhere", [ident(400, 9, null), ident(200, 5, "10.0,20.0")]), // top identification is "unknown location" though a weaker one has coordinates
      ancient("Common Noun", [{ ...ident(300, 3, null), special: "not_a_place" }]),
      ancient("No Verses", [ident(900, 9, "1.0,2.0")], []),
      ancient("Real Place", [ident(950, 12, "35.5,31.5")]),
    ],
  });
  assert.deepEqual(problems, []);
  assert.equal(rows.length, 2);
  const nowhere = rows.find((r) => r.id === "nowhere");
  assert.ok(nowhere);
  assert.equal(nowhere.tier, "unlocated");
  assert.equal(nowhere.lon, null);
  assert.equal(nowhere.lat, null);
  assert.deepEqual(nowhere.candidates, []);
  assert.match(nowhere.note ?? "", /No confident location/);
  assert.equal(ds.excluded.notAPlace.count, 1);
  assert.equal(ds.excluded.noVerses.count, 1);
  const real = rows.find((r) => r.id === "real-place");
  assert.ok(real);
  assert.equal(real.tier, "identified");
  assert.equal(real.lon, 35.5); // copied from "35.5,31.5" (lon,lat order)
  assert.equal(real.lat, 31.5);
  // the generated rows themselves pass the validator's row schema
  for (const row of rows) assert.equal(PlaceRowSchema.safeParse(row).success, true, row.id);
});

test("BUILDER: a curated tier override is recorded (tierBasis 'curated', computedTier), and curating a place to unlocated strips its coordinates", async () => {
  const { buildPlaces } = await builderPromise;
  const { rows, problems } = buildPlaces({
    commit: "c",
    curation: {
      places: {
        Alpha: { id: "alpha-renamed", name: "Alpha (renamed)", tier: "disputed", note: "Location disputed." },
        Beta: { id: "beta", tier: "unlocated", note: "No confident location." },
      },
      exclude: {},
    },
    ancientRows: [ancient("Alpha", [ident(950, 12, "35.5,31.5")]), ancient("Beta", [ident(950, 12, "36.5,32.5")])],
  });
  assert.deepEqual(problems, []);
  const alpha = rows.find((r) => r.id === "alpha-renamed");
  assert.ok(alpha);
  assert.equal(alpha.tier, "disputed");
  assert.equal(alpha.tierBasis, "curated");
  assert.equal(alpha.computedTier, "identified");
  assert.equal(alpha.name, "Alpha (renamed)");
  const beta = rows.find((r) => r.id === "beta");
  assert.ok(beta);
  assert.equal(beta.tier, "unlocated");
  assert.equal(beta.kind, "unlocated");
  assert.equal(beta.lon, null);
  assert.equal(beta.lat, null);
});

test("BUILDER: duplicate ids and curation entries naming a place the dataset lacks are reported as problems (nothing is written)", async () => {
  const { buildPlaces } = await builderPromise;
  const dup = buildPlaces({
    commit: "c",
    curation: { places: { Alpha: { id: "same" }, Beta: { id: "same" } }, exclude: {} },
    ancientRows: [ancient("Alpha", [ident(950, 12, "1.0,2.0")]), ancient("Beta", [ident(950, 12, "3.0,4.0")])],
  });
  assert.ok(dup.problems.some((p) => /duplicate place id "same"/.test(p)));
  const missing = buildPlaces({ commit: "c", curation: { places: { Ghost: { id: "ghost" } }, exclude: {} }, ancientRows: [ancient("Alpha", [ident(950, 12, "1.0,2.0")])] });
  assert.ok(missing.problems.some((p) => /"Ghost", which is not in the dataset/.test(p)));
});

test("BUILDER: pinned commit constant matches the committed DATASET.json", async () => {
  const { PINNED_COMMIT } = await builderPromise;
  assert.equal(PINNED_COMMIT, dataset.commit);
});

// ===========================================================================
// 4. SYNC (lib/db/places.ts) against capturing fakes
// ===========================================================================

const dialect = new PgDialect();
const render = (chunk: SQL) => dialect.sqlToQuery(chunk);

interface Stmt {
  op: "insert" | "delete";
  table: unknown;
  values?: unknown[];
  config?: { target: unknown; set: Record<string, unknown> };
  where?: SQL;
}
function fakePlacesDb() {
  const batches: Stmt[][] = [];
  const db = {
    insert: (table: unknown) => ({
      values: (values: unknown[]) => {
        const stmt: Stmt = { op: "insert", table, values };
        return Object.assign(stmt, {
          onConflictDoUpdate: (config: { target: unknown; set: Record<string, unknown> }) => {
            stmt.config = config;
            return stmt;
          },
        });
      },
    }),
    delete: (table: unknown) => ({
      where: (clause: SQL) => ({ op: "delete", table, where: clause }) as Stmt,
    }),
    batch: async (statements: Stmt[]) => {
      batches.push(statements);
      return statements.map(() => []);
    },
  };
  return { db, batches };
}

const ROW_A: PlaceSyncRow = {
  id: "alpha",
  name: "Alpha",
  ancientId: "a1",
  kind: "point",
  tier: "disputed",
  lon: 35.5,
  lat: 31.5,
  coordinateBasis: "point",
  modernName: "Modern Alpha",
  note: "Location disputed.",
  sourceId: PLACES_SOURCE_ID,
  datasetScore: 465,
  voteCount: 33,
  identificationsInDataset: 3,
  candidates: [
    { description: "Rival one", lon: 34, lat: 30, score: 103 },
    { description: "Rival two", lon: 33, lat: 29, score: 89 },
  ],
  passages: [
    { range: { versificationId: CANONICAL_VERSIFICATION_ID, start: "2.19.2", end: "2.19.2" }, inDatasetVerseList: true, note: null },
    { range: { versificationId: CANONICAL_VERSIFICATION_ID, start: "2.19.11", end: "2.19.11" }, inDatasetVerseList: false, note: "added by hand" },
  ],
};
const ROW_EDEN: PlaceSyncRow = {
  ...ROW_A,
  id: "eden",
  name: "Eden",
  kind: "unlocated",
  tier: "unlocated",
  lon: null,
  lat: null,
  coordinateBasis: null,
  modernName: null,
  candidates: [],
  passages: [{ range: { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.24", end: "1.3.24" }, inDatasetVerseList: true, note: null }],
};

test("SYNC: one atomic db.batch per chunk: upsert places, replace candidates, replace passages -- in that order", async () => {
  const { db, batches } = fakePlacesDb();
  await upsertPlaceRows(db as never, [ROW_A, ROW_EDEN]);
  assert.equal(batches.length, 1);
  const [batch] = batches;
  assert.deepEqual(
    batch.map((s) => `${s.op}:${(s.table as { [k: symbol]: string })[Symbol.for("drizzle:Name")]}`),
    ["insert:places", "delete:place_candidates", "insert:place_candidates", "delete:place_passages", "insert:place_passages"],
  );
  assert.equal(batch[0].table, places);
  assert.equal(batch[1].table, placeCandidates);
  assert.equal(batch[3].table, placePassages);
});

test("SYNC: places upsert is keyed on id with excluded.* for every mutable column; created_at/release_id are not overwritten; coordinates stay null for an unlocated place", async () => {
  const { db, batches } = fakePlacesDb();
  await upsertPlaceRows(db as never, [ROW_A, ROW_EDEN]);
  const upsert = batches[0][0];
  assert.equal(upsert.config?.target, places.id);
  assert.deepEqual(Object.keys(upsert.config?.set ?? {}).sort(), [
    "ancientId", "coordinateBasis", "datasetScore", "identificationsInDataset", "kind", "lat", "lon", "modernName", "name", "note", "sourceId", "tier", "voteCount",
  ]);
  assert.equal(render((upsert.config?.set as Record<string, SQL>).tier).sql, "excluded.tier");
  assert.equal(render((upsert.config?.set as Record<string, SQL>).lon).sql, "excluded.lon");
  assert.equal(render((upsert.config?.set as Record<string, SQL>).note).sql, "excluded.note");
  const [a, eden] = upsert.values as Record<string, unknown>[];
  assert.equal(a.tier, "disputed");
  assert.equal(a.lon, 35.5);
  assert.equal(eden.tier, "unlocated");
  assert.equal(eden.lon, null);
  assert.equal(eden.lat, null);
  assert.equal("candidates" in a, false);
  assert.equal("passages" in a, false);
});

test("SYNC: candidate and passage rows carry stable ordinals, ranges, and the in-dataset flag; deletes are scoped to the chunk's place ids", async () => {
  const { db, batches } = fakePlacesDb();
  await upsertPlaceRows(db as never, [ROW_A, ROW_EDEN]);
  const batch = batches[0];
  assert.deepEqual(batch[2].values, [
    { placeId: "alpha", ordinal: 0, description: "Rival one", lon: 34, lat: 30, score: 103 },
    { placeId: "alpha", ordinal: 1, description: "Rival two", lon: 33, lat: 29, score: 89 },
  ]);
  assert.deepEqual(batch[4].values, [
    { placeId: "alpha", ordinal: 0, range: ROW_A.passages[0].range, inDatasetVerseList: true, note: null },
    { placeId: "alpha", ordinal: 1, range: ROW_A.passages[1].range, inDatasetVerseList: false, note: "added by hand" },
    { placeId: "eden", ordinal: 0, range: ROW_EDEN.passages[0].range, inDatasetVerseList: true, note: null },
  ]);
  for (const deleteStmt of [batch[1], batch[3]]) {
    const q = render(deleteStmt.where as SQL);
    assert.match(q.sql, /"place_id" in \(\$1, \$2\)/);
    assert.deepEqual(q.params, ["alpha", "eden"]);
  }
});

test("SYNC: a place with no candidates still gets its old candidates deleted (a removed candidate disappears) but no empty INSERT is issued", async () => {
  const { db, batches } = fakePlacesDb();
  await upsertPlaceRows(db as never, [ROW_EDEN]);
  assert.deepEqual(
    batches[0].map((s) => `${s.op}:${(s.table as { [k: symbol]: string })[Symbol.for("drizzle:Name")]}`),
    ["insert:places", "delete:place_candidates", "delete:place_passages", "insert:place_passages"],
  );
});

test("SYNC: idempotent -- syncing the same rows twice issues identical statements (no accumulating state), and an unchanged input is not deduplicated away", async () => {
  const one = fakePlacesDb();
  const two = fakePlacesDb();
  await upsertPlaceRows(one.db as never, [ROW_A, ROW_EDEN]);
  await upsertPlaceRows(two.db as never, [ROW_A, ROW_EDEN]);
  await upsertPlaceRows(two.db as never, [ROW_A, ROW_EDEN]);
  assert.equal(two.batches.length, 2);
  const shape = (batch: Stmt[]) => JSON.stringify(batch.map((s) => ({ op: s.op, values: s.values, where: s.where ? render(s.where) : null })));
  assert.equal(shape(two.batches[0]), shape(two.batches[1]));
  assert.equal(shape(one.batches[0]), shape(two.batches[0]));
});

test("SYNC: chunks (chunkSize 1 over 2 rows -> 2 batches) and skips an empty list; a big place splits its INSERTs under the parameter limit", async () => {
  const two = fakePlacesDb();
  await upsertPlaceRows(two.db as never, [ROW_A, ROW_EDEN], 1);
  assert.equal(two.batches.length, 2);
  const none = fakePlacesDb();
  await upsertPlaceRows(none.db as never, []);
  assert.equal(none.batches.length, 0);
  const many = { ...ROW_A, passages: Array.from({ length: 2500 }, (_, i) => ({ range: { versificationId: CANONICAL_VERSIFICATION_ID, start: `1.1.${i + 1}`, end: `1.1.${i + 1}` }, inDatasetVerseList: true, note: null })) };
  const big = fakePlacesDb();
  await upsertPlaceRows(big.db as never, [many]);
  const passageInserts = big.batches[0].filter((s) => s.op === "insert" && s.table === placePassages);
  assert.deepEqual(passageInserts.map((s) => s.values?.length), [1000, 1000, 500]);
});

test("SYNC: a failing batch propagates (a partially applied place is impossible: one batch is one transaction)", async () => {
  const { db } = fakePlacesDb();
  db.batch = async () => {
    throw new Error("relation \"places\" does not exist");
  };
  await assert.rejects(() => upsertPlaceRows(db as never, [ROW_A]), /does not exist/);
});

test("SYNC: findMissingPlaceIds reports ids with no row, dedupes, sorts; [] never queries; a query failure propagates", async () => {
  const captured: { where?: SQL } = {};
  const db = { select: () => ({ from: () => ({ where: (clause: SQL) => { captured.where = clause; return Promise.resolve([{ id: "eden" }]); } }) }) };
  assert.deepEqual(await findMissingPlaceIds(db as never, ["sinai", "eden", "sinai", "babel"]), ["babel", "sinai"]);
  const q = render(captured.where as SQL);
  assert.match(q.sql, /"places"\."id" in/);
  assert.deepEqual(await findMissingPlaceIds({ select: () => { throw new Error("must not query"); } } as never, []), []);
  const failing = { select: () => ({ from: () => ({ where: () => Promise.reject(new Error('relation "places" does not exist')) }) }) };
  await assert.rejects(() => findMissingPlaceIds(failing as never, ["eden"]), /does not exist/);
});

test("SHAPE: upsertPlaceRows (db, rows[, chunkSize]) and findMissingPlaceIds (db, ids) are exported async functions", () => {
  assert.equal(upsertPlaceRows.length, 2);
  assert.equal(upsertPlaceRows.constructor.name, "AsyncFunction");
  assert.equal(findMissingPlaceIds.length, 2);
  assert.equal(findMissingPlaceIds.constructor.name, "AsyncFunction");
});

test("SYNC SCRIPT: db:sync-places is registered, carries the HUMAN GATE header, validates before it connects, and never runs on import", () => {
  const pkg = JSON.parse(readFileSync(webPath("package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["db:sync-places"], "tsx --env-file=.env.local scripts/sync-places.mts");
  const script = readFileSync(webPath("scripts/sync-places.mts"), "utf8");
  assert.match(script, /HUMAN GATE/);
  assert.match(script, /NOT run against any real `DATABASE_URL`/);
  assert.match(script, /migration 0014/i);
  assert.ok(script.indexOf("loadPlaces(") < script.indexOf("drizzle(process.env.DATABASE_URL"), "must validate before opening a connection");
  assert.match(script, /refused -- \$\{loaded\.errors\.length\} problem\(s\), nothing written/);
  assert.match(script, /findMissingSourceIds/);
});

test("loadRealCanonTable: builds a real canon from the shipped corpus (Genesis 3 has 24 verses; Genesis has 50 chapters)", () => {
  const canon = loadRealCanonTable();
  assert.equal(canon.chapterCount(1), 50);
  assert.equal(canon.verseCount(1, 3), 24);
  assert.equal(canon.verseCount(1, 51), undefined);
});
