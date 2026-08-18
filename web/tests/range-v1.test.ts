import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { BibleIndex, BookData } from "@/lib/contracts";
import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import {
  buildCanonTable,
  formatCanonicalRangeKey,
  isSingleVerseRange,
  parseCanonicalRangeKey,
  parseVerseKeyStrict,
  rangeContainsRange,
  rangeContainsRef,
  rangesOverlap,
  toDisplayReference,
  validateCanonicalRange,
  type CanonTable,
} from "@/lib/bible/range";
import { VerseMapUnavailableError, __resetVerseMapCacheForTests } from "@/lib/bible/versemap";

// ---------------------------------------------------------------------------
// Real canon table, built from the actual shipped corpus — not a fabricated
// fixture. Bounds tests below assert against numbers read straight out of
// these files, never against a number range.ts itself produced.
// ---------------------------------------------------------------------------

async function loadRealCanonTable(): Promise<CanonTable> {
  const index: BibleIndex = JSON.parse(
    await readFile(new URL("../public/bible/index.json", import.meta.url), "utf8"),
  );

  const verseCounts = new Map<string, number>();
  for (const book of index.books) {
    const data: BookData = JSON.parse(
      await readFile(new URL(`../public/bible/BSB/${book.n}.json`, import.meta.url), "utf8"),
    );
    data.c.forEach((verses, i) => verseCounts.set(`${book.n}.${i + 1}`, verses.length));
  }

  return buildCanonTable(index.books, (book, chapter) => verseCounts.get(`${book}.${chapter}`));
}

const canonPromise = loadRealCanonTable();

function range(start: string, end: string): CanonicalRangeV1 {
  return { versificationId: CANONICAL_VERSIFICATION_ID, start, end };
}

// ---------------------------------------------------------------------------
// Round-trip: single verse, cross-chapter, formatting
// ---------------------------------------------------------------------------

test("a single verse is representable and round-trips (start equals end)", async () => {
  const canon = await canonPromise;
  const r = range("1.1.1", "1.1.1");
  assert.equal(validateCanonicalRange(r, canon).ok, true);
  assert.equal(isSingleVerseRange(r), true);

  const key = formatCanonicalRangeKey(r);
  const parsed = parseCanonicalRangeKey(key, canon);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.ok ? parsed.range : null, r);
});

test("Genesis 1:1-2:3 (cross-chapter, one book) is valid and round-trips", async () => {
  const canon = await canonPromise;
  const r = range("1.1.1", "1.2.3");
  const validation = validateCanonicalRange(r, canon);
  assert.deepEqual(validation, { ok: true });
  assert.equal(isSingleVerseRange(r), false);

  const key = formatCanonicalRangeKey(r);
  assert.equal(key, "1.1.1-1.2.3");
  const parsed = parseCanonicalRangeKey(key, canon);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.ok ? parsed.range : null, r);
});

test("a real last-verse-of-book boundary round-trips (Genesis 50:26, the last verse in the canon's first book)", async () => {
  const canon = await canonPromise;
  const r = range("1.50.26", "1.50.26");
  assert.deepEqual(validateCanonicalRange(r, canon), { ok: true });
});

// ---------------------------------------------------------------------------
// Cross-book rejected
// ---------------------------------------------------------------------------

test("a range crossing from Genesis into Exodus is rejected as cross-book", async () => {
  const canon = await canonPromise;
  const r = range("1.50.26", "2.1.1");
  const validation = validateCanonicalRange(r, canon);
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.equal(validation.reason, "cross-book");
});

test("parseCanonicalRangeKey also rejects a cross-book key", async () => {
  const canon = await canonPromise;
  const parsed = parseCanonicalRangeKey("1.50.26-2.1.1", canon);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.reason, "cross-book");
});

// ---------------------------------------------------------------------------
// Reversed rejected
// ---------------------------------------------------------------------------

test("a reversed range (end before start) is rejected", async () => {
  const canon = await canonPromise;
  const r = range("1.2.3", "1.1.1");
  const validation = validateCanonicalRange(r, canon);
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.equal(validation.reason, "reversed");
});

test("a reversed same-chapter range (verse 5 to verse 2) is rejected", async () => {
  const canon = await canonPromise;
  const r = range("45.16.5", "45.16.2");
  const validation = validateCanonicalRange(r, canon);
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.equal(validation.reason, "reversed");
});

// ---------------------------------------------------------------------------
// Out-of-bounds against the REAL canon table
// ---------------------------------------------------------------------------

test("a chapter beyond Genesis's real 50 chapters is rejected", async () => {
  const canon = await canonPromise;
  assert.equal(canon.chapterCount(1), 50, "sanity: Genesis really has 50 chapters in the shipped corpus");
  const r = range("1.51.1", "1.51.1");
  const validation = validateCanonicalRange(r, canon);
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.equal(validation.reason, "start-out-of-bounds");
});

