/**
 * COVENANTTIMELINE-001 — Part 1: the covenant rail's data.
 *
 * Every fact below is transcribed from `design/COVENANT_TIMELINE_RESEARCH.md`
 * Part 1 (institution locations, table 1.1; the app's-11-stage mapping,
 * table 1.3). Nothing here is invented, inferred beyond what that document
 * states, or filled in from background knowledge — see that document's own
 * Sources section for citations.
 *
 * DELIBERATE EXCLUSION (per the research doc's own §1.2/§3 recommendation
 * and this task's brief): nothing here asserts how the five covenants
 * *relate* to one another (covenant-of-grace vs. dispensational vs.
 * progressive-covenantalism framings — doc §1.2). Only institution-location
 * and basic-content facts from §1.1/§1.3 ship. Where the doc itself flags a
 * claim as tradition-dependent (stage 11's "are Abrahamic/Davidic promises
 * fulfilled here" question), that caution is surfaced as a caution, not
 * resolved one way or the other — this keeps the same non-interpretive line
 * `docs/decisions/2026-08-18-teaching-not-theology.md` draws for the rest of
 * the app: cited fact and named positions reported descriptively, never
 * adjudicated doctrine.
 *
 * KEYING CHOICE: primarily by stage slug (`STAGE_COVENANTS`), because that
 * is exactly the shape of the research doc's own §1.3 table — one row per
 * the app's 11 real stages (`web/data/seed/stages.json`), several of which
 * (stage 5 above all) carry more than one covenant fact. `stageSlugForRef`
 * and `covenantsForRef` are a derived convenience for callers (like the
 * reader) that only have a book/chapter, not a stage slug.
 *
 * That derived resolver is built from each stage's own title/slug-implied
 * chapter range (Genesis 1–2, Genesis 3–5, ... Revelation 20–22), NOT from
 * the `stages` DB row's `chapters` array. That array holds exactly one
 * "opening chapter" per stage — `app/(app)/page.tsx`'s own comment on
 * `buildMountainStages()` documents it as "a stage's opening chapter, per
 * the importer's documented approximation", used only to match study entries
 * back to a stage, not as a range boundary. Genesis 1 through Jude (books
 * 1–65) partitions cleanly and monotonically this way. Revelation (book 66)
 * does not: Ken's own stage titles overlap on purpose (stage 8 "Revelation
 * 1–18" / Babylon and stage 9 "Revelation 6–19" / The World Judged are two
 * thematic lenses over the same chapters, not a linear partition — this
 * mirrors the mirror-pair design the whole mountain uses, see stage 10/11's
 * own Revelation 20 overlap). Since every covenant fact for Revelation
 * (stages 8–10) is identical anyway ("New Covenant era continues; no new
 * covenant text instituted" — doc §1.3), the tie-break below cannot change
 * what fact is shown for chapters 1–19; it only decides which stage'
 * *title* is attached. The rule: first match wins, scanning stages in
 * ascending stage-number order — giving Revelation 1–18 → stage 8, 19 →
 * stage 9, 20 → stage 10, 21–22 → stage 11. This is this module's own
 * documented judgment call, not a fact sourced from the research doc or the
 * app's data model (flagged in the task report).
 */

import type { EpistemicBasis } from "@/lib/contracts/study-v2";

export type CovenantName = "Noahic" | "Abrahamic" | "Mosaic" | "Davidic" | "New";

export type CovenantStatus =
  /** The covenant's institution text falls inside this stage. */
  | "instituted"
  /** Instituted in an earlier stage and still governing this one; no new text here. */
  | "in_force"
  /** Prophesied/announced within this stage (Jeremiah 31) but not yet instituted. */
  | "announced_not_instituted"
  /** In force, at the New Covenant's own eschatological terminus. */
  | "consummated";

export interface CovenantFact {
  covenant: CovenantName;
  status: CovenantStatus;
  /** Non-interpretive: states what the text says or where it is instituted, never what it means. */
  note: string;
  confidence: EpistemicBasis;
}

