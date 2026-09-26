/**
 * RELEASEOPS-001 — unit tests for `scripts/lib/migrationDrift.ts`.
 *
 * Everything runs on fixtures and an injected fake `query`; no database is
 * opened. One test additionally cross-checks the hashing against drizzle-orm's
 * own `readMigrationFiles` over the real `db/migrations` folder, so the
 * "hash = what drizzle records" claim is proven, not assumed.
 *
 * Author: Kenneth Hill
 */
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readMigrationFiles } from "drizzle-orm/migrator";

import {
  APPLIED_MIGRATIONS_SQL,
  buildExpectedMigrations,
  checkMigrationDrift,
  compareMigrations,
  driftExitCode,
  fetchAppliedMigrations,
  formatDriftReport,
  hashMigrationSql,
  hashMigrationSqlLf,
  normalizeAppliedRows,
  type AppliedMigration,
  type ExpectedMigration,
  type QueryFn,
} from "../scripts/lib/migrationDrift";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fixtureExpected(count: number): ExpectedMigration[] {
  return Array.from({ length: count }, (_, idx) => {
    const sql = `-- migration ${idx}\nCREATE TABLE t${idx} (id int);\n`;
    return {
      idx,
      tag: `000${idx}_fixture`,
      when: 1_000 + idx * 100,
      hash: hashMigrationSql(sql),
      lfHash: hashMigrationSqlLf(sql),
    };
  });
}

function appliedFrom(expected: ExpectedMigration[]): AppliedMigration[] {
  return expected.map((entry, index) => ({ id: index + 1, hash: entry.hash, createdAt: entry.when }));
}

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

// ---------------------------------------------------------------------------
// compareMigrations
// ---------------------------------------------------------------------------

test("IN SYNC: identical sets report ok, zero findings, exit 0", () => {
  const expected = fixtureExpected(4);
  const report = compareMigrations(expected, appliedFrom(expected));
  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.behindTags, []);
  assert.equal(driftExitCode(report), 0);
  assert.match(formatDriftReport(report), /RESULT: in sync/);
});

test("BEHIND: DB missing the newest N migrations is drift, lists exactly those tags, exit 1", () => {
  const expected = fixtureExpected(6);
  const report = compareMigrations(expected, appliedFrom(expected.slice(0, 3)));
  assert.equal(report.ok, false);
  assert.deepEqual(report.behindTags, ["0003_fixture", "0004_fixture", "0005_fixture"]);
  assert.deepEqual(
    report.findings.map((finding) => finding.kind),
    ["behind", "behind", "behind"],
  );
  assert.equal(driftExitCode(report), 1);
  assert.match(formatDriftReport(report), /DRIFT \[behind\] 0003_fixture/);
});

test("BEHIND: empty applied set (fresh DB) makes everything behind", () => {
  const expected = fixtureExpected(3);
  const report = compareMigrations(expected, []);
  assert.equal(report.behindTags.length, 3);
  assert.equal(report.ok, false);
});

test("AHEAD: an applied row the repo does not know is drift", () => {
  const expected = fixtureExpected(3);
  const applied = [
    ...appliedFrom(expected),
    { id: 4, hash: "f".repeat(64), createdAt: 999_999 },
  ];
  const report = compareMigrations(expected, applied);
  assert.equal(report.ok, false);
  assert.deepEqual(
    report.findings.map((finding) => finding.kind),
    ["ahead"],
  );
  assert.equal(report.findings[0].appliedCreatedAt, 999_999);
});

test("HASH MISMATCH: same created_at, different hash is reported (and not double-reported as behind/ahead)", () => {
  const expected = fixtureExpected(3);
  const applied = appliedFrom(expected);
  applied[1] = { ...applied[1], hash: "a".repeat(64) };
  const report = compareMigrations(expected, applied);
  assert.equal(report.ok, false);
  assert.deepEqual(
    report.findings.map((finding) => finding.kind),
    ["hash_mismatch"],
  );
  assert.equal(report.findings[0].tag, "0001_fixture");
  assert.deepEqual(report.behindTags, []);
  assert.equal(driftExitCode(report), 1);
});

