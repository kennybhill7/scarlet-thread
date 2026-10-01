/**
 * PLACES-001 — structural proof for the three place tables (`places`,
 * `place_candidates`, `place_passages`; PRODUCT_EXPERIENCE_PLAN §C.1) and
 * migration 0014. Same discipline as `tests/graph-edges.test.ts`: no database
 * connection anywhere (drizzle introspection against the real `db/schema.ts`
 * exports, plus text checks against the real drizzle-kit-generated migration
 * SQL and its journal entry).
 *
 * The honesty rules are CHECK constraints (plan G5); each is asserted twice:
 * present by name in the table config, and present in the migration SQL with
 * its actual predicate text, so dropping or weakening one changes an assertion.
 *
 * Author: Kenneth Hill
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { Table, getTableColumns, getTableName, is } from "drizzle-orm";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import * as schema from "@/db/schema";

/* eslint-disable @typescript-eslint/no-explicit-any -- generic drizzle column reads, same as graph-edges.test.ts */

const migrationsDir = path.join(process.cwd(), "db", "migrations");
const MIGRATION_TAG = "0014_add_places";

function columnsOf(table: Table): Record<string, any> {
  return getTableColumns(table) as unknown as Record<string, any>;
}

function readMigrationSql(): string {
  const file = fs.readdirSync(migrationsDir).find((f) => f.startsWith(MIGRATION_TAG) && f.endsWith(".sql"));
  assert.ok(file, `expected a migration file starting with "${MIGRATION_TAG}"`);
  return fs.readFileSync(path.join(migrationsDir, file as string), "utf8");
}

const dialect = new PgDialect();
const renderCheck = (value: SQL) => dialect.sqlToQuery(value).sql;

test("places, place_candidates and place_passages are real pgTables with the correct SQL names", () => {
  for (const [table, name] of [
    [schema.places, "places"],
    [schema.placeCandidates, "place_candidates"],
    [schema.placePassages, "place_passages"],
  ] as const) {
    assert.ok(is(table, Table));
    assert.equal(getTableName(table), name);
  }
});

test("place_kind / place_tier are pgEnums with the plan's exact values", () => {
  assert.equal(schema.placeKindEnum.enumName, "place_kind");
  assert.equal(schema.placeTierEnum.enumName, "place_tier");
  assert.deepEqual([...schema.placeKindEnum.enumValues], ["point", "region", "route", "water", "unlocated"]);
  assert.deepEqual([...schema.placeTierEnum.enumValues], ["identified", "likely", "uncertain", "disputed", "unlocated"]);
  assert.deepEqual([...schema.PLACE_KINDS], [...schema.placeKindEnum.enumValues]);
  assert.deepEqual([...schema.PLACE_TIERS], [...schema.placeTierEnum.enumValues]);
  const cols = columnsOf(schema.places);
  assert.deepEqual(cols.kind.enumValues, [...schema.PLACE_KINDS]);
  assert.deepEqual(cols.tier.enumValues, [...schema.PLACE_TIERS]);
});

test("places columns: plan §C.1 shape, coordinates nullable, everything else NOT NULL where the plan says so", () => {
  const cols = columnsOf(schema.places);
  const expected: Record<string, string> = {
    id: "id",
    name: "name",
    ancientId: "ancient_id",
    kind: "kind",
    tier: "tier",
    lon: "lon",
    lat: "lat",
    coordinateBasis: "coordinate_basis",
    modernName: "modern_name",
    note: "note",
    sourceId: "source_id",
    datasetScore: "dataset_score",
    voteCount: "vote_count",
    identificationsInDataset: "identifications_in_dataset",
    releaseId: "release_id",
    createdAt: "created_at",
  };
  assert.deepEqual(Object.keys(cols).sort(), Object.keys(expected).sort());
  for (const [key, sqlName] of Object.entries(expected)) assert.equal(cols[key].name, sqlName);
  assert.equal(cols.id.primary, true);
  for (const key of ["lon", "lat", "coordinateBasis", "modernName", "note", "releaseId"]) {
    assert.equal(cols[key].notNull, false, `places.${key} must be nullable`);
  }
  for (const key of ["name", "ancientId", "kind", "tier", "sourceId", "datasetScore", "voteCount", "identificationsInDataset"]) {
    assert.equal(cols[key].notNull, true, `places.${key} must be NOT NULL`);
  }
  assert.equal(cols.lon.dataType, "number");
  assert.equal(cols.lat.dataType, "number");
  // Curated table: no tenancy, no soft delete, no revision (same contrast as graph_edges).
  for (const key of ["workspaceId", "userId", "deletedAt", "revision", "updatedAt"]) assert.equal(cols[key], undefined);
});

test("place_passages.range is a NOT NULL jsonb CanonicalRangeV1 column, same underlying type as graph_edges.from_range", () => {
  const cols = columnsOf(schema.placePassages);
  assert.equal(cols.range.notNull, true);
  assert.equal(cols.range.dataType, "json");
  assert.equal(cols.range.columnType, columnsOf(schema.graphEdges).fromRange.columnType);
  assert.equal(cols.inDatasetVerseList.notNull, true);
  assert.equal(cols.note.notNull, false);
});

test("place_candidates carries coordinates as NOT NULL (a candidate without a location is not a candidate)", () => {
  const cols = columnsOf(schema.placeCandidates);
  for (const key of ["placeId", "ordinal", "description", "lon", "lat", "score"]) assert.equal(cols[key].notNull, true, key);
});

