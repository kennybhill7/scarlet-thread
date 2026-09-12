/**
 * CONTENTPIPE-001 — unit tests for `scripts/content/schema.ts`'s zod
 * frontmatter schema. Pure, no filesystem/DB access.
 *
 * Author: Kenneth Hill
 */
import assert from "node:assert/strict";
import test from "node:test";

import { CANONICAL_VERSIFICATION_ID } from "@/lib/contracts/range-v1";

import {
  LESSON_STATUSES,
  MAX_STAGE,
  MIN_STAGE,
  normalizeFrontmatterPassage,
  parseLessonFrontmatter,
} from "../scripts/content/schema";

function validFrontmatter(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    passage: { start: "1.3.1", end: "1.3.24" },
    stage: 3,
    methodFocus: "Observation vs. inference",
    author: "Kenneth Hill",
    status: "draft",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test("SCHEMA: a minimal valid frontmatter object parses, and defaults are applied", () => {
  const result = parseLessonFrontmatter(validFrontmatter());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.frontmatter.passage, {
    versificationId: CANONICAL_VERSIFICATION_ID,
    start: "1.3.1",
    end: "1.3.24",
  });
  assert.equal(result.frontmatter.stage, 3);
  assert.deepEqual(result.frontmatter.connectionIds, []);
  assert.deepEqual(result.frontmatter.positionIds, []);
  assert.deepEqual(result.frontmatter.sources, []);
  assert.equal(result.frontmatter.contextId, undefined);
  assert.equal(result.frontmatter.assertionReviewed, undefined);
});

