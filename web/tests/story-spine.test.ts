/**
 * STORYSPINE-001 — lib/bible/storySpine.ts's 35-chapter data.
 *
 * Plain `node:test`, no jsdom (this repo's test runner is `tsx --test
 * tests/*.test.ts` -- see tests/israel-sub-arc.test.ts's header for the
 * precedent). storySpine.ts has zero React/CSS dependencies, so it is
 * importable directly with no stubbing.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  STORY_SPINE,
  type StorySpinePhase,
  stagesOf,
} from "@/lib/bible/storySpine";

const VALID_PHASES: StorySpinePhase[] = [
  "Patriarchs",
  "Exodus",
  "Conquest",
  "Kingdom",
  "Divided & Warned",
  "Exile & Return",
];

// The 35 chapter numbers this file must contain: The Story's 1-31, plus the
// four Finding A additions with their own suffixed numbering.
const EXPECTED_CHAPTERS = [
  ...Array.from({ length: 31 }, (_, i) => String(i + 1)),
  "1b",
  "31a",
  "31b",
  "31c",
];

function chapterSpan(passage: { from: number; to: number }): number {
  return passage.to - passage.from + 1;
}

test("all 35 chapters are present, each with a valid stage", () => {
  assert.equal(STORY_SPINE.length, 35);

  const chapterNumbers = STORY_SPINE.map((entry) => entry.chapter).sort();
  assert.deepEqual(chapterNumbers, [...EXPECTED_CHAPTERS].sort());

  // No duplicate ids or chapter numbers.
  assert.equal(new Set(STORY_SPINE.map((e) => e.id)).size, 35);
  assert.equal(new Set(chapterNumbers).size, 35);

  for (const entry of STORY_SPINE) {
    for (const stage of stagesOf(entry)) {
      assert.ok(
        Number.isInteger(stage) && stage >= 1 && stage <= 11,
        `${entry.chapter} has an invalid stage: ${stage}`,
      );
    }
  }
});

test("every one of the 11 mountain stages has at least one chapter", () => {
  // The single most important invariant here: the whole point of the four
  // Finding A additions (1b, 31a, 31b, 31c) is that no stage is left empty.
  const coveredStages = new Set<number>();
  for (const entry of STORY_SPINE) {
    for (const stage of stagesOf(entry)) coveredStages.add(stage);
  }

  const missing: number[] = [];
  for (let stage = 1; stage <= 11; stage += 1) {
    if (!coveredStages.has(stage)) missing.push(stage);
  }

  assert.deepEqual(missing, [], `stages with zero chapters: ${missing.join(", ")}`);
});

test("the four additions restore exactly the stages Finding A identifies", () => {
  const byChapter = new Map(STORY_SPINE.map((e) => [e.chapter, e]));

  assert.deepEqual(stagesOf(byChapter.get("1b")!), [4]); // Babel
  assert.deepEqual(stagesOf(byChapter.get("31a")!), [9]); // World Judged
  assert.deepEqual(stagesOf(byChapter.get("31b")!), [8]); // Babylon
  assert.deepEqual(stagesOf(byChapter.get("31c")!), [10]); // Satan Cast Out
});

test("phase is set for every stage-5 entry, and for no other entry", () => {
  for (const entry of STORY_SPINE) {
    const stages = stagesOf(entry);
    const isStage5 = stages.length === 1 && stages[0] === 5;

    if (isStage5) {
      assert.ok(
        entry.phase && VALID_PHASES.includes(entry.phase),
        `${entry.chapter} is stage 5 but has no valid phase: ${entry.phase}`,
      );
    } else {
      assert.equal(
        entry.phase,
        undefined,
        `${entry.chapter} is not stage 5 but has a phase: ${entry.phase}`,
      );
    }
  }

  // All six phases are actually used at least once (sub-arc has real shape).
  const usedPhases = new Set(STORY_SPINE.map((e) => e.phase).filter(Boolean));
  for (const phase of VALID_PHASES) {
    assert.ok(usedPhases.has(phase), `phase never used: ${phase}`);
  }
});

test("chapterCount always equals the sum of its own passages' spans", () => {
  for (const entry of STORY_SPINE) {
    const expected = entry.passages.reduce((sum, p) => sum + chapterSpan(p), 0);
    assert.equal(
      entry.chapterCount,
      expected,
      `${entry.chapter} chapterCount (${entry.chapterCount}) !== sum of passages (${expected})`,
    );
    assert.ok(entry.chapterCount > 0, `${entry.chapter} has a non-positive chapterCount`);
  }
});

test("every passage uses a real 1-66 book number, never a 3-letter code", () => {
  for (const entry of STORY_SPINE) {
    assert.ok(entry.passages.length > 0, `${entry.chapter} has no passages`);
    for (const passage of entry.passages) {
      assert.equal(typeof passage.book, "number", `${entry.chapter} passage.book is not a number`);
      assert.ok(passage.book >= 1 && passage.book <= 66, `${entry.chapter} book out of range: ${passage.book}`);
      assert.ok(passage.from >= 1, `${entry.chapter} passage.from < 1`);
      assert.ok(passage.to >= passage.from, `${entry.chapter} passage.to < passage.from`);
    }
  }
});

test("source is the-story for chapters 1-31 and scarlet-thread for the four additions", () => {
  const additions = new Set(["1b", "31a", "31b", "31c"]);
  for (const entry of STORY_SPINE) {
    const expected = additions.has(entry.chapter) ? "scarlet-thread" : "the-story";
    assert.equal(entry.source, expected, `${entry.chapter} has source "${entry.source}", expected "${expected}"`);
  }
});

test("no entry's primary title is Zondervan's own chapter-title wording", () => {
  // Known Zondervan titles pulled verbatim from the Story Spine doc's own
  // §2 heading text -- the primary `title` field must never match one of
  // these; altTitle is the only place they may legally appear.
  const zondervanTitles = new Set([
    "Creation: The Beginning of Life as We Know It",
    "God Builds a Nation",
    "Joseph: From Slave to Deputy Pharaoh",
    "Deliverance",
    "New Commands and a New Covenant",
    "Wandering",
    "The Battle Begins",
    "A Few Good Men … and Women",
    "The Faith of a Foreign Woman",
    "Standing Tall, Falling Hard",
    "From Shepherd to King",
    "The Trials of a King",
    "The King Who Had It All",
    "A Kingdom Torn in Two",
    "God's Messengers",
    "The Beginning of the End",
    "The Kingdoms' Fall",
    "Daniel in Exile",
    "The Return Home",
    "The Queen of Beauty and Courage",
    "Rebuilding the Walls",
    "The Birth of the King",
    "Jesus' Ministry Begins",
    "No Ordinary Man",
    "Jesus, the Son of God",
    "The Hour of Darkness",
    "The Resurrection",
    "New Beginnings",
    "Paul's Mission",
    "Paul's Final Days",
    "The End of Time",
  ]);

  for (const entry of STORY_SPINE) {
    assert.ok(
      !zondervanTitles.has(entry.title),
      `${entry.chapter}'s primary title matches Zondervan's wording verbatim: "${entry.title}"`,
    );
    assert.ok(entry.title.length > 0 && entry.title.length < 80, `${entry.chapter} title is empty or unreasonably long`);
  }
});
