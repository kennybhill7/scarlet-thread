import { readFile } from "node:fs/promises";
import path from "node:path";

import { db } from "@/lib/db";
import { listGraphEdgesForChapter, listTopGraphEdges, type GraphEdgeRow } from "@/lib/db/graphEdges";
import type { BookMeta } from "@/lib/contracts";
import {
  buildStoryMapBaseline,
  findChapterSegment,
  parseChapterQueryValue,
  type StoryMapBaseline,
} from "@/lib/map/storyMapLayout";
import { StoryMap, type StoryMapOverviewMeta, type StoryMapSelection } from "@/components/map/StoryMap";

/**
 * STORYMAP-001 — the Story Map: a full-canon cross-reference arc diagram
 * (`components/map/StoryMap.tsx`), the same idea as the classic 2007-2008
 * Chris Harrison/Christoph Romhild Bible cross-reference visualization — all
 * 66 books laid along one line, curved arcs connecting related passages.
 *
 * Harrison's actual image is licensed for personal, non-commercial use ONLY
 * (verified directly, 2026-09-11, before this feature was ever proposed) —
 * it is never copied here, in any form (pixels, exact colors, or vote
 * cutoffs). What this app draws instead: its OWN rendering
 * (StoryMap.tsx/ChapterBaseline.tsx/storyMapLayout.ts), of its OWN real,
 * separately-licensed data (GRAPHEDGES-001's `graph_edges` table, 341,223
 * cross-references from OpenBible.info, CC BY 4.0), in its OWN palette
 * (this app's real `--shell-*`/`--shell-crimson` tokens, styled to read as
 * THE SCARLET THREAD — see StoryMap.module.css's own COLOR TREATMENT
 * comment for that decision, made directly by Ken mid-build).
 *
 * AUTH: this page has no session check of its own — `app/(app)/layout.tsx`
 * already gates every route in this group (the same reason
 * `app/(app)/settings/page.tsx` has none either; see that page for the
 * precedent). `graph_edges` is curated, global, read-only content with no
 * `userId`/`workspaceId` column at all (`db/schema.ts`'s own doc comment:
 * "curated content is architecturally different... never independently
 * edited"), so no further per-request ownership check applies here.
 *
 * TWO REAL, SERVER-FILTERED VIEWS (341,223 rows never ship to the client as
 * one blob — this task's own acceptance criterion):
 *   - OVERVIEW (`?c=` absent): `listTopGraphEdges` — only the
 *     highest-confidence edges, real `LIMIT` — see OVERVIEW_MIN_VOTES/
 *     OVERVIEW_LIMIT below for where those two numbers come from (a real
 *     measured static-harness render, not a guess).
 *   - CHAPTER FOCUS (`?c=<book>.<chapter>`): `listGraphEdgesForChapter` — one
 *     chapter's real ~287-edge average, not vote-filtered.
 * Both flow through the exact same `<StoryMap>` component — see that file's
 * own header for why there is no per-view rendering fork.
 */

// ---------------------------------------------------------------------------
// OVERVIEW DEFAULTS — chosen from a real measured static-harness render at
// three real candidate sizes, NOT guessed. Technique: `renderToStaticMarkup`
// of the real `<StoryMap>` component + this app's real CSS (globals.css +
// StoryMap.module.css) inlined into a static HTML file, served from a local
// Node http server, loaded in a real (Playwright-driven) browser, timed via
// the real Navigation Timing / Paint Timing APIs — the same
// render-to-static-markup + real-CSS + local-server technique
// MOUNTAINPLATES_STATUS.md's own precedent used, substituting Playwright for
// the CLI `msedge --headless --screenshot` invocation after that invocation
// failed in this environment with a real, reproducible Chromium error
// ("Multiple targets are not supported in headless mode") — see this task's
// own build report for the full story.
//
// Candidates were real edge counts sliced from the real checked-in
// `scripts/data/cross-references.txt` (via the same `buildImportPlan` this
// app's own import script uses), at the real vote thresholds a direct
// histogram of that file gives for ~2,000 / ~10,000 / ~40,000 rows:
//
//   communityVotes >= 80  ->  2,003 edges  -- nav duration  73ms, FCP  180ms
//   communityVotes >= 29  -> 10,195 edges  -- nav duration  85ms, FCP  512ms
//   communityVotes >= 10  -> 44,491 edges  -- nav duration 356ms, FCP 1216ms
//
// (`renderToStaticMarkup` itself, i.e. the SERVER-side cost this page pays
// on every real request, scaled similarly: 78ms / 88ms / 194ms.)
//
// The ~10,000 tier is the real, measured choice: comfortably under ~550ms
// first paint end to end (server render + browser parse/layout/paint), a
// meaningfully richer overview than the ~2,000 tier, with real headroom
// below the ~40,000 tier's measured 1.2s+ first paint — the "measurable,
// real slowdown" this task's own acceptance criteria asked this harness to
// find. `minVotes: 29` is the exact real threshold measured above;
// `limit: 11_000` is a safety cap slightly above the real 10,195-row result
// (never the tuning knob itself), so a future re-import with a slightly
// different vote distribution can't silently balloon past the measured,
// verified band.
// ---------------------------------------------------------------------------
export const OVERVIEW_MIN_VOTES = 29;
export const OVERVIEW_LIMIT = 11_000;

interface BibleIndexFile {
  books: BookMeta[];
}

