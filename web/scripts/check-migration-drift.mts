#!/usr/bin/env -S npx tsx
/**
 * RELEASEOPS-001 — READ-ONLY migration drift check (CLI).
 *
 * Compares the migrations in `db/migrations/meta/_journal.json` (and the
 * SHA-256 of each `<tag>.sql`) with the rows in `drizzle.__drizzle_migrations`
 * and reports drift: database behind, ahead, gap, or hash mismatch. All
 * comparison logic lives in `scripts/lib/migrationDrift.ts` and is unit
 * tested with fixtures; this file is only the IO shell.
 *
 *   DATABASE_URL=postgres://... npm run db:drift-check
 *
 * Exit codes:
 *   0  repo and database agree
 *   1  DRIFT detected (report printed)
 *   2  the check itself could not run (no DATABASE_URL, cannot connect,
 *      cannot read the journal/files, unexpected query error)
 *
 * READ-ONLY guarantee: the only SQL this process sends is the single SELECT
 * in `APPLIED_MIGRATIONS_SQL` (`migrationDrift.ts`). It never migrates,
 * never takes a lock, never writes. It deliberately does NOT read
 * `.env.local`: `DATABASE_URL` must be supplied by the caller's environment
 * (a CI secret, or you exporting it in your shell), so an accidental local
 * env file cannot silently point this at production.
 *
 * NOT YET RUN against a real database (none was available when this was
 * written). Same honesty rule as `tests/README-release-migrate.md`.
 *
 * Author: Kenneth Hill
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "@neondatabase/serverless";

import {
  buildExpectedMigrations,
  checkMigrationDrift,
  driftExitCode,
  formatDriftReport,
  type ExpectedMigration,
  type QueryFn,
} from "./lib/migrationDrift";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(SCRIPT_DIR, "..", "db", "migrations");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

async function loadExpected(): Promise<ExpectedMigration[]> {
  const journal = JSON.parse(await readFile(JOURNAL_PATH, "utf8")) as {
    entries: { idx: number; tag: string; when: number }[];
  };
  // Pre-read every file so buildExpectedMigrations can stay synchronous/pure.
  const sqlByTag = new Map<string, string>();
  for (const entry of journal.entries) {
    sqlByTag.set(entry.tag, await readFile(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8"));
  }
  return buildExpectedMigrations(journal, (tag) => sqlByTag.get(tag) as string);
}

async function main(): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[drift-check] ERROR DATABASE_URL is required in the environment. Nothing was checked.");
    return 2;
  }

  const expected = await loadExpected();
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const query: QueryFn = async (sql) => {
      const result = await pool.query(sql);
      return { rows: result.rows as Record<string, unknown>[] };
    };
    const report = await checkMigrationDrift(expected, query);
    console.log(formatDriftReport(report));
    return driftExitCode(report);
  } finally {
    await pool.end();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error("[drift-check] ERROR the check could not run:", error);
    process.exitCode = 2;
  });
