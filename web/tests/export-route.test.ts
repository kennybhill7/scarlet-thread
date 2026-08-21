/**
 * EXPORTROUTE-001 — the export ROUTE is the door EXPORTV2-001 reported
 * missing: `lib/export/vault.ts` (a readOnlyPath here) already builds a full
 * v2 archive, but `app/api/export/route.ts` still queried and passed only
 * v1 data. This suite proves the door is now open, hostile-tenant-safe, and
 * safe on the empty path — driving the REAL `GET` handler in
 * `app/api/export/route.ts`, not a synthetic call to `buildVaultArchive`.
 *
 * Same technique as `tests/v2-api.test.ts` and `tests/tenant-isolation.test.ts`:
 * a small in-memory "PocketPg-lite" store compiled through the genuine
 * drizzle `PgDialect`, so a predicate written in `app/api/export/route.ts`
 * arrives here as real SQL text. The only two seams replaced in
 * `require.cache` are the identity boundary (`@/lib/auth/config`) and the
 * database client (`@/lib/db`) — nothing under `app/` or `lib/` is
 * hand-reimplemented.
 *
 * `lib/db/workspaces.ts` (a readOnlyPath here) is NOT stubbed —
 * `getOrCreatePersonalWorkspace` runs for real against the fake `@/lib/db`
 * below. Every test seeds exactly one pre-existing personal workspace per
 * user, so that function's read always finds a row and returns before ever
 * reaching its `db.execute(sql...)` insert path — this harness only
 * implements `select()`, not `execute()`/`insert()`, by design; see the
 * stub's own comment.
 *
 * Deliberate fixture scope, stated up front rather than smuggled: every
 * fixture here keeps the v1 `entries` table EMPTY. `listEntries` (`lib/db/
 * entries.ts`, unedited by this task) only issues its `entry_threads` JOIN
 * query when it has non-empty rows to hydrate, and this lightweight harness
 * — like `tests/v2-api.test.ts`'s — implements single-table `select` only,
 * no joins. v1's entries+threads-link behavior through this exact route is
 * already covered, unweakened, by `tests/tenant-isolation.test.ts`'s R9
 * (which DOES model the join) and by `tests/export.test.ts`/`export-v2.test.ts`
 * calling `buildVaultArchive` directly — this suite does not re-prove that
 * ground and instead adds real `people`/`daily_logs`/`threads` (all plain
 * single-table selects, no join) alongside the eight v2 tables, so the v1
 * wiring this route keeps unchanged still gets exercised end-to-end here too.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { Column, SQL, Table, getTableColumns, getTableName, is } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { strFromU8, unzipSync } from "fflate";

import * as schema from "@/db/schema";
import { CANONICAL_VERSIFICATION_ID } from "@/lib/contracts/range-v1";
import { SYNC_ENTITIES_V2, type SyncEntityV2 } from "@/lib/contracts/sync-v2";

/* eslint-disable @typescript-eslint/no-explicit-any --
 * The route module is loaded dynamically and reloaded after each mutation
 * cycle, so its shape cannot be named statically here — same rationale as
 * tenant-isolation.test.ts and v2-api.test.ts. */

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
// 1. Schema registry — every table the route's GET handler touches.
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
  schema.entries,
  schema.threads,
  schema.people,
  schema.dailyLogs,
  schema.studySessions,
  schema.studyClaims,
  schema.claimEvidence,
  schema.motifCandidates,
  schema.motifSightings,
  schema.userConnections,
  schema.applications,
  schema.teachingDrafts,
  schema.teachingSections,
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
  if (!meta) throw new Error(`PocketPg-lite (export-route) does not model table "${getTableName(table)}"`);
  return meta;
}

// ---------------------------------------------------------------------------
// 2. WHERE evaluator — single-table only (`and`, `=`, `is null`), the exact
//    shape app/api/export/route.ts and lib/db/{entries,threads}.ts,
//    lib/db/workspaces.ts emit. Verbatim technique from
//    tests/v2-api.test.ts's evaluator (real compiled SQL text, not a
//    re-guessed grammar).
// ---------------------------------------------------------------------------

