/**
 * GRAPHEDGES-001 — tests for `scripts/lib/importCrossReferences.ts`'s pure
 * parsing/mapping logic (book-abbreviation lookup, range parsing,
 * vote-to-evidence-label mapping, the votes<=0 filter).
 *
 * Everything through the "SYNTHETIC FIXTURES" section runs against small,
 * hand-built fixtures and a small synthetic `CanonTable` — the same
 * dependency-injection discipline `tests/release-migrate.test.ts` and
 * `tests/offline-downloads.test.ts` already established for logic-vs-IO
 * separation in this repo (both read as precedent before writing this
 * file). No database connection, no network call anywhere in this file.
 *
 * The final "REAL FILE" section is a real-data regression test: it reads
 * the actual checked-in `web/scripts/data/cross-references.txt` (a
 * versioned repo asset, not a live fetch) and builds a real `CanonTable`
 * from the shipped `public/bible/BSB/*` corpus, the exact technique
 * `tests/range-v1.test.ts` already established for building a real (not
 * synthetic) `CanonTable` in a test. It pins the exact real numbers found
 * during GRAPHEDGES-001's own build (2026-09-11) so a future accidental
 * change to the parsing logic, the book map, or the checked-in data file
 * is caught immediately rather than assumed correct.
 *
 * Author: Kenneth Hill
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { buildCanonTable, type CanonTable } from "@/lib/bible/range";
import type { BookMeta } from "@/lib/contracts";

import {
  buildImportPlan,
  DATASET_BOOK_NUMBERS,
  EXPECTED_IMPORTED_ROWS,
  EXPECTED_PARSE_FAILURES,
  EXPECTED_TOTAL_DATA_ROWS,
  EXPECTED_VOTES_SKIPPED,
  evidenceLabelForVotes,
  isExpectedHeaderFormat,
  lookupBookNumber,
  mapDataRow,
  parseCrossReferenceLines,
  parseDatasetVerseToken,
  parseVerseField,
  shouldSkipForVotes,
  toValidatedCanonicalRange,
  type RawDataRow,
} from "../scripts/lib/importCrossReferences";

// ===========================================================================
// SYNTHETIC FIXTURES
// ===========================================================================

// ---------------------------------------------------------------------------
// Book abbreviation map
// ---------------------------------------------------------------------------

test("BOOK MAP: has exactly 66 entries, one per canonical book", () => {
  assert.equal(Object.keys(DATASET_BOOK_NUMBERS).length, 66);
});

test("BOOK MAP: canonical-order spot checks match the pre-verified table (dataset spelling, not this app's abbr)", () => {
  assert.equal(lookupBookNumber("Gen"), 1);
  assert.equal(lookupBookNumber("Exod"), 2); // this app's own abbr is "Ex" -- must NOT be used as the key
  assert.equal(lookupBookNumber("1Sam"), 9);
  assert.equal(lookupBookNumber("Ps"), 19);
  assert.equal(lookupBookNumber("Matt"), 40);
  assert.equal(lookupBookNumber("1Cor"), 46);
  assert.equal(lookupBookNumber("3John"), 64);
  assert.equal(lookupBookNumber("Rev"), 66);
});

test("BOOK MAP: an unknown token, this app's OWN differently-formatted abbr, and a lowercase variant all miss", () => {
  assert.equal(lookupBookNumber("Xyz"), undefined);
  assert.equal(lookupBookNumber("Ex"), undefined, "this app's own abbr ('Ex') is not the dataset's own token ('Exod')");
  assert.equal(lookupBookNumber("gen"), undefined, "lookup is case-sensitive, matching the dataset's exact casing");
});

// ---------------------------------------------------------------------------
// Verse-token parsing
// ---------------------------------------------------------------------------

test("VERSE TOKEN: a well-formed token maps to the app's own RefKey format (book.chapter.verse)", () => {
  const result = parseDatasetVerseToken("Gen.1.1");
  assert.deepEqual(result, { ok: true, refKey: "1.1.1" });
});

test("VERSE TOKEN: multi-digit chapter/verse and a numeric-prefixed book all parse correctly", () => {
  assert.deepEqual(parseDatasetVerseToken("1Kgs.11.4"), { ok: true, refKey: "11.11.4" });
  assert.deepEqual(parseDatasetVerseToken("Ps.119.176"), { ok: true, refKey: "19.119.176" });
  assert.deepEqual(parseDatasetVerseToken("3John.1.14"), { ok: true, refKey: "64.1.14" });
});

test("VERSE TOKEN: an unknown book abbreviation fails with a reason naming the unknown token", () => {
  const result = parseDatasetVerseToken("Xyz.1.1");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.reason.includes("Xyz"));
});

test("VERSE TOKEN: a zero or non-numeric chapter/verse fails, never silently coerced", () => {
  assert.equal(parseDatasetVerseToken("Gen.0.1").ok, false);
  assert.equal(parseDatasetVerseToken("Gen.1.0").ok, false);
  assert.equal(parseDatasetVerseToken("Gen.1.x").ok, false);
  assert.equal(parseDatasetVerseToken("Gen.1").ok, false, "missing verse component");
  assert.equal(parseDatasetVerseToken("Gen.1.1.1").ok, false, "too many components");
});

// ---------------------------------------------------------------------------
// "To Verse" field parsing — single verse or same-book range
// ---------------------------------------------------------------------------

test("VERSE FIELD: a single verse produces start === end", () => {
  const result = parseVerseField("Gen.1.1");
  assert.deepEqual(result, { ok: true, start: "1.1.1", end: "1.1.1" });
});

test("VERSE FIELD: a same-book range produces the correct start/end RefKeys (the task's own named mutation-proof target)", () => {
  const result = parseVerseField("John.1.1-John.1.3");
  assert.deepEqual(result, { ok: true, start: "43.1.1", end: "43.1.3" });
});

test("VERSE FIELD: a cross-chapter same-book range also parses both boundaries correctly", () => {
  const result = parseVerseField("Prov.8.22-Prov.8.30");
  assert.deepEqual(result, { ok: true, start: "20.8.22", end: "20.8.30" });
});

test("VERSE FIELD: a cross-book range parses (both halves are well-formed tokens) — rejection happens one layer up", () => {
  // Deliberately NOT rejected at this layer: parseVerseField only checks
  // each half is a well-formed verse token, exactly like the real
  // "2Chr.36.22-Ezra.1.3" rows found in the checked-in data file. Cross-book
  // rejection is toValidatedCanonicalRange's job (via validateCanonicalRange),
  // tested below, so the reason is never duplicated between the two layers.
  const result = parseVerseField("2Chr.36.22-Ezra.1.3");
  assert.deepEqual(result, { ok: true, start: "14.36.22", end: "15.1.3" });
});

test("VERSE FIELD: malformed range shapes (empty half, double hyphen, one bad half) all fail", () => {
  assert.equal(parseVerseField("").ok, false);
  assert.equal(parseVerseField("Gen.1.1-").ok, false);
  assert.equal(parseVerseField("-Gen.1.1").ok, false);
  assert.equal(parseVerseField("Gen.1.1-Gen.1.2-Gen.1.3").ok, false);
  const badEnd = parseVerseField("Gen.1.1-Xyz.1.1");
  assert.equal(badEnd.ok, false);
});

// ---------------------------------------------------------------------------
// toValidatedCanonicalRange — a small synthetic CanonTable
// ---------------------------------------------------------------------------

/** Gen 1 (31v), Exod 1 (22v), John 1 (51v), Prov 8 (36v) — just enough real-shaped bounds to exercise every rejection path. */
function testCanon(): CanonTable {
  const chapters = new Map<number, number>([
    [1, 50], // Gen
    [2, 40], // Exod
    [20, 31], // Prov
    [43, 21], // John
  ]);
  const verses = new Map<string, number>([
    ["1.1", 31],
    ["2.1", 22],
    ["20.8", 36],
    ["43.1", 51],
  ]);
  return {
    chapterCount: (book) => chapters.get(book),
    verseCount: (book, chapter) => verses.get(`${book}.${chapter}`),
  };
}

