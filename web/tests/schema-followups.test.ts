/**
 * SCHEMAFU-001 — schema-shape proof for the four gaps SCHEMAV2-001 reported
 * and this task closes:
 *   (a) a `workspaces` table + FK from all eight v2 tables' workspace_id;
 *   (b) `claim_evidence.connection_id` + the cross-table devotional/theology
 *       deferrable constraint trigger it finally makes enforceable;
 *   (c) `teaching_sections`;
 *   (d) `artifact_revisions`.
 *
 * No database connection is used anywhere in this file (this task's own
 * acceptance criterion 8: "No live database required"). Every assertion here
 * is either (a) schema-object introspection via drizzle-orm's own
 * `getTableColumns`/`getTableConfig`/`getTableName` helpers — the same
 * pattern tests/schema-v2.test.ts and tests/tenant-isolation.test.ts already
 * use against the same schema module — or (b) a byte-identity check of the
 * pre-existing migration files against a hash computed before this task
 * touched anything.
 *
 * This file complements tests/schema-v2.test.ts rather than duplicating it:
 * schema-v2.test.ts proves the generated/hand-written migration SQL TEXT is
 * correct (including the trigger's guard-condition truth table); this file
 * proves the drizzle SCHEMA OBJECTS (`db/schema.ts`) independently agree,
 * using drizzle's own FK/config introspection rather than reading SQL text.
 * A defect that broke one layer but not the other (e.g. a schema.ts edit
 * whose generated SQL was never regenerated) would fail here even if it
 * passed there, or vice versa.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

import * as schema from "@/db/schema";

/* eslint-disable @typescript-eslint/no-explicit-any --
 * Column/FK objects are read generically across many tables here; naming
 * each drizzle internal class would add noise without adding safety. */

const migrationsDir = path.join(process.cwd(), "db", "migrations");

function columnsOf(table: object): Record<string, any> {
  return getTableColumns(table as any) as unknown as Record<string, any>;
}

// ---------------------------------------------------------------------------
// 0. Content-identity of the seven pre-SCHEMAFU-001 migration files. Hashes
//    below were computed from `git show origin/master:web/db/migrations/...`
//    for each file BEFORE this task made any edit — i.e. not derived from
//    the working tree this test also reads, so a change to either side is
//    caught. (tests/schema-v2.test.ts separately proves, via journal-order
//    and marker-absence checks, that these files are untouched; this is an
//    independent, stronger form of the same claim — content-identical, not
//    just marker-absent.)
//
//    Hashed after stripping `\r`: this Windows checkout has core.autocrlf
//    converting the git-stored LF line endings to CRLF in the working tree
//    (confirmed: raw-byte hashes differ by exactly the CRLF/LF delta, while
//    `git diff` — which normalizes this the same way — reports no change).
//    Hashing raw bytes here would make the test fail on every clean checkout
//    on this OS for a reason that has nothing to do with content changing;
//    normalizing line endings before hashing is what makes the check actually
//    test content, matching what `git diff` itself already treats as "no
//    difference".
//
//    DELIBERATE EXCEPTION (MIGORDER-001): `0006_typical_turbo.sql`'s hash
//    below is NOT its origin/master value anymore. TRIGGER-001 discovered
//    that file's composite FK statements were emitted BEFORE the
//    `CREATE UNIQUE INDEX` statements those FKs require — applying it (or
//    0007) against a fresh database fails outright with "there is no unique
//    constraint matching given keys". MIGORDER-001 fixed this by reordering
//    0006's statements in place — every FK statement was moved to after the
//    index statements in the SAME FILE; every statement's TEXT is byte-
//    identical to before, only its position moved (`git diff` on this file
//    is a pure block move, verified in that task's commit). The hash below
//    is that reordered file's hash, so this test still catches any FURTHER
//    unreviewed change to 0006 from here on — it is deliberately updated
//    once, not disabled.
// ---------------------------------------------------------------------------

