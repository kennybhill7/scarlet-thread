/**
 * RELEASEJOB-001 — unit tests for `web/scripts/lib/releaseMigrate.ts`.
 *
 * Everything here runs against dependency-injected fakes, the same
 * `SessionDeps`/`ClimbDataDeps` pattern `web/app/(app)/page.tsx` already
 * uses (see that file). No live Postgres connection is opened anywhere in
 * this file. The things that genuinely need a live database — the advisory
 * lock actually blocking a concurrent second process, the real drizzle
 * migrator actually applying SQL, the identity check actually refusing a
 * mismatched database connection — are out of reach for `node:test` here
 * and are instead covered by the manual procedure in
 * `web/tests/README-release-migrate.md`, following the precedent
 * `web/tests/README-db-invariants.md` already set for this class of thing.
 *
 * Author: Kenneth Hill
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  BREAKING_CHANGE_RULES,
  DEFAULT_LOCK_POLL_INTERVAL_MS,
  DEFAULT_LOCK_TIMEOUT_MS,
  DEFAULT_MIN_PG_VERSION,
  checkDatabaseIdentity,
  checkNoForeignMigrationState,
  checkPgVersion,
  evaluateExpandContractGuard,
  parseReleaseMigrateConfig,
  runReleaseMigration,
  scanStatementsForBreakingChanges,
  selectPendingMigrations,
  splitMigrationStatements,
  type JournalEntry,
  type ReleaseMigrateConfig,
  type ReleaseMigrateDeps,
  type ReleaseMigrateLogLine,
  type ReleaseMigratePhase,
} from "../scripts/lib/releaseMigrate";

// ===========================================================================
// parseReleaseMigrateConfig — CLI flag / env-var parsing
// ===========================================================================

test("CONFIG: flags populate every field, env vars are ignored when a flag is present", () => {
  const result = parseReleaseMigrateConfig(
    [
      "--database-url=postgres://flag",
      "--expected-db=flag-db",
      "--allow-breaking",
      "--lock-timeout-ms=5000",
      "--min-pg-version=16",
    ],
    {
      DATABASE_URL: "postgres://env",
      RELEASE_MIGRATE_EXPECTED_DB: "env-db",
      RELEASE_MIGRATE_ALLOW_BREAKING: "0",
      RELEASE_MIGRATE_LOCK_TIMEOUT_MS: "1",
      RELEASE_MIGRATE_MIN_PG_VERSION: "1",
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.config, {
    databaseUrl: "postgres://flag",
    expectedDatabaseName: "flag-db",
    allowBreaking: true,
    lockTimeoutMs: 5000,
    lockPollIntervalMs: DEFAULT_LOCK_POLL_INTERVAL_MS,
    minPgVersion: 16,
  } satisfies ReleaseMigrateConfig);
});

test("CONFIG: falls back to env vars when no flags are given", () => {
  const result = parseReleaseMigrateConfig([], {
    DATABASE_URL: "postgres://env",
    RELEASE_MIGRATE_EXPECTED_DB: "env-db",
    RELEASE_MIGRATE_ALLOW_BREAKING: "true",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.config.databaseUrl, "postgres://env");
  assert.equal(result.config.expectedDatabaseName, "env-db");
  assert.equal(result.config.allowBreaking, true);
  assert.equal(result.config.lockTimeoutMs, DEFAULT_LOCK_TIMEOUT_MS);
  assert.equal(result.config.minPgVersion, DEFAULT_MIN_PG_VERSION);
});

test("CONFIG: defaults apply when nothing at all is configured (except the required DB URL)", () => {
  const result = parseReleaseMigrateConfig([], { DATABASE_URL: "postgres://env" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.config.expectedDatabaseName, undefined);
  assert.equal(result.config.allowBreaking, false);
  assert.equal(result.config.lockTimeoutMs, DEFAULT_LOCK_TIMEOUT_MS);
  assert.equal(result.config.minPgVersion, DEFAULT_MIN_PG_VERSION);
});

test("CONFIG: a missing database URL is a parse error, not a silently-empty string", () => {
  const result = parseReleaseMigrateConfig([], {});
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((error) => error.includes("database connection string")));
});

test("CONFIG: a non-numeric or non-positive --lock-timeout-ms is rejected with a clear error", () => {
  const nonNumeric = parseReleaseMigrateConfig(
    ["--database-url=postgres://x", "--lock-timeout-ms=soon"],
    {},
  );
  assert.equal(nonNumeric.ok, false);
  if (nonNumeric.ok) return;
  assert.ok(nonNumeric.errors.some((error) => error.includes("--lock-timeout-ms")));

  const negative = parseReleaseMigrateConfig(["--database-url=postgres://x", "--lock-timeout-ms=-5"], {});
  assert.equal(negative.ok, false);

  const zero = parseReleaseMigrateConfig(["--database-url=postgres://x", "--lock-timeout-ms=0"], {});
  assert.equal(zero.ok, false);
});

test("CONFIG: --expected-db as a space-separated flag value is read the same as --flag=value", () => {
  const result = parseReleaseMigrateConfig(
    ["--database-url=postgres://x", "--expected-db", "my-db"],
    {},
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.config.expectedDatabaseName, "my-db");
});

// ===========================================================================
// checkDatabaseIdentity — fails closed
// ===========================================================================

test("IDENTITY: matching database name passes", () => {
  assert.deepEqual(checkDatabaseIdentity("scarlet_thread_prod", "scarlet_thread_prod"), {
    ok: true,
    actual: "scarlet_thread_prod",
  });
});

test("IDENTITY: an unset expected value FAILS CLOSED via the 'not configured' reason specifically, not a coincidental mismatch", () => {
  const result = checkDatabaseIdentity("scarlet_thread_prod", undefined);
  assert.equal(result.ok, false);
  if (result.ok) return;
  // Deliberately distinguishes "no expected value was configured at all" from
  // "a value was configured and it didn't match" -- these are different
  // failure modes with different reasons, and a mutant that only handles the
  // second (e.g. `actual !== expected` where `expected` is `undefined`) must
  // not be able to pass this by accident.
  assert.ok(
    result.reason.includes("No expected database identity configured"),
    `expected the 'not configured' reason, got: ${result.reason}`,
  );
  assert.ok(!result.reason.includes("mismatch"));
});

test("IDENTITY: an empty-string expected value also fails closed via the 'not configured' reason", () => {
  const result = checkDatabaseIdentity("scarlet_thread_prod", "");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.reason.includes("No expected database identity configured"));
});

test("IDENTITY: a mismatched database name fails, with both names named in the reason", () => {
  const result = checkDatabaseIdentity("scarlet_thread_preview", "scarlet_thread_prod");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.reason.includes("scarlet_thread_preview"));
  assert.ok(result.reason.includes("scarlet_thread_prod"));
});

test("IDENTITY: comparison is exact and case-sensitive, not normalised", () => {
  const result = checkDatabaseIdentity("Scarlet_Thread_Prod", "scarlet_thread_prod");
  assert.equal(result.ok, false);
});

// ===========================================================================
// checkPgVersion
// ===========================================================================

test("PG VERSION: server_version_num is decoded to a major version and compared against the floor", () => {
  assert.deepEqual(checkPgVersion(160003, 14), { ok: true, major: 16 });
  assert.deepEqual(checkPgVersion(140001, 14), { ok: true, major: 14 });
});

test("PG VERSION: below the configured floor fails with the decoded major version named", () => {
  const result = checkPgVersion(130005, 14);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.reason.includes("13"));
  assert.ok(result.reason.includes("14"));
});

// ===========================================================================
// checkNoForeignMigrationState
// ===========================================================================

const journal: JournalEntry[] = [
  { tag: "0000_solid_mojo", when: 1000 },
  { tag: "0001_deep_quasimodo", when: 2000 },
  { tag: "0002_magical_stranger", when: 3000 },
];

test("FOREIGN STATE: null last-applied (fresh database) is fine", () => {
  assert.deepEqual(checkNoForeignMigrationState(null, journal), { ok: true });
});

test("FOREIGN STATE: a last-applied timestamp matching a known migration is fine", () => {
  assert.deepEqual(checkNoForeignMigrationState(2000, journal), { ok: true });
});

test("FOREIGN STATE: a last-applied timestamp matching NO known migration is refused", () => {
  const result = checkNoForeignMigrationState(2500, journal);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.reason.includes("2500"));
});

// ===========================================================================
// selectPendingMigrations
// ===========================================================================

test("PENDING: everything is pending when nothing has been applied", () => {
  assert.deepEqual(selectPendingMigrations(journal, null), journal);
});

test("PENDING: only entries strictly newer than the last-applied timestamp are pending", () => {
  assert.deepEqual(selectPendingMigrations(journal, 2000), [{ tag: "0002_magical_stranger", when: 3000 }]);
});

test("PENDING: nothing is pending once caught up to the newest entry", () => {
  assert.deepEqual(selectPendingMigrations(journal, 3000), []);
});

// ===========================================================================
// splitMigrationStatements
// ===========================================================================

test("SPLIT: statements are split on the literal breakpoint marker and trimmed", () => {
  const sql = `CREATE TABLE "a" (id int);
--> statement-breakpoint
CREATE TABLE "b" (id int);
--> statement-breakpoint
  `;
  assert.deepEqual(splitMigrationStatements(sql), [
    'CREATE TABLE "a" (id int);',
    'CREATE TABLE "b" (id int);',
  ]);
});

test("SPLIT: a single-statement file with no breakpoint marker returns one statement", () => {
  assert.deepEqual(splitMigrationStatements('CREATE TABLE "a" (id int);'), ['CREATE TABLE "a" (id int);']);
});

// ===========================================================================
// scanStatementsForBreakingChanges — every rule fires, benign SQL does not
// ===========================================================================

test("SCAN: every documented breaking-change rule fires on its own representative statement", () => {
  const fixtures: Record<string, string> = {
    DROP_TABLE: 'DROP TABLE "entries";',
    DROP_COLUMN: 'ALTER TABLE "entries" DROP COLUMN "body";',
    ALTER_COLUMN_TYPE: 'ALTER TABLE "entries" ALTER COLUMN "body" TYPE varchar(10);',
    DROP_CONSTRAINT: 'ALTER TABLE "entries" DROP CONSTRAINT "entries_pkey";',
  };

  for (const rule of BREAKING_CHANGE_RULES) {
    const fixture = fixtures[rule.name];
    assert.ok(fixture, `no fixture written for rule ${rule.name} -- add one so this test actually covers it`);
    const matches = scanStatementsForBreakingChanges([fixture]);
    assert.ok(
      matches.some((match) => match.rule === rule.name),
      `rule ${rule.name} did not fire on its own fixture: ${fixture}`,
    );
  }
});

test("SCAN: an ordinary additive statement matches nothing", () => {
  const matches = scanStatementsForBreakingChanges([
    'CREATE TABLE "widgets" ("id" uuid PRIMARY KEY, "name" text NOT NULL);',
    'ALTER TABLE "widgets" ADD COLUMN "note" text;',
    'CREATE INDEX "widgets_name_idx" ON "widgets" ("name");',
  ]);
  assert.deepEqual(matches, []);
});

test("SCAN: a statement can trip more than one rule, and both are reported", () => {
  // Contrived, but exercises that matches are not deduplicated to one per statement.
  const matches = scanStatementsForBreakingChanges([
    'ALTER TABLE "x" DROP CONSTRAINT "x_fk"; -- and also ALTER COLUMN "y" TYPE int',
  ]);
  const rules = matches.map((match) => match.rule);
  assert.ok(rules.includes("DROP_CONSTRAINT"));
  assert.ok(rules.includes("ALTER_COLUMN_TYPE"));
});

test("SCAN: reports the correct statementIndex within a multi-statement migration", () => {
  const statements = [
    'CREATE TABLE "a" (id int);',
    'DROP TABLE "b";',
    'CREATE TABLE "c" (id int);',
  ];
  const matches = scanStatementsForBreakingChanges(statements);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].statementIndex, 1);
  assert.equal(matches[0].statement, 'DROP TABLE "b";');
});

// ===========================================================================
// evaluateExpandContractGuard
// ===========================================================================

test("GUARD: no destructive statements anywhere -> ok, no violations", () => {
  const result = evaluateExpandContractGuard(
    [{ tag: "0011_add_widgets", statements: ['CREATE TABLE "widgets" (id int);'] }],
    false,
  );
  assert.deepEqual(result, { ok: true, violations: [] });
});

test("GUARD: a destructive statement without --allow-breaking is refused", () => {
  const result = evaluateExpandContractGuard(
    [{ tag: "0011_drop_widgets", statements: ['DROP TABLE "widgets";'] }],
    false,
  );
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].tag, "0011_drop_widgets");
  assert.equal(result.violations[0].rule, "DROP_TABLE");
});

test("GUARD: the same destructive statement IS allowed through with allowBreaking=true, and still reported", () => {
  const result = evaluateExpandContractGuard(
    [{ tag: "0011_drop_widgets", statements: ['DROP TABLE "widgets";'] }],
    true,
  );
  assert.equal(result.ok, true);
  // Still surfaced, so the caller can log exactly what was allowed through.
  assert.equal(result.violations.length, 1);
});

test("GUARD: violations across multiple pending migrations are all collected, each tagged correctly", () => {
  const result = evaluateExpandContractGuard(
    [
      { tag: "0011_a", statements: ['DROP TABLE "a";'] },
      { tag: "0012_b", statements: ['CREATE TABLE "b" (id int);'] },
      { tag: "0013_c", statements: ['ALTER TABLE "c" DROP COLUMN "x";'] },
    ],
    false,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.violations.map((violation) => violation.tag),
    ["0011_a", "0013_c"],
  );
});

// ===========================================================================
// runReleaseMigration — phase sequencing, all against fake deps
// ===========================================================================

/** A minimal, deterministic clock: `now()` advances by a fixed step every
 * call so a bounded poll loop in the lock phase terminates in these tests
 * without any real `setTimeout` delay. */
