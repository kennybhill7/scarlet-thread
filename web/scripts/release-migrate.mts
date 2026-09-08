#!/usr/bin/env -S npx tsx
/**
 * RELEASEJOB-001 — standalone release-migration CLI.
 *
 * Replaces the dangerous Vercel `buildCommand` hook removed in `a1031cc`
 * (BUILD_PLAN.md gate 0.12 / CODEX_AUDIT.md finding A-047): that hook ran
 * `drizzle-kit migrate` on every Vercel build — previews included — against
 * whatever `DATABASE_URL` the build environment carried, before the new
 * application build was proven, with no locking across concurrent
 * deployments. This script is the named replacement: "a serialized release
 * migration job with database-identity checks, locking, backup/readiness
 * checks, expand-contract migrations, and post-migration verification."
 *
 * Run explicitly, as its own step, separate from `next build`:
 *
 *   npm run db:release-migrate -- --expected-db=<database-name>
 *
 * or with env vars instead of flags:
 *
 *   DATABASE_URL=postgres://... RELEASE_MIGRATE_EXPECTED_DB=<name> \
 *     npm run db:release-migrate
 *
 * Flags (all optional except that a database identity MUST be configured
 * one way or another, or the identity phase refuses to proceed):
 *
 *   --database-url=<url>       (env DATABASE_URL)          connection string
 *   --expected-db=<name>       (env RELEASE_MIGRATE_EXPECTED_DB)
 *                               current_database() must equal this exactly
 *   --allow-breaking           (env RELEASE_MIGRATE_ALLOW_BREAKING=1)
 *                               required to proceed if any pending migration
 *                               contains a DROP TABLE / DROP COLUMN /
 *                               ALTER COLUMN ... TYPE / DROP CONSTRAINT
 *   --lock-timeout-ms=<n>      (env RELEASE_MIGRATE_LOCK_TIMEOUT_MS, default 30000)
 *   --min-pg-version=<n>       (env RELEASE_MIGRATE_MIN_PG_VERSION, default 14)
 *
 * SCOPE / HONESTY NOTES (read before wiring this into anything real):
 *
 *  1. This is NOT wired into Vercel or any deploy pipeline. Recreating a
 *     build-time migrate hook is exactly the defect `a1031cc` removed;
 *     `web/vercel.json` is untouched. Deciding when/how a real pipeline
 *     invokes this script (a manual release step? a gated CI job? what
 *     credentials it runs with there?) is Ken's own deployment-configuration
 *     decision, out of this task's scope.
 *
 *  2. "Backup/readiness check" is honestly partial. A real Neon
 *     backup/restore-point API integration needs external credentials and
 *     scope this task does not have, so it is NOT implemented — there is no
 *     step here that takes or verifies an actual backup. What IS real and
 *     implemented: (a) a live connectivity + `current_database()` identity
 *     check, (b) a Postgres major-version floor check, (c) a check that the
 *     migrations journal table's last-applied timestamp corresponds to a
 *     real, known migration file rather than a foreign/partial state (see
 *     `checkNoForeignMigrationState` in `scripts/lib/releaseMigrate.ts` for
 *     exactly what that can and cannot prove). Treat this script as "safe
 *     to serialize and apply known migrations," not as "a verified restore
 *     point exists."
 *
 *  3. The expand-contract guard is a real, mechanizable regex scan of
 *     pending migration SQL (see `scripts/lib/releaseMigrate.ts`), not a
 *     comment. It is deliberately conservative/over-inclusive (documented
 *     there) — false positives require `--allow-breaking`, not a code
 *     change.
 *
 *  4. `db/migrations/*.sql` is read-only from this script's point of view —
 *     it is only ever scanned, never rewritten. The known 0006/0007
 *     statement-ordering defect documented in
 *     `web/tests/README-db-invariants.md` is untouched and out of scope
 *     here too.
 *
 * See `web/scripts/lib/releaseMigrate.ts` for the fully unit-tested pure
 * orchestration logic (phase sequencing, identity comparison, the SQL scan,
 * CLI/env parsing) and `web/tests/README-release-migrate.md` for the
 * manual, live-Postgres verification procedure this script's logic cannot
 * be proven against without a real database (a lock actually blocking a
 * concurrent second run; the migrator actually applying SQL; the identity
 * check actually refusing a mismatched database).
 *
 * Author: Kenneth Hill
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate as drizzleMigrate } from "drizzle-orm/neon-serverless/migrator";

import {
  parseReleaseMigrateConfig,
  runReleaseMigration,
  splitMigrationStatements,
  RELEASE_MIGRATE_LOCK_KEY,
  type JournalEntry,
  type ReleaseMigrateDeps,
  type ReleaseMigrateLogLine,
} from "./lib/releaseMigrate";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(SCRIPT_DIR, "..", "db", "migrations");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

/** Matches drizzle-orm's own migrator (`pg-core/dialect.js`) — see
 * `checkNoForeignMigrationState`'s doc comment for why this table's schema
 * is the source of truth for "what has already been applied." */
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

/** `stages` is a small, global (not user-scoped) reference table already
 * read directly by `app/(app)/page.tsx` — a cheap, real post-migration
 * smoke query with no destructive risk. */
