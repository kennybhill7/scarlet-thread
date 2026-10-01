/**
 * MOUNTAINWHY-001 — tests for `scripts/content/lensLint.ts`: the
 * assertion-line lint extended to the Mountain's 11-stage lens data
 * (content/lens/eleven-stages.json), per
 * design/PRODUCT_EXPERIENCE_PLAN_2026-09-25.md §G4.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { LENS_STAGES_PATH } from "@/scripts/content/validate";
import {
  LENS_LINT_PATTERNS,
  lintLensFile,
  lintLensStages,
  loadLensStages,
  type LensStageLintInput,
} from "@/scripts/content/lensLint";

test("lintLensStages: empty input is zero matches", () => {
  assert.deepEqual(lintLensStages([]), []);
});

test("lintLensStages: a genuinely fine title/summary passes clean", () => {
  const fine: LensStageLintInput[] = [
    {
      slug: "gen-03-05-sin-enters",
      title: "Genesis 3–5 — The Serpent, the Exile, and the First Deaths",
      summary:
        "This lens pairs this stage with Revelation 20 — Satan Bound and Judged. Genesis 3 narrates a serpent " +
        "(3:1); it does not name it \"Satan\" -- that identification comes later in the canon.",
    },
  ];
  assert.deepEqual(lintLensStages(fine), []);
});

test("lintLensStages: catches one of the four base VERDICT_PATTERNS in a title", () => {
  const bad: LensStageLintInput[] = [
    {
      slug: "test-stage",
      title: "Genesis 1–2 — This proves God made the world in six literal days",
      summary: "Fine.",
    },
  ];
  const matches = lintLensStages(bad);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].field, "title");
  assert.equal(matches[0].patternId, "this-proves");
  assert.equal(matches[0].slug, "test-stage");
});

test("lintLensStages: catches one of the four base VERDICT_PATTERNS in a summary line", () => {
  const bad: LensStageLintInput[] = [
    {
      slug: "test-stage",
      title: "Fine title",
      summary: "First line is fine.\nThe correct view is that this means the serpent is Satan.",
    },
  ];
  const matches = lintLensStages(bad);
  // "the correct view is" AND "this means" both appear on line 2 -- both are real, separate hits.
  assert.equal(matches.length, 2);
  assert.ok(matches.every((m) => m.field === "summary" && m.line === 2));
  assert.deepEqual(
    matches.map((m) => m.patternId).sort(),
    ["the-correct-view-is", "this-means"],
  );
});

test("lintLensStages: catches the real historical defect -- a bare divine-identity parenthetical", () => {
  const bad: LensStageLintInput[] = [
    { slug: "gospels-jesus-christ", title: "The Gospels — Jesus Christ (God)", summary: "Fine." },
  ];
  const matches = lintLensStages(bad);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].patternId, "bare-divine-identity-parenthetical");
  assert.equal(matches[0].field, "title");
});

test("lintLensStages: the divine-identity pattern does not false-positive on ordinary descriptive text", () => {
  const ordinary: LensStageLintInput[] = [
    {
      slug: "test-stage",
      title: "Genesis 6–9 — The World Judged and Destroyed",
      summary:
        "The LORD said to Noah that the earth was filled with violence (see Genesis 6:13). " +
        "God spoke; this is a plain description, not a parenthetical tag after a name.",
    },
  ];
  assert.deepEqual(lintLensStages(ordinary), []);
});

test("LENS_LINT_PATTERNS: exactly the four base VERDICT_PATTERNS plus the one lens-specific addition", () => {
  assert.equal(LENS_LINT_PATTERNS.length, 5);
  assert.ok(LENS_LINT_PATTERNS.some((p) => p.id === "bare-divine-identity-parenthetical"));
});

// ---------------------------------------------------------------------------
// Real IO
// ---------------------------------------------------------------------------

test("loadLensStages: a missing file returns null, never throws", () => {
  assert.equal(loadLensStages(path.join(tmpdir(), "mountainwhy-001-does-not-exist.json")), null);
});

test("loadLensStages + lintLensFile: a malformed non-array file throws loudly", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mountainwhy-001-"));
  const filePath = path.join(dir, "bad.json");
  try {
    writeFileSync(filePath, JSON.stringify({ not: "an array" }));
    assert.throws(() => loadLensStages(filePath), /must be a JSON array/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lintLensFile: a real file on disk with a reintroduced bad title is caught (adversarial mutation, isolated to a temp copy)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mountainwhy-001-"));
  const filePath = path.join(dir, "mutated-stages.json");
  try {
    writeFileSync(
      filePath,
      JSON.stringify([
        { slug: "gospels-jesus-christ", title: "The Gospels — Jesus Christ (God)", summary: "Fine." },
        { slug: "gen-03-05-sin-enters", title: "Genesis 3–5 — The Serpent, the Exile, and the First Deaths", summary: "Fine." },
      ]),
    );
    const matches = lintLensFile(filePath);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].slug, "gospels-jesus-christ");
    assert.equal(matches[0].patternId, "bare-divine-identity-parenthetical");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lintLensFile: the real, moved, rewritten content/lens/eleven-stages.json has zero lint hits", () => {
  const stages = loadLensStages(LENS_STAGES_PATH);
  assert.ok(stages, "content/lens/eleven-stages.json must exist after MOUNTAINWHY-001's move");
  assert.equal(stages!.length, 11, "the mountain has exactly 11 stages");
  assert.deepEqual(lintLensFile(LENS_STAGES_PATH), []);
});
