/**
 * SYNCPERSIST-001 — persistence-layer proof for `lib/db/sync-v2.ts`.
 *
 * Follows the in-memory-harness pattern `tests/tenant-isolation.test.ts`
 * established (real drizzle query builders compiled to genuine SQL text via
 * `PgDialect`, evaluated against an in-memory store) rather than a hand
 * reimplementation of the persistence logic, which is exactly the shape of
 * mock that could pass while production leaks. This harness is a smaller,
 * purpose-built "PocketPg-lite": only the v2 tables `lib/db/sync-v2.ts`
 * actually touches (`workspaces` plus the six v2 entity tables and
 * `sync_receipts`), and only the query shapes it actually issues
 * (`select().from().where().limit(1)`, `insert().values().onConflictDoUpdate/
 * onConflictDoNothing()`, `batch()`) — no joins, update(), or delete() are
 * needed because `lib/db/sync-v2.ts` never calls them.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { Column, SQL, Table, getTableColumns, getTableName, is } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import * as schema from "@/db/schema";
import { CANONICAL_VERSIFICATION_ID } from "@/lib/contracts/range-v1";
import { SYNC_ENTITIES_V2, type SyncEntityV2, type SyncOpV2 } from "@/lib/contracts/sync-v2";

/* eslint-disable @typescript-eslint/no-explicit-any --
 * PocketPg-lite's fluent facade must accept any drizzle builder call shape;
 * see tests/tenant-isolation.test.ts, which uses the same pattern for the
 * same reason. */

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
// 1. Schema registry — only the tables lib/db/sync-v2.ts touches.
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
  study_sessions: ["id"],
  study_claims: ["id"],
  motif_candidates: ["id"],
  user_connections: ["id"],
  applications: ["id"],
  teaching_drafts: ["id"],
  teaching_sections: ["id"],
  claim_evidence: ["id"],
  motif_sightings: ["id"],
  sync_receipts: ["userId", "opId"],
};

