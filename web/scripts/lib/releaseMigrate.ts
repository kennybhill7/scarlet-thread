/**
 * RELEASEJOB-001 — pure/testable core of the release-migration job.
 *
 * Everything in this file is dependency-injected and has no live network or
 * filesystem access of its own (no Pool, no `fs`, no `process.exit`). The
 * CLI entrypoint (`web/scripts/release-migrate.mts`) is the only place that
 * touches a real Postgres connection or the real `db/migrations/` files; it
 * wires real implementations into the `ReleaseMigrateDeps` shape defined
 * here and calls `runReleaseMigration`. This mirrors the `SessionDeps` /
 * `ClimbDataDeps` seam already used by `web/app/(app)/page.tsx`: the
 * orchestration logic (phase sequencing, identity comparison, the
 * expand-contract SQL scan, CLI/env parsing) is fully unit-testable with
 * `web/tests/release-migrate.test.ts` supplying fake deps, no live database
 * required. See `web/tests/README-release-migrate.md` for the separate,
 * manual, live-Postgres verification this file's logic cannot cover on its
 * own (a lock actually blocking a second process, the migrator actually
 * running SQL, a real smoke query).
 *
 * Author: Kenneth Hill
 */

// ---------------------------------------------------------------------------
// Advisory lock
// ---------------------------------------------------------------------------

/**
 * Fixed, documented Postgres session-level advisory lock key for this job.
 * Arbitrary (chosen once, no special meaning) but MUST stay stable across
 * every build of this script and every deploy — two processes only
 * serialize against each other if they request the *same* key. Do not
 * regenerate this value; treat a change to it the same as a breaking
 * config change requiring a coordinated deploy.
 *
 * Passed to Postgres as `$1::bigint` (see release-migrate.mts) rather than
 * relying on implicit parameter typing, so the exact numeric type sent over
 * the wire does not matter here. Kept as a plain JS `number` (well within
 * `Number.MAX_SAFE_INTEGER`), not a `bigint` literal — this file compiles
 * under this project's `target: "ES2017"` (`tsconfig.json`, a read-only
 * path for this task), which does not support `bigint` literals.
 */
export const RELEASE_MIGRATE_LOCK_KEY = 7_420_991_003;

/** Bounded wait, not `pg_advisory_lock`'s indefinite block. */
export const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
export const DEFAULT_LOCK_POLL_INTERVAL_MS = 1_000;

/** Conservative floor; overridable via `--min-pg-version` / env — see header
 * comment in release-migrate.mts on why this is a floor, not a verified
 * Neon-specific requirement. */
export const DEFAULT_MIN_PG_VERSION = 14;

// ---------------------------------------------------------------------------
// CLI / env config parsing
// ---------------------------------------------------------------------------

export interface ReleaseMigrateConfig {
  databaseUrl: string;
  /**
   * Undefined means "not configured" — the identity-check PHASE (not this
   * parser) is what fails closed on that, so a missing value is a valid,
   * representable config here and is exercised as its own phase-sequencing
   * test rather than a parse error.
   */
  expectedDatabaseName: string | undefined;
  allowBreaking: boolean;
  lockTimeoutMs: number;
  lockPollIntervalMs: number;
  minPgVersion: number;
}

export type ConfigParseResult =
  | { ok: true; config: ReleaseMigrateConfig }
  | { ok: false; errors: string[] };

/**
 * Structurally compatible with `NodeJS.ProcessEnv` (the CLI passes
 * `process.env` directly) but deliberately not typed AS `NodeJS.ProcessEnv`
 * itself, so `web/tests/release-migrate.test.ts` can pass small, literal
 * fixture objects (`{ DATABASE_URL: "..." }`) without also having to satisfy
 * `NodeJS.ProcessEnv`'s required `NODE_ENV` field.
 */
export type EnvLike = Record<string, string | undefined>;

