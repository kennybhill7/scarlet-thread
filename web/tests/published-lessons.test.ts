/**
 * RELEASEREADER-001 — `lib/content/publishedLessons.ts`'s pure logic:
 * heading-block section extraction, runtime `bundle` shape validation, and
 * range-containment lesson selection. No database access anywhere in this
 * file — every case below is exercised against small, hand-built,
 * OBVIOUSLY SYNTHETIC fixtures (never real lesson content), the same
 * logic-vs-IO discipline `tests/content-build.test.ts` (CONTENTPIPE-001)
 * already established for `scripts/content/build.ts`'s own pure half.
 *
 * MUTATION PROOFS (see the block comment at the bottom of this file for the
 * full narrative): two real mutations were applied directly to
 * `lib/content/publishedLessons.ts` (an ownedPath here), `npm test` was run
 * and confirmed the named tests below FAILING, the file was restored from a
 * backup made before each mutation, `diff` confirmed it byte-identical to
 * the pre-mutation original, and `npm test` was re-run and confirmed green
 * again.
 *
 * Author: Kenneth Hill
 */
import assert from "node:assert/strict";
import test from "node:test";

import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import type { LessonFrontmatter } from "@/scripts/content/schema";
import type { ReleaseBundle } from "@/scripts/content/build";
import {
  extractHeadingProse,
  findHeadingBlockLines,
  findLessonMatchingRange,
  findPublishedLessonForRange,
  parseReleaseBundle,
} from "@/lib/content/publishedLessons";

// ---------------------------------------------------------------------------
// Fixtures — obviously synthetic, scoped to this test file only.
// ---------------------------------------------------------------------------

function range(start: string, end: string): CanonicalRangeV1 {
  return { versificationId: CANONICAL_VERSIFICATION_ID, start, end };
}

function fixtureFrontmatter(overrides: Partial<LessonFrontmatter> = {}): LessonFrontmatter {
  return {
    passage: range("1.3.1", "1.3.24"),
    stage: 3,
    methodFocus: "Observation vs. inference (SYNTHETIC FIXTURE, not real lesson content)",
    connectionIds: [],
    positionIds: [],
    sources: [],
    author: "Kenneth Hill",
    status: "draft",
    ...overrides,
  };
}

function fixtureBundle(lessons: ReleaseBundle["lessons"]): ReleaseBundle {
  return { schemaVersion: 1, lessonCount: Object.keys(lessons).length, lessons };
}

const SYNTHETIC_BODY_BOTH_SECTIONS = [
  "# Test Fixture Lesson (synthetic, not real content)",
  "",
  "Some intro prose.",
  "",
  "## Context",
  "",
  "Synthetic context prose, line one.",
  "Synthetic context prose, line two.",
  "",
  "## Positions",
  "",
  "- View A (synthetic): some fictional tradition holds X.",
  "- View B (synthetic): some fictional tradition holds Y.",
  "",
  "## Some Other Heading",
  "",
  "This should never leak into either extracted section.",
].join("\n");

/** LESSONSHAPE-001 — the same synthetic fixture shape, extended with all
 * three new headings this task adds (`## Literary Design`,
 * `## Practice Bridge Example`, `## Teach-Back Prompts`), so
 * `findLessonMatchingRange`'s wiring for the three new `PublishedLessonMatch`
 * fields can be proven against one lesson body carrying real content under
 * every heading at once. */
const SYNTHETIC_BODY_ALL_SECTIONS = [
  "# Test Fixture Lesson (synthetic, not real content)",
  "",
  "Some intro prose.",
  "",
  "## Context",
  "",
  "Synthetic context prose.",
  "",
  "## Positions",
  "",
  "- View A (synthetic): some fictional tradition holds X.",
  "",
  "## Literary Design",
  "",
  "Synthetic literary design prose, noting a fictional chiasm.",
  "",
  "## Practice Bridge Example",
  "",
  "Synthetic worked bridge example, original meaning to modern situation.",
  "",
  "## Teach-Back Prompts",
  "",
  "1. Synthetic blind-explain prompt.",
  "2. Synthetic five-minute-outline prompt.",
].join("\n");

