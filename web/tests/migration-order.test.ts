/**
 * MIGORDER-001 — static proof that `db/migrations/*.sql`, applied in file
 * order against a FRESH database, never issues a composite (or any) FK
 * before the unique index/constraint it references exists yet.
 *
 * Why this matters and what broke: `0006_typical_turbo.sql` and
 * `0007_silly_madame_masque.sql`, as originally drizzle-kit-generated, each
 * emitted their `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` statements
 * for composite `(id, workspace_id)` references BEFORE the
 * `CREATE UNIQUE INDEX ..._id_workspace_idx` statements those FKs require —
 * Postgres rejects a composite FK unless a unique constraint already exists
 * on exactly the referenced columns. TRIGGER-001 discovered this by hand
 * against a real Postgres instance (see `LESSONS.md` and
 * `tests/README-db-invariants.md`); this file makes the same property
 * checkable WITHOUT a live database, by parsing the migration SQL text
 * itself and replaying its statements in order against a running model of
 * "which (table, column-set) pairs are unique so far."
 *
 * Fix applied here: `0006_typical_turbo.sql` and `0007_silly_madame_masque.sql`
 * were edited IN PLACE to reorder their own statements — every composite FK
 * they add was moved to after the `CREATE INDEX`/`CREATE UNIQUE INDEX`
 * statements in the same file (0007's hand-written trigger/function section
 * was left untouched; only the drizzle-kit-generated section above it was
 * reordered). No statement's TEXT changed in either file — `git diff` on
 * both is a pure block move — and a new `0008_workspaces_created_by_personal
 * _live_unique.sql` was generated on top for the separate WORKSPACE-001
 * follow-up (see `tests/workspaces.test.ts`). In-place editing, not a new
 * trailing migration, was the only viable fix: a migration file numbered
 * after 0006/0007 cannot reach back and reorder statements INSIDE an
 * earlier file that fails before that later file is ever read — the defect
 * is a mis-ordering within a single already-shipped file, not a missing
 * index a later file could supply. The risk this carries: any database that
 * already recorded 0006/0007 as successfully applied would now disagree
 * with drizzle's migration-hash bookkeeping. That risk is believed to be
 * zero in practice, because the bug means those two files could never have
 * finished applying in the first place — `drizzle-kit migrate` (and any
 * transaction-per-file runner) rolls back the whole file on the FK error
 * partway through, so no environment can hold a "successfully applied"
 * record for the old, broken statement order. This was proven for real
 * against a local Postgres 18 instance as part of this task (see the task's
 * commit message for the exact repro/fix transcript); this test is the
 * static, database-free half of that proof, safe to run in CI on every
 * change to `db/migrations/`.
 *
 * This file's own checker is proven to have teeth two ways: (1) an embedded
 * synthetic fixture below, mirroring the exact bug shape, that the checker
 * must reject regardless of what the real files currently look like — a
 * permanent regression guard on the CHECKER LOGIC itself; (2) the real
 * `db/migrations` files are asserted clean, which was manually confirmed to
 * FAIL before this task's fix (temporarily reverting the 0006/0007 reorder
 * and rerunning this file) — see the task's commit message for that
 * transcript, since a one-off manual revert is not something this
 * permanently-committed test file can demonstrate on every run.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const MIGRATIONS_DIR = path.join(__dirname, "..", "db", "migrations");

type ColumnSet = string; // canonical "col_a,col_b" (sorted) key

type Violation = {
  file: string;
  constraintName: string;
  table: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
};

/** Splits one migration file's text into its individual SQL statements,
 *  the same way drizzle-kit's own `--> statement-breakpoint` markers do.
 *  Line endings are normalised first — this repo checks files out as CRLF
 *  (git autocrlf) but a fresh clone on another platform is not guaranteed
 *  to match, and the previous instance of this exact bug (a test that only
 *  passed locally) is documented as a standing lesson for this project. */