const SMOKE_QUERY_TABLE = "stages";

const POSTGRES_UNDEFINED_TABLE = "42P01";

function isUndefinedTableError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === POSTGRES_UNDEFINED_TABLE;
}

function formatLogLine(line: ReleaseMigrateLogLine): string {
  const phaseTag = `[${line.phase}]`.padEnd(11);
  const levelTag = line.level.toUpperCase().padEnd(5);
  return `${phaseTag} ${levelTag} ${line.message}`;
}

function printHelp(): void {
  console.log(
    [
      "Usage: npm run db:release-migrate -- [--expected-db=<name>] [--allow-breaking] [--lock-timeout-ms=<n>] [--min-pg-version=<n>] [--database-url=<url>]",
      "",
      "See the header comment in web/scripts/release-migrate.mts for full flag/env-var docs and scope notes.",
    ].join("\n"),
  );
}

interface JournalFile {
  entries: { tag: string; when: number }[];
}

async function readJournalEntries(): Promise<JournalEntry[]> {
  const raw = await readFile(JOURNAL_PATH, "utf8");
  const journal = JSON.parse(raw) as JournalFile;
  return journal.entries.map((entry) => ({ tag: entry.tag, when: entry.when }));
}

async function readMigrationStatements(tag: string): Promise<string[]> {
  const filePath = path.join(MIGRATIONS_DIR, `${tag}.sql`);
  const raw = await readFile(filePath, "utf8");
  return splitMigrationStatements(raw);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const parsed = parseReleaseMigrateConfig(argv, process.env);
  if (!parsed.ok) {
    for (const error of parsed.errors) console.error(`[config]     ERROR ${error}`);
    console.error("");
    printHelp();
    process.exitCode = 1;
    return;
  }
  const { config } = parsed;

  const pool = new Pool({ connectionString: config.databaseUrl });
  const db = drizzle(pool);

  const deps: ReleaseMigrateDeps = {
    queryCurrentDatabase: async () => {
      const result = await pool.query<{ db: string }>("select current_database() as db");
      return result.rows[0].db;
    },

    tryAcquireLock: async () => {
      const result = await pool.query<{ locked: boolean }>("select pg_try_advisory_lock($1::bigint) as locked", [
        RELEASE_MIGRATE_LOCK_KEY.toString(),
      ]);
      return result.rows[0].locked;
    },

    releaseLock: async () => {
      // Best-effort: if the connection is already gone, Postgres releases a
      // session-level advisory lock automatically when the session ends, so
      // a failure here is not itself a correctness problem — but it IS
      // worth surfacing rather than swallowing silently.
      try {
        await pool.query("select pg_advisory_unlock($1::bigint)", [RELEASE_MIGRATE_LOCK_KEY.toString()]);
      } catch (error) {
        console.error(`[lock]      WARN  Could not explicitly release the advisory lock (it will still release when the session ends): ${String(error)}`);
      }
    },

    queryPgVersionNum: async () => {
      const result = await pool.query<{ server_version_num: string }>("show server_version_num");
      return Number(result.rows[0].server_version_num);
    },

    queryLastAppliedMigration: async () => {
      try {
        const result = await pool.query<{ created_at: string }>(
          `select created_at from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" order by created_at desc limit 1`,
        );
        return result.rows[0] ? Number(result.rows[0].created_at) : null;
      } catch (error) {
        if (isUndefinedTableError(error)) return null;
        throw error;
      }
    },

    readJournalEntries,
    readMigrationStatements,

    applyPendingMigrations: async () => {
      // The real programmatic migrator drizzle-kit's own `migrate` command
      // wraps (see web/scripts/lib/releaseMigrate.ts's header comment) —
      // not a shelled-out `drizzle-kit migrate` subprocess. It re-derives
      // "pending" using the same algorithm this script already checked
      // against above (see checkNoForeignMigrationState / selectPendingMigrations),
      // applies every pending migration in one transaction, and records one
      // row per applied migration in the journal table.
      await drizzleMigrate(db, { migrationsFolder: MIGRATIONS_DIR });
    },

    queryAppliedMigrationCount: async () => {
      try {
        const result = await pool.query<{ count: number }>(
          `select count(*)::int as count from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`,
        );
        return result.rows[0]?.count ?? 0;
      } catch (error) {
        if (isUndefinedTableError(error)) return 0;
        throw error;
      }
    },

    runSmokeQuery: async () => {
      await pool.query(`select 1 from "${SMOKE_QUERY_TABLE}" limit 1`);
    },

    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),

    log: (line: ReleaseMigrateLogLine) => {
      const formatted = formatLogLine(line);
      if (line.level === "error") console.error(formatted);
      else console.log(formatted);
    },
  };

  try {
    const result = await runReleaseMigration(deps, config);
    console.log("");
    console.log(result.ok ? `SUCCESS: ${result.message}` : `FAILED at phase "${result.failedPhase}": ${result.message}`);
    if (result.appliedTags.length > 0) {
      console.log(`Applied: ${result.appliedTags.join(", ")}`);
    }
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[fatal]     ERROR Unhandled error in release-migrate:", error);
  process.exitCode = 1;
});
