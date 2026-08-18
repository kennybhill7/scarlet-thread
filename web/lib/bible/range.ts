/**
 * Canonical passage-range parsing, validation, formatting, and the
 * translation-independent -> display-reference mapping.
 *
 * Pure functions only. This module has no fetch, no DB, no UI. The one piece
 * of real-world data it needs — how many chapters a book has and how many
 * verses a chapter has — is never embedded here as a hardcoded table.
 * Instead every validating/mapping function takes a `CanonTable` the caller
 * supplies, built from the real shipped corpus (`/public/bible/index.json`
 * for chapter counts, the per-book files for verse counts — see
 * `lib/bible/loader.ts`). That keeps this module trivially unit-testable
 * with a synthetic table while still being checkable against the real canon
 * (the test suite builds a `CanonTable` from the actual shipped BSB files).
 *
 * Track A owns this file (matches `lib/bible/reference.ts`, which this
 * module reuses rather than reimplements: `compareRefs`, `chapterKey`).
 */

import type { BookMeta, RefKey, VersionId } from "@/lib/contracts";
import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1, type DisplayReferenceV1 } from "@/lib/contracts/range-v1";
import { chapterKey, compareRefs } from "@/lib/bible/reference";
import { alignChapter } from "@/lib/bible/versemap";

// ---------------------------------------------------------------------------
// Canon bounds — injected, never embedded
// ---------------------------------------------------------------------------

/**
 * Real canon bounds, supplied by the caller. `chapterCount`/`verseCount`
 * return `undefined` for anything outside the canon (book 0 or 67, a
 * chapter's own verse count for a chapter that does not exist) — `undefined`
 * is the "not in the canon" signal validation checks for, distinct from a
 * legitimate 0.
 */
export interface CanonTable {
  chapterCount(book: number): number | undefined;
  verseCount(book: number, chapter: number): number | undefined;
}

/**
 * Builds a `CanonTable` from `BookMeta[]` (chapter counts) plus a verse-count
 * lookup the caller already has in hand (e.g. derived from the real per-book
 * JSON files, as `lib/bible/loader.ts` loads them — this module does not
 * fetch them itself). Convenience only; callers may implement `CanonTable`
 * directly instead.
 */
export function buildCanonTable(
  books: readonly BookMeta[],
  verseCount: (book: number, chapter: number) => number | undefined,
): CanonTable {
  const chapterCounts = new Map(books.map((book) => [book.n, book.chapters]));
  return {
    chapterCount: (book) => chapterCounts.get(book),
    verseCount,
  };
}

// ---------------------------------------------------------------------------
// Strict verse-key parsing — a range boundary is always book.chapter.verse
// ---------------------------------------------------------------------------

export interface ParsedVerseKey {
  book: number;
  chapter: number;
  verse: number;
}

/**
 * Anchored, no leading zeros, exactly three dot-separated positive integers.
 * Deliberately stricter than `lib/bible/reference.ts`'s `parseKey`: that
 * function is built for human/URL input and tolerates a lone `book.chapter`
 * form, and (because it uses `Number.parseInt`, not a full-string match)
 * would accept trailing junk like "1.1.1abc" as verse 1. A range boundary is
 * a stored, machine-produced value, never typed by a person, so this
 * rejects anything that is not exactly a well-formed verse key end to end —
 * whitespace, trailing/leading junk, extra or missing components, and
 * leading zeros are all malformed, not tolerated.
 */
const VERSE_KEY_RE = /^([1-9]\d?)\.([1-9]\d{0,2})\.([1-9]\d{0,2})$/;

export function parseVerseKeyStrict(key: string): ParsedVerseKey | null {
  const match = VERSE_KEY_RE.exec(key);
  if (!match) return null;
  return { book: Number(match[1]), chapter: Number(match[2]), verse: Number(match[3]) };
}

