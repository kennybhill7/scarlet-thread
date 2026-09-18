/**
 * RELEASEREADER-001 — the reader half of CONTENTPIPE-001's compiler.
 *
 * CONTENTPIPE-001 (merged) built `scripts/content/build.ts`, which validates,
 * compiles, and checksums lesson content into one `catalog_releases` row per
 * build (`db/schema.ts`'s `catalogReleases` table: `id`, `releasedAt`,
 * `checksum`, `lessonCount`, `bundle` jsonb). Nothing in the application ever
 * read that table — this module is the first thing that does.
 *
 * Deliberately does NOT import "server-only" or `@/lib/db`'s `db` singleton,
 * matching `lib/db/graphEdges.ts`'s own dependency-injected `Database`
 * -parameter style (read as precedent before writing this file): every
 * function here takes its `Database` connection as an explicit parameter
 * instead, so this module stays callable from a standalone script exactly
 * like `graphEdges.ts` already is, not just from Next.js server code.
 *
 * LOGIC-VS-IO SPLIT (`scripts/lib/importCrossReferences.ts` /
 * `scripts/lib/releaseMigrate.ts` precedent, named in this task's own
 * acceptance criteria): everything below `findPublishedLessonForRange` is
 * pure — no DB, no filesystem — and is exercised directly by
 * `tests/published-lessons.test.ts` with small injected fixtures. Only
 * `findPublishedLessonForRange` itself touches the database.
 *
 * BUNDLE SHAPE — read verbatim from `scripts/content/build.ts` (a
 * readOnlyPath here), not guessed: a `ReleaseBundle` is
 * `{ schemaVersion: 1, lessonCount, lessons: Record<slug, { frontmatter, body }> }`,
 * where `frontmatter` is a `LessonFrontmatter` (`scripts/content/schema.ts`,
 * also read-only) carrying a real `passage: CanonicalRangeV1`, and `body` is
 * the lesson's compiled Markdown. `catalogReleases.bundle` is untyped
 * `jsonb` (`db/schema.ts`'s own comment: "the release-bundle shape lives in
 * scripts/content/build.ts, a standalone script this app-wide schema module
 * should not depend on") — so what comes back from Postgres is `unknown` at
 * the type level, and `parseReleaseBundle` below re-validates its real shape
 * at runtime (via `scripts/content/schema.ts`'s own
 * `LessonFrontmatterSchema`, not a hand-rolled duplicate check) before
 * trusting it, rather than blindly casting.
 *
 * SECTION EXTRACTION — `scripts/content/validate.ts`'s `findPositionsBlockLines`
 * established the one real convention this pipeline has for a named section:
 * an ATX level-2 heading (`## Positions`) whose block runs from that heading
 * line to (not including) the next `##` heading or the end of the body.
 * `findHeadingBlockLines` below is that exact same technique, parameterized
 * by heading text instead of hardcoded to "Positions" — not a different
 * parser — so it produces identical results for "Positions" and the new
 * "Context" heading this task adds no schema/lint support for, only reading.
 *
 * Author: Kenneth Hill
 */

import { desc } from "drizzle-orm";

