/**
 * RELEASEOPS-001 — pure/testable core of the migration-drift check.
 *
 * Background: on 2026-09-17 production Postgres was found 7 migrations behind
 * master (last applied 2026-07-29) because nothing wired or verified
 * migrations after the build-time `drizzle-kit migrate` hook was removed
 * (BUILD_PLAN gate 0.12). This module answers one read-only question:
 * "does the set of migrations recorded in `drizzle.__drizzle_migrations`
 * match the set the repo says should be applied?"
 *
 * What "the repo's set" means: every entry in
 * `db/migrations/meta/_journal.json`, with `hash` = SHA-256 hex of that
 * entry's `<tag>.sql` file bytes and `when` = the journal's `when`. That is
 * exactly what drizzle-orm's own migrator computes (`readMigrationFiles` in
 * `drizzle-orm/migrator.js`: `crypto.createHash("sha256").update(query)`
 * over the raw file text, `folderMillis: journalEntry.when`) and what it
 * writes to the table (`insert ... ("hash", "created_at")`). Verified by
 * reading `node_modules/drizzle-orm/migrator.js` and
 * `pg-core/dialect.js`; the table columns are `id serial, hash text,
 * created_at bigint`.
 *
 * IMPORTANT drizzle behaviour this check exists to catch: the migrator does
 * NOT match rows by hash. It only reads the newest row's `created_at` and
 * applies every journal entry whose `when` is greater. So a DB that is
 * missing a mid-history migration but has a later one applied is silently
 * never repaired (a "gap"), and an edited migration file whose hash no
 * longer matches the applied row is never noticed by drizzle at all
 * ("hash mismatch"). Both are reported here.
 *
 * READ-ONLY: the only database access is the injected `query` function,
 * which the CLI wires to a single `SELECT` (see `fetchAppliedMigrations`).
 * This module never writes and never opens a connection itself, so it is
 * unit-tested entirely with fixtures (`tests/migration-drift.test.ts`).
 *
 * Author: Kenneth Hill
 */

import { createHash } from "node:crypto";

/** One migration the repo expects to be applied (journal entry + file hash). */
export interface ExpectedMigration {
  idx: number;
  tag: string;
  /** Journal `when` (ms since epoch); becomes `created_at` in the DB table. */
  when: number;
  /** SHA-256 hex of the raw `<tag>.sql` file bytes, as drizzle computes it. */
  hash: string;
  /** SHA-256 hex of the same file with CRLF normalised to LF. Optional; only
   * used to explain a hash mismatch that is purely a line-ending difference. */
  lfHash?: string;
}

/** One row of `drizzle.__drizzle_migrations`, normalised. */
export interface AppliedMigration {
  id: number | null;
  hash: string;
  /** `created_at` is a Postgres `bigint`; drivers return it as a string. */
  createdAt: number | null;
}

export type DriftKind =
  /** Repo has migrations the DB has not applied (DB is behind). */
  | "behind"
  /** DB has an applied row the repo does not know (DB is ahead / foreign). */
  | "ahead"
  /** Same `when`/`created_at` but different hash: a migration file was edited
   * after it was applied, or a different file was applied under that id. */
  | "hash_mismatch"
  /** A repo migration is unapplied although a LATER one is applied; drizzle's
   * `created_at > last` rule will never apply it. */
  | "gap"
  /** Applied row has the right hash but a different `created_at` than the
   * journal's `when`. */
  | "timestamp_mismatch"
  /** The same hash appears in more than one applied row. */
  | "duplicate_applied";

export interface DriftFinding {
  kind: DriftKind;
  message: string;
  /** Repo side, when the finding concerns a journal entry. */
  tag?: string;
  idx?: number;
  when?: number;
  expectedHash?: string;
  /** DB side, when the finding concerns an applied row. */
  appliedHash?: string;
  appliedCreatedAt?: number | null;
}

export interface DriftWarning {
  /** Non-fatal observation (does not by itself make the report drifted). */
  message: string;
  tag?: string;
}

export interface DriftReport {
  /** True only when there are zero findings. Warnings never flip this. */
  ok: boolean;
  expectedCount: number;
  appliedCount: number;
  /** Tags the repo has that the DB has not applied, in journal order. */
  behindTags: string[];
  findings: DriftFinding[];
  warnings: DriftWarning[];
  /** True when the migrations table did not exist (nothing ever applied). */
  tableMissing: boolean;
}

export interface CompareOptions {
  /** Set when `drizzle.__drizzle_migrations` does not exist at all. */
  tableMissing?: boolean;
}

