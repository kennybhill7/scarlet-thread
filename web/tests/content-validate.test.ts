/**
 * CONTENTPIPE-001 — unit tests for `scripts/content/validate.ts`: the
 * frontmatter/body splitter, the minimal YAML-subset frontmatter parser,
 * the assertion-line lint, and `validateLessonSource`'s combination of all
 * three plus the schema. The filesystem-walk tests (`findMarkdownFiles`,
 * `runValidation`) use real temporary directories (`node:fs`'s
 * `mkdtempSync`/`rmSync`) — genuine IO, not a mock — since that is exactly
 * the behavior (missing directory -> [], nested recursion, sorted output)
 * worth proving against the real filesystem.
 *
 * Author: Kenneth Hill
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CURRICULUM_DIR,
  findHeadingBlockLines,
  findMarkdownFiles,
  findPositionsBlockLines,
  hasNonEmptyHeadingSection,
  lintAssertionLanguage,
  parseFrontmatterYaml,
  REQUIRED_TEACH_BACK_HEADING,
  runValidation,
  splitFrontmatter,
  validateLessonSource,
  VERDICT_PATTERNS,
} from "../scripts/content/validate";

// ===========================================================================
// splitFrontmatter
// ===========================================================================

test("SPLIT: a well-formed frontmatter block splits into frontmatterText and body", () => {
  const raw = "---\nauthor: Kenneth Hill\nstatus: draft\n---\n# Title\n\nBody text.\n";
  const result = splitFrontmatter(raw);
  assert.notEqual(result, null);
  assert.equal(result?.frontmatterText, "author: Kenneth Hill\nstatus: draft");
  assert.equal(result?.body, "# Title\n\nBody text.\n");
});

test("SPLIT: a file with no leading '---' returns null", () => {
  assert.equal(splitFrontmatter("# Just a heading\n\nNo frontmatter here.\n"), null);
});

test("SPLIT: an unterminated frontmatter block (no closing '---') returns null", () => {
  assert.equal(splitFrontmatter("---\nauthor: Kenneth Hill\n\n# Title\n"), null);
});

// ===========================================================================
// parseFrontmatterYaml
// ===========================================================================

test("YAML: bare scalar, quoted scalar, and all-digit scalar coerce correctly", () => {
  const result = parseFrontmatterYaml('author: Kenneth Hill\ntitle: "Quoted Value"\nstage: 3\nflag: true\n');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.author, "Kenneth Hill");
  assert.equal(result.data.title, "Quoted Value");
  assert.equal(result.data.stage, 3);
  assert.equal(typeof result.data.stage, "number");
  assert.equal(result.data.flag, true);
});

test("YAML: a RefKey-shaped bare scalar (contains dots) stays a string, not a number", () => {
  const result = parseFrontmatterYaml("start: 1.3.1\n");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.start, "1.3.1");
  assert.equal(typeof result.data.start, "string");
});

test("YAML: a block list ('- item') parses to an array", () => {
  const result = parseFrontmatterYaml("connectionIds:\n  - conn-a\n  - conn-b\n");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data.connectionIds, ["conn-a", "conn-b"]);
});

test("YAML: a one-level nested mapping parses to an object", () => {
  const result = parseFrontmatterYaml("passage:\n  start: 1.3.1\n  end: 1.3.24\n");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data.passage, { start: "1.3.1", end: "1.3.24" });
});

test("YAML: 'key:' with nothing indented under it becomes an empty array", () => {
  const result = parseFrontmatterYaml("sources:\n");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data.sources, []);
});

test("YAML: blank lines and '#' comment lines are ignored, top-level and inside a block", () => {
  const result = parseFrontmatterYaml(
    "# a leading comment\nauthor: Kenneth Hill\n\nconnectionIds:\n  - conn-a\n\n  # a comment inside the block\n  - conn-b\n",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.author, "Kenneth Hill");
  assert.deepEqual(result.data.connectionIds, ["conn-a", "conn-b"]);
});

test("YAML: unexpected top-level indentation is a real reported error", () => {
  const result = parseFrontmatterYaml("  author: Kenneth Hill\n");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((error) => error.includes("unexpected indentation")));
});

test("YAML: a line with no colon is a real reported error", () => {
  const result = parseFrontmatterYaml("this is not valid yaml\n");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.length > 0);
});

test("YAML: an empty key ('  : value' minus indentation, i.e. ': value') is a real reported error", () => {
  const result = parseFrontmatterYaml(": value\n");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((error) => error.includes("empty key")));
});

// ===========================================================================
// findPositionsBlockLines
// ===========================================================================

test("POSITIONS: an exact '## Positions' heading opens a block that runs to the next '## ' heading", () => {
  const lines = [
    "Intro prose.",
    "## Positions",
    "Reformed holds X.",
    "Wesleyan holds Y.",
    "## Teach-back",
    "Not inside the block.",
  ];
  const inside = findPositionsBlockLines(lines);
  assert.deepEqual([...inside].sort((a, b) => a - b), [1, 2, 3]);
});

test("POSITIONS: a heading with different text ('## Position') does NOT open a block", () => {
  const lines = ["## Position", "This should not count."];
  assert.equal(findPositionsBlockLines(lines).size, 0);
});

test("POSITIONS: an unclosed '## Positions' block runs to the end of the body", () => {
  const lines = ["## Positions", "Line one.", "Line two."];
  assert.deepEqual([...findPositionsBlockLines(lines)].sort((a, b) => a - b), [0, 1, 2]);
});

// ===========================================================================
// LESSONSHAPE-001 — findHeadingBlockLines (the generalized form
// findPositionsBlockLines now delegates to) and hasNonEmptyHeadingSection
// (the new required-section-exists check).
// ===========================================================================

test("HEADING BLOCKS: findPositionsBlockLines and findHeadingBlockLines(lines, \"Positions\") agree exactly -- the wrapper is a real delegation, not a parallel implementation", () => {
  const lines = ["Intro.", "## Positions", "Reformed holds X.", "## Teach-Back Prompts", "Not inside."];
  assert.deepEqual(
    [...findPositionsBlockLines(lines)].sort((a, b) => a - b),
    [...findHeadingBlockLines(lines, "Positions")].sort((a, b) => a - b),
  );
});

test("HEADING BLOCKS: findHeadingBlockLines works for an arbitrary heading, not just 'Positions'", () => {
  const lines = ["Intro.", "## Teach-Back Prompts", "Prompt one.", "Prompt two.", "## Next Heading", "Excluded."];
  const inside = findHeadingBlockLines(lines, "Teach-Back Prompts");
  assert.deepEqual([...inside].sort((a, b) => a - b), [1, 2, 3]);
});

test("REQUIRED_TEACH_BACK_HEADING names exactly 'Teach-Back Prompts'", () => {
  assert.equal(REQUIRED_TEACH_BACK_HEADING, "Teach-Back Prompts");
});

test("hasNonEmptyHeadingSection: false when the heading is entirely absent", () => {
  assert.equal(hasNonEmptyHeadingSection("# Fixture\n\nJust some prose.\n", REQUIRED_TEACH_BACK_HEADING), false);
});

test("hasNonEmptyHeadingSection: false when the heading is present but only blank lines follow it", () => {
  const body = `## ${REQUIRED_TEACH_BACK_HEADING}\n\n\n## Some Other Heading\n\nreal content, but under the wrong heading`;
  assert.equal(hasNonEmptyHeadingSection(body, REQUIRED_TEACH_BACK_HEADING), false);
});

test("hasNonEmptyHeadingSection: true when the heading has real, non-blank content under it", () => {
  const body = `## ${REQUIRED_TEACH_BACK_HEADING}\n\n1. Explain without notes.\n`;
  assert.equal(hasNonEmptyHeadingSection(body, REQUIRED_TEACH_BACK_HEADING), true);
});

// ===========================================================================
// lintAssertionLanguage — mutation-proving: verdict language outside a
// Positions block or quote fails; the same language inside either passes.
// ===========================================================================

test("LINT: VERDICT_PATTERNS covers exactly the four phrases BUILD_PLAN §5.1 names", () => {
  const ids = VERDICT_PATTERNS.map((pattern) => pattern.id).sort();
  assert.deepEqual(ids, [
    "the-correct-view-is",
    "this-means",
    "this-passage-teaches-that",
    "this-proves",
  ]);
});

test("LINT: verdict language in plain body prose is flagged", () => {
  const matches = lintAssertionLanguage("Some intro.\n\nThis passage teaches that Adam represents humanity.\n");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].patternId, "this-passage-teaches-that");
  assert.equal(matches[0].line, 3);
});

test("LINT: the same verdict phrase inside a '## Positions' block is NOT flagged", () => {
  const body = "## Positions\n\nReformed interpreters hold that this passage teaches that Adam represents humanity.\n";
  assert.equal(lintAssertionLanguage(body).length, 0);
});

test("LINT: the same verdict phrase in a markdown blockquote (quoted source) is NOT flagged", () => {
  const body = '> This proves the point, according to Kidner.\n\n-- Kidner, Genesis (Tyndale)\n';
  assert.equal(lintAssertionLanguage(body).length, 0);
});

test("LINT: is case-insensitive", () => {
  const matches = lintAssertionLanguage("THIS PROVES the argument.\n");
  assert.equal(matches.length, 1);
});

test("LINT: multiple distinct matches on different lines are all reported", () => {
  const body = "This proves it.\nThe correct view is X.\nThis means Y.\n";
  const matches = lintAssertionLanguage(body);
  assert.equal(matches.length, 3);
});

test("LINT: body prose with none of the four phrases produces no matches", () => {
  assert.equal(lintAssertionLanguage("A plain observation about the text, with no verdict language.\n").length, 0);
});

// ===========================================================================
// validateLessonSource — full combination
// ===========================================================================

const VALID_SOURCE = [
  "---",
  "passage:",
  "  start: 1.3.1",
  "  end: 1.3.24",
  "stage: 3",
  "methodFocus: Observation vs. inference",
  "author: Kenneth Hill",
  "status: draft",
  "---",
  "# A synthetic fixture lesson",
  "",
  "Plain observational prose, no verdict language.",
  "",
  "## Teach-Back Prompts",
  "",
  "1. Explain this passage without your notes (synthetic fixture prompt).",
  "",
].join("\n");

test("VALIDATE: a well-formed synthetic lesson passes with no errors", () => {
  const result = validateLessonSource("fixture.md", VALID_SOURCE);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.frontmatter?.author, "Kenneth Hill");
});

test("VALIDATE: a file with no frontmatter block fails", () => {
  const result = validateLessonSource("fixture.md", "# No frontmatter\n\nJust prose.\n");
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("frontmatter block")));
});

test("VALIDATE: invalid frontmatter (bad schema) fails with a frontmatter-prefixed error", () => {
  const badSource = VALID_SOURCE.replace("stage: 3", "stage: 99");
  const result = validateLessonSource("fixture.md", badSource);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.startsWith("frontmatter:")));
});

test("VALIDATE: verdict language outside a Positions block fails the whole file", () => {
  const source = VALID_SOURCE.replace(
    "Plain observational prose, no verdict language.",
    "This passage teaches that Adam represents humanity.",
  );
  const result = validateLessonSource("fixture.md", source);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("assertion-line lint")));
});

test("VALIDATE: the same verdict language inside a Positions block (with a source listed) passes", () => {
  const source = [
    "---",
    "passage:",
    "  start: 1.3.1",
    "  end: 1.3.24",
    "stage: 3",
    "methodFocus: Observation vs. inference",
    "author: Kenneth Hill",
    "status: draft",
    "sources:",
    "  - source-fixture-one",
    "---",
    "## Positions",
    "",
    "Reformed interpreters hold that this passage teaches that Adam represents humanity.",
    "",
    "## Teach-Back Prompts",
    "",
    "1. Explain this passage without your notes (synthetic fixture prompt).",
    "",
  ].join("\n");
  const result = validateLessonSource("fixture.md", source);
  assert.equal(result.ok, true, result.errors.join(" | "));
});

test("VALIDATE: a Positions block with an empty sources[] fails", () => {
  const source = [
    "---",
    "passage:",
    "  start: 1.3.1",
    "  end: 1.3.24",
    "stage: 3",
    "methodFocus: Observation vs. inference",
    "author: Kenneth Hill",
    "status: draft",
    "---",
    "## Positions",
    "",
    "Reformed interpreters hold X.",
    "",
  ].join("\n");
  const result = validateLessonSource("fixture.md", source);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("Positions") && error.includes("sources")));
});

test("VALIDATE: verdict language behind assertionReviewed passes, but is reported as a non-silent warning", () => {
  const source = [
    "---",
    "passage:",
    "  start: 1.3.1",
    "  end: 1.3.24",
    "stage: 3",
    "methodFocus: Observation vs. inference",
    "author: Kenneth Hill",
    "status: draft",
    'assertionReviewed: "reviewed 2026-09-12, false positive"',
    "---",
    "This passage teaches that Adam represents humanity.",
    "",
    "## Teach-Back Prompts",
    "",
    "1. Explain this passage without your notes (synthetic fixture prompt).",
    "",
  ].join("\n");
  const result = validateLessonSource("fixture.md", source);
  assert.equal(result.ok, true, result.errors.join(" | "));
  assert.equal(result.warnings.length, 1);
  assert.ok(result.warnings[0].includes("assertionReviewed"));
  assert.ok(result.warnings[0].includes("this-passage-teaches-that"));
});

// ===========================================================================
// LESSONSHAPE-001 — the new REQUIRED "## Teach-Back Prompts" section rule,
// at the full validateLessonSource level (not just hasNonEmptyHeadingSection
// in isolation above).
// ===========================================================================

/** VALID_SOURCE minus its own `## Teach-Back Prompts` section -- the "this
 * heading is entirely absent" case, built by removing exactly what VALID_SOURCE
 * added, so the rest of the fixture (frontmatter, plain prose) stays identical
 * to the passing baseline above. */
