/**
 * CONTENTPIPE-001 — unit tests for `scripts/content/build.ts`'s pure logic:
 * canonical JSON serialization, SHA-256 checksum determinism, release-bundle
 * assembly, and `buildReleaseFromValidation`'s use of a `validate.ts`
 * `RunValidationResult`. No filesystem or database access anywhere in this
 * file — `buildReleaseFromValidation` is exercised against hand-built
 * `RunValidationResult` fixtures (dependency injection), the same
 * discipline `tests/release-migrate.test.ts` already established.
 *
 * Author: Kenneth Hill
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { CANONICAL_VERSIFICATION_ID } from "@/lib/contracts/range-v1";

import type { LessonFrontmatter } from "../scripts/content/schema";
import {
  buildReleaseFromValidation,
  canonicalJsonStringify,
  compileReleaseBundle,
  computeChecksum,
  slugFor,
  type CompileLessonInput,
} from "../scripts/content/build";
import type { LessonValidationResult, RunValidationResult } from "../scripts/content/validate";

function fixtureFrontmatter(overrides: Partial<LessonFrontmatter> = {}): LessonFrontmatter {
  return {
    passage: { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.1", end: "1.3.24" },
    stage: 3,
    methodFocus: "Observation vs. inference",
    connectionIds: [],
    positionIds: [],
    sources: [],
    author: "Kenneth Hill",
    status: "draft",
    ...overrides,
  };
}

// ===========================================================================
// canonicalJsonStringify — deterministic regardless of key insertion order
// ===========================================================================

test("CANONICAL: two objects with the same keys in different insertion order serialize identically", () => {
  const a = { b: 2, a: 1, c: { z: 3, y: 2 } };
  const b = { a: 1, c: { y: 2, z: 3 }, b: 2 };
  assert.equal(canonicalJsonStringify(a), canonicalJsonStringify(b));
});

test("CANONICAL: array element order is preserved (not sorted) even though object keys are", () => {
  const value = { items: ["b", "a", "c"] };
  assert.equal(canonicalJsonStringify(value), '{"items":["b","a","c"]}');
});

test("CANONICAL: nested objects inside arrays are also key-sorted", () => {
  const value = [{ b: 1, a: 2 }];
  assert.equal(canonicalJsonStringify(value), '[{"a":2,"b":1}]');
});

test("CANONICAL: a logically different value serializes differently", () => {
  assert.notEqual(canonicalJsonStringify({ a: 1 }), canonicalJsonStringify({ a: 2 }));
});

// ===========================================================================
// computeChecksum — real SHA-256, deterministic, mutation-proving
// ===========================================================================

test("CHECKSUM: is a 64-character lowercase hex SHA-256 digest", () => {
  const checksum = computeChecksum({ hello: "world" });
  assert.equal(checksum.length, 64);
  assert.match(checksum, /^[0-9a-f]{64}$/);
});

test("CHECKSUM: the same logical bundle always produces the same checksum", () => {
  const bundleA = { schemaVersion: 1, lessonCount: 1, lessons: { "genesis/03": { a: 1, b: 2 } } };
  const bundleB = { lessonCount: 1, schemaVersion: 1, lessons: { "genesis/03": { b: 2, a: 1 } } };
  assert.equal(computeChecksum(bundleA), computeChecksum(bundleB));
});

test("CHECKSUM: a changed bundle (one field's value differs) always produces a different checksum", () => {
  const bundleA = { schemaVersion: 1, lessonCount: 1, lessons: { "genesis/03": { author: "Kenneth Hill" } } };
  const bundleB = { schemaVersion: 1, lessonCount: 1, lessons: { "genesis/03": { author: "Someone Else" } } };
  assert.notEqual(computeChecksum(bundleA), computeChecksum(bundleB));
});

test("CHECKSUM: a real, independently-computed SHA-256 vector matches (proves this is really SHA-256 over the canonical JSON, not a placeholder)", () => {
  // Independently verified: `echo -n '{"hello":"world"}' | sha256sum` (and
  // Node's own `crypto.createHash("sha256")` outside this module) both
  // produce this exact digest for the canonical JSON of { hello: "world" }.
  assert.equal(
    computeChecksum({ hello: "world" }),
    "93a23971a914e5eacbf0a8d25154cda309c3c1c72fbb9914d47c60f3cb681588",
  );
});

// ===========================================================================
// compileReleaseBundle
// ===========================================================================

test("BUNDLE: zero lessons compiles to a valid, empty release (the honest starting state)", () => {
  const bundle = compileReleaseBundle([]);
  assert.deepEqual(bundle, { schemaVersion: 1, lessonCount: 0, lessons: {} });
});

test("BUNDLE: lessons are keyed by slug and lessonCount matches the input length", () => {
  const lessons: CompileLessonInput[] = [
    { slug: "matthew/01-genealogy", frontmatter: fixtureFrontmatter(), body: "Matthew body" },
    { slug: "genesis/03-the-fall", frontmatter: fixtureFrontmatter(), body: "Genesis body" },
  ];
  const bundle = compileReleaseBundle(lessons);
  assert.equal(bundle.lessonCount, 2);
  assert.equal(bundle.lessons["genesis/03-the-fall"]?.body, "Genesis body");
  assert.equal(bundle.lessons["matthew/01-genealogy"]?.body, "Matthew body");
});

test("BUNDLE: a duplicate slug throws loudly rather than silently overwriting", () => {
  const lessons: CompileLessonInput[] = [
    { slug: "genesis/03-the-fall", frontmatter: fixtureFrontmatter(), body: "First" },
    { slug: "genesis/03-the-fall", frontmatter: fixtureFrontmatter(), body: "Second" },
  ];
  assert.throws(() => compileReleaseBundle(lessons), /duplicate lesson slug/);
});

test("BUNDLE: compiling the same lessons in a different array order produces the same checksum", () => {
  const lessonA: CompileLessonInput = { slug: "genesis/03-the-fall", frontmatter: fixtureFrontmatter(), body: "A" };
  const lessonB: CompileLessonInput = {
    slug: "matthew/01-genealogy",
    frontmatter: fixtureFrontmatter(),
    body: "B",
  };
  const checksum1 = computeChecksum(compileReleaseBundle([lessonA, lessonB]));
  const checksum2 = computeChecksum(compileReleaseBundle([lessonB, lessonA]));
  assert.equal(checksum1, checksum2);
});

// ===========================================================================
// slugFor
// ===========================================================================

test("SLUG: strips the curriculum dir prefix, the .md extension, and normalizes to forward slashes", () => {
  const curriculumDir = path.join("content", "curriculum");
  const filePath = path.join(curriculumDir, "genesis", "03-the-fall.md");
  assert.equal(slugFor(filePath, curriculumDir), "genesis/03-the-fall");
});

// ===========================================================================
// buildReleaseFromValidation
// ===========================================================================

function validResult(filePath: string, frontmatter: LessonFrontmatter, body: string): LessonValidationResult {
  return { ok: true, filePath, errors: [], warnings: [], frontmatter, body };
}

function invalidResult(filePath: string, errors: string[]): LessonValidationResult {
  return { ok: false, filePath, errors, warnings: [] };
}

test("BUILD: an empty validation result (no lesson files) builds a valid, empty release", () => {
  const validation: RunValidationResult = { ok: true, results: [] };
  const result = buildReleaseFromValidation("content/curriculum", validation);
  assert.equal(result.ok, true);
  assert.deepEqual(result.bundle, { schemaVersion: 1, lessonCount: 0, lessons: {} });
  assert.match(result.checksum ?? "", /^[0-9a-f]{64}$/);
});

test("BUILD: all-valid lessons compile into a bundle with a checksum", () => {
  const curriculumDir = path.join("content", "curriculum");
  const filePath = path.join(curriculumDir, "genesis", "03-the-fall.md");
  const validation: RunValidationResult = {
    ok: true,
    results: [validResult(filePath, fixtureFrontmatter(), "Body text.")],
  };
  const result = buildReleaseFromValidation(curriculumDir, validation);
  assert.equal(result.ok, true);
  assert.equal(result.bundle?.lessonCount, 1);
  assert.ok(result.bundle?.lessons["genesis/03-the-fall"]);
});

test("BUILD: refuses to build (no bundle, no checksum) when ANY lesson fails validation", () => {
  const curriculumDir = path.join("content", "curriculum");
  const goodPath = path.join(curriculumDir, "genesis", "03-the-fall.md");
  const badPath = path.join(curriculumDir, "genesis", "04-broken.md");
  const validation: RunValidationResult = {
    ok: false,
    results: [
      validResult(goodPath, fixtureFrontmatter(), "Body text."),
      invalidResult(badPath, ["frontmatter: author is required"]),
    ],
  };
  const result = buildReleaseFromValidation(curriculumDir, validation);
  assert.equal(result.ok, false);
  assert.equal(result.bundle, undefined);
  assert.equal(result.checksum, undefined);
  assert.ok(result.errors.some((error) => error.includes("04-broken.md") && error.includes("author is required")));
});
