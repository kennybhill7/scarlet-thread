/**
 * P0-001 — Two-account tenant isolation proof.
 *
 * This is a hostile integration test. It drives the real route handlers in
 * `app/api/**` and the real query builders in `lib/db/*` while account A tries
 * to read and mutate account B's data. Nothing in `lib/` or `app/` is stubbed:
 * the only two seams are the identity boundary (`@/lib/auth/config`) and the
 * database client (`@/lib/db`), both replaced in `require.cache` before any
 * consumer loads them.
 *
 * Why a hand-built database instead of a mock:
 * `PocketPg` compiles every `.where(...)` and join condition with the real
 * drizzle `PgDialect`, so a predicate written in `lib/db/*` arrives here as
 * genuine SQL text plus bound parameters. Deleting `eq(entries.userId, userId)`
 * from production code therefore changes what this harness sees, byte for byte.
 * That is what makes the mutation proof in "criterion 4" meaningful rather than
 * decorative. PocketPg also enforces the primary keys and the two
 * `entry_threads` foreign keys from `db/schema.ts`, because several attacks are
 * only answered by a constraint rather than by application code.
 *
 * ---------------------------------------------------------------------------
 * Isolation audit findings (no live cross-tenant defect was found; the only
 * production change since, in `lib/db/sync.ts`, is the SYNC-001 fix for the
 * functional finding F4 recorded further down):
 *
 * F1 — `lib/db/entries.ts:54-68` (`hydrateEntries`) carries no `user_id`
 *      predicate. It is safe only because (a) the entry-id set it filters on was
 *      already tenant-filtered by its caller, (b) `entries.id` is a global
 *      primary key, and (c) the foreign key `entry_threads_user_entry_fk`
 *      (`db/schema.ts:153-157`) forbids a backlink whose `user_id` differs from
 *      the owning entry's. This is a SCHEMA-enforced guarantee, not an
 *      application-enforced one. Test `F1` below attempts the FK-violating
 *      backlink and asserts it is rejected, mirroring `tests/db-invariants.sql`.
 *
 * F2 — `lib/db/entries.ts:153-196` (`createEntry`) has no handler for a primary
 *      key collision (`23505`). A client-supplied `id` colliding with another
 *      account's entry produces an unhandled driver error and a 500 rather than
 *      a clean 409. It FAILS CLOSED (attack C2 proves B's row is untouched), so
 *      this is a response-shape issue, not an isolation hole. Contrast
 *      `lib/db/sync.ts:93`, which handles the same collision cleanly.
 *
 * F3 — `lib/db/sync.ts:87-95` is an intentional existence oracle. It reads
 *      `entries` by id with no tenant predicate to detect id collisions, and the
 *      rejection string "Entry ID belongs to another user" tells A that some
 *      other account owns that UUID. It exposes no content columns. Accepted
 *      risk; exercised by S1/S2 and exempted from guard G2 by exact select-list
 *      match so the exemption cannot silently widen.
 * ---------------------------------------------------------------------------
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import {
  Column,
  SQL,
  Table,
  getTableColumns,
  getTableName,
  is,
} from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
// Attack F7 drives the real client write path (lib/sync/store.ts), which opens
// IndexedDB at module scope. This must be loaded before that import.
import "fake-indexeddb/auto";
import { strFromU8, unzipSync } from "fflate";

import * as schema from "@/db/schema";

/* eslint-disable @typescript-eslint/no-explicit-any --
 * Route modules and drizzle builders are loaded dynamically and re-loaded after
 * each mutation cycle, so their shapes cannot be named statically here. */

// ---------------------------------------------------------------------------
// 0. Types and small utilities
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type JoinContext = Record<string, Row | null>;
type Predicate = { sql: string; params: unknown[] };
type RouteModule = Record<string, (...args: any[]) => Promise<Response>>;

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

// ---------------------------------------------------------------------------
// 1. Bootstrap — order matters. Nothing under lib/ or app/ may be imported
//    statically; every such module is loaded through require() after seeding.
// ---------------------------------------------------------------------------

const WEB_ROOT = path.resolve(__dirname, "..");
const nodeRequire = createRequire(__filename);

process.env.DATABASE_URL = "postgresql://never:used@127.0.0.1:1/none";
process.env.AUTH_ALLOWED_EMAIL = "a@example.test";

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

// `server-only` throws under plain node. Every lib/db/*.ts and lib/auth/config.ts
// imports it, so it must be neutralised before anything else is required.
const SERVER_ONLY_PATH = seedModule("server-only", {});

// ---------------------------------------------------------------------------
// 2. Schema registry — property/column mapping, primary keys, tenancy
// ---------------------------------------------------------------------------

type TableMeta = {
  table: Table;
  sqlName: string;
  columns: Record<string, Column>;
  propByColumn: Map<string, string>;
  primaryKey: string[];
  tenantScoped: boolean;
};

const PRIMARY_KEYS: Record<string, string[]> = {
  users: ["id"],
  entries: ["id"],
  threads: ["userId", "slug"],
  entry_threads: ["entryId", "threadSlug"],
  people: ["userId", "slug"],
  reading_progress: ["userId", "chapter"],
  daily_logs: ["userId", "date"],
  stages: ["slug"],
  sync_receipts: ["userId", "opId"],
};

/** Tables carrying a `user_id`. `stages` is deliberately absent: it is global
 *  reference data with no tenant column (`lib/db/review.ts:49`). */
const TENANT_TABLES = new Set([
  "entries",
  "threads",
  "entry_threads",
  "people",
  "reading_progress",
  "daily_logs",
  "sync_receipts",
]);

const MODELLED_TABLES: Table[] = [
  schema.users,
  schema.entries,
  schema.threads,
  schema.entryThreads,
  schema.people,
  schema.readingProgress,
  schema.dailyLogs,
  schema.stages,
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
    tenantScoped: TENANT_TABLES.has(sqlName),
  };
  assert.ok(
    meta.primaryKey.length > 0,
    `PocketPg has no primary key registered for "${sqlName}"`,
  );
  metaByTable.set(table, meta);
  metaBySqlName.set(sqlName, meta);
}

function metaOf(table: Table): TableMeta {
  const meta = metaByTable.get(table);
  if (!meta) {
    throw new Error(`PocketPg does not model table "${getTableName(table)}"`);
  }
  return meta;
}

/** Rebuilds a row with keys in schema column order so cloning, sorting and
 *  deep-equality are canonical regardless of insertion order. */
function normalizeRow(meta: TableMeta, row: Row): Row {
  const out: Row = {};
  for (const prop of Object.keys(meta.columns)) out[prop] = row[prop] ?? null;
  return out;
}

// ---------------------------------------------------------------------------
// 3. WHERE evaluator — recursive descent over the dialect-compiled SQL text.
//    The grammar is closed and verified against every condition in the codebase.
//    Any token outside it throws; the evaluator never silently returns true.
// ---------------------------------------------------------------------------

function evaluatePredicate(predicate: Predicate, context: JoinContext): boolean {
  const { sql, params } = predicate;
  let pos = 0;

  const fail = (reason: string): never => {
    throw new Error(
      `PocketPg cannot evaluate SQL (${reason}) at offset ${pos} of: ${sql}`,
    );
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
      const meta = metaBySqlName.get(tableName);
      if (!meta) return fail(`unknown table "${tableName}"`);
      if (!(tableName in context)) {
        return fail(`table "${tableName}" is not part of this statement`);
      }
      const row = context[tableName];
      if (row === null) return null;
      const prop = meta.propByColumn.get(columnName);
      if (!prop) return fail(`unknown column "${tableName}"."${columnName}"`);
      return row[prop] ?? null;
    }
    if (sql[pos] === "$") {
      const match = /^\$(\d+)/.exec(sql.slice(pos));
      if (!match) return fail("malformed parameter");
      pos += match[0].length;
      const index = Number(match[1]) - 1;
      if (index < 0 || index >= params.length) {
        return fail(`parameter $${match[1]} is out of range`);
      }
      return params[index] ?? null;
    }
    return fail("expected a column reference or a parameter");
  };

  const equal = (left: unknown, right: unknown) =>
    left !== null && right !== null && left === right;

  const parseComparison = (): boolean => {
    skipSpaces();
    if (eat("false")) return false;
    if (eat("true")) return true;
    const left = parseOperand();
    skipSpaces();
    if (eat("is not null")) return left !== null;
    if (eat("is null")) return left === null;
    if (eat("in (")) {
      const candidates: unknown[] = [];
      do {
        candidates.push(parseOperand());
        skipSpaces();
      } while (eat(","));
      if (!eat(")")) return fail('expected ")" closing an IN list');
      return candidates.some((candidate) => equal(left, candidate));
    }
    if (eat("<>")) return !equal(left, parseOperand()) && left !== null;
    if (eat("=")) return equal(left, parseOperand());
    return fail("unsupported operator");
  };

  const parseExpression = (): boolean => {
    let value = parseTerm();
    let operator: "and" | "or" | null = null;
    for (;;) {
      skipSpaces();
      if (eat("and ")) {
        if (operator === "or") return fail("mixed and/or without parentheses");
        operator = "and";
        value = parseTerm() && value;
      } else if (eat("or ")) {
        if (operator === "and") return fail("mixed and/or without parentheses");
        operator = "or";
        value = parseTerm() || value;
      } else {
        return value;
      }
    }
  };

  function parseTerm(): boolean {
    skipSpaces();
    if (eat("(")) {
      const value = parseExpression();
      skipSpaces();
      if (!eat(")")) return fail('expected ")"');
      return value;
    }
    return parseComparison();
  }

  const result = parseExpression();
  skipSpaces();
  if (pos !== sql.length) fail("trailing tokens");
  return result;
}

// ---------------------------------------------------------------------------
// 4. Statement recorder
// ---------------------------------------------------------------------------

type Statement = {
  actingUserId: string | null;
  op: "select" | "insert" | "update" | "delete";
  tables: string[];
  selectFields: string[] | null;
  predicates: Predicate[];
  whereSql: string;
  boundTenantIds: unknown[];
  rowTenantIds: unknown[];
};

const statements: Statement[] = [];
let recording = true;

function boundTenantIdsOf(predicates: Predicate[]): unknown[] {
  const found: unknown[] = [];
  for (const predicate of predicates) {
    const columnFirst = /"[a-z0-9_]+"\."user_id" = \$(\d+)/g;
    const paramFirst = /\$(\d+) = "[a-z0-9_]+"\."user_id"/g;
    for (const pattern of [columnFirst, paramFirst]) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(predicate.sql)) !== null) {
        found.push(predicate.params[Number(match[1]) - 1]);
      }
    }
  }
  return found;
}

