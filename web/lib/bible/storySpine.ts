/**
 * The Story Spine — 35 chapters across the mountain's 11 stages.
 *
 * Source data: `design/scarlet-thread-app/Scarlet Thread - Story Spine.md`
 * (content/structure) and `design/STORY_SPINE_DECISIONS.md` (the four
 * decisions that are settled, not open for re-litigation here):
 *   1. 35 chapters, not 31 -- The Story's own 31 plus 4 additions that
 *      restore two mirror pairs the unmodified 31 breaks.
 *   2. Titles are renamed, written fresh for this app. Zondervan's original
 *      wording is never the primary `title` -- it is their copyrighted
 *      editorial prose, not structural fact. Where useful for QA
 *      cross-referencing it is kept as `altTitle`, an internal field this
 *      app must never render.
 *   3. Reading days per chapter is a configurable default (4), not modeled
 *      in this file -- it belongs to whatever schedules the daily loop.
 *   4. The stage-5 sub-arc (`phase`) is a filter on the existing stage view,
 *      a future UI task. This file only carries the `phase` data it needs.
 *
 * Book numbering: RefKey book numbers are 1-66, canonical Protestant order
 * -- see lib/bible/reference.ts's header and web/public/bible/index.json
 * (the canonical source: 1 Genesis ... 39 Malachi, 40 Matthew ... 66
 * Revelation). Cross-checked against already-known-correct RefKeys already
 * in the codebase: tests/mountain-geometry.test.ts's stage fixtures use
 * "1.1"/"1.3"/"1.6"/"1.10" for Genesis 1/3/6/10, "40.1" for Matthew 1,
 * "44.1" for Acts 1, and "66.1"/"66.20"/"66.21" for Revelation --
 * consistent with index.json's book list and with lib/vault/seed.ts's
 * `MountainStage.firstChapter` / `stageHref`, which parses a RefKey's first
 * dot-segment as the book number directly. The Story Spine doc's own §4
 * example ("book": "1KI") uses invented 3-letter codes and is NOT this
 * app's real format -- passages below use the real numeric book codes.
 *
 * One documented exception to "one chapter, one stage": The Story's own
 * chapter 1 (Genesis 1-9) runs through three mountain stages (1 Creation,
 * 2 Sin Enters, 3 The Flood) before chapter 2 opens at Genesis 12 -- the
 * doc's own §2 flags this ("chapter 1 continues into stages 2-3") and
 * Finding A's missing-stage table does not list stages 2 or 3 as missing,
 * meaning the doc's author already treats chapter 1 as covering all three.
 * Forcing that into a single-valued `stage` field would leave two of the
 * eleven stages with zero chapters, which the task that produced this file
 * calls out as the single invariant that must never break. `stage` is
 * therefore `number | number[]`; chapter 1 is the only entry that uses the
 * array form.
 */

export type StorySpinePhase =
  | "Patriarchs"
  | "Exodus"
  | "Conquest"
  | "Kingdom"
  | "Divided & Warned"
  | "Exile & Return";

export interface StorySpinePassage {
  /** Book number, 1-66, canonical order -- see web/public/bible/index.json. */
  book: number;
  /** First chapter of the span, inclusive. */
  from: number;
  /** Last chapter of the span, inclusive (from === to is a single chapter). */
  to: number;
}

export interface StorySpineChapter {
  id: string;
  /**
   * Chapter number as published in The Story: "1" through "31", or one of
   * the four additions' suffixed numbers from Finding A: "1b", "31a",
   * "31b", "31c". Kept as a string so the suffixed forms need no separate
   * field.
   */
  chapter: string;
  /** Fresh, plain, factual title -- never Zondervan's wording. */
  title: string;
  /**
   * Zondervan's original chapter title, kept only as an internal
   * cross-reference for QA. NEVER render this as the primary title --
   * STORY_SPINE_DECISIONS.md #2. Absent for the four additions, which have
   * no Zondervan title to cross-reference.
   */
  altTitle?: string;
  /**
   * Mountain stage(s) this chapter belongs to, 1-11. Every entry but
   * chapter 1 carries exactly one stage; chapter 1 carries all three its
   * Genesis 1-9 span runs through. See the file header.
   */
  stage: number | number[];
  /** Set only for stage-5 (Israel) entries -- the sub-arc phase filter. */
  phase?: StorySpinePhase;
  passages: StorySpinePassage[];
  /** "the-story" for the original 31 (including 1b/31a/31b/31c's base
   * numbering), "scarlet-thread" for the four additions themselves. */
  source: "the-story" | "scarlet-thread";
  /**
   * Sum of each passage's chapter span (to - from + 1). Always computed
   * from `passages` via `chapterSpan` below -- never hand-typed a second
   * time, so it cannot silently drift from the passages it describes.
   */
  chapterCount: number;
}

