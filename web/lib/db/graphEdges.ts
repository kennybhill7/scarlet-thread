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

import { eq } from "drizzle-orm";

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

export type GraphEdgeInsert = Omit<GraphEdgeRecordV1, "id" | "createdAt">;

/** Postgres binds one parameter per column per row; 500 rows * 7 columns = 3,500 params, comfortably under the 65,535-per-statement limit even before accounting for `id`/`createdAt` defaults. */
const DEFAULT_CHUNK_SIZE = 500;

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