export interface StageCovenantEntry {
  stageSlug: string;
  /**
   * Ordered by institution sequence within the stage. Empty for stages 1–2
   * (Genesis 1–5), where none of the five covenants is yet instituted —
   * see `stageNote` for that case. Stage 5 carries all four OT-era facts in
   * real chronological order (Abrahamic → Mosaic → Davidic →
   * New-announced-but-not-instituted) — never flattened to one badge.
   */
  covenants: CovenantFact[];
  /** Stage-level commentary that isn't itself a covenant fact (e.g. "none yet instituted", or a tradition-dependent caution). Never asserts a position. */
  stageNote?: string;
  confidence?: EpistemicBasis;
  /**
   * True only for stage 6 (the Gospels). Per the research doc: this stage
   * is the New Covenant's own institution/pivot, and — per the task brief
   * the doc itself carries forward — "needs no covenant/timeline rail
   * content (it's the pivot) — noted for completeness only." The fact is
   * still recorded here; UI callers should skip rendering a badge for this
   * stage specifically.
   */
  hideInReader?: boolean;
}

export const STAGE_COVENANTS: readonly StageCovenantEntry[] = [
  {
    stageSlug: "gen-01-02-creation",
    covenants: [],
    stageNote: "None of the five covenants is yet instituted in Genesis 1–2.",
    confidence: "text_explicit",
  },
  {
    stageSlug: "gen-03-05-sin-enters",
    covenants: [],
    stageNote: "None of the five covenants is yet formally instituted in Genesis 3–5.",
    confidence: "text_explicit",
  },
  {
    stageSlug: "gen-06-09-the-flood",
    covenants: [
      {
        covenant: "Noahic",
        status: "instituted",
        note:
          "Announced Genesis 6:18; formally ratified Genesis 8:20–9:17 (sign: the rainbow), at the close of this stage.",
        confidence: "text_explicit",
      },
    ],
  },
  {
    stageSlug: "gen-10-11-babel",
    covenants: [
      {
        covenant: "Noahic",
        status: "in_force",
        note: "Remains in force; no new covenant text is added in Genesis 10–11.",
        confidence: "text_explicit",
      },
    ],
  },
  {
    stageSlug: "gen-12-malachi-israel",
    stageNote:
      "This stage spans all four Old Testament covenants in sequence — it is not one covenant, and the rail below shows a progression, not a single badge.",
    confidence: "text_explicit",
    covenants: [
      {
        covenant: "Abrahamic",
        status: "instituted",
        note:
          "Instituted near the start of this stage: Genesis 12:1–3 (call/promise), Genesis 15 (ratification, land grant), Genesis 17 (sign: circumcision).",
        confidence: "text_explicit",
      },
      {
        covenant: "Mosaic",
        status: "instituted",
        note:
          "Instituted further into the stage: Exodus 19:4–6 (proposal/conditions), Exodus 20–23 (stipulations), Exodus 24:7–8 (blood ratification).",
        confidence: "text_explicit",
      },
      {
        covenant: "Davidic",
        status: "instituted",
        note:
          "Instituted roughly at this stage's midpoint: 2 Samuel 7 (Nathan's oracle to David), 1 Chronicles 17 (parallel account).",
        confidence: "text_explicit",
      },
      {
        covenant: "New",
        status: "announced_not_instituted",
        note:
          "Announced/prophesied within this stage — Jeremiah 31:31–34, the only Old Testament text using the phrase \"new covenant\" — but not instituted until the Gospels.",
        confidence: "text_explicit",
      },
    ],
  },
  {
    stageSlug: "gospels-jesus-christ",
    hideInReader: true,
    covenants: [
      {
        covenant: "New",
        status: "instituted",
        note: "Instituted at the Last Supper: Matthew 26:28, Mark 14:24, Luke 22:20.",
        confidence: "text_explicit",
      },
    ],
  },
  {
    stageSlug: "acts-jude-the-church",
    covenants: [
      {
        covenant: "New",
        status: "in_force",
        note:
          "In force (post-inauguration, pre-consummation); Hebrews 8–10, the primary theological exposition, is written into this era.",
        confidence: "text_explicit",
      },
    ],
  },
  {
    stageSlug: "rev-01-18-babylon",
    covenants: [
      {
        covenant: "New",
        status: "in_force",
        note: "The New Covenant era continues; no new covenant text is instituted here.",
        confidence: "text_explicit",
      },
    ],
  },
  {
    stageSlug: "rev-06-19-the-world-judged",
    covenants: [
      {
        covenant: "New",
        status: "in_force",
        note: "The New Covenant era continues; no new covenant text is instituted here.",
        confidence: "text_explicit",
      },
    ],
  },
  {
    stageSlug: "rev-20-satan-cast-out",
    covenants: [
      {
        covenant: "New",
        status: "in_force",
        note: "The New Covenant era continues; no new covenant text is instituted here.",
        confidence: "text_explicit",
      },
    ],
  },
  {
    stageSlug: "rev-20-22-paradise-restored",
    stageNote:
      "Any claim that Abrahamic or Davidic promises are fulfilled specifically at this stage (rather than in Christ generally) is tradition-dependent, not agreed fact — traditions genuinely differ on how those promises resolve.",
    confidence: "tradition",
    covenants: [
      {
        covenant: "New",
        status: "consummated",
        note: "The New Covenant era continues into its consummation; no new covenant text is instituted here.",
        confidence: "text_explicit",
      },
    ],
  },
] as const;