const SOURCE_MISSING_TEACH_BACK = VALID_SOURCE.replace(
  "\n\n## Teach-Back Prompts\n\n1. Explain this passage without your notes (synthetic fixture prompt).\n",
  "",
);

test("VALIDATE: a lesson with no '## Teach-Back Prompts' heading at all fails, naming the file and the missing heading", () => {
  const result = validateLessonSource("content/curriculum/fixture/missing-teach-back.md", SOURCE_MISSING_TEACH_BACK);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes("Teach-Back Prompts") && error.includes("missing")),
    `expected a clear, specific missing-section error; got: ${result.errors.join(" | ")}`,
  );
});

test("VALIDATE: a lesson with a bare '## Teach-Back Prompts' heading (no real content under it) fails, same as absent", () => {
  const source = [
    "---",
    "passage:",
    "  start: 1.3.1",
    "  end: 1.3.24",
    "stage: 3",
    "methodFocus: Observation vs. inference",
    "author: Kenneth Hill",
    "status: draft",
    "---",
    "# A synthetic fixture lesson",
    "",
    "Plain observational prose, no verdict language.",
    "",
    "## Teach-Back Prompts",
    "",
    "",
  ].join("\n");
  const result = validateLessonSource("fixture.md", source);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("Teach-Back Prompts")));
});