const PRE_SCHEMAFU_MIGRATION_SHA256: Record<string, string> = {
  "0000_solid_mojo.sql": "4e5d5a7c6a918753399a1dcf8a2c41ac54aabb4b6027970126efed15db0adc55",
  "0001_deep_quasimodo.sql": "9bd081668ed5108ff8e1b4e3ea5d789ab246847fafd07bd3285462675b26d761",
  "0002_magical_stranger.sql": "dd41a31aafbedfa9a4fee102b1e9b6fe76e41f1ef1091e8b7857bcd2cb1e794b",
  "0003_enforce_active_thread_links.sql": "324d5685991e6a86f6564c69a6d172c0f6b1daebc0347a9bc50c28d3eca6ef8f",
  "0004_minimize_sync_receipts.sql": "3990c249c22b291a322346a940079fed5904397e764fa6e16b3af6c63983e520",
  "0005_tenant_scope_sync_receipts.sql": "5215d256355bb79df9309c19eb3cb1c927f49424d8db381e78d88129743923a7",
  // MIGORDER-001: reordered in place (FK statements moved after the index
  // statements they depend on); this is the POST-fix hash, not origin/master's.
  "0006_typical_turbo.sql": "a5155555d1e4cdb025938a78febe29e1b4172d9ebfb826ba9f5ae2f4c2dae96d",
};

test("the seven pre-SCHEMAFU-001 migration files are content-identical to their origin/master blob (SHA-256, line-ending normalized)", () => {
  for (const [file, expectedHash] of Object.entries(PRE_SCHEMAFU_MIGRATION_SHA256)) {
    const contents = fs.readFileSync(path.join(migrationsDir, file), "utf8").replace(/\r\n/g, "\n");
    const actualHash = createHash("sha256").update(contents, "utf8").digest("hex");
    assert.equal(actualHash, expectedHash, `${file} content changed since origin/master (hash mismatch)`);
  }
});

// ---------------------------------------------------------------------------
// 1. Gap (a) — `workspaces` table, master plan §12.1 columns verbatim: id,
//    kind(personal), name, created_by, created_at, deleted_at. No
//    updated_at, no workspace_id, no revision (see db/schema.ts's own
//    comment on `export const workspaces` for why).
// ---------------------------------------------------------------------------

test("workspaces exists and is named correctly", () => {
  assert.equal(getTableName(schema.workspaces), "workspaces");
});

test("workspaces has exactly master plan §12.1's column set: id, kind, name, created_by, created_at, deleted_at", () => {
  const cols = columnsOf(schema.workspaces);
  const actualKeys = Object.keys(cols).sort();
  assert.deepEqual(actualKeys, ["createdAt", "createdBy", "deletedAt", "id", "kind", "name"].sort());
});

test("workspaces.kind is an enum containing only 'personal' (cohort/church kinds are explicitly deferred in the master plan)", () => {
  const cols = columnsOf(schema.workspaces);
  assert.deepEqual(cols.kind.enumValues, ["personal"]);
  assert.equal(cols.kind.notNull, true);
});

test("workspaces.name and workspaces.created_by are NOT NULL; created_by FKs to users.id", () => {
  const cols = columnsOf(schema.workspaces);
  assert.equal(cols.name.notNull, true);
  assert.equal(cols.createdBy.notNull, true);
  assert.equal(cols.createdBy.name, "created_by");

  const cfg = getTableConfig(schema.workspaces as any);
  const fk = cfg.foreignKeys.find((f: any) => f.reference().columns[0].name === "created_by");
  assert.ok(fk, "workspaces.created_by should have a foreign key");
  const ref = (fk as any).reference();
  assert.equal(getTableName(ref.foreignTable), "users");
  assert.deepEqual(
    ref.foreignColumns.map((c: any) => c.name),
    ["id"],
  );
});