function record(
  entry: Omit<Statement, "actingUserId" | "whereSql" | "boundTenantIds">,
) {
  if (!recording) return;
  statements.push({
    ...entry,
    actingUserId: currentSession?.user?.id ?? null,
    whereSql: entry.predicates.map((p) => p.sql).join(" AND "),
    boundTenantIds: boundTenantIdsOf(entry.predicates),
  });
}

// ---------------------------------------------------------------------------
// 5. PocketPg — fluent facade over an in-memory store
// ---------------------------------------------------------------------------

const dialect = new PgDialect();
const world = new Map<string, Row[]>();

const rowsOf = (sqlName: string): Row[] => {
  const rows = world.get(sqlName);
  if (!rows) throw new Error(`PocketPg has no table "${sqlName}"`);
  return rows;
};

function compile(condition: SQL | undefined): Predicate | null {
  if (!condition) return null;
  const query = dialect.sqlToQuery(condition);
  return { sql: query.sql, params: query.params as unknown[] };
}

function parseOrderBy(expression: SQL) {
  const compiled = compile(expression);
  if (!compiled) throw new Error("PocketPg received an empty ORDER BY");
  const match = /^"([a-z0-9_]+)"\."([a-z0-9_]+)"(?: (asc|desc))?$/.exec(
    compiled.sql,
  );
  if (!match) {
    throw new Error(`PocketPg cannot evaluate ORDER BY: ${compiled.sql}`);
  }
  return {
    table: match[1],
    column: match[2],
    direction: (match[3] ?? "asc") as "asc" | "desc",
  };
}

/** Fills schema defaults and enforces NOT NULL, mirroring Postgres. */
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
      row[prop] = is(anyColumn.default, SQL)
        ? now
        : clone(anyColumn.default ?? null);
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

const keyOf = (meta: TableMeta, row: Row) =>
  JSON.stringify(meta.primaryKey.map((prop) => row[prop]));

/** The two composite foreign keys declared on `entry_threads`
 *  (`db/schema.ts:153-162`). Finding F1 depends on the first of them. */
function assertForeignKeys(meta: TableMeta, row: Row) {
  if (meta.sqlName !== "entry_threads") return;
  const ownsEntry = rowsOf("entries").some(
    (entry) => entry.id === row.entryId && entry.userId === row.userId,
  );
  if (!ownsEntry) {
    throw new DatabaseError(
      'insert or update on table "entry_threads" violates foreign key constraint "entry_threads_user_entry_fk"',
      "23503",
    );
  }
  const ownsThread = rowsOf("threads").some(
    (thread) => thread.userId === row.userId && thread.slug === row.threadSlug,
  );
  if (!ownsThread) {
    throw new DatabaseError(
      'insert or update on table "entry_threads" violates foreign key constraint "entry_threads_user_thread_fk"',
      "23503",
    );
  }
}

function projectRow(
  fields: Record<string, unknown> | null,
  context: JoinContext,
  fromName: string,
  hasJoins: boolean,
): Row {
  if (!fields) {
    if (hasJoins) {
      throw new Error(
        "PocketPg does not model a bare select() combined with a join",
      );
    }
    return clone(context[fromName] as Row);
  }
  const out: Row = {};
  for (const [key, value] of Object.entries(fields)) {
    if (is(value, Column)) {
      const owner = getTableName((value as any).table);
      const meta = metaBySqlName.get(owner);
      if (!meta) throw new Error(`PocketPg does not model table "${owner}"`);
      const row = context[owner];
      const prop = meta.propByColumn.get((value as Column).name);
      if (!prop) throw new Error(`unknown column ${owner}.${value.name}`);
      out[key] = row === null || row === undefined ? null : (row[prop] ?? null);
    } else if (is(value, Table)) {
      const owner = getTableName(value as Table);
      const row = context[owner];
      out[key] = row === null || row === undefined ? null : clone(row);
    } else {
      throw new Error(
        `PocketPg does not model select field "${key}" of this shape`,
      );
    }
  }
  return out;
}

type SelectSpec = {
  fields: Record<string, unknown> | null;
  from: TableMeta | null;
  joins: { meta: TableMeta; predicate: Predicate; kind: "inner" | "left" }[];
  where: Predicate | null;
  orderBy: ReturnType<typeof parseOrderBy>[];
  limit: number | null;
};

function executeSelect(spec: SelectSpec): Row[] {
  if (!spec.from) throw new Error("PocketPg received a select without from()");
  const fromName = spec.from.sqlName;

  let contexts: JoinContext[] = rowsOf(fromName).map((row) => ({
    [fromName]: row,
  }));

  for (const join of spec.joins) {
    const next: JoinContext[] = [];
    for (const context of contexts) {
      let matched = 0;
      for (const row of rowsOf(join.meta.sqlName)) {
        const candidate = { ...context, [join.meta.sqlName]: row };
        if (evaluatePredicate(join.predicate, candidate)) {
          next.push(candidate);
          matched += 1;
        }
      }
      if (matched === 0 && join.kind === "left") {
        next.push({ ...context, [join.meta.sqlName]: null });
      }
    }
    contexts = next;
  }

  if (spec.where) {
    const where = spec.where;
    contexts = contexts.filter((context) => evaluatePredicate(where, context));
  }

  for (const key of [...spec.orderBy].reverse()) {
    const meta = metaBySqlName.get(key.table);
    const prop = meta?.propByColumn.get(key.column);
    if (!prop) throw new Error(`PocketPg cannot order by ${key.table}.${key.column}`);
    contexts.sort((left, right) => {
      const a = (left[key.table] as Row | null)?.[prop] ?? null;
      const b = (right[key.table] as Row | null)?.[prop] ?? null;
      if (a === b) return 0;
      if (a === null) return -1;
      if (b === null) return 1;
      const order = (a as any) < (b as any) ? -1 : 1;
      return key.direction === "desc" ? -order : order;
    });
  }

  const limited =
    spec.limit === null ? contexts : contexts.slice(0, spec.limit);

  record({
    op: "select",
    tables: [fromName, ...spec.joins.map((join) => join.meta.sqlName)],
    selectFields: spec.fields ? Object.keys(spec.fields) : null,
    predicates: [
      ...spec.joins.map((join) => join.predicate),
      ...(spec.where ? [spec.where] : []),
    ],
    rowTenantIds: [],
  });

  return limited.map((context) =>
    projectRow(spec.fields, context, fromName, spec.joins.length > 0),
  );
}

function makeSelect(fields: Record<string, unknown> | null) {
  const spec: SelectSpec = {
    fields,
    from: null,
    joins: [],
    where: null,
    orderBy: [],
    limit: null,
  };
  const builder: any = {
    from(table: Table) {
      spec.from = metaOf(table);
      return builder;
    },
    innerJoin(table: Table, condition: SQL) {
      const predicate = compile(condition);
      if (!predicate) throw new Error("PocketPg received an empty join condition");
      spec.joins.push({ meta: metaOf(table), predicate, kind: "inner" });
      return builder;
    },
    leftJoin(table: Table, condition: SQL) {
      const predicate = compile(condition);
      if (!predicate) throw new Error("PocketPg received an empty join condition");
      spec.joins.push({ meta: metaOf(table), predicate, kind: "left" });
      return builder;
    },
    where(condition: SQL | undefined) {
      spec.where = compile(condition);
      return builder;
    },
    orderBy(...expressions: SQL[]) {
      spec.orderBy = expressions.map(parseOrderBy);
      return builder;
    },
    limit(count: number) {
      spec.limit = count;
      return builder;
    },
    __execute: () => executeSelect(spec),
    then: (resolve: any, reject: any) =>
      Promise.resolve()
        .then(() => executeSelect(spec))
        .then(resolve, reject),
  };
  return builder;
}

function targetProps(meta: TableMeta, target: unknown): string[] {
  const columns = Array.isArray(target) ? target : [target];
  return columns.map((column) => {
    if (!is(column, Column)) {
      throw new Error("PocketPg does not model this onConflict target");
    }
    const prop = meta.propByColumn.get((column as Column).name);
    if (!prop) throw new Error(`unknown conflict target column ${column.name}`);
    return prop;
  });
}

function makeInsert(table: Table) {
  const meta = metaOf(table);
  let inputs: Row[] = [];
  let conflict:
    | { kind: "nothing" }
    | { kind: "update"; set: Row }
    | null = null;
  let returning: Record<string, unknown> | null | undefined;

  const execute = () => {
    const written: Row[] = [];
    const tenantIds: unknown[] = [];
    for (const input of inputs) {
      const row = applyDefaults(meta, input as Row);
      const rows = rowsOf(meta.sqlName);
      const existingIndex = rows.findIndex(
        (candidate) => keyOf(meta, candidate) === keyOf(meta, row),
      );
      if (existingIndex >= 0) {
        if (conflict === null) {
          throw new DatabaseError(
            `duplicate key value violates unique constraint "${meta.sqlName}_pkey"`,
            "23505",
          );
        }
        if (conflict.kind === "nothing") continue;
        const merged = normalizeRow(meta, {
          ...rows[existingIndex],
          ...conflict.set,
        });
        assertForeignKeys(meta, merged);
        rows[existingIndex] = merged;
        written.push(merged);
        tenantIds.push(merged.userId);
        continue;
      }
      assertForeignKeys(meta, row);
      rows.push(row);
      written.push(row);
      tenantIds.push(row.userId);
    }

    record({
      op: "insert",
      tables: [meta.sqlName],
      selectFields: null,
      predicates: [],
      rowTenantIds: tenantIds.filter((id) => id !== undefined),
    });

    if (returning === undefined) return [];
    return written.map((row) =>
      projectRow(returning ?? null, { [meta.sqlName]: row }, meta.sqlName, false),
    );
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
        throw new Error(
          `PocketPg only models onConflict against the primary key of "${meta.sqlName}"`,
        );
      }
      conflict = { kind: "update", set: config.set };
      return builder;
    },
    returning(fields?: Record<string, unknown>) {
      returning = fields ?? null;
      return builder;
    },
    __execute: execute,
    then: (resolve: any, reject: any) =>
      Promise.resolve().then(execute).then(resolve, reject),
  };
  return builder;
}