test("CANONICAL RANGE: a valid same-book, in-bounds range passes through unchanged", () => {
  const canon = testCanon();
  const result = toValidatedCanonicalRange("43.1.1", "43.1.3", canon);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.range, { versificationId: "eng-protestant-66-31102-v1", start: "43.1.1", end: "43.1.3" });
});

test("CANONICAL RANGE: a cross-book range is rejected (the real 18-row discrepancy this task found)", () => {
  const canon = testCanon();
  const result = toValidatedCanonicalRange("1.50.1", "2.1.1", canon);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.reason.includes("cross-book"));
});

test("CANONICAL RANGE: an out-of-bounds verse is rejected (the real 3John.1.15-vs-14-verses discrepancy this task found)", () => {
  const canon = testCanon();
  // John 1 only has 51 verses in this synthetic canon.
  const result = toValidatedCanonicalRange("43.1.52", "43.1.52", canon);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.reason.includes("out-of-bounds") || result.reason.includes("verses"));
});

test("CANONICAL RANGE: a reversed range (end before start) is rejected", () => {
  const canon = testCanon();
  const result = toValidatedCanonicalRange("43.1.10", "43.1.1", canon);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.reason.includes("reversed"));
});

// ---------------------------------------------------------------------------
// Votes -> skip / evidence label — mutation-proving the votes<=0 filter
// ---------------------------------------------------------------------------