// ===========================================================================
// findHeadingBlockLines / extractHeadingProse — the generalized
// "Positions"-block technique from scripts/content/validate.ts's
// findPositionsBlockLines, parameterized by heading text.
// ===========================================================================

test("extractHeadingProse: extracts Context prose, excluding the heading line itself, stopping at the next ## heading", () => {
  const prose = extractHeadingProse(SYNTHETIC_BODY_BOTH_SECTIONS, "Context");
  assert.equal(prose, "Synthetic context prose, line one.\nSynthetic context prose, line two.");
  assert.ok(!prose?.includes("## Context"), "the heading line itself must not appear in the extracted prose");
});

test("extractHeadingProse: extracts Positions prose independently of Context, using the identical technique", () => {
  const prose = extractHeadingProse(SYNTHETIC_BODY_BOTH_SECTIONS, "Positions");
  assert.equal(
    prose,
    "- View A (synthetic): some fictional tradition holds X.\n- View B (synthetic): some fictional tradition holds Y.",
  );
});

test("extractHeadingProse: content under an unrelated ## heading never leaks into Context or Positions", () => {
  assert.ok(!extractHeadingProse(SYNTHETIC_BODY_BOTH_SECTIONS, "Context")?.includes("Some Other Heading"));
  assert.ok(!extractHeadingProse(SYNTHETIC_BODY_BOTH_SECTIONS, "Positions")?.includes("Some Other Heading"));
});

test("extractHeadingProse: returns null (not an empty string) when the heading is entirely absent -- a lesson may validly have neither section", () => {
  const body = "# Fixture\n\nJust some prose, no ## Context or ## Positions heading at all.";
  assert.equal(extractHeadingProse(body, "Context"), null);
  assert.equal(extractHeadingProse(body, "Positions"), null);
});

test("extractHeadingProse: a bare heading with only blank lines under it returns null, not an empty string", () => {
  const body = "## Context\n\n\n## Positions\n\nReal positions prose here.";
  assert.equal(extractHeadingProse(body, "Context"), null, "a heading with no real content is 'no prose', same as absent");
  assert.equal(extractHeadingProse(body, "Positions"), "Real positions prose here.");
});

test("extractHeadingProse: exact heading-text match only -- 'Context' does not match 'context' or 'Context Notes'", () => {
  const body = "## context\n\nlowercase, should not match.\n\n## Context Notes\n\nextra words, should not match either.";
  assert.equal(extractHeadingProse(body, "Context"), null);
});

test("findHeadingBlockLines: the first line index in the returned set is always the heading line itself", () => {
  const lines = SYNTHETIC_BODY_BOTH_SECTIONS.split("\n");
  const block = [...findHeadingBlockLines(lines, "Context")].sort((a, b) => a - b);
  assert.equal(lines[block[0]].trim(), "## Context");
});

// ===========================================================================
// parseReleaseBundle — runtime validation of the jsonb `bundle` column.
// ===========================================================================

test("parseReleaseBundle: a well-formed bundle round-trips through JSON unchanged", () => {
  const bundle = fixtureBundle({
    "genesis/03-the-fall": { frontmatter: fixtureFrontmatter(), body: SYNTHETIC_BODY_BOTH_SECTIONS },
  });
  const roundTripped = JSON.parse(JSON.stringify(bundle));
  const parsed = parseReleaseBundle(roundTripped);
  assert.ok(parsed);
  assert.equal(parsed?.lessonCount, 1);
  assert.equal(parsed?.lessons["genesis/03-the-fall"]?.body, SYNTHETIC_BODY_BOTH_SECTIONS);
});

test("parseReleaseBundle: rejects (returns null) a value that is not an object at all", () => {
  assert.equal(parseReleaseBundle(null), null);
  assert.equal(parseReleaseBundle("a string"), null);
  assert.equal(parseReleaseBundle(42), null);
  assert.equal(parseReleaseBundle([1, 2, 3]), null);
});

test("parseReleaseBundle: rejects the wrong schemaVersion", () => {
  const bundle = { schemaVersion: 2, lessonCount: 0, lessons: {} };
  assert.equal(parseReleaseBundle(bundle), null);
});

