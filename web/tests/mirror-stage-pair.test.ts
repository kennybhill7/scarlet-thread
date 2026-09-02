/**
 * MIRRORSPLIT-001 — unit tests for lib/mirror/stagePair.ts: resolving one
 * stage's mirror partner (and the three honest non-happy-path outcomes),
 * resolving a stage's opening chapter from its RefKey, and the title-
 * splitting display helper. Pure, no DOM/DB/React — plain data in,
 * discriminated unions out.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { Stage } from "@/lib/contracts";
import { resolveMirrorPair, resolveOpeningChapter, splitStageLabel } from "@/lib/mirror/stagePair";

function stage(overrides: Partial<Stage> & Pick<Stage, "slug" | "stage">): Stage {
  return {
    title: `Stage ${overrides.stage}`,
    side: "ascent",
    mirror: null,
    chapters: ["1.1"],
    summary: "",
    ...overrides,
  };
}

const genesis = stage({
  slug: "gen-03-05-sin-enters",
  title: "Genesis 3–5 — Satan and Sin Enter",
  stage: 2,
  side: "ascent",
  mirror: "rev-20-satan-cast-out",
  chapters: ["1.3"],
});

const revelation = stage({
  slug: "rev-20-satan-cast-out",
  title: "Revelation 20 — Satan and Sin Exit",
  stage: 10,
  side: "descent",
  mirror: "gen-03-05-sin-enters",
  chapters: ["66.20"],
});

const gospels = stage({
  slug: "gospels-jesus-christ",
  title: "The Gospels — Jesus Christ (God)",
  stage: 6,
  side: "peak",
  mirror: null,
  chapters: ["40.1"],
});

const brokenMirror = stage({
  slug: "broken-stage",
  title: "Broken Stage",
  stage: 12,
  mirror: "does-not-exist",
  chapters: ["1.1"],
});

const allStages: Stage[] = [genesis, revelation, gospels, brokenMirror];

// ---------------------------------------------------------------------------
// resolveMirrorPair
// ---------------------------------------------------------------------------

test("resolveMirrorPair: an unknown slug is not-found", () => {
  assert.deepEqual(resolveMirrorPair(allStages, "no-such-stage"), { status: "not-found" });
});

test("resolveMirrorPair: a real, reciprocal pair resolves ok with both sides", () => {
  const result = resolveMirrorPair(allStages, "gen-03-05-sin-enters");
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.stage.slug, "gen-03-05-sin-enters");
  assert.equal(result.partner.slug, "rev-20-satan-cast-out");
});

test("resolveMirrorPair: resolving from the other side of the same pair returns it reversed", () => {
  const result = resolveMirrorPair(allStages, "rev-20-satan-cast-out");
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.stage.slug, "rev-20-satan-cast-out");
  assert.equal(result.partner.slug, "gen-03-05-sin-enters");
});

test("resolveMirrorPair: stage 6 (the Gospels, mirror: null) resolves no-mirror, not ok and not not-found", () => {
  assert.deepEqual(resolveMirrorPair(allStages, "gospels-jesus-christ"), {
    status: "no-mirror",
    stage: gospels,
  });
});

test("resolveMirrorPair: a mirror slug pointing at nothing in the stage set resolves broken-mirror", () => {
  assert.deepEqual(resolveMirrorPair(allStages, "broken-stage"), {
    status: "broken-mirror",
    stage: brokenMirror,
  });
});

// ===========================================================================
// MUTATION-PROOF PAIR for resolveMirrorPair's no-mirror branch. See this
// task's report for the paste of both runs (mutated red, restored green).
// The mutation tested: swap the no-mirror guard from `!stage.mirror` to
// `stage.mirror === undefined` (a plausible typo — `mirror` is typed
// `string | null`, never `undefined`), which would make stage 6 fall
// through to the `partner` lookup, find nothing (mirror is `null`, not a
// slug in the map), and silently mis-resolve to "broken-mirror" instead of
// the correct "no-mirror" -- the wrong honest state for the route to show
// for the mountain's peak. The test below fails loudly under that mutation.
// ===========================================================================

test("MUTATION-GUARD: a null mirror must resolve no-mirror, never broken-mirror", () => {
  const result = resolveMirrorPair(allStages, "gospels-jesus-christ");
  assert.equal(result.status, "no-mirror");
});

// ---------------------------------------------------------------------------
// resolveOpeningChapter
// ---------------------------------------------------------------------------

test("resolveOpeningChapter: parses the first chapters[] RefKey into book/chapter", () => {
  assert.deepEqual(resolveOpeningChapter(genesis), { book: 1, chapter: 3 });
  assert.deepEqual(resolveOpeningChapter(revelation), { book: 66, chapter: 20 });
});

test("resolveOpeningChapter: an empty chapters array is null, not a crash", () => {
  const noChapters = stage({ slug: "x", stage: 1, chapters: [] });
  assert.equal(resolveOpeningChapter(noChapters), null);
});

test("resolveOpeningChapter: an unparseable RefKey is null, not a crash", () => {
  const badChapters = stage({ slug: "x", stage: 1, chapters: ["not-a-refkey"] });
  assert.equal(resolveOpeningChapter(badChapters), null);
});

test("resolveOpeningChapter: a verse-level RefKey still yields the containing chapter", () => {
  const verseAnchored = stage({ slug: "x", stage: 1, chapters: ["1.3.15"] });
  assert.deepEqual(resolveOpeningChapter(verseAnchored), { book: 1, chapter: 3 });
});

// ---------------------------------------------------------------------------
// splitStageLabel
// ---------------------------------------------------------------------------

test("splitStageLabel: splits on an em dash", () => {
  assert.deepEqual(splitStageLabel("Genesis 3–5 — Satan and Sin Enter"), {
    reference: "Genesis 3–5",
    short: "Satan and Sin Enter",
  });
});

test("splitStageLabel: splits on an en dash", () => {
  assert.deepEqual(splitStageLabel("Genesis 1–2 – God and Righteous People in Paradise"), {
    reference: "Genesis 1–2",
    short: "God and Righteous People in Paradise",
  });
});

test("splitStageLabel: a title with no dash is entirely the reference, short is empty", () => {
  assert.deepEqual(splitStageLabel("Genesis"), { reference: "Genesis", short: "" });
});
