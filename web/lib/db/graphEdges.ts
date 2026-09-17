/**
 * GRAPHEDGES-001 — repository layer for the curated `sources` and
 * `graph_edges` tables (`db/schema.ts`, BUILD_PLAN.md §3.3).
 *
 * Deliberately does NOT import "server-only" or the app's `db` singleton
 * (`@/lib/db`), unlike every other `lib/db/*.ts` file in this repo: those
 * are all called only from Next.js server code. This module is called from
 * a standalone CLI script (`scripts/import-cross-references.mts`, run via
 * `tsx`, never bundled into the Next.js app) as well as, potentially, a
 * future server route reading curated edges — so every function here takes
 * its `Database` connection as an explicit parameter instead, the same
 * dependency-injection shape `scripts/lib/releaseMigrate.ts` already uses
 * for exactly this reason.
 */

import { desc, eq, gte, inArray, sql } from "drizzle-orm";

import { graphEdges, sources } from "@/db/schema";
import type { Database } from "@/lib/db";
import type { GraphEdgeRecordV1, GraphEdgeSourceV1 } from "@/lib/contracts/graph-v1";

/**
 * The one source row GRAPHEDGES-001 seeds — a real CC BY 4.0 attribution
 * requirement, not decoration. Names both OpenBible.info (the dataset
 * publisher) and the Treasury of Scripture Knowledge (the primary
 * underlying public-domain source, per openbible.info/labs/cross-references
 * own stated provenance).
 */
export const OPENBIBLE_SOURCE_SEED: Omit<GraphEdgeSourceV1, "id" | "accessedAt"> = {
  author: "OpenBible.info, compiling the Treasury of Scripture Knowledge (public domain) plus community voting",
  title: "OpenBible.info Cross Reference Dataset",
  publisher: "OpenBible.info",
  url: "https://www.openbible.info/labs/cross-references/",
  licence: "CC BY 4.0",
};

/**
 * Idempotent: inserts `OPENBIBLE_SOURCE_SEED` if no `sources` row with that
 * `url` exists yet (per the real `sources_url_idx` unique index), otherwise
 * returns the existing row's id. Safe to call every time the import script
 * runs — never produces a second source row for the same dataset.
 */
export async function upsertOpenBibleSource(db: Database, accessedAt: string): Promise<string> {
  const candidateId = crypto.randomUUID();
  const inserted = await db
    .insert(sources)
    .values({ id: candidateId, ...OPENBIBLE_SOURCE_SEED, accessedAt })
    .onConflictDoNothing({ target: sources.url })
    .returning({ id: sources.id });
  if (inserted[0]) return inserted[0].id;

  const [existing] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.url, OPENBIBLE_SOURCE_SEED.url))
    .limit(1);
  if (!existing) {
    // Unreachable in practice (the insert only no-ops on a real conflict on
    // this exact url), but fails loudly rather than silently returning an
    // id that does not exist if it ever somehow happened.
    throw new Error(`sources row for "${OPENBIBLE_SOURCE_SEED.url}" was neither inserted nor found`);
  }
  return existing.id;
}

/** Postgres binds one parameter per column per row; 500 rows * 7 columns = 3,500 params, comfortably under the 65,535-per-statement limit even before accounting for `id`/`createdAt` defaults. Shared by every chunked bulk-write function in this file. */
const DEFAULT_CHUNK_SIZE = 500;

// ---------------------------------------------------------------------------
// SOURCESYNC-001 — syncs `content/source-registry.json` (the authoring-side
// bibliography gate `scripts/content/build.ts`'s `missingSourceIds` checks
// against) into the real curated `sources` table those JSON entries are
// meant to become rows in. `content/README.md`'s "Source registry" section
// names this as the second, release-side half of a two-tier design: "the
// JSON file alone is not evidence that those database rows exist."
// ---------------------------------------------------------------------------

/** The shape one `content/source-registry.json` entry must have to become a
 * `sources` row — structurally identical to `scripts/content/build.ts`'s own
 * `SourceRegistryEntry` interface (both are, deliberately, the real
 * `sources` table's insert shape), derived directly from the schema instead
 * of retyped by hand so the two can never silently drift. */
export type SourceRow = typeof sources.$inferInsert;