/** to - from + 1: the number of chapters a single passage span covers. */
function chapterSpan(passage: StorySpinePassage): number {
  return passage.to - passage.from + 1;
}

/** Sum of every passage's span -- the one place chapterCount is computed. */
function totalChapters(passages: StorySpinePassage[]): number {
  return passages.reduce((sum, passage) => sum + chapterSpan(passage), 0);
}

function chapterOf(
  entry: Omit<StorySpineChapter, "chapterCount">,
): StorySpineChapter {
  return { ...entry, chapterCount: totalChapters(entry.passages) };
}

// Book numbers used below (web/public/bible/index.json, canonical order):
// Genesis 1, Exodus 2, Numbers 4, Deuteronomy 5, Joshua 6, Judges 7, Ruth 8,
// 1 Samuel 9, 2 Samuel 10, 1 Kings 11, 2 Kings 12, 1 Chronicles 13,
// 2 Chronicles 14, Ezra 15, Nehemiah 16, Esther 17, Psalms 19, Proverbs 20,
// Isaiah 23, Jeremiah 24, Lamentations 25, Ezekiel 26, Daniel 27, Hosea 28,
// Amos 30, Haggai 37, Zechariah 38, Malachi 39, Matthew 40, Mark 41, Luke 42,
// John 43, Acts 44, Romans 45, 1 Corinthians 46, Galatians 48, Ephesians 49,
// 1 Thessalonians 52, 2 Timothy 55, Hebrews 58, Revelation 66.