test("a verse beyond Romans 16's real 27 verses is rejected", async () => {
  const canon = await canonPromise;
  assert.equal(canon.verseCount(45, 16), 27, "sanity: Romans 16 really has 27 verses in the shipped corpus");
  const r = range("45.16.1", "45.16.28");
  const validation = validateCanonicalRange(r, canon);
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.equal(validation.reason, "end-out-of-bounds");
});

test("a verse beyond Psalm 119's real 176 verses is rejected", async () => {
  const canon = await canonPromise;
  assert.equal(canon.verseCount(19, 119), 176, "sanity: Psalm 119 really has 176 verses in the shipped corpus");
  const r = range("19.119.177", "19.119.177");
  const validation = validateCanonicalRange(r, canon);
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.equal(validation.reason, "start-out-of-bounds");
});

test("book 67 (past the real 66-book canon) is rejected as out of the canon", async () => {
  const canon = await canonPromise;
  assert.equal(canon.chapterCount(67), undefined, "sanity: there is no book 67 in the shipped corpus");
  const r = range("67.1.1", "67.1.1");
  const validation = validateCanonicalRange(r, canon);
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.equal(validation.reason, "start-out-of-bounds");
});

// ---------------------------------------------------------------------------
// Malformed keys — prefix/suffix junk, wrong shape
// ---------------------------------------------------------------------------

const malformedKeys = [
  "1.1.1 ", // trailing space
  " 1.1.1", // leading space
  "1.1.1abc", // trailing junk (Number.parseInt-based parsing would accept this)
  "x1.1.1", // leading junk
  "1.1.01", // leading zero
  "01.1.1", // leading zero on book
  "1.1", // chapter-only key, not a valid range boundary
  "1.1.1.1", // four components
  "1..1", // empty component
  "", // empty string
  "1.1.1;drop table", // injection-shaped suffix junk
  "1.1.-1", // negative
  "1.1.1.5-junk", // will also fail split, but exercise directly too
];

for (const bad of malformedKeys) {
  test(`parseVerseKeyStrict rejects malformed key ${JSON.stringify(bad)}`, () => {
    assert.equal(parseVerseKeyStrict(bad), null);
  });
}

test("a malformed start key is rejected with reason malformed-start", async () => {
  const canon = await canonPromise;
  const r = range("1.1.1abc", "1.2.3");
  const validation = validateCanonicalRange(r, canon);
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.equal(validation.reason, "malformed-start");
});

test("a malformed end key is rejected with reason malformed-end", async () => {
  const canon = await canonPromise;
  const r = range("1.1.1", " 1.2.3");
  const validation = validateCanonicalRange(r, canon);
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.equal(validation.reason, "malformed-end");
});

test("parseCanonicalRangeKey rejects a key with no separator, and one with two", async () => {
  const canon = await canonPromise;
  const noDash = parseCanonicalRangeKey("1.1.1", canon);
  assert.equal(noDash.ok, false);
  if (!noDash.ok) assert.equal(noDash.reason, "malformed-key");

  const twoDashes = parseCanonicalRangeKey("1.1.1-1.2.3-1.3.1", canon);
  assert.equal(twoDashes.ok, false);
  if (!twoDashes.ok) assert.equal(twoDashes.reason, "malformed-key");
});

test("the wrong versification id is rejected even with otherwise-valid keys", async () => {
  const canon = await canonPromise;
  const r = {
    versificationId: "some-other-versification-v1",
    start: "1.1.1",
    end: "1.1.1",
  } as unknown as CanonicalRangeV1;
  const validation = validateCanonicalRange(r, canon);
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.equal(validation.reason, "wrong-versification");
});

// ---------------------------------------------------------------------------
// Containment / overlap
// ---------------------------------------------------------------------------

test("rangeContainsRef: a verse inside a cross-chapter range is contained", async () => {
  const r = range("1.1.1", "1.2.3");
  assert.equal(rangeContainsRef(r, "1.1.31"), true); // last verse of Gen 1
  assert.equal(rangeContainsRef(r, "1.2.1"), true);
  assert.equal(rangeContainsRef(r, "1.2.3"), true); // inclusive end
  assert.equal(rangeContainsRef(r, "1.1.1"), true); // inclusive start
});

test("rangeContainsRef: a verse outside the range, and a verse in a different book, are not contained", async () => {
  const r = range("1.1.1", "1.2.3");
  assert.equal(rangeContainsRef(r, "1.2.4"), false);
  assert.equal(rangeContainsRef(r, "1.1.0" as string), false); // unparseable anyway
  assert.equal(rangeContainsRef(r, "2.1.1"), false, "a different book is never contained");
});

test("rangeContainsRange: a fully nested range is contained; a partially-outside one is not", async () => {
  const outer = range("1.1.1", "1.2.25");
  const nested = range("1.1.15", "1.2.1");
  const spillsOut = range("1.1.15", "1.2.26");
  assert.equal(rangeContainsRange(outer, nested), true);
  assert.equal(rangeContainsRange(outer, spillsOut), false);
});

