/**
 * RADARPERSIST-001 — persistence-layer proof for `lib/db/radar.ts`'s new
 * `persistMotifCandidates` / `dismissMotifCandidate` / `promoteMotifCandidate`
 * functions, extending RADAR-001's pure-function tests (`tests/radar.test.ts`,
 * unmodified and still green — 12 tests, this file adds to that count rather
 * than touching it).
 *
 * Follows the in-memory-harness pattern `tests/tenant-isolation.test.ts`
 * established, at the smaller "PocketPg-lite" scale `tests/sync-v2-persist.test.ts`
 * already introduced for a v2-table module: real drizzle query builders
 * compiled to genuine SQL text via `PgDialect`, evaluated against an
 * in-memory store — only the tables and query shapes `lib/db/radar.ts`
 * actually issues (`select().from().where().limit()`, `insert().values()`,
 * `update().set().where()`, `batch()`), nothing `sync-v2-persist.test.ts`
 * didn't already need PLUS a genuine `update()` builder (ported from
 * `tests/tenant-isolation.test.ts`'s `makeUpdate`, which this module's
 * `dismissMotifCandidate`/`promoteMotifCandidate` both call and
 * `lib/db/sync-v2.ts` never did).
 *
 * Covers the acceptance criteria:
 *  - computed candidates persist as motif_candidates rows WITH their
 *    sightings, workspace-scoped
 *  - the system NEVER auto-promotes: three sightings alone create no thread
 *  - promotion requires an explicit learner confirmation
 *  - promotion is one atomic transaction: a mid-transaction failure (a real
 *    `threads (userId, slug)` primary-key collision, not a synthetic hook)
 *    leaves NO partial state
 *  - dismissing a candidate never deletes/touches the underlying sightings
 *    or entries
 *  - re-running the radar does not duplicate an existing candidate for the
 *    same normalized key in the same workspace
 *  - workspace scoping: two workspaces never dedup against each other
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { Column, SQL, Table, getTableColumns, getTableName, is } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import * as schema from "@/db/schema";
import type { Entry, EntryKind } from "@/lib/contracts";

/* eslint-disable @typescript-eslint/no-explicit-any --
 * PocketPg-lite's fluent facade must accept any drizzle builder call shape;
 * see tests/tenant-isolation.test.ts and tests/sync-v2-persist.test.ts, which
 * use the same pattern for the same reason. */

// ---------------------------------------------------------------------------
// 0. Bootstrap
// ---------------------------------------------------------------------------

const nodeRequire = createRequire(__filename);

function seedModule(specifier: string, exports: Record<string, unknown>) {
  const resolved = nodeRequire.resolve(specifier);
  (nodeRequire.cache as any)[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    path: path.dirname(resolved),
    paths: [],
    children: [],
    exports: { __esModule: true, ...exports },
  };
  return resolved;
}

seedModule("server-only", {});

// ---------------------------------------------------------------------------
// 1. Schema registry — only the tables lib/db/radar.ts's persistence
//    functions actually touch.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Predicate = { sql: string; params: unknown[] };

const clone = <T>(value: T): T => structuredClone(value);

class DatabaseError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "DatabaseError";
  }
}

type TableMeta = {
  table: Table;
  sqlName: string;
  columns: Record<string, Column>;
  propByColumn: Map<string, string>;
  primaryKey: string[];
};

const PRIMARY_KEYS: Record<string, string[]> = {
  workspaces: ["id"],
  threads: ["userId", "slug"],
  motif_candidates: ["id"],
  motif_sightings: ["id"],
};

const MODELLED_TABLES: Table[] = [
  schema.workspaces,
  schema.threads,
  schema.motifCandidates,
  schema.motifSightings,
];

const metaByTable = new Map<Table, TableMeta>();
const metaBySqlName = new Map<string, TableMeta>();

for (const table of MODELLED_TABLES) {
  const sqlName = getTableName(table);
  const columns = getTableColumns(table) as unknown as Record<string, Column>;
  const propByColumn = new Map<string, string>();
  for (const [prop, column] of Object.entries(columns)) {
    propByColumn.set(column.name, prop);
  }
  const meta: TableMeta = {
    table,
    sqlName,
    columns,
    propByColumn,
    primaryKey: PRIMARY_KEYS[sqlName] ?? [],
  };
  assert.ok(meta.primaryKey.length > 0, `no primary key registered for "${sqlName}"`);
  metaByTable.set(table, meta);
  metaBySqlName.set(sqlName, meta);
}

