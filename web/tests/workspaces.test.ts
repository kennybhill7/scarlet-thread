/**
 * WORKSPACE-001 — the missing link between an authenticated session and any
 * v2 row: resolving a user id to their personal workspace, and refusing to
 * let a caller use a workspace id that is not theirs.
 *
 * MIGORDER-001 update: `getOrCreatePersonalWorkspace` now issues a real
 * `db.insert(workspaces).values(...).onConflictDoNothing({ target, where })`
 * against `workspaces_created_by_personal_live_idx` (the partial unique
 * index MIGORDER-001 added — see `db/schema.ts` and
 * `db/migrations/0008_workspaces_created_by_personal_live_unique.sql`)
 * instead of WORKSPACE-001's original `INSERT ... WHERE NOT EXISTS`, which
 * had no unique constraint to target and could not fully close the race
 * (see git history for that prior shape and `lib/db/workspaces.ts`'s own
 * doc comment for the current one).
 *
 * No live database is used (matching the in-memory harness pattern
 * `tests/tenant-isolation.test.ts` established: real query builders, a
 * recording/evaluating fake store, nothing under `lib/` stubbed). `@/lib/db`
 * is replaced in `require.cache` before `@/lib/db/workspaces` is required, so
 * every predicate below is the ACTUAL drizzle SQL `lib/db/workspaces.ts`
 * compiles — evaluated here via the real `PgDialect`, not reimplemented. The
 * fake insert below recognises ONLY the exact conflict target/predicate
 * `getOrCreatePersonalWorkspace` emits (compiled the same way) and throws on
 * anything else, so a change to the production statement's shape breaks
 * this test loudly rather than passing by accident.
 *
 * What this file does NOT prove on its own: true multi-connection
 * concurrency safety for the real `ON CONFLICT` clause against a live
 * database engine — a fake single-threaded JS store cannot demonstrate the
 * same race a real database's MVCC/index locking can. That was verified
 * separately against a real local Postgres 18 instance as part of
 * MIGORDER-001 (15 genuinely concurrent connections issuing this exact
 * compiled SQL for the same `created_by`: exactly one `RETURNING` a row,
 * the other 14 `INSERT 0 0`) — see the task's queue evidence/commit message.
 * What this file DOES prove is that `getOrCreatePersonalWorkspace` builds
 * that exact statement shape and handles both outcomes (own insert wins;
 * own insert loses and reads back the winner) correctly.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { Column, getTableName, is } from "drizzle-orm";
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
let insertCallCount = 0;

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

/** The exact compiled text of `PERSONAL_LIVE_WORKSPACE` from
 *  `lib/db/workspaces.ts` — the `ON CONFLICT ... WHERE` predicate that must
 *  match `workspaces_created_by_personal_live_idx`'s own predicate for
 *  Postgres to accept it as inference. Captured here (rather than
 *  re-derived) so this test fails loudly if the production predicate ever
 *  drifts from what the migration's index actually indexes. */
const EXPECTED_CONFLICT_WHERE_SQL =
  "\"workspaces\".\"kind\" = 'personal' and \"workspaces\".\"deleted_at\" is null";

/** Recognises ONLY the exact `db.insert(workspaces).values(...)
 *  .onConflictDoNothing({ target: workspaces.createdBy, where:
 *  PERSONAL_LIVE_WORKSPACE }).returning({ id: workspaces.id })` shape
 *  `getOrCreatePersonalWorkspace` emits — both the conflict target column
 *  and the compiled WHERE predicate are checked against the real
 *  `PgDialect` output, not re-implemented. Anything else throws rather than
 *  silently no-opping, so a change to the production statement's shape (or
 *  a drift between the ON CONFLICT predicate and the index it must match)
 *  breaks this test loudly instead of passing by accident. Simulates a
 *  genuine partial-unique-index conflict: an insert is rejected (and
 *  RETURNING comes back empty) exactly when an existing row already has the
 *  same `createdBy` with `kind = 'personal' AND deletedAt IS NULL` — the
 *  same rule `workspaces_created_by_personal_live_idx` enforces for real. */
