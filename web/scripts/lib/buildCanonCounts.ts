/**
 * PICKERCANON-001 — the pure half of `scripts/build-canon-counts.mts`,
 * split out per this repo's own logic-vs-IO convention (e.g.
 * `scripts/lib/importCrossReferences.ts`): a `.ts` module so test files
 * (which cannot cleanly import a sibling `.mts` CLI script under this
 * project's `moduleResolution: "bundler"` setup) can import the real logic
 * directly, never a parallel reimplementation.
 *
 * Author: Kenneth Hill
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { CANONICAL_VERSIFICATION_ID } from "../../lib/contracts/range-v1";

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

/** Exactly the bytes written to canon.json: minified, no trailing newline. Real filesystem IO (reads the shipped corpus), but deterministic and side-effect-free (no writes) — safe to call from a test. */
export function renderCanonJson(webRoot: string): string {
  const bibleDir = path.join(webRoot, "public", "bible");
  const index = JSON.parse(readFileSync(path.join(bibleDir, "index.json"), "utf8")) as { books: IndexBook[] };
  const file = buildCanonCounts(index.books, (n) => {
    const book = JSON.parse(readFileSync(path.join(bibleDir, CANON_SOURCE_VERSION, `${n}.json`), "utf8")) as { c: unknown[][] };
    return book.c;
  });
  return JSON.stringify(file);
}
