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
import { createRequire } from "node:module";
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

const validPayloadByEntity: Record<SyncEntityV2, (overrides?: Row) => Row> = {
  session: validSessionPayload,
  claim: validClaimPayload,
  motif: validMotifPayload,
  connection: validConnectionPayload,
  application: validApplicationPayload,
  teachingDraft: validTeachingDraftPayload,
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