function makeFakeClock(stepMs: number) {
  let value = 0;
  return {
    now: () => {
      const current = value;
      value += stepMs;
      return current;
    },
  };
}

interface FakeDepsOptions {
  currentDatabase?: string;
  lockSequence?: boolean[]; // results of successive tryAcquireLock() calls
  pgVersionNum?: number;
  lastApplied?: number | null;
  journalEntries?: JournalEntry[];
  migrationStatements?: Record<string, string[]>;
  appliedCountAfterMigrate?: number;
  throwOn?: Partial<Record<keyof ReleaseMigrateDeps, Error>>;
}

interface FakeDepsHandle {
  deps: ReleaseMigrateDeps;
  calls: string[];
  logs: ReleaseMigrateLogLine[];
  releaseLockCallCount: () => number;
}

function makeFakeDeps(options: FakeDepsOptions = {}): FakeDepsHandle {
  const calls: string[] = [];
  const logs: ReleaseMigrateLogLine[] = [];
  let lockCallIndex = 0;
  let releaseLockCalls = 0;
  const lockSequence = options.lockSequence ?? [true];
  const journalEntries = options.journalEntries ?? journal;
  const migrationStatements = options.migrationStatements ?? {};
  const throwOn = options.throwOn ?? {};

  function maybeThrow(name: keyof ReleaseMigrateDeps) {
    const error = throwOn[name];
    if (error) throw error;
  }

  const deps: ReleaseMigrateDeps = {
    queryCurrentDatabase: async () => {
      calls.push("queryCurrentDatabase");
      maybeThrow("queryCurrentDatabase");
      return options.currentDatabase ?? "scarlet_thread_prod";
    },
    tryAcquireLock: async () => {
      calls.push("tryAcquireLock");
      maybeThrow("tryAcquireLock");
      const result = lockSequence[Math.min(lockCallIndex, lockSequence.length - 1)];
      lockCallIndex += 1;
      return result;
    },
    releaseLock: async () => {
      calls.push("releaseLock");
      releaseLockCalls += 1;
    },
    queryPgVersionNum: async () => {
      calls.push("queryPgVersionNum");
      maybeThrow("queryPgVersionNum");
      return options.pgVersionNum ?? 160003;
    },
    queryLastAppliedMigration: async () => {
      calls.push("queryLastAppliedMigration");
      maybeThrow("queryLastAppliedMigration");
      return options.lastApplied === undefined ? 3000 : options.lastApplied;
    },
    readJournalEntries: async () => {
      calls.push("readJournalEntries");
      maybeThrow("readJournalEntries");
      return journalEntries;
    },
    readMigrationStatements: async (tag: string) => {
      calls.push(`readMigrationStatements:${tag}`);
      maybeThrow("readMigrationStatements");
      return migrationStatements[tag] ?? ['CREATE TABLE "noop" (id int);'];
    },
    applyPendingMigrations: async () => {
      calls.push("applyPendingMigrations");
      maybeThrow("applyPendingMigrations");
    },
    queryAppliedMigrationCount: async () => {
      calls.push("queryAppliedMigrationCount");
      maybeThrow("queryAppliedMigrationCount");
      return options.appliedCountAfterMigrate ?? journalEntries.length;
    },
    runSmokeQuery: async () => {
      calls.push("runSmokeQuery");
      maybeThrow("runSmokeQuery");
    },
    sleep: async () => {
      calls.push("sleep");
    },
    now: makeFakeClock(500).now,
    log: (line: ReleaseMigrateLogLine) => {
      logs.push(line);
    },
  };

  return { deps, calls, logs, releaseLockCallCount: () => releaseLockCalls };
}

