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

test("no table added to db/schema.ts after SCHEMAV2-001 can lack workspace_id + revision", () => {
  const tables = allTables();
  const checked: string[] = [];
  for (const [name, table] of Object.entries(tables)) {
    if (PRE_EXISTING_TABLE_NAMES.has(name)) continue;
    checked.push(name);
    const cols = columnsOf(table);
    assert.ok(cols.workspaceId, `${name} is a new table with no workspace_id column`);
    assert.equal(cols.workspaceId.notNull, true, `${name}.workspace_id must be NOT NULL`);
    assert.ok(cols.revision, `${name} is a new table with no revision column`);
    assert.equal(cols.revision.dataType, "number", `${name}.revision must be an integer`);
  }
  // Sanity: the sweep actually walked the eight tables it's meant to guard,
  // so a refactor that silently stops exporting one of them cannot pass this
  // test by vacuous truth (zero tables checked).
  assert.equal(checked.length, 8, `expected exactly 8 post-SCHEMAV2-001 tables, found: ${checked.join(", ")}`);
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
//    drizzle-kit generate actually produced DDL for the eight tables, that no
//    pre-SCHEMAV2-001 migration file gained new v2 table/enum names (the
//    "strictly additive, applies cleanly after 0005" criteria), and that the
//    same-row personal_resonance/devotional CHECK constraint text is present.
// ---------------------------------------------------------------------------

function readJournal(): { idx: number; tag: string }[] {
  const raw = fs.readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8");
  return JSON.parse(raw).entries;
}

test("drizzle-kit generated a new migration after 0005, and it is the only new SQL file", () => {
  const entries = readJournal();
  const preExisting = entries.filter((e) => e.idx <= 5);
  assert.deepEqual(
    preExisting.map((e) => e.tag),
    [
      "0000_solid_mojo",
      "0001_deep_quasimodo",
      "0002_magical_stranger",
      "0003_enforce_active_thread_links",
      "0004_minimize_sync_receipts",
      "0005_tenant_scope_sync_receipts",
    ],
    "the pre-existing journal entries 0-5 must be untouched, in order",
  );
  const newEntries = entries.filter((e) => e.idx > 5);
  assert.equal(newEntries.length, 1, "expected exactly one new migration after 0005");
  assert.equal(newEntries[0].idx, 6);
});

function newMigrationSql(): string {
  const entries = readJournal();
  const newest = entries[entries.length - 1];
  const file = fs.readdirSync(migrationsDir).find((f) => f.startsWith(newest.tag) && f.endsWith(".sql"));
  assert.ok(file, `could not find the generated SQL file for tag "${newest.tag}"`);
  return fs.readFileSync(path.join(migrationsDir, file as string), "utf8");
}

test("the generated migration CREATEs all eight v2 tables and touches no v1 table", () => {
  const sql = newMigrationSql();
  for (const name of Object.keys(V2_TABLES)) {
    assert.match(sql, new RegExp(`CREATE TABLE "${name}"`), `migration should CREATE TABLE "${name}"`);
  }
  for (const v1Name of Object.keys(V1_TABLE_COLUMN_NAMES)) {
    assert.doesNotMatch(
      sql,
      new RegExp(`ALTER TABLE "${v1Name}"|DROP TABLE "${v1Name}"|CREATE TABLE "${v1Name}"`),
      `migration must not ALTER, DROP, or re-CREATE v1 table "${v1Name}"`,
    );
  }
});

test("the generated migration enforces personal_resonance requires evidence_label='devotional' as a same-row CHECK", () => {
  const sql = newMigrationSql();
  assert.match(
    sql,
    /CHECK \("user_connections"\."type" <> 'personal_resonance' OR "user_connections"\."evidence_label" = 'devotional'\)/,
  );
});

test("pre-existing migration files 0000-0005 contain none of the new v2 table or enum names (proves they were not edited to add v2 content)", () => {
  const v2Markers = [...Object.keys(V2_TABLES), "claim_kind", "connection_type", "study_claim_status"];
  const preExistingFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql") && /^000[0-5]_/.test(f));
  assert.equal(preExistingFiles.length, 6, "expected exactly six pre-existing migration files");
  for (const file of preExistingFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    for (const marker of v2Markers) {
      assert.ok(!sql.includes(marker), `${file} unexpectedly contains v2 marker "${marker}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// 6. Cross-table personal_resonance/devotional rule (§3.2's second enforced
//    constraint) — documented as DEFERRED to the repository layer, not
//    implemented as a deferrable constraint trigger, because claim_evidence
//    has no column identifying which user_connections row a
//    evidenceType:"connection" row cites. lib/contracts/study-v2.ts's own
//    header documents this exact gap (gap #5): "there is no connectionId
//    column anywhere in either source doc." A trigger needs a join path to
//    check; none exists yet, and inventing an un-specified connectionId
//    column here would be exactly the kind of guessed, undocumented schema
//    addition this task was told to avoid. This test locks in that current,
//    documented fact so the deferral decision is re-examined (not silently
//    stale) the moment someone adds the missing column.
// ---------------------------------------------------------------------------

test("claim_evidence has no column identifying a cited user_connections row (why the cross-table rule is deferred to the repository layer, not a DB trigger)", () => {
  const cols = Object.keys(columnsOf(schema.claimEvidence));
  for (const suspect of ["connectionId", "userConnectionId", "citedConnectionId"]) {
    assert.ok(
      !cols.includes(suspect),
      `claim_evidence unexpectedly has a "${suspect}" column — the cross-table personal_resonance/devotional CHECK ` +
        `deferral in db/schema.ts's header comment is stale; a deferrable constraint trigger should be added instead`,
    );
  }
});
