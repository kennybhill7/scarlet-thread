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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  findMarkdownFiles,
  findPositionsBlockLines,
  lintAssertionLanguage,
  parseFrontmatterYaml,
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
  ].join("\n");
  const result = validateLessonSource("fixture.md", source);
  assert.equal(result.ok, true, result.errors.join(" | "));
  assert.equal(result.warnings.length, 1);
  assert.ok(result.warnings[0].includes("assertionReviewed"));
  assert.ok(result.warnings[0].includes("this-passage-teaches-that"));
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
