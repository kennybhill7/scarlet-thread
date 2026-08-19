/**
 * SCHEMAV2-001 — schema-shape proof for the eight v2 learner-owned tables
 * (BUILD_PLAN.md §3.3 "User-owned (synced)" list).
 *
 * No database connection is used anywhere in this file (acceptance criterion
 * 7): every assertion below is either (a) introspection of the `db/schema.ts`
 * `pgTable`/`pgEnum` objects via drizzle-orm's own `getTableColumns` /
 * `getTableName` helpers, exactly the pattern `tests/tenant-isolation.test.ts`
 * already uses against the same schema module, or (b) a text check against
 * the drizzle-kit-generated SQL migration file and its journal entry.
 *
 * TEST QUALITY rule this file follows throughout: no expected value below is
 * derived from `db/schema.ts` (the code under test). Enum expectations come
 * from `lib/contracts/study-v2.ts` — an independent module the schema is
 * required to import from, not retype — and the one deliberate exception
 * (`study_claims.status`) is transcribed by hand from `BUILD_PLAN.md` §3.3
 * text, exactly the way `tests/study-v2.test.ts` independently transcribes
 * BUILD_PLAN's §3.2 enums rather than importing them. v1-table shapes are
 * hand-transcribed from `db/schema.ts` as it stood immediately before this
 * task (commit `ff7e81c`), so a later accidental edit to any v1 table is
 * caught by comparison, not assumed correct because the code says so.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { Table, getTableColumns, getTableName, is } from "drizzle-orm";

import * as schema from "@/db/schema";
import {
  CLAIM_CONFIDENCES,
  CLAIM_EVIDENCE_TYPES,
  CLAIM_KINDS,
  CLAIM_PROVENANCES,
  CONNECTION_TYPES,
  DOCTRINE_STATUSES,
  EPISTEMIC_BASES,
  EVIDENCE_LABELS,
  MODERN_DOMAINS,
  RESPONSE_TYPES,
  STUDY_SESSION_CONNECTION_STATES,
  STUDY_SESSION_MODES,
  STUDY_SESSION_WORKFLOW_STATES,
  USER_CONNECTION_STATUSES,
} from "@/lib/contracts/study-v2";

/* eslint-disable @typescript-eslint/no-explicit-any --
 * Column objects are read generically across many tables/types here; naming
 * each drizzle internal column class would add noise without adding safety. */

const migrationsDir = path.join(process.cwd(), "db", "migrations");

// ---------------------------------------------------------------------------
// 0. Shared introspection helpers
// ---------------------------------------------------------------------------

function columnsOf(table: Table): Record<string, any> {
  return getTableColumns(table) as unknown as Record<string, any>;
}

