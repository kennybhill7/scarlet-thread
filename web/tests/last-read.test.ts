import assert from "node:assert/strict";
import test from "node:test";

import {
  getLastRead,
  readLastReadServerSnapshot,
  readLastReadSnapshot,
  reconcileLastReadSnapshot,
  sanitizeLastRead,
  setLastRead,
  subscribeLastRead,
} from "@/lib/bible/lastRead";

const DEFAULT = { book: 1, chapter: 1, version: "BSB", parallel: false } as const;

// ---------------------------------------------------------------------------
// A-038: getLastRead() used to do
//   { ...DEFAULT, ...(JSON.parse(raw) as Partial<LastRead>) }
// with zero validation -- a corrupted/hand-edited localStorage value spread
// straight through. sanitizeLastRead() is the pure per-field validator that
// replaced it; it takes plain `unknown` (no localStorage/JSON.parse), so it
// is exercised directly here with no DOM, the same way lib/theme.ts's pure
// functions are tested in tests/theme.test.ts.
// ---------------------------------------------------------------------------

test("sanitizeLastRead passes a fully valid record through unchanged", () => {
  const value = { book: 43, chapter: 3, version: "KJV", parallel: true };
  assert.deepEqual(sanitizeLastRead(value), value);
});

test("sanitizeLastRead accepts every real VersionId", () => {
  for (const version of ["BSB", "KJV", "ASV", "YLT", "SBL"]) {
    assert.deepEqual(sanitizeLastRead({ book: 1, chapter: 1, version, parallel: false }), {
      book: 1,
      chapter: 1,
      version,
      parallel: false,
    });
  }
});

// MUTATION-PROOF TARGET (per-field fallback, not all-or-nothing): each case
// below carries exactly ONE invalid field alongside three otherwise-valid
// ones. If sanitizeLastRead regressed to an all-or-nothing spread (the old
// bug), the valid fields would also revert to DEFAULT here -- these
// assertions would fail because they require the untouched fields to
// SURVIVE, not just the invalid one to be replaced.

test("sanitizeLastRead: out-of-range book (999) falls back to DEFAULT.book only", () => {
  const result = sanitizeLastRead({ book: 999, chapter: 5, version: "KJV", parallel: true });
  assert.equal(result.book, DEFAULT.book);
  assert.equal(result.chapter, 5, "chapter must survive -- this is a per-field fallback");
  assert.equal(result.version, "KJV", "version must survive");
  assert.equal(result.parallel, true, "parallel must survive");
});

test("sanitizeLastRead: book 0 and book 67 are both out of the real 1-66 canon", () => {
  assert.equal(sanitizeLastRead({ book: 0 }).book, DEFAULT.book);
  assert.equal(sanitizeLastRead({ book: 67 }).book, DEFAULT.book);
  assert.equal(sanitizeLastRead({ book: 66 }).book, 66, "66 (Revelation) is the real upper bound");
  assert.equal(sanitizeLastRead({ book: 1 }).book, 1, "1 (Genesis) is the real lower bound");
});

test("sanitizeLastRead: non-integer book (3.5) is rejected", () => {
  assert.equal(sanitizeLastRead({ book: 3.5 }).book, DEFAULT.book);
});

test("sanitizeLastRead: negative chapter (-5) falls back to DEFAULT.chapter only", () => {
  const result = sanitizeLastRead({ book: 19, chapter: -5, version: "ASV", parallel: true });
  assert.equal(result.chapter, DEFAULT.chapter);
  assert.equal(result.book, 19, "book must survive");
  assert.equal(result.version, "ASV", "version must survive");
  assert.equal(result.parallel, true, "parallel must survive");
});

test("sanitizeLastRead: chapter 0 is rejected (chapters are 1-indexed)", () => {
  assert.equal(sanitizeLastRead({ chapter: 0 }).chapter, DEFAULT.chapter);
});

