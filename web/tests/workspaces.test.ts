/**
 * WORKSPACE-001 — the missing link between an authenticated session and any
 * v2 row: resolving a user id to their personal workspace, and refusing to
 * let a caller use a workspace id that is not theirs.
 *
 * No live database is used (matching the in-memory harness pattern
 * `tests/tenant-isolation.test.ts` established: real query builders, a
 * recording/evaluating fake store, nothing under `lib/` stubbed). `@/lib/db`
 * is replaced in `require.cache` before `@/lib/db/workspaces` is required, so
 * every predicate below is the ACTUAL drizzle SQL `lib/db/workspaces.ts`
 * compiles — evaluated here via the real `PgDialect`, not reimplemented.
 *
 * What this file does NOT prove: true multi-connection concurrency safety
 * for `getOrCreatePersonalWorkspace`'s insert. That was verified separately
 * against a real local Postgres 16 instance during this task's manual
 * verification (see the queue evidence) — a fake single-threaded JS store
 * cannot demonstrate the same race a real database's MVCC snapshots can, and
 * `lib/db/workspaces.ts`'s own doc comment explains exactly why the race is
 * not fully closeable within this task's owned paths.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

/* eslint-disable @typescript-eslint/no-explicit-any --
 * The fake store below deliberately stays generic over row shape, mirroring
 * tenant-isolation.test.ts's PocketPg. */

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
// A single-table fake store for `workspaces`, driven by the REAL compiled
// SQL `lib/db/workspaces.ts` produces (dialect.sqlToQuery), not a hand-rolled
// re-implementation of its logic — the same principle tenant-isolation.test.ts
// uses for the full multi-table case.
// ---------------------------------------------------------------------------

type Row = {
  id: string;
  kind: string;
  name: string;
  createdBy: string;
  createdAt: string;
  deletedAt: string | null;
};

const dialect = new PgDialect();
let rows: Row[] = [];
let executeCallCount = 0;

function compile(condition: unknown) {
  if (!condition) return null;
  const query = dialect.sqlToQuery(condition as any);
  return { sql: query.sql as string, params: query.params as unknown[] };
}

const COLUMN_BY_NAME: Record<string, keyof Row> = {
  id: "id",
  kind: "kind",
  name: "name",
  created_by: "createdBy",
  created_at: "createdAt",
  deleted_at: "deletedAt",
};

/** Recursive-descent evaluator over dialect-compiled SQL text, scoped to the
 *  small grammar `lib/db/workspaces.ts` actually emits: `"workspaces"."col"
 *  = $n`, `is null`, and parenthesised `and`. Anything else throws rather
 *  than silently passing — same rule tenant-isolation.test.ts's evaluator
 *  follows. */
function evaluatePredicate(
  predicate: { sql: string; params: unknown[] },
  row: Row,
): boolean {
  const { sql, params } = predicate;
  let pos = 0;
  const fail = (reason: string): never => {
    throw new Error(`fake workspaces store cannot evaluate (${reason}): ${sql}`);
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
      const match = /^"workspaces"\."([a-z0-9_]+)"/.exec(sql.slice(pos));
      if (!match) return fail("malformed column reference");
      pos += match[0].length;
      const prop = COLUMN_BY_NAME[match[1]];
      if (!prop) return fail(`unknown column "${match[1]}"`);
      return row[prop] ?? null;
    }
    if (sql[pos] === "$") {
      const match = /^\$(\d+)/.exec(sql.slice(pos));
      if (!match) return fail("malformed parameter");
      pos += match[0].length;
      return params[Number(match[1]) - 1] ?? null;
    }
    return fail("expected a column reference or a parameter");
  };
  const parseComparison = (): boolean => {
    skipSpaces();
    const left = parseOperand();
    skipSpaces();
    if (eat("is not null")) return left !== null;
    if (eat("is null")) return left === null;
    if (eat("=")) {
      const right = parseOperand();
      return left !== null && right !== null && left === right;
    }
    return fail("unsupported operator");
  };
  const parseTerm = (): boolean => {
    skipSpaces();
    if (eat("(")) {
      let value = parseTerm();
      for (;;) {
        skipSpaces();
        if (eat("and ")) {
          value = parseTerm() && value;
        } else {
          break;
        }
      }
      skipSpaces();
      if (!eat(")")) return fail('expected ")"');
      return value;
    }
    return parseComparison();
  };
  const result = parseTerm();
  skipSpaces();
  if (pos !== sql.length) fail("trailing tokens");
  return result;
}