function baseConfig(overrides: Partial<ReleaseMigrateConfig> = {}): ReleaseMigrateConfig {
  return {
    databaseUrl: "postgres://fake",
    expectedDatabaseName: "scarlet_thread_prod",
    allowBreaking: false,
    lockTimeoutMs: DEFAULT_LOCK_TIMEOUT_MS,
    lockPollIntervalMs: DEFAULT_LOCK_POLL_INTERVAL_MS,
    minPgVersion: DEFAULT_MIN_PG_VERSION,
    ...overrides,
  };
}

test("ORCHESTRATION: happy path with nothing pending runs every phase in order and releases the lock once", async () => {
  const { deps, calls, releaseLockCallCount } = makeFakeDeps({ lastApplied: 3000 });
  const result = await runReleaseMigration(deps, baseConfig());

  assert.equal(result.ok, true);
  assert.equal(result.failedPhase, null);
  assert.deepEqual(result.appliedTags, []);
  assert.equal(releaseLockCallCount(), 1);

  const order = calls.filter((call) =>
    ["queryCurrentDatabase", "tryAcquireLock", "queryPgVersionNum", "applyPendingMigrations", "queryAppliedMigrationCount", "runSmokeQuery", "releaseLock"].includes(
      call,
    ),
  );
  assert.deepEqual(order, [
    "queryCurrentDatabase",
    "tryAcquireLock",
    "queryPgVersionNum",
    "queryAppliedMigrationCount",
    "runSmokeQuery",
    "releaseLock",
  ]);
  // Nothing pending -> the real migrator is never invoked.
  assert.ok(!calls.includes("applyPendingMigrations"));
});

