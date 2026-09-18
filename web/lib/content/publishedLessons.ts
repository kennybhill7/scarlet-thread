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
 * acceptance criteria): everything ABOVE the "Real IO" section marker below
 * is pure — no DB, no filesystem — and is exercised directly by
 * `tests/published-lessons.test.ts` with small injected fixtures.
 * `findPublishedLessonForRange` and (as of CONNECTIONCURATION-001)
 * `resolveCuratedConnections` are the only two functions in this file that
 * touch the database — both live together in that one marked section, both
 * take their `Database` connection as an explicit parameter, and both are
 * exercised in tests against a small in-memory fake `Database`, never a real
 * connection.
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
 * CONNECTIONCURATION-001 adds `curatedConnections` to `PublishedLessonMatch`:
 * a lesson's frontmatter `connectionIds[]` (`scripts/content/schema.ts` —
 * validated there only as well-formed ID-shaped strings, per that file's own
 * SCOPE NOTE, never that they resolve to a real row) resolved against the
 * real curated `graph_edges` table (`db/schema.ts`, GRAPHEDGES-001), joined
 * to each edge's `sources` row for citation. That resolution is a second
 * real database query, so it CANNOT live in `findLessonMatchingRange` (pure,
 * no DB, exercised by fixtures) without blurring this file's own
 * logic-vs-IO split. Instead `findLessonMatchingRange` keeps returning
 * `curatedConnections: []` unconditionally (its honest, pure default — it
 * has no database to ask), and the new `resolveCuratedConnections` —
 * co-located with `findPublishedLessonForRange` in the "Real IO" section
 * below, the only other function in this file that touches Postgres —
 * fills in the real rows. `findPublishedLessonForRange` calls both in
 * sequence and merges the result, so every CALLER-visible `PublishedLessonMatch`
 * still carries real `curatedConnections`; only the pure fixture tests in
 * `tests/published-lessons.test.ts` that call `findLessonMatchingRange`
 * directly see the `[]` placeholder, by construction.
 *
 * Author: Kenneth Hill
 */

import { desc, eq, inArray } from "drizzle-orm";

