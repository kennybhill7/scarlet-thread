/**
 * GRAPHEDGES-001 — pure parsing/mapping logic for importing OpenBible.info's
 * cross-reference dataset (CC BY 4.0, `web/scripts/data/cross-references.txt`,
 * checked into the repo as a real, versioned data asset — see that script's
 * own header for the download/licensing provenance) into the curated
 * `graph_edges` table (`db/schema.ts`, BUILD_PLAN.md §3.3).
 *
 * Every function in this file is pure — no `fs`, no network, no DB — so
 * `tests/import-cross-references.test.ts` can exercise it with small
 * fixture inputs and dependency injection, the same discipline
 * `scripts/lib/releaseMigrate.ts`/`tests/release-migrate.test.ts` already
 * established for `scripts/release-migrate.mts`, and
 * `tests/offline-downloads.test.ts` established for logic-vs-IO separation
 * generally. The one piece of real-world data this needs — how many
 * chapters/verses each book really has — is never hardcoded here: callers
 * inject a `CanonTable` (the same contract `lib/bible/range.ts` already
 * defines and `validateCanonicalRange` already uses to construct/validate
 * every `CanonicalRangeV1` in this codebase — this module deliberately
 * reuses that function rather than re-implementing cross-book/bounds
 * checking a second time). The real file read, the real `CanonTable` built
 * from the shipped `public/bible/*` corpus, and the real DB writes all live
 * in `scripts/import-cross-references.mts` — never here.
 */

import { verseKey } from "@/lib/bible/reference";
import { type CanonTable, validateCanonicalRange } from "@/lib/bible/range";
import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import type { RefKey } from "@/lib/contracts";
import type { EvidenceLabel } from "@/lib/contracts/study-v2";

// ---------------------------------------------------------------------------
// Real-file shape constants (Claude verified these directly against its own
// 2026-09-11 download of https://a.openbible.info/data/cross-references.zip
// before writing this file — see the import script's header for the full
// verification). Used only as informational sanity checks by the real
// script; never enforced as a hard assertion inside this pure module.
// ---------------------------------------------------------------------------

/** `344,756` data rows (345,757 lines including the header) in the real file. */
export const EXPECTED_TOTAL_DATA_ROWS = 344_756;
/** Rows with `Votes <= 0` — genuinely community-disputed pairs. */
export const EXPECTED_VOTES_SKIPPED = 3_514;
/**
 * Two DIFFERENT real discrepancies from the registered GRAPHEDGES-001
 * task's claims, both found by re-verifying against the actual 2026-09-11
 * download through this file's own `buildImportPlan` (routed through the
 * real `CanonTable` built from `public/bible/BSB/*`) rather than trusting
 * either claim blindly — exactly what the task asked for, given this
 * touches 340k+ rows:
 *
 *  1. **18 cross-book "To Verse" ranges** (e.g. `2Chr.36.22-Ezra.1.3`,
 *     `2John.1.1-3John.1.15`) — the task claimed zero. `CanonicalRangeV1`
 *     cannot represent a cross-book range (`lib/bible/range.ts`: "cross-book
 *     is never valid"), so these are parse failures, not imports.
 *  2. **1 out-of-bounds "From Verse"**: line 337770 is
 *     `3John.1.15\tJohn.10.3\t1` — verse 15 of 3 John. This app's shipped
 *     BSB corpus (`public/bible/BSB/64.json`) gives 3 John exactly 14
 *     verses; OpenBible's own source data apparently follows a versification
 *     tradition that splits 3 John's final verse into two (14 and 15) where
 *     BSB does not — the same class of translation/versification divergence
 *     `lib/bible/versemap.ts`'s `DIVERGENT_VERSIONS` already documents for
 *     SBL's Romans 14/16, just landing on the *source dataset's own*
 *     versification instead of a bundled translation's. The task brief
 *     never anticipated this one at all; it is not a task-brief
 *     discrepancy, it is a genuinely new finding from this file's own
 *     bounds-checking (`validateCanonicalRange` against the real corpus).
 *
 * Total real parse failures: 19 (not the task's implied 18, and not the 0
 * the "always a single verse" claim about "From Verse" would suggest either
 * — the malformed thing here is the cited verse *number*, not its shape).
 */