function makeUpdate(table: Table) {
  const meta = metaOf(table);
  let patch: Row = {};
  let where: Predicate | null = null;
  let returning: Record<string, unknown> | null | undefined;

  const execute = () => {
    const rows = rowsOf(meta.sqlName);
    const written: Row[] = [];
    const tenantIds: unknown[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const context: JoinContext = { [meta.sqlName]: rows[index] };
      if (where && !evaluatePredicate(where, context)) continue;
      const merged = normalizeRow(meta, { ...rows[index], ...patch });
      rows[index] = merged;
      written.push(merged);
      tenantIds.push(merged.userId);
    }

    record({
      op: "update",
      tables: [meta.sqlName],
      selectFields: null,
      predicates: where ? [where] : [],
      rowTenantIds: tenantIds.filter((id) => id !== undefined),
    });

    if (returning === undefined) return [];
    return written.map((row) =>
      projectRow(returning ?? null, { [meta.sqlName]: row }, meta.sqlName, false),
    );
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
    returning(fields?: Record<string, unknown>) {
      returning = fields ?? null;
      return builder;
    },
    __execute: execute,
    then: (resolve: any, reject: any) =>
      Promise.resolve().then(execute).then(resolve, reject),
  };
  return builder;
}

function makeDelete(table: Table) {
  const meta = metaOf(table);
  let where: Predicate | null = null;

  const execute = () => {
    const rows = rowsOf(meta.sqlName);
    const kept: Row[] = [];
    let removed = 0;
    for (const row of rows) {
      const context: JoinContext = { [meta.sqlName]: row };
      if (where && !evaluatePredicate(where, context)) {
        kept.push(row);
      } else {
        removed += 1;
      }
    }
    world.set(meta.sqlName, kept);

    record({
      op: "delete",
      tables: [meta.sqlName],
      selectFields: null,
      predicates: where ? [where] : [],
      rowTenantIds: [],
    });
    return { rowCount: removed };
  };

  const builder: any = {
    where(condition: SQL | undefined) {
      where = compile(condition);
      return builder;
    },
    __execute: execute,
    then: (resolve: any, reject: any) =>
      Promise.resolve().then(execute).then(resolve, reject),
  };
  return builder;
}

const snapshotWorld = () =>
  new Map([...world].map(([name, rows]) => [name, rows.map(clone)]));

const restoreWorld = (snapshot: Map<string, Row[]>) => {
  world.clear();
  for (const [name, rows] of snapshot) world.set(name, rows.map(clone));
};

const pocketPg = {
  select: (fields?: Record<string, unknown>) => makeSelect(fields ?? null),
  insert: (table: Table) => makeInsert(table),
  update: (table: Table) => makeUpdate(table),
  delete: (table: Table) => makeDelete(table),
  /** Neon HTTP batch is one transaction, so a failure rolls the whole set back. */
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

const DB_PATH = seedModule("@/lib/db", { db: pocketPg });

// ---------------------------------------------------------------------------
// 6. Identity seam
// ---------------------------------------------------------------------------

type Session = { user: { id: string; email: string; name?: string } } | null;

const USER_A = "user-a";
const USER_B = "user-b";
const EMAIL_A = "a@example.test";
const EMAIL_B = "b@example.test";

const SESSION_A: Session = { user: { id: USER_A, email: EMAIL_A, name: "A" } };
const SESSION_B: Session = { user: { id: USER_B, email: EMAIL_B, name: "B" } };
/** The exact shape `lib/auth/config.ts:session()` produces once the allowlist
 *  stops matching: `session.user.id = isAllowedEmail(...) ? user.id : ""`. */
const SESSION_REVOKED: Session = { user: { id: "", email: EMAIL_B } };

let currentSession: Session = null;
let authOverride: Session | undefined;

const AUTH_PATH = seedModule("@/lib/auth/config", {
  auth: async () => (authOverride === undefined ? currentSession : authOverride),
  handlers: {},
  signIn: async () => undefined,
  signOut: async () => undefined,
});

async function asUser<T>(session: Session, run: () => Promise<T>): Promise<T> {
  const previous = currentSession;
  currentSession = session;
  try {
    return await run();
  } finally {
    currentSession = previous;
  }
}

// ---------------------------------------------------------------------------
// 7. Network trap — nothing in this suite may open a socket
// ---------------------------------------------------------------------------

const networkCalls: string[] = [];
const blocked = (label: string) => {
  networkCalls.push(label);
  throw new Error(`Network access blocked in tenant-isolation test: ${label}`);
};

(globalThis as any).fetch = (input: unknown) =>
  blocked(`fetch ${String(input)}`);
const net = nodeRequire("node:net");
const http = nodeRequire("node:http");
const https = nodeRequire("node:https");
net.Socket.prototype.connect = function connect() {
  return blocked("net.Socket.connect");
};
http.request = () => blocked("http.request");
https.request = () => blocked("https.request");

// ---------------------------------------------------------------------------
// 8. Compile recorder / mutator
// ---------------------------------------------------------------------------

/**
 * Rewrites `eq(<table>.userId, userId)` into `eq(<table>.userId, <table>.userId)`
 * in the *transpiled* source, in memory. The result is a well-formed
 * self-tautology: the statement stays valid but the tenant binding is gone.
 */
const MUTATION_PATTERN =
  /\.eq\)\(([A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)*)\.userId\s*,\s*userId\)/g;

let mutating: { file: string; hits: number } | null = null;
const compiledFiles: string[] = [];

const originalCompile = (Module as any).prototype._compile;
(Module as any).prototype._compile = function patchedCompile(
  content: string,
  filename: string,
  ...rest: unknown[]
) {
  const resolved = path.resolve(filename);
  compiledFiles.push(resolved);
  let source = content;
  if (mutating && resolved === mutating.file) {
    const hits = source.match(MUTATION_PATTERN)?.length ?? 0;
    mutating.hits += hits;
    source = source.replace(
      MUTATION_PATTERN,
      (_match, table: string) => `.eq)(${table}.userId,${table}.userId)`,
    );
  }
  return originalCompile.call(this, source, filename, ...rest);
};

const SEEDED_PATHS = new Set([SERVER_ONLY_PATH, DB_PATH, AUTH_PATH]);
const LIB_DIR = path.join(WEB_ROOT, "lib") + path.sep;
const APP_DIR = path.join(WEB_ROOT, "app") + path.sep;

function purgeApplicationModules() {
  for (const key of Object.keys(nodeRequire.cache)) {
    if (SEEDED_PATHS.has(key)) continue;
    const resolved = path.resolve(key);
    if (resolved.startsWith(LIB_DIR) || resolved.startsWith(APP_DIR)) {
      delete (nodeRequire.cache as any)[key];
    }
  }
}

// ---------------------------------------------------------------------------
// 9. Route loading and the request surface
// ---------------------------------------------------------------------------

type Routes = {
  entries: RouteModule;
  entryId: RouteModule;
  threads: RouteModule;
  threadSlug: RouteModule;
  syncPull: RouteModule;
  syncPush: RouteModule;
  review: RouteModule;
  export: RouteModule;
};

function loadRoutes(): Routes {
  return {
    entries: nodeRequire("@/app/api/entries/route.ts"),
    entryId: nodeRequire("@/app/api/entries/[id]/route.ts"),
    threads: nodeRequire("@/app/api/threads/route.ts"),
    threadSlug: nodeRequire("@/app/api/threads/[slug]/route.ts"),
    syncPull: nodeRequire("@/app/api/sync/pull/route.ts"),
    syncPush: nodeRequire("@/app/api/sync/push/route.ts"),
    review: nodeRequire("@/app/api/review/route.ts"),
    export: nodeRequire("@/app/api/export/route.ts"),
  };
}

let routes = loadRoutes();

const request = (url: string) => new Request(`http://tenant.test${url}`);
const jsonRequest = (url: string, body: unknown, method = "POST") =>
  new Request(`http://tenant.test${url}`, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const api = {
  listEntries: (query = "") => routes.entries.GET(request(`/api/entries${query}`)),
  createEntry: (body: unknown) =>
    routes.entries.POST(jsonRequest("/api/entries", body)),
  getEntry: (id: string) =>
    routes.entryId.GET(request("/api/entries/x"), {
      params: Promise.resolve({ id }),
    }),
  patchEntry: (id: string, body: unknown) =>
    routes.entryId.PATCH(jsonRequest("/api/entries/x", body, "PATCH"), {
      params: Promise.resolve({ id }),
    }),
  deleteEntry: (id: string) =>
    routes.entryId.DELETE(request("/api/entries/x"), {
      params: Promise.resolve({ id }),
    }),
  listThreads: () => routes.threads.GET(),
  createThread: (body: unknown) =>
    routes.threads.POST(jsonRequest("/api/threads", body)),
  getThread: (slug: string) =>
    routes.threadSlug.GET(request("/api/threads/x"), {
      params: Promise.resolve({ slug }),
    }),
  patchThread: (slug: string, body: unknown) =>
    routes.threadSlug.PATCH(jsonRequest("/api/threads/x", body, "PATCH"), {
      params: Promise.resolve({ slug }),
    }),
  deleteThread: (slug: string) =>
    routes.threadSlug.DELETE(request("/api/threads/x"), {
      params: Promise.resolve({ slug }),
    }),
  pull: (query = "") => routes.syncPull.GET(request(`/api/sync/pull${query}`)),
  push: (ops: unknown[]) =>
    routes.syncPush.POST(jsonRequest("/api/sync/push", { ops })),
  review: () => routes.review.GET(),
  exportVault: () => routes.export.GET(),
};

/** Every handler exported by the eight route modules. */
const ALL_HANDLERS: { name: string; call: () => Promise<Response> }[] = [
  { name: "GET /api/entries", call: () => api.listEntries() },
  {
    name: "POST /api/entries",
    call: () =>
      api.createEntry({
        kind: "note",
        body: "x",
        chapter: "1.1",
        threads: ["a-thread"],
      }),
  },
  { name: "GET /api/entries/[id]", call: () => api.getEntry(B_ENTRY) },
  {
    name: "PATCH /api/entries/[id]",
    call: () => api.patchEntry(B_ENTRY, { body: "pwned" }),
  },
  { name: "DELETE /api/entries/[id]", call: () => api.deleteEntry(B_ENTRY) },
  { name: "GET /api/threads", call: () => api.listThreads() },
  {
    name: "POST /api/threads",
    call: () => api.createThread({ slug: "x-thread", title: "X" }),
  },
  { name: "GET /api/threads/[slug]", call: () => api.getThread(B_THREAD) },
  {
    name: "PATCH /api/threads/[slug]",
    call: () => api.patchThread(B_THREAD, { title: "pwned" }),
  },
  { name: "DELETE /api/threads/[slug]", call: () => api.deleteThread(B_THREAD) },
  { name: "GET /api/sync/pull", call: () => api.pull() },
  { name: "POST /api/sync/push", call: () => api.push([]) },
  { name: "GET /api/review", call: () => api.review() },
  { name: "GET /api/export", call: () => api.exportVault() },
];

async function readJson(response: Response): Promise<any> {
  return response.json();
}

/** `serverError` logs to the console; silence it for the paths that expect a 500. */
async function withSilencedErrors<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = original;
  }
}