test("VOTES FILTER: exactly the boundary — 0 is skipped, 1 is not (kills an off-by-one `< 0` mutant)", () => {
  assert.equal(shouldSkipForVotes(0), true);
  assert.equal(shouldSkipForVotes(1), false);
});

test("VOTES FILTER: negative votes are skipped (real data has these -- min observed -86)", () => {
  assert.equal(shouldSkipForVotes(-1), true);
  assert.equal(shouldSkipForVotes(-86), true);
});

test("VOTES FILTER: comfortably positive votes are never skipped (kills a mutant that inverts the whole comparison or hardcodes true)", () => {
  assert.equal(shouldSkipForVotes(1), false);
  assert.equal(shouldSkipForVotes(50), false);
  assert.equal(shouldSkipForVotes(1291), false);
});

test("EVIDENCE LABEL: exactly the 49/50 boundary (kills an off-by-one `> 50` or `>= 51` mutant)", () => {
  assert.equal(evidenceLabelForVotes(49), "plausible");
  assert.equal(evidenceLabelForVotes(50), "strong");
});

test("EVIDENCE LABEL: never returns 'explicit' or 'devotional' across a wide sample of vote counts", () => {
  for (const votes of [1, 2, 10, 49, 50, 51, 100, 1291]) {
    const label = evidenceLabelForVotes(votes);
    assert.ok(label === "strong" || label === "plausible", `votes=${votes} produced "${label}"`);
  }
});

// ---------------------------------------------------------------------------
// Header format
// ---------------------------------------------------------------------------

test("HEADER: the real OpenBible.info header format is recognized", () => {
  assert.equal(isExpectedHeaderFormat("From Verse\tTo Verse\tVotes\t#www.openbible.info CC-BY 2026-09-07"), true);
});

test("HEADER: an unrelated or reordered header is rejected", () => {
  assert.equal(isExpectedHeaderFormat("From Verse\tTo Verse\tVotes"), false);
  assert.equal(isExpectedHeaderFormat("Votes\tFrom Verse\tTo Verse"), false);
  assert.equal(isExpectedHeaderFormat(""), false);
});

// ---------------------------------------------------------------------------
// Raw line parsing
// ---------------------------------------------------------------------------

test("LINE PARSE: line numbers count the header as line 1, matching a text editor / grep -n", () => {
  const lines = [
    "From Verse\tTo Verse\tVotes\t#www.openbible.info CC-BY 2026-09-07",
    "Gen.1.1\tExod.20.11\t154",
    "Gen.1.1\tJer.51.15\t89",
  ];
  const { rows } = parseCrossReferenceLines(lines);
  assert.equal(rows[0].lineNumber, 2);
  assert.equal(rows[1].lineNumber, 3);
});

test("LINE PARSE: too few tab-separated fields is a malformed line, not a silently-dropped one", () => {
  const lines = ["header", "Gen.1.1\tExod.20.11"];
  const { rows, malformed } = parseCrossReferenceLines(lines);
  assert.equal(rows.length, 0);
  assert.equal(malformed.length, 1);
  assert.equal(malformed[0].lineNumber, 2);
  assert.ok(malformed[0].reason.includes("3 tab-separated fields"));
});

test("LINE PARSE: a non-numeric votes field is a malformed line", () => {
  const lines = ["header", "Gen.1.1\tExod.20.11\tmany"];
  const { malformed } = parseCrossReferenceLines(lines);
  assert.equal(malformed.length, 1);
  assert.ok(malformed[0].reason.includes("many"));
});

test("LINE PARSE: a trailing blank line at EOF is tolerated, not reported as malformed", () => {
  const lines = ["header", "Gen.1.1\tExod.20.11\t154", ""];
  const { rows, malformed } = parseCrossReferenceLines(lines);
  assert.equal(rows.length, 1);
  assert.equal(malformed.length, 0);
});