function parseOrderBy(expr: unknown) {
  const compiled = compile(expr);
  if (!compiled) throw new Error("empty ORDER BY");
  const match = /^"workspaces"\."([a-z0-9_]+)"(?: (asc|desc))?$/.exec(
    compiled.sql,
  );
  if (!match) throw new Error(`cannot evaluate ORDER BY: ${compiled.sql}`);
  const prop = COLUMN_BY_NAME[match[1]];
  if (!prop) throw new Error(`unknown ORDER BY column "${match[1]}"`);
  return { prop, direction: (match[2] ?? "asc") as "asc" | "desc" };
}

function selectRows(
  fields: Record<string, unknown> | null,
  where: unknown,
  orderBy: unknown[],
  limit: number | null,
): Record<string, unknown>[] {
  const predicate = compile(where);
  let matched = predicate
    ? rows.filter((row) => evaluatePredicate(predicate, row))
    : [...rows];

  for (const expr of [...orderBy].reverse()) {
    const { prop, direction } = parseOrderBy(expr);
    matched = [...matched].sort((a, b) => {
      const av = String(a[prop] ?? "");
      const bv = String(b[prop] ?? "");
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return direction === "asc" ? cmp : -cmp;
    });
  }

  const limited = limit === null ? matched : matched.slice(0, limit);

  if (!fields) return limited.map((row) => ({ ...row }));
  return limited.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(fields)) {
      const colName = (column as any).name as string;
      const prop = COLUMN_BY_NAME[colName];
      out[key] = prop ? (row[prop] ?? null) : null;
    }
    return out;
  });
}

function makeSelectChain(fields: Record<string, unknown> | null): any {
  const chain: any = {
    from() {
      return {
        where(cond: unknown) {
          const built = {
            orderBy(...exprs: unknown[]) {
              return {
                limit(n: number) {
                  return Promise.resolve(
                    selectRows(fields, cond, exprs, n),
                  );
                },
                then(resolve: any, reject: any) {
                  return Promise.resolve(
                    selectRows(fields, cond, exprs, null),
                  ).then(resolve, reject);
                },
              };
            },
            limit(n: number) {
              return Promise.resolve(selectRows(fields, cond, [], n));
            },
            then(resolve: any, reject: any) {
              return Promise.resolve(
                selectRows(fields, cond, [], null),
              ).then(resolve, reject);
            },
          };
          return built;
        },
      };
    },
  };
  return chain;
}

/** Recognises ONLY the exact insert shape `getOrCreatePersonalWorkspace`
 *  emits. Anything else throws rather than silently no-opping, so a change
 *  to the production statement's shape breaks this test loudly instead of
 *  passing by accident. */
function fakeExecute(query: unknown) {
  executeCallCount += 1;
  const compiled = compile(query);
  if (!compiled) throw new Error("fake db.execute received an empty query");
  const { sql, params } = compiled;
  const isKnownInsert =
    sql.includes('insert into "workspaces"') &&
    sql.includes("where not exists") &&
    sql.includes("returning id");
  if (!isKnownInsert) {
    throw new Error(
      `fake db.execute does not recognise this statement shape: ${sql}`,
    );
  }
  const [id, name, createdBy, createdAt] = params as [
    string,
    string,
    string,
    string,
  ];
  const alreadyExists = rows.some(
    (row) =>
      row.createdBy === createdBy &&
      row.kind === "personal" &&
      row.deletedAt === null,
  );
  if (alreadyExists) {
    return Promise.resolve({ rows: [] });
  }
  rows.push({
    id,
    kind: "personal",
    name,
    createdBy,
    createdAt,
    deletedAt: null,
  });
  return Promise.resolve({ rows: [{ id }] });
}

const fakeDb = {
  select: (fields?: Record<string, unknown>) => makeSelectChain(fields ?? null),
  execute: (query: unknown) => fakeExecute(query),
};

seedModule("@/lib/db", { db: fakeDb });

const workspacesModule = nodeRequire("@/lib/db/workspaces") as typeof import(
  "@/lib/db/workspaces"
);
const { getOrCreatePersonalWorkspace, assertWorkspaceOwnership, WorkspaceAccessDeniedError } =
  workspacesModule;