function splitStatements(sqlText: string): string[] {
  const normalized = sqlText.replace(/\r\n/g, "\n");
  return normalized
    .split("--> statement-breakpoint\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function canonicalColumns(raw: string): string[] {
  const matches = [...raw.matchAll(/"([a-zA-Z0-9_]+)"/g)];
  return matches.map((m) => m[1]!);
}

function setKey(columns: string[]): ColumnSet {
  return [...columns].sort().join(",");
}

/**
 * Replays a set of migration files, IN THE ORDER GIVEN, statement by
 * statement, tracking which (table, column-set) pairs are backed by a
 * unique constraint/index at each point, and returns every composite (or
 * any) FK statement whose referenced (table, columns) pair is not yet
 * unique when that FK statement runs.
 *
 * Deliberately conservative: only WHERE-less `CREATE UNIQUE INDEX` and
 * `PRIMARY KEY`/`UNIQUE` constraints count as satisfying an FK — a partial
 * unique index (one with a `WHERE` clause, like
 * `workspaces_created_by_personal_live_idx`) is correctly excluded, because
 * Postgres itself refuses to let a FK target a partial unique index. Any
 * statement shape this function does not specifically recognise is simply
 * ignored (not flagged) — this checker only ever reports FK-before-index
 * violations, never invents unrelated failures.
 */
function findOrderingViolations(
  files: { name: string; sql: string }[],
): Violation[] {
  const violations: Violation[] = [];
  // table -> set of canonical column-set keys that are unique as of "now"
  const uniqueSets = new Map<string, Set<ColumnSet>>();

  const registerUnique = (table: string, columns: string[]) => {
    if (columns.length === 0) return;
    if (!uniqueSets.has(table)) uniqueSets.set(table, new Set());
    uniqueSets.get(table)!.add(setKey(columns));
  };

  const isUnique = (table: string, columns: string[]) =>
    uniqueSets.get(table)?.has(setKey(columns)) ?? false;

  for (const file of files) {
    for (const statement of splitStatements(file.sql)) {
      const createTable = /^CREATE TABLE "([a-zA-Z0-9_]+)" \(([\s\S]*)\);?$/.exec(
        statement,
      );
      if (createTable) {
        const [, table, body] = createTable;
        for (const line of body!.split("\n")) {
          const trimmed = line.trim();
          // Table-level composite PRIMARY KEY / UNIQUE constraint.
          const tableLevelPk = /^CONSTRAINT "[^"]+" PRIMARY KEY\(([^)]+)\)/.exec(
            trimmed,
          );
          if (tableLevelPk) {
            registerUnique(table!, canonicalColumns(tableLevelPk[1]!));
            continue;
          }
          const tableLevelUnique = /^CONSTRAINT "[^"]+" UNIQUE\(([^)]+)\)/.exec(
            trimmed,
          );
          if (tableLevelUnique) {
            registerUnique(table!, canonicalColumns(tableLevelUnique[1]!));
            continue;
          }
          // Inline single-column PRIMARY KEY, e.g. `"id" text PRIMARY KEY NOT NULL,`
          const inlinePk = /^"([a-zA-Z0-9_]+)"\s+.*\bPRIMARY KEY\b/.exec(
            trimmed,
          );
          if (inlinePk) {
            registerUnique(table!, [inlinePk[1]!]);
            continue;
          }
          // Inline single-column UNIQUE (no CONSTRAINT wrapper).
          const inlineUnique = /^"([a-zA-Z0-9_]+)"\s+.*\bUNIQUE\b/.exec(
            trimmed,
          );
          if (inlineUnique) {
            registerUnique(table!, [inlineUnique[1]!]);
          }
        }
        continue;
      }

      const createUniqueIndex =
        /^CREATE UNIQUE INDEX "[^"]+" ON "([a-zA-Z0-9_]+)" USING \w+ \(([^)]+)\)([\s\S]*)$/.exec(
          statement,
        );
      if (createUniqueIndex) {
        const [, table, cols, tail] = createUniqueIndex;
        const isPartial = /\bWHERE\b/.test(tail ?? "");
        if (!isPartial) {
          registerUnique(table!, canonicalColumns(cols!));
        }
        continue;
      }

      const alterUnique =
        /^ALTER TABLE "([a-zA-Z0-9_]+)" ADD CONSTRAINT "[^"]+" UNIQUE\(([^)]+)\)/.exec(
          statement,
        );
      if (alterUnique) {
        registerUnique(alterUnique[1]!, canonicalColumns(alterUnique[2]!));
        continue;
      }

      const alterPk =
        /^ALTER TABLE "([a-zA-Z0-9_]+)" ADD CONSTRAINT "[^"]+" PRIMARY KEY\(([^)]+)\)/.exec(
          statement,
        );
      if (alterPk) {
        registerUnique(alterPk[1]!, canonicalColumns(alterPk[2]!));
        continue;
      }

      const alterFk =
        /^ALTER TABLE "([a-zA-Z0-9_]+)" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \(([^)]+)\) REFERENCES "public"\."([a-zA-Z0-9_]+)"\(([^)]+)\)/.exec(
          statement,
        );
      if (alterFk) {
        const [, table, constraintName, cols, refTable, refCols] = alterFk;
        const columns = canonicalColumns(cols!);
        const refColumns = canonicalColumns(refCols!);
        if (!isUnique(refTable!, refColumns)) {
          violations.push({
            file: file.name,
            constraintName: constraintName!,
            table: table!,
            columns,
            refTable: refTable!,
            refColumns,
          });
        }
        continue;
      }

      // Everything else (CREATE TYPE, CREATE INDEX (non-unique), ALTER
      // TABLE ADD COLUMN, DROP CONSTRAINT, CREATE FUNCTION/TRIGGER, ...) is
      // irrelevant to FK/unique-index ordering and is ignored.
    }
  }

  return violations;
}