test("LINE PARSE: negative and zero votes both parse as valid integers (filtering happens downstream, not here)", () => {
  const lines = ["header", "Gen.1.1\tExod.20.11\t0", "Gen.1.1\tExod.20.11\t-5"];
  const { rows, malformed } = parseCrossReferenceLines(lines);
  assert.equal(malformed.length, 0);
  assert.deepEqual(rows.map((r) => r.votes), [0, -5]);
});

// ---------------------------------------------------------------------------
// mapDataRow / buildImportPlan — the full pure pipeline, mutation-proven
// ---------------------------------------------------------------------------

function row(overrides: Partial<RawDataRow>): RawDataRow {
  return { lineNumber: 1, fromVerse: "Gen.1.1", toVerse: "Gen.1.1", votes: 10, ...overrides };
}

test("MAP ROW: votes<=0 is checked BEFORE range parsing -- a disputed row with a malformed range is 'skip-votes', never 'failure'", () => {
  const canon = testCanon();
  const result = mapDataRow(row({ fromVerse: "Xyz.1.1", votes: 0 }), canon);
  assert.deepEqual(result, { kind: "skip-votes" });
});

test("MAP ROW: a valid single-verse-to-single-verse row imports with the correct evidence label", () => {
  const canon = testCanon();
  const plausible = mapDataRow(row({ fromVerse: "Gen.1.1", toVerse: "Exod.1.1", votes: 10 }), canon);
  assert.equal(plausible.kind, "import");
  if (plausible.kind !== "import") return;
  assert.deepEqual(plausible.edge, {
    fromRange: { versificationId: "eng-protestant-66-31102-v1", start: "1.1.1", end: "1.1.1" },
    toRange: { versificationId: "eng-protestant-66-31102-v1", start: "2.1.1", end: "2.1.1" },
    type: "parallel",
    evidenceLabel: "plausible",
    communityVotes: 10,
  });

  const strong = mapDataRow(row({ fromVerse: "Gen.1.1", toVerse: "Exod.1.1", votes: 75 }), canon);
  assert.equal(strong.kind, "import");
  if (strong.kind !== "import") return;
  assert.equal(strong.edge.evidenceLabel, "strong");
  assert.equal(strong.edge.communityVotes, 75);
});

test("MAP ROW: a same-book range in 'To Verse' produces the correct start/end RefKeys (task's own named mutation-proof target)", () => {
  const canon = testCanon();
  const result = mapDataRow(row({ fromVerse: "Gen.1.1", toVerse: "Prov.8.22-Prov.8.30", votes: 5 }), canon);
  assert.equal(result.kind, "import");
  if (result.kind !== "import") return;
  assert.deepEqual(result.edge.toRange, {
    versificationId: "eng-protestant-66-31102-v1",
    start: "20.8.22",
    end: "20.8.30",
  });
});

test("MAP ROW: an unknown book abbreviation is a failure, never silently skipped or imported", () => {
  const canon = testCanon();
  const result = mapDataRow(row({ fromVerse: "Xyz.1.1", votes: 5 }), canon);
  assert.equal(result.kind, "failure");
});

test("MAP ROW: a cross-book 'To Verse' range is a failure, never imported with a truncated/guessed range", () => {
  const canon = testCanon();
  const result = mapDataRow(row({ fromVerse: "Gen.1.1", toVerse: "Gen.50.1-Exod.1.1", votes: 5 }), canon);
  assert.equal(result.kind, "failure");
  if (result.kind !== "failure") return;
  assert.ok(result.reason.includes("cross-book"));
});

test("BUILD PLAN: rows are correctly bucketed into skippedVotes / failures / toImport, and rowsRead always equals the sum of all three", () => {
  const canon = testCanon();
  const rows: RawDataRow[] = [
    row({ lineNumber: 2, votes: 0 }), // skip-votes
    row({ lineNumber: 3, votes: -5 }), // skip-votes
    row({ lineNumber: 4, fromVerse: "Gen.1.1", toVerse: "Exod.1.1", votes: 10 }), // import, plausible
    row({ lineNumber: 5, fromVerse: "Gen.1.1", toVerse: "Exod.1.1", votes: 75 }), // import, strong
    row({ lineNumber: 6, fromVerse: "Gen.1.1", toVerse: "John.1.1-John.1.3", votes: 3 }), // import, range
    row({ lineNumber: 7, fromVerse: "Xyz.1.1", toVerse: "Gen.1.1", votes: 5 }), // failure: unknown book
    row({ lineNumber: 8, fromVerse: "Gen.1.1", toVerse: "Gen.50.1-Exod.1.1", votes: 5 }), // failure: cross-book
    row({ lineNumber: 9, fromVerse: "Gen.1.1", toVerse: "John.1.3-John.1.1", votes: 5 }), // failure: reversed same-book range (end verse before start verse)
  ];

  const plan = buildImportPlan(rows, canon);

  assert.equal(plan.rowsRead, rows.length);
  assert.equal(plan.skippedVotes, 2);
  assert.equal(plan.failures.length, 3);
  assert.deepEqual(plan.failures.map((f) => f.lineNumber), [7, 8, 9]);
  assert.equal(plan.toImport.length, 3);
  assert.equal(plan.rowsRead, plan.skippedVotes + plan.failures.length + plan.toImport.length);

  assert.deepEqual(
    plan.toImport.map((edge) => edge.evidenceLabel),
    ["plausible", "strong", "plausible"],
  );
});

