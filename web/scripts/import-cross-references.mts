#!/usr/bin/env -S npx tsx
/**
 * GRAPHEDGES-001 — imports OpenBible.info's real, CC BY 4.0 licensed
 * cross-reference dataset into the curated `graph_edges` table
 * (`db/schema.ts`, BUILD_PLAN.md §3.3: "the reviewed canonical graph...
 * Personal overlays stay in `user_connections`; they are never written
 * here").
 *
 * DATA PROVENANCE (real, checked into the repo — not a live fetch):
 *
 *   web/scripts/data/cross-references.txt was produced by:
 *
 *     curl -sL -o web/scripts/data/cross-references.zip \
 *       https://a.openbible.info/data/cross-references.zip
 *     unzip web/scripts/data/cross-references.zip -d web/scripts/data/
 *     mv web/scripts/data/cross_references.txt web/scripts/data/cross-references.txt
 *
 *   ... exactly once, by Claude, on 2026-09-11, and the extracted .txt (not
 *   the .zip) is committed as a real, versioned, reproducible data asset —
 *   matching this repo's "non-destructive, reproducible corpus" discipline
 *   (`tools/build_bible.py`'s own precedent: download once, validate,
 *   commit; never fetch live inside the thing that consumes the data).
 *   This script never hits the network. If the dataset needs refreshing
 *   later, re-run the curl/unzip above and commit the new .txt — a
 *   deliberate, reviewable diff, not a surprise at import time.
 *
 *   Real shape, verified directly against that download on 2026-09-11 by
 *   actually running `buildImportPlan` against it (see
 *   `scripts/lib/importCrossReferences.ts`'s EXPECTED_* constants and
 *   `tests/import-cross-references.test.ts`'s real-file test):
 *   344,756 tab-separated data rows under a
 *   `From Verse\tTo Verse\tVotes\t#www.openbible.info CC-BY <date>` header.
 *   3,514 rows have `Votes <= 0` (skipped — genuinely disputed pairs). 19
 *   rows are real parse failures the registered task did not fully
 *   anticipate: 18 have a "To Verse" range that crosses a book boundary
 *   (e.g. `2Chr.36.22-Ezra.1.3`) — `CanonicalRangeV1` cannot represent a
 *   cross-book range — and 1 (`3John.1.15\tJohn.10.3\t1`) cites a "From
 *   Verse" that does not exist in this app's shipped BSB corpus (3 John has
 *   only 14 verses there; OpenBible's source data follows a versification
 *   tradition that splits 3 John's last verse into two). Both are flagged
 *   loudly by name/line in this script's output, never silently dropped.
 *   Net: 344,756 read, 3,514 skipped (votes), 19 failed (parse/bounds),
 *   341,223 imported.
 *
 * CONTENT-POLICY CHOICES made here, worth a human sanity check later (per
 * the registered task's own human-gate — not treated as unquestionably
 * final): every imported row's `type` defaults to `"parallel"` (the most
 * honest existing `ConnectionType` for "these passages are linked" without
 * claiming a more specific classification this bulk import cannot verify —
 * BUILD_PLAN's tenet 6, "Tests certify software; a pastor certifies
 * theology"); `evidenceLabel` is `"strong"` at >=50 community votes,
 * `"plausible"` at 1-49; `communityVotes` itself is preserved so the app can
 * filter/rank by confidence at query time instead.
 *
 * HUMAN GATE (per the registered task): this script is NOT run against any
 * real `DATABASE_URL` as part of building it — that is Ken's own decision to
 * trigger, or a follow-up task with real output pasted. Running it is safe
 * to re-run any number of times: `upsertOpenBibleSource` is idempotent on
 * `sources.url`, and `insertGraphEdgesBatch` is idempotent on the real
 * unique index `graph_edges_from_to_type_idx` (`from_range`, `to_range`,
 * `type`) — a second run inserts zero new rows.
 *
 * See `scripts/lib/importCrossReferences.ts` for the fully unit-tested pure
 * parsing/mapping logic (book-abbreviation lookup, range parsing,
 * vote-to-evidence-label mapping, the votes<=0 filter) and
 * `tests/import-cross-references.test.ts` for its tests, including one that
 * parses this exact checked-in real file end to end.
 *
 * Run via:
 *
 *   npm run db:import-graph-edges
 *
 * (requires `DATABASE_URL` in the environment or `web/.env.local`, the same
 * convention `db:seed` already uses).
 *
 * Author: Kenneth Hill
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "@/db/schema";
import { buildCanonTable, type CanonTable } from "@/lib/bible/range";
import type { BookMeta } from "@/lib/contracts";
import { insertGraphEdgesBatch, upsertOpenBibleSource, type GraphEdgeInsert } from "@/lib/db/graphEdges";

import {
  buildImportPlan,
  EXPECTED_TOTAL_DATA_ROWS,
  isExpectedHeaderFormat,
  parseCrossReferenceLines,
} from "./lib/importCrossReferences";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(SCRIPT_DIR, "data", "cross-references.txt");
const BIBLE_DIR = path.join(SCRIPT_DIR, "..", "public", "bible");

interface BibleIndexFile {
  books: BookMeta[];
}

interface BookDataFile {
  c: unknown[][];
}

/**
 * Builds a real `CanonTable` from the shipped BSB corpus — chapter counts
 * from `public/bible/index.json`, verse counts from each book's own JSON
 * file — the exact same technique `tests/range-v1.test.ts` already
 * established for building a real (not synthetic) `CanonTable` in tests.
 * Real filesystem IO; deliberately kept out of
 * `scripts/lib/importCrossReferences.ts` so that module stays pure.
 */