export const EXPECTED_PARSE_FAILURES = 19;
/** `EXPECTED_TOTAL_DATA_ROWS - EXPECTED_VOTES_SKIPPED - EXPECTED_PARSE_FAILURES`. */
export const EXPECTED_IMPORTED_ROWS = 341_223;

/** The real header line's shape: `From Verse\tTo Verse\tVotes\t#www.openbible.info CC-BY <date>`. */
const HEADER_RE = /^From Verse\tTo Verse\tVotes\t#www\.openbible\.info CC-BY \d{4}-\d{2}-\d{2}$/;

export function isExpectedHeaderFormat(header: string): boolean {
  return HEADER_RE.test(header);
}

// ---------------------------------------------------------------------------
// Book abbreviations — the dataset's own token spellings, mapped to this
// app's canonical book numbers (1-66) by canonical order (matching
// `web/public/bible/index.json`'s own `n` field), per the pre-verified table
// in the registered GRAPHEDGES-001 task — NOT by string-matching
// index.json's differently-formatted `abbr` field (dataset "Exod" vs this
// app's "Ex", dataset "1Kgs" vs this app's "1 Kgs" formatting, etc).
//
// Re-verified directly against the real downloaded cross-references.txt on
// 2026-09-11: the file's distinct book tokens across BOTH the "From Verse"
// and "To Verse" columns are exactly these 66 keys, no more, no fewer.
// ---------------------------------------------------------------------------
export const DATASET_BOOK_NUMBERS: Readonly<Record<string, number>> = Object.freeze({
  Gen: 1,
  Exod: 2,
  Lev: 3,
  Num: 4,
  Deut: 5,
  Josh: 6,
  Judg: 7,
  Ruth: 8,
  "1Sam": 9,
  "2Sam": 10,
  "1Kgs": 11,
  "2Kgs": 12,
  "1Chr": 13,
  "2Chr": 14,
  Ezra: 15,
  Neh: 16,
  Esth: 17,
  Job: 18,
  Ps: 19,
  Prov: 20,
  Eccl: 21,
  Song: 22,
  Isa: 23,
  Jer: 24,
  Lam: 25,
  Ezek: 26,
  Dan: 27,
  Hos: 28,
  Joel: 29,
  Amos: 30,
  Obad: 31,
  Jonah: 32,
  Mic: 33,
  Nah: 34,
  Hab: 35,
  Zeph: 36,
  Hag: 37,
  Zech: 38,
  Mal: 39,
  Matt: 40,
  Mark: 41,
  Luke: 42,
  John: 43,
  Acts: 44,
  Rom: 45,
  "1Cor": 46,
  "2Cor": 47,
  Gal: 48,
  Eph: 49,
  Phil: 50,
  Col: 51,
  "1Thess": 52,
  "2Thess": 53,
  "1Tim": 54,
  "2Tim": 55,
  Titus: 56,
  Phlm: 57,
  Heb: 58,
  Jas: 59,
  "1Pet": 60,
  "2Pet": 61,
  "1John": 62,
  "2John": 63,
  "3John": 64,
  Jude: 65,
  Rev: 66,
});

export function lookupBookNumber(token: string): number | undefined {
  return DATASET_BOOK_NUMBERS[token];
}

// ---------------------------------------------------------------------------
// Verse-token parsing — "Gen.1.1" -> RefKey "1.1.1" (`lib/bible/reference.ts`'s
// own `verseKey()`, reused rather than reinvented per the registered task).
// ---------------------------------------------------------------------------

export type VerseTokenParseResult = { ok: true; refKey: RefKey } | { ok: false; reason: string };

/** Anchored `Book.chapter.verse`, e.g. "Gen.1.1", "1Kgs.11.4". */
const DATASET_VERSE_TOKEN_RE = /^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)$/;

export function parseDatasetVerseToken(token: string): VerseTokenParseResult {
  const match = DATASET_VERSE_TOKEN_RE.exec(token);
  if (!match) {
    return { ok: false, reason: `"${token}" is not a well-formed "Book.chapter.verse" token` };
  }
  const [, bookToken, chapterStr, verseStr] = match;
  const book = lookupBookNumber(bookToken);
  if (book === undefined) {
    return { ok: false, reason: `unknown book abbreviation "${bookToken}" in token "${token}"` };
  }
  const chapter = Number(chapterStr);
  const verse = Number(verseStr);
  if (!Number.isInteger(chapter) || chapter < 1 || !Number.isInteger(verse) || verse < 1) {
    return { ok: false, reason: `"${token}" has a non-positive-integer chapter or verse` };
  }
  return { ok: true, refKey: verseKey(book, chapter, verse) };
}

