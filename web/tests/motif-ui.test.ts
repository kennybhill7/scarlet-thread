/**
 * RADARUI-001 — hostile two-account proof for the motif-radar wiring routes
 * (`app/api/motifs/route.ts` GET, `app/api/motifs/[id]/route.ts` POST),
 * built the same way `tests/v2-api.test.ts` (route-level) and
 * `tests/radar-persist.test.ts` (persistence-level) already prove their own
 * layers: real route handlers and the real `lib/db/radar.ts` persistence
 * functions run against a small in-memory "PocketPg-lite" store, compiled
 * through the genuine `PgDialect` — nothing under `app/` or `lib/db/radar.ts`
 * is hand-reimplemented. The only seams replaced in `require.cache` are the
 * identity boundary (`@/lib/auth/config`), the database client (`@/lib/db`),
 * and the two v1 reads this task's routes call to feed the radar
 * (`@/lib/db/entries`'s `listEntries`, `@/lib/db/threads`'s `listThreads`) —
 * their own internal join logic is exhaustively covered elsewhere
 * (`tests/entries.test.ts` et al., not owned by this task) and is irrelevant
 * to what this file proves, so they are replaced with fixture-backed stubs
 * exactly like `tenant-isolation.test.ts` replaces `@/lib/auth/config`.
 *
 * `lib/db/workspaces.ts` and `lib/db/radar.ts` (both readOnlyPaths for this
 * task) are NOT stubbed — `getOrCreatePersonalWorkspace`,
 * `persistMotifCandidates`, `dismissMotifCandidate`, and
 * `promoteMotifCandidate` all run for real against the fake `@/lib/db`
 * below, same discipline as `tests/v2-api.test.ts`'s own header explains.
 * MOTIFTHREAD-001 is rewriting `lib/db/radar.ts` in parallel; this file
 * codes only against the exported signatures documented in that file's own
 * header as of this run (`persistMotifCandidates(workspaceId, entries,
 * threads)`, `dismissMotifCandidate(workspaceId, candidateId)`,
 * `promoteMotifCandidate(workspaceId, userId, candidateId, {
 * learnerConfirmed })`, and the five named error classes / five status
 * constants imported below) — see this task's final report for that
 * assumption stated plainly.
 *
 * Every fixture seeds a pre-existing personal workspace per user (mirroring
 * `tests/v2-api.test.ts`), so `getOrCreatePersonalWorkspace`'s read-mostly
 * short-circuit always finds a row and this harness's insert builder is
 * never asked to support `.onConflictDoNothing()`/`.returning()`.
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
import type { Entry, EntryKind, Thread } from "@/lib/contracts";

/* eslint-disable @typescript-eslint/no-explicit-any --
 * Route modules and drizzle builders are loaded dynamically and reloaded
 * after the mutation cycle, so their shapes cannot be named statically here
 * — same rationale as tenant-isolation.test.ts and v2-api.test.ts. */

// ---------------------------------------------------------------------------
// 0. Bootstrap
// ---------------------------------------------------------------------------

const WEB_ROOT = path.resolve(__dirname, "..");
const nodeRequire = createRequire(__filename);

process.env.DATABASE_URL = "postgresql://never:used@127.0.0.1:1/none";

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

const SERVER_ONLY_PATH = seedModule("server-only", {});

// ---------------------------------------------------------------------------
// 1. Schema registry — only the tables this task's routes and the
//    lib/db/radar.ts functions they call actually touch.
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
  if (!meta) throw new Error(`PocketPg-lite (motif-ui) does not model table "${getTableName(table)}"`);
  return meta;
}

function normalizeRow(meta: TableMeta, row: Row): Row {
  const out: Row = {};
  for (const prop of Object.keys(meta.columns)) out[prop] = row[prop] ?? null;
  return out;
}

// ---------------------------------------------------------------------------
// 2. WHERE evaluator — single-table only, supporting exactly what this
//    task's routes and lib/db/radar.ts emit: `=`, `is null`, `and`. Ported
//    verbatim from tests/radar-persist.test.ts / tests/v2-api.test.ts (same
//    reasoning: real compiled SQL text, not a re-guessed grammar).
// ---------------------------------------------------------------------------