function evaluatePredicate(predicate: Predicate, row: Row, sqlName: string): boolean {
  const { sql, params } = predicate;
  let pos = 0;
  const fail = (reason: string): never => {
    throw new Error(`PocketPg-lite (export-route) cannot evaluate SQL (${reason}) at offset ${pos} of: ${sql}`);
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
// 2b. ORDER BY evaluator — `lib/db/threads.ts` sorts `asc(title)`,
//     `lib/db/entries.ts` sorts `desc(updatedAt)`, `lib/db/workspaces.ts`
//     sorts `asc(createdAt), asc(id)`. Verbatim from tests/v2-api.test.ts.
// ---------------------------------------------------------------------------

type OrderSpec = { prop: string; direction: "asc" | "desc" };

function compileOrderBy(clause: SQL, meta: TableMeta): OrderSpec {
  const query = dialect.sqlToQuery(clause);
  const match = /^"([a-z0-9_]+)"\."([a-z0-9_]+)" (asc|desc)$/.exec(query.sql);
  if (!match) throw new Error(`PocketPg-lite (export-route) cannot evaluate ORDER BY: ${query.sql}`);
  const [, tableName, columnName, direction] = match;
  if (tableName !== meta.sqlName) {
    throw new Error(`PocketPg-lite (export-route): unexpected table "${tableName}" in ORDER BY on "${meta.sqlName}"`);
  }
  const prop = meta.propByColumn.get(columnName);
  if (!prop) throw new Error(`PocketPg-lite (export-route): unknown ORDER BY column "${tableName}"."${columnName}"`);
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
// 3. PocketPg-lite — select().from().where().orderBy().limit() only. GET-only
//    route: production code under test never issues a write. `execute`/
//    `insert` exist solely to fail loudly if that assumption is ever wrong.
//
//    `queryLog` records, per table, the row ids the LAST select against that
//    table actually returned (post-WHERE, pre field-projection) — this is
//    what lets the mutation-proof test (section 9) observe route.ts's OWN
//    query-level workspace scoping directly, independent of whatever
//    lib/export/vault.ts's separate defense-in-depth filter later does to
//    the same rows. Reset before every request via resetQueryLog().
// ---------------------------------------------------------------------------

const dialect = new PgDialect();
const world = new Map<string, Row[]>();
const queryLog: Record<string, string[]> = {};

function resetWorld() {
  world.clear();
  for (const table of MODELLED_TABLES) world.set(getTableName(table), []);
}

function resetQueryLog() {
  for (const key of Object.keys(queryLog)) delete queryLog[key];
}

const rowsOf = (sqlName: string): Row[] => {
  const rows = world.get(sqlName);
  if (!rows) throw new Error(`PocketPg-lite (export-route) has no table "${sqlName}"`);
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
      if (!from) throw new Error("PocketPg-lite (export-route) received orderBy() before from()");
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
          if (!from) throw new Error("PocketPg-lite (export-route) received a select without from()");
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
          queryLog[meta.sqlName] = rows
            .map((row) => row.id)
            .filter((id): id is string => typeof id === "string");
          return rows.map((row) => {
            if (!fields) return clone(row);
            const out: Row = {};
            for (const [key, value] of Object.entries(fields)) {
              if (!is(value, Column)) {
                throw new Error(`PocketPg-lite (export-route) does not model select field "${key}" of this shape`);
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
  insert: () => {
    throw new Error(
      "PocketPg-lite (export-route) does not implement db.insert() — every fixture must seed a " +
        "pre-existing personal workspace so lib/db/workspaces.ts never falls through to its insert " +
        "path. If this fires, a test is missing seedWorkspace() for a user id.",
    );
  },
  execute: () => {
    throw new Error("PocketPg-lite (export-route) does not implement db.execute().");
  },
};

const DB_PATH = seedModule("@/lib/db", { db: pocketPg });

// ---------------------------------------------------------------------------
// 4. Identity seam
// ---------------------------------------------------------------------------

type Session = { user: { id: string; email: string } } | null;

const USER_A = "user-a";
const USER_B = "user-b";
const USER_C = "user-c";
const WORKSPACE_A = "workspace-a";
const WORKSPACE_B = "workspace-b";
const WORKSPACE_C = "workspace-c";

const SESSION_A: Session = { user: { id: USER_A, email: "a@example.test" } };
const SESSION_B: Session = { user: { id: USER_B, email: "b@example.test" } };
const SESSION_C: Session = { user: { id: USER_C, email: "c@example.test" } };

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
// 5. Network trap
// ---------------------------------------------------------------------------

const blocked = (label: string) => {
  throw new Error(`Network access blocked in export-route test: ${label}`);
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
// 6. Compile recorder / mutator — two independent, targeted mutations of
//    app/api/export/route.ts's OWN compiled source, in memory, while it is
//    required. No file is written; the on-disk hash/mtime are re-verified
//    after every cycle (withMutation, section 7).
//
//    "workspace-predicate": rewrites every `eq(<table>.workspaceId,
//    workspaceId)` this route issues into `eq(<table>.workspaceId,
//    <table>.workspaceId)` — a self-tautology against a NOT NULL column, so
//    the statement stays valid but the route's OWN scoping of its eight v2
//    queries is gone. See test section 9 for why this is checked against
//    queryLog (what the route's query itself fetched), not the final
//    archive: lib/export/vault.ts (readOnlyPath, untouched here) applies
//    its own independent workspaceId filter to whatever this route passes
//    it, so a leak at the query layer does not by itself leak into the
//    final response body — that is deliberate defense-in-depth, not a
//    reason this route may skip its own scoping (see route.ts's header).
//
//    "workspace-arg": rewrites the bare `workspaceId,` argument this route
//    passes into `buildVaultArchive({ ... })` into `workspaceId: undefined,`
//    — simulating the route forgetting to pass the resolved workspaceId at
//    all. This defeats a DIFFERENT thing than the predicate mutation: with
//    v2 data present, vault.ts's own "workspaceId required" guard fires and
//    the real request path must surface that as a real 500 (via
//    lib/api/response.ts's serverError), not a 200 with wrong/missing data.
// ---------------------------------------------------------------------------

type MutationKind = "workspace-predicate" | "workspace-arg";

const WORKSPACE_PREDICATE_PATTERN =
  /\.eq\)\(([A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)*)\.workspaceId\s*,\s*workspaceId\)/g;
// Matches the bare shorthand `workspaceId,` object-literal argument, but not
// the member-access `<table>.workspaceId,` inside an eq(...) call (excluded
// by the negative lookbehind on a preceding `.`).
const WORKSPACE_ARG_PATTERN = /(?<!\.)\bworkspaceId,/g;

let mutating: { file: string; kind: MutationKind; hits: number } | null = null;

const originalCompile = (Module as any).prototype._compile;
(Module as any).prototype._compile = function patchedCompile(
  content: string,
  filename: string,
  ...rest: unknown[]
) {
  const resolved = path.resolve(filename);
  let source = content;
  if (mutating && resolved === mutating.file) {
    if (mutating.kind === "workspace-predicate") {
      const hits = source.match(WORKSPACE_PREDICATE_PATTERN)?.length ?? 0;
      mutating.hits += hits;
      source = source.replace(
        WORKSPACE_PREDICATE_PATTERN,
        (_match, table: string) => `.eq)(${table}.workspaceId,${table}.workspaceId)`,
      );
    } else {
      const hits = source.match(WORKSPACE_ARG_PATTERN)?.length ?? 0;
      mutating.hits += hits;
      source = source.replace(WORKSPACE_ARG_PATTERN, "workspaceId: undefined,");
    }
  }
  return originalCompile.call(this, source, filename, ...rest);
};

const SEEDED_PATHS = new Set([SERVER_ONLY_PATH, DB_PATH, AUTH_PATH]);
const APP_DIR = path.join(WEB_ROOT, "app") + path.sep;

function purgeApplicationModules() {
  for (const key of Object.keys(nodeRequire.cache)) {
    if (SEEDED_PATHS.has(key)) continue;
    const resolved = path.resolve(key);
    if (resolved.startsWith(APP_DIR)) delete (nodeRequire.cache as any)[key];
  }
}

// ---------------------------------------------------------------------------
// 7. Route loading and the request surface
// ---------------------------------------------------------------------------

type RouteModule = { GET: () => Promise<Response> };

function loadRoute(): RouteModule {
  return nodeRequire("@/app/api/export/route.ts") as RouteModule;
}

let route = loadRoute();

const api = {
  exportVault: () => route.GET(),
};

async function withMutation(relativeFile: string, kind: MutationKind, body: () => Promise<void>) {
  const file = path.join(WEB_ROOT, relativeFile);
  const beforeHash = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const beforeMtime = fs.statSync(file).mtimeMs;

  mutating = { file, kind, hits: 0 };
  purgeApplicationModules();
  route = loadRoute();

  try {
    assert.ok(
      mutating.hits > 0,
      `mutation (${kind}) matched nothing in ${relativeFile} — the compiled shape changed; update the pattern`,
    );
    await body();
  } finally {
    mutating = null;
    purgeApplicationModules();
    route = loadRoute();
    const afterHash = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    assert.equal(afterHash, beforeHash, `${relativeFile} was modified on disk`);
    assert.equal(fs.statSync(file).mtimeMs, beforeMtime, `${relativeFile} mtime changed`);
  }
}

// ---------------------------------------------------------------------------
// 8. Fixtures
// ---------------------------------------------------------------------------

const TS = "2026-01-01T00:00:00Z";

function range(start: string, end = start) {
  return { versificationId: CANONICAL_VERSIFICATION_ID, start, end };
}

function mark(label: string) {
  return `MARK-${label}-${crypto.randomUUID()}`;
}

function allFileText(archive: Uint8Array) {
  const files = unzipSync(archive);
  return {
    files,
    text: Object.values(files)
      .map((bytes) => strFromU8(bytes))
      .join("\n---FILE-BOUNDARY---\n"),
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

function seedPerson(userId: string, slug: string, nameMarker: string) {
  rowsOf("people").push({
    slug,
    userId,
    name: nameMarker,
    body: `body for ${nameMarker}`,
    chapters: [],
    threadSlugs: [],
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  });
}

function seedThread(userId: string, slug: string, titleMarker: string) {
  rowsOf("threads").push({
    slug,
    userId,
    title: titleMarker,
    definition: `definition for ${titleMarker}`,
    seeing: "",
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  });
}

function seedDailyLog(userId: string, date: string, sentenceMarker: string) {
  rowsOf("daily_logs").push({
    userId,
    date,
    chapter: null,
    read: true,
    observe: false,
    link: false,
    ask: false,
    pray: false,
    sentence: sentenceMarker,
    carrying: "",
    prayer: "",
    updatedAt: TS,
  });
}

function seedSession(id: string, workspaceId: string, marker: string) {
  rowsOf("study_sessions").push({
    id,
    workspaceId,
    range: range("1.1.1", "1.1.5"),
    mode: "encounter",
    workflowState: "active",
    connectionState: "unexamined",
    catalogReleaseId: null,
    readGateAt: null,
    currentStep: marker,
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  });
}

function seedClaim(id: string, workspaceId: string, sessionId: string, marker: string) {
  rowsOf("study_claims").push({
    id,
    workspaceId,
    sessionId,
    kind: "observation",
    epistemicBasis: "text_explicit",
    body: marker,
    passage: range("1.1.1"),
    confidence: "developing",
    provenance: "learner",
    doctrineStatus: null,
    viewpointId: null,
    status: "draft",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  });
}

function seedEvidence(id: string, workspaceId: string, claimId: string, marker: string) {
  rowsOf("claim_evidence").push({
    id,
    workspaceId,
    claimId,
    evidenceType: "passage",
    canonicalReference: range("1.1.1"),
    displayReference: null,
    contentBlockId: null,
    citationId: null,
    connectionId: null,
    note: marker,
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  });
}

function seedMotif(id: string, workspaceId: string, marker: string) {
  rowsOf("motif_candidates").push({
    id,
    workspaceId,
    label: marker,
    normalizedKey: marker.toLowerCase(),
    status: "candidate",
    threadSlug: null,
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  });
}

function seedSighting(id: string, workspaceId: string, candidateId: string, marker: string) {
  rowsOf("motif_sightings").push({
    id,
    workspaceId,
    candidateId,
    passageUnitKey: marker,
    exactRange: range("1.1.1"),
    entryId: null,
    claimId: null,
    status: "candidate",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  });
}

function seedConnection(id: string, workspaceId: string, marker: string) {
  rowsOf("user_connections").push({
    id,
    workspaceId,
    fromRange: range("1.1.1"),
    toRange: range("40.1.1"),
    type: "quotation",
    evidenceLabel: "strong",
    rationale: `${marker} — twenty-plus characters of rationale text.`,
    threadSlug: null,
    status: "draft",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  });
}

function seedApplication(
  id: string,
  workspaceId: string,
  sessionId: string,
  sourceClaimId: string,
  marker: string,
) {
  rowsOf("applications").push({
    id,
    workspaceId,
    sessionId,
    sourceClaimId,
    originalAudienceMeaning: "meaning",
    enduringPrinciple: "principle",
    canonicalBridge: "bridge",
    applicationClass: "class",
    promiseScope: "scope",
    modernDomain: "work",
    situation: marker,
    responseType: "action",
    faithfulResponse: "response",
    cautions: "none",
    availableAfter: null,
    status: "draft",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  });
}

function seedTeachingDraft(id: string, workspaceId: string, sessionId: string, marker: string) {
  rowsOf("teaching_drafts").push({
    id,
    workspaceId,
    sessionId,
    title: marker,
    bigIdea: "idea",
    audience: "adults",
    durationMinutes: 30,
    gospelConnection: "connection",
    status: "draft",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  });
}

function seedTeachingSection(id: string, workspaceId: string, draftId: string, marker: string) {
  rowsOf("teaching_sections").push({
    id,
    workspaceId,
    draftId,
    kind: "outline",
    sortOrder: 0,
    body: marker,
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  });
}

/** Table sqlName + fixture ids for each of the eight SYNC_ENTITIES_V2
 *  entities, derived from the contract array at runtime (never hand-listed
 *  a second time) so a ninth entity forces this file to be updated. */
const V2_TABLE_SQL_NAMES: Record<SyncEntityV2, string> = {
  session: getTableName(schema.studySessions),
  claim: getTableName(schema.studyClaims),
  evidence: getTableName(schema.claimEvidence),
  motif: getTableName(schema.motifCandidates),
  motifSighting: getTableName(schema.motifSightings),
  connection: getTableName(schema.userConnections),
  application: getTableName(schema.applications),
  teachingDraft: getTableName(schema.teachingDrafts),
  teachingSection: getTableName(schema.teachingSections),
};

/** Full two-account fixture: v1 (person/thread/daily log) + all eight v2
 *  entities, for both WORKSPACE_A/USER_A and WORKSPACE_B/USER_B, each row
 *  carrying a unique marker so a leak is detectable by substring search
 *  over the unzipped archive text rather than by row count alone. Returns
 *  the marker maps so each test can assert on the exact values it seeded. */
function seedTwoAccounts() {
  seedWorkspace(WORKSPACE_A, USER_A);
  seedWorkspace(WORKSPACE_B, USER_B);

  const markersA = Object.fromEntries(
    SYNC_ENTITIES_V2.map((entity) => [entity, mark(`a-${entity}`)]),
  ) as Record<SyncEntityV2, string>;
  const markersB = Object.fromEntries(
    SYNC_ENTITIES_V2.map((entity) => [entity, mark(`b-${entity}`)]),
  ) as Record<SyncEntityV2, string>;

  seedPerson(USER_A, "person-a", mark("a-person"));
  seedThread(USER_A, "thread-a", mark("a-thread"));
  seedDailyLog(USER_A, "2026-01-01", mark("a-log"));
  seedPerson(USER_B, "person-b", mark("b-person"));
  seedThread(USER_B, "thread-b", mark("b-thread"));
  seedDailyLog(USER_B, "2026-01-01", mark("b-log"));

  seedSession("session-a1", WORKSPACE_A, markersA.session);
  seedSession("session-b1", WORKSPACE_B, markersB.session);
  seedClaim("claim-a1", WORKSPACE_A, "session-a1", markersA.claim);
  seedClaim("claim-b1", WORKSPACE_B, "session-b1", markersB.claim);
  seedEvidence("evidence-a1", WORKSPACE_A, "claim-a1", markersA.evidence);
  seedEvidence("evidence-b1", WORKSPACE_B, "claim-b1", markersB.evidence);
  seedMotif("motif-a1", WORKSPACE_A, markersA.motif);
  seedMotif("motif-b1", WORKSPACE_B, markersB.motif);
  seedSighting("sighting-a1", WORKSPACE_A, "motif-a1", markersA.motifSighting);
  seedSighting("sighting-b1", WORKSPACE_B, "motif-b1", markersB.motifSighting);
  seedConnection("connection-a1", WORKSPACE_A, markersA.connection);
  seedConnection("connection-b1", WORKSPACE_B, markersB.connection);
  seedApplication("application-a1", WORKSPACE_A, "session-a1", "claim-a1", markersA.application);
  seedApplication("application-b1", WORKSPACE_B, "session-b1", "claim-b1", markersB.application);
  seedTeachingDraft("draft-a1", WORKSPACE_A, "session-a1", markersA.teachingDraft);
  seedTeachingDraft("draft-b1", WORKSPACE_B, "session-b1", markersB.teachingDraft);
  seedTeachingSection("section-a1", WORKSPACE_A, "draft-a1", markersA.teachingSection);
  seedTeachingSection("section-b1", WORKSPACE_B, "draft-b1", markersB.teachingSection);

  return {
    markersA,
    markersB,
    ids: {
      A: {
        session: "session-a1",
        claim: "claim-a1",
        evidence: "evidence-a1",
        motif: "motif-a1",
        motifSighting: "sighting-a1",
        connection: "connection-a1",
        application: "application-a1",
        teachingDraft: "draft-a1",
        teachingSection: "section-a1",
      } satisfies Record<SyncEntityV2, string>,
      B: {
        session: "session-b1",
        claim: "claim-b1",
        evidence: "evidence-b1",
        motif: "motif-b1",
        motifSighting: "sighting-b1",
        connection: "connection-b1",
        application: "application-b1",
        teachingDraft: "draft-b1",
        teachingSection: "section-b1",
      } satisfies Record<SyncEntityV2, string>,
    },
  };
}

test.beforeEach(() => {
  resetWorld();
  resetQueryLog();
  currentSession = null;
});

// ---------------------------------------------------------------------------
// 9. Tests
// ---------------------------------------------------------------------------

// --- Criterion 1: all eight v2 tables reach the archive, through the real route ---

test("coverage: the real GET route puts all eight SYNC_ENTITIES_V2 entities' content into the unzipped archive (runtime-driven, not a hand-listed set)", async () => {
  seedWorkspace(WORKSPACE_A, USER_A);
  const markers = Object.fromEntries(
    SYNC_ENTITIES_V2.map((entity) => [entity, mark(entity)]),
  ) as Record<SyncEntityV2, string>;

  seedSession("session-cov", WORKSPACE_A, markers.session);
  seedClaim("claim-cov", WORKSPACE_A, "session-cov", markers.claim);
  seedEvidence("evidence-cov", WORKSPACE_A, "claim-cov", markers.evidence);
  seedMotif("motif-cov", WORKSPACE_A, markers.motif);
  seedSighting("sighting-cov", WORKSPACE_A, "motif-cov", markers.motifSighting);
  seedConnection("connection-cov", WORKSPACE_A, markers.connection);
  seedApplication("application-cov", WORKSPACE_A, "session-cov", "claim-cov", markers.application);
  seedTeachingDraft("draft-cov", WORKSPACE_A, "session-cov", markers.teachingDraft);
  seedTeachingSection("section-cov", WORKSPACE_A, "draft-cov", markers.teachingSection);

  // Tripwire, not a hand-listed assumption: if SYNC_ENTITIES_V2 grows again,
  // this fails loudly as a reminder that a matching seed*() call above (and
  // the coverage this test claims) needs updating too -- exactly the gap
  // TEACHSECTIONSYNC-001 hit here at integration when this number went stale.
  assert.equal(SYNC_ENTITIES_V2.length, 9);

  const response = await asUser(SESSION_A, () => api.exportVault());
  assert.equal(response.status, 200);
  const archive = new Uint8Array(await response.arrayBuffer());
  const { text } = allFileText(archive);

  for (const entity of SYNC_ENTITIES_V2) {
    assert.ok(
      text.includes(markers[entity]),
      `expected the REAL response body to contain entity "${entity}"'s marker, but it did not — the route never reached this table`,
    );
  }
});

// --- Criterion 3: hostile two-account round trip, real unzip of the real response ---

test("hostile: unzipping account A's REAL response body contains nothing belonging to account B — v1 and all eight v2 entities", async () => {
  const { markersA, markersB } = seedTwoAccounts();

  const response = await asUser(SESSION_A, () => api.exportVault());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("content-type"), "application/zip");

  // The load-bearing assertion: the REAL response body, unzipped for real —
  // never the objects the route happened to pass into buildVaultArchive.
  const archive = new Uint8Array(await response.arrayBuffer());
  const { text } = allFileText(archive);

  for (const entity of SYNC_ENTITIES_V2) {
    assert.ok(text.includes(markersA[entity]), `A's own "${entity}" marker is missing from A's export`);
    assert.ok(
      !text.includes(markersB[entity]),
      `B's "${entity}" marker leaked into A's export — tenant isolation broken`,
    );
  }
});

test("hostile: the reverse direction also holds — account B's export contains nothing belonging to account A", async () => {
  const { markersA, markersB } = seedTwoAccounts();

  const response = await asUser(SESSION_B, () => api.exportVault());
  assert.equal(response.status, 200);
  const archive = new Uint8Array(await response.arrayBuffer());
  const { text } = allFileText(archive);

  for (const entity of SYNC_ENTITIES_V2) {
    assert.ok(text.includes(markersB[entity]), `B's own "${entity}" marker is missing from B's export`);
    assert.ok(!text.includes(markersA[entity]), `A's "${entity}" marker leaked into B's export`);
  }
});

// --- Criterion 4: the empty case — a learner with no v2 (and no v1) data ---

test("empty case: a learner with no v1 or v2 data still gets a valid, non-corrupt archive (never throws, never a broken zip)", async () => {
  seedWorkspace(WORKSPACE_C, USER_C);

  const response = await asUser(SESSION_C, () => api.exportVault());
  assert.equal(response.status, 200, "an empty-data export must still succeed, not 500");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="scarlet-thread-vault.zip"');

  const archive = new Uint8Array(await response.arrayBuffer());
  assert.ok(archive.byteLength > 0, "archive bytes must not be empty");

  // unzipSync throws on a corrupt archive — this call not throwing IS part
  // of the "not a corrupt zip" proof.
  const files = unzipSync(archive);
  assert.ok(files["Bible Brain/README.md"], "even an empty export must contain the README");
  const names = Object.keys(files);
  assert.ok(
    !names.some((name) => name.startsWith("Bible Brain/06 Study/")),
    "an export with no v2 data must not contain a 06 Study folder at all",
  );
});

// --- Criterion 2: the workspaceId-required guard, exercised via the REAL request path ---

test("guard exercised via the real request path: v2 data actually exports successfully (workspaceId really reaches buildVaultArchive)", async () => {
  seedWorkspace(WORKSPACE_A, USER_A);
  const marker = mark("guard-control");
  seedSession("session-guard", WORKSPACE_A, marker);

  const response = await asUser(SESSION_A, () => api.exportVault());
  assert.equal(response.status, 200);
  const archive = new Uint8Array(await response.arrayBuffer());
  const { text } = allFileText(archive);
  assert.ok(text.includes(marker), "v2 session data did not reach the real response — workspaceId was not passed");
});

test("guard exercised via the real request path: if route.ts stopped passing workspaceId, the real request 500s (via serverError) instead of silently mis-exporting", async () => {
  seedWorkspace(WORKSPACE_A, USER_A);
  seedSession("session-guard-2", WORKSPACE_A, mark("guard-mutated"));

  await withMutation(path.join("app", "api", "export", "route.ts"), "workspace-arg", async () => {
    const response = await asUser(SESSION_A, () => api.exportVault());
    assert.equal(
      response.status,
      500,
      "lib/export/vault.ts's own 'workspaceId is required when v2 data is present' guard must surface as a real 500 through the real request path when route.ts stops passing it",
    );
  });
});

// --- Criterion 6: mutation-prove the route's OWN workspace scoping ---

test("workspace scoping (baseline): route.ts's own v2 table queries fetch ONLY the caller's workspace rows, at the query layer", async () => {
  const { ids } = seedTwoAccounts();

  const response = await asUser(SESSION_A, () => api.exportVault());
  assert.equal(response.status, 200);

  for (const entity of SYNC_ENTITIES_V2) {
    const sqlName = V2_TABLE_SQL_NAMES[entity];
    const fetched = queryLog[sqlName] ?? [];
    assert.ok(fetched.includes(ids.A[entity]), `route's own "${entity}" query did not fetch A's own row`);
    assert.ok(
      !fetched.includes(ids.B[entity]),
      `route's own "${entity}" query fetched B's row (${ids.B[entity]}) even without any mutation — workspace scoping is missing`,
    );
  }
});

test("workspace scoping (mutation-prove): removing route.ts's eq(<table>.workspaceId, workspaceId) predicate makes every v2 query fetch cross-tenant rows — caught by a NAMED test even though vault.ts's own independent filter still keeps them out of the final archive", async () => {
  const { ids, markersB } = seedTwoAccounts();

  await withMutation(path.join("app", "api", "export", "route.ts"), "workspace-predicate", async () => {
    const response = await asUser(SESSION_A, () => api.exportVault());
    assert.equal(response.status, 200);

    // The mutation IS observed, at the layer this route's own code controls:
    // its query for every one of the eight v2 tables now fetches B's row too.
    for (const entity of SYNC_ENTITIES_V2) {
      const sqlName = V2_TABLE_SQL_NAMES[entity];
      const fetched = queryLog[sqlName] ?? [];
      assert.ok(
        fetched.includes(ids.B[entity]),
        `mutation did not defeat route.ts's own "${entity}" workspace predicate — query still excluded B's row`,
      );
    }

    // Documented, not silently relied upon: lib/export/vault.ts (a
    // readOnlyPath here, untouched by this mutation) re-scopes every v2 row
    // to the SAME workspaceId a second time before rendering, so B's content
    // still does not reach the final response body. This is why criterion 3's
    // hostile round-trip test above cannot, by itself, prove this route's own
    // query is scoped — that is exactly what THIS test proves instead, at the
    // layer where the regression actually lives.
    const archive = new Uint8Array(await response.arrayBuffer());
    const { text } = allFileText(archive);
    for (const entity of SYNC_ENTITIES_V2) {
      assert.ok(
        !text.includes(markersB[entity]),
        `vault.ts's defense-in-depth filter should have kept B's "${entity}" marker out of the final archive even under this mutation`,
      );
    }
  });
});