test("SCHEMA: a fully populated frontmatter object parses", () => {
  const result = parseLessonFrontmatter(
    validFrontmatter({
      contextId: "gen-3-ane-context",
      connectionIds: ["conn-fall-romans5"],
      positionIds: ["pos-original-sin"],
      sources: ["source-kidner-genesis-tyndale"],
      assertionReviewed: "reviewed 2026-09-12, direct Kidner quote",
      status: "published",
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.frontmatter.contextId, "gen-3-ane-context");
  assert.deepEqual(result.frontmatter.connectionIds, ["conn-fall-romans5"]);
  assert.equal(result.frontmatter.status, "published");
  assert.equal(result.frontmatter.assertionReviewed, "reviewed 2026-09-12, direct Kidner quote");
});

test("SCHEMA: LESSON_STATUSES / MIN_STAGE / MAX_STAGE match the documented contract", () => {
  assert.deepEqual(LESSON_STATUSES, ["draft", "in_review", "published"]);
  assert.equal(MIN_STAGE, 1);
  assert.equal(MAX_STAGE, 11);
});

// ---------------------------------------------------------------------------
// passage
// ---------------------------------------------------------------------------

test("SCHEMA: normalizeFrontmatterPassage fills in versificationId when absent", () => {
  const normalized = normalizeFrontmatterPassage({ start: "1.3.1", end: "1.3.24" }) as Record<string, unknown>;
  assert.equal(normalized.versificationId, CANONICAL_VERSIFICATION_ID);
  assert.equal(normalized.start, "1.3.1");
});

test("SCHEMA: normalizeFrontmatterPassage leaves an explicit versificationId untouched", () => {
  const normalized = normalizeFrontmatterPassage({
    versificationId: "some-other-id",
    start: "1.3.1",
    end: "1.3.24",
  }) as Record<string, unknown>;
  assert.equal(normalized.versificationId, "some-other-id");
});

test("SCHEMA: an explicit, wrong versificationId is rejected, not silently overwritten", () => {
  const result = parseLessonFrontmatter(
    validFrontmatter({ passage: { versificationId: "wrong-id", start: "1.3.1", end: "1.3.24" } }),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((error) => error.includes("passage")));
});

test("SCHEMA: a malformed verse key (missing verse component) is rejected", () => {
  const result = parseLessonFrontmatter(validFrontmatter({ passage: { start: "1.3", end: "1.3.24" } }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((error) => error.includes("malformed-start")));
});

test("SCHEMA: a cross-book passage range is rejected", () => {
  const result = parseLessonFrontmatter(validFrontmatter({ passage: { start: "1.3.1", end: "2.1.1" } }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((error) => error.includes("cross-book")));
});

test("SCHEMA: a reversed passage range (end before start) is rejected", () => {
  const result = parseLessonFrontmatter(validFrontmatter({ passage: { start: "1.3.24", end: "1.3.1" } }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((error) => error.includes("reversed")));
});

test("SCHEMA: a single-verse passage (start === end) is valid", () => {
  const result = parseLessonFrontmatter(validFrontmatter({ passage: { start: "1.3.15", end: "1.3.15" } }));
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// stage
// ---------------------------------------------------------------------------

test("SCHEMA: stage 0 is rejected (below the real 1-11 range)", () => {
  const result = parseLessonFrontmatter(validFrontmatter({ stage: 0 }));
  assert.equal(result.ok, false);
});

test("SCHEMA: stage 12 is rejected (above the real 1-11 range)", () => {
  const result = parseLessonFrontmatter(validFrontmatter({ stage: 12 }));
  assert.equal(result.ok, false);
});

test("SCHEMA: stage 1 and stage 11 (the real boundary values) are both valid", () => {
  assert.equal(parseLessonFrontmatter(validFrontmatter({ stage: 1 })).ok, true);
  assert.equal(parseLessonFrontmatter(validFrontmatter({ stage: 11 })).ok, true);
});

test("SCHEMA: a non-integer stage is rejected", () => {
  const result = parseLessonFrontmatter(validFrontmatter({ stage: 3.5 }));
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// author / status
// ---------------------------------------------------------------------------

test("SCHEMA: a missing author is rejected", () => {
  const frontmatter = validFrontmatter();
  delete (frontmatter as { author?: unknown }).author;
  const result = parseLessonFrontmatter(frontmatter);
  assert.equal(result.ok, false);
});

test("SCHEMA: a blank (whitespace-only) author is rejected", () => {
  const result = parseLessonFrontmatter(validFrontmatter({ author: "   " }));
  assert.equal(result.ok, false);
});

test("SCHEMA: an invalid status value is rejected", () => {
  const result = parseLessonFrontmatter(validFrontmatter({ status: "final" }));
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// id-like fields (contextId / connectionIds / positionIds / sources)
// ---------------------------------------------------------------------------

test("SCHEMA: a whitespace-containing id is rejected", () => {
  const result = parseLessonFrontmatter(validFrontmatter({ contextId: "gen 3 context" }));
  assert.equal(result.ok, false);
});

test("SCHEMA: an empty-string id in an array is rejected", () => {
  const result = parseLessonFrontmatter(validFrontmatter({ connectionIds: [""] }));
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// assertionReviewed
// ---------------------------------------------------------------------------

test("SCHEMA: assertionReviewed must state a real reason, not be blank", () => {
  const result = parseLessonFrontmatter(validFrontmatter({ assertionReviewed: "   " }));
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// Unknown keys / strictness
// ---------------------------------------------------------------------------

test("SCHEMA: an unrecognized top-level frontmatter key is rejected (.strict())", () => {
  const result = parseLessonFrontmatter(validFrontmatter({ unexpectedField: "oops" }));
  assert.equal(result.ok, false);
});

test("SCHEMA: an unrecognized key inside passage is rejected (.strict())", () => {
  const result = parseLessonFrontmatter(
    validFrontmatter({ passage: { start: "1.3.1", end: "1.3.24", extra: "oops" } }),
  );
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// Every zod issue is rendered as a real "<path>: <message>" string, never
// swallowed.
// ---------------------------------------------------------------------------

test("SCHEMA: multiple simultaneous failures are all reported, not just the first", () => {
  const frontmatter = validFrontmatter({ stage: 99, status: "final" });
  delete (frontmatter as { author?: unknown }).author;
  const result = parseLessonFrontmatter(frontmatter);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.length >= 3, `expected >=3 errors, got ${result.errors.length}: ${result.errors.join(" | ")}`);
});
