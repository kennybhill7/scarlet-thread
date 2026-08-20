/**
 * V2API-001 — hostile two-account proof for the v2 read-only resource
 * routes (`app/api/v2/**`), in the style of `tests/tenant-isolation.test.ts`
 * and `tests/sync-v2-persist.test.ts`: the real route handlers and the real
 * drizzle query builders in `app/api/v2/_lib/queries.ts` run against a
 * small in-memory "PocketPg-lite" store, compiled through the genuine
 * `PgDialect` — nothing under `app/` or `lib/` is hand-reimplemented. The
 * only two seams replaced in `require.cache` are the identity boundary
 * (`@/lib/auth/config`) and the database client (`@/lib/db`), exactly as
 * `tenant-isolation.test.ts`'s header explains for the same reason: that is
 * what makes the mutation proof (criterion 6) below meaningful rather than
 * decorative — deleting a `workspaceId` predicate from
 * `app/api/v2/_lib/queries.ts` changes what this harness sees, byte for
 * byte, because the WHERE clause it evaluates is the real compiled SQL text.
 *
 * `lib/db/workspaces.ts` (a readOnlyPath for this task) is NOT stubbed —
 * `getOrCreatePersonalWorkspace` runs for real against the fake `@/lib/db`
 * below. Every test seeds exactly one pre-existing personal workspace per
 * user, so that function's `findPersonalWorkspaceId` select always finds a
 * row and returns before ever reaching its `db.execute(sql...)` insert path
 * — this harness only implements `select()`, not `execute()`, by design;
 * see the stub's own comment.
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

/* eslint-disable @typescript-eslint/no-explicit-any --
 * Route modules and drizzle builders are loaded dynamically and reloaded
 * after the mutation cycle, so their shapes cannot be named statically here
 * — same rationale as tenant-isolation.test.ts and sync-v2-persist.test.ts. */

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
// 1. Schema registry — only the tables the v2 read routes actually touch.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Predicate = { sql: string; params: unknown[] };

const clone = <T>(value: T): T => structuredClone(value);

type TableMeta = {
  table: Table;
  sqlName: string;
  columns: Record<string, Column>;
  propByColumn: Map<string, string>;
};

const MODELLED_TABLES: Table[] = [
  schema.workspaces,
  schema.studySessions,
  schema.studyClaims,
  schema.claimEvidence,
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
  const meta: TableMeta = { table, sqlName, columns, propByColumn };
  metaByTable.set(table, meta);
  metaBySqlName.set(sqlName, meta);
}

function metaOf(table: Table): TableMeta {
  const meta = metaByTable.get(table);
  if (!meta) throw new Error(`PocketPg-lite (v2-api) does not model table "${getTableName(table)}"`);
  return meta;
}

// ---------------------------------------------------------------------------
// 2. WHERE evaluator — single-table only, supporting exactly what
//    `app/api/v2/_lib/queries.ts` and `lib/db/workspaces.ts` emit:
//    `=`, `is null`, `and`. Verbatim copy of the evaluator
//    `tests/sync-v2-persist.test.ts` established (same reasoning: real
//    compiled SQL text, not a re-guessed grammar).
// ---------------------------------------------------------------------------