test("parseReleaseBundle: rejects a bundle whose lessons value is not an object", () => {
  assert.equal(parseReleaseBundle({ schemaVersion: 1, lessonCount: 0, lessons: "nope" }), null);
  assert.equal(parseReleaseBundle({ schemaVersion: 1, lessonCount: 0, lessons: [] }), null);
});

test("parseReleaseBundle: rejects the WHOLE bundle when even one lesson's frontmatter fails LessonFrontmatterSchema -- fail closed, never a partial trust", () => {
  const bundle = fixtureBundle({
    good: { frontmatter: fixtureFrontmatter(), body: "fine" },
    // Missing required "author" -- LessonFrontmatterSchema.safeParse must reject this.
    bad: { frontmatter: { ...fixtureFrontmatter(), author: "" }, body: "also fine on its own" },
  });
  assert.equal(parseReleaseBundle(bundle), null);
});

test("parseReleaseBundle: rejects a lesson whose body is not a string", () => {
  const bundle = { schemaVersion: 1, lessonCount: 1, lessons: { x: { frontmatter: fixtureFrontmatter(), body: 12345 } } };
  assert.equal(parseReleaseBundle(bundle), null);
});

test("parseReleaseBundle: an empty lessons map is a valid, real bundle (the honest zero-lessons-published-yet state)", () => {
  const parsed = parseReleaseBundle({ schemaVersion: 1, lessonCount: 0, lessons: {} });
  assert.deepEqual(parsed, { schemaVersion: 1, lessonCount: 0, lessons: {} });
});

// ===========================================================================
// findLessonMatchingRange — pure range-containment lesson selection.
// ===========================================================================

test("findLessonMatchingRange: a session range fully inside the lesson's passage matches, with both prose sections extracted", () => {
  const bundle = fixtureBundle({
    "genesis/03-the-fall": {
      frontmatter: fixtureFrontmatter({ passage: range("1.3.1", "1.3.24") }),
      body: SYNTHETIC_BODY_BOTH_SECTIONS,
    },
  });
  const match = findLessonMatchingRange(bundle, range("1.3.1", "1.3.6"));
  assert.ok(match);
  assert.equal(match?.slug, "genesis/03-the-fall");
  assert.equal(match?.contextProse, "Synthetic context prose, line one.\nSynthetic context prose, line two.");
  assert.ok(match?.positionsProse?.includes("View A"));
});

test("findLessonMatchingRange: no lesson covers the range -> null (the honest 'no curated lesson' state)", () => {
  const bundle = fixtureBundle({
    "genesis/03-the-fall": { frontmatter: fixtureFrontmatter({ passage: range("1.3.1", "1.3.24") }), body: "x" },
  });
  assert.equal(findLessonMatchingRange(bundle, range("2.1.1", "2.1.5")), null);
});

test("findLessonMatchingRange: an empty bundle (zero lessons) always returns null", () => {
  assert.equal(findLessonMatchingRange(fixtureBundle({}), range("1.3.1", "1.3.6")), null);
});

test("findLessonMatchingRange: PARTIAL overlap is not containment -- a session range that extends past the lesson's passage does not match", () => {
  const bundle = fixtureBundle({
    lesson: { frontmatter: fixtureFrontmatter({ passage: range("1.3.1", "1.3.10") }), body: "x" },
  });
  // Session range starts inside the lesson's passage but ends past it.
  assert.equal(findLessonMatchingRange(bundle, range("1.3.5", "1.3.15")), null);
});

test("findLessonMatchingRange: a lesson in a different book never matches, even with numerically-overlapping chapter/verse numbers", () => {
  const bundle = fixtureBundle({
    lesson: { frontmatter: fixtureFrontmatter({ passage: range("1.3.1", "1.3.24") }), body: "x" },
  });
  assert.equal(findLessonMatchingRange(bundle, range("2.3.1", "2.3.6")), null);
});

test("findLessonMatchingRange: a lesson with neither ## Context nor ## Positions still matches -- both prose fields are null, not a missing lesson", () => {
  const bundle = fixtureBundle({
    lesson: {
      frontmatter: fixtureFrontmatter({ passage: range("1.3.1", "1.3.24") }),
      body: "# Fixture\n\nJust plain prose, no named sections at all.",
    },
  });
  const match = findLessonMatchingRange(bundle, range("1.3.1", "1.3.6"));
  assert.ok(match, "a lesson still exists for this range even with no curated sections");
  assert.equal(match?.contextProse, null);
  assert.equal(match?.positionsProse, null);
});