test("workspaces.created_at is NOT NULL with a default; workspaces.deleted_at is nullable; workspaces has NO updated_at column", () => {
  const cols = columnsOf(schema.workspaces);
  assert.equal(cols.createdAt.notNull, true);
  assert.notEqual(cols.createdAt.default, undefined);
  assert.equal(cols.deletedAt.notNull, false);
  assert.equal(cols.updatedAt, undefined, "workspaces must not have updated_at — master plan §12.1 does not list one");
});

// ---------------------------------------------------------------------------
// 0b. MIGORDER-001 — workspaces.created_by gains a PARTIAL unique index (not
//     a plain UNIQUE(created_by)) so `lib/db/workspaces.ts`'s
//     getOrCreatePersonalWorkspace can target it with a real ON CONFLICT.
//     Scoped to kind='personal' AND deleted_at IS NULL: at most one LIVE
//     personal workspace per user, but a soft-deleted one does not
//     permanently block a replacement. Object-level proof, independent of
//     tests/schema-v2.test.ts's SQL-text proof of the same migration.
// ---------------------------------------------------------------------------

test("workspaces.created_by has a PARTIAL unique index scoped to kind='personal' AND deleted_at IS NULL — a plain UNIQUE would wrongly block a replacement after soft-delete", () => {
  // MUTATION PROOF (paste in the commit): remove `.where(...)` from
  // workspaces_created_by_personal_live_idx in db/schema.ts (making it a
  // plain, non-partial unique index) and this test fails by name.
  const cfg = getTableConfig(schema.workspaces as any);
  const idx = cfg.indexes.find(
    (i: any) =>
      i.config.unique &&
      i.config.columns.length === 1 &&
      i.config.columns[0].name === "created_by",
  );
  assert.ok(idx, "workspaces.created_by should have a unique index");
  assert.ok(
    (idx as any).config.where,
    "the unique index on workspaces.created_by must be PARTIAL (have a WHERE clause), not a blanket UNIQUE(created_by)",
  );
});

// ---------------------------------------------------------------------------
// 2. Gap (a) continued — all eight v2 learner tables FK their workspace_id
//    to workspaces.id. Schema-object level (getTableConfig), independent of
//    tests/schema-v2.test.ts's SQL-text version of the same claim.
//    MUTATION PROOF (paste in the commit): remove `.references(() =>
//    workspaces.id, ...)` from any one of the eight tables' workspaceId
//    column in db/schema.ts and this test fails by name.
// ---------------------------------------------------------------------------

const EIGHT_V2_TABLES: Record<string, object> = {
  study_sessions: schema.studySessions,
  study_claims: schema.studyClaims,
  claim_evidence: schema.claimEvidence,
  motif_candidates: schema.motifCandidates,
  motif_sightings: schema.motifSightings,
  user_connections: schema.userConnections,
  applications: schema.applications,
  teaching_drafts: schema.teachingDrafts,
};

test("every one of the eight v2 tables' workspace_id column has exactly one FK, targeting workspaces.id", () => {
  const checked: string[] = [];
  for (const [name, table] of Object.entries(EIGHT_V2_TABLES)) {
    checked.push(name);
    const cfg = getTableConfig(table as any);
    const workspaceFks = cfg.foreignKeys.filter((f: any) => {
      const ref = f.reference();
      return ref.columns.length === 1 && ref.columns[0].name === "workspace_id";
    });
    assert.equal(workspaceFks.length, 1, `${name}.workspace_id should have exactly one single-column FK`);
    const ref = (workspaceFks[0] as any).reference();
    assert.equal(getTableName(ref.foreignTable), "workspaces", `${name}.workspace_id should FK to workspaces`);
    assert.deepEqual(
      ref.foreignColumns.map((c: any) => c.name),
      ["id"],
      `${name}.workspace_id should FK to workspaces.id`,
    );
  }
  assert.equal(checked.length, 8, `expected to check all eight v2 tables, checked: ${checked.join(", ")}`);
});