function evaluatePredicate(predicate: Predicate, row: Row, sqlName: string): boolean {
  const { sql, params } = predicate;
  let pos = 0;
  const fail = (reason: string): never => {
    throw new Error(`PocketPg-lite (v2-api) cannot evaluate SQL (${reason}) at offset ${pos} of: ${sql}`);
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
// 3. PocketPg-lite — select().from().where().orderBy().limit() only. No
//    insert/update/delete/execute: every route this task owns is GET-only,
//    so the production code under test never issues a write. `execute`
//    exists solely to fail loudly if that assumption is ever wrong.
// ---------------------------------------------------------------------------

const dialect = new PgDialect();
const world = new Map<string, Row[]>();

function resetWorld() {
  world.clear();
  for (const table of MODELLED_TABLES) world.set(getTableName(table), []);
}

const rowsOf = (sqlName: string): Row[] => {
  const rows = world.get(sqlName);
  if (!rows) throw new Error(`PocketPg-lite (v2-api) has no table "${sqlName}"`);
  return rows;
};

function compile(condition: SQL | undefined): Predicate | null {
  if (!condition) return null;
  const query = dialect.sqlToQuery(condition);
  return { sql: query.sql, params: query.params as unknown[] };
}

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
      // Only ever one workspace row per user in these fixtures — ordering
      // is a no-op for this harness's purposes (see lib/db/workspaces.ts's
      // findPersonalWorkspaceId, the one production caller that orders).
      return builder;
    },
    limit(count: number) {
      limitCount = count;
      return builder;
    },
    then: (resolve: any, reject: any) =>
      Promise.resolve()
        .then(() => {
          if (!from) throw new Error("PocketPg-lite (v2-api) received a select without from()");
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
                throw new Error(`PocketPg-lite (v2-api) does not model select field "${key}" of this shape`);
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

const pocketPg = {
  select: (fields?: Record<string, unknown>) => makeSelect(fields ?? null),
  execute: () => {
    throw new Error(
      "PocketPg-lite (v2-api) does not implement db.execute() — every fixture must seed a " +
        "pre-existing personal workspace so lib/db/workspaces.ts never falls through to its " +
        "insert path. If this fires, a test is missing seedWorkspace() for a user id.",
    );
  },
};

const DB_PATH = seedModule("@/lib/db", { db: pocketPg });

// ---------------------------------------------------------------------------
// 4. Identity seam
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

// ---------------------------------------------------------------------------
// 5. Network trap — nothing in this suite may open a socket.
// ---------------------------------------------------------------------------

const blocked = (label: string) => {
  throw new Error(`Network access blocked in v2-api test: ${label}`);
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
// 6. Compile recorder / mutator — criterion 6 (mutation-prove the tenant
//    predicate). Rewrites `eq(<table>.workspaceId, workspaceId)` into
//    `eq(<table>.workspaceId, <table>.workspaceId)` in the *transpiled*
//    source of app/api/v2/_lib/queries.ts, in memory, while it is required.
//    A self-comparison against a NOT NULL column is always true, so the
//    result is a well-formed tautology: the statement stays valid but the
//    workspace scope is gone. Identical technique to
//    tenant-isolation.test.ts's MUTATION_PATTERN, generalized from
//    `.userId` to `.workspaceId`.
// ---------------------------------------------------------------------------

const MUTATION_PATTERN =
  /\.eq\)\(([A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)*)\.workspaceId\s*,\s*workspaceId\)/g;

let mutating: { file: string; hits: number } | null = null;

const originalCompile = (Module as any).prototype._compile;
(Module as any).prototype._compile = function patchedCompile(
  content: string,
  filename: string,
  ...rest: unknown[]
) {
  const resolved = path.resolve(filename);
  let source = content;
  if (mutating && resolved === mutating.file) {
    const hits = source.match(MUTATION_PATTERN)?.length ?? 0;
    mutating.hits += hits;
    source = source.replace(
      MUTATION_PATTERN,
      (_match, table: string) => `.eq)(${table}.workspaceId,${table}.workspaceId)`,
    );
  }
  return originalCompile.call(this, source, filename, ...rest);
};

const SEEDED_PATHS = new Set([SERVER_ONLY_PATH, DB_PATH, AUTH_PATH]);
const APP_DIR = path.join(WEB_ROOT, "app") + path.sep;

function purgeApplicationModules() {
  for (const key of Object.keys(nodeRequire.cache)) {
    if (SEEDED_PATHS.has(key)) continue;
    const resolved = path.resolve(key);
    if (resolved.startsWith(APP_DIR)) {
      delete (nodeRequire.cache as any)[key];
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Route loading and the request surface
// ---------------------------------------------------------------------------

type RouteModule = Record<string, (...args: any[]) => Promise<Response>>;

type Routes = {
  sessions: RouteModule;
  sessionId: RouteModule;
  claims: RouteModule;
  claimId: RouteModule;
  claimEvidence: RouteModule;
};

function loadRoutes(): Routes {
  return {
    sessions: nodeRequire("@/app/api/v2/sessions/route.ts"),
    sessionId: nodeRequire("@/app/api/v2/sessions/[id]/route.ts"),
    claims: nodeRequire("@/app/api/v2/claims/route.ts"),
    claimId: nodeRequire("@/app/api/v2/claims/[id]/route.ts"),
    claimEvidence: nodeRequire("@/app/api/v2/claims/[id]/evidence/route.ts"),
  };
}

let routes = loadRoutes();

const req = (url: string, method = "GET") => new Request(`http://v2.test${url}`, { method });
const withParams = (id: string) => ({ params: Promise.resolve({ id }) });

const api = {
  listSessions: (query = "") => routes.sessions.GET(req(`/api/v2/sessions${query}`)),
  getSession: (id: string) => routes.sessionId.GET(req(`/api/v2/sessions/${id}`), withParams(id)),
  listClaims: (query = "") => routes.claims.GET(req(`/api/v2/claims${query}`)),
  getClaim: (id: string) => routes.claimId.GET(req(`/api/v2/claims/${id}`), withParams(id)),
  listClaimEvidence: (id: string) =>
    routes.claimEvidence.GET(req(`/api/v2/claims/${id}/evidence`), withParams(id)),
};

// ---------------------------------------------------------------------------
// 8. Fixtures
// ---------------------------------------------------------------------------

const TS = "2026-01-01T00:00:00Z";
const VERSIFICATION_ID = "eng-protestant-66-31102-v1";

function range(start: string, end: string) {
  return { versificationId: VERSIFICATION_ID, start, end };
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

function seedSession(overrides: Row = {}) {
  const row = {
    id: "session-x",
    workspaceId: WORKSPACE_A,
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
  rowsOf("study_sessions").push(row);
  return row;
}

function seedClaim(overrides: Row = {}) {
  const row = {
    id: "claim-x",
    workspaceId: WORKSPACE_A,
    sessionId: "session-x",
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
  rowsOf("study_claims").push(row);
  return row;
}

function seedEvidence(overrides: Row = {}) {
  const row = {
    id: "evidence-x",
    workspaceId: WORKSPACE_A,
    claimId: "claim-x",
    evidenceType: "passage",
    canonicalReference: null,
    displayReference: null,
    contentBlockId: null,
    citationId: null,
    connectionId: null,
    note: "Genesis 3:15 names the seed.",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
  rowsOf("claim_evidence").push(row);
  return row;
}

/** The full two-account fixture every hostile test in section 9 shares. */
function seedTwoAccounts() {
  seedWorkspace(WORKSPACE_A, USER_A);
  seedWorkspace(WORKSPACE_B, USER_B);

  seedSession({ id: "session-a1", workspaceId: WORKSPACE_A });
  seedSession({ id: "session-b1", workspaceId: WORKSPACE_B });

  seedClaim({ id: "claim-a1", workspaceId: WORKSPACE_A, sessionId: "session-a1" });
  seedClaim({ id: "claim-b1", workspaceId: WORKSPACE_B, sessionId: "session-b1" });

  seedEvidence({ id: "evidence-a1", workspaceId: WORKSPACE_A, claimId: "claim-a1" });
  seedEvidence({ id: "evidence-b1", workspaceId: WORKSPACE_B, claimId: "claim-b1" });
}

test.beforeEach(() => {
  resetWorld();
  currentSession = null;
});

// ---------------------------------------------------------------------------
// 9. Hostile cross-tenant reads — account A against account B's rows.
// ---------------------------------------------------------------------------

test("R1 listSessions as A never includes B's session", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.listSessions());
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: Array<{ id: string }> };
  const ids = body.data.map((row) => row.id);
  assert.deepEqual(ids, ["session-a1"]);
  assert.ok(!ids.includes("session-b1"), "R1: B's session leaked into A's session list");
});

test("R2 getSession as A on B's session id resolves 404, not B's data", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.getSession("session-b1"));
  assert.equal(response.status, 404, "R2: A must not be able to fetch B's session by id");
});

test("R3 listClaims as A never includes B's claim", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.listClaims());
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: Array<{ id: string }> };
  const ids = body.data.map((row) => row.id);
  assert.deepEqual(ids, ["claim-a1"]);
  assert.ok(!ids.includes("claim-b1"), "R3: B's claim leaked into A's claim list");
});

test("R4 listClaims?sessionId=<B's session> as A returns empty, not B's claim", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.listClaims("?sessionId=session-b1"));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: unknown[] };
  assert.deepEqual(body.data, [], "R4: filtering by another workspace's sessionId must not smuggle its claims");
});