function metaOf(table: Table): TableMeta {
  const meta = metaByTable.get(table);
  if (!meta) throw new Error(`PocketPg-lite does not model table "${getTableName(table)}"`);
  return meta;
}

function normalizeRow(meta: TableMeta, row: Row): Row {
  const out: Row = {};
  for (const prop of Object.keys(meta.columns)) out[prop] = row[prop] ?? null;
  return out;
}

// ---------------------------------------------------------------------------
// 2. WHERE evaluator — single-table only (no joins are ever issued against
//    this harness), supporting exactly what lib/db/radar.ts emits: `=`,
//    `is null`, `and`. Ported verbatim from tests/sync-v2-persist.test.ts.
// ---------------------------------------------------------------------------

function evaluatePredicate(predicate: Predicate, row: Row, sqlName: string): boolean {
  const { sql, params } = predicate;
  let pos = 0;
  const fail = (reason: string): never => {
    throw new Error(`PocketPg-lite cannot evaluate SQL (${reason}) at offset ${pos} of: ${sql}`);
  };
  const skipSpaces = () => {
    while (pos < sql.length && sql[pos] === " ") pos += 1;
  };
  const eat = (text: string) => {
    if (!sql.startsWith(text, pos)) return false;
    pos += text.length;
    return true;
  };
  const parseOperand = (): unknown => {
    skipSpaces();
    if (sql[pos] === '"') {
      const match = /^"([a-z0-9_]+)"\."([a-z0-9_]+)"/.exec(sql.slice(pos));
      if (!match) return fail("malformed column reference");
      pos += match[0].length;
      const [, tableName, columnName] = match;
      if (tableName !== sqlName) return fail(`unexpected table "${tableName}" in single-table predicate`);
      const meta = metaBySqlName.get(tableName);
      if (!meta) return fail(`unknown table "${tableName}"`);
      const prop = meta.propByColumn.get(columnName);
      if (!prop) return fail(`unknown column "${tableName}"."${columnName}"`);
      return row[prop] ?? null;
    }
    if (sql[pos] === "$") {
      const match = /^\$(\d+)/.exec(sql.slice(pos));
      if (!match) return fail("malformed parameter");
      pos += match[0].length;
      const index = Number(match[1]) - 1;
      if (index < 0 || index >= params.length) return fail(`parameter $${match[1]} is out of range`);
      return params[index] ?? null;
    }
    return fail("expected a column reference or a parameter");
  };
  const equal = (left: unknown, right: unknown) => left !== null && right !== null && left === right;
  const parseComparison = (): boolean => {
    skipSpaces();
    const left = parseOperand();
    skipSpaces();
    if (eat("is not null")) return left !== null;
    if (eat("is null")) return left === null;
    if (eat("=")) return equal(left, parseOperand());
    return fail("unsupported operator");
  };
  const parseTerm = (): boolean => {
    skipSpaces();
    if (eat("(")) {
      const value = parseExpression();
      skipSpaces();
      if (!eat(")")) return fail('expected ")"');
      return value;
    }
    return parseComparison();
  };
  function parseExpression(): boolean {
    let value = parseTerm();
    for (;;) {
      skipSpaces();
      if (eat("and ")) {
        value = parseTerm() && value;
      } else {
        return value;
      }
    }
  }
  const result = parseExpression();
  skipSpaces();
  if (pos !== sql.length) fail("trailing tokens");
  return result;
}

// ---------------------------------------------------------------------------
// 3. PocketPg-lite — select().from().where().limit() / insert()... /
//    update().set().where() / batch()
// ---------------------------------------------------------------------------

const dialect = new PgDialect();
const world = new Map<string, Row[]>();

function resetWorld() {
  world.clear();
  for (const table of MODELLED_TABLES) world.set(getTableName(table), []);
}

const rowsOf = (sqlName: string): Row[] => {
  const rows = world.get(sqlName);
  if (!rows) throw new Error(`PocketPg-lite has no table "${sqlName}"`);
  return rows;
};

function compile(condition: SQL | undefined): Predicate | null {
  if (!condition) return null;
  const query = dialect.sqlToQuery(condition);
  return { sql: query.sql, params: query.params as unknown[] };
}