async function buildRealCanonTable(): Promise<CanonTable> {
  const indexRaw = await readFile(path.join(BIBLE_DIR, "index.json"), "utf8");
  const index = JSON.parse(indexRaw) as BibleIndexFile;

  const verseCounts = new Map<string, number>();
  await Promise.all(
    index.books.map(async (book) => {
      const raw = await readFile(path.join(BIBLE_DIR, "BSB", `${book.n}.json`), "utf8");
      const data = JSON.parse(raw) as BookDataFile;
      data.c.forEach((verses, i) => verseCounts.set(`${book.n}.${i + 1}`, verses.length));
    }),
  );

  return buildCanonTable(index.books, (book, chapter) => verseCounts.get(`${book}.${chapter}`));
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required (set it in the environment or web/.env.local)");
  }
  const db = drizzle(process.env.DATABASE_URL, { schema });

  console.log(`Reading ${path.relative(process.cwd(), DATA_FILE)} ...`);
  const raw = await readFile(DATA_FILE, "utf8");
  const lines = raw.split("\n").map((line) => line.replace(/\r$/, ""));
  const { header, rows, malformed } = parseCrossReferenceLines(lines);

  if (!isExpectedHeaderFormat(header)) {
    console.warn(`WARNING: header line does not match the expected OpenBible.info format.\n  Got: "${header}"`);
  }
  if (rows.length !== EXPECTED_TOTAL_DATA_ROWS) {
    console.warn(
      `WARNING: expected ${EXPECTED_TOTAL_DATA_ROWS} data rows (Claude's 2026-09-11 verified download shape), ` +
        `got ${rows.length}. web/scripts/data/cross-references.txt may have been refreshed from a newer ` +
        "OpenBible.info release since then -- informational, not fatal, but worth a second look if unexpected.",
    );
  }
  if (malformed.length > 0) {
    console.error(`ERROR: ${malformed.length} line(s) could not even be split into From Verse/To Verse/Votes:`);
    for (const failure of malformed) {
      console.error(`  line ${failure.lineNumber}: ${failure.reason} -- "${failure.line}"`);
    }
  }

  console.log("Building the real CanonTable from web/public/bible ...");
  const canon = await buildRealCanonTable();

  const plan = buildImportPlan(rows, canon);

  console.log("");
  console.log(`Rows read:          ${plan.rowsRead}`);
  console.log(`Skipped (votes<=0): ${plan.skippedVotes}`);
  console.log(`Parse failures:     ${plan.failures.length}`);
  if (plan.failures.length > 0) {
    console.log("  (every parse failure, printed in full -- never silently skipped:)");
    for (const failure of plan.failures) {
      console.log(`    line ${failure.lineNumber}: ${failure.reason}`);
    }
  }
  console.log(`To import:          ${plan.toImport.length}`);

  const accessedAt = new Date().toISOString();
  const sourceId = await upsertOpenBibleSource(db, accessedAt);
  console.log("");
  console.log(`Source row ready: ${sourceId}`);

  const edgesToInsert: GraphEdgeInsert[] = plan.toImport.map((edge) => ({ ...edge, sourceId }));
  const insertedCount = await insertGraphEdgesBatch(db, edgesToInsert);
  const duplicateCount = edgesToInsert.length - insertedCount;

  console.log("");
  console.log(`Inserted ${insertedCount} new graph_edges row(s).`);
  if (duplicateCount > 0) {
    console.log(
      `${duplicateCount} row(s) already existed from a prior run (per the unique index on ` +
        "(from_range, to_range, type)) and were skipped, not duplicated.",
    );
  }
}

main().catch((error: unknown) => {
  console.error("[fatal] Unhandled error in import-cross-references:", error);
  process.exitCode = 1;
});
