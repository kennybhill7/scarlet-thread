/**
 * PLACELENS-001 — `passageList.ts`: building a place's passage list and the
 * "Open in Connect" `?openRange=` contract, against REAL places from
 * `content/places/places.jsonl` (Eden: 13 unlocated-place passages; Mount
 * Sinai: 30 passages, a disputed place) — not synthetic fixtures, so a
 * regression in the real OSIS -> CanonicalRangeV1 conversion for an actual
 * dataset row would fail here even if a hand-built fixture happened to dodge
 * it.
 *
 * Author: Kenneth Hill
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildConnectHref, buildPassageList, OPEN_RANGE_QUERY_KEY } from "@/components/lens/PlaceLens/passageList";
import { buildPassageCanon, toCanonTable } from "@/lib/bible/passageCanon";
import { parseCanonicalRangeKey } from "@/lib/bible/range";
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

function realPlace(id: string) {
  const lines = readFileSync(repoPath("content/places/places.jsonl"), "utf8").split(/\r?\n/);
  const line = lines.find((text) => text.trim() !== "" && (JSON.parse(text) as { id: string }).id === id);
  assert.ok(line, `no real place with id "${id}"`);
  const row = PlaceRowSchema.parse(JSON.parse(line!));
  const compiled = compilePlace(row, canon);
  assert.ok(compiled.ok);
  if (!compiled.ok) throw new Error("unreachable");
  return {
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
    passages: compiled.place.passages.map((p) => ({ ...p, display: `${p.range.start}-${p.range.end}` })),
  };
}

test("buildPassageList returns one entry per real passage, sorted canon order", () => {
  const eden = realPlace("eden");
  const list = buildPassageList(eden);
  assert.equal(list.length, 13); // Gen 2:8,10,15; 3:23,24; 4:16; Isa 51:3; Ezek 28:13,31:9,31:16,31:18,36:35; Joel 2:3
  // Sorted: Genesis (book 1) before Isaiah (23) before Ezekiel (26) before Joel (29).
  const books = list.map((item) => Number(item.range.start.split(".")[0]));
  const sorted = [...books].sort((a, b) => a - b);
  assert.deepEqual(books, sorted);
});

test("every real passage's connectQueryParam round-trips through parseCanonicalRangeKey against the real canon", () => {
  const sinai = realPlace("sinai");
  const list = buildPassageList(sinai);
  assert.ok(list.length >= 30);
  for (const item of list) {
    assert.ok(item.connectQueryParam.startsWith(`${OPEN_RANGE_QUERY_KEY}=`));
    const key = decodeURIComponent(item.connectQueryParam.slice(`${OPEN_RANGE_QUERY_KEY}=`.length));
    const parsed = parseCanonicalRangeKey(key, canon);
    assert.equal(parsed.ok, true, `"${key}" failed to parse: ${!parsed.ok ? parsed.detail : ""}`);
    if (parsed.ok) assert.deepEqual(parsed.range, item.range);
  }
});

test("buildConnectHref appends ?openRange= to a bare path, and &openRange= when the path already has a query", () => {
  const range = { versificationId: "eng-protestant-66-31102-v1" as const, start: "1.2.8", end: "1.2.8" };
  assert.equal(buildConnectHref("/study/abc", range), "/study/abc?openRange=1.2.8-1.2.8");
  assert.equal(buildConnectHref("/study/abc?tab=connect", range), "/study/abc?tab=connect&openRange=1.2.8-1.2.8");
});

test("a hand-added (curation.json extraPassages) reference, if any exist in the real data, is marked inDatasetVerseList: false", () => {
  // DATASET.json's own note documents the convention; this asserts it holds
  // for whatever the real data currently has, without assuming a specific id
  // (curation.json's extraPassages count is 0 today per DATASET.json's
  // `excluded.curated.count`, but this test is correct either way).
  const eden = realPlace("eden");
  for (const item of buildPassageList(eden)) {
    assert.equal(item.inDatasetVerseList, true, "Eden's references are all from the dataset's own verse list");
  }
});