function applyDefaults(meta: TableMeta, input: Row): Row {
  const row: Row = {};
  const now = new Date().toISOString();
  for (const [prop, column] of Object.entries(meta.columns)) {
    const value = input[prop];
    if (value !== undefined) {
      row[prop] = value;
      continue;
    }
    const anyColumn = column as any;
    if (anyColumn.hasDefault) {
      row[prop] = is(anyColumn.default, SQL) ? now : clone(anyColumn.default ?? null);
    } else if (!column.notNull) {
      row[prop] = null;
    } else {
      throw new DatabaseError(
        `null value in column "${column.name}" of relation "${meta.sqlName}" violates not-null constraint`,
        "23502",
      );
    }
  }
  return normalizeRow(meta, row);
}

const keyOf = (meta: TableMeta, row: Row) => JSON.stringify(meta.primaryKey.map((prop) => row[prop]));

function makeSelect(fields: Record<string, unknown> | null) {
  let from: TableMeta | null = null;
  let where: Predicate | null = null;
  let limitCount: number | null = null;
  const builder: any = {
    from(table: Table) {
      from = metaOf(table);
      return builder;
    },
    where(condition: SQL | undefined) {
      where = compile(condition);
      return builder;
    },
    limit(count: number) {
      limitCount = count;
      return builder;
    },
    then: (resolve: any, reject: any) =>
      Promise.resolve()
        .then(() => {
          if (!from) throw new Error("PocketPg-lite received a select without from()");
          const meta = from;
          let rows = rowsOf(meta.sqlName);
          if (where) {
            const predicate = where;
            rows = rows.filter((row) => evaluatePredicate(predicate, row, meta.sqlName));
          }
          if (limitCount !== null) rows = rows.slice(0, limitCount);
          return rows.map((row) => {
            if (!fields) return clone(row);
            const out: Row = {};
            for (const [key, value] of Object.entries(fields)) {
              if (!is(value, Column)) {
                throw new Error(`PocketPg-lite does not model select field "${key}" of this shape`);
              }
              const prop = meta.propByColumn.get((value as Column).name);
              if (!prop) throw new Error(`unknown column ${meta.sqlName}.${(value as Column).name}`);
              out[key] = row[prop] ?? null;
            }
            return out;
          });
        })
        .then(resolve, reject),
  };
  return builder;
}

function makeInsert(table: Table) {
  const meta = metaOf(table);
  let inputs: Row[] = [];

  const execute = () => {
    const written: Row[] = [];
    for (const input of inputs) {
      const row = applyDefaults(meta, input);
      const rows = rowsOf(meta.sqlName);
      const existingIndex = rows.findIndex((candidate) => keyOf(meta, candidate) === keyOf(meta, row));
      if (existingIndex >= 0) {
        throw new DatabaseError(
          `duplicate key value violates unique constraint "${meta.sqlName}_pkey"`,
          "23505",
        );
      }
      rows.push(row);
      written.push(row);
    }
    return written;
  };

  const builder: any = {
    values(input: Row | Row[]) {
      inputs = Array.isArray(input) ? input : [input];
      return builder;
    },
    __execute: execute,
    then: (resolve: any, reject: any) => Promise.resolve().then(execute).then(resolve, reject),
  };
  return builder;
}

function makeUpdate(table: Table) {
  const meta = metaOf(table);
  let patch: Row = {};
  let where: Predicate | null = null;

  const execute = () => {
    const rows = rowsOf(meta.sqlName);
    const written: Row[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      if (where && !evaluatePredicate(where, rows[index], meta.sqlName)) continue;
      const merged = normalizeRow(meta, { ...rows[index], ...patch });
      rows[index] = merged;
      written.push(merged);
    }
    return written;
  };

  const builder: any = {
    set(values: Row) {
      patch = values;
      return builder;
    },
    where(condition: SQL | undefined) {
      where = compile(condition);
      return builder;
    },
    __execute: execute,
    then: (resolve: any, reject: any) => Promise.resolve().then(execute).then(resolve, reject),
  };
  return builder;
}

const snapshotWorld = () => new Map([...world].map(([name, rows]) => [name, rows.map(clone)]));
const restoreWorld = (snapshot: Map<string, Row[]>) => {
  world.clear();
  for (const [name, rows] of snapshot) world.set(name, rows.map(clone));
};

