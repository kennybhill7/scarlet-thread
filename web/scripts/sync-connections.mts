#!/usr/bin/env -S npx tsx
/**
 * CURATEDEDGES-002 — syncs `content/connections/*.json` (authored, reviewed
 * connection rows; frozen contract C1, see `content/README.md`'s
 * "Connections" section) into the real curated `graph_edges` Postgres table
 * with `review_status = 'reviewed'`. This is the connection-side sibling of
 * `scripts/sync-source-registry.mts` (SOURCESYNC-001), built the same way.
 *
 * DATA PROVENANCE: `content/connections/*.json` is hand-authored, reviewed
 * theological/literary judgment (which passages connect, as which
 * `ConnectionType`, at which `EvidenceLabel`, and why). This script never
 * invents or infers any of it; it validates each file against
 * `scripts/content/connectionSchema.ts` (the same validation `content:validate`
 * runs: unknown type/label, empty rationale, verdict language, sourceId absent
 * from `content/source-registry.json`, duplicate ids) and copies the rows
 * into Postgres exactly as written. Whoever edits the JSON files is the
 * actual author; this script is transport, not authorship. It refuses to
 * write anything if ANY file is invalid -- never a partial sync.
 *
 * ORDER: run `npm run db:sync-sources` first. `graph_edges.source_id` is a
 * real FK to `sources.id`; this script checks up front that every referenced
 * `sourceId` already has a `sources` row and refuses with a clear message
 * instead of surfacing a raw FK violation.
 *
 * MIGRATION: requires migration 0013 (`graph_edges.rationale` /
 * `viewpoint_id` / `release_id` / `review_status`) to be applied to the
 * target database first; without it the upsert fails on the missing columns.
 *
 * IDEMPOTENT: keyed on `graph_edges.id` with `onConflictDoUpdate` -- an
 * unchanged file re-syncs to a no-op, a corrected rationale/type/label is
 * picked up in place. See `lib/db/graphEdges.ts`'s `upsertConnectionRows`.
 *
 * HUMAN GATE (matching `scripts/sync-source-registry.mts` /
 * `scripts/import-cross-references.mts`): this script is NOT run against any
 * real `DATABASE_URL` as part of building it -- that is Ken's own decision to
 * trigger, or a follow-up task with real output pasted. This repo has
 * exactly one Postgres instance (production; see `.env.production.local`) --
 * there is no separate dev/test database to rehearse against, so a live run
 * here would write directly to production data.
 *
 * Run via:
 *
 *   npm run db:sync-connections
 *
 * (requires `DATABASE_URL` in the environment or `web/.env.local`, the same
 * convention `db:seed` / `db:sync-sources` already use).
 *
 * Author: Kenneth Hill
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "@/db/schema";
import { findMissingSourceIds, upsertConnectionRows } from "@/lib/db/graphEdges";

import { CONNECTIONS_DIR, loadConnections, loadSourceRegistryIds } from "./content/validate";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// web/scripts -> web -> repo root -> content/source-registry.json.
const REGISTRY_FILE = path.join(SCRIPT_DIR, "..", "..", "content", "source-registry.json");

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required (set it in the environment or web/.env.local)");
  }

  console.log(`Reading ${path.relative(process.cwd(), CONNECTIONS_DIR)} ...`);
  const loaded = loadConnections(CONNECTIONS_DIR, loadSourceRegistryIds(REGISTRY_FILE));
  if (!loaded.ok) {
    console.error(`db:sync-connections refused -- ${loaded.errors.length} problem(s), nothing written:`);
    for (const error of loaded.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  const rows = loaded.connections;
  console.log(`Found ${rows.length} connection${rows.length === 1 ? "" : "s"}.`);
  if (rows.length === 0) {
    console.log("Nothing to sync.");
    return;
  }

  const db = drizzle(process.env.DATABASE_URL, { schema });

  const missingSources = await findMissingSourceIds(db, rows.map((row) => row.sourceId));
  if (missingSources.length > 0) {
    throw new Error(
      `db:sync-connections refused: sourceIds have no row in the real Postgres sources table ` +
        `(run "npm run db:sync-sources" first): ${missingSources.join(", ")}`,
    );
  }

  await upsertConnectionRows(db, rows);

  console.log("");
  console.log(
    `Synced ${rows.length} connection row(s) into "graph_edges" as review_status='reviewed', keyed on id -- ` +
      "a corrected file updates its existing row in place; an unchanged one is a no-op.",
  );
}

main().catch((error: unknown) => {
  console.error("[fatal] Unhandled error in sync-connections:", error);
  process.exitCode = 1;
});