import { catalogReleases } from "@/db/schema";
import type { Database } from "@/lib/db";
import { rangeContainsRange } from "@/lib/bible/range";
import type { CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import { LessonFrontmatterSchema, type LessonFrontmatter } from "@/scripts/content/schema";
import type { ReleaseBundle } from "@/scripts/content/build";

// ---------------------------------------------------------------------------
// Section extraction — the "Positions" convention, generalized.
// ---------------------------------------------------------------------------

/**
 * {@link import("../../scripts/content/validate").findPositionsBlockLines}'s
 * exact algorithm, parameterized by `headingText` instead of hardcoded to
 * "Positions": an ATX level-2 heading (`## <headingText>`, trimmed,
 * case-sensitive, exact match) opens a block; the block includes that
 * heading line and every following line up to (not including) the next `##`
 * heading or the end of the body. Returns the set of line indices inside the
 * block (heading line included) — empty when no such heading exists.
 */
export function findHeadingBlockLines(bodyLines: string[], headingText: string): Set<number> {
  const inside = new Set<number>();
  let active = false;
  bodyLines.forEach((line, index) => {
    const trimmed = line.trim();
    if (/^##\s+/.test(trimmed)) {
      active = trimmed.replace(/^##\s+/, "").trim() === headingText;
      if (active) inside.add(index);
      return;
    }
    if (active) inside.add(index);
  });
  return inside;
}

/**
 * Extracts the PROSE under a `## <headingText>` heading (the heading line
 * itself is not included in the returned text) via {@link findHeadingBlockLines}.
 * Returns `null` — never an empty string — both when the heading is entirely
 * absent AND when it is present but has no non-blank content under it
 * (e.g. a lesson mid-authoring with a bare `## Context` heading and nothing
 * else): both are "no real prose to show" from this reader's point of view,
 * and the caller (`ContextSection`/`TheologySection`) must fall back to the
 * existing "no curated content yet" notice for either. A lesson may validly
 * have neither heading, either one alone, or both — this function reports
 * that per-heading, independent of whether the other heading exists.
 */
export function extractHeadingProse(body: string, headingText: string): string | null {
  const lines = body.split(/\r?\n/);
  const blockLines = [...findHeadingBlockLines(lines, headingText)].sort((a, b) => a - b);
  if (blockLines.length === 0) return null;
  // blockLines[0] is always the heading line itself (see
  // findHeadingBlockLines: the heading index is the first one `inside` ever
  // gains for a given active block) — drop it so the result is prose only.
  const proseLines = blockLines.slice(1).map((index) => lines[index]);
  const prose = proseLines.join("\n").trim();
  return prose.length > 0 ? prose : null;
}

// ---------------------------------------------------------------------------
// Runtime bundle validation — jsonb is `unknown`; re-validate before trusting.
// ---------------------------------------------------------------------------

/**
 * Minimal, real structural check that `raw` (a `catalog_releases.bundle`
 * jsonb value) is actually a `ReleaseBundle` before anything here trusts it:
 * `schemaVersion`/`lessonCount`/`lessons` are present with the right shapes,
 * and every lesson's `frontmatter` re-parses against the real
 * `LessonFrontmatterSchema` (`scripts/content/schema.ts`, read-only here) —
 * not a hand-rolled duplicate of that schema — and `body` is a string.
 * Returns `null` (never throws) on anything malformed: a corrupted or
 * future-incompatible `bundle` value must make this reader report "no
 * curated lesson found", not crash the workspace page.
 */
export function parseReleaseBundle(raw: unknown): ReleaseBundle | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== 1) return null;
  if (typeof value.lessonCount !== "number") return null;
  if (typeof value.lessons !== "object" || value.lessons === null || Array.isArray(value.lessons)) return null;

  const lessonEntries = Object.entries(value.lessons as Record<string, unknown>);
  const lessons: ReleaseBundle["lessons"] = {};
  for (const [slug, lessonRaw] of lessonEntries) {
    if (typeof lessonRaw !== "object" || lessonRaw === null) return null;
    const lesson = lessonRaw as Record<string, unknown>;
    if (typeof lesson.body !== "string") return null;
    const parsedFrontmatter = LessonFrontmatterSchema.safeParse(lesson.frontmatter);
    if (!parsedFrontmatter.success) return null;
    lessons[slug] = { frontmatter: parsedFrontmatter.data, body: lesson.body };
  }

  return { schemaVersion: 1, lessonCount: value.lessonCount, lessons };
}

// ---------------------------------------------------------------------------
// Range containment + lesson selection — pure.
// ---------------------------------------------------------------------------

/** What the reader hands back to `ContextSection`/`TheologySection`/
 * `ApplySection`/`TeachSection` — only what they actually render, never the
 * full lesson record.
 *
 * LESSONSHAPE-001 adds three fields via the same `extractHeadingProse`
 * technique as `contextProse`/`positionsProse` above — no new parsing logic,
 * just three more heading names. `literaryDesignProse`/`practiceBridgeProse`
 * are optional content (BUILD_PLAN.md §5.1 names only a teach-back prompt
 * set in its required-CI-rules bullet; literary design notes aren't named
 * there at all, and worked Practice Bridge examples are explicitly "not
 * required in every lesson"), so both are `null` for the ordinary case of a
 * lesson that doesn't carry one — exactly like `contextProse`/
 * `positionsProse`. `teachBackPromptsProse` IS required at publish time by
 * `scripts/content/validate.ts`'s new rule, but is typed nullable here too:
 * a malformed or legacy bundle (e.g. a release published before that rule
 * existed) must never crash this reader — the same "fail closed, never
 * assume" discipline this module's header already states for
 * `parseReleaseBundle`. */