test("ORCHESTRATION: happy path WITH pending migrations applies them and reports the tags", async () => {
  const { deps, calls } = makeFakeDeps({ lastApplied: 2000, appliedCountAfterMigrate: 3 });
  const result = await runReleaseMigration(deps, baseConfig());

  assert.equal(result.ok, true);
  assert.deepEqual(result.appliedTags, ["0002_magical_stranger"]);
  assert.ok(calls.includes("applyPendingMigrations"));
  // The migrate phase must come after the guard scan and before verify.
  const migrateIndex = calls.indexOf("applyPendingMigrations");
  const scanIndex = calls.indexOf("readMigrationStatements:0002_magical_stranger");
  const verifyIndex = calls.indexOf("queryAppliedMigrationCount");
  assert.ok(scanIndex !== -1 && scanIndex < migrateIndex, "guard scan must run before migrate");
  assert.ok(migrateIndex < verifyIndex, "migrate must run before verify");
});

test("ORCHESTRATION: identity failure stops everything before the lock is even attempted", async () => {
  const { deps, calls, releaseLockCallCount } = makeFakeDeps({ currentDatabase: "wrong_db" });
  const result = await runReleaseMigration(deps, baseConfig());

  assert.equal(result.ok, false);
  assert.equal(result.failedPhase, "identity");
  assert.ok(!calls.includes("tryAcquireLock"), "the lock must never be attempted after an identity failure");
  assert.equal(releaseLockCallCount(), 0, "a lock that was never acquired must never be released");
});

