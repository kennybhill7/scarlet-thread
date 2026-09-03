/**
 * ISRAELPROTO-001 → ISRAELFILTER-001 — the Israel sub-arc, now real.
 *
 * ISRAELPROTO-001 built this module as hand-typed, deliberately-fake
 * structure (six phases, real book names, real chapter ranges, but "no row
 * here comes from ... db/schema.ts, data/seed/stages.json, or any
 * migration") purely so Ken could click through the ridge/sheet navigation
 * FEEL before committing to a real schema. design/STORY_SPINE_DECISIONS.md
 * decision 4 settled that commitment: the stage-5 sub-arc is "a filter on
 * the existing stage view" -- and web/lib/bible/storySpine.ts (STORYSPINE-
 * 001) now carries the real `phase` field this filter needs. ISRAELFILTER-
 * 001 (this task) replaces the hand-typed array below with one derived from
 * STORY_SPINE, so there is exactly one source of truth for "what's in the
 * Israel sub-arc," not two that can drift apart.
 *
 * RECONCILING TWO TAXONOMIES: ISRAELPROTO-001's six phases were Patriarchs,
 * Exodus, Conquest, Kingdom, Exile, Return. STORY_SPINE's real `phase` field
 * (StorySpinePhase in storySpine.ts) is ALSO six phases, but not the same
 * six: Patriarchs, Exodus, Conquest, Kingdom, "Divided & Warned", "Exile &
 * Return" -- the real data merges the prototype's separate Exile/Return into
 * one phase and adds "Divided & Warned" (the divided-kingdom/prophetic-
 * warning chapters, story-14 through story-16) that the prototype never had.
 * This file uses the REAL six, not the prototype's -- so `slug`s changed
 * from "exile"/"return" to "divided-and-warned"/"exile-and-return" (no
 * caller outside this module hard-codes the old slugs; IsraelSubArcRidge and
 * IsraelSubArcPrototype both read `ISRAEL_SUB_ARC_PHASES` itself, never a
 * literal slug string, so this rename has no other call site to update
 * beyond this module's own tests).
 *
 * `range` (the human summary shown on the ridge and atop the detail sheet)
 * is now COMPUTED, not hand-typed: the phase's first chapter's first passage
 * through its last chapter's last passage, in STORY_SPINE's own chapter
 * order (see `rangeLabel` below). It therefore cannot silently drift from
 * the passages it summarizes the way a hand-typed string could.
 *
 * `chapters` is new: every real StorySpineChapter belonging to the phase, in
 * STORY_SPINE's own order, carried through so IsraelSubArcDetail.tsx can
 * list real titles and real, working links into the chapter reader --
 * see `passageHref` below for that URL's exact shape.
 */

import {
  STORY_SPINE,
  stagesOf,
  type StorySpineChapter,
  type StorySpinePassage,
  type StorySpinePhase,
} from "@/lib/bible/storySpine";

export interface IsraelSubArcPhase {
  /** Stable id for keys, aria-labels, and the selected-phase URL-free state. */
  slug: string;
  /** Display/ridge order, 1-6, Patriarchs through Exile & Return. */
  order: number;
  name: StorySpinePhase;
  /** Human chapter range, computed from real passages -- see `rangeLabel`. */
  range: string;
  /**
   * Kingdom only. The sub-arc's own peak: the Davidic covenant is cut here,
   * and most of the prophetic books look back from this vantage point --
   * see ISRAELPROTO-001's own spec, unchanged by this task. Gets the same
   * "peak" visual treatment the real Mountain gives its stage 6.
   */
  peak: boolean;
  /** Every real STORY_SPINE chapter in this phase, in STORY_SPINE's own order. */
  chapters: readonly StorySpineChapter[];
}

// ---------------------------------------------------------------------------
// Book names -- for display only ("Genesis 12" / "Genesis 12–13"), never for
// routing (passageHref below routes by numeric book, same as stageHref()).
// A small static copy of web/public/bible/index.json's own `books[].name`
// list (canonical order, 1-66; index 0 unused), kept in source rather than
// fetched: IsraelSubArcRidge and IsraelSubArcDetail are both deliberately
// HOOKLESS ("props in, markup out" -- see their own headers) so
// tests/israel-sub-arc.test.ts can render them synchronously through
// react-dom/server's renderToStaticMarkup; a fetch()'d index would force
// either an async loading state into that render path or a second,
// drifting copy of the book-name convention already established there.
// ---------------------------------------------------------------------------
const BOOK_NAMES: readonly string[] = [
  "",
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
  "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther",
  "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel",
  "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
  "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
  "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews",
  "James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation",
];

