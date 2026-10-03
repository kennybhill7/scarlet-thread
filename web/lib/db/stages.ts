/**
 * SYNCSTAGES-001 — repository layer for the curated `stages` table (the 11
 * Mountain stages). Called from `db/seed.ts` and `scripts/sync-stages.mts`
 * (standalone CLIs, via `tsx`), so — like `lib/db/places.ts` /
 * `lib/db/graphEdges.ts` — it does NOT import "server-only" or the app's `db`
 * singleton: every function takes its `Database` as an explicit parameter.
 *
 * Rows must already have passed `lib/content/stageSeed.ts`'s
 * `validateStageSeed`. This module is transport, not authorship: it writes
 * exactly what it is handed.
 */

import { stages } from "@/db/schema";
import type { Database } from "@/lib/db";
import { stageInsertValues, stageUpsertSet, type SeedStage } from "@/lib/content/stageSeed";

/** One statement of a `db.batch` call. */
type BatchStatement = Parameters<Database["batch"]>[0][number];

/**
 * One `INSERT ... ON CONFLICT (slug) DO UPDATE` per stage, in input order —
 * the exact statements `db:seed` has always put at the front of its batch.
 * Typed as a non-empty tuple because `db.batch` requires one.
 */
export function buildStageUpserts(
  db: Database,
  rows: readonly [SeedStage, ...SeedStage[]],
): [BatchStatement, ...BatchStatement[]] {
  const upsert = (stage: SeedStage): BatchStatement =>
    db
      .insert(stages)
      .values(stageInsertValues(stage))
      .onConflictDoUpdate({ target: stages.slug, set: stageUpsertSet(stage) });
  const [first, ...rest] = rows;
  return [upsert(first), ...rest.map(upsert)];
}

/**
 * Upserts every stage keyed on `stages.slug` in ONE `db.batch` (a single
 * transaction on the Neon HTTP driver): either every row is written or none
 * is. Idempotent: an unchanged file re-syncs to identical rows. Stages absent
 * from `rows` are NOT deleted.
 */
export async function upsertStageRows(
  db: Database,
  rows: readonly [SeedStage, ...SeedStage[]],
): Promise<void> {
  await db.batch(buildStageUpserts(db, rows));
}
