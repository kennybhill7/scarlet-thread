#!/usr/bin/env -S npx tsx
/**
 * SYNCSTAGES-001 — syncs `content/lens/eleven-stages.json` (the 11 Mountain
 * stages; MOUNTAINWHY-001 moved them into the tracked content pipeline) into
 * the real curated `stages` Postgres table. The stage-side sibling of
 * `scripts/sync-source-registry.mts` (SOURCESYNC-001),
 * `scripts/sync-connections.mts` (CURATEDEDGES-002) and
 * `scripts/sync-places.mts` (PLACES-001), built the same way.
 *
 * WHY THIS EXISTS: until now the only writer of `stages` was `db/seed.ts`
 * (`npm run db:seed`), which is a ONE-TIME journal import: it refuses outright
 * ("Seed target already contains journal data...") on any account that has a
 * single entry, thread or person. So on the real database, edited stage titles
 * or summaries could never reach the Mountain/Mirror screens. This script
 * writes ONLY the `stages` table -- never threads, people, entries,
 * entry_threads or users -- so it needs no journal-data guard.
 *
 * DATA PROVENANCE: `content/lens/eleven-stages.json` is this app's own
 * hand-authored lens over the canon (see `content/lens/why-this-shape.json`).
 * This script never invents or infers any of it: it validates the file with
 * the SAME rules `db:seed` applies (`lib/content/stageSeed.ts`'s
 * `validateStageSeed`, shared with `db/seed.ts`: the zod row schema, exactly
 * 11 stages, unique slugs, unique stage numbers within 1-11, valid chapter
 * refs, every mirror pointing at a real stage that mirrors it back) and copies
 * the rows into Postgres exactly as written. It refuses to write anything if
 * ANY row is invalid -- never a partial sync.
 *
 * ORDER: `stages` has no foreign keys (slug is the primary key; `mirror` is
 * plain text), so this does not depend on any other sync. The runbook runs it
 * right after `npm run db:sync-sources`.
 *
 * MIGRATION: none. The `stages` table has existed since the first migration.
 *
 * IDEMPOTENT: keyed on `stages.slug` with `onConflictDoUpdate`, setting the
 * same columns `db:seed` always set (title, stage, side, mirror, chapters,
 * summary); all 11 upserts go in ONE `db.batch` (a single transaction on the
 * Neon HTTP driver), so either every row lands or none does. An unchanged
 * file re-syncs to identical rows. Stages removed from the file are NOT
 * deleted: removal is a deliberate, reviewed act, not a side effect of a sync.
 * (Note: `stages.stage` has a unique index, so renumbering two existing stages
 * by swapping their numbers fails the whole batch rather than half-applying.)
 * See `lib/db/stages.ts`'s `upsertStageRows`.
 *
 * HUMAN GATE (matching `scripts/sync-source-registry.mts` /
 * `scripts/sync-connections.mts` / `scripts/sync-places.mts`): this script is
 * NOT run against any real `DATABASE_URL` as part of building it -- that is
 * Ken's own decision to trigger, or a follow-up task with real output pasted.
 * This repo has exactly one Postgres instance (production; see
 * `.env.production.local`) -- there is no separate dev/test database to
 * rehearse against, so a live run here would write directly to production
 * data.
 *
 * Run via (from `web/`, like every npm script -- the file path resolves
 * relative to the working directory, exactly as `db:seed` resolves it):
 *
 *   npm run db:sync-stages
 *
 * (requires `DATABASE_URL` in the environment or `web/.env.local`, the same
 * convention `db:seed` / `db:sync-sources` already use).
 *
 * Author: Kenneth Hill
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "@/db/schema";
import { STAGE_SEED_PATH, validateStageSeed } from "@/lib/content/stageSeed";
import { upsertStageRows } from "@/lib/db/stages";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required (set it in the environment or web/.env.local)");
  }

  console.log(`Reading ${path.relative(process.cwd(), STAGE_SEED_PATH)} ...`);
  const raw = JSON.parse(await readFile(STAGE_SEED_PATH, "utf8")) as unknown;
  const loaded = validateStageSeed(raw);
  if (!loaded.ok) {
    console.error(`db:sync-stages refused -- ${loaded.errors.length} problem(s), nothing written:`);
    for (const error of loaded.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  const [first, ...rest] = loaded.stages;
  if (!first) {
    // Unreachable: validateStageSeed requires exactly 11 stages.
    throw new Error("db:sync-stages refused: validation passed an empty stage list");
  }
  console.log(`Found ${loaded.stages.length} stages.`);

  const db = drizzle(process.env.DATABASE_URL, { schema });
  await upsertStageRows(db, [first, ...rest]);

  console.log("");
  console.log(
    `Synced ${loaded.stages.length} stages into "stages", keyed on slug -- a corrected title/summary ` +
      "updates its row in place; an unchanged file is a no-op. Stages removed from the file are not deleted.",
  );
}

main().catch((error: unknown) => {
  console.error("[fatal] Unhandled error in sync-stages:", error);
  process.exitCode = 1;
});
