#!/usr/bin/env -S npx tsx
/**
 * PICKERCANON-001 — builds `public/bible/canon.json`, the compact per-book,
 * per-chapter verse-count table the PassagePicker / range validation need.
 *
 *   npm run bible:canon        (from web/)
 *
 * Why it exists: the counts used to be derived in the browser by fetching all
 * 66 BSB book files (~4 MB). They are pure functions of the shipped corpus, so
 * they are computed here once, at build time, and shipped as a few KB:
 *
 *   { "versificationId": <CANONICAL_VERSIFICATION_ID>,
 *     "generatedFrom": "BSB",
 *     "books": { "<bookNumber>": [versesInCh1, versesInCh2, ...] } }
 *
 * Output is minified JSON with NO trailing newline and is deterministic (book
 * keys ascend numerically), so `tests/canon-counts-drift.test.ts` can assert
 * the committed file is byte-for-byte what this script emits. If it is not,
 * the corpus changed without this script being re-run and CI fails.
 *
 * MAINTAINER NOTE: `tools/build_bible.py` generates public/bible/BSB/*.json
 * and index.json. It should run `npm run bible:canon` (from web/) after it
 * finishes, so canon.json is regenerated in the same step as the corpus. Until
 * it does, the drift test is what catches a forgotten regeneration.
 *
 * Fails closed: a missing book, a chapter-count disagreement with index.json,
 * or a chapter with no verses aborts with a non-zero exit and writes nothing.
 *
 * Author: Kenneth Hill
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CANONICAL_VERSIFICATION_ID } from "../lib/contracts/range-v1.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const WEB_ROOT = path.resolve(SCRIPT_DIR, "..");
export const CANON_SOURCE_VERSION = "BSB";

export interface CanonCountsFile {
  versificationId: string;
  generatedFrom: string;
  books: Record<string, number[]>;
}

interface IndexBook {
  n: number;
  name: string;
  chapters: number;
}

/** Pure: builds the canon table from index.json's books and a per-book chapter reader. */
export function buildCanonCounts(
  indexBooks: readonly IndexBook[],
  readChapters: (book: number) => readonly (readonly unknown[])[],
): CanonCountsFile {
  const books: Record<string, number[]> = {};
  for (const meta of [...indexBooks].sort((a, b) => a.n - b.n)) {
    const chapters = readChapters(meta.n);
    if (chapters.length !== meta.chapters) {
      throw new Error(`book ${meta.n} (${meta.name}): index says ${meta.chapters} chapters, data has ${chapters.length}`);
    }
    books[String(meta.n)] = chapters.map((verses, i) => {
      if (verses.length < 1) throw new Error(`book ${meta.n} (${meta.name}) chapter ${i + 1} has no verses`);
      return verses.length;
    });
  }
  return { versificationId: CANONICAL_VERSIFICATION_ID, generatedFrom: CANON_SOURCE_VERSION, books };
}

/** Exactly the bytes written to canon.json: minified, no trailing newline. */
export function renderCanonJson(webRoot: string = WEB_ROOT): string {
  const bibleDir = path.join(webRoot, "public", "bible");
  const index = JSON.parse(readFileSync(path.join(bibleDir, "index.json"), "utf8")) as { books: IndexBook[] };
  const file = buildCanonCounts(index.books, (n) => {
    const book = JSON.parse(readFileSync(path.join(bibleDir, CANON_SOURCE_VERSION, `${n}.json`), "utf8")) as { c: unknown[][] };
    return book.c;
  });
  return JSON.stringify(file);
}

function main(): void {
  const out = path.join(WEB_ROOT, "public", "bible", "canon.json");
  const text = renderCanonJson();
  writeFileSync(out, text, "utf8");
  console.log(`wrote ${out} (${Buffer.byteLength(text, "utf8")} bytes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