test("sanitizeLastRead: non-integer chapter (3.5) is rejected", () => {
  assert.equal(sanitizeLastRead({ chapter: 3.5 }).chapter, DEFAULT.chapter);
});

test('sanitizeLastRead: unknown version string ("XYZ") falls back to DEFAULT.version only', () => {
  const result = sanitizeLastRead({ book: 19, chapter: 5, version: "XYZ", parallel: true });
  assert.equal(result.version, DEFAULT.version);
  assert.equal(result.book, 19, "book must survive");
  assert.equal(result.chapter, 5, "chapter must survive");
  assert.equal(result.parallel, true, "parallel must survive");
});

test("sanitizeLastRead: a lowercase/near-miss version string is rejected, not coerced", () => {
  assert.equal(sanitizeLastRead({ version: "bsb" }).version, DEFAULT.version);
  assert.equal(sanitizeLastRead({ version: "NIV" }).version, DEFAULT.version, "NIV is never licensed in this app");
});

test('sanitizeLastRead: parallel as the string "yes" falls back to DEFAULT.parallel only', () => {
  const result = sanitizeLastRead({ book: 19, chapter: 5, version: "ASV", parallel: "yes" });
  assert.equal(result.parallel, DEFAULT.parallel);
  assert.equal(result.book, 19, "book must survive");
  assert.equal(result.chapter, 5, "chapter must survive");
  assert.equal(result.version, "ASV", "version must survive");
});

test("sanitizeLastRead: parallel as 1/0 (truthy/falsy, not a real boolean) is rejected", () => {
  assert.equal(sanitizeLastRead({ parallel: 1 }).parallel, DEFAULT.parallel);
  assert.equal(sanitizeLastRead({ parallel: 0 }).parallel, DEFAULT.parallel);
});

test("sanitizeLastRead: every field wrong at once still lands on DEFAULT for every field", () => {
  assert.deepEqual(
    sanitizeLastRead({ book: -1, chapter: -1, version: "nope", parallel: "nope" }),
    DEFAULT,
  );
});

test("sanitizeLastRead: non-object top-level input (array, string, number, null) is DEFAULT", () => {
  assert.deepEqual(sanitizeLastRead(null), DEFAULT);
  assert.deepEqual(sanitizeLastRead(undefined), DEFAULT);
  assert.deepEqual(sanitizeLastRead("not-an-object"), DEFAULT);
  assert.deepEqual(sanitizeLastRead(42), DEFAULT);
  assert.deepEqual(sanitizeLastRead([1, 2, 3]), DEFAULT);
});

test("sanitizeLastRead: missing fields fall back to DEFAULT per field", () => {
  assert.deepEqual(sanitizeLastRead({}), DEFAULT);
  assert.deepEqual(sanitizeLastRead({ book: 19 }), { ...DEFAULT, book: 19 });
});

// ---------------------------------------------------------------------------
// getLastRead(): the DOM-touching wrapper. This test run has no window (see
// the sanity assertion below, same pattern tests/theme.test.ts uses for
// `document`), so what's provable here is the safe-outside-a-browser
// default, matching DEFAULT exactly.
// ---------------------------------------------------------------------------

test("getLastRead falls back to DEFAULT where window is unavailable", () => {
  assert.equal(typeof window, "undefined", "sanity: this test run has no DOM");
  assert.deepEqual(getLastRead(), DEFAULT);
});

test("setLastRead does not throw where window is unavailable", () => {
  assert.doesNotThrow(() => setLastRead({ book: 19, chapter: 3 }));
});

// ---------------------------------------------------------------------------
// A-038 hydration-safety proof: readLastReadSnapshot (client) and
// readLastReadServerSnapshot (server) must agree on what a Server Component
// would have rendered, or BookPicker.tsx's useSyncExternalStore call would
// hydration-mismatch the instant real localStorage disagrees with DEFAULT.
// Outside a browser, readLastReadSnapshot() falls through to getLastRead()'s
// own `typeof window === "undefined"` guard, so this is a real proof that
// the two snapshots the store exposes cannot disagree in that case -- not
// just two separate assertions against the same literal.
// ---------------------------------------------------------------------------