function evaluatePredicate(predicate: Predicate, row: Row, sqlName: string): boolean {
  const { sql, params } = predicate;
  let pos = 0;
  const fail = (reason: string): never => {
    throw new Error(`PocketPg-lite (motif-ui) cannot evaluate SQL (${reason}) at offset ${pos} of: ${sql}`);
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
// 3. PocketPg-lite — select().from().where().orderBy().limit() /
//    insert()... / update().set().where() / batch()
// ---------------------------------------------------------------------------

const dialect = new PgDialect();
const world = new Map<string, Row[]>();

function resetWorld() {
  world.clear();
  for (const table of MODELLED_TABLES) world.set(getTableName(table), []);
}

const rowsOf = (sqlName: string): Row[] => {
  const rows = world.get(sqlName);
  if (!rows) throw new Error(`PocketPg-lite (motif-ui) has no table "${sqlName}"`);
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
    orderBy() {
      // No test in this file depends on row order — every assertion checks
      // set membership / specific ids, never positional order — so a no-op
      // is faithful to what's actually proven here. Same convention
      // tests/v2-api.test.ts uses for the same reason.
      return builder;
    },
    limit(count: number) {
      limitCount = count;
      return builder;
    },
    then: (resolve: any, reject: any) =>
      Promise.resolve()
        .then(() => {
          if (!from) throw new Error("PocketPg-lite (motif-ui) received a select without from()");
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
                throw new Error(`PocketPg-lite (motif-ui) does not model select field "${key}" of this shape`);
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
  /** Neon HTTP batch is one transaction — lib/db/radar.ts's
   *  promoteMotifCandidate relies on exactly this snapshot/restore
   *  behavior for its atomicity guarantee. */
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
  execute: () => {
    throw new Error(
      "PocketPg-lite (motif-ui) does not implement db.execute() — every fixture must seed a " +
        "pre-existing personal workspace so lib/db/workspaces.ts never falls through to its " +
        "insert path. If this fires, a test is missing seedWorkspace() for a user id.",
    );
  },
};

const DB_PATH = seedModule("@/lib/db", { db: pocketPg });

// ---------------------------------------------------------------------------
// 4. Identity seam + the two v1-read seams this task's GET route calls.
// ---------------------------------------------------------------------------

type Session = { user: { id: string; email: string } } | null;

const USER_A = "user-a";
const USER_B = "user-b";
const WORKSPACE_A = "workspace-a";
const WORKSPACE_B = "workspace-b";

const SESSION_A: Session = { user: { id: USER_A, email: "a@example.test" } };
const SESSION_B: Session = { user: { id: USER_B, email: "b@example.test" } };

let currentSession: Session = null;

const AUTH_PATH = seedModule("@/lib/auth/config", {
  auth: async () => currentSession,
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

/** Three distinct-passage entries for the word "covenant" — same fixture
 * shape tests/radar.test.ts / tests/radar-persist.test.ts already use,
 * reconstructed independently here per this repo's self-contained-test-file
 * convention (never imported across test files). */
function threeCovenantEntries(): Entry[] {
  return [
    mkEntry({ body: "a covenant renewed here", chapter: "1.1" }),
    mkEntry({ body: "another covenant sighting", chapter: "2.1", kind: "question" }),
    mkEntry({ body: "covenant language a third time", chapter: "3.1" }),
  ];
}

const entriesByUser = new Map<string, Entry[]>();
const threadsByUser = new Map<string, Thread[]>();

function seedEntries(userId: string, entries: Entry[]) {
  entriesByUser.set(userId, entries);
}
function seedThreads(userId: string, threads: Thread[]) {
  threadsByUser.set(userId, threads);
}

const ENTRIES_PATH = seedModule("@/lib/db/entries", {
  listEntries: async (userId: string) => entriesByUser.get(userId) ?? [],
});
const THREADS_PATH = seedModule("@/lib/db/threads", {
  listThreads: async (userId: string) => threadsByUser.get(userId) ?? [],
});

// ---------------------------------------------------------------------------
// 5. Network trap — nothing in this suite may open a socket.
// ---------------------------------------------------------------------------

const blocked = (label: string) => {
  throw new Error(`Network access blocked in motif-ui test: ${label}`);
};
(globalThis as any).fetch = (input: unknown) => blocked(`fetch ${String(input)}`);
const net = nodeRequire("node:net");
const http = nodeRequire("node:http");
const https = nodeRequire("node:https");
net.Socket.prototype.connect = function connect() {
  return blocked("net.Socket.connect");
};
http.request = () => blocked("http.request");
https.request = () => blocked("https.request");

// ---------------------------------------------------------------------------
// 6. Compile recorder / mutator — two named mutations, both against
//    app/api/motifs/[id]/route.ts (the only file either targets), in the
//    same in-memory-source-rewrite style tests/v2-api.test.ts's M1 and
//    tests/tenant-isolation.test.ts's MUTATION_PATTERN use. No file is
//    written to disk; the on-disk hash and mtime are re-verified after
//    every cycle.
// ---------------------------------------------------------------------------

type MutationSpec = { file: string; pattern: RegExp; replacement: string; hits: number };

// WAVE 9 INTEGRATION: this was a single-file hook. MOTIFSTATUS-001 gave
// lib/db/radar.ts its own already-resolved guard, so proving the route's
// guard still matters now takes TWO simultaneous mutations -- see MUTPROVE-2a
// / MUTPROVE-2b below.
let mutations: MutationSpec[] = [];

const originalCompile = (Module as any).prototype._compile;
(Module as any).prototype._compile = function patchedCompile(
  content: string,
  filename: string,
  ...rest: unknown[]
) {
  const resolved = path.resolve(filename);
  let source = content;
  for (const mutation of mutations) {
    if (resolved !== mutation.file) continue;
    const hits = source.match(mutation.pattern)?.length ?? 0;
    mutation.hits += hits;
    source = source.replace(mutation.pattern, mutation.replacement);
  }
  return originalCompile.call(this, source, filename, ...rest);
};

const SEEDED_PATHS = new Set([SERVER_ONLY_PATH, DB_PATH, AUTH_PATH, ENTRIES_PATH, THREADS_PATH]);
const APP_DIR = path.join(WEB_ROOT, "app") + path.sep;

function purgeApplicationModules() {
  // Anything currently under mutation must be recompiled even when it lives
  // outside app/ -- lib/db/radar.ts would otherwise stay cached from an
  // earlier require and the mutation would silently no-op, which is exactly
  // the kind of quietly-vacuous proof this file exists to avoid.
  const mutated = new Set(mutations.map((m) => m.file));
  for (const key of Object.keys(nodeRequire.cache)) {
    const resolved = path.resolve(key);
    if (mutated.has(resolved)) {
      delete (nodeRequire.cache as any)[key];
      continue;
    }
    if (SEEDED_PATHS.has(key)) continue;
    if (resolved.startsWith(APP_DIR)) {
      delete (nodeRequire.cache as any)[key];
    }
  }
}

async function withMutations(
  specs: { relativeFile: string; pattern: RegExp; replacement: string }[],
  body: () => Promise<void>,
) {
  const targets = specs.map((spec) => {
    const file = path.join(WEB_ROOT, spec.relativeFile);
    return {
      relativeFile: spec.relativeFile,
      file,
      beforeHash: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      beforeMtime: fs.statSync(file).mtimeMs,
    };
  });

  mutations = specs.map((spec, i) => ({
    file: targets[i].file,
    pattern: spec.pattern,
    replacement: spec.replacement,
    hits: 0,
  }));
  const applied = mutations;
  purgeApplicationModules();
  routes = loadRoutes();

  try {
    for (const [i, mutation] of applied.entries()) {
      assert.ok(
        mutation.hits > 0,
        `mutation matched nothing in ${specs[i].relativeFile} — the compiled shape changed; update the pattern`,
      );
    }
    await body();
  } finally {
    mutations = [];
    purgeApplicationModules();
    routes = loadRoutes();
    for (const target of targets) {
      const afterHash = createHash("sha256").update(fs.readFileSync(target.file)).digest("hex");
      assert.equal(afterHash, target.beforeHash, `${target.relativeFile} was modified on disk`);
      assert.equal(
        fs.statSync(target.file).mtimeMs,
        target.beforeMtime,
        `${target.relativeFile} mtime changed`,
      );
    }
  }
}

async function withMutation(
  relativeFile: string,
  pattern: RegExp,
  replacement: string,
  body: () => Promise<void>,
) {
  await withMutations([{ relativeFile, pattern, replacement }], body);
}

// ---------------------------------------------------------------------------
// 7. Route loading and the request surface
// ---------------------------------------------------------------------------

type RouteModule = Record<string, (...args: any[]) => Promise<Response>>;

type Routes = {
  list: RouteModule;
  action: RouteModule;
};

function loadRoutes(): Routes {
  return {
    list: nodeRequire("@/app/api/motifs/route.ts"),
    action: nodeRequire("@/app/api/motifs/[id]/route.ts"),
  };
}

let routes = loadRoutes();

const req = (url: string, method = "GET", body?: unknown) =>
  new Request(`http://motif.test${url}`, {
    method,
    ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
const withParams = (id: string) => ({ params: Promise.resolve({ id }) });

const api = {
  list: () => routes.list.GET(req("/api/motifs")),
  act: (id: string, action: "confirm" | "dismiss") =>
    routes.action.POST(req(`/api/motifs/${id}`, "POST", { action }), withParams(id)),
  actRaw: (id: string, body: unknown) =>
    routes.action.POST(req(`/api/motifs/${id}`, "POST", body), withParams(id)),
};

// ---------------------------------------------------------------------------
// 8. Fixtures
// ---------------------------------------------------------------------------

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
  currentSession = null;
  entriesByUser.clear();
  threadsByUser.clear();
  seedWorkspace(WORKSPACE_A, USER_A);
  seedWorkspace(WORKSPACE_B, USER_B);
});

// ---------------------------------------------------------------------------
// 9. Auth
// ---------------------------------------------------------------------------

test("GET /api/motifs requires an authenticated session", async () => {
  const response = await api.list();
  assert.equal(response.status, 401);
});

test("POST /api/motifs/[id] requires an authenticated session", async () => {
  const response = await api.act("anything", "confirm");
  assert.equal(response.status, 401);
});

// ---------------------------------------------------------------------------
// 10. GET /api/motifs — list, persist, workspace scoping
// ---------------------------------------------------------------------------

test("GET /api/motifs persists a new candidate and returns it with label, passages, and a real id", async () => {
  seedEntries(USER_A, threeCovenantEntries());
  seedThreads(USER_A, []);

  const response = await asUser(SESSION_A, () => api.list());
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: Array<{ id: string; label: string; normalizedKey: string; passages: string[]; sightingCount: number }>;
  };
  assert.equal(body.data.length, 1);
  const [candidate] = body.data;
  assert.equal(candidate.label, "covenant");
  assert.equal(candidate.normalizedKey, "covenant");
  assert.equal(candidate.sightingCount, 3);
  assert.deepEqual(candidate.passages, ["1.1", "2.1", "3.1"]);
  assert.ok(candidate.id, "the returned candidate must carry a real persisted id");

  // Actually persisted, not merely computed in-memory and thrown away.
  assert.equal(rowsOf("motif_candidates").length, 1);
  assert.equal(rowsOf("motif_candidates")[0].workspaceId, WORKSPACE_A);
});

test("GET /api/motifs is dedup-safe: calling it twice does not duplicate the candidate row or the list entry", async () => {
  seedEntries(USER_A, threeCovenantEntries());
  seedThreads(USER_A, []);

  await asUser(SESSION_A, () => api.list());
  const second = await asUser(SESSION_A, () => api.list());
  const body = (await second.json()) as { data: unknown[] };

  assert.equal(body.data.length, 1, "the second GET must not list a duplicate candidate");
  assert.equal(rowsOf("motif_candidates").length, 1, "the second GET must not persist a duplicate row");
});

test("GET /api/motifs as A never lists workspace B's persisted candidate", async () => {
  seedEntries(USER_A, threeCovenantEntries());
  seedThreads(USER_A, []);
  seedEntries(USER_B, threeCovenantEntries());
  seedThreads(USER_B, []);

  // Prime both workspaces' persisted candidates first.
  await asUser(SESSION_A, () => api.list());
  await asUser(SESSION_B, () => api.list());
  assert.equal(rowsOf("motif_candidates").length, 2, "each workspace must get its own persisted row");

  const response = await asUser(SESSION_A, () => api.list());
  const body = (await response.json()) as { data: Array<{ id: string }> };
  assert.equal(body.data.length, 1);
  const candidateAId = rowsOf("motif_candidates").find((r) => r.workspaceId === WORKSPACE_A)!.id as string;
  const candidateBId = rowsOf("motif_candidates").find((r) => r.workspaceId === WORKSPACE_B)!.id as string;
  assert.deepEqual(body.data.map((row) => row.id), [candidateAId]);
  assert.ok(!body.data.map((row) => row.id).includes(candidateBId), "B's candidate leaked into A's list");
});

// ---------------------------------------------------------------------------
// 11. POST /api/motifs/[id] — confirm / dismiss, happy paths
// ---------------------------------------------------------------------------

async function seedPendingCandidate(workspaceId: string): Promise<string> {
  const radar = nodeRequire("@/lib/db/radar.ts") as typeof import("@/lib/db/radar");
  const [summary] = await radar.persistMotifCandidates(workspaceId, threeCovenantEntries(), []);
  return summary.id;
}

test("POST confirm on a genuinely offered candidate promotes it: creates a thread, marks candidate+sightings promoted", async () => {
  const candidateId = await seedPendingCandidate(WORKSPACE_A);

  const response = await asUser(SESSION_A, () => api.act(candidateId, "confirm"));
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: { action: string; candidateId: string; threadSlug: string; threadTitle: string };
  };
  assert.equal(body.data.action, "confirm");
  assert.equal(body.data.candidateId, candidateId);
  assert.equal(body.data.threadSlug, "covenant");

  assert.equal(rowsOf("threads").length, 1);
  assert.equal(rowsOf("threads")[0].userId, USER_A);
  const candidateRow = rowsOf("motif_candidates").find((r) => r.id === candidateId)!;
  assert.equal(candidateRow.status, "promoted");
  for (const sighting of rowsOf("motif_sightings").filter((r) => r.candidateId === candidateId)) {
    assert.equal(sighting.status, "promoted");
  }
});

test("POST dismiss on a genuinely offered candidate marks it dismissed and never touches its sightings", async () => {
  const candidateId = await seedPendingCandidate(WORKSPACE_A);
  const sightingsBefore = clone(rowsOf("motif_sightings").filter((r) => r.candidateId === candidateId));

  const response = await asUser(SESSION_A, () => api.act(candidateId, "dismiss"));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: { action: string; candidateId: string } };
  assert.equal(body.data.action, "dismiss");

  assert.equal(rowsOf("threads").length, 0, "dismissing must never create a thread");
  const candidateRow = rowsOf("motif_candidates").find((r) => r.id === candidateId)!;
  assert.equal(candidateRow.status, "dismissed");
  assert.deepEqual(
    rowsOf("motif_sightings").filter((r) => r.candidateId === candidateId),
    sightingsBefore,
    "dismissing must not touch a single sighting row",
  );
});

test("POST with an invalid action body is rejected (400), never defaulted to confirm", async () => {
  const candidateId = await seedPendingCandidate(WORKSPACE_A);

  const missing = await asUser(SESSION_A, () => api.actRaw(candidateId, {}));
  assert.equal(missing.status, 400);
  const bogus = await asUser(SESSION_A, () => api.actRaw(candidateId, { action: "promote-please" }));
  assert.equal(bogus.status, 400);

  // Neither malformed request may have changed anything.
  const candidateRow = rowsOf("motif_candidates").find((r) => r.id === candidateId)!;
  assert.equal(candidateRow.status, "candidate");
  assert.equal(rowsOf("threads").length, 0);
});

test("acting twice on the same candidate is refused the second time (409), not silently re-run", async () => {
  const candidateId = await seedPendingCandidate(WORKSPACE_A);
  const first = await asUser(SESSION_A, () => api.act(candidateId, "confirm"));
  assert.equal(first.status, 200);

  const secondConfirm = await asUser(SESSION_A, () => api.act(candidateId, "confirm"));
  assert.equal(secondConfirm.status, 409);
  const secondDismiss = await asUser(SESSION_A, () => api.act(candidateId, "dismiss"));
  assert.equal(secondDismiss.status, 409);

  assert.equal(rowsOf("threads").length, 1, "the already-promoted candidate must not be re-resolved");
});

test("method not allowed: GET/PUT/PATCH/DELETE on /api/motifs/[id], POST on /api/motifs", async () => {
  const candidateId = await seedPendingCandidate(WORKSPACE_A);
  for (const method of ["GET", "PUT", "PATCH", "DELETE"] as const) {
    const handler = routes.action[method];
    assert.ok(handler, `[id] route has no ${method} export`);
    const response: Response = await asUser(SESSION_A, () =>
      handler(req(`/api/motifs/${candidateId}`, method), withParams(candidateId)),
    );
    assert.equal(response.status, 405);
  }
  const postOnList: Response = await asUser(SESSION_A, () => routes.list.POST(req("/api/motifs", "POST")));
  assert.equal(postOnList.status, 405);
});

// ---------------------------------------------------------------------------
// 12. Hostile cross-tenant — acceptance criterion 5.
// ---------------------------------------------------------------------------

test("H1 confirm naming workspace B's candidate id, called as A, is refused (404) and promotes nothing", async () => {
  const candidateB = await seedPendingCandidate(WORKSPACE_B);
  const before = snapshotWorld();

  const response = await asUser(SESSION_A, () => api.act(candidateB, "confirm"));
  assert.equal(response.status, 404, "H1: A must not be able to confirm B's candidate by id");
  assert.deepEqual(world, before, "H1: a refused cross-tenant confirm must change nothing at all");
});

test("H2 dismiss naming workspace B's candidate id, called as A, is refused (404) and dismisses nothing", async () => {
  const candidateB = await seedPendingCandidate(WORKSPACE_B);
  const before = snapshotWorld();

  const response = await asUser(SESSION_A, () => api.act(candidateB, "dismiss"));
  assert.equal(response.status, 404, "H2: A must not be able to dismiss B's candidate by id");
  assert.deepEqual(world, before, "H2: a refused cross-tenant dismiss must change nothing at all");
});

test("H3 symmetric: B cannot confirm or dismiss A's candidate either", async () => {
  const candidateA = await seedPendingCandidate(WORKSPACE_A);
  assert.equal((await asUser(SESSION_B, () => api.act(candidateA, "confirm"))).status, 404);
  assert.equal((await asUser(SESSION_B, () => api.act(candidateA, "dismiss"))).status, 404);
});

// ---------------------------------------------------------------------------
// 13. Mutation proof 1 — acceptance criterion 6. Hardcoding
//     `learnerConfirmed` to `true` unconditionally must make a DISMISS
//     request fall into the promote branch instead.
// ---------------------------------------------------------------------------

test("MUTPROVE-1 hardcoding learnerConfirmed to true makes a dismiss request promote the candidate instead — dismiss/H2/409-reuse tests catch it", async () => {
  await withMutation(
    path.join("app", "api", "motifs", "[id]", "route.ts"),
    // The build pipeline (esbuild, via tsx) strips whitespace, so the
    // compiled source has no spaces around `===` — matched literally here
    // rather than loosely, the same discipline tests/v2-api.test.ts's M1
    // pattern uses for its own compiled shape.
    /const learnerConfirmed=parsed\.data\.action==="confirm";/,
    'const learnerConfirmed=true;',
    async () => {
      const candidateId = await seedPendingCandidate(WORKSPACE_A);

      const response = await asUser(SESSION_A, () => api.act(candidateId, "dismiss"));
      assert.equal(response.status, 200);
      const body = (await response.json()) as { data: { action: string } };

      // With the mutation live, a "dismiss" request must observably promote
      // instead — this is the actual bug the real guard prevents.
      assert.equal(
        rowsOf("threads").length,
        1,
        "MUTPROVE-1: with learnerConfirmed hardcoded true, a dismiss request must wrongly create a thread",
      );
      const candidateRow = rowsOf("motif_candidates").find((r) => r.id === candidateId)!;
      assert.equal(
        candidateRow.status,
        "promoted",
        "MUTPROVE-1: with learnerConfirmed hardcoded true, dismiss must wrongly promote the candidate",
      );
      assert.equal(
        body.data.action,
        "confirm",
        "MUTPROVE-1: the response itself must mislabel the dismiss as a confirm once the guard is gone",
      );
    },
  );
});

test("after MUTPROVE-1's cycle, a real dismiss request dismisses again (harness hygiene)", async () => {
  const candidateId = await seedPendingCandidate(WORKSPACE_A);
  const response = await asUser(SESSION_A, () => api.act(candidateId, "dismiss"));
  assert.equal(response.status, 200);
  assert.equal(rowsOf("threads").length, 0);
  assert.equal(rowsOf("motif_candidates").find((r) => r.id === candidateId)!.status, "dismissed");
});

// ---------------------------------------------------------------------------
// 14. Mutation proof 2 — the "already resolved" guard this route adds ahead
//     of dismissMotifCandidate.
//
//     NOTE on H1/H2 (criterion 5) and why they are NOT also formally
//     mutation-proved against this route's workspace predicate specifically:
//     tried first, and found to be structurally impossible to observe from
//     inside this task's owned paths alone. Defeating ONLY
//     `loadOwnedPendingCandidate`'s workspace check (self-comparison
//     tautology, same technique as MUTPROVE-1/tests/v2-api.test.ts's M1)
//     still produces a 404: `promoteMotifCandidate`/`dismissMotifCandidate`
//     (lib/db/radar.ts, readOnlyPath) independently re-select by
//     `workspaceId = <the caller's own real workspace> AND id =
//     <candidateId>` — B's candidate row simply never matches A's real
//     workspace id there either, throwing `MotifCandidateNotFoundError`,
//     which this route already maps to the same 404. H1/H2 are therefore
//     protected TWICE (this route's own check, plus radar.ts's own,
//     already independently mutation-proved by
//     tests/radar-persist.test.ts's "workspace scoping" test) — genuine
//     defense in depth, not a gap, but it means there is no code reachable
//     from this task's ownedPaths whose removal alone makes H1/H2 leak. Left
//     as directly-tested (not mutation-proved) rather than faking a
//     mutation with no real counterpart. Reported plainly rather than
//     silently claimed as proved.
//
//     WAVE 9 INTEGRATION REWRITE. This proof used to assert that
//     `dismissMotifCandidate` had NO status guard of its own, so defeating
//     this route's 409 check alone let a dismiss overwrite an
//     already-PROMOTED candidate. MOTIFSTATUS-001 then gave radar.ts exactly
//     that guard, which made the old assertion's premise false and turned it
//     red. MOTIFSTATUS-001 reported it rather than weakening its own fix to
//     keep this test green -- the right call, and this is the repair.
//
//     The proof is now STRONGER, not merely updated. A single mutation can no
//     longer demonstrate the hole, because two independent layers refuse it.
//     So it is split:
//
//       MUTPROVE-2a — defeat ONLY this route's guard. The dismiss must STILL
//         be refused, with the same 409, by radar.ts's backstop. This is what
//         proves the backstop is real rather than assumed, and it is the
//         actual production race: two dismisses (or a dismiss and a confirm)
//         arriving close enough together that both read a still-pending row.
//
//       MUTPROVE-2b — defeat BOTH guards at once. Only then does the dismiss
//         wrongly succeed. That is what proves NEITHER guard is decorative:
//         remove either one alone and the system still refuses; remove both
//         and the learner's promoted candidate is silently corrupted.
//
//     Together they say something the old single test could not: this is
//     genuine defense in depth, and we know it because we watched each layer
//     hold on its own.
//
//     NOTE on H1/H2 (criterion 5) and why they are NOT also formally
//     mutation-proved against this route's workspace predicate specifically:
//     tried first, and found to be structurally impossible to observe from
//     inside this task's owned paths alone. Defeating ONLY
//     `loadOwnedPendingCandidate`'s workspace check (self-comparison
//     tautology, same technique as MUTPROVE-1/tests/v2-api.test.ts's M1)
//     still produces a 404: `promoteMotifCandidate`/`dismissMotifCandidate`
//     independently re-select by `workspaceId = <the caller's own real
//     workspace> AND id = <candidateId>`, so B's candidate row never matches
//     A's real workspace id there either. Left as directly-tested rather
//     than faking a mutation with no real counterpart.
// ---------------------------------------------------------------------------

const ROUTE_GUARD_MUTATION = {
  relativeFile: path.join("app", "api", "motifs", "[id]", "route.ts"),
  pattern: /if\(candidate\.status!==import_radar\.MOTIF_CANDIDATE_PENDING_STATUS\)/,
  replacement: "if(false)",
};

const RADAR_GUARD_MUTATION = {
  relativeFile: path.join("lib", "db", "radar.ts"),
  pattern: /if\(current\.status!==MOTIF_CANDIDATE_PENDING_STATUS\)/,
  replacement: "if(false)",
};

test("MUTPROVE-2a defeating ONLY this route's already-resolved guard is not enough — radar.ts's own guard still refuses the dismiss with the same 409", async () => {
  await withMutations([ROUTE_GUARD_MUTATION], async () => {
    const candidateId = await seedPendingCandidate(WORKSPACE_A);
    const confirmResponse = await asUser(SESSION_A, () => api.act(candidateId, "confirm"));
    assert.equal(confirmResponse.status, 200, "the confirm itself must still succeed normally");
    assert.equal(rowsOf("threads").length, 1);

    const dismissResponse = await asUser(SESSION_A, () => api.act(candidateId, "dismiss"));
    assert.equal(
      dismissResponse.status,
      409,
      "MUTPROVE-2a: with this route's guard gone, radar.ts's backstop must still refuse — and as a 409, never a 500, because an ordinary lost race is not a server fault",
    );
    const body = (await dismissResponse.json()) as { error?: { code?: string } };
    assert.equal(
      body.error?.code,
      "MOTIF_CANDIDATE_ALREADY_RESOLVED",
      "a caller must not be able to tell WHICH of the two layers refused",
    );
    assert.equal(
      rowsOf("motif_candidates").find((r) => r.id === candidateId)!.status,
      "promoted",
      "the learner's promoted candidate must be untouched",
    );
  });
});

test("MUTPROVE-2b removing BOTH already-resolved guards lets a dismiss silently overwrite an already-promoted candidate", async () => {
  await withMutations([ROUTE_GUARD_MUTATION, RADAR_GUARD_MUTATION], async () => {
    const candidateId = await seedPendingCandidate(WORKSPACE_A);
    const confirmResponse = await asUser(SESSION_A, () => api.act(candidateId, "confirm"));
    assert.equal(confirmResponse.status, 200, "the confirm itself must still succeed normally");
    assert.equal(rowsOf("threads").length, 1);

    const dismissResponse = await asUser(SESSION_A, () => api.act(candidateId, "dismiss"));
    assert.equal(
      dismissResponse.status,
      200,
      "MUTPROVE-2b: with BOTH guards removed, a dismiss on a promoted candidate must wrongly succeed — that is what makes the two guards load-bearing rather than decorative",
    );
    assert.equal(
      rowsOf("motif_candidates").find((r) => r.id === candidateId)!.status,
      "dismissed",
      "MUTPROVE-2b: both guards gone must let dismiss overwrite the promoted candidate's status",
    );
    assert.equal(
      rowsOf("threads").length,
      1,
      "the earlier promotion's thread is untouched by this — the bug is a misleading candidate.status, not a deleted thread",
    );
  });
});

test("after MUTPROVE-2's cycle, dismissing an already-promoted candidate is refused again (409, harness hygiene)", async () => {
  const candidateId = await seedPendingCandidate(WORKSPACE_A);
  await asUser(SESSION_A, () => api.act(candidateId, "confirm"));

  const dismissResponse = await asUser(SESSION_A, () => api.act(candidateId, "dismiss"));
  assert.equal(dismissResponse.status, 409);
  assert.equal(rowsOf("motif_candidates").find((r) => r.id === candidateId)!.status, "promoted");
});