export interface PublishedLessonMatch {
  slug: string;
  frontmatter: LessonFrontmatter;
  /** Prose under `## Context`, or `null` if this lesson has none. */
  contextProse: string | null;
  /** Prose under `## Positions`, or `null` if this lesson has none. */
  positionsProse: string | null;
  /** Prose under `## Literary Design`, or `null` if this lesson has none (optional content — see this interface's own header comment). */
  literaryDesignProse: string | null;
  /** Prose under `## Practice Bridge Example`, or `null` if this lesson has none (optional content — see this interface's own header comment). */
  practiceBridgeProse: string | null;
  /** Prose under `## Teach-Back Prompts`, or `null` if this lesson has none — required at publish time (see this interface's own header comment), but still nullable here for fail-closed safety. */
  teachBackPromptsProse: string | null;
}

/**
 * Finds the one lesson in `bundle` whose own `passage` range COVERS
 * `sessionRange` (every verse of `sessionRange` falls inside the lesson's
 * `passage`, inclusive) via `lib/bible/range.ts`'s real, already-tested
 * `rangeContainsRange` — reused, not reimplemented, per this task's own
 * acceptance criteria. `lib/bible/range.ts` is a readOnlyPath here, and it
 * already provides exactly the "does range A contain range B" check this
 * needed, so no new containment helper was written.
 *
 * Iterates lessons in slug-sorted order (a jsonb round-trip through Postgres
 * gives no ordering guarantee over object keys) and returns the FIRST match —
 * a deliberate, documented tie-break for the (expected to be rare) case of
 * two published lessons whose passages both cover the same session range,
 * not an attempt to rank or merge them.
 */
export function findLessonMatchingRange(
  bundle: ReleaseBundle,
  sessionRange: CanonicalRangeV1,
): PublishedLessonMatch | null {
  const slugs = Object.keys(bundle.lessons).sort();
  for (const slug of slugs) {
    const lesson = bundle.lessons[slug];
    if (!rangeContainsRange(lesson.frontmatter.passage, sessionRange)) continue;
    return {
      slug,
      frontmatter: lesson.frontmatter,
      contextProse: extractHeadingProse(lesson.body, "Context"),
      positionsProse: extractHeadingProse(lesson.body, "Positions"),
      literaryDesignProse: extractHeadingProse(lesson.body, "Literary Design"),
      practiceBridgeProse: extractHeadingProse(lesson.body, "Practice Bridge Example"),
      teachBackPromptsProse: extractHeadingProse(lesson.body, "Teach-Back Prompts"),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Real IO — the one function in this file that touches Postgres.
// ---------------------------------------------------------------------------

/**
 * Finds the most recent `catalog_releases` row (`ORDER BY released_at DESC
 * LIMIT 1`), parses its `bundle`, and returns the one lesson (if any) inside
 * it whose passage covers `sessionRange`. Returns `null` — never throws —
 * when there is no release yet, the latest release's bundle fails
 * {@link parseReleaseBundle}'s real structural check, or no lesson in it
 * covers `sessionRange`; the caller (`app/(app)/study/[sessionId]/page.tsx`)
 * additionally wraps this call in its own try/catch so a real database error
 * ALSO fails closed to "no curated lesson" rather than breaking the page —
 * this function itself only promises not to throw on malformed-but-reachable
 * data, not on a dead connection.
 */
export async function findPublishedLessonForRange(
  db: Database,
  sessionRange: CanonicalRangeV1,
): Promise<PublishedLessonMatch | null> {
  const [latestRelease] = await db
    .select({ bundle: catalogReleases.bundle })
    .from(catalogReleases)
    .orderBy(desc(catalogReleases.releasedAt))
    .limit(1);
  if (!latestRelease) return null;

  const bundle = parseReleaseBundle(latestRelease.bundle);
  if (!bundle) return null;

  return findLessonMatchingRange(bundle, sessionRange);
}