test("VALIDATE: a lesson WITH a non-empty '## Teach-Back Prompts' section (VALID_SOURCE itself) passes with no error naming that heading", () => {
  const result = validateLessonSource("fixture.md", VALID_SOURCE);
  assert.equal(result.ok, true, result.errors.join(" | "));
  assert.ok(!result.errors.some((error) => error.includes("Teach-Back Prompts")));
});

test("VALIDATE: an otherwise-valid lesson missing only '## Teach-Back Prompts' fails for exactly that reason, no other error", () => {
  const result = validateLessonSource("fixture.md", SOURCE_MISSING_TEACH_BACK);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1, result.errors.join(" | "));
  assert.ok(result.errors[0].includes("Teach-Back Prompts"));
});

// ===========================================================================
// LESSONSHAPE-001 — real validation against this repo's actual checked-in
// content/curriculum/ files. As of this task there is exactly one real
// lesson, content/curriculum/genesis/03-the-fall.md, already `status:
// published` and live in production (RELEASEREADER-001/SOURCESYNC-001) --
// and it predates the '## Teach-Back Prompts' rule this task adds, so it
// does NOT have that section yet. That means it is EXPECTED and CORRECT for
// this real file to now fail content:validate -- a follow-up
// content-authoring task adds the missing section, not this one. This test
// proves the failure is the real, specific one this task's own rule
// produces (not some unrelated breakage), and that this task did not
// silently make it pass by weakening the rule. It does NOT assert the
// `content:validate` CLI process exits 0 -- that command is expected to
// exit non-zero against this repo's real content right now.
// ===========================================================================