const STAGE_COVENANTS_BY_SLUG: ReadonlyMap<string, StageCovenantEntry> = new Map(
  STAGE_COVENANTS.map((entry) => [entry.stageSlug, entry]),
);

/** Looked up by the app's real 11 stage slugs (`web/data/seed/stages.json`). */
export function covenantsForStage(stageSlug: string): StageCovenantEntry | undefined {
  return STAGE_COVENANTS_BY_SLUG.get(stageSlug);
}

// ---------------------------------------------------------------------------
// Book/chapter -> stage slug, so a reader that only knows book+chapter can
// resolve a covenant entry without a stage slug in hand. See the module
// header for the Revelation tie-break's documented rationale.
// ---------------------------------------------------------------------------

const GENESIS = 1;
const MATTHEW = 40;
const JOHN = 43;
const ACTS = 44;
const JUDE = 65;
const REVELATION = 66;

/**
 * Ordered ascending by stage number, each with the chapter range its own
 * title/slug names (not the DB anchor field — see module header). For
 * Revelation, ranges intentionally overlap; `stageSlugForRef` resolves that
 * with a documented first-match-wins rule.
 */
const STAGE_RANGES: readonly { slug: string; book: number; fromChapter: number; toChapter: number }[] = [
  { slug: "gen-01-02-creation", book: GENESIS, fromChapter: 1, toChapter: 2 },
  { slug: "gen-03-05-sin-enters", book: GENESIS, fromChapter: 3, toChapter: 5 },
  { slug: "gen-06-09-the-flood", book: GENESIS, fromChapter: 6, toChapter: 9 },
  { slug: "gen-10-11-babel", book: GENESIS, fromChapter: 10, toChapter: 11 },
  // Genesis 12 through the end of Malachi (book 39) — see stageSlugForRef.
  { slug: "rev-01-18-babylon", book: REVELATION, fromChapter: 1, toChapter: 18 },
  { slug: "rev-06-19-the-world-judged", book: REVELATION, fromChapter: 6, toChapter: 19 },
  { slug: "rev-20-satan-cast-out", book: REVELATION, fromChapter: 20, toChapter: 20 },
  { slug: "rev-20-22-paradise-restored", book: REVELATION, fromChapter: 20, toChapter: 22 },
];

/**
 * Resolves the stage slug a given book/chapter belongs to, per the app's
 * real 11-stage structure. Returns undefined only for an out-of-range
 * book/chapter (book outside 1–66, or a chapter number that isn't a
 * positive integer) — every canonical chapter belongs to exactly one stage
 * by this module's rule.
 */
export function stageSlugForRef(book: number, chapter: number): string | undefined {
  if (!Number.isInteger(book) || book < 1 || book > 66) return undefined;
  if (!Number.isInteger(chapter) || chapter < 1) return undefined;

  if (book === GENESIS) {
    const genesisStage = STAGE_RANGES.find(
      (range) => range.book === GENESIS && chapter >= range.fromChapter && chapter <= range.toChapter,
    );
    if (genesisStage) return genesisStage.slug;
    // Genesis 12 onward: the start of the Israel stage.
    return "gen-12-malachi-israel";
  }
  if (book > GENESIS && book <= 39) return "gen-12-malachi-israel"; // Exodus..Malachi
  if (book >= MATTHEW && book <= JOHN) return "gospels-jesus-christ";
  if (book >= ACTS && book <= JUDE) return "acts-jude-the-church";
  if (book === REVELATION) {
    // First-match-wins, ascending stage number — see module header.
    const revelationStage = STAGE_RANGES.find(
      (range) => range.book === REVELATION && chapter >= range.fromChapter && chapter <= range.toChapter,
    );
    return revelationStage?.slug;
  }
  return undefined;
}

/** Convenience: resolves the stage for a book/chapter, then its covenant entry. */
export function covenantsForRef(book: number, chapter: number): StageCovenantEntry | undefined {
  const slug = stageSlugForRef(book, chapter);
  return slug ? covenantsForStage(slug) : undefined;
}