/**
 * Upserts every `content/source-registry.json` entry into `sources`, keyed
 * on `sources.id` — deliberately NOT the same pattern
 * {@link upsertOpenBibleSource} above uses. That function conflicts on
 * `sources.url` and mints a fresh `crypto.randomUUID()` `id` on every call,
 * which is correct for OpenBible's one bulk-imported row (an arbitrary id,
 * no stable natural key of its own). It is wrong here:
 * `content/source-registry.json`'s ids (e.g.
 * `"source-westminster-confession"`) are deliberately stable, human-authored
 * strings that ARE meant to be the real `sources.id` primary keys — lessons'
 * frontmatter `sources[]` fields reference these exact strings
 * (`content/README.md` "Source registry").
 *
 * `.onConflictDoUpdate({ target: sources.id, ... })` — not
 * `onConflictDoNothing` — gives real update-on-conflict semantics:
 * idempotent to re-run with unchanged input, and a registry entry corrected
 * after its first sync (this already happened once this week, per
 * SOURCESYNC-001's own task description) is picked up on the next sync
 * rather than silently ignored. `sql`excluded....`` (not the JS-side
 * `entry.field` values) is used in `set` so a single batched multi-row
 * `INSERT ... ON CONFLICT` applies each conflicting row's OWN incoming
 * values, not the first/last row's values pasted onto every conflict — the
 * standard Postgres bulk-upsert idiom, same chunking discipline as
 * {@link insertGraphEdgesBatch} below.
 */
export async function upsertSourceRegistryRows(
  db: Database,
  entries: readonly SourceRow[],
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): Promise<void> {
  for (let start = 0; start < entries.length; start += chunkSize) {
    const chunk = entries.slice(start, start + chunkSize);
    if (chunk.length === 0) continue;
    await db
      .insert(sources)
      .values(chunk)
      .onConflictDoUpdate({
        target: sources.id,
        set: {
          author: sql`excluded.author`,
          title: sql`excluded.title`,
          publisher: sql`excluded.publisher`,
          url: sql`excluded.url`,
          licence: sql`excluded.licence`,
          accessedAt: sql`excluded.accessed_at`,
        },
      });
  }
}

/**
 * Pure: which of `required` are absent from `existing`. Deduped and sorted,
 * matching `scripts/content/build.ts`'s own `missingSourceIds` output shape.
 * Factored out from {@link findMissingSourceIds} below so the actual
 * set-diff logic is unit-testable with plain fixtures — no database
 * connection needed to prove this part correct.
 */
export function diffAbsentIds(required: readonly string[], existing: readonly string[]): string[] {
  const found = new Set(existing);
  return [...new Set(required)].filter((id) => !found.has(id)).sort();
}

/**
 * The real-Postgres analogue of `scripts/content/build.ts`'s own
 * `missingSourceIds`, which only checks `content/source-registry.json` —
 * this checks the real database instead. Returns which of `ids` have NO
 * matching row in `sources` right now. `content/README.md`'s own words:
 * "a later release migration must also upsert or verify the same IDs in the
 * curated Postgres `sources` table before publishing a catalog row; the JSON
 * file alone is not evidence that those database rows exist" — this
 * function, wired into `content:build`'s `main()`, is that release-side
 * gate made real.
 */
export async function findMissingSourceIds(db: Database, ids: readonly string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await db.select({ id: sources.id }).from(sources).where(inArray(sources.id, unique));
  return diffAbsentIds(unique, rows.map((row) => row.id));
}

export type GraphEdgeInsert = Omit<GraphEdgeRecordV1, "id" | "createdAt">;

/**
 * Bulk-inserts `graph_edges` rows in chunks, skipping any row that already
 * exists per the real unique index on `(from_range, to_range, type)` — so
 * re-running the import is idempotent (an ever-growing duplicate set is
 * exactly what this index and this chunked `onConflictDoNothing` prevent).
 * Returns how many rows were actually inserted (as opposed to skipped as
 * pre-existing duplicates) across all chunks.
 */
export async function insertGraphEdgesBatch(
  db: Database,
  edges: readonly GraphEdgeInsert[],
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): Promise<number> {
  let insertedCount = 0;
  for (let start = 0; start < edges.length; start += chunkSize) {
    const chunk = edges.slice(start, start + chunkSize);
    const inserted = await db
      .insert(graphEdges)
      .values(chunk.map((edge) => ({ id: crypto.randomUUID(), ...edge })))
      .onConflictDoNothing({ target: [graphEdges.fromRange, graphEdges.toRange, graphEdges.type] })
      .returning({ id: graphEdges.id });
    insertedCount += inserted.length;
  }
  return insertedCount;
}