test("the honesty rules are named CHECK constraints on places", () => {
  const names = getTableConfig(schema.places as any).checks.map((check: any) => check.name).sort();
  assert.deepEqual(names, [
    "places_coords_paired_check",
    "places_coords_range_check",
    "places_kind_unlocated_iff_tier_check",
    "places_located_has_coords_check",
    "places_unlocated_no_coords_check",
  ]);
});

test("CHECK predicates say what the rules say (tier unlocated => lon/lat NULL; both null or both set)", () => {
  const byName = Object.fromEntries(
    getTableConfig(schema.places as any).checks.map((check: any) => [check.name, renderCheck(check.value)]),
  );
  assert.match(byName.places_unlocated_no_coords_check, /"tier" <> 'unlocated' OR \("places"\."lon" IS NULL AND "places"\."lat" IS NULL\)/);
  assert.match(byName.places_located_has_coords_check, /"tier" = 'unlocated' OR \("places"\."lon" IS NOT NULL AND "places"\."lat" IS NOT NULL\)/);
  assert.match(byName.places_coords_paired_check, /\("places"\."lon" IS NULL\) = \("places"\."lat" IS NULL\)/);
  assert.match(byName.places_coords_range_check, /BETWEEN -180 AND 180/);
  assert.match(byName.places_coords_range_check, /BETWEEN -90 AND 90/);
  assert.match(byName.places_kind_unlocated_iff_tier_check, /"kind" = 'unlocated'\) = \("places"\."tier" = 'unlocated'\)/);
});

test("places.source_id is a real FK to sources.id (restrict); children cascade from places.id", () => {
  const fks = (table: any) => getTableConfig(table).foreignKeys.map((fk: any) => fk.reference());
  const placeFks = fks(schema.places);
  const sourceFk = placeFks.find((ref: any) => ref.columns[0].name === "source_id");
  assert.ok(sourceFk, "places.source_id FK");
  assert.equal(getTableName(sourceFk.foreignTable), "sources");
  assert.equal(sourceFk.foreignColumns[0].name, "id");
  for (const table of [schema.placeCandidates, schema.placePassages]) {
    const ref = fks(table).find((r: any) => r.columns[0].name === "place_id");
    assert.ok(ref, `${getTableName(table)}.place_id FK`);
    assert.equal(getTableName(ref.foreignTable), "places");
  }
  const sql = readMigrationSql();
  assert.match(sql, /"places_source_id_sources_id_fk" FOREIGN KEY \("source_id"\) REFERENCES "public"\."sources"\("id"\) ON DELETE restrict/);
  assert.match(sql, /"place_passages_place_id_places_id_fk" FOREIGN KEY \("place_id"\) REFERENCES "public"\."places"\("id"\) ON DELETE cascade/);
  assert.match(sql, /"place_candidates_place_id_places_id_fk" FOREIGN KEY \("place_id"\) REFERENCES "public"\."places"\("id"\) ON DELETE cascade/);
});

test("migration 0014 creates UNIQUE (place_id, range) on place_passages", () => {
  assert.match(
    readMigrationSql(),
    /CREATE UNIQUE INDEX "place_passages_place_range_idx" ON "place_passages" USING btree \("place_id","range"\);/,
  );
});

test("migration 0014 carries the CHECK predicates and the enums", () => {
  const sql = readMigrationSql();
  assert.match(sql, /CREATE TYPE "public"\."place_kind" AS ENUM\('point', 'region', 'route', 'water', 'unlocated'\)/);
  assert.match(sql, /CREATE TYPE "public"\."place_tier" AS ENUM\('identified', 'likely', 'uncertain', 'disputed', 'unlocated'\)/);
  assert.match(sql, /CONSTRAINT "places_unlocated_no_coords_check" CHECK \("places"\."tier" <> 'unlocated' OR \("places"\."lon" IS NULL AND "places"\."lat" IS NULL\)\)/);
  assert.match(sql, /CONSTRAINT "places_coords_paired_check" CHECK \(\("places"\."lon" IS NULL\) = \("places"\."lat" IS NULL\)\)/);
});

test("migration 0014 is purely additive and touches no learner-owned table (no lesson_places, no claim_evidence change)", () => {
  const sql = readMigrationSql();
  assert.doesNotMatch(sql, /DROP (TABLE|COLUMN|CONSTRAINT|TYPE|INDEX)/i);
  assert.doesNotMatch(sql, /ALTER COLUMN/i);
  assert.doesNotMatch(sql, /lesson_places/);
  assert.doesNotMatch(sql, /claim_evidence/);
  const touched = [...sql.matchAll(/(?:CREATE TABLE|ALTER TABLE) "([a-z_]+)"/g)].map((m) => m[1]);
  for (const table of touched) assert.ok(["places", "place_candidates", "place_passages"].includes(table), `touches ${table}`);
});

test("journal registers 0014_add_places as the last entry, idx 14, with a timestamp after 0013", () => {
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string; when: number }[];
  };
  const last = journal.entries[journal.entries.length - 1];
  assert.equal(last.tag, MIGRATION_TAG);
  assert.equal(last.idx, 14);
  assert.ok(last.when > journal.entries[journal.entries.length - 2].when);
  assert.ok(fs.existsSync(path.join(migrationsDir, "meta", "0014_snapshot.json")));
});
