/**
 * Scripture reference parsing and formatting.
 *
 * The canonical form is a RefKey: "1.3.15" = Genesis 3:15, "1.3" = Genesis 3.
 * Book numbers are canonical order (1-66), chapters and verses are 1-indexed.
 * RefKeys sort correctly as tuples but NOT as strings ("1.10" < "1.9"
 * lexically), so always compare via compareRefs, never with < or >.
 *
 * Track A owns this file.
 */

import type { BookMeta, ChapterRef, RefKey, VerseRef } from "@/lib/contracts";

// ---------------------------------------------------------------------------
// RefKey
// ---------------------------------------------------------------------------

export function verseKey(book: number, chapter: number, verse: number): RefKey {
  return `${book}.${chapter}.${verse}`;
}

export function chapterKey(book: number, chapter: number): RefKey {
  return `${book}.${chapter}`;
}

export function refToKey(ref: VerseRef | ChapterRef): RefKey {
  return "verse" in ref && typeof ref.verse === "number"
    ? verseKey(ref.book, ref.chapter, ref.verse)
    : chapterKey(ref.book, ref.chapter);
}

/** Returns null rather than throwing — callers parse untrusted URLs and stored keys. */
export function parseKey(key: string): VerseRef | ChapterRef | null {
  const parts = key.split(".");
  if (parts.length < 2 || parts.length > 3) return null;

  const numbers = parts.map((part) => Number.parseInt(part, 10));
  if (numbers.some((n) => !Number.isInteger(n) || n < 1)) return null;

  const [book, chapter, verse] = numbers;
  if (book > 66) return null;

  return verse === undefined ? { book, chapter } : { book, chapter, verse };
}

/** The chapter a verse belongs to. "1.3.15" -> "1.3". Chapter keys pass through. */
export function toChapterKey(key: RefKey): RefKey {
  const parts = key.split(".");
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : key;
}

/** Numeric ordering. Never compare RefKeys as strings. */
export function compareRefs(a: RefKey, b: RefKey): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function formatRef(
  key: RefKey,
  books: BookMeta[],
  options: { short?: boolean; spanishNames?: Record<string, string> } = {},
): string {
  const ref = parseKey(key);
  if (!ref) return key;

  const book = books.find((b) => b.n === ref.book);
  if (!book) return key;

  const name = options.spanishNames?.[String(ref.book)] ?? (options.short ? book.abbr : book.name);
  const verse = "verse" in ref ? ref.verse : undefined;
  return verse === undefined ? `${name} ${ref.chapter}` : `${name} ${ref.chapter}:${verse}`;
}

/** "Gen 1-2", "Genesis 3:15-17" — a contiguous run inside one chapter. */
export function formatRange(start: RefKey, end: RefKey, books: BookMeta[]): string {
  if (start === end) return formatRef(start, books);

  const a = parseKey(start);
  const b = parseKey(end);
  if (!a || !b) return `${start}–${end}`;

  if (a.book === b.book && a.chapter === b.chapter) {
    const from = "verse" in a ? a.verse : undefined;
    const to = "verse" in b ? b.verse : undefined;
    if (from !== undefined && to !== undefined) {
      return `${formatRef(start, books)}–${to}`;
    }
  }
  if (a.book === b.book) {
    return `${formatRef(start, books)}–${b.chapter}`;
  }
  return `${formatRef(start, books)} – ${formatRef(end, books)}`;
}

// ---------------------------------------------------------------------------
// Human input — the search box and the "jump to" field
// ---------------------------------------------------------------------------

/** Strips accents and punctuation so "Génesis", "1 Cor.", and "1cor" all match. */
function normalise(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.\s_-]/g, "");
}

/**
 * Resolves a book by full name, abbreviation, or Spanish name. Falls back to a
 * unique prefix match so "Philipp" resolves but "Ph" (Philippians / Philemon)
 * deliberately does not.
 */
export function findBook(
  query: string,
  books: BookMeta[],
  spanishNames?: Record<string, string>,
): BookMeta | null {
  const needle = normalise(query);
  if (!needle) return null;

  const candidates = books.map((book) => ({
    book,
    keys: [book.name, book.abbr, spanishNames?.[String(book.n)] ?? ""]
      .filter(Boolean)
      .map(normalise),
  }));

  const exact = candidates.find((c) => c.keys.includes(needle));
  if (exact) return exact.book;

  const prefixed = candidates.filter((c) => c.keys.some((key) => key.startsWith(needle)));
  return prefixed.length === 1 ? prefixed[0].book : null;
}

/**
 * Parses what someone actually types: "gen 3", "Genesis 3:15", "1 cor 13:4",
 * "Juan 3:16". Returns null on anything ambiguous — a wrong jump is worse than
 * no jump.
 */
export function parseHumanRef(
  input: string,
  books: BookMeta[],
  spanishNames?: Record<string, string>,
): VerseRef | ChapterRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Leading digits belong to the book name ("1 Corinthians"), not the chapter.
  const match = trimmed.match(/^(\d?\s*[^\d:]+?)\s*(\d+)?\s*(?::\s*(\d+))?\s*$/);
  if (!match) return null;

  const [, namePart, chapterPart, versePart] = match;
  const book = findBook(namePart, books, spanishNames);
  if (!book) return null;

  const chapter = chapterPart ? Number.parseInt(chapterPart, 10) : 1;
  if (chapter < 1 || chapter > book.chapters) return null;

  if (!versePart) return { book: book.n, chapter };

  const verse = Number.parseInt(versePart, 10);
  return verse < 1 ? null : { book: book.n, chapter, verse };
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** Next chapter, rolling into the following book. Null at Revelation 22. */
export function nextChapter(ref: ChapterRef, books: BookMeta[]): ChapterRef | null {
  const book = books.find((b) => b.n === ref.book);
  if (!book) return null;
  if (ref.chapter < book.chapters) return { book: ref.book, chapter: ref.chapter + 1 };
  return ref.book < 66 ? { book: ref.book + 1, chapter: 1 } : null;
}

/** Previous chapter, rolling back into the prior book. Null at Genesis 1. */
export function previousChapter(ref: ChapterRef, books: BookMeta[]): ChapterRef | null {
  if (ref.chapter > 1) return { book: ref.book, chapter: ref.chapter - 1 };
  if (ref.book <= 1) return null;
  const previous = books.find((b) => b.n === ref.book - 1);
  return previous ? { book: previous.n, chapter: previous.chapters } : null;
}

/** Absolute chapter position, 1-1189. Drives the reading grid and progress. */
export function chapterOrdinal(ref: ChapterRef, books: BookMeta[]): number {
  let total = 0;
  for (const book of books) {
    if (book.n === ref.book) return total + ref.chapter;
    total += book.chapters;
  }
  return 0;
}