// ---------------------------------------------------------------------------
// 3. Gap (b) — claim_evidence.connection_id, schema-object level. The SQL
//    text and the trigger's guard-condition truth table are proven in
//    tests/schema-v2.test.ts; this proves the drizzle column/FK objects
//    independently agree.
// ---------------------------------------------------------------------------

test("claim_evidence.connection_id is nullable text, composite-FK'd to (user_connections.id, user_connections.workspace_id)", () => {
  const cols = columnsOf(schema.claimEvidence);
  assert.ok(cols.connectionId);
  assert.equal(cols.connectionId.notNull, false);
  assert.equal(cols.connectionId.dataType, "string");

  const cfg = getTableConfig(schema.claimEvidence as any);
  const fk = cfg.foreignKeys.find(
    (f: any) => f.reference().columns.length === 2 && f.reference().columns.some((c: any) => c.name === "connection_id"),
  );
  assert.ok(fk, "claim_evidence should have a composite FK involving connection_id");
  const ref = (fk as any).reference();
  assert.equal(getTableName(ref.foreignTable), "user_connections");
  assert.deepEqual(
    ref.columns.map((c: any) => c.name).sort(),
    ["connection_id", "workspace_id"],
    "the FK must pair connection_id with workspace_id, not reference user_connections.id alone",
  );
  assert.deepEqual(
    ref.foreignColumns.map((c: any) => c.name).sort(),
    ["id", "workspace_id"],
  );
});

test("user_connections exposes a composite UNIQUE(id, workspace_id) index for claim_evidence.connection_id to FK against", () => {
  const cfg = getTableConfig(schema.userConnections as any);
  const compositeUnique = cfg.indexes.find(
    (idx: any) => idx.config.unique && idx.config.columns.length === 2 && idx.config.columns.some((c: any) => c.name === "id"),
  );
  assert.ok(compositeUnique, "user_connections should have a composite unique(id, workspace_id) index");
});

// ---------------------------------------------------------------------------
// 4. Gap (c) — teaching_sections, BUILD_PLAN §3.3 columns verbatim: id,
//    workspace_id, draft_id (FK), kind, sort_order, body — plus the standard
//    v2 workspace_id/revision/timestamps shape every table in this file's
//    "user-owned (synced)" group carries per BUILD_PLAN §3.3's blanket
//    statement (see db/schema.ts's comment on `export const teachingSections`).
// ---------------------------------------------------------------------------

test("teaching_sections is exported and named correctly", () => {
  assert.equal(getTableName(schema.teachingSections), "teaching_sections");
});

test("teaching_sections has id, workspace_id, draft_id, kind, sort_order, body, plus the standard revision/timestamps shape", () => {
  const cols = columnsOf(schema.teachingSections);
  const actualKeys = Object.keys(cols).sort();
  assert.deepEqual(
    actualKeys,
    ["id", "workspaceId", "draftId", "kind", "sortOrder", "body", "revision", "createdAt", "updatedAt", "deletedAt"].sort(),
  );
  assert.equal(cols.draftId.name, "draft_id");
  assert.equal(cols.draftId.notNull, true);
  assert.equal(cols.sortOrder.name, "sort_order");
  assert.equal(cols.sortOrder.dataType, "number");
  assert.equal(cols.body.dataType, "string");
  assert.equal(cols.body.notNull, true);
});

// Ground truth transcribed independently, by hand, from BOTH source docs
// (BUILD_PLAN.md §3.3 and THEOLOGY_MASTER_BUILD_PLAN.md §12.3 — they agree
// verbatim, unlike gap #1 in lib/contracts/study-v2.ts's header, which is a
// real disagreement between the two docs). NOT read back off db/schema.ts —
// this is the same discipline tests/schema-v2.test.ts's EXPECTED_STUDY_CLAIM_STATUSES
// already follows for the one other hand-transcribed enum in this codebase.
const EXPECTED_TEACHING_SECTION_KINDS = [
  "outline",
  "context",
  "connection",
  "theology",
  "illustration",
  "objection",
  "application",
  "not_justified",
  "discussion",
  "prayer",
];