function resetStore() {
  rows = [];
  executeCallCount = 0;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("creates exactly one personal workspace and is idempotent on repeat calls", async () => {
  resetStore();
  const first = await getOrCreatePersonalWorkspace("user-1");
  assert.equal(typeof first, "string");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.createdBy, "user-1");
  assert.equal(rows[0]?.kind, "personal");
  assert.equal(rows[0]?.deletedAt, null);

  const callsBeforeSecond = executeCallCount;
  const second = await getOrCreatePersonalWorkspace("user-1");
  assert.equal(second, first, "repeat call must return the SAME workspace id");
  assert.equal(rows.length, 1, "repeat call must not insert a second row");
  // The idempotent path is satisfied entirely by the read (findPersonalWorkspaceId);
  // it must not even attempt the insert statement.
  assert.equal(
    executeCallCount,
    callsBeforeSecond,
    "an existing workspace must short-circuit before the insert statement runs",
  );
});

test("two different users get two different workspaces", async () => {
  resetStore();
  const a = await getOrCreatePersonalWorkspace("user-a");
  const b = await getOrCreatePersonalWorkspace("user-b");
  assert.notEqual(a, b);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.createdBy).sort(),
    ["user-a", "user-b"],
  );
});

test("simultaneous first-time calls for the same user converge on one workspace", async () => {
  resetStore();
  // The fake store's insert-if-not-exists check runs synchronously to
  // completion inside one microtask (mirroring how a single real Postgres
  // statement is atomic with respect to itself), so `Promise.all` here
  // proves the single-statement approach is race-free UNDER THAT MODEL. It
  // does not — and cannot — stand in for the real multi-connection MVCC race
  // proven separately against a live Postgres instance; see this file's
  // header comment and `lib/db/workspaces.ts`'s doc comment.
  const [a, b, c] = await Promise.all([
    getOrCreatePersonalWorkspace("user-race"),
    getOrCreatePersonalWorkspace("user-race"),
    getOrCreatePersonalWorkspace("user-race"),
  ]);
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(
    rows.filter((r) => r.createdBy === "user-race").length,
    1,
  );
});

test("a soft-deleted personal workspace does not satisfy idempotency and a fresh one is created", async () => {
  resetStore();
  const first = await getOrCreatePersonalWorkspace("user-1");
  const row = rows.find((r) => r.id === first);
  assert.ok(row);
  row.deletedAt = new Date().toISOString();

  const second = await getOrCreatePersonalWorkspace("user-1");
  assert.notEqual(second, first);
  assert.equal(
    rows.filter((r) => r.createdBy === "user-1" && r.deletedAt === null).length,
    1,
  );
});

test("assertWorkspaceOwnership resolves for the owning user", async () => {
  resetStore();
  const id = await getOrCreatePersonalWorkspace("user-1");
  await assert.doesNotReject(() => assertWorkspaceOwnership("user-1", id));
});

test("assertWorkspaceOwnership REJECTS a workspace id belonging to another user", async () => {
  resetStore();
  const ownerId = await getOrCreatePersonalWorkspace("owner");
  await assert.rejects(
    () => assertWorkspaceOwnership("attacker", ownerId),
    WorkspaceAccessDeniedError,
  );
});

test("assertWorkspaceOwnership REJECTS an id that does not exist at all", async () => {
  resetStore();
  await assert.rejects(
    () => assertWorkspaceOwnership("user-1", "no-such-workspace"),
    WorkspaceAccessDeniedError,
  );
});

test("assertWorkspaceOwnership REJECTS a soft-deleted workspace even for its real owner", async () => {
  resetStore();
  const id = await getOrCreatePersonalWorkspace("user-1");
  const row = rows.find((r) => r.id === id);
  assert.ok(row);
  row.deletedAt = new Date().toISOString();
  await assert.rejects(
    () => assertWorkspaceOwnership("user-1", id),
    WorkspaceAccessDeniedError,
  );
});

test("deterministic ordering: findPersonalWorkspaceId-backed lookups never flip between duplicate rows", async () => {
  resetStore();
  // Construct the acknowledged rare-duplicate state directly (this is what a
  // real, unprevented race would leave behind) and prove reads still
  // converge rather than alternating between the two rows.
  const older = {
    id: "ws-older",
    kind: "personal",
    name: "Personal",
    createdBy: "user-dup",
    createdAt: "2020-01-01T00:00:00.000Z",
    deletedAt: null,
  };
  const newer = {
    id: "ws-newer",
    kind: "personal",
    name: "Personal",
    createdBy: "user-dup",
    createdAt: "2021-01-01T00:00:00.000Z",
    deletedAt: null,
  };
  rows.push(newer, older);
  const first = await getOrCreatePersonalWorkspace("user-dup");
  const second = await getOrCreatePersonalWorkspace("user-dup");
  assert.equal(first, "ws-older");
  assert.equal(second, "ws-older");
});