test("REAL CONTENT: content/curriculum/genesis/03-the-fall.md (the one real, published lesson in this repo) currently fails validation for exactly the missing '## Teach-Back Prompts' section, and for no other reason", () => {
  const { results } = runValidation(CURRICULUM_DIR);
  const genesis3 = results.find((result) => result.filePath.replace(/\\/g, "/").endsWith("genesis/03-the-fall.md"));
  assert.ok(genesis3, "content/curriculum/genesis/03-the-fall.md should exist and be found by runValidation");
  assert.equal(
    genesis3?.ok,
    false,
    "EXPECTED failure: this real, already-published lesson predates the '## Teach-Back Prompts' rule and does not yet carry that section -- a follow-up content-authoring task adds it, not LESSONSHAPE-001",
  );
  assert.ok(
    genesis3?.errors.some((error) => error.includes("Teach-Back Prompts")),
    `expected the real, specific missing-section error; got: ${genesis3?.errors.join(" | ")}`,
  );
  // The lesson does not already have a "## Teach-Back Prompts" heading in
  // its real source today -- sanity-checking the premise of this test
  // directly, not just trusting the validator's own verdict.
  assert.ok(
    !readFileSync(genesis3!.filePath, "utf8").includes("## Teach-Back Prompts"),
    "sanity check: the real file must not already contain this heading, or this test's premise is stale",
  );
});