export function bookName(bookNumber: number): string {
  return BOOK_NAMES[bookNumber] ?? `Book ${bookNumber}`;
}

/** "Genesis 35" (from === to) or "Genesis 12–13" (a span). */
export function passageLabel(passage: StorySpinePassage): string {
  const name = bookName(passage.book);
  return passage.from === passage.to ? `${name} ${passage.from}` : `${name} ${passage.from}–${passage.to}`;
}

/**
 * The real chapter reader's URL, same shape stageHref() (mountainGeometry.ts)
 * already builds and app/(app)/read/[book]/[chapter]/page.tsx already
 * parses: `/read/<book>/<chapter>`, `book` the bare 1-66 canonical number --
 * no slug conversion exists or is needed anywhere in this app (see
 * lib/bible/reference.ts's own header: "Book numbers are canonical order
 * (1-66)"). Always the passage's FIRST chapter (`from`), matching
 * stageHref()'s own "first chapter of the span" convention.
 */
export function passageHref(passage: StorySpinePassage): string {
  return `/read/${passage.book}/${passage.from}`;
}

// ---------------------------------------------------------------------------
// Phase grouping -- derived from STORY_SPINE, not hand-typed.
// ---------------------------------------------------------------------------

/**
 * The six real phases, in ridge order. Names/order/peak are fixed content
 * decisions (same as ISRAELPROTO-001's own ordering), not derived from the
 * data -- but which CHAPTERS fall under each phase, and the range each one
 * summarizes, are.
 */
const PHASE_META: readonly { slug: string; name: StorySpinePhase; peak: boolean }[] = [
  { slug: "patriarchs", name: "Patriarchs", peak: false },
  { slug: "exodus", name: "Exodus", peak: false },
  { slug: "conquest", name: "Conquest", peak: false },
  { slug: "kingdom", name: "Kingdom", peak: true },
  { slug: "divided-and-warned", name: "Divided & Warned", peak: false },
  { slug: "exile-and-return", name: "Exile & Return", peak: false },
];

/** Every STORY_SPINE chapter belonging to stage 5 (Israel), in file order. */
const STAGE_5_CHAPTERS: readonly StorySpineChapter[] = STORY_SPINE.filter((entry) =>
  stagesOf(entry).includes(5),
);

function firstPassageOf(chapter: StorySpineChapter): StorySpinePassage {
  return chapter.passages[0];
}

function lastPassageOf(chapter: StorySpineChapter): StorySpinePassage {
  return chapter.passages[chapter.passages.length - 1];
}

/**
 * The phase's overall span: its first chapter's first passage through its
 * last chapter's last passage (both in STORY_SPINE's own order). Computed,
 * never hand-typed, so it cannot drift from the passages it summarizes --
 * unlike ISRAELPROTO-001's hand-typed `range` strings, which this replaces.
 */
function rangeLabel(chapters: readonly StorySpineChapter[]): string {
  if (chapters.length === 0) return "";
  const start = firstPassageOf(chapters[0]);
  const end = lastPassageOf(chapters[chapters.length - 1]);
  const startLabel = `${bookName(start.book)} ${start.from}`;
  const endLabel = end.book === start.book ? String(end.to) : `${bookName(end.book)} ${end.to}`;
  return `${startLabel}–${endLabel}`;
}

export const ISRAEL_SUB_ARC_PHASES: readonly IsraelSubArcPhase[] = PHASE_META.map((meta, index) => {
  const chapters = STAGE_5_CHAPTERS.filter((chapter) => chapter.phase === meta.name);
  return {
    slug: meta.slug,
    order: index + 1,
    name: meta.name,
    peak: meta.peak,
    chapters,
    range: rangeLabel(chapters),
  };
});

/** Fixed at Kingdom (order 4) per the sub-arc's own six-phase ordering -- not
 * derived from array length the way Mountain.tsx derives its stage-6 peak
 * from stage count, since this arc's peak position is content Ken specified
 * directly (ISRAELPROTO-001). */
export const ISRAEL_SUB_ARC_PEAK_ORDER = 4;

/**
 * Ridge elevation — same ascent-to-a-peak-then-descent shape as
 * Mountain.tsx's own `elevationOf`, ported rather than imported (that
 * function is unexported, and Mountain.tsx is out of scope for this module
 * to depend on). Higher return value = higher on the ridge.
 */
export function elevationOf(order: number, peakOrder: number): number {
  return peakOrder - 1 - Math.abs(order - peakOrder);
}

export function phaseBySlug(slug: string): IsraelSubArcPhase | undefined {
  return ISRAEL_SUB_ARC_PHASES.find((phase) => phase.slug === slug);
}