test("HASH MISMATCH: counts match yet drift is still detected (count alone is not enough)", () => {
  const expected = fixtureExpected(3);
  const applied = appliedFrom(expected);
  applied[2] = { ...applied[2], hash: "b".repeat(64) };
  assert.equal(applied.length, expected.length);
  assert.equal(compareMigrations(expected, applied).ok, false);
});

test("LINE ENDINGS: applied hash equal to the LF-normalised file hash is a warning, not drift", () => {
  const lfSql = "CREATE TABLE a (id int);\nCREATE TABLE b (id int);\n";
  const crlfSql = lfSql.replace(/\n/g, "\r\n");
  const expected: ExpectedMigration[] = [
    { idx: 0, tag: "0000_le", when: 5, hash: hashMigrationSql(crlfSql), lfHash: hashMigrationSqlLf(crlfSql) },
  ];
  const applied: AppliedMigration[] = [{ id: 1, hash: hashMigrationSql(lfSql), createdAt: 5 }];
  const report = compareMigrations(expected, applied);
  assert.equal(report.ok, true);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0].message, /CRLF/);
});

test("GAP: an unapplied migration older than an applied one is flagged as a gap, not plain behind", () => {
  const expected = fixtureExpected(4);
  const applied = appliedFrom([expected[0], expected[2], expected[3]]); // 0001 missing
  const report = compareMigrations(expected, applied);
  assert.equal(report.ok, false);
  assert.deepEqual(
    report.findings.map((finding) => [finding.kind, finding.tag]),
    [["gap", "0001_fixture"]],
  );
});

test("GAP vs BEHIND: only entries newer than the newest applied are plain behind", () => {
  const expected = fixtureExpected(5);
  const applied = appliedFrom([expected[0], expected[2]]); // 0001 gap; 0003,0004 behind
  const kinds = compareMigrations(expected, applied).findings.map((finding) => `${finding.kind}:${finding.tag}`);
  assert.deepEqual(kinds, ["gap:0001_fixture", "behind:0003_fixture", "behind:0004_fixture"]);
});

test("TIMESTAMP MISMATCH: right hash, wrong created_at is drift", () => {
  const expected = fixtureExpected(2);
  const applied = appliedFrom(expected);
  applied[0] = { ...applied[0], createdAt: 12_345 };
  const kinds = compareMigrations(expected, applied).findings.map((finding) => finding.kind);
  assert.ok(kinds.includes("timestamp_mismatch"));
});

test("DUPLICATE: the same hash recorded twice is drift", () => {
  const expected = fixtureExpected(2);
  const applied = [...appliedFrom(expected), { id: 3, hash: expected[0].hash, createdAt: expected[0].when }];
  const kinds = compareMigrations(expected, applied).findings.map((finding) => finding.kind);
  assert.ok(kinds.includes("duplicate_applied"));
});

test("a realistic incident: DB 7 behind (the 2026-09-17 shape) reports exactly 7 behind tags", () => {
  const expected = fixtureExpected(13);
  const report = compareMigrations(expected, appliedFrom(expected.slice(0, 6)));
  assert.equal(report.behindTags.length, 7);
  assert.equal(report.findings.filter((finding) => finding.kind === "behind").length, 7);
  assert.equal(driftExitCode(report), 1);
});

// ---------------------------------------------------------------------------
// normalizeAppliedRows / fetchAppliedMigrations (injected, read-only query)
// ---------------------------------------------------------------------------

test("normalizeAppliedRows: bigint-as-string created_at becomes a number; junk becomes null", () => {
  const rows = normalizeAppliedRows([
    { id: 1, hash: "h1", created_at: "1785298371106" },
    { id: "2", hash: "h2", created_at: null },
    { hash: "h3", created_at: "not-a-number" },
  ]);
  assert.deepEqual(rows, [
    { id: 1, hash: "h1", createdAt: 1785298371106 },
    { id: 2, hash: "h2", createdAt: null },
    { id: null, hash: "h3", createdAt: null },
  ]);
});