/** Every pgTable exported by db/schema.ts, keyed by its SQL table name. */
function allTables(): Record<string, Table> {
  const out: Record<string, Table> = {};
  for (const value of Object.values(schema)) {
    if (is(value, Table)) {
      out[getTableName(value)] = value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. The eight new tables, named explicitly (BUILD_PLAN §3.3 / acceptance
//    criterion 1's own list, transcribed here rather than read off an export).
// ---------------------------------------------------------------------------

const V2_TABLES: Record<string, Table> = {
  study_sessions: schema.studySessions,
  study_claims: schema.studyClaims,
  claim_evidence: schema.claimEvidence,
  motif_candidates: schema.motifCandidates,
  motif_sightings: schema.motifSightings,
  user_connections: schema.userConnections,
  applications: schema.applications,
  teaching_drafts: schema.teachingDrafts,
};

test("all eight BUILD_PLAN §3.3 learner-owned tables are exported and named correctly", () => {
  for (const [sqlName, table] of Object.entries(V2_TABLES)) {
    assert.equal(getTableName(table), sqlName, `table export's SQL name should be "${sqlName}"`);
  }
});

test("every v2 table carries workspace_id (text, NOT NULL)", () => {
  for (const [name, table] of Object.entries(V2_TABLES)) {
    const cols = columnsOf(table);
    assert.ok(cols.workspaceId, `${name} is missing a workspaceId column`);
    assert.equal(cols.workspaceId.name, "workspace_id", `${name}.workspaceId should serialize as "workspace_id"`);
    assert.equal(cols.workspaceId.notNull, true, `${name}.workspace_id should be NOT NULL`);
    assert.equal(cols.workspaceId.dataType, "string", `${name}.workspace_id should be a text column`);
  }
});

test("every v2 table carries an integer revision column, defaulted, NOT NULL", () => {
  for (const [name, table] of Object.entries(V2_TABLES)) {
    const cols = columnsOf(table);
    assert.ok(cols.revision, `${name} is missing a revision column`);
    assert.equal(cols.revision.name, "revision");
    assert.equal(cols.revision.notNull, true, `${name}.revision should be NOT NULL`);
    assert.equal(cols.revision.dataType, "number", `${name}.revision should be an integer column`);
    assert.notEqual(cols.revision.default, undefined, `${name}.revision should have a default so existing writers don't have to set it`);
  }
});

test("every v2 table carries created_at/updated_at (NOT NULL) and deleted_at (nullable) — the v1 soft-delete shape", () => {
  for (const [name, table] of Object.entries(V2_TABLES)) {
    const cols = columnsOf(table);
    assert.ok(cols.createdAt, `${name} is missing createdAt`);
    assert.equal(cols.createdAt.name, "created_at");
    assert.equal(cols.createdAt.notNull, true, `${name}.created_at should be NOT NULL`);

    assert.ok(cols.updatedAt, `${name} is missing updatedAt`);
    assert.equal(cols.updatedAt.name, "updated_at");
    assert.equal(cols.updatedAt.notNull, true, `${name}.updated_at should be NOT NULL`);

    assert.ok(cols.deletedAt, `${name} is missing deletedAt (soft delete)`);
    assert.equal(cols.deletedAt.name, "deleted_at");
    assert.equal(cols.deletedAt.notNull, false, `${name}.deleted_at should be nullable`);
  }
});

// ---------------------------------------------------------------------------
// 2. Generic sweep: ANY table in db/schema.ts that isn't one of the tables
//    that predate SCHEMAV2-001 must carry workspace_id + revision. This is
//    what makes the suite "fail if a table is added without workspace_id"
//    for a table added later too, not only for the eight named above.
//    MUTATION PROOF (paste in the commit): comment out `workspaceId` on any
//    one v2 table in db/schema.ts and this test fails by name; every other
//    test in this file continues to pass or fail independently of it.
//
// SCHEMAFU-001 extended this sweep for the three tables it added:
//  - `workspaces` is exempted ENTIRELY (moved into WORKSPACE_ROOT_TABLE_NAMES,
//    not PRE_EXISTING_TABLE_NAMES — it did not predate SCHEMAV2-001, it is
//    exempt for a different, explicit reason): it IS the workspace, so it has
//    no workspace_id of its own, and it carries no mutable `revision` counter
//    either (see the big comment on `export const workspaces` in db/schema.ts).
//  - `artifact_revisions` DOES get workspace_id + an integer `revision`
//    column (still swept for both), but that `revision` records which
//    revision of the PARENT row a snapshot preserves, not this row's own
//    identity — it is deliberately never defaulted (see the comment on
//    `export const artifactRevisions`), so it is exempted from the
//    default-value half of the check only, via
//    TABLES_WITHOUT_DEFAULTED_REVISION below.
// ---------------------------------------------------------------------------

const PRE_EXISTING_TABLE_NAMES = new Set([
  "users",
  "accounts",
  "sessions",
  "verification_tokens",
  "entries",
  "threads",
  "entry_threads",
  "people",
  "reading_progress",
  "daily_logs",
  "stages",
  "sync_receipts",
]);

/** Tables added after SCHEMAV2-001 that are exempt from the workspace_id/revision sweep entirely — see the comment above. */
const WORKSPACE_ROOT_TABLE_NAMES = new Set(["workspaces"]);

/** Tables that carry workspace_id + an integer revision column but where that revision is deliberately never defaulted — see the comment above. */
const TABLES_WITHOUT_DEFAULTED_REVISION = new Set(["artifact_revisions"]);

test("no table added to db/schema.ts after SCHEMAV2-001 can lack workspace_id + revision (except the documented workspace-root exemption)", () => {
  const tables = allTables();
  const checked: string[] = [];
  for (const [name, table] of Object.entries(tables)) {
    if (PRE_EXISTING_TABLE_NAMES.has(name)) continue;
    if (WORKSPACE_ROOT_TABLE_NAMES.has(name)) continue;
    checked.push(name);
    const cols = columnsOf(table);
    assert.ok(cols.workspaceId, `${name} is a new table with no workspace_id column`);
    assert.equal(cols.workspaceId.notNull, true, `${name}.workspace_id must be NOT NULL`);
    assert.ok(cols.revision, `${name} is a new table with no revision column`);
    assert.equal(cols.revision.dataType, "number", `${name}.revision must be an integer`);
    if (!TABLES_WITHOUT_DEFAULTED_REVISION.has(name)) {
      assert.notEqual(cols.revision.default, undefined, `${name}.revision should have a default so existing writers don't have to set it`);
    }
  }
  // Sanity: the sweep actually walked the ten tables it's meant to guard (the
  // original eight, plus SCHEMAFU-001's teaching_sections and
  // artifact_revisions — workspaces is the one documented exemption), so a
  // refactor that silently stops exporting one of them cannot pass this test
  // by vacuous truth (too few tables checked).
  assert.equal(checked.length, 10, `expected exactly 10 swept tables, found: ${checked.join(", ")}`);
});

test("workspaces itself has no workspace_id and no revision column (it IS the workspace, not a workspace-scoped row)", () => {
  const cols = columnsOf(schema.workspaces);
  assert.equal(cols.workspaceId, undefined, "workspaces must not have a workspace_id column");
  assert.equal(cols.revision, undefined, "workspaces must not have a revision column");
});

// ---------------------------------------------------------------------------
// 3. Enum columns match lib/contracts/study-v2.ts's exported arrays exactly.
//    Expected values are the imported arrays themselves (the contract
//    module), never a value read back off db/schema.ts.
// ---------------------------------------------------------------------------

test("study_claims.kind matches CLAIM_KINDS exactly", () => {
  assert.deepEqual(columnsOf(schema.studyClaims).kind.enumValues, [...CLAIM_KINDS]);
});

test("study_claims.epistemic_basis matches EPISTEMIC_BASES exactly", () => {
  assert.deepEqual(columnsOf(schema.studyClaims).epistemicBasis.enumValues, [...EPISTEMIC_BASES]);
});

test("study_claims.confidence matches CLAIM_CONFIDENCES exactly", () => {
  assert.deepEqual(columnsOf(schema.studyClaims).confidence.enumValues, [...CLAIM_CONFIDENCES]);
});

test("study_claims.provenance matches CLAIM_PROVENANCES exactly", () => {
  assert.deepEqual(columnsOf(schema.studyClaims).provenance.enumValues, [...CLAIM_PROVENANCES]);
});

test("study_claims.doctrine_status matches DOCTRINE_STATUSES exactly", () => {
  assert.deepEqual(columnsOf(schema.studyClaims).doctrineStatus.enumValues, [...DOCTRINE_STATUSES]);
});

test("user_connections.type matches CONNECTION_TYPES exactly", () => {
  assert.deepEqual(columnsOf(schema.userConnections).type.enumValues, [...CONNECTION_TYPES]);
});

test("user_connections.evidence_label matches EVIDENCE_LABELS exactly", () => {
  assert.deepEqual(columnsOf(schema.userConnections).evidenceLabel.enumValues, [...EVIDENCE_LABELS]);
});

test("user_connections.status matches USER_CONNECTION_STATUSES exactly", () => {
  assert.deepEqual(columnsOf(schema.userConnections).status.enumValues, [...USER_CONNECTION_STATUSES]);
});

test("claim_evidence.evidence_type matches CLAIM_EVIDENCE_TYPES exactly", () => {
  assert.deepEqual(columnsOf(schema.claimEvidence).evidenceType.enumValues, [...CLAIM_EVIDENCE_TYPES]);
});

test("study_sessions.mode matches STUDY_SESSION_MODES exactly", () => {
  assert.deepEqual(columnsOf(schema.studySessions).mode.enumValues, [...STUDY_SESSION_MODES]);
});

test("study_sessions.workflow_state matches STUDY_SESSION_WORKFLOW_STATES exactly", () => {
  assert.deepEqual(columnsOf(schema.studySessions).workflowState.enumValues, [...STUDY_SESSION_WORKFLOW_STATES]);
});

test("study_sessions.connection_state matches STUDY_SESSION_CONNECTION_STATES exactly", () => {
  assert.deepEqual(columnsOf(schema.studySessions).connectionState.enumValues, [...STUDY_SESSION_CONNECTION_STATES]);
});

test("applications.modern_domain matches MODERN_DOMAINS exactly", () => {
  assert.deepEqual(columnsOf(schema.applications).modernDomain.enumValues, [...MODERN_DOMAINS]);
});

test("applications.response_type matches RESPONSE_TYPES exactly", () => {
  assert.deepEqual(columnsOf(schema.applications).responseType.enumValues, [...RESPONSE_TYPES]);
});

// study_claims.status is the one deliberate exception: lib/contracts/study-v2.ts's
// own STUDY_CLAIM_STATUSES export is documented (in that file's header, gap #1)
// as still three values ("draft" | "confirmed" | "needs_revision"), even though
// BUILD_PLAN.md §3.3 was corrected to the master plan's four values by commit
// ff7e81c ("Reconcile the study_claims status enum before it becomes a
// migration") without the same fix landing in the contract module. Per that
// commit and this task's own brief, the migration must use the CORRECTED
// four-value list, not the stale contract export — so the expected value here
// is transcribed independently from BUILD_PLAN.md §3.3's prose, exactly the
// way tests/study-v2.test.ts independently transcribes BUILD_PLAN §3.2's
// enums instead of importing them.
const EXPECTED_STUDY_CLAIM_STATUSES = ["draft", "revisited", "confirmed", "needs_revision"];

test("study_claims.status uses the BUILD_PLAN-corrected four-value list (draft|revisited|confirmed|needs_revision)", () => {
  assert.deepEqual(columnsOf(schema.studyClaims).status.enumValues, EXPECTED_STUDY_CLAIM_STATUSES);
});

test("study_claims.status now agrees with study-v2.ts STUDY_CLAIM_STATUSES (one source of truth)", async () => {
  // This replaces a deliberate-divergence tripwire written by SCHEMAV2-001 while
  // the contract module was briefly stale at three values. That test fired on
  // 2026-08-18 the moment the contract was corrected, exactly as its own comment
  // instructed, and is now inverted: the schema imports the contract array, so the
  // two can no longer drift apart silently.
  const { STUDY_CLAIM_STATUSES } = await import("@/lib/contracts/study-v2");
  assert.deepEqual([...STUDY_CLAIM_STATUSES], EXPECTED_STUDY_CLAIM_STATUSES);
  assert.deepEqual(columnsOf(schema.studyClaims).status.enumValues, [...STUDY_CLAIM_STATUSES]);
});

// ---------------------------------------------------------------------------
// 4. STRICTLY ADDITIVE: no v1 table's shape changed. Expected shapes are
//    hand-transcribed from db/schema.ts as it stood at commit ff7e81c (the
//    base this task started from), not read back off the current file.
// ---------------------------------------------------------------------------

const V1_TABLE_COLUMN_NAMES: Record<string, string[]> = {
  users: ["id", "name", "email", "emailVerified", "image"],
  accounts: [
    "userId",
    "type",
    "provider",
    "providerAccountId",
    "refresh_token",
    "access_token",
    "expires_at",
    "token_type",
    "scope",
    "id_token",
    "session_state",
  ],
  sessions: ["sessionToken", "userId", "expires"],
  verification_tokens: ["identifier", "token", "expires"],
  entries: [
    "id",
    "userId",
    "kind",
    "body",
    "chapter",
    "verse",
    "answeredAt",
    "inkUrl",
    "createdAt",
    "updatedAt",
    "deletedAt",
  ],
  threads: ["slug", "userId", "title", "definition", "seeing", "createdAt", "updatedAt", "deletedAt"],
  entry_threads: ["entryId", "userId", "threadSlug", "createdAt"],
  people: ["slug", "userId", "name", "body", "chapters", "threadSlugs", "createdAt", "updatedAt", "deletedAt"],
  reading_progress: ["userId", "chapter", "readAt"],
  daily_logs: [
    "userId",
    "date",
    "chapter",
    "read",
    "observe",
    "link",
    "ask",
    "pray",
    "sentence",
    "carrying",
    "prayer",
    "updatedAt",
  ],
  stages: ["slug", "title", "stage", "side", "mirror", "chapters", "summary"],
  sync_receipts: ["opId", "userId", "entity", "entityId", "clientUpdatedAt", "acceptedAt"],
};

test("every v1 table still exists under its original name with its original column set (no alteration)", () => {
  const tables = allTables();
  for (const [sqlName, expectedKeys] of Object.entries(V1_TABLE_COLUMN_NAMES)) {
    const table = tables[sqlName];
    assert.ok(table, `v1 table "${sqlName}" is missing from db/schema.ts`);
    const actualKeys = Object.keys(columnsOf(table)).sort();
    assert.deepEqual(actualKeys, [...expectedKeys].sort(), `v1 table "${sqlName}" column set changed`);
  }
});

test("entries.kind and stages.side (the two pre-existing enums) are unchanged", () => {
  assert.deepEqual(columnsOf(schema.entries).kind.enumValues, [
    "observation",
    "question",
    "note",
    "teaching",
  ]);
  assert.deepEqual(columnsOf(schema.stages).side.enumValues, ["ascent", "peak", "descent"]);
});

// ---------------------------------------------------------------------------
// 5. Generated-migration checks (text only — no DB connection). Confirms
//    drizzle-kit generate actually produced DDL for the eight SCHEMAV2-001
//    tables in migration 0006, that migration 0007 (SCHEMAFU-001's own, added
//    below) is strictly additive on top of it, that no pre-SCHEMAV2-001
//    migration file gained new v2 table/enum names, and that both
//    generations' CHECK/constraint text is present.
//
//    SCHEMAFU-001 note: this section's original tests resolved "the newest
//    migration" dynamically and asserted it both created the eight v2 tables
//    and carried the personal_resonance CHECK. That migration (0006) still
//    exists, untouched, but it is no longer the newest — 0007 is. The two
//    tests that used to resolve dynamically are now PINNED to tag prefix
//    "0006_" explicitly (migrationSqlByTagPrefix), preserving their original
//    coverage of 0006 unchanged; new tests below cover what 0007 adds.
// ---------------------------------------------------------------------------

function readJournal(): { idx: number; tag: string }[] {
  const raw = fs.readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8");
  return JSON.parse(raw).entries;
}

test("drizzle-kit generated exactly one new migration after 0006 (SCHEMAFU-001's own), and 0000-0006 are untouched, in order", () => {
  const entries = readJournal();
  const preExisting = entries.filter((e) => e.idx <= 6);
  assert.deepEqual(
    preExisting.map((e) => e.tag),
    [
      "0000_solid_mojo",
      "0001_deep_quasimodo",
      "0002_magical_stranger",
      "0003_enforce_active_thread_links",
      "0004_minimize_sync_receipts",
      "0005_tenant_scope_sync_receipts",
      "0006_typical_turbo",
    ],
    "the pre-existing journal entries 0-6 must be untouched, in order (0006 is SCHEMAV2-001's migration, landed before this task started)",
  );
  const newEntries = entries.filter((e) => e.idx > 6);
  assert.equal(newEntries.length, 1, "expected exactly one new migration after 0006");
  assert.equal(newEntries[0].idx, 7);
});

function migrationSqlByTagPrefix(prefix: string): string {
  const file = fs.readdirSync(migrationsDir).find((f) => f.startsWith(prefix) && f.endsWith(".sql"));
  assert.ok(file, `could not find a migration SQL file starting with "${prefix}"`);
  return fs.readFileSync(path.join(migrationsDir, file as string), "utf8");
}

function newMigrationSql(): string {
  const entries = readJournal();
  const newest = entries[entries.length - 1];
  return migrationSqlByTagPrefix(newest.tag);
}

test("migration 0006 (SCHEMAV2-001, pinned by tag) CREATEs all eight v2 tables and touches no v1 table", () => {
  const sql = migrationSqlByTagPrefix("0006_");
  for (const name of Object.keys(V2_TABLES)) {
    assert.match(sql, new RegExp(`CREATE TABLE "${name}"`), `migration 0006 should CREATE TABLE "${name}"`);
  }
  for (const v1Name of Object.keys(V1_TABLE_COLUMN_NAMES)) {
    assert.doesNotMatch(
      sql,
      new RegExp(`ALTER TABLE "${v1Name}"|DROP TABLE "${v1Name}"|CREATE TABLE "${v1Name}"`),
      `migration 0006 must not ALTER, DROP, or re-CREATE v1 table "${v1Name}"`,
    );
  }
});

test("migration 0006 (SCHEMAV2-001, pinned by tag) enforces personal_resonance requires evidence_label='devotional' as a same-row CHECK", () => {
  const sql = migrationSqlByTagPrefix("0006_");
  assert.match(
    sql,
    /CHECK \("user_connections"\."type" <> 'personal_resonance' OR "user_connections"\."evidence_label" = 'devotional'\)/,
  );
});

test("pre-existing migration files 0000-0005 contain none of the SCHEMAV2-001 v2 table or enum names (proves they were not edited to add v2 content)", () => {
  const v2Markers = [...Object.keys(V2_TABLES), "claim_kind", "connection_type", "study_claim_status"];
  const preExistingFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql") && /^000[0-5]_/.test(f));
  assert.equal(preExistingFiles.length, 6, "expected exactly six pre-SCHEMAV2-001 migration files");
  for (const file of preExistingFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    for (const marker of v2Markers) {
      assert.ok(!sql.includes(marker), `${file} unexpectedly contains v2 marker "${marker}"`);
    }
  }
});

const SCHEMAFU_NEW_TABLE_NAMES = ["workspaces", "teaching_sections", "artifact_revisions"];
// Precise, anchored patterns rather than bare substrings: a plain substring
// check for e.g. "workspace_kind" false-positives against migration 0006's
// pre-existing index name "study_claims_workspace_kind_idx" (which contains
// that exact substring without being related to the new enum at all).
const SCHEMAFU_NEW_MARKER_PATTERNS: RegExp[] = [
  /CREATE TABLE "workspaces"/,
  /CREATE TABLE "teaching_sections"/,
  /CREATE TABLE "artifact_revisions"/,
  /"public"\."workspace_kind"/,
  /"public"\."teaching_section_kind"/,
  /"connection_id" text/,
];

test("migration files 0000-0006 contain none of SCHEMAFU-001's new table/column/enum markers (proves they were not edited to add this task's content)", () => {
  const untouchedFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql") && /^000[0-6]_/.test(f));
  assert.equal(untouchedFiles.length, 7, "expected exactly seven pre-SCHEMAFU-001 migration files (0000-0006)");
  for (const file of untouchedFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    for (const pattern of SCHEMAFU_NEW_MARKER_PATTERNS) {
      assert.doesNotMatch(sql, pattern, `${file} unexpectedly contains SCHEMAFU-001 marker ${pattern}`);
    }
  }
});

test("the newest migration (0007, SCHEMAFU-001's own) CREATEs workspaces/teaching_sections/artifact_revisions, and re-CREATEs, DROPs, or re-defines none of the eight v2 tables or any v1 table", () => {
  const sql = newMigrationSql();
  for (const name of SCHEMAFU_NEW_TABLE_NAMES) {
    assert.match(sql, new RegExp(`CREATE TABLE "${name}"`), `migration 0007 should CREATE TABLE "${name}"`);
  }
  for (const v1Name of Object.keys(V1_TABLE_COLUMN_NAMES)) {
    assert.doesNotMatch(
      sql,
      new RegExp(`ALTER TABLE "${v1Name}"|DROP TABLE "${v1Name}"|CREATE TABLE "${v1Name}"`),
      `migration 0007 must not ALTER, DROP, or re-CREATE v1 table "${v1Name}"`,
    );
  }
  for (const v2Name of Object.keys(V2_TABLES)) {
    assert.doesNotMatch(
      sql,
      new RegExp(`CREATE TABLE "${v2Name}"|DROP TABLE "${v2Name}"`),
      `migration 0007 must not re-CREATE or DROP the already-existing v2 table "${v2Name}"`,
    );
  }
});

test("the newest migration (0007) only ever ADDs — no DROP COLUMN, DROP TABLE, or ALTER COLUMN ... SET NOT NULL/TYPE appears anywhere", () => {
  const sql = newMigrationSql();
  assert.doesNotMatch(sql, /DROP TABLE/i, "0007 must not drop any table");
  assert.doesNotMatch(sql, /DROP COLUMN/i, "0007 must not drop any column");
  assert.doesNotMatch(sql, /ALTER COLUMN/i, "0007 must not alter an existing column's type or nullability");
});

test("the newest migration (0007) adds claim_evidence.connection_id as a nullable column (ADD COLUMN, no NOT NULL)", () => {
  const sql = newMigrationSql();
  assert.match(
    sql,
    /ALTER TABLE "claim_evidence" ADD COLUMN "connection_id" text;/,
    "expected a plain nullable ADD COLUMN for claim_evidence.connection_id",
  );
});

test("the newest migration (0007) FKs every one of the eight v2 tables' workspace_id to workspaces(id)", () => {
  const sql = newMigrationSql();
  for (const name of Object.keys(V2_TABLES)) {
    assert.match(
      sql,
      new RegExp(`ALTER TABLE "${name}" ADD CONSTRAINT "[^"]+" FOREIGN KEY \\("workspace_id"\\) REFERENCES "public"\\."workspaces"\\("id"\\)`),
      `expected ${name}.workspace_id to gain a FOREIGN KEY to workspaces(id)`,
    );
  }
});

// ---------------------------------------------------------------------------
// 6. Cross-table personal_resonance/devotional rule (§3.2's second enforced
//    constraint). SCHEMAV2-001 documented this as DEFERRED to the repository
//    layer because claim_evidence had no column identifying which
//    user_connections row an evidenceType:"connection" row cites, and locked
//    that absence in with a tripwire test so the deferral would be revisited
//    the moment the column existed.
//
//    SCHEMAFU-001 is that revisit: claim_evidence.connection_id now exists
//    (added above, in migration 0007) and the cross-table rule is now
//    enforced as a deferrable constraint trigger following migration 0003's
//    pattern (see db/migrations/0007_silly_madame_masque.sql). The tripwire
//    test below is INVERTED — same lifecycle as the STUDY_CLAIM_STATUSES
//    tripwire earlier in this file, which fired the moment its own condition
//    changed and was inverted the same way (see that test's comment).
//
//    What follows is proof against the drizzle schema object and the
//    generated/hand-written SQL TEXT only (per this task's own constraint:
//    "No live database required"). It is NOT a proof that runs the trigger
//    against a real Postgres engine and watches an INSERT actually get
//    rejected — this repo's one live-database proof harness for a
//    deferrable constraint trigger, tests/db-invariants.sql (which proves
//    migration 0003's triggers exactly this way, against a disposable
//    database), is NOT one of this task's ownedPaths. That is a disclosed,
//    intentional scope boundary (SCOPE-BOUNDARY-001), not a silent gap:
//    extending tests/db-invariants.sql with fixtures for this trigger,
//    mirroring its existing entry_threads/entries fixtures, is the concrete
//    follow-up a future task should do to close it.
// ---------------------------------------------------------------------------

test("claim_evidence now has connection_id: a nullable text FK naming which user_connections row a connection-typed evidence row cites", () => {
  // Inverts the SCHEMAV2-001 tripwire that used to assert this column's
  // absence and explained why the cross-table rule was deferred. It fired
  // exactly as designed the moment this task added the column.
  const cols = columnsOf(schema.claimEvidence);
  assert.ok(cols.connectionId, "claim_evidence should now have a connectionId column");
  assert.equal(cols.connectionId.name, "connection_id");
  assert.equal(cols.connectionId.notNull, false, "connectionId must stay nullable — passage/context/source evidence never sets it");
  assert.equal(cols.connectionId.dataType, "string", "connectionId should be a text column");
});

function migration0007Sql(): string {
  return migrationSqlByTagPrefix("0007_");
}

test("migration 0007 composite-FKs claim_evidence.connection_id to user_connections(id, workspace_id) — not a bare single-column FK", () => {
  const sql = migration0007Sql();
  assert.match(
    sql,
    /ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_connection_workspace_fk" FOREIGN KEY \("connection_id","workspace_id"\) REFERENCES "public"\."user_connections"\("id","workspace_id"\)/,
    "connection_id must be composite-FK'd with workspace_id so a claim can never cite a connection from a different workspace",
  );
});

test("migration 0007 defines the devotional/theology cross-table rule as a DEFERRABLE INITIALLY DEFERRED constraint trigger on claim_evidence, following migration 0003's pattern", () => {
  const sql = migration0007Sql();
  assert.match(
    sql,
    /CREATE CONSTRAINT TRIGGER claim_evidence_no_devotional_theology\nAFTER INSERT OR UPDATE OF claim_id, connection_id, evidence_type, workspace_id\nON claim_evidence\nDEFERRABLE INITIALLY DEFERRED/,
    "expected a DEFERRABLE INITIALLY DEFERRED constraint trigger on claim_evidence, matching migration 0003's entries_require_thread shape",
  );
});

test("migration 0007's guard condition is EXACTLY kind='theology' AND evidence_label='devotional' (exact text match, so a mutated operator or literal is caught)", () => {
  const sql = migration0007Sql();
  // MUTATION PROOF (paste in the commit): change this line in the migration
  // to `OR` instead of `AND`, or to a different string literal on either
  // side, and this exact-text assertion fails by name while every other test
  // in this file passes or fails independently of it.
  assert.match(
    sql,
    /IF v_claim_kind = 'theology' AND v_evidence_label = 'devotional' THEN/,
    "the trigger's guard condition text must be exactly this — any changed operator or literal must fail this test",
  );
});

test("migration 0007's guard raises a check_violation (23514) with the exact devotional/theology message, mirroring migration 0003's own RAISE ... USING ERRCODE = '23514' style", () => {
  const sql = migration0007Sql();
  assert.match(
    sql,
    /RAISE EXCEPTION 'A devotional-labeled connection cannot be cited as evidence for a theology claim'\s*\n\s*USING ERRCODE = '23514';/,
  );
});

test("migration 0007 also re-checks the invariant when either joined row changes after the fact (user_connections.evidence_label and study_claims.kind), not only on claim_evidence insert", () => {
  const sql = migration0007Sql();
  assert.match(
    sql,
    /CREATE CONSTRAINT TRIGGER user_connections_evidence_label_change_preserves_devotional_rule\nAFTER UPDATE OF evidence_label\nON user_connections\nDEFERRABLE INITIALLY DEFERRED/,
    "expected a constraint trigger re-checking claim_evidence rows when a cited connection's evidence_label changes",
  );
  assert.match(
    sql,
    /CREATE CONSTRAINT TRIGGER study_claims_kind_change_preserves_devotional_rule\nAFTER UPDATE OF kind\nON study_claims\nDEFERRABLE INITIALLY DEFERRED/,
    "expected a constraint trigger re-checking claim_evidence rows when a citing claim's kind changes",
  );
});

/**
 * A pure-JS re-evaluation of the exact boolean condition string extracted
 * from the migration's own SQL text above — NOT a hand-duplicated copy of
 * the rule. If a future edit changes the SQL condition's operator or
 * literals, the *extracted string* changes, and this same evaluator run
 * against the truth table below will disagree with the ground-truth
 * expectations (also transcribed independently, from BUILD_PLAN.md §3.2's
 * rule prose, not from the SQL or from db/schema.ts) — so a logic bug in the
 * generated SQL is caught here even without executing it against Postgres.
 */
function evaluateExtractedGuard(sql: string, kind: string, evidenceLabel: string): boolean {
  const match = sql.match(/IF (v_claim_kind = 'theology' AND v_evidence_label = 'devotional') THEN/);
  assert.ok(match, "could not extract the trigger's guard condition from migration 0007");
  // SQL's `=` is comparison, not assignment — convert to JS `===` (and
  // `AND`/`OR` to `&&`/`||`) BEFORE substituting placeholders, so the
  // extracted text becomes a valid JS boolean expression rather than an
  // (invalid) chain of assignments to string literals.
  const condition = (match as RegExpMatchArray)[1]
    .replace(/=/g, "===")
    .replace(/\bAND\b/g, "&&")
    .replace(/\bOR\b/g, "||")
    .replace(/v_claim_kind/g, JSON.stringify(kind))
    .replace(/v_evidence_label/g, JSON.stringify(evidenceLabel));
  // Deliberately evaluating a tiny, fully-controlled boolean expression
  // extracted from our own migration text, not user input.
  return new Function(`return (${condition});`)() as boolean;
}

test("the extracted guard condition's truth table matches BUILD_PLAN §3.2's rule exactly for all four kind/label combinations", () => {
  const sql = migration0007Sql();
  // Ground truth transcribed independently from BUILD_PLAN.md §3.2: "a
  // devotional-labeled connection can never be cited as evidence for a
  // theology claim" — false (reject) only for theology+devotional.
  const expectations: Array<[string, string, boolean]> = [
    ["theology", "devotional", true], // the one rejected combination
    ["theology", "strong", false],
    ["observation", "devotional", false],
    ["observation", "strong", false],
  ];
  for (const [kind, label, expectRejected] of expectations) {
    assert.equal(
      evaluateExtractedGuard(sql, kind, label),
      expectRejected,
      `kind="${kind}", evidence_label="${label}" should ${expectRejected ? "" : "NOT "}trigger rejection`,
    );
  }
});
