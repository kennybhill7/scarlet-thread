/**
 * GRAPHEDGES-001 — schema-shape proof for the two new curated tables
 * (`sources`, `graph_edges`; BUILD_PLAN.md §3.3 "Curated" list).
 *
 * Same discipline `tests/schema-v2.test.ts` already established for the
 * eight learner-owned v2 tables, read as precedent before writing this
 * file: no database connection anywhere here (every assertion is either
 * drizzle-orm's own `getTableColumns`/`getTableName` introspection against
 * the real `db/schema.ts` exports, or a text check against the real
 * drizzle-kit-generated migration SQL and its journal entry) — plus one
 * deliberate contrast with that file's own assertions: `graph_edges` is
 * checked to NOT carry `workspace_id`/`revision`/`updated_at`/`deleted_at`,
 * because BUILD_PLAN §3.3 says curated tables are "read-only release
 * indexes," a fundamentally different shape from every v2 table
 * `schema-v2.test.ts` covers — this file exists partly to make that
 * contrast a real, checked assertion rather than a comment.
 *
 * Enum expectations (`type`, `evidenceLabel`) come from
 * `lib/contracts/study-v2.ts` — the same independent module `userConnections`
 * itself is required to import from, not retype — proving `graph_edges`
 * reuses `connectionTypeEnum`/`evidenceLabelEnum` verbatim rather than a
 * second, drifted enum.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { Table, getTableColumns, getTableName, is } from "drizzle-orm";

import * as schema from "@/db/schema";
import { CONNECTION_TYPES, EVIDENCE_LABELS } from "@/lib/contracts/study-v2";

/* eslint-disable @typescript-eslint/no-explicit-any --
 * Column objects are read generically here, matching schema-v2.test.ts's
 * own precedent — naming each drizzle internal column class would add
 * noise without adding safety. */

const migrationsDir = path.join(process.cwd(), "db", "migrations");
const MIGRATION_TAG = "0011_add_graph_edges_and_sources";

function columnsOf(table: Table): Record<string, any> {
  return getTableColumns(table) as unknown as Record<string, any>;
}

function readMigrationSql(): string {
  const file = fs
    .readdirSync(migrationsDir)
    .find((f) => f.startsWith(MIGRATION_TAG) && f.endsWith(".sql"));
  assert.ok(file, `expected a migration file starting with "${MIGRATION_TAG}"`);
  return fs.readFileSync(path.join(migrationsDir, file as string), "utf8");
}

// ---------------------------------------------------------------------------
// 1. Tables exist, exported, and named correctly
// ---------------------------------------------------------------------------

test("graphEdges and sources are real pgTables exported with the correct SQL names", () => {
  assert.ok(is(schema.graphEdges, Table), "schema.graphEdges should be a pgTable");
  assert.ok(is(schema.sources, Table), "schema.sources should be a pgTable");
  assert.equal(getTableName(schema.graphEdges), "graph_edges");
  assert.equal(getTableName(schema.sources), "sources");
});

// ---------------------------------------------------------------------------
// 2. graph_edges column shape
// ---------------------------------------------------------------------------

test("graph_edges.id is a text primary key", () => {
  const cols = columnsOf(schema.graphEdges);
  assert.ok(cols.id);
  assert.equal(cols.id.primary, true);
  assert.equal(cols.id.dataType, "string");
});

test("graph_edges.fromRange/toRange are NOT NULL jsonb columns, same pattern as userConnections", () => {
  const cols = columnsOf(schema.graphEdges);
  const userConnCols = columnsOf(schema.userConnections);

  for (const key of ["fromRange", "toRange"] as const) {
    assert.ok(cols[key], `graph_edges.${key} should exist`);
    assert.equal(cols[key].notNull, true, `graph_edges.${key} should be NOT NULL`);
    assert.equal(cols[key].dataType, "json", `graph_edges.${key} should be a jsonb column`);
    // Same underlying column type as userConnections' own fromRange/toRange —
    // proving this reuses the exact jsonb(...).$type<CanonicalRangeV1>()
    // pattern rather than inventing a second range representation.
    assert.equal(cols[key].columnType, userConnCols[key].columnType);
  }
  assert.equal(cols.fromRange.name, "from_range");
  assert.equal(cols.toRange.name, "to_range");
});

test("graph_edges.type reuses connectionTypeEnum verbatim (CONNECTION_TYPES from study-v2, not a second enum)", () => {
  const cols = columnsOf(schema.graphEdges);
  assert.ok(cols.type);
  assert.equal(cols.type.notNull, true);
  assert.equal(cols.type.name, "type");
  assert.deepEqual(cols.type.enumValues, [...CONNECTION_TYPES]);
  // Literally the same enum object userConnections.type uses, not a
  // same-values-but-separate pgEnum.
  assert.equal(cols.type.enumValues, columnsOf(schema.userConnections).type.enumValues);
});

test("graph_edges.evidenceLabel reuses evidenceLabelEnum verbatim (EVIDENCE_LABELS from study-v2)", () => {
  const cols = columnsOf(schema.graphEdges);
  assert.ok(cols.evidenceLabel);
  assert.equal(cols.evidenceLabel.notNull, true);
  assert.equal(cols.evidenceLabel.name, "evidence_label");
  assert.deepEqual(cols.evidenceLabel.enumValues, [...EVIDENCE_LABELS]);
  assert.equal(
    cols.evidenceLabel.enumValues,
    columnsOf(schema.userConnections).evidenceLabel.enumValues,
  );
});

