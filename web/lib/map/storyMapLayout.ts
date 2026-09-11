/**
 * STORYMAP-001 — pure geometry for the Story Map (a full-canon cross-reference
 * arc diagram, same idea as the classic Chris Harrison/Christoph Romhild Bible
 * visualization, built entirely on this app's own real data and own math —
 * see `web/app/(app)/map/page.tsx`'s header for the copyright note on why
 * Harrison's actual image is never copied here).
 *
 * No React, no DOM, no `fs`, no DB — same discipline `lib/climb/plateGeometry.ts`
 * and `lib/climb/mountainGeometry.ts` already established (imported by both a
 * client component and plain `node:test`). The one piece of real-world data
 * this needs — how many verses each of the 1,189 real chapters has — is never
 * hardcoded here: callers inject a `verseCount` lookup, built from the real
 * shipped `public/bible/index.json` + `public/bible/BSB/*.json` corpus the
 * exact same way `scripts/import-cross-references.mts`'s own
 * `buildRealCanonTable()` already does (that IO — and this module's real
 * caller — lives in `app/(app)/map/page.tsx`, a Server Component, not here).
 *
 * THE BASELINE: one horizontal line, all 66 books in canonical order, all
 * 1,189 chapters laid end to end. Each chapter's WIDTH is its own real verse
 * count (`buildStoryMapBaseline`) — the same technique Harrison's original
 * diagram used, computed fresh from this app's own corpus rather than
 * approximated or hand-copied. A book with more/longer chapters occupies more
 * of the line; Psalm 119 (176 verses, the Bible's longest chapter) renders
 * visibly wider than Psalm 117 (2 verses, the shortest) or Obadiah's one
 * 21-verse chapter — see tests/story-map-layout.test.ts's real-data test.
 *
 * THE ARCS: one SVG path per shown `graph_edges` row, a quadratic Bezier from
 * one chapter's midpoint on the baseline to another's, with its height scaled
 * by the real distance between them ALONG THE BASELINE (`buildArcsForEdges`)
 * — closer chapters get a shallow arc, farther-apart chapters get a tall one,
 * the same visual grammar Harrison's diagram used, computed from real data and
 * fresh math here, not copied pixel values.
 */

