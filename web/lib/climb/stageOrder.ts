/**
 * MOUNTAINWHY-001 — the canonical-order toggle for the "Why this shape?"
 * screen (design/PRODUCT_EXPERIENCE_PLAN_2026-09-25.md §A.5's own key-screen
 * row: "switch Journey ordering (canonical / lens / approximate
 * chronology)"; §I decision 1 recommends disclosing the 11-stage Mountain
 * "with a canonical-order toggle"). Two real, derivable orderings of the
 * same 11 stages:
 *
 *   - lensOrder — this app's own ascent/peak/descent mirror reading:
 *     `stage.stage` (1-11), exactly as content/lens/eleven-stages.json and
 *     the `stages` DB table already carry it.
 *   - canonicalOrder — strict Genesis-to-Revelation book order, independent
 *     of the lens's ascent/descent/mirror framing.
 *
 * HONEST FINDING, stated plainly rather than hidden: for THIS app's real 11
 * stages, canonicalOrder and lensOrder produce the identical sequence of 11
 * items. Every stage's own opening book/chapter (CANONICAL_STARTS below) is
 * already non-decreasing in lens-stage order -- the "ascent" side is simply
 * Genesis read forward, the "descent" side is Acts through Revelation read
 * forward, and nothing in this data set runs backward through the canon.
 * The toggle therefore does not reorder the 11 stages; what it demonstrates
 * is that the lens's ascent/peak/descent/mirror-pair FRAMING is a layer on
 * top of plain canonical reading order, not a different sequence of
 * passages. The "Why this shape?" page (app/(app)/mountain-why/page.tsx)
 * says this directly rather than building a toggle that pretends to do more
 * than it does.
 *
 * CANONICAL_STARTS is NOT derived from `stage.chapters[0]` (that field is an
 * entries-matching anchor, not a range boundary -- see
 * `lib/bible/covenants.ts`'s own header, which documents the same caution
 * for the identical data) and NOT parsed from stage titles (three stages --
 * Israel, the Gospels, the Church -- name a book RANGE with no single
 * chapter in the title text, e.g. "Genesis 12 - Malachi", so a title parse
 * would have no chapter to extract for them). It is instead the same
 * per-stage opening book/chapter `lib/bible/covenants.ts`'s own
 * `STAGE_RANGES`/`stageSlugForRef` already establish and test, restated here
 * as a small, explicit, independently-testable table rather than imported
 * (covenants.ts's `STAGE_RANGES` is a private, unexported const, and three of
 * this table's 11 rows -- Israel, the Gospels, the Church -- aren't rows in
 * that table at all, handled instead by `stageSlugForRef`'s own book-range
 * branches). `tests/stage-order.test.ts` cross-checks every row below
 * against `stageSlugForRef(book, chapter)` so the two cannot silently drift
 * apart.
 */

export interface OrderableStage {
  slug: string;
  stage: number;
}

interface CanonicalStart {
  slug: string;
  book: number;
  chapter: number;
}

const GENESIS = 1;
const MATTHEW = 40;
const ACTS = 44;
const REVELATION = 66;

export const CANONICAL_STARTS: readonly CanonicalStart[] = [
  { slug: "gen-01-02-creation", book: GENESIS, chapter: 1 },
  { slug: "gen-03-05-sin-enters", book: GENESIS, chapter: 3 },
  { slug: "gen-06-09-the-flood", book: GENESIS, chapter: 6 },
  { slug: "gen-10-11-babel", book: GENESIS, chapter: 10 },
  { slug: "gen-12-malachi-israel", book: GENESIS, chapter: 12 },
  { slug: "gospels-jesus-christ", book: MATTHEW, chapter: 1 },
  { slug: "acts-jude-the-church", book: ACTS, chapter: 1 },
  { slug: "rev-01-18-babylon", book: REVELATION, chapter: 1 },
  { slug: "rev-06-19-the-world-judged", book: REVELATION, chapter: 6 },
  { slug: "rev-20-satan-cast-out", book: REVELATION, chapter: 20 },
  // Same opening chapter as the row above -- both stages open within
  // Revelation 20 (the chapter narrates Satan's judgment in 20:1-10, then
  // the great white throne and the new creation from 20:11 on). Tied here on
  // purpose; canonicalOrder's tie-break (ascending stage number) resolves it
  // the same direction `stageSlugForRef`'s own documented first-match-wins
  // rule does for this exact chapter (covenants.ts header).
  { slug: "rev-20-22-paradise-restored", book: REVELATION, chapter: 20 },
] as const;

const CANONICAL_START_BY_SLUG: ReadonlyMap<string, CanonicalStart> = new Map(
  CANONICAL_STARTS.map((entry) => [entry.slug, entry]),
);

/** The lens's own order -- ascent (1-6) to the peak to descent (6-11). Pure, stable sort. */
export function lensOrder<T extends OrderableStage>(stages: readonly T[]): T[] {
  return [...stages].sort((a, b) => a.stage - b.stage);
}

/**
 * Strict canonical/biblical book order. A stage slug absent from
 * `CANONICAL_STARTS` sorts last, by its own lens stage number, rather than
 * throwing -- fail-soft here because this is a display ordering, not a
 * data-integrity gate; `tests/stage-order.test.ts`'s cross-check against
 * `stageSlugForRef` is the real gate on whether this table is correct.
 */
export function canonicalOrder<T extends OrderableStage>(stages: readonly T[]): T[] {
  return [...stages].sort((a, b) => {
    const startA = CANONICAL_START_BY_SLUG.get(a.slug);
    const startB = CANONICAL_START_BY_SLUG.get(b.slug);
    if (!startA && !startB) return a.stage - b.stage;
    if (!startA) return 1;
    if (!startB) return -1;
    if (startA.book !== startB.book) return startA.book - startB.book;
    if (startA.chapter !== startB.chapter) return startA.chapter - startB.chapter;
    return a.stage - b.stage;
  });
}

/**
 * True when `canonicalOrder` and `lensOrder` produce a genuinely different
 * sequence for `stages` -- see this module's header. For the app's real 11
 * stages this is false today; kept as a real, callable check (rather than a
 * hardcoded assumption in the UI) so the "Why this shape?" page's own copy
 * stays correct automatically if the lens data ever changes instead of
 * silently going stale.
 */
export function ordersDiffer<T extends OrderableStage>(stages: readonly T[]): boolean {
  const lens = lensOrder(stages);
  const canonical = canonicalOrder(stages);
  return lens.some((stage, index) => stage.slug !== canonical[index]?.slug);
}