const MODELLED_TABLES: Table[] = [
  schema.workspaces,
  schema.studySessions,
  schema.studyClaims,
  schema.motifCandidates,
  schema.userConnections,
  schema.applications,
  schema.teachingDrafts,
  schema.teachingSections,
  schema.claimEvidence,
  schema.motifSightings,
  schema.syncReceipts,
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
//    this harness), supporting exactly what lib/db/sync-v2.ts emits: `=`,
//    `is null`, `and`.
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
// 3. PocketPg-lite — select().from().where().limit(1) / insert()... / batch()
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

function targetProps(meta: TableMeta, target: unknown): string[] {
  const columns = Array.isArray(target) ? target : [target];
  return columns.map((column) => {
    if (!is(column, Column)) throw new Error("PocketPg-lite does not model this onConflict target");
    const prop = meta.propByColumn.get((column as Column).name);
    if (!prop) throw new Error(`unknown conflict target column ${(column as Column).name}`);
    return prop;
  });
}

function makeInsert(table: Table) {
  const meta = metaOf(table);
  let inputs: Row[] = [];
  let conflict: { kind: "nothing" } | { kind: "update"; set: Row } | null = null;

  const execute = () => {
    const written: Row[] = [];
    for (const input of inputs) {
      const row = applyDefaults(meta, input);
      const rows = rowsOf(meta.sqlName);
      const existingIndex = rows.findIndex((candidate) => keyOf(meta, candidate) === keyOf(meta, row));
      if (existingIndex >= 0) {
        if (conflict === null) {
          throw new DatabaseError(
            `duplicate key value violates unique constraint "${meta.sqlName}_pkey"`,
            "23505",
          );
        }
        if (conflict.kind === "nothing") continue;
        const merged = normalizeRow(meta, { ...rows[existingIndex], ...conflict.set });
        rows[existingIndex] = merged;
        written.push(merged);
        continue;
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
    onConflictDoNothing() {
      conflict = { kind: "nothing" };
      return builder;
    },
    onConflictDoUpdate(config: { target: unknown; set: Row }) {
      const target = targetProps(meta, config.target);
      const sorted = [...target].sort().join(",");
      if (sorted !== [...meta.primaryKey].sort().join(",")) {
        throw new Error(`PocketPg-lite only models onConflict against the primary key of "${meta.sqlName}"`);
      }
      conflict = { kind: "update", set: config.set };
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
  /** Neon HTTP batch is one transaction — see lib/db/sync.ts's header comment
   *  and lib/db/sync-v2.ts's, which this mirrors exactly. */
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
// 4. Load the module under test AFTER seeding its two dependencies.
// ---------------------------------------------------------------------------

const syncV2Persist = nodeRequire("@/lib/db/sync-v2.ts") as typeof import("@/lib/db/sync-v2");
const { pushSyncOpsV2 } = syncV2Persist;

// ---------------------------------------------------------------------------
// 5. Fixtures — mirrors tests/sync-v2.test.ts's fixture shapes (independently
//    reconstructed here, not imported, since that file exports nothing and
//    each test file in this repo is self-contained).
// ---------------------------------------------------------------------------

function uuid(n: number): string {
  const suffix = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${suffix}`;
}

function range(start: string, end: string) {
  return { versificationId: CANONICAL_VERSIFICATION_ID, start, end };
}

const TS = "2026-01-01T00:00:00Z";
const TS2 = "2026-01-02T00:00:00Z";

function validSessionPayload(overrides: Row = {}) {
  return {
    id: "session-1",
    workspaceId: "workspace-a",
    range: range("1.1.1", "1.1.1"),
    mode: "encounter",
    workflowState: "active",
    connectionState: "unexamined",
    catalogReleaseId: null,
    readGateAt: null,
    currentStep: "read",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
}

function validClaimPayload(overrides: Row = {}) {
  return {
    id: "claim-1",
    workspaceId: "workspace-a",
    sessionId: "session-1",
    kind: "observation",
    epistemicBasis: "text_explicit",
    body: "God created the heavens and the earth.",
    passage: range("1.1.1", "1.1.1"),
    confidence: "tentative",
    provenance: "learner",
    doctrineStatus: null,
    viewpointId: null,
    status: "draft",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
}

function validMotifPayload(overrides: Row = {}) {
  return {
    id: "motif-1",
    workspaceId: "workspace-a",
    label: "Seed of the woman",
    normalizedKey: "seed-of-the-woman",
    status: "candidate",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
}

function validConnectionPayload(overrides: Row = {}) {
  return {
    id: "connection-1",
    workspaceId: "workspace-a",
    fromRange: range("1.3.15", "1.3.15"),
    toRange: range("40.1.1", "40.1.1"),
    type: "promise_fulfillment",
    evidenceLabel: "strong",
    rationale: "Genesis 3:15's seed promise finds its fulfillment pattern here.",
    threadSlug: null,
    status: "draft",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
}

function validApplicationPayload(overrides: Row = {}) {
  return {
    id: "application-1",
    workspaceId: "workspace-a",
    sessionId: "session-1",
    sourceClaimId: "claim-1",
    originalAudienceMeaning: "Original audience meaning.",
    enduringPrinciple: "Enduring principle.",
    canonicalBridge: "Bridge from then to now.",
    applicationClass: "personal",
    promiseScope: "individual",
    modernDomain: "work",
    situation: "A Monday-morning decision.",
    responseType: "belief",
    faithfulResponse: "Trust the promise.",
    cautions: "",
    availableAfter: null,
    status: "draft",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
}

function validTeachingDraftPayload(overrides: Row = {}) {
  return {
    id: "teaching-1",
    workspaceId: "workspace-a",
    sessionId: "session-1",
    title: "The Seed Promise",
    bigIdea: "God keeps his promises across centuries.",
    audience: "adults",
    durationMinutes: 15,
    gospelConnection: "The seed of the woman is Christ.",
    status: "draft",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
}

function validTeachingSectionPayload(overrides: Row = {}) {
  return {
    id: "section-1",
    workspaceId: "workspace-a",
    draftId: "teaching-1",
    kind: "outline",
    sortOrder: 0,
    body: "I. The seed promise in Genesis 3:15.",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
}


/**
 * SYNCGAP-001 made claim_evidence and motif_sightings their own sync entities,
 * each naming its parent by id rather than nesting as an aggregate child. These
 * two fixtures are the integration piece: this table is keyed by SyncEntityV2,
 * so growing the contract to eight made the type error demand them rather than
 * letting the suite pass six-of-eight silently.
 */
function validEvidencePayload(overrides: Row = {}) {
  return {
    id: "evidence-1",
    workspaceId: "workspace-a",
    claimId: "claim-1",
    evidenceType: "passage",
    note: "Genesis 3:15 names the seed.",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
}

function validMotifSightingPayload(overrides: Row = {}) {
  return {
    id: "sighting-1",
    workspaceId: "workspace-a",
    candidateId: "motif-1",
    passageUnitKey: "gen-3",
    exactRange: { versificationId: "eng-protestant-66-31102-v1", start: "1.3.15", end: "1.3.15" },
    entryId: null,
    claimId: null,
    status: "counting",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
}

const validPayloadByEntity: Record<SyncEntityV2, (overrides?: Row) => Row> = {
  session: validSessionPayload,
  claim: validClaimPayload,
  motif: validMotifPayload,
  connection: validConnectionPayload,
  evidence: validEvidencePayload,
  motifSighting: validMotifSightingPayload,
  application: validApplicationPayload,
  teachingDraft: validTeachingDraftPayload,
  teachingSection: validTeachingSectionPayload,
};

function makeOp(entity: SyncEntityV2, overrides: Partial<SyncOpV2> = {}): SyncOpV2 {
  const payload = (overrides.payload as Row) ?? validPayloadByEntity[entity]();
  return {
    opId: uuid(1),
    deviceId: uuid(2),
    entity,
    entityId: payload.id as string,
    mutation: "upsert",
    baseRevision: null,
    mutationGroupId: uuid(3),
    dependsOn: [],
    payload,
    clientTime: TS,
    ...overrides,
  };
}

function seedWorkspace(id: string, createdBy: string) {
  rowsOf("workspaces").push({
    id,
    kind: "personal",
    name: `${createdBy}'s workspace`,
    createdBy,
    createdAt: TS,
    deletedAt: null,
  });
}

/**
 * MOTIFSTATUS-001 — seeds a `motif_candidates` row DIRECTLY into the world,
 * bypassing `pushSyncOpsV2` entirely. Necessary specifically because an
 * already-promoted candidate is exactly the state this task makes
 * unreachable *through* sync push (that is the bug being fixed) — the only
 * way to set up "a candidate that is already promoted" for a test is to
 * plant it, the same way a real promoted candidate would only ever get
 * there via `promoteMotifCandidate` (`lib/db/radar.ts`), never via this
 * module.
 */
function seedMotifCandidate(overrides: Row = {}): Row {
  const row: Row = {
    id: "motif-1",
    workspaceId: "workspace-a",
    label: "Seed of the woman",
    normalizedKey: "seed-of-the-woman",
    status: "candidate",
    threadSlug: null,
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
  rowsOf("motif_candidates").push(row);
  return row;
}

// ---------------------------------------------------------------------------
// 6. Tests
// ---------------------------------------------------------------------------

test.beforeEach(() => {
  resetWorld();
  seedWorkspace("workspace-a", "user-a");
  seedWorkspace("workspace-b", "user-b");
});

test("every v2 entity applies a valid create (baseRevision null) into its own table", async () => {
  for (const entity of SYNC_ENTITIES_V2) {
    const op = makeOp(entity, { opId: uuid(100 + SYNC_ENTITIES_V2.indexOf(entity)) });
    const rejected = await pushSyncOpsV2("user-a", [op]);
    assert.deepEqual(rejected, [], `expected ${entity} create to be accepted`);
  }
  assert.equal(rowsOf("study_sessions").length, 1);
  assert.equal(rowsOf("study_claims").length, 1);
  assert.equal(rowsOf("motif_candidates").length, 1);
  assert.equal(rowsOf("user_connections").length, 1);
  assert.equal(rowsOf("applications").length, 1);
  assert.equal(rowsOf("teaching_drafts").length, 1);
  assert.equal(rowsOf("teaching_sections").length, 1);
});

test("idempotency: replaying the same opId is accepted and applied exactly once", async () => {
  const op = makeOp("session");
  assert.deepEqual(await pushSyncOpsV2("user-a", [op]), []);
  assert.equal(rowsOf("study_sessions").length, 1);
  assert.equal(rowsOf("sync_receipts").length, 1);

  // Replay: same opId, same payload.
  assert.deepEqual(await pushSyncOpsV2("user-a", [op]), []);
  assert.equal(rowsOf("study_sessions").length, 1, "replay must not create a second row");
  assert.equal(rowsOf("sync_receipts").length, 1, "replay must not create a second receipt");
});

test("baseRevision mismatch against an existing row is rejected and the row is unchanged", async () => {
  const create = makeOp("session", { opId: uuid(1) });
  assert.deepEqual(await pushSyncOpsV2("user-a", [create]), []);

  const staleUpdate = makeOp("session", {
    opId: uuid(2),
    baseRevision: 99,
    payload: validSessionPayload({ revision: 2, currentStep: "observe" }),
  });
  const rejected = await pushSyncOpsV2("user-a", [staleUpdate]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /Revision conflict/);

  const [row] = rowsOf("study_sessions");
  assert.equal(row.revision, 1, "stale update must not change the stored revision");
  assert.equal(row.currentStep, "read", "stale update must not change stored fields");
});

test("a matching baseRevision applies and advances the stored revision", async () => {
  const create = makeOp("session", { opId: uuid(1) });
  assert.deepEqual(await pushSyncOpsV2("user-a", [create]), []);

  const update = makeOp("session", {
    opId: uuid(2),
    baseRevision: 1,
    payload: validSessionPayload({ revision: 2, currentStep: "observe" }),
  });
  assert.deepEqual(await pushSyncOpsV2("user-a", [update]), []);

  const [row] = rowsOf("study_sessions");
  assert.equal(row.revision, 2);
  assert.equal(row.currentStep, "observe");
});

test("a create-shaped op (baseRevision null) against an existing row is rejected", async () => {
  const create = makeOp("session", { opId: uuid(1) });
  assert.deepEqual(await pushSyncOpsV2("user-a", [create]), []);

  const secondCreate = makeOp("session", {
    opId: uuid(2),
    baseRevision: null,
    payload: validSessionPayload({ revision: 2 }),
  });
  const rejected = await pushSyncOpsV2("user-a", [secondCreate]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /Revision conflict/);
  assert.equal(rowsOf("study_sessions")[0].revision, 1);
});

test("a baseRevision against a not-yet-existing entity is rejected and creates nothing", async () => {
  const op = makeOp("claim", {
    baseRevision: 3,
    payload: validClaimPayload({ id: "claim-ghost" }),
    entityId: "claim-ghost",
  });
  const rejected = await pushSyncOpsV2("user-a", [op]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /Revision conflict/);
  assert.equal(rowsOf("study_claims").length, 0);
});

test("an op whose payload timestamp does not match its envelope clientTime is rejected (accessor fail-closed)", async () => {
  const op = makeOp("session", {
    clientTime: TS2,
    payload: validSessionPayload({ updatedAt: TS }), // mismatched vs. clientTime
  });
  const rejected = await pushSyncOpsV2("user-a", [op]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /timestamp does not match its envelope/);
  assert.equal(rowsOf("study_sessions").length, 0);
});

test("cross-tenant: an op naming a workspace the acting user does not own is rejected", async () => {
  const hostileOp = makeOp("session", {
    payload: validSessionPayload({ workspaceId: "workspace-b" }),
  });
  const rejected = await pushSyncOpsV2("user-a", [hostileOp]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /Workspace does not belong to the acting user/);
  assert.equal(rowsOf("study_sessions").length, 0);
});

test("cross-tenant id-squat: a hostile op reusing another workspace's entity id is rejected without touching the victim row", async () => {
  const victimCreate = makeOp("claim", { opId: uuid(1) }); // claim-1 under workspace-a
  assert.deepEqual(await pushSyncOpsV2("user-a", [victimCreate]), []);

  // user-b legitimately owns workspace-b, but tries to claim the SAME entity
  // id "claim-1", which already belongs to workspace-a.
  const squatOp = makeOp("claim", {
    opId: uuid(2),
    baseRevision: null,
    payload: validClaimPayload({ id: "claim-1", workspaceId: "workspace-b" }),
    entityId: "claim-1",
  });
  const rejected = await pushSyncOpsV2("user-b", [squatOp]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /Entity ID belongs to another workspace/);

  assert.equal(rowsOf("study_claims").length, 1, "no second row must be created for workspace-b");
  const [row] = rowsOf("study_claims");
  assert.equal(row.workspaceId, "workspace-a", "the victim's row must be untouched");
  assert.equal(row.revision, 1);
});

// ---------------------------------------------------------------------------
// TEACHSECTIONSYNC-001 — the ninth entity, `teachingSection`. Acceptance
// criterion 3: "Tenant scoping, idempotent replay, and revision-conflict
// rejection must all work identically to every other entity -- prove each
// with a hostile test," mirroring the "session"/"claim" hostile tests above.
// ---------------------------------------------------------------------------

test("teachingSection: idempotency -- replaying the same opId is accepted and applied exactly once", async () => {
  const op = makeOp("teachingSection");
  assert.deepEqual(await pushSyncOpsV2("user-a", [op]), []);
  assert.equal(rowsOf("teaching_sections").length, 1);
  assert.equal(rowsOf("sync_receipts").length, 1);

  const replay = await pushSyncOpsV2("user-a", [op]);
  assert.deepEqual(replay, []);
  assert.equal(rowsOf("teaching_sections").length, 1, "replay must not create a second row");
  assert.equal(rowsOf("sync_receipts").length, 1, "replay must not create a second receipt");
});

test("teachingSection: baseRevision mismatch against an existing row is rejected and the row is unchanged", async () => {
  const create = makeOp("teachingSection", { opId: uuid(60) });
  assert.deepEqual(await pushSyncOpsV2("user-a", [create]), []);

  const staleUpdate = makeOp("teachingSection", {
    opId: uuid(61),
    baseRevision: 99,
    payload: validTeachingSectionPayload({ revision: 2, body: "A different outline." }),
  });
  const rejected = await pushSyncOpsV2("user-a", [staleUpdate]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /Revision conflict/);

  const [row] = rowsOf("teaching_sections");
  assert.equal(row.revision, 1, "stale update must not change the stored revision");
  assert.equal(row.body, "I. The seed promise in Genesis 3:15.", "stale update must not change stored fields");
});

test("teachingSection: a matching baseRevision applies and advances the stored revision", async () => {
  const create = makeOp("teachingSection", { opId: uuid(62) });
  assert.deepEqual(await pushSyncOpsV2("user-a", [create]), []);

  const update = makeOp("teachingSection", {
    opId: uuid(63),
    baseRevision: 1,
    payload: validTeachingSectionPayload({ revision: 2, body: "A revised outline.", sortOrder: 1 }),
  });
  assert.deepEqual(await pushSyncOpsV2("user-a", [update]), []);

  const [row] = rowsOf("teaching_sections");
  assert.equal(row.revision, 2);
  assert.equal(row.body, "A revised outline.");
  assert.equal(row.sortOrder, 1);
});

test("teachingSection: cross-tenant -- an op naming a workspace the acting user does not own is rejected", async () => {
  const hostileOp = makeOp("teachingSection", {
    payload: validTeachingSectionPayload({ workspaceId: "workspace-b" }),
  });
  const rejected = await pushSyncOpsV2("user-a", [hostileOp]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /Workspace does not belong to the acting user/);
  assert.equal(rowsOf("teaching_sections").length, 0);
});

test("teachingSection: cross-tenant id-squat -- a hostile op reusing another workspace's entity id is rejected without touching the victim row", async () => {
  const victimCreate = makeOp("teachingSection", { opId: uuid(64) }); // section-1 under workspace-a
  assert.deepEqual(await pushSyncOpsV2("user-a", [victimCreate]), []);

  const squatOp = makeOp("teachingSection", {
    opId: uuid(65),
    baseRevision: null,
    payload: validTeachingSectionPayload({ id: "section-1", workspaceId: "workspace-b" }),
    entityId: "section-1",
  });
  const rejected = await pushSyncOpsV2("user-b", [squatOp]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /Entity ID belongs to another workspace/);

  assert.equal(rowsOf("teaching_sections").length, 1, "no second row must be created for workspace-b");
  const [row] = rowsOf("teaching_sections");
  assert.equal(row.workspaceId, "workspace-a", "the victim's row must be untouched");
  assert.equal(row.revision, 1);
});

test("mutationGroupId atomicity: one invalid member rejects the whole group and nothing lands", async () => {
  const groupId = uuid(50);
  const validSession = makeOp("session", { opId: uuid(1), mutationGroupId: groupId });
  const hostileClaim = makeOp("claim", {
    opId: uuid(2),
    mutationGroupId: groupId,
    payload: validClaimPayload({ workspaceId: "workspace-b" }), // user-a does not own workspace-b
  });

  const rejected = await pushSyncOpsV2("user-a", [validSession, hostileClaim]);
  const rejectedIds = rejected.map((r) => r.opId).sort();
  assert.deepEqual(rejectedIds, [uuid(1), uuid(2)].sort());

  const sessionRejection = rejected.find((r) => r.opId === uuid(1));
  assert.ok(sessionRejection);
  assert.match(sessionRejection!.reason, /sibling op .* failed/);

  const claimRejection = rejected.find((r) => r.opId === uuid(2));
  assert.ok(claimRejection);
  assert.match(claimRejection!.reason, /Workspace does not belong to the acting user/);

  assert.equal(rowsOf("study_sessions").length, 0, "the valid sibling must NOT have landed");
  assert.equal(rowsOf("study_claims").length, 0);
  assert.equal(rowsOf("sync_receipts").length, 0, "no receipt for either op in a failed group");
});

test("mutationGroupId atomicity: a fully valid group commits every member together", async () => {
  const groupId = uuid(51);
  const sessionOp = makeOp("session", { opId: uuid(10), mutationGroupId: groupId });
  const claimOp = makeOp("claim", { opId: uuid(11), mutationGroupId: groupId });

  const rejected = await pushSyncOpsV2("user-a", [sessionOp, claimOp]);
  assert.deepEqual(rejected, []);
  assert.equal(rowsOf("study_sessions").length, 1);
  assert.equal(rowsOf("study_claims").length, 1);
  assert.equal(rowsOf("sync_receipts").length, 2);

  // Replaying the exact same group is a full no-op: both already have
  // receipts, so nothing is re-validated or re-written.
  const replay = await pushSyncOpsV2("user-a", [sessionOp, claimOp]);
  assert.deepEqual(replay, []);
  assert.equal(rowsOf("study_sessions").length, 1);
  assert.equal(rowsOf("study_claims").length, 1);
});

test("delete mutation soft-deletes via deletedAt, falling back to clientTime when the payload omits it", async () => {
  const create = makeOp("motif", { opId: uuid(1) });
  assert.deepEqual(await pushSyncOpsV2("user-a", [create]), []);

  const deleteOp = makeOp("motif", {
    opId: uuid(2),
    mutation: "delete",
    baseRevision: 1,
    clientTime: TS2,
    payload: validMotifPayload({ revision: 2, updatedAt: TS2, deletedAt: null }),
  });
  assert.deepEqual(await pushSyncOpsV2("user-a", [deleteOp]), []);

  const [row] = rowsOf("motif_candidates");
  assert.equal(row.deletedAt, TS2);
  assert.equal(row.revision, 2);
});

// ---------------------------------------------------------------------------
// MOTIFSTATUS-001, acceptance criterion 3 — the sync planner cannot perform
// a motif candidate promotion by the back door.
// ---------------------------------------------------------------------------

test("a sync op creating a motif candidate directly as \"promoted\" is refused, and no row is created", async () => {
  const op = makeOp("motif", { payload: validMotifPayload({ status: "promoted" }) });
  const rejected = await pushSyncOpsV2("user-a", [op]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /privileged server transition/);
  assert.match(rejected[0].reason, /cannot be performed via sync push/);
  assert.equal(rowsOf("motif_candidates").length, 0, "no row may be created by a refused op");
});

test("a sync op moving an existing pending motif candidate to \"promoted\" is refused, and the stored row is unchanged", async () => {
  const create = makeOp("motif", { opId: uuid(1) }); // status: "candidate" (validMotifPayload's default)
  assert.deepEqual(await pushSyncOpsV2("user-a", [create]), []);

  const promoteAttempt = makeOp("motif", {
    opId: uuid(2),
    baseRevision: 1,
    payload: validMotifPayload({ status: "promoted", revision: 2, updatedAt: TS2 }),
    clientTime: TS2,
  });
  const rejected = await pushSyncOpsV2("user-a", [promoteAttempt]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /privileged server transition/);

  const [row] = rowsOf("motif_candidates");
  assert.equal(row.status, "candidate", "the candidate must stay unpromoted");
  assert.equal(row.revision, 1, "a refused op must not advance the stored revision");
});

test("a sync op against an already-promoted motif candidate is refused outright, even one that never touches status", async () => {
  seedMotifCandidate({ status: "promoted", threadSlug: "seed-of-the-woman", revision: 3 });

  // This op does not even try to change `status` -- it re-sends "promoted"
  // unchanged and only edits `label`. Immutability is total, not merely a
  // block on the specific field.
  const relabelAttempt = makeOp("motif", {
    baseRevision: 3,
    payload: validMotifPayload({ status: "promoted", label: "A different label", revision: 4, updatedAt: TS2 }),
    clientTime: TS2,
  });
  const rejected = await pushSyncOpsV2("user-a", [relabelAttempt]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /already promoted/);
  assert.match(rejected[0].reason, /immutable via sync push/);

  const [row] = rowsOf("motif_candidates");
  assert.equal(row.label, "Seed of the woman", "the row must be completely unchanged, not just status");
  assert.equal(row.revision, 3);
});

test("a sync op cannot launder a downgrade: an already-promoted candidate cannot be pushed back to \"dismissed\"", async () => {
  seedMotifCandidate({ status: "promoted", threadSlug: "seed-of-the-woman", revision: 2 });

  const downgradeAttempt = makeOp("motif", {
    baseRevision: 2,
    payload: validMotifPayload({ status: "dismissed", revision: 3, updatedAt: TS2 }),
    clientTime: TS2,
  });
  const rejected = await pushSyncOpsV2("user-a", [downgradeAttempt]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /already promoted/);

  const [row] = rowsOf("motif_candidates");
  assert.equal(row.status, "promoted", "a promoted candidate must never be downgraded via sync push");
});

test("candidate -> dismissed remains a legitimate client-drivable transition (only \"promoted\" is server-owned)", async () => {
  const create = makeOp("motif", { opId: uuid(1) }); // status: "candidate"
  assert.deepEqual(await pushSyncOpsV2("user-a", [create]), []);

  const dismiss = makeOp("motif", {
    opId: uuid(2),
    baseRevision: 1,
    payload: validMotifPayload({ status: "dismissed", revision: 2, updatedAt: TS2 }),
    clientTime: TS2,
  });
  assert.deepEqual(await pushSyncOpsV2("user-a", [dismiss]), []);

  const [row] = rowsOf("motif_candidates");
  assert.equal(row.status, "dismissed");
  assert.equal(row.revision, 2);
});

test("cross-tenant: a probe against another workspace's promoted candidate gets the ordinary cross-tenant rejection, never a status-revealing one", async () => {
  // workspace-a's candidate is already promoted -- real state user-b must
  // never be able to learn anything about.
  seedMotifCandidate({ id: "victim-motif", workspaceId: "workspace-a", status: "promoted", revision: 5 });

  // user-b legitimately owns workspace-b, and claims workspace-b as the
  // op's workspaceId (so the FIRST ownership gate passes) -- but names the
  // victim's entityId, which actually belongs to workspace-a.
  const probe = makeOp("motif", {
    entityId: "victim-motif",
    baseRevision: null,
    payload: validMotifPayload({ id: "victim-motif", workspaceId: "workspace-b" }),
  });
  const rejected = await pushSyncOpsV2("user-b", [probe]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /Entity ID belongs to another workspace/);
  assert.doesNotMatch(rejected[0].reason, /promoted/, "the rejection must not leak the victim row's real status");

  const [row] = rowsOf("motif_candidates");
  assert.equal(row.status, "promoted", "the victim row itself must be completely untouched");
  assert.equal(row.revision, 5);
});

// ---------------------------------------------------------------------------
// 7. SYNCDEDUP-001 mutation proof.
//
// SYNCDEDUP-001 deleted `lib/db/sync-v2.ts`'s inline `resolveWorkspaceOwnership`
// (a second copy of the workspace-ownership predicate) and replaced its call
// sites with `ownsWorkspace`, a thin adapter that performs no query of its
// own and delegates entirely to `assertWorkspaceOwnership`
// (`lib/db/workspaces.ts`). Every cross-tenant test above already proves the
// SURVIVING check rejects a hostile cross-workspace op under normal load;
// this proves it the other way -- that if that surviving check is ever
// bypassed at its call site, `pushSyncOpsV2` (the PLANNER, called directly,
// not through the HTTP route `tests/sync-v2-route.test.ts` covers
// separately) stops refusing the leak. `tests/sync-v2-route.test.ts`'s own
// MUTPROVE-1 targets the same call site's PRE-SYNCDEDUP-001 compiled shape
// (`resolveWorkspaceOwnership`, not `ownsWorkspace`) and is read-only here --
// see this task's completion notes for why that pattern needed updating and
// could not be fixed in place.
//
// Uses the in-memory `Module.prototype._compile` hook `tests/motif-ui.test.ts`,
// `tests/v2-api.test.ts` and `tests/sync-v2-route.test.ts` already use:
// patches the module source as `lib/db/sync-v2.ts` is (re-)required, never
// writes to disk, and reasserts the file's hash and mtime are unchanged
// afterward. `hits > 0` is asserted so a mutation whose pattern stops
// matching a future edit fails loudly instead of silently proving nothing.
// ---------------------------------------------------------------------------

let mutation: { file: string; pattern: RegExp; replacement: string; hits: number } | null = null;

const originalCompile = (Module as any).prototype._compile;
(Module as any).prototype._compile = function patchedCompile(
  content: string,
  filename: string,
  ...rest: unknown[]
) {
  let source = content;
  if (mutation && path.resolve(filename) === mutation.file) {
    const hits = source.match(mutation.pattern)?.length ?? 0;
    mutation.hits += hits;
    source = source.replace(mutation.pattern, mutation.replacement);
  }
  return originalCompile.call(this, source, filename, ...rest);
};

const SYNC_V2_FILE = nodeRequire.resolve("@/lib/db/sync-v2.ts");

/** Deliberately surgical, matching `tests/sync-v2-route.test.ts`'s own
 *  `reloadRoutes`: only `lib/db/sync-v2.ts` itself is dropped from the
 *  require cache and re-read from disk. Its dependencies (`@/lib/db`,
 *  `@/db/schema`, `@/lib/db/workspaces`) stay cached exactly as this file's
 *  bootstrap section originally loaded them -- re-requiring `@/db/schema`
 *  would mint new `Table` object references this harness's `metaByTable`
 *  map keys on, and `@/lib/db` must stay bound to this file's `pocketPg`
 *  fake, not a real client. */
function reloadSyncV2(): typeof import("@/lib/db/sync-v2") {
  delete (nodeRequire.cache as any)[SYNC_V2_FILE];
  return nodeRequire("@/lib/db/sync-v2.ts") as typeof import("@/lib/db/sync-v2");
}

async function withSyncV2Mutation(
  pattern: RegExp,
  replacement: string,
  body: (mutated: typeof import("@/lib/db/sync-v2")) => Promise<void>,
) {
  const beforeHash = createHash("sha256").update(fs.readFileSync(SYNC_V2_FILE)).digest("hex");
  const beforeMtime = fs.statSync(SYNC_V2_FILE).mtimeMs;

  mutation = { file: SYNC_V2_FILE, pattern, replacement, hits: 0 };
  const mutated = reloadSyncV2();
  try {
    assert.ok(
      mutation.hits > 0,
      "mutation matched nothing in lib/db/sync-v2.ts -- the compiled shape changed; update the pattern",
    );
    await body(mutated);
  } finally {
    mutation = null;
    reloadSyncV2(); // re-prime the cache with the real, unmutated module
    assert.equal(
      createHash("sha256").update(fs.readFileSync(SYNC_V2_FILE)).digest("hex"),
      beforeHash,
      "lib/db/sync-v2.ts was modified on disk",
    );
    assert.equal(
      fs.statSync(SYNC_V2_FILE).mtimeMs,
      beforeMtime,
      "lib/db/sync-v2.ts mtime changed on disk",
    );
  }
}

test("MUTPROVE-DEDUP-1 removing the surviving ownsWorkspace check lets a hostile cross-workspace push through pushSyncOpsV2 directly", async () => {
  await withSyncV2Mutation(
    /const owns=await ownsWorkspace\(userId,workspaceId\);/,
    "const owns=true;",
    async (mutated) => {
      const hostileOp = makeOp("session", {
        payload: validSessionPayload({ workspaceId: "workspace-b" }),
      });
      const rejected = await mutated.pushSyncOpsV2("user-a", [hostileOp]);
      assert.deepEqual(
        rejected,
        [],
        "MUTPROVE-DEDUP-1: with the tenant check gone, user-a's op naming " +
          "workspace-b must be ACCEPTED -- that acceptance is the leak this " +
          "guard prevents",
      );
    },
  );
});

test("after MUTPROVE-DEDUP-1, a hostile cross-workspace push is refused again through pushSyncOpsV2 (harness hygiene)", async () => {
  const hostileOp = makeOp("session", {
    payload: validSessionPayload({ workspaceId: "workspace-b" }),
  });
  const rejected = await pushSyncOpsV2("user-a", [hostileOp]);
  assert.equal(rejected.length, 1, "the real guard must still refuse it");
  assert.match(rejected[0].reason, /Workspace does not belong to the acting user/);
  assert.equal(rowsOf("study_sessions").length, 0);
});

// ---------------------------------------------------------------------------
// TEACHSECTIONSYNC-001 — mutation proof that `planTeachingSectionOp` (the
// new plan*Op handler this task added) is actually wired through the SAME
// `ownsWorkspace` tenant check every other entity's handler goes through,
// not a copy that only looks identical. Reuses `withSyncV2Mutation`'s
// existing backup/restore/hash-diff machinery above (same technique, applied
// to a teachingSection-shaped hostile op instead of a session-shaped one).
// ---------------------------------------------------------------------------

test("MUTPROVE-TEACHSECTION-1 removing the surviving ownsWorkspace check lets a hostile cross-workspace teachingSection push through pushSyncOpsV2 directly", async () => {
  await withSyncV2Mutation(
    /const owns=await ownsWorkspace\(userId,workspaceId\);/,
    "const owns=true;",
    async (mutated) => {
      const hostileOp = makeOp("teachingSection", {
        payload: validTeachingSectionPayload({ workspaceId: "workspace-b" }),
      });
      const rejected = await mutated.pushSyncOpsV2("user-a", [hostileOp]);
      assert.deepEqual(
        rejected,
        [],
        "MUTPROVE-TEACHSECTION-1: with the tenant check gone, user-a's " +
          "teachingSection op naming workspace-b must be ACCEPTED -- that " +
          "acceptance is the leak this guard prevents",
      );
    },
  );
});

test("after MUTPROVE-TEACHSECTION-1, a hostile cross-workspace teachingSection push is refused again through pushSyncOpsV2 (harness hygiene)", async () => {
  const hostileOp = makeOp("teachingSection", {
    payload: validTeachingSectionPayload({ workspaceId: "workspace-b" }),
  });
  const rejected = await pushSyncOpsV2("user-a", [hostileOp]);
  assert.equal(rejected.length, 1, "the real guard must still refuse it");
  assert.match(rejected[0].reason, /Workspace does not belong to the acting user/);
  assert.equal(rowsOf("teaching_sections").length, 0);
});