import { parseVerseKeyStrict } from "@/lib/bible/range";
import type { BookMeta, RefKey } from "@/lib/contracts";
import type { CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import type { EvidenceLabel } from "@/lib/contracts/study-v2";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// The baseline
// ---------------------------------------------------------------------------

export interface ChapterSegment {
  book: number;
  chapter: number;
  /** Absolute 1-1189 position in canonical reading order — matches
   * `lib/bible/reference.ts`'s `chapterOrdinal()` exactly (see the real-data
   * test that cross-checks the two independently). */
  ordinal: number;
  /** Real verse count for this exact chapter, from the injected `verseCount` lookup. */
  verseCount: number;
  /** Left edge, in "verse units" (1 unit = 1 verse) from the start of Genesis 1. */
  x: number;
  /** Equal to verseCount — the segment's own width in the same units. */
  width: number;
  /** x + width / 2 — where an arc touching this chapter anchors. */
  midX: number;
}

export interface BookSegment {
  book: number;
  name: string;
  abbr: string;
  x: number;
  width: number;
}

export interface StoryMapBaseline {
  /** Sum of every real verse count across the whole canon (31,102 for the
   * shipped BSB corpus) — the baseline's total width in verse units. */
  totalWidth: number;
  chapters: readonly ChapterSegment[];
  books: readonly BookSegment[];
}

/**
 * Builds the single horizontal baseline: all 66 books in the exact order
 * `books` is given (this app's own canonical order, `public/bible/index.json`),
 * all of each book's chapters, each chapter's width its own real verse count.
 * A chapter `verseCount` reports as `undefined` for (never hardcoded to a
 * fallback that would silently mis-lay the whole rest of the baseline).
 */
export function buildStoryMapBaseline(
  books: readonly BookMeta[],
  verseCount: (book: number, chapter: number) => number | undefined,
): StoryMapBaseline {
  const chapters: ChapterSegment[] = [];
  const bookSegments: BookSegment[] = [];
  let cursor = 0;
  let ordinal = 0;

  for (const book of books) {
    const bookStart = cursor;
    for (let chapter = 1; chapter <= book.chapters; chapter += 1) {
      ordinal += 1;
      const verses = Math.max(verseCount(book.n, chapter) ?? 0, 0);
      chapters.push({
        book: book.n,
        chapter,
        ordinal,
        verseCount: verses,
        x: round2(cursor),
        width: round2(verses),
        midX: round2(cursor + verses / 2),
      });
      cursor += verses;
    }
    bookSegments.push({
      book: book.n,
      name: book.name,
      abbr: book.abbr,
      x: round2(bookStart),
      width: round2(cursor - bookStart),
    });
  }

  return { totalWidth: round2(cursor), chapters, books: bookSegments };
}

function chapterMapKey(book: number, chapter: number): string {
  return `${book}.${chapter}`;
}

/** O(1) chapter lookup by (book, chapter) — built once per render, shared by
 * arc-building and by any caller (e.g. the page's chapter-focus validation)
 * that needs to check a chapter is real without re-scanning the array. */
export function indexChaptersByKey(baseline: StoryMapBaseline): ReadonlyMap<string, ChapterSegment> {
  return new Map(baseline.chapters.map((c) => [chapterMapKey(c.book, c.chapter), c]));
}

export function findChapterSegment(
  baseline: StoryMapBaseline,
  book: number,
  chapter: number,
): ChapterSegment | undefined {
  return baseline.chapters.find((c) => c.book === book && c.chapter === chapter);
}

/** The (book, chapter) a stored RefKey ("book.chapter.verse") belongs to —
 * reuses `lib/bible/range.ts`'s own strict verse-key parser rather than
 * re-implementing string splitting a second time. Returns null for a
 * malformed key rather than throwing; callers skip that edge, they never
 * crash the whole diagram over one bad row. */
export function chapterOfRefKey(refKey: RefKey): { book: number; chapter: number } | null {
  const parsed = parseVerseKeyStrict(refKey);
  return parsed ? { book: parsed.book, chapter: parsed.chapter } : null;
}

// ---------------------------------------------------------------------------
// The "jump to chapter" query value — one small round-trippable string
// shared by the page (parses it from `?c=`) and ChapterBaseline/StoryMap
// (build the same string into every chapter's href/option value), so the two
// sides of that contract can never drift out of sync with each other.
// ---------------------------------------------------------------------------

export function chapterQueryValue(book: number, chapter: number): string {
  return `${book}.${chapter}`;
}

const CHAPTER_QUERY_RE = /^([1-9]\d?)\.([1-9]\d{0,2})$/;

export function parseChapterQueryValue(value: string | null | undefined): { book: number; chapter: number } | null {
  if (!value) return null;
  const match = CHAPTER_QUERY_RE.exec(value);
  if (!match) return null;
  return { book: Number(match[1]), chapter: Number(match[2]) };
}

// ---------------------------------------------------------------------------
// Arc geometry
// ---------------------------------------------------------------------------

/** Shallowest arc — even zero-distance (rare same-chapter edges) still draws
 * a small, visible hump rather than a literally invisible flat line. */
export const ARC_MIN_HEIGHT = 3;
/** Tallest arc, at the two farthest-apart chapters in the whole canon
 * (Genesis 1 <-> Revelation 22). Tuned against BASELINE_Y in StoryMap.tsx so
 * the tallest arc still fits inside the SVG viewBox with headroom to spare. */
export const ARC_MAX_HEIGHT = 260;

/**
 * Arc height scaled by real distance along the baseline: `distance / totalWidth`
 * (0..1) interpolated between `minHeight` and `maxHeight`. Monotonic —
 * farther-apart chapters always get a taller arc than nearer ones, never the
 * reverse, and the closest possible pair and the two ends of the whole canon
 * both stay within [minHeight, maxHeight] by construction.
 */
export function arcHeightForDistance(
  distance: number,
  totalWidth: number,
  maxHeight: number = ARC_MAX_HEIGHT,
  minHeight: number = ARC_MIN_HEIGHT,
): number {
  if (totalWidth <= 0) return minHeight;
  const t = Math.min(1, Math.abs(distance) / totalWidth);
  return round2(minHeight + t * (maxHeight - minHeight));
}

/**
 * A single quadratic Bezier from `x1` to `x2`, sitting on `baselineY`, peaking
 * `height` units above it at the midpoint — the classic single-arc "rainbow"
 * shape. Always emitted left-to-right regardless of argument order, so two
 * edges between the same pair of chapters (whichever direction the row was
 * imported in) produce the identical path string.
 */
export function arcPathD(x1: number, x2: number, baselineY: number, height: number): string {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const midX = (left + right) / 2;
  const controlY = baselineY - height;
  return `M${round2(left)},${round2(baselineY)} Q${round2(midX)},${round2(controlY)} ${round2(right)},${round2(baselineY)}`;
}

// ---------------------------------------------------------------------------
// Building real arcs from real graph_edges rows
// ---------------------------------------------------------------------------

/** The exact shape `lib/db/graphEdges.ts`'s new query functions return — kept
 * as its own small interface here (rather than importing the Drizzle-backed
 * repository module into this pure file) so this module never depends on the
 * DB layer, only on plain data. */
export interface StoryMapEdgeInput {
  id: string;
  fromRange: CanonicalRangeV1;
  toRange: CanonicalRangeV1;
  evidenceLabel: EvidenceLabel;
  communityVotes: number;
}

export interface StoryMapArc {
  id: string;
  d: string;
  height: number;
  distance: number;
  evidenceLabel: EvidenceLabel;
  communityVotes: number;
  fromOrdinal: number;
  toOrdinal: number;
}

export interface BuildArcsOptions {
  /** The y-coordinate the baseline itself sits on, in the same SVG units as `baseline`. */
  baselineY: number;
  maxHeight?: number;
  minHeight?: number;
}

/**
 * Maps real `graph_edges` rows onto real arc paths. An edge whose `fromRange`
 * or `toRange` cannot be resolved to a real chapter on this baseline (a
 * malformed key, or a chapter genuinely outside this corpus) is skipped, not
 * thrown — one bad row must never blank the whole diagram. A same-chapter
 * edge (both ends resolve to the identical chapter — real, if rare, in the
 * source dataset) draws across that one chapter's own segment width instead
 * of collapsing to a zero-distance point, so it still renders as a small,
 * honest hump rather than disappearing.
 */
export function buildArcsForEdges(
  edges: readonly StoryMapEdgeInput[],
  baseline: StoryMapBaseline,
  options: BuildArcsOptions,
): StoryMapArc[] {
  const lookup = indexChaptersByKey(baseline);
  const arcs: StoryMapArc[] = [];

  for (const edge of edges) {
    const from = chapterOfRefKey(edge.fromRange.start);
    const to = chapterOfRefKey(edge.toRange.start);
    if (!from || !to) continue;

    const fromSeg = lookup.get(chapterMapKey(from.book, from.chapter));
    const toSeg = lookup.get(chapterMapKey(to.book, to.chapter));
    if (!fromSeg || !toSeg) continue;

    const sameChapter = fromSeg.ordinal === toSeg.ordinal;
    // Same-chapter edges span that one chapter's own real left/right edges
    // (not its midpoint) so `distance` comes out as exactly that chapter's
    // real width -- a small but genuinely nonzero hump, never a
    // zero-distance point.
    const x1 = sameChapter ? fromSeg.x : fromSeg.midX;
    const x2 = sameChapter ? fromSeg.x + fromSeg.width : toSeg.midX;
    const distance = Math.abs(x2 - x1);
    const height = arcHeightForDistance(distance, baseline.totalWidth, options.maxHeight, options.minHeight);

    arcs.push({
      id: edge.id,
      d: arcPathD(x1, x2, options.baselineY, height),
      height,
      distance: round2(distance),
      evidenceLabel: edge.evidenceLabel,
      communityVotes: edge.communityVotes,
      fromOrdinal: fromSeg.ordinal,
      toOrdinal: toSeg.ordinal,
    });
  }

  return arcs;
}