const pocketPg = {
  select: (fields?: Record<string, unknown>) => makeSelect(fields ?? null),
  insert: (table: Table) => makeInsert(table),
  update: (table: Table) => makeUpdate(table),
  /** Neon HTTP batch is one transaction — see lib/db/sync.ts's header comment
   *  and lib/db/radar.ts's promoteMotifCandidate, which relies on exactly
   *  this snapshot/restore behavior for its atomicity guarantee. */
  async batch(queries: any[]) {
    const snapshot = snapshotWorld();
    const results: unknown[] = [];
    try {
      for (const query of queries) results.push(await query.__execute());
    } catch (error) {
      restoreWorld(snapshot);
      throw error;
    }
    return results;
  },
};

seedModule("@/lib/db", { db: pocketPg });

// ---------------------------------------------------------------------------
// 4. Load the module under test AFTER seeding its one DB-touching dependency.
// ---------------------------------------------------------------------------

const radarPersist = nodeRequire("@/lib/db/radar.ts") as typeof import("@/lib/db/radar");
const {
  persistMotifCandidates,
  dismissMotifCandidate,
  promoteMotifCandidate,
  MotifPromotionNotConfirmedError,
  MotifThreadSlugCollisionError,
  MOTIF_CANDIDATE_PENDING_STATUS,
  MOTIF_CANDIDATE_DISMISSED_STATUS,
  MOTIF_CANDIDATE_PROMOTED_STATUS,
  MOTIF_SIGHTING_PENDING_STATUS,
  MOTIF_SIGHTING_PROMOTED_STATUS,
} = radarPersist;

// ---------------------------------------------------------------------------
// 5. Fixtures
// ---------------------------------------------------------------------------