/** SHA-256 hex of raw migration SQL — identical to drizzle-orm's algorithm. */
export function hashMigrationSql(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

/** Same hash after CRLF -> LF; used only to diagnose line-ending-only drift. */
export function hashMigrationSqlLf(sql: string): string {
  return hashMigrationSql(sql.replace(/\r\n/g, "\n"));
}

interface JournalLike {
  entries: { idx: number; tag: string; when: number }[];
}

/**
 * Builds the expected list from a parsed journal and a `readSql(tag)` lookup
 * (injected so this stays pure and fixture-testable).
 */
export function buildExpectedMigrations(
  journal: JournalLike,
  readSql: (tag: string) => string,
): ExpectedMigration[] {
  return journal.entries.map((entry) => {
    const sql = readSql(entry.tag);
    return {
      idx: entry.idx,
      tag: entry.tag,
      when: entry.when,
      hash: hashMigrationSql(sql),
      lfHash: hashMigrationSqlLf(sql),
    };
  });
}

/**
 * Normalises raw rows from the DB driver. `created_at` may arrive as a
 * string (bigint), number, or null; a non-numeric value becomes null and is
 * treated as unknown rather than guessed.
 */
export function normalizeAppliedRows(
  rows: readonly { id?: unknown; hash?: unknown; created_at?: unknown }[],
): AppliedMigration[] {
  return rows.map((row) => {
    const created = row.created_at === null || row.created_at === undefined ? NaN : Number(row.created_at);
    const id = row.id === null || row.id === undefined ? NaN : Number(row.id);
    return {
      id: Number.isFinite(id) ? id : null,
      hash: String(row.hash ?? ""),
      createdAt: Number.isFinite(created) ? created : null,
    };
  });
}

/**
 * Compares the repo's expected migrations with the DB's applied rows.
 * Deterministic; findings are ordered behind/gap (journal order), then
 * hash_mismatch/timestamp_mismatch (journal order), then ahead/duplicate
 * (applied `created_at` order).
 */
export function compareMigrations(
  expected: readonly ExpectedMigration[],
  applied: readonly AppliedMigration[],
  options: CompareOptions = {},
): DriftReport {
  const findings: DriftFinding[] = [];
  const warnings: DriftWarning[] = [];

  const appliedByHash = new Map<string, AppliedMigration[]>();
  for (const row of applied) {
    const list = appliedByHash.get(row.hash) ?? [];
    list.push(row);
    appliedByHash.set(row.hash, list);
  }
  const appliedByCreatedAt = new Map<number, AppliedMigration[]>();
  for (const row of applied) {
    if (row.createdAt === null) continue;
    const list = appliedByCreatedAt.get(row.createdAt) ?? [];
    list.push(row);
    appliedByCreatedAt.set(row.createdAt, list);
  }

  const expectedHashes = new Set(expected.map((entry) => entry.hash));
  const expectedWhens = new Set(expected.map((entry) => entry.when));

  // An expected entry counts as "present" when a row carries its hash OR a
  // row carries its exact created_at (the latter with a different hash is
  // reported as hash_mismatch below — the migration WAS applied, in a
  // different form, so it is not "behind").
  const isPresent = (entry: ExpectedMigration): boolean =>
    appliedByHash.has(entry.hash) || (appliedByCreatedAt.get(entry.when)?.length ?? 0) > 0;

  // Newest expected entry (by `when`) that IS present; anything absent and
  // older than it is a gap that drizzle will never fill.
  let newestAppliedWhen = -Infinity;
  for (const entry of expected) {
    if (isPresent(entry) && entry.when > newestAppliedWhen) newestAppliedWhen = entry.when;
  }

  const behindTags: string[] = [];
  for (const entry of expected) {
    if (isPresent(entry)) continue;

    behindTags.push(entry.tag);
    if (entry.when < newestAppliedWhen) {
      findings.push({
        kind: "gap",
        tag: entry.tag,
        idx: entry.idx,
        when: entry.when,
        expectedHash: entry.hash,
        message:
          `${entry.tag} is NOT applied but a later migration is. drizzle's migrator only applies entries newer ` +
          `than the newest applied row, so it will never apply this one. Needs manual reconciliation.`,
      });
    } else {
      findings.push({
        kind: "behind",
        tag: entry.tag,
        idx: entry.idx,
        when: entry.when,
        expectedHash: entry.hash,
        message: `${entry.tag} is in the repo journal but not applied to the database.`,
      });
    }
  }

  for (const entry of expected) {
    const sameStamp = appliedByCreatedAt.get(entry.when) ?? [];
    for (const row of sameStamp) {
      if (row.hash === entry.hash) continue;
      const lineEndingOnly = entry.lfHash !== undefined && row.hash === entry.lfHash && entry.lfHash !== entry.hash;
      if (lineEndingOnly) {
        // The applied hash equals the LF-normalised hash of the current file,
        // so the only difference is CRLF vs LF in this checkout. Not real drift.
        warnings.push({
          tag: entry.tag,
          message:
            `${entry.tag}: applied hash matches the file only after CRLF->LF normalisation. Line endings differ ` +
            `between the checkout that applied it and this one (.gitattributes forces LF). Not treated as drift.`,
        });
        continue;
      }
      findings.push({
        kind: "hash_mismatch",
        tag: entry.tag,
        idx: entry.idx,
        when: entry.when,
        expectedHash: entry.hash,
        appliedHash: row.hash,
        appliedCreatedAt: row.createdAt,
        message:
          `${entry.tag}: the applied row with created_at=${entry.when} has hash ${row.hash.slice(0, 12)}..., ` +
          `but the repo file hashes to ${entry.hash.slice(0, 12)}.... The file was edited after it was applied, ` +
          `or a different migration was applied under this timestamp.`,
      });
    }
  }

  for (const entry of expected) {
    for (const row of appliedByHash.get(entry.hash) ?? []) {
      if (row.createdAt !== null && row.createdAt !== entry.when) {
        findings.push({
          kind: "timestamp_mismatch",
          tag: entry.tag,
          idx: entry.idx,
          when: entry.when,
          expectedHash: entry.hash,
          appliedHash: row.hash,
          appliedCreatedAt: row.createdAt,
          message:
            `${entry.tag}: applied row has the right hash but created_at=${row.createdAt}, journal says ` +
            `when=${entry.when}. The journal timestamp was changed after apply.`,
        });
      }
    }
  }

  const sortedApplied = [...applied].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  for (const row of sortedApplied) {
    const knownByHash = expectedHashes.has(row.hash);
    const knownByStamp = row.createdAt !== null && expectedWhens.has(row.createdAt);
    // A row whose created_at matches a journal entry but whose hash differs is
    // already a hash_mismatch above; do not double-report it as "ahead".
    if (!knownByHash && !knownByStamp) {
      findings.push({
        kind: "ahead",
        appliedHash: row.hash,
        appliedCreatedAt: row.createdAt,
        message:
          `The database has an applied migration (hash ${row.hash.slice(0, 12)}..., created_at=${row.createdAt}) ` +
          `that is not in this repo's journal. The database is ahead of, or was migrated from, a different branch.`,
      });
    }
  }
  for (const [hash, rows] of appliedByHash) {
    if (rows.length > 1) {
      findings.push({
        kind: "duplicate_applied",
        appliedHash: hash,
        message: `${rows.length} rows in the migrations table share hash ${hash.slice(0, 12)}...; the same migration was recorded more than once.`,
      });
    }
  }

  return {
    ok: findings.length === 0,
    expectedCount: expected.length,
    appliedCount: applied.length,
    behindTags,
    findings,
    warnings,
    tableMissing: options.tableMissing === true,
  };
}

// ---------------------------------------------------------------------------
// Read-only database access, via an injected `query` function.
// ---------------------------------------------------------------------------

/** Minimal driver seam: run one SQL string, get rows back. */
export type QueryFn = (sql: string) => Promise<{ rows: readonly Record<string, unknown>[] }>;

export const MIGRATIONS_SCHEMA = "drizzle";
export const MIGRATIONS_TABLE = "__drizzle_migrations";

/** The one and only statement this check ever runs. A plain SELECT. */
export const APPLIED_MIGRATIONS_SQL = `select id, hash, created_at from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" order by created_at asc, id asc`;

const POSTGRES_UNDEFINED_TABLE = "42P01";
const POSTGRES_INVALID_SCHEMA = "3F000";

function isMissingRelation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: string }).code;
  return code === POSTGRES_UNDEFINED_TABLE || code === POSTGRES_INVALID_SCHEMA;
}