function readFlagOrEnv(
  argv: string[],
  flag: string,
  env: EnvLike,
  envVar: string,
): string | undefined {
  const prefix = `--${flag}=`;
  const fromArgv = argv.find((arg) => arg.startsWith(prefix));
  if (fromArgv) return fromArgv.slice(prefix.length);
  const bareFlagIndex = argv.indexOf(`--${flag}`);
  if (bareFlagIndex !== -1 && argv[bareFlagIndex + 1] && !argv[bareFlagIndex + 1].startsWith("--")) {
    return argv[bareFlagIndex + 1];
  }
  return env[envVar];
}

function readBooleanFlag(argv: string[], flag: string, env: EnvLike, envVar: string): boolean {
  if (argv.includes(`--${flag}`)) return true;
  const envValue = env[envVar];
  if (envValue === undefined) return false;
  return envValue === "1" || envValue.toLowerCase() === "true";
}

function parsePositiveInt(value: string | undefined, label: string, errors: string[]): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    errors.push(`${label} must be a positive integer, got ${JSON.stringify(value)}.`);
    return undefined;
  }
  return parsed;
}

/**
 * Parses CLI flags (argv, WITHOUT the `node`/script entries — pass
 * `process.argv.slice(2)`) and environment variables into a
 * {@link ReleaseMigrateConfig}. Flags win over env vars when both are set.
 *
 * Recognised flags: `--expected-db=<name>`, `--allow-breaking`,
 * `--lock-timeout-ms=<n>`, `--min-pg-version=<n>`, `--database-url=<url>`.
 * Matching env vars: `RELEASE_MIGRATE_EXPECTED_DB`,
 * `RELEASE_MIGRATE_ALLOW_BREAKING`, `RELEASE_MIGRATE_LOCK_TIMEOUT_MS`,
 * `RELEASE_MIGRATE_MIN_PG_VERSION`, `DATABASE_URL`.
 */
export function parseReleaseMigrateConfig(
  argv: string[],
  env: EnvLike,
): ConfigParseResult {
  const errors: string[] = [];

  const databaseUrl = readFlagOrEnv(argv, "database-url", env, "DATABASE_URL");
  if (!databaseUrl) {
    errors.push(
      "No database connection string configured (--database-url or DATABASE_URL). Refusing to proceed without one.",
    );
  }

  const expectedDatabaseName = readFlagOrEnv(argv, "expected-db", env, "RELEASE_MIGRATE_EXPECTED_DB");
  const allowBreaking = readBooleanFlag(argv, "allow-breaking", env, "RELEASE_MIGRATE_ALLOW_BREAKING");

  const lockTimeoutMs =
    parsePositiveInt(
      readFlagOrEnv(argv, "lock-timeout-ms", env, "RELEASE_MIGRATE_LOCK_TIMEOUT_MS"),
      "--lock-timeout-ms/RELEASE_MIGRATE_LOCK_TIMEOUT_MS",
      errors,
    ) ?? DEFAULT_LOCK_TIMEOUT_MS;

  const minPgVersion =
    parsePositiveInt(
      readFlagOrEnv(argv, "min-pg-version", env, "RELEASE_MIGRATE_MIN_PG_VERSION"),
      "--min-pg-version/RELEASE_MIGRATE_MIN_PG_VERSION",
      errors,
    ) ?? DEFAULT_MIN_PG_VERSION;

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    config: {
      databaseUrl: databaseUrl!,
      expectedDatabaseName,
      allowBreaking,
      lockTimeoutMs,
      lockPollIntervalMs: DEFAULT_LOCK_POLL_INTERVAL_MS,
      minPgVersion,
    },
  };
}

// ---------------------------------------------------------------------------
// Database-identity check
// ---------------------------------------------------------------------------

export type IdentityCheckResult = { ok: true; actual: string } | { ok: false; reason: string };