test("findLessonMatchingRange: a lesson with only ## Context (no ## Positions) reports the two independently", () => {
  const bundle = fixtureBundle({
    lesson: {
      frontmatter: fixtureFrontmatter({ passage: range("1.3.1", "1.3.24") }),
      body: "## Context\n\nOnly context prose exists in this fixture lesson.",
    },
  });
  const match = findLessonMatchingRange(bundle, range("1.3.1", "1.3.6"));
  assert.equal(match?.contextProse, "Only context prose exists in this fixture lesson.");
  assert.equal(match?.positionsProse, null);
});

// ---------------------------------------------------------------------------
// LESSONSHAPE-001 — literaryDesignProse / practiceBridgeProse /
// teachBackPromptsProse wiring through findLessonMatchingRange. No new
// extraction logic to prove here (extractHeadingProse's own coverage above
// already exercises the technique generically) — these tests exist to prove
// the three new PublishedLessonMatch fields are actually populated from the
// right headings, not left null or swapped with each other/the existing two.
// ---------------------------------------------------------------------------

test("findLessonMatchingRange: literaryDesignProse, practiceBridgeProse, and teachBackPromptsProse are each extracted from their own heading, independent of Context/Positions", () => {
  const bundle = fixtureBundle({
    "genesis/03-the-fall": {
      frontmatter: fixtureFrontmatter({ passage: range("1.3.1", "1.3.24") }),
      body: SYNTHETIC_BODY_ALL_SECTIONS,
    },
  });
  const match = findLessonMatchingRange(bundle, range("1.3.1", "1.3.6"));
  assert.ok(match);
  assert.equal(match?.contextProse, "Synthetic context prose.");
  assert.ok(match?.positionsProse?.includes("View A"));
  assert.equal(match?.literaryDesignProse, "Synthetic literary design prose, noting a fictional chiasm.");
  assert.equal(
    match?.practiceBridgeProse,
    "Synthetic worked bridge example, original meaning to modern situation.",
  );
  assert.equal(
    match?.teachBackPromptsProse,
    "1. Synthetic blind-explain prompt.\n2. Synthetic five-minute-outline prompt.",
  );
});

test("findLessonMatchingRange: a lesson with none of the three new headings reports all three as null, not a missing lesson", () => {
  const bundle = fixtureBundle({
    lesson: {
      frontmatter: fixtureFrontmatter({ passage: range("1.3.1", "1.3.24") }),
      body: "# Fixture\n\nJust plain prose, no named sections at all.",
    },
  });
  const match = findLessonMatchingRange(bundle, range("1.3.1", "1.3.6"));
  assert.ok(match, "a lesson still exists for this range even with no curated sections");
  assert.equal(match?.literaryDesignProse, null);
  assert.equal(match?.practiceBridgeProse, null);
  assert.equal(match?.teachBackPromptsProse, null);
});

test("findLessonMatchingRange: a bare (empty) ## Teach-Back Prompts heading reports null, same as absent", () => {
  const bundle = fixtureBundle({
    lesson: {
      frontmatter: fixtureFrontmatter({ passage: range("1.3.1", "1.3.24") }),
      body: "## Teach-Back Prompts\n\n\n## Some Other Heading\n\nUnrelated.",
    },
  });
  const match = findLessonMatchingRange(bundle, range("1.3.1", "1.3.6"));
  assert.equal(match?.teachBackPromptsProse, null);
});

test("findLessonMatchingRange: exactly one verse (start === end) is a valid session range and matches normally", () => {
  const bundle = fixtureBundle({
    lesson: { frontmatter: fixtureFrontmatter({ passage: range("1.3.1", "1.3.24") }), body: "x" },
  });
  assert.ok(findLessonMatchingRange(bundle, range("1.3.5", "1.3.5")));
});