import { catalogReleases, graphEdges, sources } from "@/db/schema";
import type { Database } from "@/lib/db";
import { rangeContainsRange } from "@/lib/bible/range";
import type { CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import type { ConnectionType, EvidenceLabel } from "@/lib/contracts/study-v2";
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

/**
 * One curated `graph_edges` row resolved for a lesson's `connectionIds[]`,
 * shaped for `ConnectSection` to render — a real, typed, evidence-labeled
 * connection, not a raw `GraphEdgeRecordV1` (`lib/contracts/graph-v1.ts`):
 * `sourceId` is replaced with the actual joined citation fields the UI
 * needs, and `communityVotes`/`createdAt` are dropped as noise this reader's
 * one caller never renders. `source` is `null` — never a thrown error — when
 * the edge's `sourceId` somehow does not resolve to a real `sources` row
 * (should not happen given the real FK, but this reader never assumes a
 * foreign key holds; see `resolveCuratedConnections` below).
 */
export interface CuratedConnection {
  id: string;
  type: ConnectionType;
  evidenceLabel: EvidenceLabel;
  fromRange: CanonicalRangeV1;
  toRange: CanonicalRangeV1;
  source: { author: string; title: string; publisher: string; url: string; licence: string } | null;
}

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
  /**
   * CONNECTIONCURATION-001 — real `graph_edges` rows resolved from this
   * lesson's `frontmatter.connectionIds[]`. Empty array — never `null` —
   * both when the lesson has no `connectionIds` at all (matches
   * `frontmatter.connectionIds`'s own `.default([])`, `scripts/content/schema.ts`)
   * and when every id failed to resolve to a real row. `findLessonMatchingRange`
   * itself always returns `[]` here (it is pure — no DB); only
   * `findPublishedLessonForRange`, via `resolveCuratedConnections`, ever
   * populates real rows — see this file's header comment.
   */
  curatedConnections: CuratedConnection[];
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
      // Pure default — this function has no DB to ask. See this file's
      // header comment ("CONNECTIONCURATION-001") and `resolveCuratedConnections`
      // below: only `findPublishedLessonForRange` ever replaces this with
      // real rows.
      curatedConnections: [],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Real IO — the functions in this file that touch Postgres:
// `findPublishedLessonForRange` (unchanged in shape since RELEASEREADER-001)
// and `resolveCuratedConnections` (CONNECTIONCURATION-001, new).
// ---------------------------------------------------------------------------

/**
 * Resolves `connectionIds` (a lesson's `frontmatter.connectionIds[]`)
 * against the real curated `graph_edges` table, left-joined to `sources` for
 * citation — the same two tables `lib/db/graphEdges.ts` already queries
 * together (read as precedent before writing this), reusing its `Database`
 * -parameter dependency-injection shape rather than importing the app's `db`
 * singleton directly.
 *
 * `graph_edges.id IN (...)` (`inArray`) is one query for every id in
 * `connectionIds`, not one query per id — the same bulk-lookup shape
 * `findMissingSourceIds` (`lib/db/graphEdges.ts`) already uses for exactly
 * this reason. Returns `[]` immediately, without issuing a query at all,
 * when `connectionIds` is empty (the ordinary case for a lesson with no
 * `connectionIds` at all).
 *
 * FAIL CLOSED, NEVER THROW on an unresolved id: `schema.ts`'s own SCOPE NOTE
 * states `connectionIds[]` is validated only as well-formed ID-shaped
 * strings, "never that they resolve to a real row" — so an id with no
 * matching `graph_edges` row is a real, expected possibility (a typo, a
 * lesson written against a connection not yet imported, a since-corrected
 * id), not a data-integrity bug this reader should crash the page over. Such
 * an id is silently skipped from the returned array — mirroring
 * `parseReleaseBundle`'s own "fail closed, never assume" discipline
 * elsewhere in this file — with a `console.warn` (cheap, server-side only,
 * never thrown or surfaced to the page) recording the gap for whoever is
 * watching server logs. The RESULT array preserves `connectionIds`' own
 * order (skipping the unresolved ones in place) rather than whatever order
 * Postgres happens to return rows in.
 *
 * `source` is `null` on an individual connection only in the practically
 * unreachable case that a resolved edge's `sourceId` foreign key does not
 * resolve to a real `sources` row — this function never trusts that FK
 * blindly (a `LEFT JOIN`, not an `INNER JOIN`), so a dangling reference
 * degrades that one connection's citation to `null` rather than dropping the
 * connection or throwing.
 */
export async function resolveCuratedConnections(
  db: Database,
  connectionIds: readonly string[],
): Promise<CuratedConnection[]> {
  if (connectionIds.length === 0) return [];

  const uniqueIds = [...new Set(connectionIds)];
  const rows = await db
    .select({
      id: graphEdges.id,
      type: graphEdges.type,
      evidenceLabel: graphEdges.evidenceLabel,
      fromRange: graphEdges.fromRange,
      toRange: graphEdges.toRange,
      sourceId: sources.id,
      sourceAuthor: sources.author,
      sourceTitle: sources.title,
      sourcePublisher: sources.publisher,
      sourceUrl: sources.url,
      sourceLicence: sources.licence,
    })
    .from(graphEdges)
    .leftJoin(sources, eq(graphEdges.sourceId, sources.id))
    .where(inArray(graphEdges.id, uniqueIds));

  const rowsById = new Map(rows.map((row) => [row.id, row]));

  const resolved: CuratedConnection[] = [];
  for (const id of connectionIds) {
    const row = rowsById.get(id);
    if (!row) {
      console.warn(`publishedLessons.resolveCuratedConnections: connectionIds[] entry "${id}" has no matching graph_edges row -- skipped`);
      continue;
    }
    resolved.push({
      id: row.id,
      type: row.type as ConnectionType,
      evidenceLabel: row.evidenceLabel as EvidenceLabel,
      fromRange: row.fromRange,
      toRange: row.toRange,
      source:
        row.sourceId !== null
          ? {
              author: row.sourceAuthor!,
              title: row.sourceTitle!,
              publisher: row.sourcePublisher!,
              url: row.sourceUrl!,
              licence: row.sourceLicence!,
            }
          : null,
    });
  }
  return resolved;
}

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
 *
 * CONNECTIONCURATION-001: once a match is found, its `curatedConnections`
 * (`[]` from {@link findLessonMatchingRange} itself, which is pure) is
 * replaced with the real rows {@link resolveCuratedConnections} resolves for
 * the matched lesson's own `frontmatter.connectionIds[]` — a second real
 * query, issued only when a lesson actually matched (never speculatively for
 * every release row). A lesson with an empty `connectionIds[]` still costs
 * nothing extra: {@link resolveCuratedConnections} returns `[]` without
 * querying at all in that case.
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

  const match = findLessonMatchingRange(bundle, sessionRange);
  if (!match) return null;

  const curatedConnections = await resolveCuratedConnections(db, match.frontmatter.connectionIds);
  return { ...match, curatedConnections };
}
