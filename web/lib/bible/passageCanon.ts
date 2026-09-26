/**
 * PICKERLIB-001 — a plain-data view of the canon for UI pickers.
 *
 * `PassageCanon` is JSON-serialisable (a server component can build it once
 * and pass it as a prop) and carries no corpus text: only, per book, its
 * number, display name, abbreviation, and the real verse count of every
 * chapter. It is derived from the real shipped corpus (`public/bible/
 * index.json` + one `BookData` per book, as `lib/bible/loader.ts` loads them)
 * — never hardcoded here — and fails closed: a book whose data is missing or
 * whose chapter count disagrees with the index throws, rather than producing
 * a picker that offers chapters the corpus cannot show.
 *
 * `toCanonTable` adapts it to the `CanonTable` contract `lib/bible/range.ts`
 * validates against, so a picker and `validateCanonicalRange` can never
 * disagree about the canon's bounds.
 */

import type { BookData, BookMeta } from "@/lib/contracts";
import type { CanonTable } from "@/lib/bible/range";

export interface PassageCanonBook {
  /** 1-66, canonical order. */
  n: number;
  name: string;
  abbr: string;
  /** verseCounts[i] = number of verses in chapter i + 1. */
  verseCounts: readonly number[];
}

export type PassageCanon = readonly PassageCanonBook[];

/** Builds the canon from index.json's `books` plus each book's loaded data. Throws on any mismatch. */
export function buildPassageCanon(
  books: readonly BookMeta[],
  bookData: (book: number) => Pick<BookData, "c"> | undefined,
): PassageCanon {
  return books.map((meta) => {
    const data = bookData(meta.n);
    if (!data) throw new Error(`no book data for book ${meta.n} (${meta.name})`);
    if (data.c.length !== meta.chapters) {
      throw new Error(
        `book ${meta.n} (${meta.name}): index says ${meta.chapters} chapters, data has ${data.c.length}`,
      );
    }
    return {
      n: meta.n,
      name: meta.name,
      abbr: meta.abbr,
      verseCounts: data.c.map((verses) => verses.length),
    };
  });
}

export function findBook(canon: PassageCanon, book: number): PassageCanonBook | undefined {
  return canon.find((candidate) => candidate.n === book);
}

/** Chapters in `book`, or undefined if the book is not in `canon`. */
export function chapterCountOf(canon: PassageCanon, book: number): number | undefined {
  return findBook(canon, book)?.verseCounts.length;
}

/** Verses in `book` `chapter`, or undefined if either is outside `canon`. */
export function verseCountOf(canon: PassageCanon, book: number, chapter: number): number | undefined {
  if (!Number.isInteger(chapter) || chapter < 1) return undefined;
  return findBook(canon, book)?.verseCounts[chapter - 1];
}

/** Adapts a `PassageCanon` to the `CanonTable` `lib/bible/range.ts` validates against. */
export function toCanonTable(canon: PassageCanon): CanonTable {
  return {
    chapterCount: (book) => chapterCountOf(canon, book),
    verseCount: (book, chapter) => verseCountOf(canon, book, chapter),
  };
}