// ---------------------------------------------------------------------------
// 10. Fixtures — synthetic only. No file is read from data/seed/, public/bible/,
//     Bible-Brain/, or any .env. Every value below is a literal.
// ---------------------------------------------------------------------------

const A_ENTRY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const B_ENTRY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const B_DELETED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const NEW_ENTRY = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OP_SHARED = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const op = (n: number) =>
  `eeeeeeee-eeee-4eee-8eee-eeeeeeeeee${String(n).padStart(2, "0")}`;

const A_THREAD = "a-thread";
const B_THREAD = "b-private-thread";
const B_RETIRED = "b-private-retired";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-02-02T00:00:00.000Z";
const T2 = "2026-03-03T00:00:00.000Z";

/**
 * Marker discipline: every B-owned string contains `B-PRIVATE-` (slugs included,
 * kebab-cased), and B's ids all begin `bbbbbbbb-`. `assertNoBLeak` stringifies a
 * whole response and asserts neither ever appears, which catches leakage through
 * fields an attack did not think to inspect.
 */
const B_LEAK_PATTERN = /B-PRIVATE-|bbbbbbbb-/i;

function assertNoBLeak(value: unknown, label: string) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const match = text.match(B_LEAK_PATTERN);
  assert.equal(
    match,
    null,
    `${label}: account B data leaked into account A's response (matched ${match?.[0]})`,
  );
}

function seedFixtures() {
  const rows: [Table, Row[]][] = [
    [
      schema.users,
      [
        { id: USER_A, email: EMAIL_A, name: "A" },
        { id: USER_B, email: EMAIL_B, name: "B" },
      ],
    ],
    [
      schema.threads,
      [
        {
          userId: USER_A,
          slug: A_THREAD,
          title: "A Thread",
          definition: "A's definition",
          seeing: "A's seeing",
          createdAt: T0,
          updatedAt: T0,
        },
        {
          userId: USER_B,
          slug: B_THREAD,
          title: "B-PRIVATE-THREAD-TITLE",
          definition: "B-PRIVATE-DEFINITION",
          seeing: "B-PRIVATE-SEEING",
          createdAt: T0,
          updatedAt: T0,
        },
        {
          userId: USER_B,
          slug: B_RETIRED,
          title: "B-PRIVATE-RETIRED-TITLE",
          createdAt: T0,
          updatedAt: T0,
          deletedAt: T1,
        },
      ],
    ],
    [
      schema.entries,
      [
        {
          id: A_ENTRY,
          userId: USER_A,
          kind: "observation",
          body: "A entry body",
          chapter: "1.3",
          createdAt: T0,
          updatedAt: T0,
        },
        {
          id: B_ENTRY,
          userId: USER_B,
          kind: "observation",
          body: "B-PRIVATE-BODY-MARKER",
          chapter: "40.1",
          createdAt: T0,
          updatedAt: T0,
        },
        {
          id: B_DELETED,
          userId: USER_B,
          kind: "note",
          body: "B-PRIVATE-DELETED-MARKER",
          chapter: "40.1",
          createdAt: T0,
          updatedAt: T1,
          deletedAt: T1,
        },
      ],
    ],
    [
      schema.entryThreads,
      [
        { entryId: A_ENTRY, userId: USER_A, threadSlug: A_THREAD, createdAt: T0 },
        { entryId: B_ENTRY, userId: USER_B, threadSlug: B_THREAD, createdAt: T0 },
      ],
    ],
    [
      schema.people,
      [
        {
          userId: USER_A,
          slug: "a-person",
          name: "A Person",
          body: "A body",
          chapters: ["1.3"],
          threadSlugs: [A_THREAD],
          createdAt: T0,
          updatedAt: T0,
        },
        {
          userId: USER_B,
          slug: "b-private-person",
          name: "B-PRIVATE-PERSON-MARKER",
          body: "B-PRIVATE-PERSON-BODY",
          chapters: ["40.1"],
          threadSlugs: [B_THREAD],
          createdAt: T0,
          updatedAt: T0,
        },
      ],
    ],
    [
      schema.dailyLogs,
      [
        {
          userId: USER_A,
          date: "2026-01-01",
          chapter: "1.3",
          read: true,
          sentence: "A sentence",
          updatedAt: T0,
        },
        {
          userId: USER_B,
          date: "2026-02-02",
          chapter: "40.1",
          read: true,
          sentence: "B-PRIVATE-LOG-MARKER",
          updatedAt: T1,
        },
      ],
    ],
    [
      schema.readingProgress,
      [
        { userId: USER_A, chapter: "1.3", readAt: T0 },
        { userId: USER_B, chapter: "40.1", readAt: T1 },
      ],
    ],
    [
      schema.stages,
      [
        {
          slug: "ascent-1",
          title: "Ascent One",
          stage: 1,
          side: "ascent",
          mirror: "descent-1",
          chapters: ["1.3"],
          summary: "",
        },
        {
          slug: "descent-1",
          title: "Descent One",
          stage: 2,
          side: "descent",
          mirror: "ascent-1",
          chapters: ["40.1"],
          summary: "",
        },
      ],
    ],
    [schema.syncReceipts, []],
  ];

  world.clear();
  for (const meta of metaByTable.values()) world.set(meta.sqlName, []);
  for (const [table, values] of rows) {
    const meta = metaOf(table);
    world.set(
      meta.sqlName,
      values.map((value) => applyDefaults(meta, value)),
    );
  }
}

/** Deep snapshot of every B-owned row, used to prove "B untouched". */
function snapshotB(): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const meta of metaByTable.values()) {
    if (!meta.tenantScoped) continue;
    out[meta.sqlName] = rowsOf(meta.sqlName)
      .filter((row) => row.userId === USER_B)
      .map(clone)
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      );
  }
  return out;
}

let pristineB: Record<string, Row[]> = {};

function resetWorld() {
  seedFixtures();
  pristineB = snapshotB();
}

const assertBUntouched = (label: string) =>
  assert.deepEqual(snapshotB(), pristineB, `${label}: account B's rows changed`);

const rowsFor = (sqlName: string, userId: string) =>
  rowsOf(sqlName).filter((row) => row.userId === userId);

const findEntry = (id: string) => rowsOf("entries").find((row) => row.id === id);

const progressRow = (userId: string, chapter: string) =>
  rowsOf("reading_progress").find(
    (row) => row.userId === userId && row.chapter === chapter,
  );

/** The wire shape `lib/sync/store.ts:markChapterRead` produces: the envelope
 *  timestamp is the payload's `readAt`, and the payload has no `updatedAt`
 *  because `ReadingProgress` (lib/contracts.ts:162-165) has none. */
const progressOp = (id: string, chapter: string, readAt: string) => ({
  id,
  entity: "progress",
  entityId: chapter,
  op: "upsert",
  updatedAt: readAt,
  payload: { chapter, readAt },
});

const logPayload = (date: string, sentence: string, updatedAt: string) => ({
  date,
  chapter: "1.5",
  steps: { read: true, observe: false, link: false, ask: false, pray: false },
  sentence,
  carrying: "",
  prayer: "",
  updatedAt,
});

// ---------------------------------------------------------------------------
// 11. Attack matrix. Each attack is a self-contained assertion function so the
//     mutation proof (section 13) can re-run the *identical* code and require
//     that it now fails.
// ---------------------------------------------------------------------------