// ===========================================================================
// findMarkdownFiles / runValidation — real filesystem IO against a temp dir
// ===========================================================================

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "contentpipe-test-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("FIND: a missing directory returns [] rather than throwing", () => {
  withTempDir((dir) => {
    const missing = path.join(dir, "does-not-exist");
    assert.deepEqual(findMarkdownFiles(missing), []);
  });
});

test("FIND: recursively finds .md files in nested directories, sorted, ignoring non-.md files", () => {
  withTempDir((dir) => {
    mkdirSync(path.join(dir, "genesis"), { recursive: true });
    mkdirSync(path.join(dir, "matthew"), { recursive: true });
    writeFileSync(path.join(dir, "genesis", "03-the-fall.md"), "content");
    writeFileSync(path.join(dir, "genesis", "notes.txt"), "ignore me");
    writeFileSync(path.join(dir, "matthew", "01-genealogy.md"), "content");
    writeFileSync(path.join(dir, "README.md"), "content");

    const files = findMarkdownFiles(dir).map((file) => path.relative(dir, file).split(path.sep).join("/"));
    assert.deepEqual(files, ["README.md", "genesis/03-the-fall.md", "matthew/01-genealogy.md"]);
  });
});

test("RUN: runValidation over an empty/missing directory succeeds with zero results", () => {
  withTempDir((dir) => {
    const missing = path.join(dir, "curriculum");
    const result = runValidation(missing);
    assert.equal(result.ok, true);
    assert.deepEqual(result.results, []);
  });
});

test("RUN: runValidation reports a mix of valid and invalid real files correctly", () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, "good.md"), VALID_SOURCE);
    writeFileSync(path.join(dir, "bad.md"), "# no frontmatter at all\n");

    const result = runValidation(dir);
    assert.equal(result.ok, false);
    assert.equal(result.results.length, 2);
    const good = result.results.find((entry) => entry.filePath.endsWith("good.md"));
    const bad = result.results.find((entry) => entry.filePath.endsWith("bad.md"));
    assert.equal(good?.ok, true);
    assert.equal(bad?.ok, false);
  });
});