let idCounter = 0;
function mkEntry(overrides: Partial<Entry> & Pick<Entry, "body" | "chapter">): Entry {
  idCounter += 1;
  return {
    id: `e-${idCounter}`,
    kind: "observation" as EntryKind,
    threads: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Three distinct-passage entries for the word "covenant" — the same shape
 * tests/radar.test.ts's own "three distinct passages promote a word to a
 * candidate" fixture uses, reconstructed independently here per this repo's
 * self-contained-test-file convention. */
function threeCovenantEntries(): Entry[] {
  return [
    mkEntry({ body: "a covenant renewed here", chapter: "1.1" }),
    mkEntry({ body: "another covenant sighting", chapter: "2.1", kind: "question" }),
    mkEntry({ body: "covenant language a third time", chapter: "3.1" }),
  ];
}

function seedWorkspace(id: string, createdBy: string) {
  rowsOf("workspaces").push({
    id,
    kind: "personal",
    name: `${createdBy}'s workspace`,
    createdBy,
    createdAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  });
}

test.beforeEach(() => {
  resetWorld();
  idCounter = 0;
  seedWorkspace("workspace-a", "user-a");
  seedWorkspace("workspace-b", "user-b");
});

// ---------------------------------------------------------------------------
// 6. Tests
// ---------------------------------------------------------------------------

test("computed candidates persist as a motif_candidates row plus one motif_sightings row per passage, workspace-scoped", async () => {
  const entries = threeCovenantEntries();
  const result = await persistMotifCandidates("workspace-a", entries, []);

  assert.equal(result.length, 1);
  assert.equal(result[0].normalizedKey, "covenant");
  assert.equal(result[0].created, true);
  assert.equal(result[0].sightingCount, 3);

  assert.equal(rowsOf("motif_candidates").length, 1);
  const [candidateRow] = rowsOf("motif_candidates");
  assert.equal(candidateRow.workspaceId, "workspace-a");
  assert.equal(candidateRow.label, "covenant");
  assert.equal(candidateRow.normalizedKey, "covenant");
  assert.equal(candidateRow.status, MOTIF_CANDIDATE_PENDING_STATUS);

  const sightingRows = rowsOf("motif_sightings");
  assert.equal(sightingRows.length, 3);
  const passageUnitKeys = sightingRows.map((r) => r.passageUnitKey).sort();
  assert.deepEqual(passageUnitKeys, ["1.1", "2.1", "3.1"]);
  for (const row of sightingRows) {
    assert.equal(row.workspaceId, "workspace-a");
    assert.equal(row.candidateId, candidateRow.id);
    assert.equal(row.status, MOTIF_SIGHTING_PENDING_STATUS);
    assert.ok(row.entryId, "each sighting must carry a real entryId");
    assert.ok(
      entries.some((e) => e.id === row.entryId),
      "the sighting's entryId must be one of the entries actually passed in",
    );
  }
});

test("reaching three sightings alone offers promotion but NEVER creates a thread", async () => {
  await persistMotifCandidates("workspace-a", threeCovenantEntries(), []);

  assert.equal(rowsOf("threads").length, 0, "no thread may exist before an explicit promotion call");
  const [candidateRow] = rowsOf("motif_candidates");
  assert.equal(candidateRow.status, MOTIF_CANDIDATE_PENDING_STATUS, "the candidate must stay unresolved");
});

test("promotion without an explicit learner confirmation is refused and changes nothing", async () => {
  await persistMotifCandidates("workspace-a", threeCovenantEntries(), []);
  const [candidateRow] = rowsOf("motif_candidates");
  const before = snapshotWorld();

  await assert.rejects(
    () =>
      promoteMotifCandidate("workspace-a", "user-a", candidateRow.id as string, {
        learnerConfirmed: false,
      }),
    MotifPromotionNotConfirmedError,
  );

  assert.deepEqual(world, before, "an unconfirmed promotion attempt must not touch the database at all");
});

test("a confirmed promotion is one atomic write: creates the thread and rewrites all three sightings", async () => {
  await persistMotifCandidates("workspace-a", threeCovenantEntries(), []);
  const [candidateRow] = rowsOf("motif_candidates");

  const result = await promoteMotifCandidate("workspace-a", "user-a", candidateRow.id as string, {
    learnerConfirmed: true,
  });

  assert.equal(result.threadSlug, "covenant");
  assert.equal(result.threadTitle, "covenant");
  assert.equal(result.sightingCount, 3);

  assert.equal(rowsOf("threads").length, 1);
  const [threadRow] = rowsOf("threads");
  assert.equal(threadRow.userId, "user-a");
  assert.equal(threadRow.slug, "covenant");

  const [updatedCandidate] = rowsOf("motif_candidates");
  assert.equal(updatedCandidate.status, MOTIF_CANDIDATE_PROMOTED_STATUS);
  assert.equal(updatedCandidate.revision, 2, "the candidate's revision must advance");

  const sightingRows = rowsOf("motif_sightings");
  assert.equal(sightingRows.length, 3);
  for (const row of sightingRows) {
    assert.equal(row.status, MOTIF_SIGHTING_PROMOTED_STATUS, "every sighting must be rewritten to promoted");
    assert.equal(row.revision, 2, "every sighting's revision must advance");
  }
});

test("mid-transaction failure: a colliding thread slug rolls back the candidate and sighting updates that ran ahead of it", async () => {
  await persistMotifCandidates("workspace-a", threeCovenantEntries(), []);
  const [candidateRow] = rowsOf("motif_candidates");

  // A thread named "covenant" already exists for user-a (independently
  // hand-created, or a genuine concurrent-promotion race) — colliding with
  // the (userId, slug) primary key promotion is about to insert.
  rowsOf("threads").push({
    userId: "user-a",
    slug: "covenant",
    title: "Covenant (hand-made)",
    definition: "",
    seeing: "",
    createdAt: "2025-06-01T00:00:00.000Z",
    updatedAt: "2025-06-01T00:00:00.000Z",
    deletedAt: null,
  });
  const beforeAttempt = snapshotWorld();

  await assert.rejects(
    () =>
      promoteMotifCandidate("workspace-a", "user-a", candidateRow.id as string, {
        learnerConfirmed: true,
      }),
    MotifThreadSlugCollisionError,
  );

  // The candidate-status update and every sighting-status update are EARLIER
  // in promoteMotifCandidate's batch array than the failing thread insert —
  // if they were not wrapped in the same db.batch() call, they would already
  // be committed at this point. Proving they are NOT is the actual point of
  // this test (see the mutation proof in the builder's commit message).
  assert.deepEqual(
    world,
    beforeAttempt,
    "a failure anywhere in the promotion batch must leave the ENTIRE world exactly as it was before the attempt",
  );
  assert.equal(rowsOf("threads").length, 1, "only the pre-existing thread may remain -- no second row");
  const [candidateAfter] = rowsOf("motif_candidates");
  assert.equal(candidateAfter.status, MOTIF_CANDIDATE_PENDING_STATUS);
  assert.equal(candidateAfter.revision, 1);
  for (const row of rowsOf("motif_sightings")) {
    assert.equal(row.status, MOTIF_SIGHTING_PENDING_STATUS);
    assert.equal(row.revision, 1);
  }
});

test("dismissing a candidate marks it dismissed and never touches its sightings or the underlying entries", async () => {
  const entries = threeCovenantEntries();
  const entriesBefore = clone(entries);
  await persistMotifCandidates("workspace-a", entries, []);
  const [candidateRow] = rowsOf("motif_candidates");
  const sightingsBefore = clone(rowsOf("motif_sightings"));

  await dismissMotifCandidate("workspace-a", candidateRow.id as string);

  const [candidateAfter] = rowsOf("motif_candidates");
  assert.equal(candidateAfter.status, MOTIF_CANDIDATE_DISMISSED_STATUS);
  assert.equal(candidateAfter.revision, 2);

  assert.deepEqual(
    rowsOf("motif_sightings"),
    sightingsBefore,
    "dismissing a candidate must not touch a single sighting row",
  );
  assert.deepEqual(
    entries,
    entriesBefore,
    "the caller's own entries array must never be mutated by a dismiss call",
  );
  // Structural guarantee, not just a behavioral one: this harness never
  // registered an "entries" table at all, so dismissMotifCandidate could not
  // have issued any query against one without this whole test throwing.
  assert.ok(!world.has("entries"));
});

test("re-running the radar does not duplicate an existing candidate for the same normalized key in the same workspace", async () => {
  const firstRun = await persistMotifCandidates("workspace-a", threeCovenantEntries(), []);
  assert.equal(firstRun[0].created, true);
  assert.equal(rowsOf("motif_candidates").length, 1);
  assert.equal(rowsOf("motif_sightings").length, 3);

  // Re-run the radar against MORE entries mentioning the same word in a
  // fourth distinct passage -- still must not create a second candidate row.
  const grownEntries = [
    ...threeCovenantEntries(),
    mkEntry({ body: "covenant appears a fourth time", chapter: "4.1" }),
  ];
  const secondRun = await persistMotifCandidates("workspace-a", grownEntries, []);
  assert.equal(secondRun.length, 1);
  assert.equal(secondRun[0].created, false, "an existing live candidate must be reported, not re-created");
  assert.equal(secondRun[0].id, firstRun[0].id);

  assert.equal(rowsOf("motif_candidates").length, 1, "no duplicate candidate row for the same normalizedKey");
  assert.equal(rowsOf("motif_sightings").length, 3, "the existing candidate's sightings are left untouched");
});

test("workspace scoping: two workspaces never dedup against each other, and promoting in one never touches the other", async () => {
  const summaryA = await persistMotifCandidates("workspace-a", threeCovenantEntries(), []);
  const summaryB = await persistMotifCandidates("workspace-b", threeCovenantEntries(), []);

  assert.equal(summaryA[0].created, true);
  assert.equal(summaryB[0].created, true);
  assert.notEqual(summaryA[0].id, summaryB[0].id, "each workspace must get its own candidate row");
  assert.equal(rowsOf("motif_candidates").length, 2);
  assert.equal(rowsOf("motif_sightings").length, 6);

  await promoteMotifCandidate("workspace-a", "user-a", summaryA[0].id, { learnerConfirmed: true });

  const candidateBRow = rowsOf("motif_candidates").find((r) => r.workspaceId === "workspace-b")!;
  assert.equal(candidateBRow.status, MOTIF_CANDIDATE_PENDING_STATUS, "workspace-b's candidate must be untouched");
  const sightingsB = rowsOf("motif_sightings").filter((r) => r.workspaceId === "workspace-b");
  assert.equal(sightingsB.length, 3);
  for (const row of sightingsB) assert.equal(row.status, MOTIF_SIGHTING_PENDING_STATUS);

  assert.equal(rowsOf("threads").length, 1);
  assert.equal(rowsOf("threads")[0].userId, "user-a");
});
