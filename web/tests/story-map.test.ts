/**
 * STORYMAP-001 — tests for `app/(app)/map/page.tsx`'s DB-independent
 * data-assembly logic: `loadStoryMapViewModel`. Same `*DataDeps`-parameter
 * dependency-injection shape `app/(app)/page.tsx`'s own `loadClimbViewModel`/
 * `tests/climb-setup-state.test.ts` already established for this repo — every
 * fixture here is a small, hand-built in-memory stand-in (a tiny 2-book
 * index, a couple of chapters' verse counts, canned edge rows). No real
 * filesystem read of `public/bible/*`, no real database connection anywhere
 * in this file — `lib/map/storyMapLayout.ts`'s own real-data tests
 * (`tests/story-map-layout.test.ts`) already cover the real corpus.
 *
 * `page.tsx` statically imports `server-only`-guarded `@/lib/db` (for its
 * `defaultStoryMapDataDeps`, never actually invoked in this file — every
 * test below injects its own `deps`). `server-only` throws unconditionally
 * outside a real Next.js bundler, and `@/lib/db` opens a real Neon driver at
 * module scope; both are neutralised in `require.cache` before the page
 * module loads, the exact same technique `tests/climb-setup-state.test.ts`
 * already established for `app/(app)/page.tsx`'s own identical
 * `@/lib/db`/`server-only` imports (see that file's header).
 */

import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