const attacks = {
  // ---- 4.1 Authentication boundary -------------------------------------
  async A1_unauthenticated() {
    resetWorld();
    const before = statements.length;
    await asUser(null, async () => {
      for (const handler of ALL_HANDLERS) {
        const response = await handler.call();
        assert.equal(response.status, 401, `${handler.name} must be 401`);
        const body = await readJson(response);
        assert.equal(body.error.code, "UNAUTHORIZED", handler.name);
      }
    });
    assert.equal(
      statements.length,
      before,
      "an unauthenticated request reached the database",
    );
    assertBUntouched("A1");
  },

  async A2_revokedIdentity() {
    resetWorld();
    const before = statements.length;
    await asUser(SESSION_REVOKED, async () => {
      for (const handler of ALL_HANDLERS) {
        const response = await handler.call();
        assert.equal(response.status, 401, `${handler.name} must be 401`);
      }
    });
    assert.equal(
      statements.length,
      before,
      "a revoked identity reached the database",
    );
    assertBUntouched("A2");
  },

  async A3_authPrecedesValidation() {
    resetWorld();
    await asUser(null, async () => {
      const response = await api.getEntry("not-a-uuid");
      assert.equal(response.status, 401);
      const body = await readJson(response);
      assert.equal(body.error.code, "UNAUTHORIZED");
    });
  },

  async A4_positiveControlB() {
    resetWorld();
    await asUser(SESSION_B, async () => {
      const entries = await readJson(await api.listEntries());
      assert.deepEqual(
        entries.data.map((entry: any) => entry.id),
        [B_ENTRY],
        "B must see its own entry — otherwise this suite is vacuous",
      );
      assert.equal(entries.data[0].body, "B-PRIVATE-BODY-MARKER");

      const threads = await readJson(await api.listThreads());
      assert.deepEqual(
        threads.data.map((thread: any) => thread.slug),
        [B_THREAD],
      );

      const pull = await readJson(await api.pull());
      assert.deepEqual(
        pull.people.map((person: any) => person.slug),
        ["b-private-person"],
      );
    });
  },

  // ---- 4.2 Cross-tenant reads ------------------------------------------
  async R1_listEntries() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const response = await api.listEntries();
      assert.equal(response.status, 200);
      const body = await readJson(response);
      assert.deepEqual(
        body.data.map((entry: any) => entry.id),
        [A_ENTRY],
      );
      assertNoBLeak(body, "R1");
    });
  },

  async R2_listEntriesIncludingDeleted() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const body = await readJson(await api.listEntries("?includeDeleted=true"));
      const ids = body.data.map((entry: any) => entry.id);
      assert.ok(!ids.includes(B_DELETED), "B's deleted entry leaked");
      assert.deepEqual(ids, [A_ENTRY]);
      assertNoBLeak(body, "R2");
    });
  },

  async R3_filteredList() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const body = await readJson(
        await api.listEntries("?chapter=1.3&kind=observation"),
      );
      assert.deepEqual(
        body.data.map((entry: any) => entry.id),
        [A_ENTRY],
      );
      const other = await readJson(await api.listEntries("?chapter=40.1"));
      assert.deepEqual(other.data, [], "B's chapter must return nothing for A");
      assertNoBLeak(body, "R3");
    });
  },

  async R4_getBEntry() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const response = await api.getEntry(B_ENTRY);
      assert.equal(response.status, 404, "must be 404, not 403 — no existence oracle");
      const body = await readJson(response);
      assert.equal(body.error.code, "NOT_FOUND");
      assertNoBLeak(body, "R4");
    });
  },

  async R5_listThreads() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const body = await readJson(await api.listThreads());
      assert.deepEqual(
        body.data.map((thread: any) => thread.slug),
        [A_THREAD],
      );
      assertNoBLeak(body, "R5");
    });
  },

  async R6_getBThread() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const response = await api.getThread(B_THREAD);
      assert.equal(response.status, 404);
      assertNoBLeak(await readJson(response), "R6");
      const retired = await api.getThread(B_RETIRED);
      assert.equal(retired.status, 404);
    });
  },

  async R7_syncPull() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      for (const query of ["", `?since=${encodeURIComponent(T0)}`]) {
        const response = await api.pull(query);
        assert.equal(response.status, 200);
        const body = await readJson(response);
        assert.deepEqual(
          body.entries.map((entry: any) => entry.id),
          [A_ENTRY],
        );
        assert.deepEqual(
          body.threads.map((thread: any) => thread.slug),
          [A_THREAD],
        );
        assert.deepEqual(
          body.people.map((person: any) => person.slug),
          ["a-person"],
        );
        assert.deepEqual(
          body.progress.map((entry: any) => entry.chapter),
          ["1.3"],
        );
        assert.deepEqual(
          body.logs.map((log: any) => log.date),
          ["2026-01-01"],
        );
        assertNoBLeak(body, `R7 (since="${query}")`);
      }
    });
  },

  async R8_review() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const body = await readJson(await api.review());
      const snapshot = body.data;
      assert.deepEqual(snapshot.threads, [
        { slug: A_THREAD, title: "A Thread", inbound: 1 },
      ]);
      assert.equal(snapshot.chaptersRead, 1, "B's reading progress leaked");
      assert.deepEqual(snapshot.orphanEntries, []);
      assert.deepEqual(snapshot.coldThreads, []);
      assert.equal(snapshot.stagesStudied, 1);
      assert.equal(snapshot.totalStages, 2);
      assertNoBLeak(body, "R8");
    });
  },

  async R9_export() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const response = await api.exportVault();
      assert.equal(response.status, 200);
      const archive = new Uint8Array(await response.arrayBuffer());
      const files = unzipSync(archive);
      const names = Object.keys(files);
      assert.ok(names.length > 0, "export archive was empty");
      // Compressed-byte search would be unsound: inspect every decompressed member.
      for (const [name, bytes] of Object.entries(files)) {
        assertNoBLeak(name, `R9 filename "${name}"`);
        assertNoBLeak(strFromU8(bytes), `R9 member "${name}"`);
      }
      assert.ok(
        names.some((name) => name.includes("A Thread")),
        "A's own thread should still be exported",
      );
    });
  },

  // ---- 4.3 Cross-tenant create -----------------------------------------
  async C1_createEntryLinkingBThread() {
    resetWorld();
    const entryCount = rowsOf("entries").length;
    await asUser(SESSION_A, async () => {
      const response = await api.createEntry({
        kind: "note",
        body: "linking B's thread",
        chapter: "1.3",
        threads: [B_THREAD],
      });
      assert.equal(response.status, 409);
      const body = await readJson(response);
      assert.equal(body.error.code, "UNKNOWN_THREADS");
      assert.deepEqual(body.error.slugs, [B_THREAD]);
    });
    assert.equal(rowsOf("entries").length, entryCount, "an entry was created");
    assertBUntouched("C1");
  },

  async C2_idSquatOnBEntry() {
    resetWorld();
    const before = clone(findEntry(B_ENTRY));
    await asUser(SESSION_A, async () => {
      const response = await withSilencedErrors(() =>
        api.createEntry({
          id: B_ENTRY,
          kind: "note",
          body: "squatting B's id",
          chapter: "1.3",
          threads: [A_THREAD],
        }),
      );
      // Finding F2: this is a 500 rather than a clean 409 because createEntry
      // has no 23505 handler. It still fails closed, which is what matters here.
      assert.ok(
        response.status >= 400,
        "id-squatting another account's entry must not succeed",
      );
      assert.equal(response.status, 500);
      assert.equal((await readJson(response)).error.code, "INTERNAL_ERROR");
    });
    assert.deepEqual(findEntry(B_ENTRY), before, "B's entry was modified");
    assertBUntouched("C2");
  },

  async C3_createEntryWithSpoofedUserId() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const response = await api.createEntry({
        kind: "note",
        body: "spoofed tenant",
        chapter: "1.3",
        threads: [A_THREAD],
        userId: USER_B,
      });
      assert.equal(response.status, 400, "createEntrySchema is .strict()");
      assert.equal((await readJson(response)).error.code, "INVALID_REQUEST");
    });
    assertBUntouched("C3");
  },

  async C4_threadSlugNamespaceCollision() {
    resetWorld();
    const before = clone(
      rowsOf("threads").find(
        (row) => row.userId === USER_B && row.slug === B_THREAD,
      ),
    );
    await asUser(SESSION_A, async () => {
      const response = await api.createThread({
        slug: B_THREAD,
        title: "stolen",
      });
      // A namespace collision is not a takeover: the primary key is
      // (user_id, slug), so this creates A's own row.
      assert.equal(response.status, 201);
      const body = await readJson(response);
      assert.equal(body.data.title, "stolen");
    });
    const sameSlug = rowsOf("threads").filter((row) => row.slug === B_THREAD);
    assert.equal(sameSlug.length, 2, "expected one row per account");
    assert.deepEqual(
      sameSlug.find((row) => row.userId === USER_B),
      before,
      "B's thread was overwritten",
    );
    assert.equal(
      sameSlug.find((row) => row.userId === USER_A)?.title,
      "stolen",
    );
    assertBUntouched("C4");
  },

  async C5_createThreadWithSpoofedUserId() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const response = await api.createThread({
        slug: "a-second",
        title: "Second",
        userId: USER_B,
      });
      assert.equal(response.status, 400, "createThreadSchema is .strict()");
    });
    assertBUntouched("C5");
  },

  // ---- 4.4 Cross-tenant update -----------------------------------------
  async U1_patchBEntry() {
    resetWorld();
    const before = clone(findEntry(B_ENTRY));
    await asUser(SESSION_A, async () => {
      const response = await api.patchEntry(B_ENTRY, { body: "pwned" });
      assert.equal(response.status, 404);
      assertNoBLeak(await readJson(response), "U1");
    });
    assert.deepEqual(findEntry(B_ENTRY), before);
    assertBUntouched("U1");
  },

  async U2_patchBDeletedEntry() {
    resetWorld();
    const before = clone(findEntry(B_DELETED));
    await asUser(SESSION_A, async () => {
      const response = await api.patchEntry(B_DELETED, { body: "pwned" });
      assert.equal(response.status, 404);
    });
    assert.deepEqual(findEntry(B_DELETED), before);
    assertBUntouched("U2");
  },

  async U3_patchBThread() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const response = await api.patchThread(B_THREAD, { title: "pwned" });
      assert.equal(response.status, 404);
      assertNoBLeak(await readJson(response), "U3");
    });
    assertBUntouched("U3");
  },

  async U4_relinkAEntryToBThread() {
    resetWorld();
    const before = clone(rowsOf("entry_threads"));
    await asUser(SESSION_A, async () => {
      const response = await api.patchEntry(A_ENTRY, { threads: [B_THREAD] });
      assert.equal(response.status, 409);
      const body = await readJson(response);
      assert.equal(body.error.code, "UNKNOWN_THREADS");
      assert.deepEqual(body.error.slugs, [B_THREAD]);
    });
    assert.deepEqual(rowsOf("entry_threads"), before, "backlinks changed");
    // No backlink may pair one account's user_id with another's entry/thread.
    for (const link of rowsOf("entry_threads")) {
      const entry = findEntry(link.entryId as string);
      assert.equal(
        entry?.userId,
        link.userId,
        "a cross-tenant backlink exists",
      );
    }
    assertBUntouched("U4");
  },

  async U5_patchEntryWithSpoofedUserId() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const response = await api.patchEntry(A_ENTRY, { userId: USER_B });
      assert.equal(response.status, 400, "updateEntrySchema is .strict()");
    });
    assertBUntouched("U5");
  },

  // ---- 4.5 Cross-tenant delete -----------------------------------------
  async D1_deleteBEntry() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const response = await api.deleteEntry(B_ENTRY);
      assert.equal(response.status, 404);
    });
    assert.equal(findEntry(B_ENTRY)?.deletedAt, null, "B's entry was deleted");
    assertBUntouched("D1");
  },

  async D2_deleteBThread() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const response = await api.deleteThread(B_THREAD);
      assert.equal(response.status, 404);
    });
    const thread = rowsOf("threads").find(
      (row) => row.userId === USER_B && row.slug === B_THREAD,
    );
    assert.equal(thread?.deletedAt, null, "B's thread was soft-deleted");
    assertBUntouched("D2");
  },

  async D3_deleteBRetiredThread() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const response = await api.deleteThread(B_RETIRED);
      assert.equal(response.status, 404);
    });
    assertBUntouched("D3");
  },

  // ---- 4.6 Sync --------------------------------------------------------
  async S1_pushUpsertOverBEntry() {
    resetWorld();
    const before = clone(findEntry(B_ENTRY));
    await asUser(SESSION_A, async () => {
      const body = await readJson(
        await api.push([
          {
            id: op(1),
            entity: "entry",
            entityId: B_ENTRY,
            op: "upsert",
            updatedAt: T2,
            payload: {
              id: B_ENTRY,
              kind: "note",
              body: "pwned through sync",
              chapter: "1.3",
              threads: [A_THREAD],
              createdAt: T0,
              updatedAt: T2,
            },
          },
        ]),
      );
      assert.equal(body.rejected.length, 1);
      assert.equal(body.rejected[0].reason, "Entry ID belongs to another user");
    });
    assert.deepEqual(findEntry(B_ENTRY), before);
    assertBUntouched("S1");
  },

  async S2_pushDeleteOverBEntry() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const body = await readJson(
        await api.push([
          {
            id: op(2),
            entity: "entry",
            entityId: B_ENTRY,
            op: "delete",
            updatedAt: T2,
            payload: {
              id: B_ENTRY,
              kind: "note",
              body: "pwned",
              chapter: "1.3",
              threads: [],
              createdAt: T0,
              updatedAt: T2,
              deletedAt: T2,
            },
          },
        ]),
      );
      assert.equal(body.rejected[0].reason, "Entry ID belongs to another user");
    });
    assert.equal(findEntry(B_ENTRY)?.deletedAt, null);
    assertBUntouched("S2");
  },

  async S3_pushEntryReferencingBThread() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const body = await readJson(
        await api.push([
          {
            id: op(3),
            entity: "entry",
            entityId: NEW_ENTRY,
            op: "upsert",
            updatedAt: T2,
            payload: {
              id: NEW_ENTRY,
              kind: "note",
              body: "borrowing B's thread",
              chapter: "1.3",
              threads: [B_THREAD],
              createdAt: T2,
              updatedAt: T2,
            },
          },
        ]),
      );
      assert.equal(
        body.rejected[0].reason,
        "Entry references an unknown thread",
      );
    });
    assert.equal(findEntry(NEW_ENTRY), undefined);
    assertBUntouched("S3");
  },

  async S4_pushThreadWithBSlug() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const body = await readJson(
        await api.push([
          {
            id: op(4),
            entity: "thread",
            entityId: B_THREAD,
            op: "upsert",
            updatedAt: T2,
            payload: {
              slug: B_THREAD,
              title: "A's version",
              definition: "",
              seeing: "",
              createdAt: T2,
              updatedAt: T2,
            },
          },
        ]),
      );
      assert.deepEqual(body.rejected, []);
    });
    const written = rowsOf("threads").filter((row) => row.slug === B_THREAD);
    assert.equal(written.length, 2);
    assert.equal(
      written.find((row) => row.title === "A's version")?.userId,
      USER_A,
      "A's synced thread must be written under A",
    );
    assertBUntouched("S4");
  },

  async S5_pushProgressLogPerson() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const body = await readJson(
        await api.push([
          {
            id: op(6),
            entity: "log",
            entityId: "2026-03-03",
            op: "upsert",
            updatedAt: T2,
            payload: {
              date: "2026-03-03",
              chapter: "1.5",
              steps: {
                read: true,
                observe: false,
                link: false,
                ask: false,
                pray: false,
              },
              sentence: "A's sentence",
              carrying: "",
              prayer: "",
              updatedAt: T2,
            },
          },
          {
            id: op(7),
            entity: "person",
            entityId: "a-new-person",
            op: "upsert",
            updatedAt: T2,
            payload: {
              slug: "a-new-person",
              name: "A New Person",
              body: "",
              chapters: ["1.5"],
              threads: [],
              createdAt: T2,
              updatedAt: T2,
            },
          },
        ]),
      );
      assert.deepEqual(body.rejected, []);
    });
    assert.equal(
      rowsOf("daily_logs").find((row) => row.date === "2026-03-03")?.userId,
      USER_A,
    );
    assert.equal(
      rowsOf("people").find((row) => row.slug === "a-new-person")?.userId,
      USER_A,
    );
    assertBUntouched("S5");
  },

  async S6_receiptReplayIsolation() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const body = await readJson(
        await api.push([
          {
            id: OP_SHARED,
            entity: "log",
            entityId: "2026-03-03",
            op: "upsert",
            updatedAt: T2,
            payload: logPayload("2026-03-03", "A's sentence", T2),
          },
        ]),
      );
      assert.deepEqual(body.rejected, []);
    });
    assert.equal(
      rowsOf("sync_receipts").find((row) => row.opId === OP_SHARED)?.userId,
      USER_A,
    );

    await asUser(SESSION_B, async () => {
      const body = await readJson(
        await api.push([
          {
            id: OP_SHARED,
            entity: "log",
            entityId: "2026-04-04",
            op: "upsert",
            updatedAt: T2,
            payload: logPayload("2026-04-04", "B-PRIVATE-SECOND-LOG", T2),
          },
        ]),
      );
      assert.deepEqual(body.rejected, []);
    });

    // B's operation must be applied, not suppressed by A's receipt. This is
    // `hasReceipt`'s eq(syncReceipts.userId, userId) (lib/db/sync.ts:38) at the
    // app layer, mirroring db-invariants.sql's "Sync receipts are not
    // tenant-scoped" check.
    assert.ok(
      rowsFor("daily_logs", USER_B).some((row) => row.date === "2026-04-04"),
      "B's sync op was suppressed by A's receipt — receipts are not tenant-scoped",
    );
    assert.equal(
      rowsOf("sync_receipts").filter((row) => row.opId === OP_SHARED).length,
      2,
      "each account must hold its own receipt for the same op id",
    );
  },

  /**
   * Finding F4, now FIXED (SYNC-001) — this guard is inverted on purpose.
   *
   * `syncProgressSchema` (lib/api/sync.ts:63-68) carries no `updatedAt` field,
   * because `ReadingProgress` is a frozen v1 contract of exactly
   * `{ chapter, readAt }` (lib/contracts.ts:162-165) and the same schema types
   * the pull response. The old `parsePayload` compared a hard-coded
   * `payload.updatedAt` against `op.updatedAt`, so for progress it compared
   * `undefined` and rejected every operation, leaving `applyProgress`
   * unreachable. `parsePayload` now takes the timestamp accessor from its
   * caller and `applyProgress` passes `readAt`, so the cross-check is still
   * enforced — against the field progress actually carries.
   *
   * This test proves application and the full push -> apply -> pull round trip,
   * and keeps the tenant assertions: the row lands under A, the receipt is A's,
   * no B data appears in either response, and B's rows are untouched.
   */
  async F4_progressSyncRoundTrips() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const pushed = await readJson(
        await api.push([
          {
            id: op(9),
            entity: "progress",
            entityId: "1.5",
            op: "upsert",
            updatedAt: T2,
            payload: { chapter: "1.5", readAt: T2 },
          },
        ]),
      );
      assert.deepEqual(
        pushed.rejected,
        [],
        "a well-formed progress operation must be accepted",
      );
      assertNoBLeak(pushed, "F4 push");

      const pulled = await readJson(await api.pull());
      assert.deepEqual(
        pulled.progress
          .map((row: any) => `${row.chapter}@${row.readAt}`)
          .sort(),
        [`1.3@${T0}`, `1.5@${T2}`],
        "the applied progress must come back from sync pull",
      );
      assertNoBLeak(pulled, "F4 pull");
    });
    const written = progressRow(USER_A, "1.5");
    assert.equal(written?.readAt, T2, "progress sync did not reach the database");
    assert.equal(
      rowsOf("reading_progress").filter((row) => row.chapter === "1.5").length,
      1,
      "progress must be written for the acting account only",
    );
    assert.equal(
      rowsOf("sync_receipts").find((row) => row.opId === op(9))?.userId,
      USER_A,
    );
    assertBUntouched("F4");
  },

  /**
   * Monotonic-union merge rule: `readAt` may move forward, never backward.
   * A stale operation is absorbed idempotently (accepted, receipt written, no
   * value change) rather than rejected — it carries no new information — but the
   * stored value must not regress.
   */
  async F5_progressReadAtNeverRegresses() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const newer = await readJson(
        await api.push([progressOp(op(10), "1.3", T2)]),
      );
      assert.deepEqual(newer.rejected, []);
      assert.equal(progressRow(USER_A, "1.3")?.readAt, T2);

      const stale = await readJson(
        await api.push([progressOp(op(11), "1.3", T1)]),
      );
      assert.deepEqual(stale.rejected, []);
      assert.equal(
        progressRow(USER_A, "1.3")?.readAt,
        T2,
        "an older readAt overwrote a newer one — progress is not monotonic",
      );
      assert.equal(
        stale.progress.find((row: any) => row.chapter === "1.3")?.readAt,
        T2,
      );
    });
    assertBUntouched("F5");
  },

  /** A progress payload may not smuggle a tenant column or a foreign entityId. */
  async F6_progressSpoofedPayloadRejected() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const spoofed = await readJson(
        await api.push([
          {
            id: op(12),
            entity: "progress",
            entityId: "1.5",
            op: "upsert",
            updatedAt: T2,
            payload: { chapter: "1.5", readAt: T2, userId: USER_B },
          },
        ]),
      );
      assert.deepEqual(
        spoofed.rejected,
        [{ id: op(12), reason: "Invalid progress payload" }],
        "syncProgressSchema is .strict() — a userId field must be refused",
      );

      const mismatched = await readJson(
        await api.push([
          {
            id: op(13),
            entity: "progress",
            entityId: "40.1",
            op: "upsert",
            updatedAt: T2,
            payload: { chapter: "1.5", readAt: T2 },
          },
        ]),
      );
      assert.deepEqual(mismatched.rejected, [
        {
          id: op(13),
          reason: "Operation entityId does not match its payload",
        },
      ]);

      const deletion = await readJson(
        await api.push([
          {
            id: op(14),
            entity: "progress",
            entityId: "1.3",
            op: "delete",
            updatedAt: T2,
            payload: { chapter: "1.3", readAt: T2 },
          },
        ]),
      );
      assert.deepEqual(deletion.rejected, [
        {
          id: op(14),
          reason: "Reading progress is monotonic and cannot be deleted",
        },
      ]);
    });
    assert.equal(progressRow(USER_A, "1.5"), undefined);
    assert.equal(progressRow(USER_A, "1.3")?.readAt, T0, "progress was deleted");
    assertBUntouched("F6");
  },

  /**
   * The op is generated by the real client write path
   * (`lib/sync/store.ts:136-158`, `markChapterRead`) and pushed verbatim — no
   * field is rewritten here. This is what proves the client and the server
   * agree on the progress wire shape rather than the test agreeing with itself.
   */
  async F7_clientEmittedProgressOpIsAccepted() {
    resetWorld();
    const store = await import("@/lib/sync/store");
    const readAt = "2026-05-05T00:00:00.000Z";
    await store.markChapterRead({ chapter: "1.6", readAt });
    const queued = (await store.getPendingOps()).filter(
      (item) => item.entity === "progress",
    );
    try {
      assert.equal(
        queued.length,
        1,
        "markChapterRead must enqueue exactly one progress op",
      );
      assert.deepEqual(queued[0].payload, { chapter: "1.6", readAt });
      assert.equal(queued[0].updatedAt, readAt);

      await asUser(SESSION_A, async () => {
        const body = await readJson(await api.push(queued));
        assert.deepEqual(
          body.rejected,
          [],
          "the client's own progress op was refused by the server",
        );
        assert.equal(
          body.progress.find((row: any) => row.chapter === "1.6")?.readAt,
          readAt,
        );
      });
      assert.equal(progressRow(USER_A, "1.6")?.readAt, readAt);
    } finally {
      await store.removePendingOps(queued.map((item) => item.id));
    }
    assertBUntouched("F7");
  },

  /**
   * Criterion 3 guard: relaxing the cross-check for progress must not relax it
   * anywhere else. Every schema that declares `updatedAt` must still refuse an
   * operation whose envelope timestamp disagrees with its payload, or
   * last-write-wins could be driven from a forged envelope.
   */
  async F8_updatedAtCrossCheckStillEnforced() {
    resetWorld();
    const mismatched = [
      {
        id: op(15),
        entity: "thread",
        entityId: "a-mismatch",
        op: "upsert",
        updatedAt: T2,
        payload: {
          slug: "a-mismatch",
          title: "Mismatch",
          definition: "",
          seeing: "",
          createdAt: T0,
          updatedAt: T1,
        },
      },
      {
        id: op(16),
        entity: "entry",
        entityId: NEW_ENTRY,
        op: "upsert",
        updatedAt: T2,
        payload: {
          id: NEW_ENTRY,
          kind: "note",
          body: "mismatched envelope",
          chapter: "1.3",
          threads: [A_THREAD],
          createdAt: T0,
          updatedAt: T1,
        },
      },
      {
        id: op(17),
        entity: "person",
        entityId: "a-mismatch-person",
        op: "upsert",
        updatedAt: T2,
        payload: {
          slug: "a-mismatch-person",
          name: "Mismatch",
          body: "",
          chapters: [],
          threads: [],
          createdAt: T0,
          updatedAt: T1,
        },
      },
      {
        id: op(18),
        entity: "log",
        entityId: "2026-03-03",
        op: "upsert",
        updatedAt: T2,
        payload: logPayload("2026-03-03", "mismatched envelope", T1),
      },
    ];
    await asUser(SESSION_A, async () => {
      const body = await readJson(await api.push(mismatched));
      assert.deepEqual(
        body.rejected,
        mismatched.map((item) => ({
          id: item.id,
          reason: "Operation timestamp does not match its payload",
        })),
        "the updatedAt cross-check must stay enforced for every entity that carries one",
      );
    });
    assert.equal(rowsOf("threads").find((row) => row.slug === "a-mismatch"), undefined);
    assert.equal(findEntry(NEW_ENTRY), undefined);
    assert.equal(
      rowsOf("people").find((row) => row.slug === "a-mismatch-person"),
      undefined,
    );
    assert.equal(
      rowsOf("daily_logs").find((row) => row.date === "2026-03-03"),
      undefined,
    );
    assertBUntouched("F8");
  },

  /**
   * A chapter both accounts have read. The primary key is
   * (user_id, chapter), so this is a namespace overlap, not a takeover — but the
   * read A performs before writing must still be tenant-bound. T0 is OLDER than
   * B's readAt for 40.1 (T1): with the ownership predicate removed, B's row is
   * found as `current` and the monotonic guard silently swallows A's own first
   * read of that chapter. Mutation M3 proves exactly that.
   */
  async S9_pushProgressOverBChapter() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const body = await readJson(
        await api.push([progressOp(op(19), "40.1", T0)]),
      );
      assert.deepEqual(body.rejected, []);
      assertNoBLeak(body, "S9");
      assert.deepEqual(
        body.progress.map((row: any) => row.chapter).sort(),
        ["1.3", "40.1"],
        "A must see only A's own progress",
      );
    });
    const rows = rowsOf("reading_progress").filter(
      (row) => row.chapter === "40.1",
    );
    assert.equal(rows.length, 2, "expected one progress row per account");
    assert.equal(rows.find((row) => row.userId === USER_A)?.readAt, T0);
    assert.equal(
      rows.find((row) => row.userId === USER_B)?.readAt,
      T1,
      "B's reading progress was overwritten",
    );
    assertBUntouched("S9");
  },

  async S7_pushResponseBody() {
    resetWorld();
    await asUser(SESSION_A, async () => {
      const body = await readJson(
        await api.push([
          {
            id: op(8),
            entity: "log",
            entityId: "2026-03-03",
            op: "upsert",
            updatedAt: T2,
            payload: logPayload("2026-03-03", "A's sentence", T2),
          },
        ]),
      );
      // push re-pulls a full snapshot (app/api/sync/push/route.ts:35).
      assertNoBLeak(body, "S7");
    });
    assertBUntouched("S7");
  },

  async S8_bSnapshotSurvivesEveryAttack() {
    resetWorld();
    const expected = await asUser(SESSION_B, async () =>
      readJson(await api.pull()),
    );

    for (const attack of [
      attacksRef.S1_pushUpsertOverBEntry,
      attacksRef.S2_pushDeleteOverBEntry,
      attacksRef.S3_pushEntryReferencingBThread,
      attacksRef.S4_pushThreadWithBSlug,
      attacksRef.S5_pushProgressLogPerson,
      attacksRef.S9_pushProgressOverBChapter,
      attacksRef.F5_progressReadAtNeverRegresses,
      attacksRef.F6_progressSpoofedPayloadRejected,
    ]) {
      await attack();
    }

    const actual = await asUser(SESSION_B, async () => readJson(await api.pull()));
    // serverTime is generated per request and is not part of the tenant state.
    delete expected.serverTime;
    delete actual.serverTime;
    assert.deepEqual(
      actual,
      expected,
      "account A's sync attacks changed account B's snapshot",
    );
  },

  // ---- Finding F1: the schema-enforced guarantee hydrateEntries relies on --
  async F1_crossTenantBacklinkRejected() {
    resetWorld();
    // hydrateEntries (lib/db/entries.ts:54-68) has no user_id predicate. It is
    // safe only because entry_threads_user_entry_fk forbids this row. Assert the
    // constraint exists, exactly as tests/db-invariants.sql:63-70 does.
    assert.throws(
      () =>
        pocketPg
          .insert(schema.entryThreads)
          .values({
            entryId: A_ENTRY,
            userId: USER_B,
            threadSlug: B_THREAD,
          })
          .__execute(),
      (error: unknown) =>
        error instanceof DatabaseError &&
        error.code === "23503" &&
        error.message.includes("entry_threads_user_entry_fk"),
      "a backlink pairing A's entry with B's user_id must be rejected",
    );
  },

  async F1b_allowlistDistinguishesFixtures() {
    // The real allowlist module is not stubbed.
    const { isAllowedEmail } = nodeRequire("@/lib/auth/allowlist.ts");
    assert.equal(isAllowedEmail(EMAIL_A, EMAIL_A), true);
    assert.equal(isAllowedEmail(EMAIL_B, EMAIL_A), false);
    assert.equal(isAllowedEmail(EMAIL_A, EMAIL_B), false);
  },
};