test("graph_edges.sourceId is a NOT NULL text column named source_id", () => {
  const cols = columnsOf(schema.graphEdges);
  assert.ok(cols.sourceId);
  assert.equal(cols.sourceId.notNull, true);
  assert.equal(cols.sourceId.name, "source_id");
  assert.equal(cols.sourceId.dataType, "string");
});

test("graph_edges.communityVotes is a NOT NULL integer column, preserved verbatim (no import-time cutoff baked in)", () => {
  const cols = columnsOf(schema.graphEdges);
  assert.ok(cols.communityVotes);
  assert.equal(cols.communityVotes.notNull, true);
  assert.equal(cols.communityVotes.name, "community_votes");
  assert.equal(cols.communityVotes.dataType, "number");
});

test("graph_edges.createdAt is a NOT NULL, defaulted timestamp", () => {
  const cols = columnsOf(schema.graphEdges);
  assert.ok(cols.createdAt);
  assert.equal(cols.createdAt.notNull, true);
  assert.equal(cols.createdAt.name, "created_at");
  assert.notEqual(cols.createdAt.default, undefined);
});

// ---------------------------------------------------------------------------
// 3. The curated-vs-learner-owned contrast: graph_edges must NOT carry the
//    workspace/tenant/soft-delete/revision columns every v2 table above it
//    in schema.ts carries — BUILD_PLAN §3.3's "read-only release indexes"
//    rule, made into a real assertion instead of a comment.
// ---------------------------------------------------------------------------

test("graph_edges carries NO workspaceId/userId, NO revision, and NO soft-delete columns", () => {
  const cols = columnsOf(schema.graphEdges);
  assert.equal(cols.workspaceId, undefined, "graph_edges must not be workspace-scoped — curated content has no owner");
  assert.equal(cols.userId, undefined, "graph_edges must not be user-scoped");
  assert.equal(cols.revision, undefined, "graph_edges is never independently edited, so it has no revision counter");
  assert.equal(cols.updatedAt, undefined, "graph_edges rows are never updated in place — a correction ships as a new release");
  assert.equal(cols.deletedAt, undefined, "graph_edges has no soft delete — published curated rows are never mutated");
});

test("sources carries NO workspaceId/userId either — it is shared curated bibliography, not per-user data", () => {
  const cols = columnsOf(schema.sources);
  assert.equal(cols.workspaceId, undefined);
  assert.equal(cols.userId, undefined);
});

// ---------------------------------------------------------------------------
// 4. sources column shape (minimal: id, author, title, publisher, url,
//    licence, accessedAt — BUILD_PLAN §3.3's shape, deliberately NOT the
//    full sources+citations+content_reviews pipeline §5.1 describes)
// ---------------------------------------------------------------------------

test("sources has exactly the minimal BUILD_PLAN §3.3 columns, all NOT NULL", () => {
  const cols = columnsOf(schema.sources);
  const expected: Record<string, string> = {
    id: "id",
    author: "author",
    title: "title",
    publisher: "publisher",
    url: "url",
    licence: "licence",
    accessedAt: "accessed_at",
  };
  for (const [key, sqlName] of Object.entries(expected)) {
    assert.ok(cols[key], `sources.${key} should exist`);
    assert.equal(cols[key].name, sqlName);
    assert.equal(cols[key].notNull, true, `sources.${key} should be NOT NULL`);
  }
  assert.equal(cols.id.primary, true);
  // Deliberately NOT the full §5.1 pipeline: no citations, no content_reviews.
  assert.equal(cols.edition, undefined);
  assert.equal(cols.year, undefined);
});

// ---------------------------------------------------------------------------
// 5. Real constraints, proven against the generated migration SQL (the
//    same technique schema-v2.test.ts's own migration-0008 test uses) —
//    introspection alone cannot prove a real unique index or FK exists in
//    the database; the generated SQL is the source of truth for that.
// ---------------------------------------------------------------------------

test("migration 0011 creates a real UNIQUE index on graph_edges(from_range, to_range, type) — the idempotency guarantee", () => {
  const sql = readMigrationSql();
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "graph_edges_from_to_type_idx" ON "graph_edges" USING btree \("from_range","to_range","type"\);/,
  );
});

test("migration 0011 creates a real UNIQUE index on sources(url) — the seed-row idempotency guarantee", () => {
  const sql = readMigrationSql();
  assert.match(sql, /CREATE UNIQUE INDEX "sources_url_idx" ON "sources" USING btree \("url"\);/);
});

test("migration 0011 adds a real FK from graph_edges.source_id to sources.id", () => {
  const sql = readMigrationSql();
  assert.match(
    sql,
    /ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_source_id_sources_id_fk" FOREIGN KEY \("source_id"\) REFERENCES "public"\."sources"\("id"\)/,
  );
});

test("migration 0011 is purely additive (no DROP TABLE/COLUMN, no ALTER COLUMN TYPE, no DROP CONSTRAINT)", () => {
  const sql = readMigrationSql();
  assert.doesNotMatch(sql, /DROP TABLE/i);
  assert.doesNotMatch(sql, /DROP COLUMN/i);
  assert.doesNotMatch(sql, /ALTER COLUMN .* TYPE/i);
  assert.doesNotMatch(sql, /DROP CONSTRAINT/i);
});

test("migration 0011 is registered in the journal", () => {
  const raw = fs.readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8");
  const journal = JSON.parse(raw) as { entries: { tag: string }[] };
  assert.ok(
    journal.entries.some((entry) => entry.tag === MIGRATION_TAG),
    `journal should list an entry tagged "${MIGRATION_TAG}"`,
  );
});