// ---------------------------------------------------------------------------
// STORYMAP-001 — read queries for the Story Map (app/(app)/map/page.tsx).
// 341,223 rows must never ship to the client as one blob (the registered
// task's own acceptance criterion), so the app only ever asks this file for
// one of exactly two real, server-filtered shapes below — no "give me
// everything" query exists anywhere in this module.
// ---------------------------------------------------------------------------

/** What both query functions below return — the exact fields
 * `lib/map/storyMapLayout.ts`'s pure `buildArcsForEdges` needs, nothing more
 * (never `sourceId`/`createdAt`, which the diagram never uses). */
export type GraphEdgeRow = Pick<
  GraphEdgeRecordV1,
  "id" | "fromRange" | "toRange" | "type" | "evidenceLabel" | "communityVotes"
>;

const GRAPH_EDGE_ROW_COLUMNS = {
  id: graphEdges.id,
  fromRange: graphEdges.fromRange,
  toRange: graphEdges.toRange,
  type: graphEdges.type,
  evidenceLabel: graphEdges.evidenceLabel,
  communityVotes: graphEdges.communityVotes,
} as const;

/**
 * The Story Map OVERVIEW's one query: only the highest-confidence edges,
 * ordered by real `communityVotes` descending, with a real `LIMIT` —
 * `options.minVotes`/`options.limit` are chosen by the page from real
 * measured render-performance numbers (see that page's own header), never
 * guessed here. This function itself imposes no default of its own — an
 * empty/zero `limit` is the caller's own decision to make, not silently
 * substituted.
 */
export async function listTopGraphEdges(
  db: Database,
  options: { minVotes: number; limit: number },
): Promise<GraphEdgeRow[]> {
  return db
    .select(GRAPH_EDGE_ROW_COLUMNS)
    .from(graphEdges)
    .where(gte(graphEdges.communityVotes, options.minVotes))
    .orderBy(desc(graphEdges.communityVotes))
    .limit(options.limit);
}

/**
 * The Story Map CHAPTER-FOCUS query: every real edge ANCHORED at one chapter
 * — i.e. `fromRange.start` falls inside `book.chapter` — not vote-filtered.
 * Every GRAPHEDGES-001-imported row's "From Verse" is always a single verse
 * (`scripts/lib/importCrossReferences.ts`'s `parseDatasetVerseToken`), so this
 * scoping is exhaustive per row, and lines up exactly with the registered
 * task's own ~287-edges/chapter average (341,223 / 1,189 ~= 287.0).
 *
 * Deliberately does NOT also match rows where this chapter is the `toRange`
 * side instead (this chapter's real INBOUND references). Those already
 * surface when the OTHER chapter is the one focused, and folding them in here
 * would make the per-chapter row count wildly uneven — a heavily-cited
 * chapter like Genesis 1 or Isaiah 53 would balloon far past the "small, real,
 * fully-renderable set" the registered task's own acceptance criterion asks
 * for, while most chapters stayed near the ~287 average. A real scope choice,
 * flagged in the build report, not a silent gap.
 *
 * `fromRange->>'start'` is matched with a literal `book.chapter.` LIKE prefix.
 * This is safe against a false partial match (book 1 chapter 1 can never match
 * book 1 chapter 10, or book 12 chapter 1 match book 1 chapter 21) because
 * every RefKey is always exactly "book.chapter.verse" with no leading zeros
 * (`lib/bible/range.ts`'s `parseVerseKeyStrict`), so the literal "." straight
 * after the chapter number in the pattern is a hard boundary a longer
 * chapter/book number can never satisfy by accident.
 *
 * KNOWN PERF GAP, reported not hidden: there is no index on this expression —
 * `graph_edges`'s one real index covers `(from_range, to_range, type)`
 * equality, for import idempotency, not this substring match — and
 * `db/schema.ts` is a readOnlyPath for this task, so no new expression index
 * could be added here even if one were wanted. At 341,223 rows a sequential
 * LIKE scan is a real but acceptable cost for one interactive click; it was
 * not part of this task's own performance-measurement scope (that scope is
 * the OVERVIEW query above, which this function's result set never needs to
 * be trimmed the same way).
 */
export async function listGraphEdgesForChapter(db: Database, book: number, chapter: number): Promise<GraphEdgeRow[]> {
  const prefix = `${book}.${chapter}.%`;
  return db
    .select(GRAPH_EDGE_ROW_COLUMNS)
    .from(graphEdges)
    .where(sql`${graphEdges.fromRange}->>'start' LIKE ${prefix}`)
    .orderBy(desc(graphEdges.communityVotes));
}