const attacksRef = attacks;

// ---------------------------------------------------------------------------
// 12. Baseline suite
// ---------------------------------------------------------------------------

const BASELINE: [string, () => Promise<void>][] = [
  ["A1 unauthenticated requests reach no handler data", attacks.A1_unauthenticated],
  ["A2 a revoked identity (user.id === '') is refused", attacks.A2_revokedIdentity],
  ["A3 authentication is checked before id validation", attacks.A3_authPrecedesValidation],
  ["A4 positive control: B sees B's own records", attacks.A4_positiveControlB],
  ["R1 A's entry list excludes B", attacks.R1_listEntries],
  ["R2 includeDeleted does not expose B's deleted entry", attacks.R2_listEntriesIncludingDeleted],
  ["R3 filtered lists stay tenant-scoped", attacks.R3_filteredList],
  ["R4 reading B's entry by id returns 404", attacks.R4_getBEntry],
  ["R5 A's thread list excludes B", attacks.R5_listThreads],
  ["R6 reading B's thread by slug returns 404", attacks.R6_getBThread],
  ["R7 sync pull returns no B records", attacks.R7_syncPull],
  ["R8 the review snapshot counts only A", attacks.R8_review],
  ["R9 the vault export archive contains no B data", attacks.R9_export],
  ["C1 creating an entry against B's thread is refused", attacks.C1_createEntryLinkingBThread],
  ["C2 id-squatting B's entry fails closed", attacks.C2_idSquatOnBEntry],
  ["C3 a spoofed userId in a create payload is rejected", attacks.C3_createEntryWithSpoofedUserId],
  ["C4 a thread slug collision creates A's own row", attacks.C4_threadSlugNamespaceCollision],
  ["C5 a spoofed userId in a thread payload is rejected", attacks.C5_createThreadWithSpoofedUserId],
  ["U1 patching B's entry returns 404 and changes nothing", attacks.U1_patchBEntry],
  ["U2 patching B's deleted entry returns 404", attacks.U2_patchBDeletedEntry],
  ["U3 patching B's thread returns 404", attacks.U3_patchBThread],
  ["U4 relinking A's entry to B's thread is refused", attacks.U4_relinkAEntryToBThread],
  ["U5 a spoofed userId in a patch payload is rejected", attacks.U5_patchEntryWithSpoofedUserId],
  ["D1 deleting B's entry returns 404", attacks.D1_deleteBEntry],
  ["D2 deleting B's thread returns 404", attacks.D2_deleteBThread],
  ["D3 deleting B's retired thread returns 404", attacks.D3_deleteBRetiredThread],
  ["S1 sync upsert over B's entry id is rejected", attacks.S1_pushUpsertOverBEntry],
  ["S2 sync delete of B's entry is rejected", attacks.S2_pushDeleteOverBEntry],
  ["S3 sync entry referencing B's thread is rejected", attacks.S3_pushEntryReferencingBThread],
  ["S4 sync thread with B's slug is written under A", attacks.S4_pushThreadWithBSlug],
  ["S5 synced logs and people are written under A", attacks.S5_pushProgressLogPerson],
  ["F4 progress sync round-trips: pushed, applied, pulled", attacks.F4_progressSyncRoundTrips],
  ["F5 a stale readAt never overwrites a newer one", attacks.F5_progressReadAtNeverRegresses],
  ["F6 a spoofed or deleting progress payload is rejected", attacks.F6_progressSpoofedPayloadRejected],
  ["F7 the client's own progress op is accepted by the server", attacks.F7_clientEmittedProgressOpIsAccepted],
  ["F8 the updatedAt cross-check still holds for every other entity", attacks.F8_updatedAtCrossCheckStillEnforced],
  ["S9 progress for a chapter B also read stays tenant-scoped", attacks.S9_pushProgressOverBChapter],
  ["S6 sync receipts are tenant-scoped", attacks.S6_receiptReplayIsolation],
  ["S7 the push response body contains no B data", attacks.S7_pushResponseBody],
  ["S8 B's snapshot survives every sync attack", attacks.S8_bSnapshotSurvivesEveryAttack],
  ["F1 a cross-tenant backlink is rejected by the schema", attacks.F1_crossTenantBacklinkRejected],
  ["F1b the real allowlist distinguishes the fixtures", attacks.F1b_allowlistDistinguishesFixtures],
];

