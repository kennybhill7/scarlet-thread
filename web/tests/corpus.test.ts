import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import type { BibleIndex, BookData, VersionId } from "@/lib/contracts";

const bibleRoot = path.join(process.cwd(), "public", "bible");

const expected = {
  BSB: {
    verses: 31_102,
    empty: [
      "40.17.21",
      "40.18.11",
      "40.23.14",
      "41.7.16",
      "41.9.44",
      "41.9.46",
      "41.11.26",
      "41.15.28",
      "42.17.36",
      "42.23.17",
      "43.5.4",
      "44.8.37",
      "44.15.34",
      "44.24.7",
      "44.28.29",
      "45.16.24",
    ],
  },
  KJV: { verses: 31_102, empty: [] },
  ASV: {
    verses: 31_102,
    empty: [
      "40.17.21",
      "40.18.11",
      "40.23.14",
      "41.7.16",
      "41.9.44",
      "41.9.46",
      "41.11.26",
      "41.15.28",
      "42.17.36",
      "42.23.17",
      "43.5.4",
      "44.8.37",
      "44.15.34",
      "44.24.7",
      "44.28.29",
      "45.16.24",
    ],
  },
  YLT: { verses: 31_102, empty: [] },
  SBL: {
    verses: 31_103,
    empty: ["42.17.36", "44.8.37", "44.15.34", "44.24.7", "45.16.25"],
  },
} satisfies Record<VersionId, { verses: number; empty: string[] }>;

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

test("all shipped corpora match the declared canon and omission sets", async () => {
  const index = await readJson<BibleIndex>(path.join(bibleRoot, "index.json"));
  assert.equal(index.books.length, 66);
  assert.equal(index.totalChapters, 1_189);
  assert.deepEqual(
    index.versions.map((version) => version.id).sort(),
    Object.keys(expected).sort(),
  );
  assert.ok(index.versions.every((version) => version.language));

  for (const version of index.versions) {
    let chapters = 0;
    let verses = 0;
    const empty: string[] = [];

    for (const bookMeta of index.books) {
      const book = await readJson<BookData>(
        path.join(bibleRoot, version.id, `${bookMeta.n}.json`),
      );
      const expectedName =
        version.id === "SBL"
          ? index.spanishNames?.[String(bookMeta.n)]
          : bookMeta.name;
      assert.equal(book.b, expectedName, `${version.id} book ${bookMeta.n}`);
      assert.equal(
        book.c.length,
        bookMeta.chapters,
        `${version.id} ${bookMeta.name} chapter count`,
      );
      chapters += book.c.length;
      book.c.forEach((chapter, chapterIndex) => {
        verses += chapter.length;
        chapter.forEach((text, verseIndex) => {
          if (!text.trim()) {
            empty.push(`${bookMeta.n}.${chapterIndex + 1}.${verseIndex + 1}`);
          }
        });
      });
    }

    assert.equal(chapters, 1_189, `${version.id} total chapters`);
    assert.equal(verses, expected[version.id].verses, `${version.id} verses`);
    assert.deepEqual(empty, expected[version.id].empty, `${version.id} omissions`);
  }
});
