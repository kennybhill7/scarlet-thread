/**
 * SOURCESYNC-001 — tests for `lib/db/graphEdges.ts`'s new source-registry
 * sync/diff functions (`upsertSourceRegistryRows`, `diffAbsentIds`,
 * `findMissingSourceIds`).
 *
 * Same split this repo's own established discipline requires
 * (`tests/content-build.test.ts`'s header, `tests/graph-edges.test.ts`'s
 * header): `diffAbsentIds` is pure set-diff logic with no I/O, so it gets
 * real unit tests with plain fixtures, right here. `upsertSourceRegistryRows`
 * and `findMissingSourceIds` both require a live Postgres connection to
 * actually exercise, and this environment has no test database (this repo
 * has exactly one Postgres instance, production -- see
 * `scripts/sync-source-registry.mts`'s own header) -- so those two get
 * STRUCTURAL tests only: proven to be real exported functions of the right
 * shape/arity, the same "shape of your new functions/exports" discipline
 * `tests/graph-edges.test.ts` already established for GRAPHEDGES-001's own
 * DB-touching functions. No database connection is opened anywhere in this
 * file, and `DATABASE_URL` is never read.
 *
 * Author: Kenneth Hill
 */
import assert from "node:assert/strict";
import test from "node:test";

import { diffAbsentIds, findMissingSourceIds, upsertSourceRegistryRows } from "../lib/db/graphEdges";

// ===========================================================================
// diffAbsentIds — pure set-diff. This is the real-Postgres-row-check's core
// comparison logic, factored out of findMissingSourceIds specifically so it
// is unit-testable without a database connection.
// ===========================================================================

test("DIFF-ABSENT: returns ids present in required but absent from existing", () => {
  assert.deepEqual(diffAbsentIds(["a", "b", "c"], ["b"]), ["a", "c"]);
});

test("DIFF-ABSENT: returns an empty array when every required id already exists", () => {
  assert.deepEqual(diffAbsentIds(["a", "b"], ["a", "b", "c"]), []);
});

test("DIFF-ABSENT: dedupes the required list before diffing", () => {
  assert.deepEqual(diffAbsentIds(["a", "a", "b"], []), ["a", "b"]);
});

test("DIFF-ABSENT: result is sorted, independent of input order", () => {
  assert.deepEqual(diffAbsentIds(["c", "a", "b"], []), ["a", "b", "c"]);
});

test("DIFF-ABSENT: an empty required list returns an empty array regardless of existing", () => {
  assert.deepEqual(diffAbsentIds([], ["a", "b"]), []);
});

test("DIFF-ABSENT: an empty existing list means every required id is reported absent", () => {
  assert.deepEqual(diffAbsentIds(["a", "b"], []), ["a", "b"]);
});

test("DIFF-ABSENT: an id repeated in existing does not affect the result", () => {
  assert.deepEqual(diffAbsentIds(["a", "b"], ["a", "a", "a"]), ["b"]);
});

// ===========================================================================
// Structural: the DB-touching exports are real, correctly-shaped functions.
// Mirrors tests/graph-edges.test.ts's own introspection-only discipline for
// GRAPHEDGES-001's DB functions -- no database connection anywhere here.
// ===========================================================================

test("SHAPE: upsertSourceRegistryRows is an exported async function taking (db, entries[, chunkSize])", () => {
  assert.equal(typeof upsertSourceRegistryRows, "function");
  // .length counts parameters before the first one with a default value --
  // chunkSize has a default (DEFAULT_CHUNK_SIZE), so it is not counted here.
  assert.equal(upsertSourceRegistryRows.length, 2);
  assert.equal(upsertSourceRegistryRows.constructor.name, "AsyncFunction");
});

test("SHAPE: findMissingSourceIds is an exported async function taking (db, ids)", () => {
  assert.equal(typeof findMissingSourceIds, "function");
  assert.equal(findMissingSourceIds.length, 2);
  assert.equal(findMissingSourceIds.constructor.name, "AsyncFunction");
});