/**
 * Reads the applied set. A missing table/schema is NOT an error: it means
 * nothing has ever been applied (a fresh database), which compares as
 * "everything is behind". Any other error propagates.
 */
export async function fetchAppliedMigrations(
  query: QueryFn,
): Promise<{ applied: AppliedMigration[]; tableMissing: boolean }> {
  try {
    const result = await query(APPLIED_MIGRATIONS_SQL);
    return { applied: normalizeAppliedRows(result.rows), tableMissing: false };
  } catch (error) {
    if (isMissingRelation(error)) return { applied: [], tableMissing: true };
    throw error;
  }
}

/** Query + compare in one step. */
export async function checkMigrationDrift(
  expected: readonly ExpectedMigration[],
  query: QueryFn,
): Promise<DriftReport> {
  const { applied, tableMissing } = await fetchAppliedMigrations(query);
  return compareMigrations(expected, applied, { tableMissing });
}

// ---------------------------------------------------------------------------
// Report formatting + exit code
// ---------------------------------------------------------------------------

/** 0 = in sync, 1 = drift. (The CLI uses 2 for operational errors.) */
export function driftExitCode(report: DriftReport): 0 | 1 {
  return report.ok ? 0 : 1;
}

export function formatDriftReport(report: DriftReport): string {
  const lines: string[] = [];
  lines.push(`Repo journal: ${report.expectedCount} migration(s). Database applied: ${report.appliedCount} row(s).`);
  if (report.tableMissing) {
    lines.push(`Note: drizzle.__drizzle_migrations does not exist (fresh database: nothing applied).`);
  }
  if (report.behindTags.length > 0) {
    lines.push(`Not applied (${report.behindTags.length}): ${report.behindTags.join(", ")}`);
  }
  for (const finding of report.findings) {
    lines.push(`DRIFT [${finding.kind}] ${finding.message}`);
  }
  for (const warning of report.warnings) {
    lines.push(`WARN  ${warning.message}`);
  }
  lines.push(report.ok ? "RESULT: in sync." : `RESULT: DRIFT (${report.findings.length} finding(s)). Exit 1.`);
  return lines.join("\n");
}