function compareParsed(a: ParsedVerseKey, b: ParsedVerseKey): number {
  return compareRefs(`${a.book}.${a.chapter}.${a.verse}`, `${b.book}.${b.chapter}.${b.verse}`);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type RangeRejectionReason =
  | "wrong-versification"
  | "malformed-key"
  | "malformed-start"
  | "malformed-end"
  | "cross-book"
  | "start-out-of-bounds"
  | "end-out-of-bounds"
  | "reversed";

interface RangeRejection {
  ok: false;
  reason: RangeRejectionReason;
  detail: string;
}

export type RangeValidationResult = { ok: true } | RangeRejection;

function rejected(reason: RangeRejectionReason, detail: string): RangeRejection {
  return { ok: false, reason, detail };
}

/** Returns a human-readable bounds error, or null if `ref` is inside the real canon per `canon`. */
function checkBounds(ref: ParsedVerseKey, canon: CanonTable): string | null {
  const chapters = canon.chapterCount(ref.book);
  if (chapters === undefined) return `book ${ref.book} is not in the canon`;
  if (ref.chapter > chapters) {
    return `book ${ref.book} has only ${chapters} chapters, got chapter ${ref.chapter}`;
  }
  const verses = canon.verseCount(ref.book, ref.chapter);
  if (verses === undefined) {
    return `no verse count known for book ${ref.book} chapter ${ref.chapter}`;
  }
  if (ref.verse > verses) {
    return `book ${ref.book} chapter ${ref.chapter} has only ${verses} verses, got verse ${ref.verse}`;
  }
  return null;
}

/**
 * Validates a `CanonicalRangeV1` against the real canon in `canon`. Rejects,
 * in order: the wrong versification id, either boundary being malformed,
 * start/end in different books, either boundary being out of the real
 * canon's bounds, and a reversed range (end before start). A single verse
 * (`start === end`) is valid.
 */
export function validateCanonicalRange(range: CanonicalRangeV1, canon: CanonTable): RangeValidationResult {
  if (range.versificationId !== CANONICAL_VERSIFICATION_ID) {
    return rejected(
      "wrong-versification",
      `expected versificationId "${CANONICAL_VERSIFICATION_ID}", got "${String(range.versificationId)}"`,
    );
  }

  const start = parseVerseKeyStrict(range.start);
  if (!start) {
    return rejected("malformed-start", `"${range.start}" is not a well-formed book.chapter.verse key`);
  }
  const end = parseVerseKeyStrict(range.end);
  if (!end) {
    return rejected("malformed-end", `"${range.end}" is not a well-formed book.chapter.verse key`);
  }

  if (start.book !== end.book) {
    return rejected(
      "cross-book",
      `start is book ${start.book}, end is book ${end.book} — a canonical range must stay within one book`,
    );
  }

  const startError = checkBounds(start, canon);
  if (startError) return rejected("start-out-of-bounds", startError);
  const endError = checkBounds(end, canon);
  if (endError) return rejected("end-out-of-bounds", endError);

  if (compareParsed(start, end) > 0) {
    return rejected("reversed", `start "${range.start}" is after end "${range.end}"`);
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Parsing / formatting a compact key form — round-trips through storage/URLs
// ---------------------------------------------------------------------------

export type ParseCanonicalRangeResult = { ok: true; range: CanonicalRangeV1 } | RangeRejection;

/** The compact, machine round-trip form: "<start>-<end>", e.g. "1.1.1-1.2.3". */
export function formatCanonicalRangeKey(range: CanonicalRangeV1): string {
  return `${range.start}-${range.end}`;
}

/**
 * Parses the compact "<start>-<end>" form back into a validated
 * `CanonicalRangeV1`. Splits on the first/only "-": a RefKey is only ever
 * digits and dots, so a key with zero, two, or more "-" separators is
 * rejected as malformed rather than guessed at.
 */
export function parseCanonicalRangeKey(key: string, canon: CanonTable): ParseCanonicalRangeResult {
  const parts = key.split("-");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
    return rejected("malformed-key", `"${key}" is not a well-formed "<start>-<end>" range key`);
  }

  const [start, end] = parts;
  const range: CanonicalRangeV1 = { versificationId: CANONICAL_VERSIFICATION_ID, start, end };
  const validation = validateCanonicalRange(range, canon);
  if (!validation.ok) return validation;
  return { ok: true, range };
}

// ---------------------------------------------------------------------------
// Single-verse / containment / overlap
// ---------------------------------------------------------------------------

/** True when the range is exactly one verse (start === end as RefKeys). */
export function isSingleVerseRange(range: CanonicalRangeV1): boolean {
  return range.start === range.end;
}

/**
 * True if `ref` (a verse-level RefKey) falls inside `range`, inclusive.
 * Returns false — never throws — for a `ref` that is not a well-formed verse
 * key, or that is in a different book than `range`; a point that cannot be
 * compared is not contained by definition.
 */
export function rangeContainsRef(range: CanonicalRangeV1, ref: RefKey): boolean {
  const start = parseVerseKeyStrict(range.start);
  const end = parseVerseKeyStrict(range.end);
  const point = parseVerseKeyStrict(ref);
  if (!start || !end || !point) return false;
  if (point.book !== start.book) return false;
  return compareParsed(start, point) <= 0 && compareParsed(point, end) <= 0;
}

/** True if every verse of `inner` falls inside `outer`, inclusive. */
export function rangeContainsRange(outer: CanonicalRangeV1, inner: CanonicalRangeV1): boolean {
  return rangeContainsRef(outer, inner.start) && rangeContainsRef(outer, inner.end);
}

/**
 * True if `a` and `b` share at least one verse. Different books never
 * overlap. Touching-but-not-sharing ranges (a ends where b starts) DO count
 * as overlapping, since that shared verse is the same verse in both.
 */
export function rangesOverlap(a: CanonicalRangeV1, b: CanonicalRangeV1): boolean {
  const aStart = parseVerseKeyStrict(a.start);
  const aEnd = parseVerseKeyStrict(a.end);
  const bStart = parseVerseKeyStrict(b.start);
  const bEnd = parseVerseKeyStrict(b.end);
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  if (aStart.book !== bStart.book) return false;
  return compareParsed(aStart, bEnd) <= 0 && compareParsed(bStart, aEnd) <= 0;
}

// ---------------------------------------------------------------------------
// Display reference — canonical range -> one translation's own numbering
// ---------------------------------------------------------------------------

/**
 * The English version whose numbering the canonical versification already
 * matches, used as the "from" side of `alignChapter()`. Any of the bundled
 * English versions would do for this — `lib/bible/versemap.ts` has exactly
 * one entry in `DIVERGENT_VERSIONS` (SBL) and every non-divergent version
 * aligns 1:1 with every other, so this only matters when `translationId` is
 * itself divergent. BSB is picked because it is the app's own default
 * version (`index.json`'s `default`), not because the canonical numbering is
 * specifically "BSB's" — it is the shared English numbering.
 */
export const CANONICAL_BASE_VERSION: VersionId = "BSB";

/**
 * Thrown when a canonical range boundary has no counterpart verse in the
 * target translation according to the verse map. Distinct from
 * `VerseMapUnavailableError` (`lib/bible/versemap.ts`), which means the map
 * could not be consulted at all; this means the map WAS consulted and
 * confirmed there is nothing there.
 *
 * Honesty note: `toDisplayReference()` only ever aligns FROM
 * `CANONICAL_BASE_VERSION` TO `translationId`, which walks versemap.ts's
 * `toSpanish`-shaped direction — and `validateVerseMap()` there requires
 * every `toSpanish` value to be a non-null string (only the unused-here
 * `toEnglish` direction may contain nulls). So this error is not reachable
 * through `toDisplayReference()` given versemap.ts's current shape
 * invariants; it exists because `AlignedRow.toKey`'s declared type is
 * `RefKey | null` (TypeScript can't see that cross-module invariant) and as
 * defense-in-depth if that invariant is ever relaxed. Not exercised by a
 * test for that reason — see the note in tests/range-v1.test.ts.
 */
export class UnmappableDisplayReferenceError extends Error {
  constructor(
    readonly refKey: RefKey,
    readonly translationId: VersionId,
  ) {
    super(
      `"${refKey}" has no counterpart in ${translationId} per the verse map — cannot produce a display reference`,
    );
    this.name = "UnmappableDisplayReferenceError";
  }
}

async function mapBoundary(refKey: RefKey, translationId: VersionId, canon: CanonTable): Promise<RefKey> {
  if (translationId === CANONICAL_BASE_VERSION) return refKey;

  const parsed = parseVerseKeyStrict(refKey);
  if (!parsed) {
    // Unreachable when refKey came from a validateCanonicalRange()-passed
    // range, but toDisplayReference() re-validates before calling this.
    throw new Error(`"${refKey}" is not a well-formed verse key`);
  }

  const verseCount = canon.verseCount(parsed.book, parsed.chapter);
  if (verseCount === undefined) {
    throw new Error(`no verse count known for book ${parsed.book} chapter ${parsed.chapter}`);
  }

  const rows = await alignChapter(
    CANONICAL_BASE_VERSION,
    translationId,
    chapterKey(parsed.book, parsed.chapter),
    verseCount,
  );
  const row = rows.find((candidate) => candidate.fromVerse === parsed.verse);
  if (!row || row.toKey === null) {
    throw new UnmappableDisplayReferenceError(refKey, translationId);
  }
  return row.toKey;
}

/**
 * Resolves a canonical range into `translationId`'s own verse numbering via
 * `lib/bible/versemap.ts`'s `alignChapter()` — this module never
 * reimplements alignment. `start` and `end` are mapped independently (they
 * may sit in different chapters for a cross-chapter range), each through the
 * chapter it is actually in.
 *
 * Fails closed: re-validates `range` first and rejects an invalid range
 * outright; propagates `VerseMapUnavailableError` if the verse map cannot be
 * loaded (never falls back to an unverified identity mapping); throws
 * `UnmappableDisplayReferenceError` if a boundary verse genuinely has no
 * counterpart in `translationId`. It never returns a `DisplayReferenceV1`
 * with a guessed or partial mapping.
 */
export async function toDisplayReference(
  range: CanonicalRangeV1,
  translationId: VersionId,
  corpusReleaseId: string,
  canon: CanonTable,
): Promise<DisplayReferenceV1> {
  const validation = validateCanonicalRange(range, canon);
  if (!validation.ok) {
    throw new Error(`cannot map an invalid canonical range to a display reference: ${validation.detail}`);
  }

  const [mappedStart, mappedEnd] = await Promise.all([
    mapBoundary(range.start, translationId, canon),
    mapBoundary(range.end, translationId, canon),
  ]);

  return { canonicalRange: range, translationId, corpusReleaseId, mappedStart, mappedEnd };
}