export const STORY_SPINE: StorySpineChapter[] = [
  chapterOf({
    id: "story-1",
    chapter: "1",
    title: "Creation, the Fall, and the Flood",
    altTitle: "Creation: The Beginning of Life as We Know It",
    stage: [1, 2, 3],
    source: "the-story",
    passages: [{ book: 1, from: 1, to: 9 }],
  }),
  chapterOf({
    id: "story-1b",
    chapter: "1b",
    title: "The Tower",
    stage: 4,
    source: "scarlet-thread",
    passages: [{ book: 1, from: 10, to: 11 }],
  }),
  chapterOf({
    id: "story-2",
    chapter: "2",
    title: "Abraham, Isaac, and Jacob",
    altTitle: "God Builds a Nation",
    stage: 5,
    phase: "Patriarchs",
    source: "the-story",
    passages: [
      { book: 1, from: 12, to: 13 },
      { book: 1, from: 15, to: 17 },
      { book: 1, from: 21, to: 22 },
      { book: 1, from: 32, to: 33 },
      { book: 1, from: 35, to: 35 },
      { book: 45, from: 4, to: 4 },
      { book: 58, from: 11, to: 11 },
    ],
  }),
  chapterOf({
    id: "story-3",
    chapter: "3",
    title: "Joseph in Egypt",
    altTitle: "Joseph: From Slave to Deputy Pharaoh",
    stage: 5,
    phase: "Patriarchs",
    source: "the-story",
    passages: [
      { book: 1, from: 37, to: 37 },
      { book: 1, from: 39, to: 39 },
      { book: 1, from: 41, to: 48 },
      { book: 1, from: 50, to: 50 },
    ],
  }),
  chapterOf({
    id: "story-4",
    chapter: "4",
    title: "The Exodus from Egypt",
    altTitle: "Deliverance",
    stage: 5,
    phase: "Exodus",
    source: "the-story",
    passages: [
      { book: 2, from: 1, to: 7 },
      { book: 2, from: 10, to: 17 },
    ],
  }),
  chapterOf({
    id: "story-5",
    chapter: "5",
    title: "The Law and the Tabernacle at Sinai",
    altTitle: "New Commands and a New Covenant",
    stage: 5,
    phase: "Exodus",
    source: "the-story",
    passages: [
      { book: 2, from: 19, to: 20 },
      { book: 2, from: 24, to: 25 },
      { book: 2, from: 32, to: 34 },
      { book: 2, from: 40, to: 40 },
    ],
  }),
  chapterOf({
    id: "story-6",
    chapter: "6",
    title: "Forty Years in the Wilderness",
    altTitle: "Wandering",
    stage: 5,
    phase: "Exodus",
    source: "the-story",
    passages: [
      { book: 4, from: 10, to: 14 },
      { book: 4, from: 20, to: 21 },
      { book: 4, from: 25, to: 25 },
      { book: 4, from: 27, to: 27 },
      { book: 5, from: 1, to: 2 },
      { book: 5, from: 4, to: 4 },
      { book: 5, from: 6, to: 6 },
      { book: 5, from: 8, to: 9 },
      { book: 5, from: 29, to: 32 },
      { book: 5, from: 34, to: 34 },
    ],
  }),
  chapterOf({
    id: "story-7",
    chapter: "7",
    title: "The Conquest of Canaan",
    altTitle: "The Battle Begins",
    stage: 5,
    phase: "Conquest",
    source: "the-story",
    passages: [
      { book: 6, from: 1, to: 2 },
      { book: 6, from: 6, to: 6 },
      { book: 6, from: 8, to: 8 },
      { book: 6, from: 10, to: 11 },
      { book: 6, from: 23, to: 24 },
    ],
  }),
  chapterOf({
    id: "story-8",
    chapter: "8",
    title: "The Judges of Israel",
    altTitle: "A Few Good Men … and Women",
    stage: 5,
    phase: "Conquest",
    source: "the-story",
    passages: [
      { book: 7, from: 2, to: 4 },
      { book: 7, from: 6, to: 8 },
      { book: 7, from: 13, to: 16 },
    ],
  }),
  chapterOf({
    id: "story-9",
    chapter: "9",
    title: "Ruth the Moabite",
    altTitle: "The Faith of a Foreign Woman",
    stage: 5,
    phase: "Conquest",
    source: "the-story",
    passages: [{ book: 8, from: 1, to: 4 }],
  }),
  chapterOf({
    id: "story-10",
    chapter: "10",
    title: "Samuel and King Saul",
    altTitle: "Standing Tall, Falling Hard",
    stage: 5,
    phase: "Kingdom",
    source: "the-story",
    passages: [
      { book: 9, from: 1, to: 4 },
      { book: 9, from: 8, to: 13 },
      { book: 9, from: 15, to: 15 },
    ],
  }),
  chapterOf({
    id: "story-11",
    chapter: "11",
    title: "David Becomes King",
    altTitle: "From Shepherd to King",
    stage: 5,
    phase: "Kingdom",
    source: "the-story",
    passages: [
      { book: 9, from: 16, to: 18 },
      { book: 9, from: 24, to: 24 },
      { book: 9, from: 31, to: 31 },
      { book: 10, from: 6, to: 6 },
      { book: 10, from: 22, to: 22 },
      { book: 13, from: 17, to: 17 },
      { book: 19, from: 59, to: 59 },
    ],
  }),
  chapterOf({
    id: "story-12",
    chapter: "12",
    title: "David's Sin and Its Aftermath",
    altTitle: "The Trials of a King",
    stage: 5,
    phase: "Kingdom",
    source: "the-story",
    passages: [
      { book: 10, from: 11, to: 12 },
      { book: 10, from: 18, to: 19 },
      { book: 13, from: 22, to: 22 },
      { book: 13, from: 29, to: 29 },
      { book: 19, from: 23, to: 23 },
      { book: 19, from: 32, to: 32 },
      { book: 19, from: 51, to: 51 },
    ],
  }),
  chapterOf({
    id: "story-13",
    chapter: "13",
    title: "Solomon's Reign and Temple",
    altTitle: "The King Who Had It All",
    stage: 5,
    phase: "Kingdom",
    source: "the-story",
    passages: [
      { book: 11, from: 1, to: 8 },
      { book: 11, from: 10, to: 11 },
      { book: 14, from: 5, to: 7 },
      { book: 20, from: 1, to: 3 },
      { book: 20, from: 6, to: 6 },
      { book: 20, from: 20, to: 21 },
    ],
  }),
  chapterOf({
    id: "story-14",
    chapter: "14",
    title: "The Kingdom Divides",
    altTitle: "A Kingdom Torn in Two",
    stage: 5,
    phase: "Divided & Warned",
    source: "the-story",
    passages: [{ book: 11, from: 12, to: 16 }],
  }),
  chapterOf({
    id: "story-15",
    chapter: "15",
    title: "Elijah, Elisha, and the Prophets to the North",
    altTitle: "God's Messengers",
    stage: 5,
    phase: "Divided & Warned",
    source: "the-story",
    passages: [
      { book: 11, from: 17, to: 19 },
      { book: 12, from: 2, to: 2 },
      { book: 12, from: 4, to: 4 },
      { book: 12, from: 6, to: 6 },
      { book: 28, from: 4, to: 5 },
      { book: 28, from: 8, to: 9 },
      { book: 28, from: 14, to: 14 },
      { book: 30, from: 1, to: 1 },
      { book: 30, from: 3, to: 5 },
      { book: 30, from: 9, to: 9 },
    ],
  }),
  chapterOf({
    id: "story-16",
    chapter: "16",
    title: "The Fall of the Northern Kingdom",
    altTitle: "The Beginning of the End",
    stage: 5,
    phase: "Divided & Warned",
    source: "the-story",
    passages: [
      { book: 12, from: 17, to: 19 },
      { book: 23, from: 3, to: 3 },
      { book: 23, from: 6, to: 6 },
      { book: 23, from: 13, to: 14 },
      { book: 23, from: 49, to: 49 },
      { book: 23, from: 53, to: 53 },
    ],
  }),
  chapterOf({
    id: "story-17",
    chapter: "17",
    title: "The Fall of Jerusalem and Exile to Babylon",
    altTitle: "The Kingdoms' Fall",
    stage: 5,
    phase: "Exile & Return",
    source: "the-story",
    passages: [
      { book: 12, from: 21, to: 21 },
      { book: 12, from: 23, to: 25 },
      { book: 14, from: 33, to: 33 },
      { book: 14, from: 36, to: 36 },
      { book: 24, from: 1, to: 2 },
      { book: 24, from: 4, to: 5 },
      { book: 24, from: 13, to: 13 },
      { book: 24, from: 21, to: 21 },
      { book: 25, from: 1, to: 3 },
      { book: 25, from: 5, to: 5 },
      { book: 26, from: 1, to: 2 },
      { book: 26, from: 6, to: 7 },
      { book: 26, from: 36, to: 37 },
    ],
  }),
  chapterOf({
    id: "story-18",
    chapter: "18",
    title: "Daniel in Babylon",
    altTitle: "Daniel in Exile",
    stage: 5,
    phase: "Exile & Return",
    source: "the-story",
    passages: [
      { book: 27, from: 1, to: 3 },
      { book: 27, from: 6, to: 6 },
      { book: 24, from: 29, to: 31 },
    ],
  }),
  chapterOf({
    id: "story-19",
    chapter: "19",
    title: "The Return from Exile and Rebuilding the Temple",
    altTitle: "The Return Home",
    stage: 5,
    phase: "Exile & Return",
    source: "the-story",
    passages: [
      { book: 15, from: 1, to: 6 },
      { book: 37, from: 1, to: 2 },
      { book: 38, from: 1, to: 1 },
      { book: 38, from: 8, to: 8 },
    ],
  }),
  chapterOf({
    id: "story-20",
    chapter: "20",
    title: "Esther Saves Her People",
    altTitle: "The Queen of Beauty and Courage",
    stage: 5,
    phase: "Exile & Return",
    source: "the-story",
    passages: [{ book: 17, from: 1, to: 9 }],
  }),
  chapterOf({
    id: "story-21",
    chapter: "21",
    title: "Nehemiah Rebuilds the Walls",
    altTitle: "Rebuilding the Walls",
    stage: 5,
    phase: "Exile & Return",
    source: "the-story",
    passages: [
      { book: 15, from: 7, to: 7 },
      { book: 16, from: 1, to: 2 },
      { book: 16, from: 4, to: 4 },
      { book: 16, from: 6, to: 8 },
      { book: 39, from: 1, to: 4 },
    ],
  }),
  chapterOf({
    id: "story-22",
    chapter: "22",
    title: "The Birth of Jesus",
    altTitle: "The Birth of the King",
    stage: 6,
    source: "the-story",
    passages: [
      { book: 40, from: 1, to: 2 },
      { book: 42, from: 1, to: 2 },
      { book: 43, from: 1, to: 1 },
    ],
  }),
  chapterOf({
    id: "story-23",
    chapter: "23",
    title: "Jesus Begins His Ministry",
    altTitle: "Jesus' Ministry Begins",
    stage: 6,
    source: "the-story",
    passages: [
      { book: 40, from: 3, to: 4 },
      { book: 40, from: 11, to: 11 },
      { book: 41, from: 1, to: 3 },
      { book: 42, from: 8, to: 8 },
      { book: 43, from: 1, to: 4 },
    ],
  }),
  chapterOf({
    id: "story-24",
    chapter: "24",
    title: "Jesus Teaches and Heals",
    altTitle: "No Ordinary Man",
    stage: 6,
    source: "the-story",
    passages: [
      { book: 40, from: 5, to: 7 },
      { book: 40, from: 9, to: 9 },
      { book: 40, from: 14, to: 14 },
      { book: 41, from: 4, to: 6 },
      { book: 42, from: 10, to: 10 },
      { book: 42, from: 15, to: 15 },
      { book: 43, from: 6, to: 6 },
    ],
  }),
  chapterOf({
    id: "story-25",
    chapter: "25",
    title: "Jesus Reveals Who He Is",
    altTitle: "Jesus, the Son of God",
    stage: 6,
    source: "the-story",
    passages: [
      { book: 40, from: 17, to: 17 },
      { book: 40, from: 21, to: 21 },
      { book: 41, from: 8, to: 12 },
      { book: 41, from: 14, to: 14 },
      { book: 42, from: 9, to: 9 },
      { book: 42, from: 22, to: 22 },
      { book: 43, from: 7, to: 8 },
      { book: 43, from: 11, to: 12 },
    ],
  }),
  chapterOf({
    id: "story-26",
    chapter: "26",
    title: "The Arrest and Crucifixion of Jesus",
    altTitle: "The Hour of Darkness",
    stage: 6,
    source: "the-story",
    passages: [
      { book: 40, from: 26, to: 27 },
      { book: 41, from: 14, to: 15 },
      { book: 42, from: 22, to: 23 },
      { book: 43, from: 13, to: 14 },
      { book: 43, from: 16, to: 19 },
    ],
  }),
  chapterOf({
    id: "story-27",
    chapter: "27",
    title: "Jesus Rises From the Dead",
    altTitle: "The Resurrection",
    stage: 6,
    source: "the-story",
    passages: [
      { book: 40, from: 27, to: 28 },
      { book: 41, from: 16, to: 16 },
      { book: 42, from: 24, to: 24 },
      { book: 43, from: 19, to: 21 },
    ],
  }),
  chapterOf({
    id: "story-28",
    chapter: "28",
    title: "The Church Begins",
    altTitle: "New Beginnings",
    stage: 7,
    source: "the-story",
    passages: [
      { book: 44, from: 1, to: 10 },
      { book: 44, from: 12, to: 12 },
    ],
  }),
  chapterOf({
    id: "story-29",
    chapter: "29",
    title: "Paul Carries the Gospel to the Gentiles",
    altTitle: "Paul's Mission",
    stage: 7,
    source: "the-story",
    passages: [
      { book: 44, from: 13, to: 14 },
      { book: 44, from: 16, to: 20 },
      { book: 45, from: 1, to: 1 },
      { book: 45, from: 3, to: 6 },
      { book: 45, from: 8, to: 8 },
      { book: 45, from: 12, to: 12 },
      { book: 45, from: 15, to: 15 },
      { book: 46, from: 1, to: 1 },
      { book: 46, from: 3, to: 3 },
      { book: 46, from: 5, to: 6 },
      { book: 46, from: 10, to: 10 },
      { book: 46, from: 12, to: 13 },
      { book: 46, from: 15, to: 16 },
      { book: 48, from: 1, to: 1 },
      { book: 48, from: 3, to: 3 },
      { book: 48, from: 5, to: 6 },
      { book: 52, from: 1, to: 5 },
    ],
  }),
  chapterOf({
    id: "story-30",
    chapter: "30",
    title: "Paul's Arrest, Voyage, and Final Letters",
    altTitle: "Paul's Final Days",
    stage: 7,
    source: "the-story",
    passages: [
      { book: 44, from: 20, to: 23 },
      { book: 44, from: 27, to: 28 },
      { book: 49, from: 1, to: 6 },
      { book: 55, from: 1, to: 4 },
    ],
  }),
  chapterOf({
    id: "story-31b",
    chapter: "31b",
    title: "The Beast and the City",
    stage: 8,
    source: "scarlet-thread",
    passages: [{ book: 66, from: 12, to: 18 }],
  }),
  chapterOf({
    id: "story-31a",
    chapter: "31a",
    title: "The Scroll and the Trumpets",
    stage: 9,
    source: "scarlet-thread",
    passages: [{ book: 66, from: 6, to: 11 }],
  }),
  chapterOf({
    id: "story-31c",
    chapter: "31c",
    title: "The Rider and the Chain",
    stage: 10,
    source: "scarlet-thread",
    passages: [{ book: 66, from: 19, to: 20 }],
  }),
  chapterOf({
    id: "story-31",
    chapter: "31",
    title: "The Vision of Christ and the New Creation",
    altTitle: "The End of Time",
    stage: 11,
    source: "the-story",
    passages: [
      { book: 66, from: 1, to: 5 },
      { book: 66, from: 21, to: 22 },
    ],
  }),
];

/** Every stage a chapter belongs to, expanding the `number | number[]` field. */
export function stagesOf(entry: StorySpineChapter): number[] {
  return Array.isArray(entry.stage) ? entry.stage : [entry.stage];
}