test("R5 getClaim as A on B's claim id resolves 404, not B's data", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.getClaim("claim-b1"));
  assert.equal(response.status, 404, "R5: A must not be able to fetch B's claim by id");
});

test("R6 listClaimEvidence as A on B's claim id resolves 404, never revealing B's evidence", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.listClaimEvidence("claim-b1"));
  assert.equal(response.status, 404, "R6: A must not be able to list evidence under B's claim id");
});

test("R7 listClaimEvidence as A on A's own claim returns only A's evidence", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.listClaimEvidence("claim-a1"));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: Array<{ id: string }> };
  assert.deepEqual(
    body.data.map((row) => row.id),
    ["evidence-a1"],
  );
});

test("R8 a caller-supplied workspaceId query parameter is silently ignored, not honored", async () => {
  seedTwoAccounts();
  // A tries to smuggle B's workspace id in as a query param that no route
  // ever reads — the response must be A's own data, unaffected.
  const response = await asUser(SESSION_A, () =>
    api.listSessions(`?workspaceId=${WORKSPACE_B}`),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: Array<{ id: string }> };
  assert.deepEqual(body.data.map((row) => row.id), ["session-a1"]);
});

test("symmetric: B cannot read A's rows either (getClaim, getSession, evidence)", async () => {
  seedTwoAccounts();
  assert.equal((await asUser(SESSION_B, () => api.getSession("session-a1"))).status, 404);
  assert.equal((await asUser(SESSION_B, () => api.getClaim("claim-a1"))).status, 404);
  assert.equal((await asUser(SESSION_B, () => api.listClaimEvidence("claim-a1"))).status, 404);
});