test("teaching_sections.kind matches BUILD_PLAN §3.3 / THEOLOGY_MASTER_BUILD_PLAN §12.3's kind vocabulary exactly", () => {
  // MUTATION PROOF (paste in the commit): change any one value in
  // TEACHING_SECTION_KINDS in db/schema.ts (e.g. drop "prayer" or typo
  // "theology") and this test fails by name; every other test in this file
  // continues to pass or fail independently of it.
  const cols = columnsOf(schema.teachingSections);
  assert.deepEqual(cols.kind.enumValues, EXPECTED_TEACHING_SECTION_KINDS);
});

test("teaching_sections.draft_id is composite-FK'd to (teaching_drafts.id, teaching_drafts.workspace_id)", () => {
  const cfg = getTableConfig(schema.teachingSections as any);
  const fk = cfg.foreignKeys.find(
    (f: any) => f.reference().columns.length === 2 && f.reference().columns.some((c: any) => c.name === "draft_id"),
  );
  assert.ok(fk, "teaching_sections should have a composite FK involving draft_id");
  const ref = (fk as any).reference();
  assert.equal(getTableName(ref.foreignTable), "teaching_drafts");
  assert.deepEqual(
    ref.columns.map((c: any) => c.name).sort(),
    ["draft_id", "workspace_id"],
  );
  assert.deepEqual(
    ref.foreignColumns.map((c: any) => c.name).sort(),
    ["id", "workspace_id"],
  );
});

test("teaching_drafts exposes a composite UNIQUE(id, workspace_id) index for teaching_sections.draft_id to FK against", () => {
  const cfg = getTableConfig(schema.teachingDrafts as any);
  const compositeUnique = cfg.indexes.find(
    (idx: any) => idx.config.unique && idx.config.columns.length === 2 && idx.config.columns.some((c: any) => c.name === "id"),
  );
  assert.ok(compositeUnique, "teaching_drafts should have a composite unique(id, workspace_id) index");
});

// ---------------------------------------------------------------------------
// 5. Gap (d) — artifact_revisions, the append-only prior-version store.
//    Deliberately NOT the standard v2 shape: no updated_at/deleted_at
//    (nothing should ever mutate or soft-delete a preserved revision), and
//    its `revision` column is never defaulted (see db/schema.ts's comment on
//    `export const artifactRevisions`).
// ---------------------------------------------------------------------------

test("artifact_revisions is exported and named correctly", () => {
  assert.equal(getTableName(schema.artifactRevisions), "artifact_revisions");
});

test("artifact_revisions has id, workspace_id, entity_table, entity_id, revision, snapshot, created_at — and NOTHING else", () => {
  const cols = columnsOf(schema.artifactRevisions);
  const actualKeys = Object.keys(cols).sort();
  assert.deepEqual(
    actualKeys,
    ["id", "workspaceId", "entityTable", "entityId", "revision", "snapshot", "createdAt"].sort(),
  );
});

test("artifact_revisions has NO updated_at and NO deleted_at (append-only: nothing may mutate or soft-delete a preserved revision)", () => {
  const cols = columnsOf(schema.artifactRevisions);
  assert.equal(cols.updatedAt, undefined, "artifact_revisions must not have updated_at");
  assert.equal(cols.deletedAt, undefined, "artifact_revisions must not have deleted_at");
});

test("artifact_revisions.revision is a required integer with NO default (the caller must always state which revision it preserves)", () => {
  // MUTATION PROOF (paste in the commit): add `.default(1)` to
  // artifactRevisions.revision in db/schema.ts and this test fails by name.
  const cols = columnsOf(schema.artifactRevisions);
  assert.equal(cols.revision.notNull, true);
  assert.equal(cols.revision.dataType, "number");
  assert.equal(cols.revision.default, undefined, "artifact_revisions.revision must NOT be defaulted");
});