test("fetchAppliedMigrations: sends exactly one SELECT and nothing else", async () => {
  const sent: string[] = [];
  const query: QueryFn = async (sql) => {
    sent.push(sql);
    return { rows: [{ id: 1, hash: "h", created_at: "10" }] };
  };
  const { applied, tableMissing } = await fetchAppliedMigrations(query);
  assert.equal(sent.length, 1);
  assert.equal(sent[0], APPLIED_MIGRATIONS_SQL);
  assert.match(sent[0].trim(), /^select\b/i);
  assert.doesNotMatch(sent[0], /\b(insert|update|delete|create|alter|drop|truncate|grant)\b/i);
  assert.equal(tableMissing, false);
  assert.deepEqual(applied, [{ id: 1, hash: "h", createdAt: 10 }]);
});

test("fetchAppliedMigrations: undefined_table (42P01) means a fresh DB, not an error", async () => {
  const query: QueryFn = async () => {
    throw Object.assign(new Error('relation "drizzle.__drizzle_migrations" does not exist'), { code: "42P01" });
  };
  assert.deepEqual(await fetchAppliedMigrations(query), { applied: [], tableMissing: true });
});

test("fetchAppliedMigrations: missing schema (3F000) is also a fresh DB", async () => {
  const query: QueryFn = async () => {
    throw Object.assign(new Error("schema does not exist"), { code: "3F000" });
  };
  assert.equal((await fetchAppliedMigrations(query)).tableMissing, true);
});

test("fetchAppliedMigrations: any other error propagates (never reported as 'in sync')", async () => {
  const query: QueryFn = async () => {
    throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
  };
  await assert.rejects(fetchAppliedMigrations(query), /connection refused/);
});

test("checkMigrationDrift: fresh DB (table missing) is drift with the note in the report", async () => {
  const expected = fixtureExpected(2);
  const query: QueryFn = async () => {
    throw Object.assign(new Error("nope"), { code: "42P01" });
  };
  const report = await checkMigrationDrift(expected, query);
  assert.equal(report.ok, false);
  assert.equal(report.tableMissing, true);
  assert.match(formatDriftReport(report), /does not exist/);
});

test("checkMigrationDrift: end to end with a fake DB in sync", async () => {
  const expected = fixtureExpected(3);
  const query: QueryFn = async () => ({
    rows: expected.map((entry, index) => ({ id: index + 1, hash: entry.hash, created_at: String(entry.when) })),
  });
  const report = await checkMigrationDrift(expected, query);
  assert.equal(report.ok, true);
  assert.equal(driftExitCode(report), 0);
});

// ---------------------------------------------------------------------------
// Real repo files: hashing must equal drizzle's own algorithm.
// ---------------------------------------------------------------------------

test("REAL FILES: buildExpectedMigrations agrees with drizzle-orm readMigrationFiles (hash + when) for every migration", () => {
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string; when: number }[];
  };
  const mine = buildExpectedMigrations(journal, (tag) => readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf8"));
  const theirs = readMigrationFiles({ migrationsFolder: MIGRATIONS_DIR });

  assert.ok(mine.length >= 13, "expected at least the 13 known migrations");
  assert.equal(mine.length, theirs.length);
  for (let i = 0; i < mine.length; i += 1) {
    assert.equal(mine[i].hash, theirs[i].hash, `hash differs for ${mine[i].tag}`);
    assert.equal(mine[i].when, theirs[i].folderMillis, `when differs for ${mine[i].tag}`);
  }
});

test("REAL FILES: a DB built by applying the repo's own journal reports in sync; dropping the last one reports behind", () => {
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string; when: number }[];
  };
  const expected = buildExpectedMigrations(journal, (tag) => readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf8"));
  assert.equal(compareMigrations(expected, appliedFrom(expected)).ok, true);
  const behind = compareMigrations(expected, appliedFrom(expected.slice(0, -1)));
  assert.deepEqual(behind.behindTags, [expected[expected.length - 1].tag]);
});

test("REAL FILES: journal entries are strictly increasing in `when` (drizzle's apply rule depends on it)", () => {
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8")) as {
    entries: { when: number }[];
  };
  for (let i = 1; i < journal.entries.length; i += 1) {
    assert.ok(journal.entries[i].when > journal.entries[i - 1].when, `entry ${i} is not newer than entry ${i - 1}`);
  }
});