interface BookDataFile {
  c: unknown[][];
}

const BIBLE_DIR = path.join(process.cwd(), "public", "bible");

/**
 * Reads the real shipped corpus (`public/bible/index.json` +
 * `public/bible/BSB/*.json`) to build a real per-chapter verse-count lookup
 * — the exact same technique `scripts/import-cross-references.mts`'s own
 * `buildRealCanonTable()` already established for this repo (that function's
 * own header is this one's direct precedent). Real filesystem IO,
 * deliberately kept out of `lib/map/storyMapLayout.ts` so that module stays
 * pure and DOM/IO-free (see its own header).
 */
async function loadRealBibleIndex(): Promise<BibleIndexFile> {
  const raw = await readFile(path.join(BIBLE_DIR, "index.json"), "utf8");
  return JSON.parse(raw) as BibleIndexFile;
}

async function loadRealVerseCounts(
  books: readonly BookMeta[],
): Promise<(book: number, chapter: number) => number | undefined> {
  const verseCounts = new Map<string, number>();
  await Promise.all(
    books.map(async (book) => {
      const raw = await readFile(path.join(BIBLE_DIR, "BSB", `${book.n}.json`), "utf8");
      const data = JSON.parse(raw) as BookDataFile;
      data.c.forEach((verses, i) => verseCounts.set(`${book.n}.${i + 1}`, verses.length));
    }),
  );
  return (book, chapter) => verseCounts.get(`${book}.${chapter}`);
}

export interface StoryMapDataDeps {
  loadIndex: () => Promise<BibleIndexFile>;
  loadVerseCounts: (books: readonly BookMeta[]) => Promise<(book: number, chapter: number) => number | undefined>;
  getTopEdges: (options: { minVotes: number; limit: number }) => Promise<GraphEdgeRow[]>;
  getChapterEdges: (book: number, chapter: number) => Promise<GraphEdgeRow[]>;
}

const defaultStoryMapDataDeps: StoryMapDataDeps = {
  loadIndex: loadRealBibleIndex,
  loadVerseCounts: loadRealVerseCounts,
  getTopEdges: (options) => listTopGraphEdges(db, options),
  getChapterEdges: (book, chapter) => listGraphEdgesForChapter(db, book, chapter),
};

export interface StoryMapViewModel {
  mode: "overview" | "chapter";
  baseline: StoryMapBaseline;
  edges: GraphEdgeRow[];
  selected: StoryMapSelection | null;
  overviewMeta: StoryMapOverviewMeta | null;
  invalidSelection: boolean;
}

/**
 * The one seam between this page and its real data sources (filesystem +
 * database) — same `*DataDeps`-parameter shape `app/(app)/page.tsx`'s own
 * `loadClimbViewModel` already established, so `tests/story-map.test.ts` can
 * exercise every real decision here (which view, which chapter, the
 * overview's summary numbers, an invalid `?c=` degrading gracefully) with
 * small injected fixtures — no real filesystem read, no real database
 * connection, in that test file at all.
 */
export async function loadStoryMapViewModel(
  rawChapterParam: string | null,
  deps: StoryMapDataDeps = defaultStoryMapDataDeps,
): Promise<StoryMapViewModel> {
  const index = await deps.loadIndex();
  const verseCount = await deps.loadVerseCounts(index.books);
  const baseline = buildStoryMapBaseline(index.books, verseCount);

  const bookName = (bookNumber: number) => baseline.books.find((b) => b.book === bookNumber)?.name ?? `Book ${bookNumber}`;

  const selection = parseChapterQueryValue(rawChapterParam);
  const resolvedChapter = selection ? findChapterSegment(baseline, selection.book, selection.chapter) : undefined;

  if (selection && resolvedChapter) {
    const edges = await deps.getChapterEdges(selection.book, selection.chapter);
    return {
      mode: "chapter",
      baseline,
      edges,
      selected: {
        book: selection.book,
        chapter: selection.chapter,
        label: `${bookName(selection.book)} ${selection.chapter}`,
      },
      overviewMeta: null,
      invalidSelection: false,
    };
  }

  // Either no ?c= at all (the real default view), or a ?c= that did not
  // resolve to a real chapter (a stale bookmark / hand-edited URL) -- both
  // fall through to the real overview rather than a blank page or a thrown
  // error; `invalidSelection` tells StoryMap.tsx which of the two it was, so
  // it can show an honest notice only in the second case.
  const edges = await deps.getTopEdges({ minVotes: OVERVIEW_MIN_VOTES, limit: OVERVIEW_LIMIT });
  return {
    mode: "overview",
    baseline,
    edges,
    selected: null,
    overviewMeta: { minVotes: OVERVIEW_MIN_VOTES, limit: OVERVIEW_LIMIT, shown: edges.length },
    invalidSelection: selection !== null,
  };
}

interface StoryMapPageProps {
  searchParams: Promise<{ c?: string | string[] }>;
}

export default async function StoryMapPage({ searchParams }: StoryMapPageProps) {
  const resolved = await searchParams;
  const raw = Array.isArray(resolved.c) ? resolved.c[0] : resolved.c;
  const view = await loadStoryMapViewModel(raw ?? null);

  return (
    <StoryMap
      baseline={view.baseline}
      edges={view.edges}
      mode={view.mode}
      selected={view.selected}
      overviewMeta={view.overviewMeta}
      invalidSelection={view.invalidSelection}
    />
  );
}