test("readLastReadSnapshot and readLastReadServerSnapshot agree outside a browser (no hydration mismatch)", () => {
  assert.deepEqual(readLastReadSnapshot(), DEFAULT);
  assert.deepEqual(readLastReadServerSnapshot(), DEFAULT);
  assert.deepEqual(readLastReadSnapshot(), readLastReadServerSnapshot());
});

test("subscribeLastRead returns a working no-op unsubscribe outside a browser", () => {
  const unsubscribe = subscribeLastRead(() => {
    throw new Error("must never be called without a window");
  });
  assert.doesNotThrow(unsubscribe);
});

// ---------------------------------------------------------------------------
// reconcileLastReadSnapshot: the getSnapshot stability contract.
//
// useSyncExternalStore requires getSnapshot to return the SAME reference
// across calls when nothing changed -- a bare `return getLastRead()` (which
// this file used to do) constructs a fresh object from JSON.parse on every
// call, so Object.is(previous, next) is always false even for identical
// data, and React re-renders forever trying to converge. This was a real
// bug in the first cut of A-038's fix, caught during READCORRECT-001's own
// review of the just-merged code (lib/sync/clear.ts's readDeviceNotCleared
// sidesteps this by returning a primitive, where same-value equality
// already IS reference equality -- LastRead is an object, so that same
// shape does not carry over here without deliberate caching).
// ---------------------------------------------------------------------------

test("reconcileLastReadSnapshot: same raw string returns the exact cached reference, not a new object", () => {
  const raw = '{"book":43,"chapter":3,"version":"KJV","parallel":true}';
  const cached: import("@/lib/bible/lastRead").LastReadSnapshotCache = {
    raw,
    value: { book: 43, chapter: 3, version: "KJV", parallel: true },
  };
  const result = reconcileLastReadSnapshot(raw, cached);
  assert.strictEqual(result, cached.value, "must be the SAME object reference, not merely deep-equal");
});

test("reconcileLastReadSnapshot: a genuinely different raw string produces a fresh, correctly parsed value", () => {
  const cached: import("@/lib/bible/lastRead").LastReadSnapshotCache = {
    raw: '{"book":43,"chapter":3,"version":"KJV","parallel":true}',
    value: { book: 43, chapter: 3, version: "KJV", parallel: true },
  };
  const nextRaw = '{"book":5,"chapter":1,"version":"BSB","parallel":false}';
  const result = reconcileLastReadSnapshot(nextRaw, cached);
  assert.notStrictEqual(result, cached.value, "a real change must not reuse the stale cached reference");
  assert.deepEqual(result, { book: 5, chapter: 1, version: "BSB", parallel: false });
});

test("reconcileLastReadSnapshot: null raw (nothing stored) returns DEFAULT, cache miss or not", () => {
  const freshCache: import("@/lib/bible/lastRead").LastReadSnapshotCache = { raw: undefined, value: DEFAULT };
  assert.deepEqual(reconcileLastReadSnapshot(null, freshCache), DEFAULT);
});

test("reconcileLastReadSnapshot: a repeated call sequence never allocates a new object for an unchanged value (simulated render loop)", () => {
  const raw = '{"book":19,"chapter":9,"version":"ASV","parallel":false}';
  const cache: import("@/lib/bible/lastRead").LastReadSnapshotCache = {
    raw: undefined,
    value: DEFAULT,
  };
  const first = reconcileLastReadSnapshot(raw, cache);
  cache.raw = raw;
  cache.value = first;
  // Simulates useSyncExternalStore calling getSnapshot again on the very
  // next render/commit check with nothing having changed in between.
  for (let i = 0; i < 5; i += 1) {
    const again = reconcileLastReadSnapshot(raw, cache);
    assert.strictEqual(again, first, `call ${i + 2} must return the same reference as call 1`);
  }
});