// ===========================================================================
// REAL FILE — parses the actual checked-in dataset end to end, against the
// real BSB CanonTable. Pins the exact numbers Claude found on 2026-09-11.
// ===========================================================================

async function buildRealCanonTable(): Promise<CanonTable> {
  const bibleDir = path.join(process.cwd(), "public", "bible");
  const index = JSON.parse(await readFile(path.join(bibleDir, "index.json"), "utf8")) as { books: BookMeta[] };
  const verseCounts = new Map<string, number>();
  await Promise.all(
    index.books.map(async (book) => {
      const data = JSON.parse(await readFile(path.join(bibleDir, "BSB", `${book.n}.json`), "utf8")) as {
        c: unknown[][];
      };
      data.c.forEach((verses, i) => verseCounts.set(`${book.n}.${i + 1}`, verses.length));
    }),
  );
  return buildCanonTable(index.books, (b, c) => verseCounts.get(`${b}.${c}`));
}

test("REAL FILE: the checked-in cross-references.txt has exactly the expected header and row count", async () => {
  const raw = await readFile(path.join(process.cwd(), "scripts", "data", "cross-references.txt"), "utf8");
  const lines = raw.split("\n").map((line) => line.replace(/\r$/, ""));
  const { header, rows, malformed } = parseCrossReferenceLines(lines);

  assert.equal(isExpectedHeaderFormat(header), true, `unexpected header: "${header}"`);
  assert.equal(malformed.length, 0);
  assert.equal(rows.length, EXPECTED_TOTAL_DATA_ROWS);
});

test("REAL FILE: buildImportPlan against the real data + real BSB CanonTable matches the exact numbers found during this task's own build", async () => {
  const canon = await buildRealCanonTable();
  const raw = await readFile(path.join(process.cwd(), "scripts", "data", "cross-references.txt"), "utf8");
  const lines = raw.split("\n").map((line) => line.replace(/\r$/, ""));
  const { rows } = parseCrossReferenceLines(lines);

  const plan = buildImportPlan(rows, canon);

  assert.equal(plan.rowsRead, EXPECTED_TOTAL_DATA_ROWS);
  assert.equal(plan.skippedVotes, EXPECTED_VOTES_SKIPPED);
  assert.equal(plan.failures.length, EXPECTED_PARSE_FAILURES);
  assert.equal(plan.toImport.length, EXPECTED_IMPORTED_ROWS);
  assert.equal(plan.rowsRead, plan.skippedVotes + plan.failures.length + plan.toImport.length);

  // The specific known failures, named so a regression names exactly what
  // broke rather than only a changed count.
  const byLine = new Map(plan.failures.map((f) => [f.lineNumber, f.reason]));
  assert.ok(byLine.get(30651)?.includes("cross-book"), "line 30651 (Num.3.1 -> Lev.27.34-Num.1.1) should fail as cross-book");
  assert.ok(
    byLine.get(337770)?.includes("out-of-bounds") || byLine.get(337770)?.includes("verses"),
    "line 337770 (3John.1.15 -> John.10.3) should fail as an out-of-bounds From Verse",
  );

  const strongCount = plan.toImport.filter((edge) => edge.evidenceLabel === "strong").length;
  const plausibleCount = plan.toImport.filter((edge) => edge.evidenceLabel === "plausible").length;
  assert.equal(strongCount, 4457);
  assert.equal(plausibleCount, 336766);
  assert.equal(strongCount + plausibleCount, EXPECTED_IMPORTED_ROWS);

  // Every imported row is "parallel" -- no automated fine-grained
  // classification, per the registered task's explicit scope boundary.
  assert.ok(plan.toImport.every((edge) => edge.type === "parallel"));
});