test("ORCHESTRATION: an unconfigured expected-db also fails closed at the identity phase", async () => {
  const { deps, calls } = makeFakeDeps();
  const result = await runReleaseMigration(deps, baseConfig({ expectedDatabaseName: undefined }));

  assert.equal(result.ok, false);
  assert.equal(result.failedPhase, "identity");
  assert.ok(!calls.includes("tryAcquireLock"));
});

test("ORCHESTRATION: the lock is retried until it succeeds, polling with sleep in between", async () => {
  const { deps, calls } = makeFakeDeps({ lockSequence: [false, false, true] });
  const result = await runReleaseMigration(deps, baseConfig());

  assert.equal(result.ok, true);
  const acquireCalls = calls.filter((call) => call === "tryAcquireLock").length;
  assert.equal(acquireCalls, 3);
  const sleepCalls = calls.filter((call) => call === "sleep").length;
  assert.equal(sleepCalls, 2, "must sleep between failed lock attempts, but not after the final success");
});

test("ORCHESTRATION: a lock that never succeeds times out with a distinct phase/message, and readiness never runs", async () => {
  const { deps, calls, releaseLockCallCount } = makeFakeDeps({ lockSequence: [false] });
  const result = await runReleaseMigration(deps, baseConfig({ lockTimeoutMs: 1000 }));

  assert.equal(result.ok, false);
  assert.equal(result.failedPhase, "lock");
  assert.ok(result.message.toLowerCase().includes("timed out"));
  assert.ok(!calls.includes("queryPgVersionNum"), "readiness must never run if the lock was never acquired");
  assert.equal(releaseLockCallCount(), 0, "a lock that was never acquired must never be released");
});