test("artifact_revisions.snapshot is a required jsonb column (full prior row content, not a plain text body)", () => {
  const cols = columnsOf(schema.artifactRevisions);
  assert.equal(cols.snapshot.notNull, true);
  assert.equal(cols.snapshot.dataType, "json");
});

test("artifact_revisions.workspace_id FKs to workspaces.id", () => {
  const cfg = getTableConfig(schema.artifactRevisions as any);
  const fk = cfg.foreignKeys.find((f: any) => f.reference().columns[0]?.name === "workspace_id");
  assert.ok(fk, "artifact_revisions.workspace_id should have a FK");
  const ref = (fk as any).reference();
  assert.equal(getTableName(ref.foreignTable), "workspaces");
});

// ---------------------------------------------------------------------------
// 6. Whole-file sanity: every table this task added is actually exported
//    (catches a table defined but not exported, which would silently vanish
//    from every test above that reads it off `schema.*` rather than off
//    `allTables()`-style introspection).
// ---------------------------------------------------------------------------

test("all four SCHEMAFU-001 additions (workspaces, teaching_sections, artifact_revisions, claim_evidence.connection_id) are visible on the schema module", () => {
  assert.ok(schema.workspaces);
  assert.ok(schema.teachingSections);
  assert.ok(schema.artifactRevisions);
  assert.ok(columnsOf(schema.claimEvidence).connectionId);
});

// ---------------------------------------------------------------------------
// 7. MOTIFTHREAD-001 — motif_candidates.thread_slug: an additive, nullable
//    column recording WHICH v1 threads row a promoted candidate became,
//    replacing RADARPERSIST-001's deterministic-slug workaround
//    (lib/db/radar.ts's threadSlugForCandidate, now deleted). Deliberately
//    the SAME shape as user_connections.threadSlug (above, gap (b)'s
//    neighbor) rather than a composite FK: `threads` is keyed by
//    (userId, slug), not id, and motif_candidates carries no userId column
//    to pair into a composite reference with.
// ---------------------------------------------------------------------------

test("motif_candidates.thread_slug is nullable text with NO foreign key -- same shape as user_connections.thread_slug, for the same reason (threads is (userId, slug)-keyed, not id-keyed)", () => {
  // MUTATION PROOF (paste in the commit): add `.notNull()` to
  // motifCandidates.threadSlug in db/schema.ts and this test fails by name
  // on the `notNull` assertion.
  const cols = columnsOf(schema.motifCandidates);
  assert.ok(cols.threadSlug, "motif_candidates should have a threadSlug column");
  assert.equal(cols.threadSlug.name, "thread_slug");
  assert.equal(cols.threadSlug.dataType, "string");
  assert.equal(cols.threadSlug.notNull, false, "thread_slug must be nullable -- an un-promoted candidate has no thread");

  const cfg = getTableConfig(schema.motifCandidates as any);
  const fk = cfg.foreignKeys.find((f: any) =>
    f.reference().columns.some((c: any) => c.name === "thread_slug"),
  );
  assert.equal(fk, undefined, "thread_slug must carry no foreign key (threads has no id-keyed unique target to reference)");
});

test("motif_candidates gained EXACTLY one new column (thread_slug) since RADARPERSIST-001 -- id, workspace_id, label, normalized_key, status, thread_slug, revision, plus the standard timestamps", () => {
  const cols = columnsOf(schema.motifCandidates);
  const actualKeys = Object.keys(cols).sort();
  assert.deepEqual(
    actualKeys,
    ["id", "workspaceId", "label", "normalizedKey", "status", "threadSlug", "revision", "createdAt", "updatedAt", "deletedAt"].sort(),
  );
});