function loadRealMigrationFiles(): { name: string; sql: string }[] {
  const names = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  assert.ok(
    names.length > 0,
    `expected at least one migration file in ${MIGRATIONS_DIR}`,
  );
  return names.map((name) => ({
    name,
    sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"),
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("db/migrations, applied in file order, never issues a composite FK before its unique index/constraint exists", () => {
  const violations = findOrderingViolations(loadRealMigrationFiles());
  assert.deepEqual(
    violations,
    [],
    `found FK(s) issued before their referenced unique index/constraint:\n${JSON.stringify(violations, null, 2)}`,
  );
});

test("the checker rejects a synthetic fixture that reproduces the exact 0006/0007 bug shape (FK before its unique index, in one file)", () => {
  const broken: { name: string; sql: string }[] = [
    {
      name: "0000_fixture_base.sql",
      sql: [
        'CREATE TABLE "parent" (',
        '\t"id" text PRIMARY KEY NOT NULL,',
        '\t"workspace_id" text NOT NULL',
        ');',
      ].join("\n"),
    },
    {
      name: "0001_fixture_broken.sql",
      sql: [
        'CREATE TABLE "child" (',
        '\t"id" text PRIMARY KEY NOT NULL,',
        '\t"parent_id" text NOT NULL,',
        '\t"workspace_id" text NOT NULL',
        ');--> statement-breakpoint',
        // FK before its composite unique index — the exact 0006/0007 shape.
        'ALTER TABLE "child" ADD CONSTRAINT "child_parent_workspace_fk" FOREIGN KEY ("parent_id","workspace_id") REFERENCES "public"."parent"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint',
        'CREATE UNIQUE INDEX "parent_id_workspace_idx" ON "parent" USING btree ("id","workspace_id");',
      ].join("\n"),
    },
  ];

  const violations = findOrderingViolations(broken);
  assert.equal(violations.length, 1, "expected exactly one ordering violation");
  assert.equal(violations[0]!.file, "0001_fixture_broken.sql");
  assert.equal(violations[0]!.constraintName, "child_parent_workspace_fk");
  assert.deepEqual(violations[0]!.refColumns.sort(), ["id", "workspace_id"]);
});

test("the checker accepts the same fixture once the unique index is moved before the FK", () => {
  const fixed: { name: string; sql: string }[] = [
    {
      name: "0000_fixture_base.sql",
      sql: [
        'CREATE TABLE "parent" (',
        '\t"id" text PRIMARY KEY NOT NULL,',
        '\t"workspace_id" text NOT NULL',
        ');',
      ].join("\n"),
    },
    {
      name: "0001_fixture_fixed.sql",
      sql: [
        'CREATE TABLE "child" (',
        '\t"id" text PRIMARY KEY NOT NULL,',
        '\t"parent_id" text NOT NULL,',
        '\t"workspace_id" text NOT NULL',
        ');--> statement-breakpoint',
        'CREATE UNIQUE INDEX "parent_id_workspace_idx" ON "parent" USING btree ("id","workspace_id");--> statement-breakpoint',
        'ALTER TABLE "child" ADD CONSTRAINT "child_parent_workspace_fk" FOREIGN KEY ("parent_id","workspace_id") REFERENCES "public"."parent"("id","workspace_id") ON DELETE cascade ON UPDATE no action;',
      ].join("\n"),
    },
  ];

  assert.deepEqual(findOrderingViolations(fixed), []);
});

test("the checker does not treat a PARTIAL unique index as satisfying an FK (Postgres would reject that too)", () => {
  const brokenViaPartialIndex: { name: string; sql: string }[] = [
    {
      name: "0000_fixture_base.sql",
      sql: [
        'CREATE TABLE "parent" (',
        '\t"id" text PRIMARY KEY NOT NULL,',
        '\t"workspace_id" text NOT NULL,',
        '\t"kind" text NOT NULL',
        ');--> statement-breakpoint',
        // Only a PARTIAL unique index exists on (id, workspace_id) — this
        // must NOT be treated as satisfying a full FK reference, exactly as
        // workspaces_created_by_personal_live_idx must not be able to.
        'CREATE UNIQUE INDEX "parent_id_workspace_idx" ON "parent" USING btree ("id","workspace_id") WHERE "parent"."kind" = \'live\';',
      ].join("\n"),
    },
    {
      name: "0001_fixture_child.sql",
      sql: [
        'CREATE TABLE "child" (',
        '\t"id" text PRIMARY KEY NOT NULL,',
        '\t"parent_id" text NOT NULL,',
        '\t"workspace_id" text NOT NULL',
        ');--> statement-breakpoint',
        'ALTER TABLE "child" ADD CONSTRAINT "child_parent_workspace_fk" FOREIGN KEY ("parent_id","workspace_id") REFERENCES "public"."parent"("id","workspace_id") ON DELETE cascade ON UPDATE no action;',
      ].join("\n"),
    },
  ];

  const violations = findOrderingViolations(brokenViaPartialIndex);
  assert.equal(
    violations.length,
    1,
    "a partial unique index must not satisfy a composite FK",
  );
});

test("CRLF line endings (this repo's checked-out form) parse identically to LF", () => {
  const lfFiles: { name: string; sql: string }[] = [
    {
      name: "0000_fixture_base.sql",
      sql: [
        'CREATE TABLE "parent" (',
        '\t"id" text PRIMARY KEY NOT NULL,',
        '\t"workspace_id" text NOT NULL',
        ');',
      ].join("\n"),
    },
    {
      name: "0001_fixture_broken.sql",
      sql: [
        'CREATE TABLE "child" (',
        '\t"id" text PRIMARY KEY NOT NULL,',
        '\t"parent_id" text NOT NULL,',
        '\t"workspace_id" text NOT NULL',
        ');--> statement-breakpoint',
        'ALTER TABLE "child" ADD CONSTRAINT "child_parent_workspace_fk" FOREIGN KEY ("parent_id","workspace_id") REFERENCES "public"."parent"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint',
        'CREATE UNIQUE INDEX "parent_id_workspace_idx" ON "parent" USING btree ("id","workspace_id");',
      ].join("\n"),
    },
  ];
  const crlfFiles = lfFiles.map((f) => ({
    name: f.name,
    sql: f.sql.replace(/\n/g, "\r\n"),
  }));

  const lfViolations = findOrderingViolations(lfFiles);
  const crlfViolations = findOrderingViolations(crlfFiles);
  assert.equal(lfViolations.length, 1);
  assert.deepEqual(crlfViolations, lfViolations);
});