test("ORCHESTRATION: a readiness failure (old Postgres) still releases the lock, and never reaches guard/migrate", async () => {
  const { deps, calls, releaseLockCallCount } = makeFakeDeps({ pgVersionNum: 130001 });
  const result = await runReleaseMigration(deps, baseConfig({ minPgVersion: 14 }));

  assert.equal(result.ok, false);
  assert.equal(result.failedPhase, "readiness");
  assert.equal(releaseLockCallCount(), 1, "the lock WAS acquired, so it must still be released");
  assert.ok(!calls.some((call) => call.startsWith("readMigrationStatements")), "guard must never run");
  assert.ok(!calls.includes("applyPendingMigrations"), "migrate must never run");
});

test("ORCHESTRATION: a foreign/unrecognised migration-journal state fails readiness and releases the lock", async () => {
  const { deps, releaseLockCallCount } = makeFakeDeps({ lastApplied: 9999 });
  const result = await runReleaseMigration(deps, baseConfig());

  assert.equal(result.ok, false);
  assert.equal(result.failedPhase, "readiness");
  assert.equal(releaseLockCallCount(), 1);
});

test("ORCHESTRATION: a destructive pending migration without --allow-breaking is refused at the guard phase", async () => {
  const { deps, calls, releaseLockCallCount } = makeFakeDeps({
    lastApplied: 2000,
    migrationStatements: { "0002_magical_stranger": ['DROP TABLE "widgets";'] },
  });
  const result = await runReleaseMigration(deps, baseConfig({ allowBreaking: false }));

  assert.equal(result.ok, false);
  assert.equal(result.failedPhase, "guard");
  assert.ok(!calls.includes("applyPendingMigrations"), "migrate must never run once the guard refuses");
  assert.equal(releaseLockCallCount(), 1);
});

