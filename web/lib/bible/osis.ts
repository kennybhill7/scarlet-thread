/**
 * PICKERLIB-001 (contract C2) — OSIS-style reference <-> `CanonicalRangeV1`.
 *
 * `parseOsis("Gen.3.1-Gen.3.24")` -> `{ versificationId, start: "1.3.1", end: "1.3.24" }`
 * `formatOsis(range)`             -> "Gen.3.1-Gen.3.24" (a single verse: "Gen.3.1")
 *
 * The spelling is the OpenBible.info dataset's own book tokens ("Gen",
 * "Exod", "1Kgs", "1John" ...), the same ones `design/globe-exploration/
 * places.json` and `scripts/data/cross-references.txt` use. The 66-entry book
 * table is NOT re-typed here: it is imported from
 * `scripts/lib/importCrossReferences.ts` (`DATASET_BOOK_NUMBERS`), which is a
 * pure module (no fs / network / DB) already verified against the real
 * dataset, so there is exactly one place the token -> book-number mapping
 * lives. (Follow-up: a later wave may move the table to a shared
 * `lib/bible/` module and have the script import it back; that script was out
 * of this task's ownership, so it is reused in place, unchanged.)
 *
 * Forms accepted:
 *   - single verse                  "Gen.3.15"
 *   - verse range, same book        "Gen.3.1-Gen.3.24", "Gen.1.1-Gen.2.3"
 *   - whole chapter / chapter span  "Gen.3", "Gen.3-Gen.5"   (needs `canon`:
 *     a chapter's last verse is real corpus data, never guessed here)
 * Rejected (null): unknown book tokens, cross-book ranges, reversed ranges,
 * zero / leading-zero / non-numeric chapter or verse, extra separators,
 * whitespace, mixed verse/chapter endpoints ("Gen.3.1-Gen.4"), and — when a
 * `canon` is supplied — anything outside the real canon.
 *
 * Pure functions only; never throws on bad input.
 */

import { DATASET_BOOK_NUMBERS } from "@/scripts/lib/importCrossReferences";
import { type CanonTable, parseVerseKeyStrict, validateCanonicalRange } from "@/lib/bible/range";
import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";

/** Book number (1-66) -> OSIS token, derived once from the shared table. */
const TOKEN_BY_BOOK: ReadonlyMap<number, string> = new Map(
  Object.entries(DATASET_BOOK_NUMBERS).map(([token, book]) => [book, token]),
);

/** The OSIS token for a canonical book number, or undefined outside 1-66. */
export function osisBookToken(book: number): string | undefined {
  return TOKEN_BY_BOOK.get(book);
}

/** The canonical book number for an exact OSIS token ("Gen" -> 1), or undefined. */
export function osisBookNumber(token: string): number | undefined {
  // hasOwn, not a bare index: "constructor"/"toString" must not resolve.
  return Object.hasOwn(DATASET_BOOK_NUMBERS, token) ? DATASET_BOOK_NUMBERS[token] : undefined;
}

/** No leading zeros; chapter/verse at most 3 digits (Ps 119:176 is the real maximum). */
const TOKEN_RE = /^([1-3]?[A-Za-z]+)\.([1-9]\d{0,2})(?:\.([1-9]\d{0,2}))?$/;

interface Point {
  book: number;
  chapter: number;
  /** undefined = chapter-only endpoint ("Gen.3"). */
  verse: number | undefined;
}

function parsePoint(token: string): Point | null {
  const match = TOKEN_RE.exec(token);
  if (!match) return null;
  const book = osisBookNumber(match[1]);
  if (book === undefined) return null;
  return {
    book,
    chapter: Number(match[2]),
    verse: match[3] === undefined ? undefined : Number(match[3]),
  };
}

function compareTuple(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const diff = a[i] - b[i];
    if (diff !== 0) return diff;
  }
  return 0;
}

function makeRange(book: number, sc: number, sv: number, ec: number, ev: number): CanonicalRangeV1 {
  return {
    versificationId: CANONICAL_VERSIFICATION_ID,
    start: `${book}.${sc}.${sv}`,
    end: `${book}.${ec}.${ev}`,
  };
}

/**
 * Parses an OSIS-style reference into a `CanonicalRangeV1`, or null.
 * `canon` is optional: without it only shape / same-book / ordering are
 * checked and chapter-only references cannot be resolved (null); with it every
 * boundary is also bounds-checked against the real canon via
 * `validateCanonicalRange`, and chapter-only references expand to the whole
 * chapter (or chapter span).
 */
export function parseOsis(ref: string, canon?: CanonTable): CanonicalRangeV1 | null {
  if (typeof ref !== "string") return null;
  const parts = ref.split("-");
  if (parts.length > 2) return null;

  const a = parsePoint(parts[0]);
  if (!a) return null;
  const b = parts.length === 2 ? parsePoint(parts[1]) : a;
  if (!b) return null;
  if (a.book !== b.book) return null;

  let range: CanonicalRangeV1;
  if (a.verse !== undefined && b.verse !== undefined) {
    if (compareTuple([a.chapter, a.verse], [b.chapter, b.verse]) > 0) return null;
    range = makeRange(a.book, a.chapter, a.verse, b.chapter, b.verse);
  } else if (a.verse === undefined && b.verse === undefined) {
    // Whole chapter / chapter span: the last verse is real corpus data.
    if (!canon) return null;
    if (a.chapter > b.chapter) return null;
    const lastVerse = canon.verseCount(b.book, b.chapter);
    if (lastVerse === undefined || lastVerse < 1) return null;
    range = makeRange(a.book, a.chapter, 1, b.chapter, lastVerse);
  } else {
    return null; // mixed endpoints are ambiguous — never guessed at
  }

  if (canon && !validateCanonicalRange(range, canon).ok) return null;
  return range;
}

/**
 * Formats a `CanonicalRangeV1` as OSIS ("Gen.3.1-Gen.3.24"; single verse
 * "Gen.3.1"), or null if it is not a well-formed same-book, in-order range in
 * the one supported versification. Optional `canon` adds a bounds check.
 * Never throws.
 */
export function formatOsis(range: CanonicalRangeV1, canon?: CanonTable): string | null {
  if (range === null || typeof range !== "object") return null;
  if (range.versificationId !== CANONICAL_VERSIFICATION_ID) return null;
  const start = parseVerseKeyStrict(range.start);
  const end = parseVerseKeyStrict(range.end);
  if (!start || !end) return null;
  if (start.book !== end.book) return null;
  if (compareTuple([start.chapter, start.verse], [end.chapter, end.verse]) > 0) return null;
  const token = osisBookToken(start.book);
  if (token === undefined) return null;
  if (canon && !validateCanonicalRange(range, canon).ok) return null;

  const from = `${token}.${start.chapter}.${start.verse}`;
  if (start.chapter === end.chapter && start.verse === end.verse) return from;
  return `${from}-${token}.${end.chapter}.${end.verse}`;
}