// ---------------------------------------------------------------------------
// "To Verse" field parsing — a single verse OR a same-book range
// "John.1.1-John.1.3". Cross-book ranges parse successfully at this layer
// (both halves are well-formed verse tokens); the cross-book rejection
// happens one layer up, in `toValidatedCanonicalRange`, via
// `validateCanonicalRange` — so that rejection reason is never duplicated.
// ---------------------------------------------------------------------------

export type VerseFieldParseResult =
  | { ok: true; start: RefKey; end: RefKey }
  | { ok: false; reason: string };

export function parseVerseField(field: string): VerseFieldParseResult {
  const parts = field.split("-");
  if (parts.length === 1) {
    const parsed = parseDatasetVerseToken(parts[0]);
    if (!parsed.ok) return parsed;
    return { ok: true, start: parsed.refKey, end: parsed.refKey };
  }
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
    return { ok: false, reason: `"${field}" is not a well-formed single verse or "start-end" range` };
  }
  const start = parseDatasetVerseToken(parts[0]);
  if (!start.ok) return start;
  const end = parseDatasetVerseToken(parts[1]);
  if (!end.ok) return end;
  return { ok: true, start: start.refKey, end: end.refKey };
}

/**
 * Builds a `CanonicalRangeV1` from two already-parsed RefKeys and validates
 * it against the real canon via `lib/bible/range.ts`'s own
 * `validateCanonicalRange` — the single place this codebase constructs or
 * validates one of these (per that module's own header comment). Catches
 * cross-book ranges (the 18 real rows found in `web/scripts/data/
 * cross-references.txt`'s "To Verse" column — see
 * `EXPECTED_CROSS_BOOK_RANGE_FAILURES` above), out-of-bounds chapters/verses,
 * and reversed ranges, without re-implementing any of that here.
 */
export function toValidatedCanonicalRange(
  start: RefKey,
  end: RefKey,
  canon: CanonTable,
): { ok: true; range: CanonicalRangeV1 } | { ok: false; reason: string } {
  const range: CanonicalRangeV1 = { versificationId: CANONICAL_VERSIFICATION_ID, start, end };
  const validation = validateCanonicalRange(range, canon);
  if (!validation.ok) {
    return { ok: false, reason: `[${validation.reason}] ${validation.detail}` };
  }
  return { ok: true, range };
}

// ---------------------------------------------------------------------------
// Votes -> skip / evidence label
// ---------------------------------------------------------------------------

/** `Votes <= 0` rows are genuinely community-disputed pairs — never imported. */
export function shouldSkipForVotes(votes: number): boolean {
  return votes <= 0;
}

/**
 * `>= 50` votes -> "strong", `1-49` -> "plausible". Never called for
 * `votes <= 0` (callers must check `shouldSkipForVotes` first). Never
 * returns `"explicit"` (reserved for a verified direct textual
 * quotation/reference this bulk import has not confirmed) or `"devotional"`
 * (reserved for `personal_resonance` connections, which this import never
 * produces — every imported row's `type` is `"parallel"`).
 */
export function evidenceLabelForVotes(votes: number): EvidenceLabel {
  return votes >= 50 ? "strong" : "plausible";
}

// ---------------------------------------------------------------------------
// Raw line parsing — pure, takes an array of already-read lines (never a
// file path); the .mts script does the real `fs.readFile` + line split.
// ---------------------------------------------------------------------------

export interface RawDataRow {
  lineNumber: number;
  fromVerse: string;
  toVerse: string;
  votes: number;
}

export interface RawLineFailure {
  lineNumber: number;
  line: string;
  reason: string;
}

export interface ParsedDataFile {
  header: string;
  rows: RawDataRow[];
  malformed: RawLineFailure[];
}

/**
 * Splits each non-header, non-blank line on tabs into `{fromVerse, toVerse,
 * votes}`. `lineNumber` is 1-based and counts the header as line 1, matching
 * how a text editor or `grep -n` would number the same file — so a printed
 * failure can be found by eye in `web/scripts/data/cross-references.txt`.
 */
