/**
 * PICKERLIB-001 (contract C2) — lib/bible/osis.ts.
 *
 * Bounds are checked against the REAL shipped BSB corpus (public/bible), never
 * against numbers osis.ts produced. Real round-trips: every OSIS ref in
 * design/globe-exploration/places.json (embedded below with provenance — that
 * file is an untracked design artifact, so a live cross-check runs only when
 * it is present) and every distinct token in scripts/data/cross-references.txt.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import type { BibleIndex, BookData } from "@/lib/contracts";
import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import { formatOsis, osisBookNumber, osisBookToken, parseOsis } from "@/lib/bible/osis";
import { buildPassageCanon, toCanonTable } from "@/lib/bible/passageCanon";
import { validateCanonicalRange } from "@/lib/bible/range";
import { DATASET_BOOK_NUMBERS } from "@/scripts/lib/importCrossReferences";

const webPath = (p: string) => new URL(`../${p}`, import.meta.url);

const index: BibleIndex = JSON.parse(readFileSync(webPath("public/bible/index.json"), "utf8"));
const canon = buildPassageCanon(
  index.books,
  (n) => JSON.parse(readFileSync(webPath(`public/bible/BSB/${n}.json`), "utf8")) as BookData,
);
const table = toCanonTable(canon);

function r(start: string, end: string): CanonicalRangeV1 {
  return { versificationId: CANONICAL_VERSIFICATION_ID, start, end };
}

// ---------------------------------------------------------------------------
// Table-driven: parse
// ---------------------------------------------------------------------------

const PARSE_CASES: ReadonlyArray<readonly [string, CanonicalRangeV1]> = [
  ["Gen.3.15", r("1.3.15", "1.3.15")],
  ["Gen.3.1-Gen.3.24", r("1.3.1", "1.3.24")],
  ["Rom.5.12-Rom.5.21", r("45.5.12", "45.5.21")],
  ["Gen.1.1-Gen.2.3", r("1.1.1", "1.2.3")], // cross-chapter
  ["Gen.3.1-Gen.3.1", r("1.3.1", "1.3.1")], // degenerate range == single verse
  ["2Chr.36.22", r("14.36.22", "14.36.22")],
  ["1Kgs.11.4", r("11.11.4", "11.11.4")],
  ["1John.4.8", r("62.4.8", "62.4.8")],
  ["Ps.119.176", r("19.119.176", "19.119.176")], // 3-digit chapter and verse
  ["Rev.22.21", r("66.22.21", "66.22.21")], // last verse of the canon
  ["Gen.1.1", r("1.1.1", "1.1.1")], // first verse of the canon
];

for (const [ref, expected] of PARSE_CASES) {
  test(`parseOsis("${ref}") -> ${expected.start}..${expected.end}`, () => {
    assert.deepEqual(parseOsis(ref), expected);
    assert.deepEqual(parseOsis(ref, table), expected); // same answer with the real canon
  });
}

test("parseOsis: whole chapter and chapter span use the REAL last verse (needs canon)", () => {
  const gen = JSON.parse(readFileSync(webPath("public/bible/BSB/1.json"), "utf8")) as BookData;
  assert.equal(gen.c[2].length, 24, "fixture sanity: Genesis 3 has 24 verses in the shipped BSB");
  assert.deepEqual(parseOsis("Gen.3", table), r("1.3.1", "1.3.24"));
  assert.deepEqual(parseOsis("Gen.3-Gen.5", table), r("1.3.1", `1.5.${gen.c[4].length}`));
  assert.deepEqual(parseOsis("Ps.119", table), r("19.119.1", "19.119.176"));
  // Without a canon the last verse is unknowable, so it is refused, not guessed.
  assert.equal(parseOsis("Gen.3"), null);
  assert.equal(parseOsis("Gen.3-Gen.5"), null);
});

// ---------------------------------------------------------------------------
// Table-driven: reject (each one a distinct mutation target)
// ---------------------------------------------------------------------------

const REJECT_CASES: ReadonlyArray<readonly [string, string]> = [
  ["", "empty"],
  ["Gen", "book only"],
  ["Gen.3.24-Gen.3.1", "reversed verses, same chapter"],
  ["Gen.4.1-Gen.3.24", "reversed across chapters"],
  ["Gen.3.1-Exod.1.1", "cross-book"],
  ["2Chr.36.22-Ezra.1.3", "cross-book (real OpenBible row)"],
  ["Foo.1.1", "unknown book"],
  ["gen.1.1", "wrong case"],
  ["GEN.1.1", "wrong case"],
  ["Genesis.1.1", "long name"],
  ["constructor.1.1", "prototype key is not a book"],
  ["toString.1.1", "prototype key is not a book"],
  ["__proto__.1.1", "prototype key is not a book"],
  ["4Gen.1.1", "bad numeric prefix"],
  ["Gen.0.1", "chapter zero"],
  ["Gen.1.0", "verse zero"],
  ["Gen.01.1", "leading-zero chapter"],
  ["Gen.1.01", "leading-zero verse"],
  ["Gen.1000.1", "4-digit chapter"],
  ["Gen.1.1000", "4-digit verse"],
  ["Gen.-1.1", "negative"],
  ["Gen.1.x", "non-numeric verse"],
  ["Gen.1.1abc", "trailing junk"],
  ["Gen.1.1.1", "extra component"],
  ["Gen..1", "empty component"],
  [" Gen.1.1", "leading whitespace"],
  ["Gen.1.1 ", "trailing whitespace"],
  ["Gen.1.1-", "dangling range"],
  ["-Gen.1.1", "dangling range"],
  ["Gen.1.1-Gen.1.2-Gen.1.3", "two separators"],
  ["Gen.1.1--Gen.1.2", "double separator"],
  ["Gen.1.1-Gen.2", "mixed verse / chapter endpoints"],
  ["Gen.1-Gen.2.1", "mixed chapter / verse endpoints"],
  ["1.1.1", "numeric RefKey is not OSIS"],
];

for (const [ref, why] of REJECT_CASES) {
  test(`parseOsis rejects ${JSON.stringify(ref)} (${why})`, () => {
    assert.equal(parseOsis(ref), null);
    assert.equal(parseOsis(ref, table), null);
  });
}

test("parseOsis with a canon rejects out-of-canon bounds that shape-only parsing accepts", () => {
  for (const ref of ["Gen.51.1", "Gen.1.32", "Gen.1.1-Gen.1.32", "Rev.22.22", "3John.1.15", "Ps.151.1"]) {
    assert.notEqual(parseOsis(ref), null, `${ref} is well-formed`);
    assert.equal(parseOsis(ref, table), null, `${ref} is outside the real canon`);
  }
  assert.equal(parseOsis("Gen.50.26", table)?.end, "1.50.26");
});

test("parseOsis with a canon rejects chapter-only refs past the canon or reversed", () => {
  assert.equal(parseOsis("Gen.51", table), null);
  assert.equal(parseOsis("Gen.5-Gen.3", table), null);
  assert.equal(parseOsis("Gen.3-Exod.1", table), null);
});

test("parseOsis never throws on non-string input", () => {
  for (const bad of [undefined, null, 42, {}, []]) {
    assert.equal(parseOsis(bad as unknown as string), null);
  }
});

// ---------------------------------------------------------------------------
// formatOsis
// ---------------------------------------------------------------------------

test("formatOsis: single verse, range, cross-chapter", () => {
  assert.equal(formatOsis(r("1.3.15", "1.3.15")), "Gen.3.15");
  assert.equal(formatOsis(r("1.3.1", "1.3.24")), "Gen.3.1-Gen.3.24");
  assert.equal(formatOsis(r("45.5.12", "45.5.21")), "Rom.5.12-Rom.5.21");
  assert.equal(formatOsis(r("1.1.1", "1.2.3")), "Gen.1.1-Gen.2.3");
});

const FORMAT_REJECTS: ReadonlyArray<readonly [string, CanonicalRangeV1]> = [
  ["reversed", r("1.3.24", "1.3.1")],
  ["reversed across chapters", r("1.4.1", "1.3.24")],
  ["cross-book", r("1.3.1", "2.1.1")],
  ["book 0", r("0.1.1", "0.1.2")],
  ["book 67", r("67.1.1", "67.1.2")],
  ["chapter-only key", r("1.3", "1.3")],
  ["malformed key", r("1.3.1x", "1.3.2")],
  ["leading zero", r("1.03.1", "1.3.2")],
  ["wrong versification", { versificationId: "other-v9" as never, start: "1.3.1", end: "1.3.2" }],
];
for (const [why, range] of FORMAT_REJECTS) {
  test(`formatOsis rejects ${why}`, () => assert.equal(formatOsis(range), null));
}

test("formatOsis with a canon rejects out-of-canon bounds", () => {
  assert.equal(formatOsis(r("1.3.1", "1.3.99")), "Gen.3.1-Gen.3.99");
  assert.equal(formatOsis(r("1.3.1", "1.3.99"), table), null);
});

test("formatOsis never throws on garbage", () => {
  for (const bad of [null, undefined, "x", 3]) {
    assert.equal(formatOsis(bad as unknown as CanonicalRangeV1), null);
  }
});

// ---------------------------------------------------------------------------
// Book table: shared with the importer, both directions, all 66
// ---------------------------------------------------------------------------

test("book table: 66 tokens, bijective with 1-66, and consistent with index.json order", () => {
  assert.equal(Object.keys(DATASET_BOOK_NUMBERS).length, 66);
  for (let n = 1; n <= 66; n += 1) {
    const token = osisBookToken(n);
    assert.ok(token, `book ${n} has a token`);
    assert.equal(osisBookNumber(token), n);
  }
  assert.equal(osisBookToken(0), undefined);
  assert.equal(osisBookToken(67), undefined);
  assert.equal(osisBookNumber("constructor"), undefined);
  assert.deepEqual(
    index.books.map((b) => b.n),
    Array.from({ length: 66 }, (_, i) => i + 1),
  );
});

test("every book, first and last real verse: parse -> format -> parse is identity and validates", () => {
  for (const book of canon) {
    const lastChapter = book.verseCounts.length;
    const lastVerse = book.verseCounts[lastChapter - 1];
    const range = r(`${book.n}.1.1`, `${book.n}.${lastChapter}.${lastVerse}`);
    assert.deepEqual(validateCanonicalRange(range, table), { ok: true });
    const text = formatOsis(range, table);
    assert.ok(text, `${book.name} formats`);
    assert.deepEqual(parseOsis(text, table), range, book.name);
  }
});

test("parseOsis(chapter) equals the whole-chapter range for EVERY chapter of the canon", () => {
  let chapters = 0;
  for (const book of canon) {
    const token = osisBookToken(book.n)!;
    book.verseCounts.forEach((verses, i) => {
      chapters += 1;
      assert.deepEqual(
        parseOsis(`${token}.${i + 1}`, table),
        r(`${book.n}.${i + 1}.1`, `${book.n}.${i + 1}.${verses}`),
      );
    });
  }
  assert.equal(chapters, index.totalChapters);
});

// ---------------------------------------------------------------------------
// Real round-trips
// ---------------------------------------------------------------------------

/** Every `passages[].osis` in design/globe-exploration/places.json (dataset commit 7eb18a5e). */
const PLACES_OSIS = [
  "Gen.2.8", "Gen.3.24", "Gen.8.4", "Gen.11.9", "Gen.10.10", "Gen.11.28", "Gen.15.7", "Gen.11.31",
  "Gen.12.4", "Gen.12.6", "Josh.24.1", "Gen.28.19", "Gen.35.1", "Gen.47.27", "Exod.8.22", "Exod.19.2",
  "Exod.19.11", "Josh.6.1", "Josh.2.1", "2Sam.5.6", "Judg.1.8", "Ruth.1.1", "1Sam.16.4", "Luke.2.4",
  "Matt.2.1", "Luke.1.26", "Luke.4.16", "Matt.4.13", "Mark.2.1", "Acts.9.3", "Acts.9.10", "Acts.11.26",
  "Acts.13.1", "Acts.16.12", "Phil.1.1", "Acts.18.1", "1Cor.1.2", "Acts.19.1", "Eph.1.1", "Acts.28.16",
  "Rom.1.7", "Rev.1.9",
];

