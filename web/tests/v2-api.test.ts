/**
 * V2API-001/V2API-002 — hostile two-account proof for the v2 read-only
 * resource routes (`app/api/v2/**`), in the style of
 * `tests/tenant-isolation.test.ts` and `tests/sync-v2-persist.test.ts`: the
 * real route handlers and the real drizzle query builders in
 * `app/api/v2/_lib/queries.ts` run against a small in-memory "PocketPg-lite"
 * store, compiled through the genuine `PgDialect` — nothing under `app/` or
 * `lib/` is hand-reimplemented. The only two seams replaced in
 * `require.cache` are the identity boundary (`@/lib/auth/config`) and the
 * database client (`@/lib/db`), exactly as `tenant-isolation.test.ts`'s
 * header explains for the same reason: that is what makes the mutation
 * proof (criterion 5 of V2API-002 / criterion 6 of V2API-001) below
 * meaningful rather than decorative — deleting a `workspaceId` predicate
 * from `app/api/v2/_lib/queries.ts` changes what this harness sees, byte
 * for byte, because the WHERE clause it evaluates is the real compiled SQL
 * text.
 *
 * `lib/db/workspaces.ts` (a readOnlyPath for this task) is NOT stubbed —
 * `getOrCreatePersonalWorkspace` runs for real against the fake `@/lib/db`
 * below. Every test seeds exactly one pre-existing personal workspace per
 * user, so that function's `findPersonalWorkspaceId` select always finds a
 * row and returns before ever reaching its `db.execute(sql...)` insert path
 * — this harness only implements `select()`, not `execute()`, by design;
 * see the stub's own comment.
 *
 * V2API-002 adds, on top of V2API-001's sessions/claims/evidence coverage:
 *   - read routes for the five remaining v2 entities (motif candidates and
 *     their sightings, connections, applications, teaching drafts);
 *   - a soft-delete filter (`deletedAt`) on every list/get query, following
 *     `lib/db/entries.ts`'s `includeDeleted` convention (section 13 below —
 *     this is the gap that mattered most: a learner who deletes a claim
 *     must stop seeing it in a v2 list response);
 *   - a bounded `?limit=` on every list route (section 14 below);
 *   - the ORDER BY support PocketPg-lite needed to make the pagination
 *     tests test real `desc(createdAt)` behavior rather than an accident of
 *     fixture insertion order (section 3).
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
// 1. Schema registry — every table the v2 read routes touch, including
//    V2API-002's five new entities.
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
  schema.motifCandidates,
  schema.motifSightings,
  schema.userConnections,
  schema.applications,
  schema.teachingDrafts,
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
// 2b. ORDER BY evaluator — V2API-002 addition. `_lib/queries.ts` now sorts
//     every list query `desc(<table>.createdAt)` (and `lib/db/workspaces.ts`
//     already sorted `asc(createdAt), asc(id)`) so that a bounded `?limit=`
//     truncates the OLDEST rows, not an arbitrary subset. Real sorting here
//     (rather than the no-op the original harness used, back when nothing
//     under test ever called `.orderBy()` meaningfully) is what makes the
//     pagination tests in section 14 test production behavior instead of an
//     accident of fixture insertion order.
// ---------------------------------------------------------------------------

type OrderSpec = { prop: string; direction: "asc" | "desc" };

function compileOrderBy(clause: SQL, meta: TableMeta): OrderSpec {
  const query = dialect.sqlToQuery(clause);
  const match = /^"([a-z0-9_]+)"\."([a-z0-9_]+)" (asc|desc)$/.exec(query.sql);
  if (!match) {
    throw new Error(`PocketPg-lite (v2-api) cannot evaluate ORDER BY: ${query.sql}`);
  }
  const [, tableName, columnName, direction] = match;
  if (tableName !== meta.sqlName) {
    throw new Error(`PocketPg-lite (v2-api): unexpected table "${tableName}" in ORDER BY on "${meta.sqlName}"`);
  }
  const prop = meta.propByColumn.get(columnName);
  if (!prop) throw new Error(`PocketPg-lite (v2-api): unknown ORDER BY column "${tableName}"."${columnName}"`);
  return { prop, direction: direction as "asc" | "desc" };
}

function compareOrderable(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
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
  let orderSpecs: OrderSpec[] = [];
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
    orderBy(...clauses: SQL[]) {
      if (!from) throw new Error("PocketPg-lite (v2-api) received orderBy() before from()");
      orderSpecs = clauses.map((clause) => compileOrderBy(clause, from as TableMeta));
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
          if (orderSpecs.length > 0) {
            const specs = orderSpecs;
            rows = [...rows].sort((a, b) => {
              for (const spec of specs) {
                const cmp = compareOrderable(a[spec.prop], b[spec.prop]);
                if (cmp !== 0) return spec.direction === "desc" ? -cmp : cmp;
              }
              return 0;
            });
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
// 6. Compile recorder / mutator — mutation-prove the tenant predicate.
//    Rewrites `eq(<table>.workspaceId, workspaceId)` into
//    `eq(<table>.workspaceId, <table>.workspaceId)` in the *transpiled*
//    source of app/api/v2/_lib/queries.ts, in memory, while it is required.
//    A self-comparison against a NOT NULL column is always true, so the
//    result is a well-formed tautology: the statement stays valid but the
//    workspace scope is gone. Identical technique to
//    tenant-isolation.test.ts's MUTATION_PATTERN, generalized from
//    `.userId` to `.workspaceId`. Because this rewrites the WHOLE file's
//    compiled source and every V2API-002 query function (new entities
//    included) uses the identical `eq(<table>.workspaceId, workspaceId)`
//    call shape, the mutation defeats the new queries' tenant scoping too
//    without any change to this pattern — see section 12's M1 test, which
//    now asserts that.
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
  motifs: RouteModule;
  motifId: RouteModule;
  motifSightings: RouteModule;
  connections: RouteModule;
  connectionId: RouteModule;
  applications: RouteModule;
  applicationId: RouteModule;
  teachingDrafts: RouteModule;
  teachingDraftId: RouteModule;
};

function loadRoutes(): Routes {
  return {
    sessions: nodeRequire("@/app/api/v2/sessions/route.ts"),
    sessionId: nodeRequire("@/app/api/v2/sessions/[id]/route.ts"),
    claims: nodeRequire("@/app/api/v2/claims/route.ts"),
    claimId: nodeRequire("@/app/api/v2/claims/[id]/route.ts"),
    claimEvidence: nodeRequire("@/app/api/v2/claims/[id]/evidence/route.ts"),
    motifs: nodeRequire("@/app/api/v2/motifs/route.ts"),
    motifId: nodeRequire("@/app/api/v2/motifs/[id]/route.ts"),
    motifSightings: nodeRequire("@/app/api/v2/motifs/[id]/sightings/route.ts"),
    connections: nodeRequire("@/app/api/v2/connections/route.ts"),
    connectionId: nodeRequire("@/app/api/v2/connections/[id]/route.ts"),
    applications: nodeRequire("@/app/api/v2/applications/route.ts"),
    applicationId: nodeRequire("@/app/api/v2/applications/[id]/route.ts"),
    teachingDrafts: nodeRequire("@/app/api/v2/teaching-drafts/route.ts"),
    teachingDraftId: nodeRequire("@/app/api/v2/teaching-drafts/[id]/route.ts"),
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
  listClaimEvidence: (id: string, query = "") =>
    routes.claimEvidence.GET(req(`/api/v2/claims/${id}/evidence${query}`), withParams(id)),
  listMotifs: (query = "") => routes.motifs.GET(req(`/api/v2/motifs${query}`)),
  getMotif: (id: string) => routes.motifId.GET(req(`/api/v2/motifs/${id}`), withParams(id)),
  listMotifSightings: (id: string, query = "") =>
    routes.motifSightings.GET(req(`/api/v2/motifs/${id}/sightings${query}`), withParams(id)),
  listConnections: (query = "") => routes.connections.GET(req(`/api/v2/connections${query}`)),
  getConnection: (id: string) =>
    routes.connectionId.GET(req(`/api/v2/connections/${id}`), withParams(id)),
  listApplications: (query = "") => routes.applications.GET(req(`/api/v2/applications${query}`)),
  getApplication: (id: string) =>
    routes.applicationId.GET(req(`/api/v2/applications/${id}`), withParams(id)),
  listTeachingDrafts: (query = "") => routes.teachingDrafts.GET(req(`/api/v2/teaching-drafts${query}`)),
  getTeachingDraft: (id: string) =>
    routes.teachingDraftId.GET(req(`/api/v2/teaching-drafts/${id}`), withParams(id)),
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

function seedMotifCandidate(overrides: Row = {}) {
  const row = {
    id: "motif-x",
    workspaceId: WORKSPACE_A,
    label: "Seed and offspring",
    normalizedKey: "seed-and-offspring",
    status: "candidate",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
  rowsOf("motif_candidates").push(row);
  return row;
}

function seedMotifSighting(overrides: Row = {}) {
  const row = {
    id: "sighting-x",
    workspaceId: WORKSPACE_A,
    candidateId: "motif-x",
    passageUnitKey: "gen.3.15",
    exactRange: range("1.3.15", "1.3.15"),
    entryId: null,
    claimId: null,
    status: "candidate",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
  rowsOf("motif_sightings").push(row);
  return row;
}

function seedConnection(overrides: Row = {}) {
  const row = {
    id: "connection-x",
    workspaceId: WORKSPACE_A,
    fromRange: range("1.3.15", "1.3.15"),
    toRange: range("43.1.29", "43.1.29"),
    type: "type_antitype",
    evidenceLabel: "explicit",
    rationale: "The seed of the woman anticipates the Lamb of God who takes away sin.",
    threadSlug: null,
    status: "draft",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
  rowsOf("user_connections").push(row);
  return row;
}

function seedApplication(overrides: Row = {}) {
  const row = {
    id: "application-x",
    workspaceId: WORKSPACE_A,
    sessionId: "session-x",
    sourceClaimId: "claim-x",
    originalAudienceMeaning: "The first hearers heard a promise of ultimate victory over the serpent.",
    enduringPrinciple: "God defeats evil through a chosen offspring.",
    canonicalBridge: "The pattern culminates in Christ's victory at the cross.",
    applicationClass: "hope",
    promiseScope: "corporate",
    modernDomain: "work",
    situation: "Facing opposition that feels overwhelming.",
    responseType: "belief",
    faithfulResponse: "Trust God's promised victory rather than despair.",
    cautions: "Avoid claiming a specific timeline the text does not give.",
    availableAfter: null,
    status: "draft",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
  rowsOf("applications").push(row);
  return row;
}

function seedTeachingDraft(overrides: Row = {}) {
  const row = {
    id: "draft-x",
    workspaceId: WORKSPACE_A,
    sessionId: "session-x",
    title: "The Protoevangelium",
    bigIdea: "God promises victory over evil through a coming offspring.",
    audience: "Adult small group",
    durationMinutes: 15,
    gospelConnection: "Fulfilled in Christ's triumph over sin and death.",
    status: "draft",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
  rowsOf("teaching_drafts").push(row);
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

  seedMotifCandidate({ id: "motif-a1", workspaceId: WORKSPACE_A });
  seedMotifCandidate({ id: "motif-b1", workspaceId: WORKSPACE_B });

  seedMotifSighting({ id: "sighting-a1", workspaceId: WORKSPACE_A, candidateId: "motif-a1" });
  seedMotifSighting({ id: "sighting-b1", workspaceId: WORKSPACE_B, candidateId: "motif-b1" });

  seedConnection({ id: "connection-a1", workspaceId: WORKSPACE_A });
  seedConnection({ id: "connection-b1", workspaceId: WORKSPACE_B });

  seedApplication({
    id: "application-a1",
    workspaceId: WORKSPACE_A,
    sessionId: "session-a1",
    sourceClaimId: "claim-a1",
  });
  seedApplication({
    id: "application-b1",
    workspaceId: WORKSPACE_B,
    sessionId: "session-b1",
    sourceClaimId: "claim-b1",
  });

  seedTeachingDraft({ id: "draft-a1", workspaceId: WORKSPACE_A, sessionId: "session-a1" });
  seedTeachingDraft({ id: "draft-b1", workspaceId: WORKSPACE_B, sessionId: "session-b1" });
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

// ---------------------------------------------------------------------------
// 9b. V2API-002 — the same hostile treatment applied to the five new
//     entities. Numbering continues R9+ so every hostile test in this file
//     stays uniquely addressable.
// ---------------------------------------------------------------------------

test("R9 listMotifs as A never includes B's motif candidate", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.listMotifs());
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: Array<{ id: string }> };
  const ids = body.data.map((row) => row.id);
  assert.deepEqual(ids, ["motif-a1"]);
  assert.ok(!ids.includes("motif-b1"), "R9: B's motif candidate leaked into A's list");
});

test("R10 getMotif as A on B's candidate id resolves 404, not B's data", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.getMotif("motif-b1"));
  assert.equal(response.status, 404, "R10: A must not be able to fetch B's motif candidate by id");
});

test("R11 listMotifSightings as A on B's candidate id resolves 404, never revealing B's sightings", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.listMotifSightings("motif-b1"));
  assert.equal(response.status, 404, "R11: A must not be able to list sightings under B's candidate id");
});

test("R12 listMotifSightings as A on A's own candidate returns only A's sightings", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.listMotifSightings("motif-a1"));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: Array<{ id: string }> };
  assert.deepEqual(
    body.data.map((row) => row.id),
    ["sighting-a1"],
  );
});

test("R13 listConnections as A never includes B's connection", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.listConnections());
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: Array<{ id: string }> };
  const ids = body.data.map((row) => row.id);
  assert.deepEqual(ids, ["connection-a1"]);
  assert.ok(!ids.includes("connection-b1"), "R13: B's connection leaked into A's list");
});

test("R14 getConnection as A on B's connection id resolves 404, not B's data", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.getConnection("connection-b1"));
  assert.equal(response.status, 404, "R14: A must not be able to fetch B's connection by id");
});

test("R15 listApplications as A never includes B's application", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.listApplications());
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: Array<{ id: string }> };
  const ids = body.data.map((row) => row.id);
  assert.deepEqual(ids, ["application-a1"]);
  assert.ok(!ids.includes("application-b1"), "R15: B's application leaked into A's list");
});

test("R16 getApplication as A on B's application id resolves 404, not B's data", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.getApplication("application-b1"));
  assert.equal(response.status, 404, "R16: A must not be able to fetch B's application by id");
});

test("R17 listTeachingDrafts as A never includes B's teaching draft", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.listTeachingDrafts());
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: Array<{ id: string }> };
  const ids = body.data.map((row) => row.id);
  assert.deepEqual(ids, ["draft-a1"]);
  assert.ok(!ids.includes("draft-b1"), "R17: B's teaching draft leaked into A's list");
});

test("R18 getTeachingDraft as A on B's draft id resolves 404, not B's data", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.getTeachingDraft("draft-b1"));
  assert.equal(response.status, 404, "R18: A must not be able to fetch B's teaching draft by id");
});

test("R19 listApplications?sessionId=<B's session> as A returns empty, not B's application", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.listApplications("?sessionId=session-b1"));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: unknown[] };
  assert.deepEqual(
    body.data,
    [],
    "R19: filtering applications by another workspace's sessionId must not smuggle its application",
  );
});

test("R20 listTeachingDrafts?sessionId=<B's session> as A returns empty, not B's draft", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.listTeachingDrafts("?sessionId=session-b1"));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: unknown[] };
  assert.deepEqual(
    body.data,
    [],
    "R20: filtering teaching drafts by another workspace's sessionId must not smuggle its draft",
  );
});

test("symmetric: B cannot read A's rows either, across every v2 route", async () => {
  seedTwoAccounts();
  assert.equal((await asUser(SESSION_B, () => api.getSession("session-a1"))).status, 404);
  assert.equal((await asUser(SESSION_B, () => api.getClaim("claim-a1"))).status, 404);
  assert.equal((await asUser(SESSION_B, () => api.listClaimEvidence("claim-a1"))).status, 404);
  assert.equal((await asUser(SESSION_B, () => api.getMotif("motif-a1"))).status, 404);
  assert.equal((await asUser(SESSION_B, () => api.listMotifSightings("motif-a1"))).status, 404);
  assert.equal((await asUser(SESSION_B, () => api.getConnection("connection-a1"))).status, 404);
  assert.equal((await asUser(SESSION_B, () => api.getApplication("application-a1"))).status, 404);
  assert.equal((await asUser(SESSION_B, () => api.getTeachingDraft("draft-a1"))).status, 404);
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
  assert.equal((await api.listMotifs()).status, 401);
  assert.equal((await api.getMotif("motif-a1")).status, 401);
  assert.equal((await api.listMotifSightings("motif-a1")).status, 401);
  assert.equal((await api.listConnections()).status, 401);
  assert.equal((await api.getConnection("connection-a1")).status, 401);
  assert.equal((await api.listApplications()).status, 401);
  assert.equal((await api.getApplication("application-a1")).status, 401);
  assert.equal((await api.listTeachingDrafts()).status, 401);
  assert.equal((await api.getTeachingDraft("draft-a1")).status, 401);
});

test("responses carry the private/no-store cache policy from lib/api/response.ts", async () => {
  seedTwoAccounts();
  const response = await asUser(SESSION_A, () => api.listSessions());
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

// ---------------------------------------------------------------------------
// 11. Every non-GET verb is refused via the SYNCV2-001 predicate
//     (`assertReadOnlyV2ResourceRequest` / `V2ResourceRouteMutationRejected`),
//     the SAME implementation imported from `lib/api/sync-v2.ts` rather than
//     a second hand-rolled check — including on all nine new route files
//     V2API-002 adds.
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
    { name: "motifs", route: () => routes.motifs, url: "/api/v2/motifs" },
    { name: "motifs/[id]", route: () => routes.motifId, url: "/api/v2/motifs/motif-a1" },
    {
      name: "motifs/[id]/sightings",
      route: () => routes.motifSightings,
      url: "/api/v2/motifs/motif-a1/sightings",
    },
    { name: "connections", route: () => routes.connections, url: "/api/v2/connections" },
    {
      name: "connections/[id]",
      route: () => routes.connectionId,
      url: "/api/v2/connections/connection-a1",
    },
    { name: "applications", route: () => routes.applications, url: "/api/v2/applications" },
    {
      name: "applications/[id]",
      route: () => routes.applicationId,
      url: "/api/v2/applications/application-a1",
    },
    { name: "teaching-drafts", route: () => routes.teachingDrafts, url: "/api/v2/teaching-drafts" },
    {
      name: "teaching-drafts/[id]",
      route: () => routes.teachingDraftId,
      url: "/api/v2/teaching-drafts/draft-a1",
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
// 12. Mutation-prove the tenant predicate — extended (V2API-002) to cover
//     the five new entities' queries, not only the original three.
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

test("M1 removing the workspaceId predicate from app/api/v2/_lib/queries.ts breaks tenant isolation for every v2 query, original five and the five new entities alike", async () => {
  seedTwoAccounts();

  await withMutation(path.join("app", "api", "v2", "_lib", "queries.ts"), async () => {
    // --- original five (V2API-001) --------------------------------------

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

    // --- five new entities (V2API-002) -----------------------------------

    // R9/R10: motif candidates.
    const motifsResponse = await asUser(SESSION_A, () => api.listMotifs());
    const motifsBody = (await motifsResponse.json()) as { data: Array<{ id: string }> };
    assert.ok(
      motifsBody.data.map((row) => row.id).includes("motif-b1"),
      "R9 must now leak motif-b1 with the workspace predicate removed",
    );
    const getMotifResponse = await asUser(SESSION_A, () => api.getMotif("motif-b1"));
    assert.equal(
      getMotifResponse.status,
      200,
      "R10 must now return 200 for B's motif candidate with the workspace predicate removed",
    );

    // R11: motif sightings, nested under B's candidate — leaks because the
    // parent-candidate lookup (getMotifCandidateV2) is mutated too.
    const sightingsResponse = await asUser(SESSION_A, () => api.listMotifSightings("motif-b1"));
    assert.equal(
      sightingsResponse.status,
      200,
      "R11 must now return 200 for sightings under B's candidate id with the workspace predicate removed",
    );
    const sightingsBody = (await sightingsResponse.json()) as { data: Array<{ id: string }> };
    assert.ok(
      sightingsBody.data.map((row) => row.id).includes("sighting-b1"),
      "R11 must now leak sighting-b1 with the workspace predicate removed",
    );

    // R13/R14: connections.
    const connectionsResponse = await asUser(SESSION_A, () => api.listConnections());
    const connectionsBody = (await connectionsResponse.json()) as { data: Array<{ id: string }> };
    assert.ok(
      connectionsBody.data.map((row) => row.id).includes("connection-b1"),
      "R13 must now leak connection-b1 with the workspace predicate removed",
    );
    const getConnectionResponse = await asUser(SESSION_A, () => api.getConnection("connection-b1"));
    assert.equal(
      getConnectionResponse.status,
      200,
      "R14 must now return 200 for B's connection with the workspace predicate removed",
    );

    // R15/R16: applications.
    const applicationsResponse = await asUser(SESSION_A, () => api.listApplications());
    const applicationsBody = (await applicationsResponse.json()) as { data: Array<{ id: string }> };
    assert.ok(
      applicationsBody.data.map((row) => row.id).includes("application-b1"),
      "R15 must now leak application-b1 with the workspace predicate removed",
    );
    const getApplicationResponse = await asUser(SESSION_A, () => api.getApplication("application-b1"));
    assert.equal(
      getApplicationResponse.status,
      200,
      "R16 must now return 200 for B's application with the workspace predicate removed",
    );

    // R17/R18: teaching drafts.
    const draftsResponse = await asUser(SESSION_A, () => api.listTeachingDrafts());
    const draftsBody = (await draftsResponse.json()) as { data: Array<{ id: string }> };
    assert.ok(
      draftsBody.data.map((row) => row.id).includes("draft-b1"),
      "R17 must now leak draft-b1 with the workspace predicate removed",
    );
    const getDraftResponse = await asUser(SESSION_A, () => api.getTeachingDraft("draft-b1"));
    assert.equal(
      getDraftResponse.status,
      200,
      "R18 must now return 200 for B's teaching draft with the workspace predicate removed",
    );
  });
});

test("after the mutation cycle, tenant isolation is restored for every v2 query (harness hygiene)", async () => {
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
  assert.equal((await asUser(SESSION_A, () => api.getMotif("motif-b1"))).status, 404);
  assert.equal((await asUser(SESSION_A, () => api.listMotifSightings("motif-b1"))).status, 404);
  assert.equal((await asUser(SESSION_A, () => api.getConnection("connection-b1"))).status, 404);
  assert.equal((await asUser(SESSION_A, () => api.getApplication("application-b1"))).status, 404);
  assert.equal((await asUser(SESSION_A, () => api.getTeachingDraft("draft-b1"))).status, 404);
});

// ---------------------------------------------------------------------------
// 13. V2API-002 criterion 1 — soft-delete filtering. This is "the one that
//     matters most": before this task, a learner who deleted a claim (or
//     any other v2 entity) still saw it in a v2 list response, and could
//     still fetch it directly by id. `_lib/queries.ts` now excludes any row
//     with a non-null `deletedAt` from every list/get query by default,
//     following `lib/db/entries.ts`'s `includeDeleted` convention. These
//     tests seed a row with `deletedAt` set directly (bypassing any write
//     path, since this task owns no write path) and prove the read surface
//     treats it as gone.
// ---------------------------------------------------------------------------

const DELETED_AT = "2026-01-02T00:00:00Z";

test("S1 a soft-deleted claim is excluded from listClaims and 404s on getClaim", async () => {
  seedTwoAccounts();
  seedClaim({
    id: "claim-a2",
    workspaceId: WORKSPACE_A,
    sessionId: "session-a1",
    deletedAt: DELETED_AT,
  });

  const listResponse = await asUser(SESSION_A, () => api.listClaims());
  const listBody = (await listResponse.json()) as { data: Array<{ id: string }> };
  assert.deepEqual(
    listBody.data.map((row) => row.id),
    ["claim-a1"],
    "S1: a soft-deleted claim must not appear in the list — a learner who deletes a claim must stop seeing it",
  );

  const getResponse = await asUser(SESSION_A, () => api.getClaim("claim-a2"));
  assert.equal(getResponse.status, 404, "S1: a soft-deleted claim must 404 on direct fetch");
});

test("S2 a soft-deleted session is excluded from listSessions and 404s on getSession", async () => {
  seedTwoAccounts();
  seedSession({ id: "session-a2", workspaceId: WORKSPACE_A, deletedAt: DELETED_AT });

  const listResponse = await asUser(SESSION_A, () => api.listSessions());
  const listBody = (await listResponse.json()) as { data: Array<{ id: string }> };
  assert.deepEqual(
    listBody.data.map((row) => row.id),
    ["session-a1"],
    "S2: a soft-deleted session must not appear in the list",
  );

  const getResponse = await asUser(SESSION_A, () => api.getSession("session-a2"));
  assert.equal(getResponse.status, 404, "S2: a soft-deleted session must 404 on direct fetch");
});

test("S3 evidence under A's own claim excludes a soft-deleted evidence row", async () => {
  seedTwoAccounts();
  seedEvidence({
    id: "evidence-a2",
    workspaceId: WORKSPACE_A,
    claimId: "claim-a1",
    deletedAt: DELETED_AT,
  });

  const response = await asUser(SESSION_A, () => api.listClaimEvidence("claim-a1"));
  const body = (await response.json()) as { data: Array<{ id: string }> };
  assert.deepEqual(
    body.data.map((row) => row.id),
    ["evidence-a1"],
    "S3: a soft-deleted evidence row must not appear under its (non-deleted) parent claim",
  );
});

test("S4 evidence under a claim A has soft-deleted 404s, not an empty list", async () => {
  seedTwoAccounts();
  seedClaim({
    id: "claim-a2",
    workspaceId: WORKSPACE_A,
    sessionId: "session-a1",
    deletedAt: DELETED_AT,
  });
  seedEvidence({ id: "evidence-a2", workspaceId: WORKSPACE_A, claimId: "claim-a2" });

  const response = await asUser(SESSION_A, () => api.listClaimEvidence("claim-a2"));
  assert.equal(
    response.status,
    404,
    "S4: evidence nested under a claim the caller has since deleted must 404, exactly like a claim id that never existed — not a 200 with an empty or leaked list",
  );
});

test("S5 a soft-deleted motif candidate is excluded from listMotifs and 404s on getMotif, and its nested sightings 404 too", async () => {
  seedTwoAccounts();
  seedMotifCandidate({ id: "motif-a2", workspaceId: WORKSPACE_A, deletedAt: DELETED_AT });
  seedMotifSighting({ id: "sighting-a2", workspaceId: WORKSPACE_A, candidateId: "motif-a2" });

  const listResponse = await asUser(SESSION_A, () => api.listMotifs());
  const listBody = (await listResponse.json()) as { data: Array<{ id: string }> };
  assert.deepEqual(
    listBody.data.map((row) => row.id),
    ["motif-a1"],
    "S5: a soft-deleted motif candidate must not appear in the list",
  );

  assert.equal(
    (await asUser(SESSION_A, () => api.getMotif("motif-a2"))).status,
    404,
    "S5: a soft-deleted motif candidate must 404 on direct fetch",
  );
  assert.equal(
    (await asUser(SESSION_A, () => api.listMotifSightings("motif-a2"))).status,
    404,
    "S5: sightings nested under a soft-deleted candidate must 404, not leak via the nested route",
  );
});

test("S6 a soft-deleted connection, application, and teaching draft are each excluded from their list and 404 on get", async () => {
  seedTwoAccounts();
  seedConnection({ id: "connection-a2", workspaceId: WORKSPACE_A, deletedAt: DELETED_AT });
  seedApplication({
    id: "application-a2",
    workspaceId: WORKSPACE_A,
    sessionId: "session-a1",
    sourceClaimId: "claim-a1",
    deletedAt: DELETED_AT,
  });
  seedTeachingDraft({
    id: "draft-a2",
    workspaceId: WORKSPACE_A,
    sessionId: "session-a1",
    deletedAt: DELETED_AT,
  });

  const connectionsBody = (await (await asUser(SESSION_A, () => api.listConnections())).json()) as {
    data: Array<{ id: string }>;
  };
  assert.deepEqual(connectionsBody.data.map((row) => row.id), ["connection-a1"]);
  assert.equal((await asUser(SESSION_A, () => api.getConnection("connection-a2"))).status, 404);

  const applicationsBody = (await (await asUser(SESSION_A, () => api.listApplications())).json()) as {
    data: Array<{ id: string }>;
  };
  assert.deepEqual(applicationsBody.data.map((row) => row.id), ["application-a1"]);
  assert.equal((await asUser(SESSION_A, () => api.getApplication("application-a2"))).status, 404);

  const draftsBody = (await (await asUser(SESSION_A, () => api.listTeachingDrafts())).json()) as {
    data: Array<{ id: string }>;
  };
  assert.deepEqual(draftsBody.data.map((row) => row.id), ["draft-a1"]);
  assert.equal((await asUser(SESSION_A, () => api.getTeachingDraft("draft-a2"))).status, 404);
});

// ---------------------------------------------------------------------------
// 14. V2API-002 criterion 4 — bounded page size. Chosen bound: default 50
//     rows, maximum 200 rows per response (`_lib/queries.ts`'s
//     `V2_LIST_DEFAULT_LIMIT` / `V2_LIST_MAX_LIMIT`). These expected numbers
//     are hardcoded literals here, not imported from the module under test
//     — deriving an expected value from the same source as the
//     implementation would make this test unable to catch the bound
//     silently drifting.
//
//     `seedManySessions` gives each row a distinct, strictly increasing
//     `createdAt` so the newest-first ordering these tests assert on is
//     real (`desc(createdAt)`, evaluated by section 2b/3's real ORDER BY
//     support), not an accident of fixture insertion order.
// ---------------------------------------------------------------------------

function seedManySessions(workspaceId: string, count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `session-p${i}`;
    const createdAt = new Date(Date.parse(TS) + i * 1000).toISOString();
    seedSession({ id, workspaceId, createdAt, updatedAt: createdAt });
    ids.push(id);
  }
  return ids;
}

test("P1 listSessions with no ?limit= defaults to 50 rows, newest first", async () => {
  seedWorkspace(WORKSPACE_A, USER_A);
  const ids = seedManySessions(WORKSPACE_A, 55);
  const expectedNewestFirst50 = [...ids].reverse().slice(0, 50);

  const response = await asUser(SESSION_A, () => api.listSessions());
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: Array<{ id: string }> };
  assert.equal(body.data.length, 50, "P1: default page size must be exactly 50 when 55 rows exist");
  assert.deepEqual(
    body.data.map((row) => row.id),
    expectedNewestFirst50,
    "P1: the default page must be the 50 NEWEST rows, not an arbitrary 50",
  );
});

test("P2 listSessions?limit=5 returns exactly the 5 newest rows", async () => {
  seedWorkspace(WORKSPACE_A, USER_A);
  const ids = seedManySessions(WORKSPACE_A, 55);
  const expectedNewestFirst5 = [...ids].reverse().slice(0, 5);

  const response = await asUser(SESSION_A, () => api.listSessions("?limit=5"));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: Array<{ id: string }> };
  assert.deepEqual(body.data.map((row) => row.id), expectedNewestFirst5);
});

test("P3 listSessions?limit=200 (the maximum) returns all rows when fewer than 200 exist", async () => {
  seedWorkspace(WORKSPACE_A, USER_A);
  seedManySessions(WORKSPACE_A, 55);

  const response = await asUser(SESSION_A, () => api.listSessions("?limit=200"));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: unknown[] };
  assert.equal(body.data.length, 55);
});

test("P4 listSessions?limit=201 (over the maximum) is rejected with 400, not silently clamped", async () => {
  seedWorkspace(WORKSPACE_A, USER_A);
  seedManySessions(WORKSPACE_A, 5);

  const response = await asUser(SESSION_A, () => api.listSessions("?limit=201"));
  assert.equal(response.status, 400, "P4: a limit above the stated maximum (200) must 400");
});

test("P5 listSessions?limit=0 and ?limit=abc are both rejected with 400", async () => {
  seedWorkspace(WORKSPACE_A, USER_A);
  seedManySessions(WORKSPACE_A, 5);

  assert.equal((await asUser(SESSION_A, () => api.listSessions("?limit=0"))).status, 400);
  assert.equal((await asUser(SESSION_A, () => api.listSessions("?limit=abc"))).status, 400);
});

test("P6 every new V2API-002 list route also honors a bounded ?limit=", async () => {
  seedTwoAccounts();
  // Not a volume test (that's P1-P5, against sessions) — this proves the
  // SAME `_lib/pagination.ts` schema is wired into every new route file,
  // so an out-of-range limit 400s uniformly rather than only on some routes.
  assert.equal((await asUser(SESSION_A, () => api.listMotifs("?limit=0"))).status, 400);
  assert.equal(
    (await asUser(SESSION_A, () => api.listMotifSightings("motif-a1", "?limit=0"))).status,
    400,
  );
  assert.equal((await asUser(SESSION_A, () => api.listConnections("?limit=0"))).status, 400);
  assert.equal((await asUser(SESSION_A, () => api.listApplications("?limit=0"))).status, 400);
  assert.equal((await asUser(SESSION_A, () => api.listTeachingDrafts("?limit=0"))).status, 400);

  // And a valid, in-range limit is honored (single seeded row each, so
  // ?limit=1 still returns it — proves the param is accepted, not just
  // rejected at the boundary).
  const motifs = (await (await asUser(SESSION_A, () => api.listMotifs("?limit=1"))).json()) as {
    data: unknown[];
  };
  assert.equal(motifs.data.length, 1);
});