function fakeInsert(table: unknown) {
  if (getTableName(table as never) !== "workspaces") {
    throw new Error("fake db.insert only models the workspaces table");
  }
  insertCallCount += 1;

  let values: Row | null = null;
  let conflictRecognised = false;
  let returningFields: Record<string, unknown> | null | undefined;

  const execute = (): Record<string, unknown>[] => {
    if (!values) throw new Error("fake insert executed without .values()");
    if (!conflictRecognised) {
      throw new Error(
        "fake insert executed without a recognised .onConflictDoNothing() call",
      );
    }
    const alreadyExists = rows.some(
      (row) =>
        row.createdBy === values!.createdBy &&
        row.kind === "personal" &&
        row.deletedAt === null,
    );
    if (!alreadyExists) {
      rows.push({
        id: values.id,
        kind: values.kind,
        name: values.name,
        createdBy: values.createdBy,
        createdAt: new Date().toISOString(),
        deletedAt: null,
      });
    }
    if (returningFields === undefined) return [];
    if (alreadyExists) return [];
    const written = rows[rows.length - 1]!;
    const out: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(returningFields ?? {})) {
      const colName = (column as { name: string }).name;
      const prop = COLUMN_BY_NAME[colName];
      out[key] = prop ? (written[prop] ?? null) : null;
    }
    return [out];
  };

  const chain: any = {
    values(input: Row) {
      values = input;
      return chain;
    },
    onConflictDoNothing(config: { target: unknown; where: unknown }) {
      if (!is(config.target, Column) || (config.target as Column).name !== "created_by") {
        throw new Error(
          "fake insert only models onConflictDoNothing targeting workspaces.created_by",
        );
      }
      const compiled = compile(config.where);
      if (!compiled || compiled.sql !== EXPECTED_CONFLICT_WHERE_SQL) {
        throw new Error(
          `fake insert does not recognise this onConflict WHERE clause: ${compiled?.sql}`,
        );
      }
      conflictRecognised = true;
      return chain;
    },
    returning(fields?: Record<string, unknown>) {
      returningFields = fields ?? null;
      return chain;
    },
    then(resolve: any, reject: any) {
      return Promise.resolve().then(execute).then(resolve, reject);
    },
  };
  return chain;
}

const fakeDb = {
  select: (fields?: Record<string, unknown>) => makeSelectChain(fields ?? null),
  insert: (table: unknown) => fakeInsert(table),
};

seedModule("@/lib/db", { db: fakeDb });

const workspacesModule = nodeRequire("@/lib/db/workspaces") as typeof import(
  "@/lib/db/workspaces"
);
const { getOrCreatePersonalWorkspace, assertWorkspaceOwnership, WorkspaceAccessDeniedError } =
  workspacesModule;

function resetStore() {
  rows = [];
  insertCallCount = 0;
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

  const callsBeforeSecond = insertCallCount;
  const second = await getOrCreatePersonalWorkspace("user-1");
  assert.equal(second, first, "repeat call must return the SAME workspace id");
  assert.equal(rows.length, 1, "repeat call must not insert a second row");
  // The idempotent path is satisfied entirely by the read (findPersonalWorkspaceId);
  // it must not even attempt the insert statement.
  assert.equal(
    insertCallCount,
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

test("MIGORDER-001: two concurrent first-time calls both reach the real onConflictDoNothing clause, and the loser's conflict fires instead of a duplicate row", async () => {
  resetStore();
  // Unlike the idempotent-repeat-call test above (whose second call
  // short-circuits at `findPersonalWorkspaceId` before ever reaching the
  // insert), both calls here start from an empty store, so BOTH must reach
  // `db.insert(...).onConflictDoNothing(...)` — this is the path that only
  // exists because MIGORDER-001 gave it a real unique-index target to
  // conflict against. `insertCallCount === 2` proves both attempts were
  // made; `rows.length === 1` proves exactly one of those two attempts'
  // conflict clause actually fired rather than both silently succeeding
  // (which is precisely the failure mode `lib/db/workspaces.ts`'s doc
  // comment says the old `INSERT ... WHERE NOT EXISTS` shape could not
  // rule out).
  const [a, b] = await Promise.all([
    getOrCreatePersonalWorkspace("user-conflict"),
    getOrCreatePersonalWorkspace("user-conflict"),
  ]);
  assert.equal(insertCallCount, 2, "both concurrent callers must attempt the insert");
  assert.equal(rows.length, 1, "exactly one insert may win; the other must hit the conflict clause");
  assert.equal(a, b, "both callers must converge on the single winning workspace id");
  assert.equal(rows[0]?.id, a);
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