export function parseCrossReferenceLines(lines: readonly string[]): ParsedDataFile {
  const [header, ...rest] = lines;
  const rows: RawDataRow[] = [];
  const malformed: RawLineFailure[] = [];

  rest.forEach((line, index) => {
    const lineNumber = index + 2;
    if (line.trim() === "") return; // tolerate one trailing blank line at EOF

    const parts = line.split("\t");
    if (parts.length < 3) {
      malformed.push({
        lineNumber,
        line,
        reason: `expected at least 3 tab-separated fields ("From Verse", "To Verse", "Votes"), got ${parts.length}`,
      });
      return;
    }

    const [fromVerse, toVerse, votesRaw] = parts;
    const votes = Number(votesRaw);
    if (!Number.isFinite(votes) || !Number.isInteger(votes)) {
      malformed.push({ lineNumber, line, reason: `"${votesRaw}" is not a well-formed integer vote count` });
      return;
    }

    rows.push({ lineNumber, fromVerse, toVerse, votes });
  });

  return { header: header ?? "", rows, malformed };
}

// ---------------------------------------------------------------------------
// Top-level row mapping + import plan
// ---------------------------------------------------------------------------

export interface GraphEdgeImportRow {
  fromRange: CanonicalRangeV1;
  toRange: CanonicalRangeV1;
  type: "parallel";
  evidenceLabel: EvidenceLabel;
  communityVotes: number;
}

export interface ImportFailure {
  lineNumber: number;
  reason: string;
}

export type MapRowResult =
  | { kind: "skip-votes" }
  | { kind: "failure"; reason: string }
  | { kind: "import"; edge: GraphEdgeImportRow };

/**
 * Maps one already-parsed data row to a skip / failure / import decision.
 * Order matters and is deliberate: the votes<=0 filter runs BEFORE any
 * range parsing, so a disputed row with a malformed range is still counted
 * as "skipped (votes)", not "failure" — disputed rows were never going to
 * be imported regardless of whether their range happens to parse.
 */
export function mapDataRow(row: RawDataRow, canon: CanonTable): MapRowResult {
  if (shouldSkipForVotes(row.votes)) {
    return { kind: "skip-votes" };
  }

  const from = parseDatasetVerseToken(row.fromVerse);
  if (!from.ok) return { kind: "failure", reason: `From Verse: ${from.reason}` };

  const to = parseVerseField(row.toVerse);
  if (!to.ok) return { kind: "failure", reason: `To Verse: ${to.reason}` };

  const fromRangeResult = toValidatedCanonicalRange(from.refKey, from.refKey, canon);
  if (!fromRangeResult.ok) {
    return { kind: "failure", reason: `From Verse range: ${fromRangeResult.reason}` };
  }
  const toRangeResult = toValidatedCanonicalRange(to.start, to.end, canon);
  if (!toRangeResult.ok) {
    return { kind: "failure", reason: `To Verse range: ${toRangeResult.reason}` };
  }

  return {
    kind: "import",
    edge: {
      fromRange: fromRangeResult.range,
      toRange: toRangeResult.range,
      type: "parallel",
      evidenceLabel: evidenceLabelForVotes(row.votes),
      communityVotes: row.votes,
    },
  };
}

export interface ImportPlan {
  rowsRead: number;
  skippedVotes: number;
  failures: ImportFailure[];
  toImport: GraphEdgeImportRow[];
}

/**
 * Builds the full import plan from every parsed data row. Pure — no DB, no
 * IDs assigned (the repository layer, `lib/db/graphEdges.ts`, assigns
 * `id`/`createdAt` at insert time). This is the single function
 * `tests/import-cross-references.test.ts` mutation-proves the votes<=0
 * filter and range-parsing logic through.
 */
export function buildImportPlan(rows: readonly RawDataRow[], canon: CanonTable): ImportPlan {
  const failures: ImportFailure[] = [];
  const toImport: GraphEdgeImportRow[] = [];
  let skippedVotes = 0;

  for (const row of rows) {
    const result = mapDataRow(row, canon);
    if (result.kind === "skip-votes") {
      skippedVotes += 1;
    } else if (result.kind === "failure") {
      failures.push({ lineNumber: row.lineNumber, reason: result.reason });
    } else {
      toImport.push(result.edge);
    }
  }

  return { rowsRead: rows.length, skippedVotes, failures, toImport };
}