// ---------------------------------------------------------------------------
// 10. Auth and cache-policy shape
// ---------------------------------------------------------------------------

test("every v2 route requires an authenticated session (401, no data)", async () => {
  seedTwoAccounts();
  currentSession = null;
  assert.equal((await api.listSessions()).status, 401);
  assert.equal((await api.getSession("session-a1")).status, 401);
  assert.equal((await api.listClaims()).status, 401);
  assert.equal((await api.getClaim("claim-a1")).status, 401);
  assert.equal((await api.listClaimEvidence("claim-a1")).status, 401);
});

test("responses carry the private/no-store cache policy from lib/api/response.ts", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.listSessions());
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

// ---------------------------------------------------------------------------
// 11. Criterion 3 — every non-GET verb is refused via the SYNCV2-001
//     predicate (`assertReadOnlyV2ResourceRequest` /
//     `V2ResourceRouteMutationRejected`), the SAME implementation imported
//     from `lib/api/sync-v2.ts` rather than a second hand-rolled check.
// ---------------------------------------------------------------------------

const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

test("every non-GET verb on every v2 route is rejected via V2ResourceRouteMutationRejected", async () => {
  seedTwoAccounts();
  const targets: Array<{ name: string; route: () => RouteModule; url: string }> = [
    { name: "sessions", route: () => routes.sessions, url: "/api/v2/sessions" },
    { name: "sessions/[id]", route: () => routes.sessionId, url: "/api/v2/sessions/session-a1" },
    { name: "claims", route: () => routes.claims, url: "/api/v2/claims" },
    { name: "claims/[id]", route: () => routes.claimId, url: "/api/v2/claims/claim-a1" },
    {
      name: "claims/[id]/evidence",
      route: () => routes.claimEvidence,
      url: "/api/v2/claims/claim-a1/evidence",
    },
  ];

  for (const target of targets) {
    for (const method of MUTATING_METHODS) {
      const handler = target.route()[method];
      assert.ok(handler, `${target.name} has no ${method} export to reject with`);
      // Authenticated, to prove the rejection is the read-only predicate
      // itself, not merely an auth failure that happens to also be 4xx.
      const response: Response = await asUser<Response>(SESSION_A, () =>
        handler(req(target.url, method)),
      );
      assert.equal(
        response.status,
        405,
        `${target.name} ${method} must be rejected (405), not silently accepted`,
      );
      const body = (await response.json()) as { error: { code: string; message: string } };
      assert.equal(body.error.code, "METHOD_NOT_ALLOWED");
      assert.match(
        body.error.message,
        /v2 resource routes are read-only.*must go through sync push instead/,
        `${target.name} ${method}'s rejection message must come from V2ResourceRouteMutationRejected`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 12. Criterion 6 — mutation-prove the tenant predicate.
//     No file is written; the on-disk hash and mtime are re-verified after
//     the cycle, same discipline as tenant-isolation.test.ts's withMutation.
// ---------------------------------------------------------------------------

async function withMutation(relativeFile: string, body: () => Promise<void>) {
  const file = path.join(WEB_ROOT, relativeFile);
  const beforeHash = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const beforeMtime = fs.statSync(file).mtimeMs;

  mutating = { file, hits: 0 };
  purgeApplicationModules();
  routes = loadRoutes();

  try {
    assert.ok(
      mutating.hits > 0,
      `mutation matched nothing in ${relativeFile} — the compiled shape changed; update MUTATION_PATTERN`,
    );
    await body();
  } finally {
    mutating = null;
    purgeApplicationModules();
    routes = loadRoutes();
    const afterHash = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    assert.equal(afterHash, beforeHash, `${relativeFile} was modified on disk`);
    assert.equal(fs.statSync(file).mtimeMs, beforeMtime, `${relativeFile} mtime changed`);
  }
}

test("M1 removing the workspaceId predicate from app/api/v2/_lib/queries.ts breaks R1/R2/R3/R5/R6", async () => {
  seedTwoAccounts();

  await withMutation(path.join("app", "api", "v2", "_lib", "queries.ts"), async () => {
    // R1 (list leak): A's session list now includes B's session too.
    const sessionsResponse = await asUser(SESSION_A, () => api.listSessions());
    assert.equal(sessionsResponse.status, 200);
    const sessionsBody = (await sessionsResponse.json()) as { data: Array<{ id: string }> };
    const sessionIds = sessionsBody.data.map((row) => row.id);
    assert.ok(
      sessionIds.includes("session-b1"),
      "R1 must now leak session-b1 with the workspace predicate removed — mutation did not defeat the check",
    );

    // R2 (get-by-id leak): A can now fetch B's session directly.
    const getSessionResponse = await asUser(SESSION_A, () => api.getSession("session-b1"));
    assert.equal(
      getSessionResponse.status,
      200,
      "R2 must now return 200 for B's session with the workspace predicate removed",
    );

    // R3 (list leak): A's claim list now includes B's claim too.
    const claimsResponse = await asUser(SESSION_A, () => api.listClaims());
    const claimsBody = (await claimsResponse.json()) as { data: Array<{ id: string }> };
    assert.ok(
      claimsBody.data.map((row) => row.id).includes("claim-b1"),
      "R3 must now leak claim-b1 with the workspace predicate removed",
    );

    // R5 (get-by-id leak): A can now fetch B's claim directly.
    const getClaimResponse = await asUser(SESSION_A, () => api.getClaim("claim-b1"));
    assert.equal(
      getClaimResponse.status,
      200,
      "R5 must now return 200 for B's claim with the workspace predicate removed",
    );

    // R6 (nested-resource leak): A can now list evidence under B's claim id.
    const evidenceResponse = await asUser(SESSION_A, () => api.listClaimEvidence("claim-b1"));
    assert.equal(
      evidenceResponse.status,
      200,
      "R6 must now return 200 for evidence under B's claim id with the workspace predicate removed",
    );
    const evidenceBody = (await evidenceResponse.json()) as { data: Array<{ id: string }> };
    assert.ok(
      evidenceBody.data.map((row) => row.id).includes("evidence-b1"),
      "R6 must now leak evidence-b1 with the workspace predicate removed",
    );
  });
});

test("after the mutation cycle, R1/R2/R3/R5/R6 all pass again (harness hygiene)", async () => {
  seedTwoAccounts();
  assert.deepEqual(
    (
      (await (await asUser(SESSION_A, () => api.listSessions())).json()) as {
        data: Array<{ id: string }>;
      }
    ).data.map((row) => row.id),
    ["session-a1"],
  );
  assert.equal((await asUser(SESSION_A, () => api.getSession("session-b1"))).status, 404);
  assert.equal((await asUser(SESSION_A, () => api.getClaim("claim-b1"))).status, 404);
  assert.equal((await asUser(SESSION_A, () => api.listClaimEvidence("claim-b1"))).status, 404);
});