for (const [name, run] of BASELINE) test(name, run);

// ---------------------------------------------------------------------------
// 13. Criterion 4 — predicate-removal proof.
//     Mutations happen in memory during compilation. No file is written; the
//     on-disk hash and mtime are re-verified after every cycle.
// ---------------------------------------------------------------------------

type MutationReceipt = {
  id: string;
  target: string;
  hits: number;
  brokenAttacks: string[];
};

const mutationReceipts: MutationReceipt[] = [];

async function withMutation(
  id: string,
  relativeFile: string,
  body: () => Promise<string[]>,
) {
  const file = path.join(WEB_ROOT, relativeFile);
  const beforeHash = createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
  const beforeMtime = fs.statSync(file).mtimeMs;

  // Statements executed while a predicate is removed must never pollute the
  // suite-wide guards G1/G2.
  recording = false;
  mutating = { file, hits: 0 };
  purgeApplicationModules();
  routes = loadRoutes();

  let broken: string[] = [];
  try {
    assert.ok(
      mutating.hits > 0,
      `mutation ${id} matched nothing in ${relativeFile} — the compiled shape changed; update MUTATION_PATTERN`,
    );
    mutationReceipts.push({
      id,
      target: relativeFile,
      hits: mutating.hits,
      brokenAttacks: [],
    });
    broken = await body();
    mutationReceipts[mutationReceipts.length - 1].brokenAttacks = broken;
  } finally {
    mutating = null;
    purgeApplicationModules();
    routes = loadRoutes();
    recording = true;
    const afterHash = createHash("sha256")
      .update(fs.readFileSync(file))
      .digest("hex");
    assert.equal(afterHash, beforeHash, `${relativeFile} was modified on disk`);
    assert.equal(
      fs.statSync(file).mtimeMs,
      beforeMtime,
      `${relativeFile} mtime changed`,
    );
  }
}