import type { BookMeta } from "@/lib/contracts";
import type { CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import { CANONICAL_VERSIFICATION_ID } from "@/lib/contracts/range-v1";
import type { GraphEdgeRow } from "@/lib/db/graphEdges";

const nodeRequire = createRequire(__filename);

function seedModule(specifier: string, exports: Record<string, unknown>) {
  const resolved = nodeRequire.resolve(specifier);
  (nodeRequire.cache as Record<string, unknown>)[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    path: path.dirname(resolved),
    paths: [],
    children: [],
    exports: { __esModule: true, ...exports },
  };
  return resolved;
}

// CSS Modules resolve every requested class to its own name; plain node:test
// cannot parse raw CSS, same reason tests/climb-setup-state.test.ts stubs
// ClimbHero.module.css. StoryMap.tsx and ChapterBaseline.tsx both import
// this same one file (see StoryMap.module.css's own header).
const cssProxy = new Proxy({}, { get: (_target, key) => (typeof key === "string" ? key : undefined) });

seedModule("server-only", {});
seedModule("@/lib/db", { db: {} });
seedModule("@/components/map/StoryMap.module.css", { default: cssProxy });

const pageModule = nodeRequire("@/app/(app)/map/page.tsx") as {
  loadStoryMapViewModel: typeof import("../app/(app)/map/page").loadStoryMapViewModel;
  OVERVIEW_MIN_VOTES: typeof import("../app/(app)/map/page").OVERVIEW_MIN_VOTES;
  OVERVIEW_LIMIT: typeof import("../app/(app)/map/page").OVERVIEW_LIMIT;
};
const { loadStoryMapViewModel, OVERVIEW_MIN_VOTES, OVERVIEW_LIMIT } = pageModule;
type StoryMapDataDeps = import("../app/(app)/map/page").StoryMapDataDeps;

const FIXTURE_BOOKS: BookMeta[] = [
  { n: 1, name: "Genesis", abbr: "Gen", chapters: 2, testament: "OT" },
  { n: 2, name: "Exodus", abbr: "Exod", chapters: 1, testament: "OT" },
];

const FIXTURE_VERSE_COUNTS: Record<string, number> = {
  "1.1": 31,
  "1.2": 25,
  "2.1": 22,
};

function edgeRow(id: string, fromKey: string, toKey: string, votes: number): GraphEdgeRow {
  const range = (key: string): CanonicalRangeV1 => ({
    versificationId: CANONICAL_VERSIFICATION_ID,
    start: key,
    end: key,
  });
  return {
    id,
    fromRange: range(fromKey),
    toRange: range(toKey),
    type: "parallel",
    evidenceLabel: votes >= 50 ? "strong" : "plausible",
    communityVotes: votes,
  };
}

interface FixtureCalls {
  getTopEdges: { minVotes: number; limit: number }[];
  getChapterEdges: { book: number; chapter: number }[];
}

function buildFixtureDeps(overrides: Partial<StoryMapDataDeps> = {}): { deps: StoryMapDataDeps; calls: FixtureCalls } {
  const calls: FixtureCalls = { getTopEdges: [], getChapterEdges: [] };
  const deps: StoryMapDataDeps = {
    loadIndex: async () => ({ books: FIXTURE_BOOKS }),
    loadVerseCounts: async () => (book, chapter) => FIXTURE_VERSE_COUNTS[`${book}.${chapter}`],
    getTopEdges: async (options) => {
      calls.getTopEdges.push(options);
      return [edgeRow("top-1", "1.1.1", "2.1.1", 200)];
    },
    getChapterEdges: async (book, chapter) => {
      calls.getChapterEdges.push({ book, chapter });
      return [edgeRow("ch-1", "1.1.1", "1.2.1", 3)];
    },
    ...overrides,
  };
  return { deps, calls };
}

test("no ?c= at all -> OVERVIEW mode, real getTopEdges call with the module's own real OVERVIEW_MIN_VOTES/OVERVIEW_LIMIT, invalidSelection false", async () => {
  const { deps, calls } = buildFixtureDeps();
  const view = await loadStoryMapViewModel(null, deps);

  assert.equal(view.mode, "overview");
  assert.equal(view.selected, null);
  assert.equal(view.invalidSelection, false);
  assert.deepEqual(calls.getTopEdges, [{ minVotes: OVERVIEW_MIN_VOTES, limit: OVERVIEW_LIMIT }]);
  assert.equal(calls.getChapterEdges.length, 0, "overview mode must never call the chapter-scoped query");
  assert.deepEqual(view.overviewMeta, { minVotes: OVERVIEW_MIN_VOTES, limit: OVERVIEW_LIMIT, shown: 1 });
  assert.equal(view.edges.length, 1);
  assert.equal(view.edges[0].id, "top-1");
});

test("a real ?c=<book>.<chapter> for an existing chapter -> CHAPTER mode, real getChapterEdges call, no vote filter applied", async () => {
  const { deps, calls } = buildFixtureDeps();
  const view = await loadStoryMapViewModel("1.2", deps);

  assert.equal(view.mode, "chapter");
  assert.deepEqual(view.selected, { book: 1, chapter: 2, label: "Genesis 2" });
  assert.equal(view.invalidSelection, false);
  assert.deepEqual(calls.getChapterEdges, [{ book: 1, chapter: 2 }]);
  assert.equal(calls.getTopEdges.length, 0, "chapter mode must never call the vote-filtered overview query");
  assert.equal(view.overviewMeta, null);
  assert.equal(view.edges[0].id, "ch-1");
});

test("a ?c= naming a book/chapter that does not exist on the real baseline degrades to OVERVIEW with invalidSelection: true, not a thrown error", async () => {
  const { deps, calls } = buildFixtureDeps();
  const view = await loadStoryMapViewModel("1.99", deps); // book 1 only has 2 chapters

  assert.equal(view.mode, "overview");
  assert.equal(view.invalidSelection, true, "a real but out-of-range chapter must be flagged, not silently treated as no selection");
  assert.equal(calls.getChapterEdges.length, 0);
  assert.equal(calls.getTopEdges.length, 1);
});

test("a ?c= referencing a well-formed but nonexistent book number also degrades to OVERVIEW with invalidSelection: true", async () => {
  const { deps } = buildFixtureDeps();
  // "99.1" parses cleanly (parseChapterQueryValue's regex allows any 1-2
  // digit book number, matching the real canon's own 1-66 range's shape) but
  // book 99 does not exist in this fixture's own 2-book index -- a distinct
  // real case from "1.99" (a real book, chapter out of range) above.
  const view = await loadStoryMapViewModel("99.1", deps);
  assert.equal(view.mode, "overview");
  assert.equal(view.invalidSelection, true);
});

test("a ?c= that is not even well-formed (parseChapterQueryValue returns null) is treated as no selection at all -- OVERVIEW with invalidSelection: false", async () => {
  const { deps } = buildFixtureDeps();
  const view = await loadStoryMapViewModel("not-a-chapter", deps);
  assert.equal(view.mode, "overview");
  assert.equal(view.invalidSelection, false, "a garbage value that never even parsed is not the same case as a well-formed but nonexistent chapter");
});

test("book name resolution uses the real injected book list, not a hardcoded name, for the chapter-focus label", async () => {
  const { deps } = buildFixtureDeps();
  const view = await loadStoryMapViewModel("2.1", deps);
  assert.deepEqual(view.selected, { book: 2, chapter: 1, label: "Exodus 1" });
});

test("the baseline returned is built from the injected loadIndex/loadVerseCounts, not the real filesystem, in both modes", async () => {
  const { deps } = buildFixtureDeps();
  const overview = await loadStoryMapViewModel(null, deps);
  const chapter = await loadStoryMapViewModel("1.1", deps);
  assert.equal(overview.baseline.chapters.length, 3, "the fixture's own 3 chapters (Gen 1, Gen 2, Exod 1), not the real 1,189");
  assert.equal(chapter.baseline.chapters.length, 3);
  assert.equal(overview.baseline.totalWidth, 31 + 25 + 22);
});
