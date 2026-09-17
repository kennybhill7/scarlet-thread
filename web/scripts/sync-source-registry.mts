#!/usr/bin/env -S npx tsx
/**
 * SOURCESYNC-001 — syncs `content/source-registry.json` (the authoring-side
 * bibliography JSON `scripts/content/build.ts`'s `missingSourceIds` checks
 * lesson `sources[]` IDs against; see `content/README.md`'s "Source
 * registry" section) into the real curated `sources` Postgres table
 * (`db/schema.ts`, built by GRAPHEDGES-001) those entries are meant to
 * become rows in.
 *
 * DATA PROVENANCE: `content/source-registry.json` is hand-authored bibliographic
 * metadata (author, title, publisher, url, licence, accessedAt) -- one entry
 * per source a lesson's frontmatter `sources[]` cites. This script never
 * fetches or invents that data itself; it only copies the JSON file's
 * entries into Postgres, exactly as written. Whoever edits the JSON file
 * (Ken, or another agent authoring a lesson) is the actual source of the
 * bibliographic content; this script is transport, not authorship.
 *
 * WHY THIS SYNCS KEYED ON `sources.id`, NOT `sources.url` (unlike this
 * repo's other `sources`-writing function, `lib/db/graphEdges.ts`'s
 * `upsertOpenBibleSource`): that function's one row uses an arbitrary
 * `crypto.randomUUID()` id and conflicts on `url`, because OpenBible.info's
 * dataset has no natural stable id of its own. `content/source-registry.json`
 * is the opposite -- its ids (e.g. `"source-westminster-confession"`) are
 * deliberately stable, human-authored strings that ARE meant to be the real
 * `sources.id` primary keys, referenced verbatim by lessons' frontmatter
 * `sources[]` fields. See `lib/db/graphEdges.ts`'s `upsertSourceRegistryRows`
 * doc comment for the full reasoning.
 *
 * IDEMPOTENT: re-running this with an unchanged `source-registry.json` is a
 * no-op past the first run (every row already matches). Re-running after
 * editing an existing entry (correcting a URL, fixing an author name, etc.
 * -- this already happened once this week, per SOURCESYNC-001's own task
 * description) updates that row in place, rather than erroring or
 * duplicating -- `upsertSourceRegistryRows` uses
 * `.onConflictDoUpdate({ target: sources.id, ... })`, never
 * `onConflictDoNothing`.
 *
 * HUMAN GATE (matching `scripts/import-cross-references.mts`'s own framing,
 * verbatim in spirit): this script is NOT run against any real
 * `DATABASE_URL` as part of building it -- that is Ken's own decision to
 * trigger, or a follow-up task with real output pasted. This repo has
 * exactly one Postgres instance (production; see `.env.production.local`) --
 * there is no separate dev/test database to rehearse against, so a live run
 * here would write directly to production data.
 *
 * Run via:
 *
 *   npm run db:sync-sources
 *
 * (requires `DATABASE_URL` in the environment or `web/.env.local`, the same
 * convention `db:seed` / `db:import-graph-edges` already use).
 *
 * Author: Kenneth Hill
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "@/db/schema";
import { upsertSourceRegistryRows, type SourceRow } from "@/lib/db/graphEdges";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// web/scripts -> web -> repo root -> content/source-registry.json.
const REGISTRY_FILE = path.join(SCRIPT_DIR, "..", "..", "content", "source-registry.json");

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required (set it in the environment or web/.env.local)");
  }
  const db = drizzle(process.env.DATABASE_URL, { schema });

  console.log(`Reading ${path.relative(process.cwd(), REGISTRY_FILE)} ...`);
  const raw = await readFile(REGISTRY_FILE, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${REGISTRY_FILE} must contain a JSON array of source-registry entries`);
  }
  const entries = parsed as SourceRow[];
  console.log(`Found ${entries.length} registry entr${entries.length === 1 ? "y" : "ies"}.`);

  await upsertSourceRegistryRows(db, entries);

  console.log("");
  console.log(
    `Synced ${entries.length} source row(s) into "sources", keyed on id -- ` +
      "a corrected entry updates its existing row in place; an unchanged one is a no-op.",
  );
}

main().catch((error: unknown) => {
  console.error("[fatal] Unhandled error in sync-source-registry:", error);
  process.exitCode = 1;
});