/** Asserts each named baseline attack now fails, and returns their names. */
async function assertNowLeaks(
  entries: [string, () => Promise<void>][],
): Promise<string[]> {
  const broken: string[] = [];
  for (const [name, run] of entries) {
    await assert.rejects(
      async () => {
        await run();
      },
      (error: unknown) => error instanceof assert.AssertionError,
      `${name} still passed with its tenant predicate removed — the test does not actually depend on it`,
    );
    broken.push(name);
  }
  return broken;
}

test("M1 removing tenant predicates from lib/db/entries.ts breaks R1/R4/U1/D1", async () => {
  await withMutation("M1", path.join("lib", "db", "entries.ts"), () =>
    assertNowLeaks([
      ["R1", attacks.R1_listEntries],
      ["R4", attacks.R4_getBEntry],
      ["U1", attacks.U1_patchBEntry],
      ["D1", attacks.D1_deleteBEntry],
    ]),
  );
});

test("M2 removing tenant predicates from lib/db/threads.ts breaks R5/R6/U3/D2", async () => {
  await withMutation("M2", path.join("lib", "db", "threads.ts"), () =>
    assertNowLeaks([
      ["R5", attacks.R5_listThreads],
      ["R6", attacks.R6_getBThread],
      ["U3", attacks.U3_patchBThread],
      ["D2", attacks.D2_deleteBThread],
    ]),
  );
});

test("M3 removing tenant predicates from lib/db/sync.ts breaks R7/S6/S9", async () => {
  await withMutation("M3", path.join("lib", "db", "sync.ts"), () =>
    assertNowLeaks([
      ["R7", attacks.R7_syncPull],
      ["S6", attacks.S6_receiptReplayIsolation],
      ["S9", attacks.S9_pushProgressOverBChapter],
    ]),
  );
});

test("M4 removing tenant predicates from lib/db/review.ts breaks R8", async () => {
  await withMutation("M4", path.join("lib", "db", "review.ts"), () =>
    assertNowLeaks([["R8", attacks.R8_review]]),
  );
});

test("M5 the identity seam itself is load-bearing", async () => {
  recording = false;
  authOverride = SESSION_B;
  let broken: string[] = [];
  try {
    broken = await assertNowLeaks([
      ["R1", attacks.R1_listEntries],
      ["R5", attacks.R5_listThreads],
    ]);
  } finally {
    authOverride = undefined;
    recording = true;
  }
  mutationReceipts.push({
    id: "M5",
    target: "auth seam (auth() returns B)",
    hits: 1,
    brokenAttacks: broken,
  });
});

test("baseline isolation still holds after every mutation", async () => {
  for (const run of [
    attacks.R1_listEntries,
    attacks.R4_getBEntry,
    attacks.R5_listThreads,
    attacks.R7_syncPull,
    attacks.R8_review,
    attacks.U1_patchBEntry,
    attacks.D1_deleteBEntry,
    attacks.S6_receiptReplayIsolation,
  ]) {
    await run();
  }
  assert.equal(mutationReceipts.length, 5, "expected five mutation cycles");
  for (const receipt of mutationReceipts) {
    assert.ok(receipt.hits > 0, `${receipt.id} matched no predicate`);
    assert.ok(
      receipt.brokenAttacks.length > 0,
      `${receipt.id} broke no attack`,
    );
  }
  console.log(
    "MUTATION RECEIPT:",
    JSON.stringify(mutationReceipts, null, 2),
  );
});

// ---------------------------------------------------------------------------
// 14. Suite-wide guards
// ---------------------------------------------------------------------------

/** The three named, code-referenced exemptions to G2. */
function coverageExemption(statement: Statement): string | null {
  const tables = statement.tables.join(",");
  const fields = statement.selectFields?.join(",") ?? null;

  if (
    statement.op === "select" &&
    tables === "entries" &&
    fields === "userId,updatedAt"
  ) {
    return "lib/db/sync.ts:87-95 — deliberate cross-tenant id-collision guard (finding F3); returns ownership metadata only";
  }
  if (
    statement.op === "select" &&
    tables === "entry_threads,threads" &&
    fields === "entryId,threadSlug"
  ) {
    // Safe only because of the FK entry_threads_user_entry_fk
    // (db/schema.ts:153-157), which test F1 proves is enforced.
    return "lib/db/entries.ts:54-68 hydrateEntries (finding F1) — depends on FK entry_threads_user_entry_fk";
  }
  return null;
}

test("G1 no statement binds a tenant id other than the acting account's", () => {
  assert.ok(statements.length > 100, "the recorder captured too little to trust");
  const bound = statements.filter(
    (statement) =>
      statement.boundTenantIds.length > 0 || statement.rowTenantIds.length > 0,
  );
  // Guards against a vacuous pass: the check below must actually inspect
  // tenant-bound statements from both accounts, not an empty set.
  assert.ok(
    bound.length > 50,
    `only ${bound.length} statements carried a tenant id — G1 would be vacuous`,
  );
  for (const actor of [USER_A, USER_B]) {
    assert.ok(
      bound.some((statement) => statement.actingUserId === actor),
      `no tenant-bound statement was recorded while acting as ${actor}`,
    );
  }
  console.log(
    `G1 INSPECTED: ${statements.length} statements recorded, ${bound.length} carrying a tenant id ` +
      `(A=${bound.filter((s) => s.actingUserId === USER_A).length}, B=${bound.filter((s) => s.actingUserId === USER_B).length})`,
  );
  for (const statement of statements) {
    if (!statement.actingUserId) continue;
    for (const bound of [
      ...statement.boundTenantIds,
      ...statement.rowTenantIds,
    ]) {
      assert.equal(
        bound,
        statement.actingUserId,
        `a ${statement.op} on ${statement.tables.join(",")} acting as ${statement.actingUserId} bound user_id=${String(bound)} — whereSql: ${statement.whereSql}`,
      );
    }
  }
});

test("G2 every statement on a tenant table binds user_id", () => {
  const exemptions = new Set<string>();
  for (const statement of statements) {
    const touched = statement.tables.filter((table) =>
      TENANT_TABLES.has(table),
    );
    if (touched.length === 0) continue;
    if (statement.boundTenantIds.length > 0) continue;
    if (statement.op === "insert" && statement.rowTenantIds.length > 0) continue;

    const exemption = coverageExemption(statement);
    assert.ok(
      exemption,
      `unexempted statement without a tenant binding: ${statement.op} on ${statement.tables.join(",")} fields=${statement.selectFields?.join(",")} whereSql=${statement.whereSql}`,
    );
    exemptions.add(exemption);
  }
  assert.ok(exemptions.size <= 2, "more exemptions were used than are declared");
  console.log("G2 EXEMPTIONS USED:", JSON.stringify([...exemptions], null, 2));
});

test("G3 the real Neon client was never constructed", () => {
  const seeded = (nodeRequire.cache as any)[DB_PATH];
  assert.equal(
    seeded?.exports.db,
    pocketPg,
    "@/lib/db no longer resolves to PocketPg",
  );
  const realClient = path.join(WEB_ROOT, "lib", "db", "index.ts");
  assert.ok(
    !compiledFiles.includes(realClient),
    "lib/db/index.ts was compiled — a real database client may have been built",
  );
  const authConfig = path.join(WEB_ROOT, "lib", "auth", "config.ts");
  assert.ok(
    !compiledFiles.includes(authConfig),
    "lib/auth/config.ts was compiled — NextAuth may have been constructed",
  );
  assert.equal(
    process.env.DATABASE_URL,
    "postgresql://never:used@127.0.0.1:1/none",
  );
});

test("G4 no network call was attempted", () => {
  assert.deepEqual(networkCalls, []);
});