test("places.json: all 42 refs parse, validate against the real canon, and format back to the identical string", () => {
  assert.equal(PLACES_OSIS.length, 42);
  assert.equal(new Set(PLACES_OSIS).size, 42);
  for (const ref of PLACES_OSIS) {
    const range = parseOsis(ref, table);
    assert.ok(range, `${ref} parses`);
    assert.equal(range.start, range.end, `${ref} is a single verse`);
    assert.deepEqual(validateCanonicalRange(range, table), { ok: true });
    assert.equal(formatOsis(range, table), ref);
    assert.deepEqual(parseOsis(formatOsis(range)!), range);
  }
});

test("places.json (live, when present in this checkout): embedded list is exactly its osis values", (t) => {
  const file = webPath("../design/globe-exploration/places.json");
  if (!existsSync(file)) return t.skip("design/globe-exploration/places.json not in this checkout");
  const doc = JSON.parse(readFileSync(file, "utf8")) as { places: Array<{ passages: Array<{ osis: string }> }> };
  const live = doc.places.flatMap((place) => place.passages.map((p) => p.osis));
  assert.deepEqual([...live].sort(), [...PLACES_OSIS].sort());
});

test("cross-references.txt: every distinct verse token round-trips; failures are exactly the known bad rows", () => {
  const lines = readFileSync(webPath("scripts/data/cross-references.txt"), "utf8").split("\n").slice(1);
  const tokens = new Set<string>();
  for (const line of lines) {
    const [from, to] = line.split("\t");
    if (!from || !to) continue;
    tokens.add(from);
    tokens.add(to);
  }
  let parsed = 0;
  const failed: string[] = [];
  for (const token of tokens) {
    const range = parseOsis(token, table);
    if (!range) {
      failed.push(token);
      continue;
    }
    parsed += 1;
    const text = formatOsis(range, table);
    assert.ok(text, `${token} formats`);
    assert.deepEqual(parseOsis(text, table), range, token); // equivalent range after a full cycle
    // Canonical spelling is stable: a single verse / full range re-formats to itself.
    const [a, b] = token.split("-");
    if (b === undefined || a !== b) assert.equal(text, token);
  }
  assert.ok(parsed > 30000, `parsed ${parsed} distinct tokens`);
  // The importer's own audited findings: 18 cross-book ROWS (14 distinct tokens) + one 3John.1.15 (BSB has 14 verses).
  const isCrossBook = (token: string) => {
    const [a, b] = token.split("-");
    return b !== undefined && a.split(".")[0] !== b.split(".")[0];
  };
  const crossBook = failed.filter(isCrossBook);
  assert.equal(crossBook.length, 14, `distinct cross-book tokens: ${crossBook.join(", ")}`);
  assert.deepEqual(failed.filter((t) => !isCrossBook(t)).sort(), ["3John.1.15"]);
  assert.equal(lines.filter((line) => isCrossBook(line.split("\t")[1] ?? "")).length, 18);
});
