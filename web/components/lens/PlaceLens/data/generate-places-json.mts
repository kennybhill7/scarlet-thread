#!/usr/bin/env -S npx tsx
/**
 * PLACELENS-001 — generates `public/map/places.json` from the real,
 * committed `content/places/places.jsonl` (PLACES-001; `content/` is
 * read-only for this task, so this reads it but never writes there).
 *
 * NOT wired into `package.json`/`npm run` — `scripts/` and `package.json`
 * are outside this task's owned paths (`components/lens/PlaceLens/**`,
 * `public/map/**`). Run by hand, from `web/`, whenever `places.jsonl`
 * changes:
 *
 *   npx tsx components/lens/PlaceLens/data/generate-places-json.mts
 *
 * Deliberately reuses the REAL production validation/compilation path
 * instead of re-parsing the JSONL by hand, so the lens can never show a
 * place the DB sync would have rejected, and the OSIS -> CanonicalRangeV1
 * conversion is the one `scripts/content/placeSchema.ts` already ships and
 * `tests/places.test.ts` already exercises against the real canon:
 *   - `PlaceRowSchema` (zod) validates each JSONL row (honesty rules: see
 *     that file's header).
 *   - `compilePlace(row, canon)` resolves every OSIS passage reference to a
 *     `CanonicalRangeV1`, bounds-checked against the REAL shipped BSB canon
 *     (built here from `public/bible/index.json` + `public/bible/BSB/*.json`,
 *     the same two sources `tests/places.test.ts` reads).
 *
 * This script adds exactly one thing `compilePlace` does not: a
 * pre-formatted human display string per passage ("Genesis 2:8"), via
 * `formatRange` (`lib/bible/reference.ts`), so the shipped browser bundle
 * never needs the 66-book canon just to label a reference.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildPassageCanon, toCanonTable } from "@/lib/bible/passageCanon";
import { formatRange } from "@/lib/bible/reference";
import type { BibleIndex, BookData } from "@/lib/contracts";
import { PlaceRowSchema, compilePlace, type CompiledPlace } from "../../../../scripts/content/placeSchema";
import type { LensPlace, LensPlaceCandidate, LensPlacePassage, PlaceLensDataset } from "../types";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../../../.."); // components/lens/PlaceLens/data -> web/
const repoRoot = path.resolve(webRoot, "..");

function readJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(path.join(webRoot, relPath), "utf8")) as T;
}

function toLensPassage(passage: CompiledPlace["passages"][number], books: BibleIndex["books"]): LensPlacePassage {
  return {
    range: passage.range,
    display: formatRange(passage.range.start, passage.range.end, [...books]),
    inDatasetVerseList: passage.inDatasetVerseList,
  };
}

function toLensCandidate(candidate: CompiledPlace["candidates"][number]): LensPlaceCandidate {
  return { description: candidate.description, lon: candidate.lon, lat: candidate.lat, score: candidate.score };
}

function toLensPlace(place: CompiledPlace, books: BibleIndex["books"]): LensPlace {
  return {
    id: place.id,
    name: place.name,
    kind: place.kind,
    tier: place.tier,
    lon: place.lon,
    lat: place.lat,
    coordinateBasis: place.coordinateBasis,
    modernName: place.modernName,
    note: place.note,
    candidates: place.candidates.map(toLensCandidate),
    passages: place.passages.map((passage) => toLensPassage(passage, books)),
  };
}

function main(): void {
  const index = readJson<BibleIndex>("public/bible/index.json");
  const canon = toCanonTable(
    buildPassageCanon(index.books, (n) => readJson<BookData>(`public/bible/BSB/${n}.json`)),
  );

  const jsonlPath = path.join(repoRoot, "content/places/places.jsonl");
  const datasetPath = path.join(repoRoot, "content/places/DATASET.json");
  const dataset = JSON.parse(readFileSync(datasetPath, "utf8")) as {
    attribution: string;
    page: string;
    commit: string;
  };

  const lines = readFileSync(jsonlPath, "utf8")
    .split(/\r?\n/)
    .map((line, i) => ({ line, n: i + 1 }))
    .filter((entry) => entry.line.trim() !== "");

  const places: LensPlace[] = [];
  const errors: string[] = [];
  for (const { line, n } of lines) {
    const raw: unknown = JSON.parse(line);
    const parsed = PlaceRowSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(`line ${n}: ${parsed.error.issues.map((i2) => i2.message).join("; ")}`);
      continue;
    }
    const compiled = compilePlace(parsed.data, canon);
    if (!compiled.ok) {
      errors.push(`line ${n} (${parsed.data.id}): ${compiled.errors.join("; ")}`);
      continue;
    }
    places.push(toLensPlace(compiled.place, index.books));
  }

  if (errors.length > 0) {
    console.error(`${errors.length} place row(s) failed to compile — NOT writing places.json:`);
    for (const error of errors.slice(0, 20)) console.error(`  ${error}`);
    process.exitCode = 1;
    return;
  }

  const outDocument: PlaceLensDataset = {
    attribution: dataset.attribution,
    sourceUrl: dataset.page,
    datasetCommit: dataset.commit,
    generatedAt: new Date().toISOString(),
    places,
  };

  const outPath = path.join(webRoot, "public/map/places.json");
  writeFileSync(outPath, JSON.stringify(outDocument));
  console.log(`Wrote ${places.length} places to ${path.relative(webRoot, outPath)} (${errors.length} errors).`);
}

main();