test("findLessonMatchingRange: when two lessons both cover the same range, the FIRST by slug (sorted) wins -- a deterministic, documented tie-break", () => {
  const bundle = fixtureBundle({
    "zebra/lesson": { frontmatter: fixtureFrontmatter({ passage: range("1.3.1", "1.3.24") }), body: "z" },
    "aardvark/lesson": { frontmatter: fixtureFrontmatter({ passage: range("1.3.1", "1.3.24") }), body: "a" },
  });
  const match = findLessonMatchingRange(bundle, range("1.3.1", "1.3.6"));
  assert.equal(match?.slug, "aardvark/lesson");
});

// ===========================================================================
// findPublishedLessonForRange — the one real-IO function, exercised with a
// tiny in-memory fake `Database` (dependency injection, no live Postgres).
// ===========================================================================

type FakeRow = { bundle: unknown; releasedAt: string };

function fakeDb(rows: FakeRow[]) {
  // Minimal stand-in for the one query shape this function issues:
  // db.select({bundle}).from(catalogReleases).orderBy(desc(releasedAt)).limit(1)
  return {
    select: () => ({
      from: () => ({
        orderBy: () => ({
          limit: (n: number) => {
            const sorted = [...rows].sort((a, b) => (a.releasedAt < b.releasedAt ? 1 : -1));
            return Promise.resolve(sorted.slice(0, n).map((row) => ({ bundle: row.bundle })));
          },
        }),
      }),
    }),
  };
}

test("findPublishedLessonForRange: no catalog_releases rows at all -> null", async () => {
  const result = await findPublishedLessonForRange(fakeDb([]) as never, range("1.3.1", "1.3.6"));
  assert.equal(result, null);
});

test("findPublishedLessonForRange: picks the MOST RECENT release by releasedAt, ignoring older ones", async () => {
  const oldBundle = fixtureBundle({
    "genesis/old": { frontmatter: fixtureFrontmatter({ passage: range("1.3.1", "1.3.24") }), body: "old" },
  });
  const newBundle = fixtureBundle({
    "genesis/new": { frontmatter: fixtureFrontmatter({ passage: range("1.3.1", "1.3.24") }), body: "new" },
  });
  const db = fakeDb([
    { bundle: oldBundle, releasedAt: "2026-01-01T00:00:00.000Z" },
    { bundle: newBundle, releasedAt: "2026-06-01T00:00:00.000Z" },
  ]);
  const result = await findPublishedLessonForRange(db as never, range("1.3.1", "1.3.6"));
  assert.equal(result?.slug, "genesis/new");
});

test("findPublishedLessonForRange: a malformed bundle on the latest release fails closed to null", async () => {
  const db = fakeDb([{ bundle: { schemaVersion: "not-a-number" }, releasedAt: "2026-01-01T00:00:00.000Z" }]);
  const result = await findPublishedLessonForRange(db as never, range("1.3.1", "1.3.6"));
  assert.equal(result, null);
});

// ===========================================================================
// MUTATION PROOFS (real, verbatim run documented here) — same discipline as
// tests/content-build.test.ts and tests/workspace-shell.test.ts's own
// "MUTATION PROOFS" sections.
//
//   (a) Containment weakened to overlap (`findLessonMatchingRange`'s
//       `rangeContainsRange(lesson.frontmatter.passage, sessionRange)` line
//       mutated to `rangesOverlap(lesson.frontmatter.passage, sessionRange)`):
//       this makes a lesson match a session range that merely TOUCHES its
//       passage rather than fully covering it. Named test that failed:
//       "findLessonMatchingRange: PARTIAL overlap is not containment -- a
//       session range that extends past the lesson's passage does not
//       match" (it started asserting a match where none should exist).
//       Reverted; `diff` confirmed byte-identical; `npm test` green again.
//
//   (b) Heading-line inclusion bug (`extractHeadingProse`'s
//       `blockLines.slice(1)` mutated to `blockLines.slice(0)`, i.e. the
//       heading line itself leaks into the returned prose): named test that
//       failed: "extractHeadingProse: extracts Context prose, excluding the
//       heading line itself, stopping at the next ## heading" (the returned
//       string started with "## Context\n..." instead of the prose alone).
//       Reverted; `diff` confirmed byte-identical; `npm test` green again.
//
// See this task's final report for the verbatim before/after `npm test`
// command output.
// ===========================================================================