test("rangesOverlap: sharing a boundary verse counts as overlap; disjoint ranges do not", async () => {
  const a = range("45.16.1", "45.16.10");
  const b = range("45.16.10", "45.16.20");
  const c = range("45.16.11", "45.16.20");
  assert.equal(rangesOverlap(a, b), true, "sharing verse 10 is an overlap");
  assert.equal(rangesOverlap(a, c), false, "no shared verse");
});

test("rangesOverlap: different books never overlap even with identical chapter/verse numbers", async () => {
  const a = range("1.1.1", "1.1.10");
  const b = range("2.1.1", "2.1.10");
  assert.equal(rangesOverlap(a, b), false);
});

// ---------------------------------------------------------------------------
// SBL Romans 14/16 divergence — canonical range -> display reference
// ---------------------------------------------------------------------------

const versemapFixture = {
  SBL: {
    comparedTo: "BSB",
    toEnglish: {
      "45.14.24": "45.16.25",
      "45.14.25": "45.16.26",
      "45.14.26": "45.16.27",
      "45.16.25": null,
    },
    toSpanish: {
      "45.16.25": "45.14.24",
      "45.16.26": "45.14.25",
      "45.16.27": "45.14.26",
    },
    notes: {},
    divergentChapters: ["45.14", "45.16"],
  },
};

function respondWithVersemapFixture() {
  return new Response(JSON.stringify(versemapFixture), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("toDisplayReference maps Romans 16:25-27 (English) to Spanish 14:24-26", async () => {
  const canon = await canonPromise;
  __resetVerseMapCacheForTests();
  globalThis.fetch = async () => respondWithVersemapFixture();
  try {
    const r = range("45.16.25", "45.16.27");
    const display = await toDisplayReference(r, "SBL", "release-2026-08", canon);
    assert.equal(display.mappedStart, "45.14.24");
    assert.equal(display.mappedEnd, "45.14.26");
    assert.equal(display.translationId, "SBL");
    assert.equal(display.corpusReleaseId, "release-2026-08");
    assert.deepEqual(display.canonicalRange, r);
  } finally {
    __resetVerseMapCacheForTests();
  }
});

test("toDisplayReference is identity for a non-divergent chapter", async () => {
  const canon = await canonPromise;
  __resetVerseMapCacheForTests();
  globalThis.fetch = async () => respondWithVersemapFixture();
  try {
    const r = range("40.1.1", "40.1.5");
    const display = await toDisplayReference(r, "SBL", "release-2026-08", canon);
    assert.equal(display.mappedStart, "40.1.1");
    assert.equal(display.mappedEnd, "40.1.5");
  } finally {
    __resetVerseMapCacheForTests();
  }
});

test("toDisplayReference is a no-op pass-through for the canonical base version itself (no map consulted)", async () => {
  const canon = await canonPromise;
  __resetVerseMapCacheForTests();
  globalThis.fetch = async () => {
    throw new Error("must not be called for the base version");
  };
  try {
    const r = range("45.16.25", "45.16.27");
    const display = await toDisplayReference(r, "BSB", "release-2026-08", canon);
    assert.equal(display.mappedStart, "45.16.25");
    assert.equal(display.mappedEnd, "45.16.27");
  } finally {
    __resetVerseMapCacheForTests();
  }
});

test("toDisplayReference propagates VerseMapUnavailableError instead of guessing when the map fails to load", async () => {
  const canon = await canonPromise;
  __resetVerseMapCacheForTests();
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    const r = range("45.16.25", "45.16.27");
    await assert.rejects(
      () => toDisplayReference(r, "SBL", "release-2026-08", canon),
      VerseMapUnavailableError,
    );
  } finally {
    globalThis.fetch = async () => respondWithVersemapFixture();
    __resetVerseMapCacheForTests();
  }
});

// NOTE on UnmappableDisplayReferenceError: toDisplayReference() only ever
// aligns FROM the canonical base version (BSB) TO translationId, which walks
// versemap.ts's `toSpanish`-shaped direction. `validateVerseMap()` in
// versemap.ts requires every `toSpanish` value to be a non-null string (only
// `toEnglish`, the direction this module never uses, may contain nulls), so
// a real `alignChapter()` call can never hand this module a null `toKey` on
// the only direction it walks — confirmed by reading versemap.ts, not
// assumed. The guard exists only because `AlignedRow.toKey`'s declared type
// is `RefKey | null` (TypeScript cannot see the shape-validation invariant
// across the module boundary) and as defense-in-depth against a future
// relaxation of that invariant. It is intentionally not exercised by a test
// here: constructing a payload that reaches it would require violating
// `validateVerseMap()`'s own contract, which would make the test assert a
// state the shipped code can never actually produce.

test("toDisplayReference refuses to map an invalid canonical range at all", async () => {
  const canon = await canonPromise;
  const r = range("1.2.3", "1.1.1"); // reversed
  await assert.rejects(() => toDisplayReference(r, "SBL", "release-2026-08", canon));
});