/**
 * Fails closed: an unset expected value is treated exactly like a mismatch,
 * never a pass. Exact, case-sensitive string comparison — no normalisation,
 * so a scheme/case typo in `--expected-db` cannot silently match.
 */
export function checkDatabaseIdentity(
  actual: string,
  expected: string | undefined,
): IdentityCheckResult {
  if (expected === undefined || expected === "") {
    return {
      ok: false,
      reason:
        "No expected database identity configured (--expected-db or RELEASE_MIGRATE_EXPECTED_DB). " +
        "Refusing to run a release migration without an explicit, verified target — this is the guard " +
        "against accidentally migrating the wrong database.",
    };
  }
  if (actual !== expected) {
    return {
      ok: false,
      reason: `Database identity mismatch: connected to "${actual}", expected "${expected}". Refusing to proceed.`,
    };
  }
  return { ok: true, actual };
}

// ---------------------------------------------------------------------------
// Postgres version check
// ---------------------------------------------------------------------------

export type VersionCheckResult = { ok: true; major: number } | { ok: false; reason: string };

/** `versionNum` is Postgres's own `server_version_num` format (e.g. 160003
 * for 16.3): `major = floor(versionNum / 10000)`. */
export function checkPgVersion(versionNum: number, minVersion: number): VersionCheckResult {
  const major = Math.floor(versionNum / 10_000);
  if (major < minVersion) {
    return {
      ok: false,
      reason: `Postgres major version ${major} is below the configured minimum ${minVersion} (server_version_num=${versionNum}).`,
    };
  }
  return { ok: true, major };
}

// ---------------------------------------------------------------------------
// "No foreign/partial migration state" readiness check
// ---------------------------------------------------------------------------

export interface JournalEntry {
  tag: string;
  when: number;
}

export type ForeignStateCheckResult = { ok: true } | { ok: false; reason: string };

/**
 * drizzle-orm's own migrator (see `node_modules/drizzle-orm/pg-core/dialect.js`,
 * `PgDialect.migrate`) applies every pending migration inside ONE
 * transaction and records exactly one row per applied migration, keyed by
 * that migration's journal `when` timestamp as `created_at`. That means a
 * healthy database's last-applied `created_at` must always equal some
 * migration file's `when` in the local journal — under normal operation
 * there is no way for it to land "between" two files. If it does not match
 * any known journal entry, the database was migrated by something else (a
 * different branch's migration set, a different tool, manual surgery) and
 * this job cannot safely reason about what is "pending" relative to it.
 * This is the closest mechanizable proxy this task can build, without a
 * real Neon backup/branch API integration, to "confirm no migration is
 * already mid-application" — see this module's header and
 * release-migrate.mts's header comment for what is and is not covered.
 */
