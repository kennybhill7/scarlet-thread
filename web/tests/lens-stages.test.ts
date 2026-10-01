/**
 * MOUNTAINWHY-001 — tests for lib/content/lensStages.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  loadLensDisclosure,
  loadLensStages,
  parseLensDisclosure,
  parseLensStages,
  type LensStage,
} from "@/lib/content/lensStages";

// ---------------------------------------------------------------------------
// parseLensStages — pure
// ---------------------------------------------------------------------------

test("parseLensStages: a well-formed array round-trips", () => {
  const input = [
    {
      slug: "gen-01-02-creation",
      title: "Genesis 1–2 — Creation: God and Humanity in the Garden",
      stage: 1,
      side: "ascent",
      mirror: "rev-20-22-paradise-restored",
      chapters: ["1.1"],
      summary: "fine",
    },
  ];
  const parsed = parseLensStages(input);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].slug, "gen-01-02-creation");
  assert.equal(parsed[0].mirror, "rev-20-22-paradise-restored");
});

test("parseLensStages: mirror may be null", () => {
  const parsed = parseLensStages([
    { slug: "gospels-jesus-christ", title: "The Gospels — Jesus Christ", stage: 6, side: "peak", mirror: null, chapters: ["40.1"], summary: "fine" },
  ]);
  assert.equal(parsed[0].mirror, null);
});

test("parseLensStages: rejects a non-array", () => {
  assert.throws(() => parseLensStages({ not: "an array" }), /must be a JSON array/);
});

test("parseLensStages: rejects an invalid side", () => {
  assert.throws(
    () =>
      parseLensStages([
        { slug: "x", title: "x", stage: 1, side: "sideways", mirror: null, chapters: [], summary: "x" },
      ]),
    /unexpected shape/,
  );
});

test("parseLensStages: rejects a missing field", () => {
  assert.throws(
    () => parseLensStages([{ slug: "x", title: "x", stage: 1, side: "ascent", mirror: null, chapters: [] }]),
    /unexpected shape/,
  );
});

// ---------------------------------------------------------------------------
// parseLensDisclosure — pure
// ---------------------------------------------------------------------------

test("parseLensDisclosure: a well-formed object round-trips", () => {
  const input = {
    id: "eleven-stage-mirror",
    title: "Why this shape?",
    author: "Kenneth Hill",
    status: "draft",
    statusNote: "note",
    whatThisIs: ["a", "b"],
    author_statement: "statement",
    method: ["m"],
    cautions: ["c"],
    otherLenses: [{ id: "canonical-order", label: "Canonical order", available: true, description: "d" }],
  };
  const parsed = parseLensDisclosure(input);
  assert.equal(parsed.author, "Kenneth Hill");
  assert.equal(parsed.status, "draft");
  assert.equal(parsed.otherLenses[0].available, true);
});

test("parseLensDisclosure: rejects a malformed otherLenses entry", () => {
  assert.throws(
    () =>
      parseLensDisclosure({
        id: "x",
        title: "x",
        author: "x",
        status: "draft",
        statusNote: "x",
        whatThisIs: [],
        author_statement: "x",
        method: [],
        cautions: [],
        otherLenses: [{ id: "x" }],
      }),
    /unexpected shape/,
  );
});

// ---------------------------------------------------------------------------
// Real IO against the real, moved content files.
// ---------------------------------------------------------------------------

test("loadLensStages: the real content/lens/eleven-stages.json loads as exactly 11 well-formed stages", () => {
  const stages: LensStage[] = loadLensStages();
  assert.equal(stages.length, 11);
  const stageNumbers = stages.map((s) => s.stage).sort((a, b) => a - b);
  assert.deepEqual(stageNumbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  // Every mirror reference points at a real slug in this same set, and is reciprocal.
  const bySlug = new Map(stages.map((s) => [s.slug, s]));
  for (const stage of stages) {
    if (stage.mirror === null) continue;
    const partner = bySlug.get(stage.mirror);
    assert.ok(partner, `${stage.slug} mirrors unknown slug ${stage.mirror}`);
    assert.equal(partner!.mirror, stage.slug, `${stage.slug} <-> ${stage.mirror} is not reciprocal`);
  }
});

test("loadLensStages: no title reads as a doctrinal verdict about Genesis 3's serpent or Christ's deity (regression guard for this task's own fix)", () => {
  const stages = loadLensStages();
  const byTitle = stages.map((s) => s.title);
  assert.ok(!byTitle.some((t) => /satan/i.test(t) && /enter/i.test(t)), "Genesis 3-5's title must not assert the Genesis serpent is Satan");
  assert.ok(!byTitle.some((t) => /\(god\)/i.test(t)), "no title may carry a bare '(God)' parenthetical");
});

test("loadLensDisclosure: the real content/lens/why-this-shape.json loads, names Kenneth Hill as author, and is marked draft", () => {
  const disclosure = loadLensDisclosure();
  assert.equal(disclosure.author, "Kenneth Hill");
  assert.equal(disclosure.status, "draft");
  assert.ok(disclosure.whatThisIs.length > 0);
  assert.ok(disclosure.otherLenses.some((l) => l.id === "canonical-order" && l.available));
});