test("migration 0009 adds motif_candidates.thread_slug additively -- a single nullable ALTER TABLE ADD COLUMN, no FK, no rewrite of 0000-0008", () => {
  // Looked up BY NAME, not "the newest file" -- STUDYSESSIONRACE-001 added
  // migration 0010 after this one, which is exactly what the next test below
  // proves. Pinning 0009's own content by its own filename keeps this
  // assertion true regardless of what gets added after it.
  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const migration0009 = files.find((name) => name.startsWith("0009_"));
  assert.ok(migration0009, "expected a 0009_*.sql migration file to exist");

  const sql = fs.readFileSync(path.join(migrationsDir, migration0009!), "utf8").replace(/\r\n/g, "\n").trim();
  assert.equal(
    sql,
    'ALTER TABLE "motif_candidates" ADD COLUMN "thread_slug" text;',
    "0009 must be exactly one additive, nullable ALTER TABLE ADD COLUMN statement -- no FK, no NOT NULL, nothing else",
  );
});

// ---------------------------------------------------------------------------
// 8. STUDYSESSIONRACE-001 -- study_sessions gains a real database backstop for
//    the client-side dedup rule StudyEntry.tsx's findExistingActiveSession
//    already implements (readOnlyPath, left untouched): a partial unique
//    index on (workspace_id, range) scoped to
//    workflow_state = 'active' AND deleted_at IS NULL, so two genuinely
//    concurrent devices/tabs can no longer both mint an active session for
//    the identical range -- Postgres itself now serializes that race.
//    Proven end-to-end against a real local Postgres 18 instance (two
//    overlapping transactions inserting for the same workspace_id/range;
//    exactly one committed, the other failed with
//    "duplicate key value violates unique constraint
//    study_sessions_workspace_range_active_idx" -- see the task's commit
//    message for the full transcript, including the closed/soft-deleted/
//    different-workspace/different-range negative controls). This section is
//    the schema-object-level proof, independent of that live-database run.
// ---------------------------------------------------------------------------

test("study_sessions has a PARTIAL unique index on (workspace_id, range) scoped to workflow_state='active' AND deleted_at IS NULL -- matching findExistingActiveSession's predicate exactly", () => {
  // MUTATION PROOF (paste in the commit): remove `.where(...)` from
  // study_sessions_workspace_range_active_idx in db/schema.ts (making it a
  // plain, non-partial unique index) and this test fails by name.
  const cfg = getTableConfig(schema.studySessions as any);
  const idx = cfg.indexes.find(
    (i: any) =>
      i.config.unique &&
      i.config.columns.length === 2 &&
      i.config.columns.some((c: any) => c.name === "workspace_id") &&
      i.config.columns.some((c: any) => c.name === "range"),
  );
  assert.ok(idx, "study_sessions should have a unique index on (workspace_id, range)");
  assert.ok(
    (idx as any).config.where,
    "the unique index on study_sessions(workspace_id, range) must be PARTIAL (have a WHERE clause) -- a closed/archived/soft-deleted session must never block a fresh active one for the same range",
  );
});

test("migration 0010 adds the study_sessions active-range unique index additively -- a single CREATE UNIQUE INDEX statement, no rewrite of 0000-0009", () => {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const newest = files[files.length - 1]!;
  assert.match(
    newest,
    /^0010_/,
    "expected migration 0010 to be the newest file (a forward migration, not an edit to an applied one)",
  );

  const sql = fs.readFileSync(path.join(migrationsDir, newest), "utf8").replace(/\r\n/g, "\n").trim();
  assert.equal(
    sql,
    'CREATE UNIQUE INDEX "study_sessions_workspace_range_active_idx" ON "study_sessions" USING btree ("workspace_id","range") WHERE "study_sessions"."workflow_state" = \'active\' AND "study_sessions"."deleted_at" IS NULL;',
    "0010 must be exactly one additive CREATE UNIQUE INDEX statement -- no FK, no rewrite of any earlier statement",
  );
});
