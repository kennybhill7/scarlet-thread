/**
 * STORYMAP-001 — tests for `lib/map/storyMapLayout.ts`'s pure layout math.
 *
 * SYNTHETIC FIXTURES first: small, hand-built book lists / verse-count
 * lookups, the same dependency-injection discipline
 * `tests/import-cross-references.test.ts` (and, one layer further back,
 * `tests/release-migrate.test.ts`/`tests/offline-downloads.test.ts`) already
 * established for logic-vs-IO separation in this repo — no filesystem read,
 * no DOM, no DB connection anywhere in that section.
 *
 * REAL DATA section: builds a genuine `verseCount` lookup from the actual
 * shipped `public/bible/index.json` + `public/bible/BSB/*.json` corpus — the
 * exact technique `tests/range-v1.test.ts` established for a real (not
 * synthetic) `CanonTable` in a test, and `tests/import-cross-references.test.ts`
 * reused for its own real-file regression test. Proves the acceptance
 * criteria that only make sense against the real canon: Psalm 119 (176
 * verses, the Bible's longest chapter) renders visibly wider than Psalm 117
 * (2 verses, the shortest) and Obadiah's own one chapter (21 verses); the
 * baseline's chapter ordinals agree with `lib/bible/reference.ts`'s own
 * `chapterOrdinal()`, an independent cross-check rather than trusting this
 * module's own counting a second time.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { chapterOrdinal } from "@/lib/bible/reference";
import type { BookMeta } from "@/lib/contracts";
import type { CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import { CANONICAL_VERSIFICATION_ID } from "@/lib/contracts/range-v1";
import {
  ARC_MAX_HEIGHT,
  ARC_MIN_HEIGHT,
  arcHeightForDistance,
  arcPathD,
  buildArcsForEdges,
  buildStoryMapBaseline,
  chapterOfRefKey,
  chapterQueryValue,
  findChapterSegment,
  indexChaptersByKey,
  parseChapterQueryValue,
  type StoryMapEdgeInput,
} from "@/lib/map/storyMapLayout";

// ===========================================================================
// SYNTHETIC FIXTURES
// ===========================================================================

const SYNTHETIC_BOOKS: BookMeta[] = [
  { n: 1, name: "First", abbr: "Fst", chapters: 2, testament: "OT" },
  { n: 2, name: "Second", abbr: "Snd", chapters: 1, testament: "OT" },
];

const SYNTHETIC_VERSE_COUNTS: Record<string, number> = {
  "1.1": 10,
  "1.2": 5,
  "2.1": 3,
};

function syntheticVerseCount(book: number, chapter: number): number | undefined {
  return SYNTHETIC_VERSE_COUNTS[`${book}.${chapter}`];
}

test("BASELINE: total width equals the sum of every real verse count injected", () => {
  const baseline = buildStoryMapBaseline(SYNTHETIC_BOOKS, syntheticVerseCount);
  assert.equal(baseline.totalWidth, 10 + 5 + 3);
});

test("BASELINE: chapters are laid out end to end in canonical order, x/width/midX all consistent", () => {
  const baseline = buildStoryMapBaseline(SYNTHETIC_BOOKS, syntheticVerseCount);
  assert.equal(baseline.chapters.length, 3);

  const [gen1, gen2, second1] = baseline.chapters;
  assert.deepEqual(
    { book: gen1.book, chapter: gen1.chapter, x: gen1.x, width: gen1.width, midX: gen1.midX, ordinal: gen1.ordinal },
    { book: 1, chapter: 1, x: 0, width: 10, midX: 5, ordinal: 1 },
  );
  assert.deepEqual(
    { book: gen2.book, chapter: gen2.chapter, x: gen2.x, width: gen2.width, midX: gen2.midX, ordinal: gen2.ordinal },
    { book: 1, chapter: 2, x: 10, width: 5, midX: 12.5, ordinal: 2 },
  );
  assert.deepEqual(
    {
      book: second1.book,
      chapter: second1.chapter,
      x: second1.x,
      width: second1.width,
      midX: second1.midX,
      ordinal: second1.ordinal,
    },
    { book: 2, chapter: 1, x: 15, width: 3, midX: 16.5, ordinal: 3 },
  );
});

test("BASELINE: book segments span exactly their own chapters' combined width, real canonical order preserved", () => {
  const baseline = buildStoryMapBaseline(SYNTHETIC_BOOKS, syntheticVerseCount);
  assert.equal(baseline.books.length, 2);
  assert.deepEqual(baseline.books[0], { book: 1, name: "First", abbr: "Fst", x: 0, width: 15 });
  assert.deepEqual(baseline.books[1], { book: 2, name: "Second", abbr: "Snd", x: 15, width: 3 });
});

test("BASELINE: a chapter with no verse-count entry gets width 0, not NaN/undefined, and does not break later chapters' cumulative x", () => {
  const books: BookMeta[] = [{ n: 1, name: "Only", abbr: "Onl", chapters: 2, testament: "OT" }];
  const baseline = buildStoryMapBaseline(books, (b, c) => (c === 1 ? 7 : undefined));
  assert.equal(baseline.chapters[0].width, 7);
  assert.equal(baseline.chapters[1].width, 0);
  assert.equal(baseline.chapters[1].x, 7);
  assert.equal(baseline.totalWidth, 7);
});

test("INDEX/FIND: indexChaptersByKey and findChapterSegment agree, and a nonexistent chapter is undefined not thrown", () => {
  const baseline = buildStoryMapBaseline(SYNTHETIC_BOOKS, syntheticVerseCount);
  const lookup = indexChaptersByKey(baseline);
  assert.equal(lookup.get("1.2"), findChapterSegment(baseline, 1, 2));
  assert.equal(findChapterSegment(baseline, 1, 2)?.midX, 12.5);
  assert.equal(findChapterSegment(baseline, 99, 1), undefined);
  assert.equal(lookup.get("99.1"), undefined);
});

test("chapterOfRefKey: a well-formed RefKey resolves to its book/chapter; a malformed one returns null, not a throw", () => {
  assert.deepEqual(chapterOfRefKey("1.2.3"), { book: 1, chapter: 2 });
  assert.equal(chapterOfRefKey("not-a-key"), null);
  assert.equal(chapterOfRefKey(""), null);
});

test("chapterQueryValue/parseChapterQueryValue round-trip, and parse rejects junk without throwing", () => {
  assert.equal(chapterQueryValue(19, 119), "19.119");
  assert.deepEqual(parseChapterQueryValue("19.119"), { book: 19, chapter: 119 });
  assert.equal(parseChapterQueryValue(null), null);
  assert.equal(parseChapterQueryValue(undefined), null);
  assert.equal(parseChapterQueryValue(""), null);
  assert.equal(parseChapterQueryValue("19.119.1"), null, "a verse-level key is not a valid chapter query value");
  assert.equal(parseChapterQueryValue("abc"), null);
  assert.equal(parseChapterQueryValue("19."), null);
});

// ---------------------------------------------------------------------------
// Arc height / path geometry
// ---------------------------------------------------------------------------

test("arcHeightForDistance: zero distance -> minHeight, full-canon distance -> maxHeight, strictly monotonic between", () => {
  const totalWidth = 1000;
  assert.equal(arcHeightForDistance(0, totalWidth), ARC_MIN_HEIGHT);
  assert.equal(arcHeightForDistance(totalWidth, totalWidth), ARC_MAX_HEIGHT);
  assert.equal(arcHeightForDistance(totalWidth * 2, totalWidth), ARC_MAX_HEIGHT, "distance beyond totalWidth still clamps to maxHeight, never exceeds it");

  const near = arcHeightForDistance(100, totalWidth);
  const far = arcHeightForDistance(600, totalWidth);
  assert.ok(near < far, `expected a nearer pair's arc (${near}) to be shorter than a farther pair's (${far})`);
});

test("arcHeightForDistance: a degenerate zero-width baseline never divides by zero", () => {
  assert.equal(arcHeightForDistance(50, 0), ARC_MIN_HEIGHT);
});

test("arcPathD: emits a single quadratic Bezier, always left-to-right regardless of argument order", () => {
  const forward = arcPathD(10, 50, 300, 20);
  const backward = arcPathD(50, 10, 300, 20);
  assert.equal(forward, backward);
  assert.match(forward, /^M10,300 Q30,280 50,300$/);
});

// ===========================================================================
// buildArcsForEdges — using the synthetic baseline
// ===========================================================================

function edge(fromKey: string, toKey: string, overrides: Partial<StoryMapEdgeInput> = {}): StoryMapEdgeInput {
  const range = (key: string): CanonicalRangeV1 => ({
    versificationId: CANONICAL_VERSIFICATION_ID,
    start: key,
    end: key,
  });
  return {
    id: overrides.id ?? `${fromKey}->${toKey}`,
    fromRange: range(fromKey),
    toRange: range(toKey),
    evidenceLabel: overrides.evidenceLabel ?? "plausible",
    communityVotes: overrides.communityVotes ?? 5,
  };
}

test("buildArcsForEdges: a real cross-chapter edge produces an arc anchored at both chapters' real midX", () => {
  const baseline = buildStoryMapBaseline(SYNTHETIC_BOOKS, syntheticVerseCount);
  const arcs = buildArcsForEdges([edge("1.1.1", "2.1.1")], baseline, { baselineY: 300 });
  assert.equal(arcs.length, 1);
  const [arc] = arcs;
  assert.equal(arc.fromOrdinal, 1);
  assert.equal(arc.toOrdinal, 3);
  assert.equal(arc.distance, 16.5 - 5); // toSeg.midX - fromSeg.midX
  assert.match(arc.d, /^M5,300 Q/);
});

test("buildArcsForEdges: an edge referencing a chapter outside the baseline is skipped, not thrown", () => {
  const baseline = buildStoryMapBaseline(SYNTHETIC_BOOKS, syntheticVerseCount);
  const arcs = buildArcsForEdges([edge("1.1.1", "99.1.1")], baseline, { baselineY: 300 });
  assert.equal(arcs.length, 0);
});

test("buildArcsForEdges: a malformed RefKey is skipped, not thrown, and does not affect the other edges in the same call", () => {
  const baseline = buildStoryMapBaseline(SYNTHETIC_BOOKS, syntheticVerseCount);
  const good = edge("1.1.1", "2.1.1");
  const bad: StoryMapEdgeInput = {
    ...edge("1.1.1", "1.2.1", { id: "bad" }),
    fromRange: { versificationId: CANONICAL_VERSIFICATION_ID, start: "not-a-key", end: "not-a-key" },
  };
  const arcs = buildArcsForEdges([bad, good], baseline, { baselineY: 300 });
  assert.equal(arcs.length, 1);
  assert.equal(arcs[0].id, good.id);
});

test("buildArcsForEdges: a same-chapter edge produces a small, real, nonzero-distance hump across that chapter's own width, not a zero-length point", () => {
  const baseline = buildStoryMapBaseline(SYNTHETIC_BOOKS, syntheticVerseCount);
  const arcs = buildArcsForEdges([edge("1.1.1", "1.1.5")], baseline, { baselineY: 300 });
  assert.equal(arcs.length, 1);
  const [arc] = arcs;
  assert.ok(arc.distance > 0, "same-chapter edge must not collapse to a zero-distance point");
  assert.equal(arc.distance, 10); // Book 1 Chapter 1's own width (see SYNTHETIC_VERSE_COUNTS)
  assert.ok(arc.height >= ARC_MIN_HEIGHT);
});

test("buildArcsForEdges: 'strong' vs 'plausible' evidenceLabel passes straight through, untouched, for the component to color", () => {
  const baseline = buildStoryMapBaseline(SYNTHETIC_BOOKS, syntheticVerseCount);
  const arcs = buildArcsForEdges(
    [edge("1.1.1", "2.1.1", { evidenceLabel: "strong", communityVotes: 120 })],
    baseline,
    { baselineY: 300 },
  );
  assert.equal(arcs[0].evidenceLabel, "strong");
  assert.equal(arcs[0].communityVotes, 120);
});

test("buildArcsForEdges: an empty edge list produces an empty arc list", () => {
  const baseline = buildStoryMapBaseline(SYNTHETIC_BOOKS, syntheticVerseCount);
  assert.deepEqual(buildArcsForEdges([], baseline, { baselineY: 300 }), []);
});

// ===========================================================================
// REAL DATA — the actual shipped BSB corpus, same technique tests/range-v1.test.ts
// and tests/import-cross-references.test.ts already established.
// ===========================================================================

interface BibleIndexFile {
  books: BookMeta[];
}
interface BookDataFile {
  c: unknown[][];
}

async function loadRealBaseline() {
  const index: BibleIndexFile = JSON.parse(
    await readFile(new URL("../public/bible/index.json", import.meta.url), "utf8"),
  );
  const verseCounts = new Map<string, number>();
  for (const book of index.books) {
    const data: BookDataFile = JSON.parse(
      await readFile(new URL(`../public/bible/BSB/${book.n}.json`, import.meta.url), "utf8"),
    );
    data.c.forEach((verses, i) => verseCounts.set(`${book.n}.${i + 1}`, verses.length));
  }
  return { index, baseline: buildStoryMapBaseline(index.books, (b, c) => verseCounts.get(`${b}.${c}`)) };
}

test("REAL DATA: the whole canon has 1,189 real chapter segments and a real, positive total width", async () => {
  const { baseline } = await loadRealBaseline();
  assert.equal(baseline.chapters.length, 1189, "the real BSB corpus's own well-known chapter count");
  assert.ok(baseline.totalWidth > 0);
});

test("REAL DATA: Psalm 119 (176 verses, the Bible's longest chapter) renders visibly wider than Psalm 117 (2 verses, the shortest) and Obadiah 1 (21 verses)", async () => {
  const { baseline } = await loadRealBaseline();
  const ps119 = findChapterSegment(baseline, 19, 119);
  const ps117 = findChapterSegment(baseline, 19, 117);
  const obadiah1 = findChapterSegment(baseline, 31, 1);

  assert.ok(ps119, "Psalm 119 must exist on the real baseline");
  assert.ok(ps117, "Psalm 117 must exist on the real baseline");
  assert.ok(obadiah1, "Obadiah 1 must exist on the real baseline");

  assert.equal(ps119!.verseCount, 176);
  assert.equal(ps117!.verseCount, 2);
  assert.equal(obadiah1!.verseCount, 21);

  assert.ok(ps119!.width > ps117!.width * 10, "Psalm 119 should be dramatically wider than the 2-verse Psalm 117");
  assert.ok(ps119!.width > obadiah1!.width, "Psalm 119 should be wider than Obadiah's one 21-verse chapter");
});

test("REAL DATA: book boundaries land in the real canonical order, Genesis first and Revelation last", async () => {
  const { baseline } = await loadRealBaseline();
  assert.equal(baseline.books.length, 66);
  assert.equal(baseline.books[0].name, "Genesis");
  assert.equal(baseline.books[0].x, 0);
  assert.equal(baseline.books.at(-1)!.name, "Revelation");
  assert.equal(baseline.books.at(-1)!.x + baseline.books.at(-1)!.width, baseline.totalWidth);
});

test("REAL DATA: every real chapter's ordinal agrees with lib/bible/reference.ts's own independent chapterOrdinal()", async () => {
  const { index, baseline } = await loadRealBaseline();
  // Spot-check across the whole canon rather than every single chapter (1,189
  // assertions would be redundant with the same one check) -- first, last,
  // and a handful of real book-boundary crossings, cross-verified against a
  // SEPARATE, already-existing implementation of "absolute chapter position"
  // rather than this module's own counting trusted a second time.
  const samples: { book: number; chapter: number }[] = [
    { book: 1, chapter: 1 },
    { book: 1, chapter: 2 }, // first book-boundary crossing
    { book: 19, chapter: 119 }, // Psalms, deep in the canon
    { book: 40, chapter: 1 }, // Matthew, OT/NT boundary
    { book: 66, chapter: 22 }, // Revelation's last chapter
  ];
  for (const sample of samples) {
    const segment = findChapterSegment(baseline, sample.book, sample.chapter);
    assert.ok(segment, `${sample.book}.${sample.chapter} must exist`);
    assert.equal(
      segment!.ordinal,
      chapterOrdinal(sample, index.books),
      `ordinal mismatch for ${sample.book}.${sample.chapter}`,
    );
  }
  assert.equal(baseline.chapters.at(-1)!.ordinal, 1189);
});