export function checkNoForeignMigrationState(
  lastAppliedCreatedAt: number | null,
  journalEntries: JournalEntry[],
): ForeignStateCheckResult {
  if (lastAppliedCreatedAt === null) return { ok: true };
  const known = journalEntries.some((entry) => entry.when === lastAppliedCreatedAt);
  if (!known) {
    return {
      ok: false,
      reason:
        `The migrations journal table records a last-applied timestamp (${lastAppliedCreatedAt}) that does not ` +
        `match any migration file's timestamp in db/migrations/meta/_journal.json. This database may have been ` +
        `migrated by a different tool, branch, or manual change. Refusing to proceed until this is reconciled by hand.`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pending-migration selection
// ---------------------------------------------------------------------------

/**
 * Same "pending" definition drizzle-orm's own migrator uses internally
 * (see checkNoForeignMigrationState's comment): every journal entry whose
 * `when` is strictly greater than the database's last-applied `created_at`
 * (or every entry, if nothing has been applied yet).
 */
export function selectPendingMigrations(
  journalEntries: JournalEntry[],
  lastAppliedCreatedAt: number | null,
): JournalEntry[] {
  const threshold = lastAppliedCreatedAt ?? -Infinity;
  return journalEntries.filter((entry) => entry.when > threshold);
}

// ---------------------------------------------------------------------------
// Expand-contract guard — destructive-statement scanning
// ---------------------------------------------------------------------------

export interface BreakingChangeRule {
  name: string;
  pattern: RegExp;
  description: string;
}

/**
 * Deliberately conservative / over-inclusive: `ALTER_COLUMN_TYPE` flags
 * every `ALTER COLUMN ... TYPE`, not only ones this scanner can prove are
 * narrowing (that would require comparing old vs. new column types against
 * the schema snapshots, which this task's scope does not build). Likewise
 * `DROP_CONSTRAINT` flags every `DROP CONSTRAINT`, not only ones a NOT NULL
 * or foreign key others depend on. False positives are the intended
 * failure mode here (an operator can always re-run with `--allow-breaking`
 * once they've read the printed statement); silently letting a real
 * destructive statement through is not. Documented explicitly per
 * RELEASEJOB-001's acceptance criteria.
 */
export const BREAKING_CHANGE_RULES: BreakingChangeRule[] = [
  { name: "DROP_TABLE", pattern: /\bDROP\s+TABLE\b/i, description: "drops a table" },
  { name: "DROP_COLUMN", pattern: /\bDROP\s+COLUMN\b/i, description: "drops a column" },
  {
    name: "ALTER_COLUMN_TYPE",
    pattern: /\bALTER\s+COLUMN\s+\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i,
    description: "changes a column's type (treated as potentially narrowing)",
  },
  {
    name: "DROP_CONSTRAINT",
    pattern: /\bDROP\s+CONSTRAINT\b/i,
    description: "drops a constraint (treated as potentially load-bearing)",
  },
];

/** Splits one migration file's SQL the same way drizzle-kit generates it and
 * drizzle-orm's own migrator reads it back: on the literal
 * `--> statement-breakpoint` marker. Empty/whitespace-only fragments are
 * dropped. */
export function splitMigrationStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

export interface BreakingMatch {
  statementIndex: number;
  statement: string;
  rule: string;
  description: string;
}

/** Scans already-split statements (see {@link splitMigrationStatements}) for
 * the destructive patterns in {@link BREAKING_CHANGE_RULES}. A single
 * statement can match more than one rule; every match is reported. */
export function scanStatementsForBreakingChanges(statements: string[]): BreakingMatch[] {
  const matches: BreakingMatch[] = [];
  statements.forEach((statement, statementIndex) => {
    for (const rule of BREAKING_CHANGE_RULES) {
      if (rule.pattern.test(statement)) {
        matches.push({ statementIndex, statement, rule: rule.name, description: rule.description });
      }
    }
  });
  return matches;
}

export interface PendingMigrationSql {
  tag: string;
  statements: string[];
}

export interface GuardViolation extends BreakingMatch {
  tag: string;
}

export interface ExpandContractGuardResult {
  /** True if the run may proceed: either no destructive statements were
   * found, or `allowBreaking` was set. `violations` is populated either way
   * so the caller can always log what was found/allowed. */
  ok: boolean;
  violations: GuardViolation[];
}

export function evaluateExpandContractGuard(
  pendingMigrations: PendingMigrationSql[],
  allowBreaking: boolean,
): ExpandContractGuardResult {
  const violations: GuardViolation[] = [];
  for (const migration of pendingMigrations) {
    for (const match of scanStatementsForBreakingChanges(migration.statements)) {
      violations.push({ ...match, tag: migration.tag });
    }
  }
  return { ok: allowBreaking || violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Phase sequencing / orchestration
// ---------------------------------------------------------------------------

export type ReleaseMigratePhase = "identity" | "lock" | "readiness" | "guard" | "migrate" | "verify";

export type LogLevel = "info" | "ok" | "warn" | "error";

export interface ReleaseMigrateLogLine {
  phase: ReleaseMigratePhase;
  level: LogLevel;
  message: string;
}

export interface ReleaseMigrateDeps {
  queryCurrentDatabase: () => Promise<string>;
  /** One attempt of `pg_try_advisory_lock` — the caller polls this. */
  tryAcquireLock: () => Promise<boolean>;
  /** Always called in a `finally`, even after a failure past this point. */
  releaseLock: () => Promise<void>;
  queryPgVersionNum: () => Promise<number>;
  /** `null` if no migration has ever been applied (fresh database / table
   * does not exist yet). */
  queryLastAppliedMigration: () => Promise<number | null>;
  readJournalEntries: () => Promise<JournalEntry[]>;
  readMigrationStatements: (tag: string) => Promise<string[]>;
  applyPendingMigrations: (pending: JournalEntry[]) => Promise<void>;
  queryAppliedMigrationCount: () => Promise<number>;
  runSmokeQuery: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (line: ReleaseMigrateLogLine) => void;
}

export interface ReleaseMigrateResult {
  ok: boolean;
  failedPhase: ReleaseMigratePhase | null;
  appliedTags: string[];
  message: string;
}

/**
 * The whole job, phase by phase, against injected dependencies. No real I/O
 * happens here — `release-migrate.mts` supplies the real Postgres-backed
 * `deps`; `web/tests/release-migrate.test.ts` supplies fakes. Guarantees:
 *
 *  - identity is checked before anything else (no lock, no queries beyond
 *    the identity query itself, run first);
 *  - the lock is acquired before readiness/guard/migrate/verify, and
 *    `releaseLock` is called exactly once, in a `finally`, whenever the
 *    lock was successfully acquired (never called if it was not, and never
 *    called twice);
 *  - a failure at any phase stops later phases from running.
 */
export async function runReleaseMigration(
  deps: ReleaseMigrateDeps,
  config: ReleaseMigrateConfig,
): Promise<ReleaseMigrateResult> {
  const fail = (phase: ReleaseMigratePhase, message: string): ReleaseMigrateResult => {
    deps.log({ phase, level: "error", message });
    return { ok: false, failedPhase: phase, appliedTags: [], message };
  };

  // --- Phase: identity ------------------------------------------------
  deps.log({ phase: "identity", level: "info", message: "Checking database identity..." });
  let actualDb: string;
  try {
    actualDb = await deps.queryCurrentDatabase();
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    return fail("identity", `Could not query database identity: ${messageText}`);
  }
  const identity = checkDatabaseIdentity(actualDb, config.expectedDatabaseName);
  if (!identity.ok) return fail("identity", identity.reason);
  deps.log({ phase: "identity", level: "ok", message: `Connected to expected database "${actualDb}".` });

  // --- Phase: lock ------------------------------------------------------
  deps.log({ phase: "lock", level: "info", message: "Acquiring release-migrate advisory lock..." });
  let locked = false;
  try {
    const deadline = deps.now() + config.lockTimeoutMs;
    // At least one attempt even if lockTimeoutMs is very small.
    do {
      locked = await deps.tryAcquireLock();
      if (locked) break;
      if (deps.now() >= deadline) break;
      await deps.sleep(config.lockPollIntervalMs);
    } while (deps.now() < deadline);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    return fail("lock", `Unexpected error while acquiring the advisory lock: ${messageText}`);
  }

  if (!locked) {
    return fail(
      "lock",
      `Timed out after ${config.lockTimeoutMs}ms waiting for the release-migrate advisory lock ` +
        `(key ${RELEASE_MIGRATE_LOCK_KEY}). Another release-migrate run is likely in progress.`,
    );
  }
  deps.log({ phase: "lock", level: "ok", message: "Lock acquired." });

  let currentPhase: ReleaseMigratePhase = "readiness";
  try {
    // --- Phase: readiness ------------------------------------------------
    deps.log({ phase: "readiness", level: "info", message: "Running readiness checks..." });

    const versionNum = await deps.queryPgVersionNum();
    const versionCheck = checkPgVersion(versionNum, config.minPgVersion);
    if (!versionCheck.ok) return fail("readiness", versionCheck.reason);

    const lastApplied = await deps.queryLastAppliedMigration();
    const journalEntries = await deps.readJournalEntries();
    const stateCheck = checkNoForeignMigrationState(lastApplied, journalEntries);
    if (!stateCheck.ok) return fail("readiness", stateCheck.reason);

    deps.log({
      phase: "readiness",
      level: "ok",
      message: `Postgres ${versionCheck.major} reachable; migrations journal state is consistent.`,
    });

    // --- Phase: guard ------------------------------------------------------
    currentPhase = "guard";
    const pending = selectPendingMigrations(journalEntries, lastApplied);
    deps.log({
      phase: "guard",
      level: "info",
      message:
        pending.length === 0
          ? "No pending migrations to scan."
          : `Scanning ${pending.length} pending migration(s) for destructive statements...`,
    });

    const pendingWithStatements: PendingMigrationSql[] = await Promise.all(
      pending.map(async (entry) => ({ tag: entry.tag, statements: await deps.readMigrationStatements(entry.tag) })),
    );
    const guard = evaluateExpandContractGuard(pendingWithStatements, config.allowBreaking);

    for (const violation of guard.violations) {
      deps.log({
        phase: "guard",
        level: guard.ok ? "warn" : "error",
        message:
          `${violation.tag} statement #${violation.statementIndex} (${violation.rule}, ${violation.description}): ` +
          `${violation.statement.slice(0, 200)}${violation.statement.length > 200 ? "…" : ""}`,
      });
    }

    if (!guard.ok) {
      return fail(
        "guard",
        `Expand-contract guard refused ${guard.violations.length} destructive statement(s) across ` +
          `${new Set(guard.violations.map((violation) => violation.tag)).size} pending migration(s). ` +
          `Re-run with --allow-breaking (or RELEASE_MIGRATE_ALLOW_BREAKING=1) to override.`,
      );
    }
    deps.log({
      phase: "guard",
      level: "ok",
      message:
        guard.violations.length > 0
          ? `${guard.violations.length} destructive statement(s) allowed through via --allow-breaking.`
          : "No destructive statements found.",
    });

    // --- Phase: migrate ------------------------------------------------------
    currentPhase = "migrate";
    if (pending.length > 0) {
      deps.log({
        phase: "migrate",
        level: "info",
        message: `Applying ${pending.length} migration(s): ${pending.map((entry) => entry.tag).join(", ")}`,
      });
      await deps.applyPendingMigrations(pending);
      deps.log({ phase: "migrate", level: "ok", message: "Migrations applied." });
    } else {
      deps.log({ phase: "migrate", level: "ok", message: "Nothing to apply; database already up to date." });
    }

    // --- Phase: verify ------------------------------------------------------
    currentPhase = "verify";
    deps.log({ phase: "verify", level: "info", message: "Verifying post-migration state..." });
    const appliedCount = await deps.queryAppliedMigrationCount();
    if (appliedCount < journalEntries.length) {
      return fail(
        "verify",
        `Post-migration verification failed: migrations journal table has ${appliedCount} row(s), ` +
          `expected at least ${journalEntries.length} (one per file in db/migrations/).`,
      );
    }
    await deps.runSmokeQuery();
    deps.log({
      phase: "verify",
      level: "ok",
      message: `Journal has ${appliedCount} row(s) recorded; smoke query succeeded.`,
    });

    return {
      ok: true,
      failedPhase: null,
      appliedTags: pending.map((entry) => entry.tag),
      message: "Release migration completed successfully.",
    };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    return fail(currentPhase, `Unexpected error during "${currentPhase}": ${messageText}`);
  } finally {
    await deps.releaseLock();
    deps.log({ phase: "lock", level: "info", message: "Lock released." });
  }
}