test("ORCHESTRATION: the same destructive pending migration proceeds when --allow-breaking is set", async () => {
  const { deps, calls } = makeFakeDeps({
    lastApplied: 2000,
    appliedCountAfterMigrate: 3,
    migrationStatements: { "0002_magical_stranger": ['DROP TABLE "widgets";'] },
  });
  const result = await runReleaseMigration(deps, baseConfig({ allowBreaking: true }));

  assert.equal(result.ok, true);
  assert.ok(calls.includes("applyPendingMigrations"));
});

test("ORCHESTRATION: post-migration verification failure (journal under-count) fails the verify phase", async () => {
  const { deps, releaseLockCallCount } = makeFakeDeps({ lastApplied: 2000, appliedCountAfterMigrate: 1 });
  const result = await runReleaseMigration(deps, baseConfig());

  assert.equal(result.ok, false);
  assert.equal(result.failedPhase, "verify");
  assert.equal(releaseLockCallCount(), 1);
});

test("ORCHESTRATION: an unexpected thrown error mid-run is caught, attributed to the right phase, and still releases the lock", async () => {
  const { deps, releaseLockCallCount } = makeFakeDeps({
    lastApplied: 2000,
    throwOn: { applyPendingMigrations: new Error("connection reset by peer") },
  });
  const result = await runReleaseMigration(deps, baseConfig());

  assert.equal(result.ok, false);
  assert.equal(result.failedPhase, "migrate");
  assert.ok(result.message.includes("connection reset by peer"));
  assert.equal(releaseLockCallCount(), 1, "the lock must still be released after an unexpected mid-run error");
});

test("ORCHESTRATION: a smoke-query failure at verify time is a real failure, not swallowed", async () => {
  const { deps } = makeFakeDeps({
    lastApplied: 3000,
    throwOn: { runSmokeQuery: new Error('relation "stages" does not exist') },
  });
  const result = await runReleaseMigration(deps, baseConfig());

  assert.equal(result.ok, false);
  assert.equal(result.failedPhase, "verify");
});

test("ORCHESTRATION: releaseLock is called exactly once even on a fully successful run (not zero, not twice)", async () => {
  const { deps, releaseLockCallCount } = makeFakeDeps({ lastApplied: 3000 });
  await runReleaseMigration(deps, baseConfig());
  assert.equal(releaseLockCallCount(), 1);
});

// Named, standalone phase-order assertion (kept separate from the happy-path
// test above so a regression in phase ORDER specifically fails a
// self-describing test rather than a generic happy-path assertion).
test("ORCHESTRATION: readiness always runs strictly before guard, which runs strictly before migrate, which runs strictly before verify", async () => {
  const { deps, calls } = makeFakeDeps({ lastApplied: 2000, appliedCountAfterMigrate: 3 });
  await runReleaseMigration(deps, baseConfig());

  const readinessIndex = calls.indexOf("queryPgVersionNum");
  const guardIndex = calls.indexOf("readMigrationStatements:0002_magical_stranger");
  const migrateIndex = calls.indexOf("applyPendingMigrations");
  const verifyIndex = calls.indexOf("queryAppliedMigrationCount");

  assert.ok(readinessIndex < guardIndex);
  assert.ok(guardIndex < migrateIndex);
  assert.ok(migrateIndex < verifyIndex);
});

// Small type-level sanity check that ReleaseMigratePhase covers exactly the
// phases the orchestrator actually names in ReleaseMigrateResult.failedPhase.
test("TYPES: every phase name used in tests above is a valid ReleaseMigratePhase", () => {
  const phases: ReleaseMigratePhase[] = ["identity", "lock", "readiness", "guard", "migrate", "verify"];
  assert.equal(phases.length, 6);
});
