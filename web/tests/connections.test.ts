/**
 * CURATEDEDGES-002 — tests for the authored-connection pipeline:
 * `scripts/content/connectionSchema.ts` (C1 schema + set checks),
 * `scripts/content/validate.ts`'s `loadConnections`/`runValidation` wiring,
 * `scripts/content/build.ts`'s `requiredConnectionIds` / error surfacing, and
 * `lib/db/graphEdges.ts`'s `upsertConnectionRows` / `findMissingConnectionIds`.
 *
 * No Postgres anywhere (this repo has exactly one, production): DB functions
 * run against tiny in-memory fakes that CAPTURE what the real drizzle builder
 * is handed (insert values, conflict target/set, WHERE clause rendered to SQL
 * by drizzle's own PgDialect) — so a mutation to those pieces changes what is
 * captured. All filesystem fixtures are synthetic files under a tmp dir; the
 * real `content/connections/` directory is never read.
 *
 * Author: Kenneth Hill
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { graphEdges } from "@/db/schema";
import { CANONICAL_VERSIFICATION_ID } from "@/lib/contracts/range-v1";
import { CONNECTION_TYPES, EVIDENCE_LABELS } from "@/lib/contracts/study-v2";
import { findMissingConnectionIds, upsertConnectionRows, type ConnectionRow } from "@/lib/db/graphEdges";

import {
  ConnectionFileSchema,
  parseConnectionFile,
  unresolvedLessonConnectionIds,
  validateConnectionSet,
} from "../scripts/content/connectionSchema";
import {
  buildReleaseFromValidation,
  compileReleaseBundle,
  requiredConnectionIds,
} from "../scripts/content/build";
import { runValidation, loadConnections } from "../scripts/content/validate";

// ---------------------------------------------------------------------------
// Fixtures (synthetic)
// ---------------------------------------------------------------------------

function goodConnection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "conn-test-1",
    fromRange: { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.1", end: "1.3.24" },
    toRange: { versificationId: CANONICAL_VERSIFICATION_ID, start: "45.5.12", end: "45.5.21" },
    type: "type_antitype",
    evidenceLabel: "explicit",
    rationale: "Synthetic fixture rationale saying why this type at this strength.",
    sourceId: "source-test",
    viewpointId: null,
    ...overrides,
  };
}

const REGISTRY = new Set(["source-test"]);

function file(name: string, value: unknown) {
  return { filePath: name, parsed: { ok: true as const, value } };
}

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "connections-test-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const LESSON_SOURCE = (connectionIds: string[]) => `---
passage:
  start: "1.3.1"
  end: "1.3.24"
stage: 3
methodFocus: Test
${connectionIds.length > 0 ? `connectionIds:\n${connectionIds.map((id) => `  - ${id}`).join("\n")}\n` : ""}author: Kenneth Hill
status: draft
---

## Teach-Back Prompts

Explain it blind.
`;

// ===========================================================================
// Schema
// ===========================================================================

test("SCHEMA: the C1 example parses; viewpointId null is kept", () => {
  const result = parseConnectionFile(goodConnection());
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.connection.viewpointId, null);
});

test("SCHEMA: viewpointId may be omitted (defaults to null); a string viewpointId is kept", () => {
  const omitted = goodConnection();
  delete omitted.viewpointId;
  const r1 = parseConnectionFile(omitted);
  assert.ok(r1.ok && r1.connection.viewpointId === null);
  const r2 = parseConnectionFile(goodConnection({ viewpointId: "viewpoint-reformed" }));
  assert.ok(r2.ok && r2.connection.viewpointId === "viewpoint-reformed");
});

test("SCHEMA: every CONNECTION_TYPES value except personal_resonance and every EVIDENCE_LABELS value is accepted", () => {
  for (const type of CONNECTION_TYPES.filter((t) => t !== "personal_resonance")) {
    assert.equal(parseConnectionFile(goodConnection({ type })).ok, true, type);
  }
  for (const evidenceLabel of EVIDENCE_LABELS) {
    assert.equal(parseConnectionFile(goodConnection({ evidenceLabel })).ok, true, evidenceLabel);
  }
});

test("SCHEMA: rejects an unknown type", () => {
  const r = parseConnectionFile(goodConnection({ type: "vibes" }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.startsWith("type:")), r.errors.join("|"));
});

test("SCHEMA: rejects an unknown evidence label", () => {
  const r = parseConnectionFile(goodConnection({ evidenceLabel: "certain" }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.startsWith("evidenceLabel:")));
});

test("SCHEMA: rejects personal_resonance (personal overlays never live in graph_edges)", () => {
  const r = parseConnectionFile(goodConnection({ type: "personal_resonance", evidenceLabel: "devotional" }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.includes("personal_resonance")));
});

test("SCHEMA: rejects an empty or whitespace-only rationale", () => {
  for (const rationale of ["", "   \n "]) {
    const r = parseConnectionFile(goodConnection({ rationale }));
    assert.equal(r.ok, false, JSON.stringify(rationale));
    if (!r.ok) assert.ok(r.errors.some((e) => e.startsWith("rationale:")));
  }
});

test("SCHEMA: rejects verdict language in the rationale (all four VERDICT_PATTERNS phrases, case-insensitive)", () => {
  for (const phrase of ["This passage teaches that", "the correct view is", "This proves", "THIS MEANS"]) {
    const r = parseConnectionFile(goodConnection({ rationale: `Adam is a type. ${phrase} Christ is the second Adam.` }));
    assert.equal(r.ok, false, phrase);
    if (!r.ok) assert.ok(r.errors.some((e) => e.includes("doctrinal verdict")), phrase);
  }
});

test("SCHEMA: rejects a malformed / reversed / cross-book range via the reused CanonicalRangeV1Schema", () => {
  assert.equal(parseConnectionFile(goodConnection({ fromRange: { start: "1.3", end: "1.3.24" } })).ok, false);
  assert.equal(parseConnectionFile(goodConnection({ fromRange: { start: "1.3.24", end: "1.3.1" } })).ok, false);
  assert.equal(parseConnectionFile(goodConnection({ toRange: { start: "45.5.12", end: "46.1.1" } })).ok, false);
  assert.equal(
    parseConnectionFile(goodConnection({ toRange: { versificationId: "some-other-versification", start: "45.5.12", end: "45.5.21" } })).ok,
    false,
  );
});

test("SCHEMA: strict -- an unknown key and a missing required key are both errors; an array file is rejected", () => {
  assert.equal(parseConnectionFile(goodConnection({ extra: 1 })).ok, false);
  const missing = goodConnection();
  delete missing.sourceId;
  assert.equal(parseConnectionFile(missing).ok, false);
  const arr = parseConnectionFile([goodConnection()]);
  assert.equal(arr.ok, false);
  if (!arr.ok) assert.ok(arr.errors[0].includes("not an array"));
  assert.ok(ConnectionFileSchema);
});

// ===========================================================================
// Set-level rules
// ===========================================================================

test("SET: zero files is a valid, empty result (content/connections/ may not exist yet)", () => {
  const r = validateConnectionSet([], REGISTRY);
  assert.deepEqual([r.ok, r.connections, r.errors], [true, [], []]);
});

test("SET: rejects a sourceId absent from the source registry, naming the file", () => {
  const r = validateConnectionSet([file("a.json", goodConnection({ sourceId: "source-nope" }))], REGISTRY);
  assert.equal(r.ok, false);
  assert.ok(r.errors[0].startsWith("a.json:") && r.errors[0].includes("source-nope"));
  assert.deepEqual(r.connections, []);
});

test("SET: rejects duplicate ids across files (the second file is reported, the first is kept)", () => {
  const r = validateConnectionSet(
    [file("a.json", goodConnection()), file("b.json", goodConnection({ toRange: { start: "45.5.14", end: "45.5.14" } }))],
    REGISTRY,
  );
  assert.equal(r.ok, false);
  assert.equal(r.connections.length, 1);
  assert.ok(r.errors.some((e) => e.startsWith("b.json:") && e.includes("duplicate connection id") && e.includes("a.json")));
});

test("SET: invalid JSON is reported with its file, not thrown", () => {
  const r = validateConnectionSet([{ filePath: "broken.json", parsed: { ok: false, error: "Unexpected token" } }], REGISTRY);
  assert.equal(r.ok, false);
  assert.ok(r.errors[0].startsWith("broken.json: invalid JSON"));
});

test("LESSON-IDS: a lesson connectionIds[] entry that names no connection is reported per (lesson, id); known ids pass", () => {
  const errors = unresolvedLessonConnectionIds(
    [
      { slug: "genesis/03", connectionIds: ["conn-a", "conn-missing"] },
      { slug: "genesis/04", connectionIds: [] },
    ],
    new Set(["conn-a"]),
  );
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("genesis/03") && errors[0].includes("conn-missing"));
});

// ===========================================================================
// Real IO: loadConnections / runValidation against synthetic tmp dirs
// ===========================================================================

test("IO: loadConnections over a directory that does not exist yields zero rows, ok", () => {
  withTempDir((dir) => {
    const r = loadConnections(path.join(dir, "connections"), REGISTRY);
    assert.deepEqual([r.ok, r.connections.length], [true, 0]);
  });
});

test("IO: runValidation reads connections + registry, and a lesson naming a real connection passes", () => {
  withTempDir((dir) => {
    mkdirSync(path.join(dir, "curriculum"));
    mkdirSync(path.join(dir, "connections"));
    writeFileSync(path.join(dir, "curriculum", "l.md"), LESSON_SOURCE(["conn-test-1"]));
    writeFileSync(path.join(dir, "connections", "one.json"), JSON.stringify(goodConnection()));
    writeFileSync(path.join(dir, "source-registry.json"), JSON.stringify([{ id: "source-test" }]));
    const r = runValidation(path.join(dir, "curriculum"));
    assert.deepEqual(r.connectionErrors, []);
    assert.equal(r.connections?.length, 1);
    assert.equal(r.ok, true, JSON.stringify(r.results.map((x) => x.errors)));
  });
});

test("IO: runValidation fails (ok=false, connectionErrors set) when a lesson connectionIds[] names no connection file", () => {
  withTempDir((dir) => {
    mkdirSync(path.join(dir, "curriculum"));
    writeFileSync(path.join(dir, "curriculum", "l.md"), LESSON_SOURCE(["conn-ghost"]));
    const r = runValidation(path.join(dir, "curriculum"));
    assert.equal(r.results.every((x) => x.ok), true, "the lesson itself is fine");
    assert.equal(r.ok, false);
    assert.ok(r.connectionErrors?.some((e) => e.includes("conn-ghost")));
  });
});

test("IO: runValidation fails on a bad connection file even with no lessons referencing it (source not in registry)", () => {
  withTempDir((dir) => {
    mkdirSync(path.join(dir, "curriculum"));
    mkdirSync(path.join(dir, "connections"));
    writeFileSync(path.join(dir, "connections", "one.json"), JSON.stringify(goodConnection()));
    writeFileSync(path.join(dir, "source-registry.json"), JSON.stringify([{ id: "source-other" }]));
    const r = runValidation(path.join(dir, "curriculum"));
    assert.equal(r.ok, false);
    assert.ok(r.connectionErrors?.some((e) => e.includes("source-test") && e.includes("one.json")));
  });
});

test("IO: no connections dir and no lesson connectionIds -- runValidation is unaffected (existing behavior preserved)", () => {
  withTempDir((dir) => {
    mkdirSync(path.join(dir, "curriculum"));
    writeFileSync(path.join(dir, "curriculum", "l.md"), LESSON_SOURCE([]));
    const r = runValidation(path.join(dir, "curriculum"));
    assert.equal(r.ok, true);
    assert.deepEqual(r.connectionErrors, []);
  });
});

// ===========================================================================
// build.ts
// ===========================================================================

test("BUILD: requiredConnectionIds is the deduped, sorted union of every lesson's connectionIds[]", () => {
  const fm = (connectionIds: string[]) => ({
    passage: { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.1", end: "1.3.24" },
    stage: 3,
    methodFocus: "x",
    connectionIds,
    placeIds: [],
    positionIds: [],
    sources: [],
    author: "Kenneth Hill",
    status: "published" as const,
  });
  const bundle = compileReleaseBundle([
    { slug: "a", frontmatter: fm(["conn-b", "conn-a"]), body: "x" },
    { slug: "b", frontmatter: fm(["conn-a", "conn-c"]), body: "x" },
  ]);
  assert.deepEqual(requiredConnectionIds(bundle), ["conn-a", "conn-b", "conn-c"]);
});

test("BUILD: buildReleaseFromValidation refuses a release when connectionErrors is non-empty, surfacing each", () => {
  const r = buildReleaseFromValidation("/c", { ok: false, results: [], connectionErrors: ["lesson x: connectionIds[] \"conn-ghost\" names no file"] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.startsWith("connections:") && e.includes("conn-ghost")));
});

// ===========================================================================
// lib/db/graphEdges.ts — fakes capture what the real drizzle builder is handed
// ===========================================================================

const ROW: ConnectionRow = {
  id: "conn-test-1",
  fromRange: { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.1", end: "1.3.24" },
  toRange: { versificationId: CANONICAL_VERSIFICATION_ID, start: "45.5.12", end: "45.5.21" },
  type: "type_antitype",
  evidenceLabel: "explicit",
  rationale: "Synthetic rationale.",
  sourceId: "source-test",
  viewpointId: null,
};

function fakeUpsertDb() {
  const calls: { table: unknown; values: unknown[]; config: { target: unknown; set: Record<string, unknown> } }[] = [];
  const db = {
    insert: (table: unknown) => ({
      values: (values: unknown[]) => ({
        onConflictDoUpdate: (config: { target: unknown; set: Record<string, unknown> }) => {
          calls.push({ table, values, config });
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db, calls };
}

const dialect = new PgDialect();
const render = (chunk: SQL) => dialect.sqlToQuery(chunk);

test("DB: upsertConnectionRows writes review_status 'reviewed', community_votes 0, the rationale, keyed on id with excluded.* set", async () => {
  const { db, calls } = fakeUpsertDb();
  await upsertConnectionRows(db as never, [ROW]);
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.table, graphEdges);
  assert.equal(call.config.target, graphEdges.id);
  assert.deepEqual(call.values, [
    {
      id: "conn-test-1",
      fromRange: ROW.fromRange,
      toRange: ROW.toRange,
      type: "type_antitype",
      evidenceLabel: "explicit",
      sourceId: "source-test",
      communityVotes: 0,
      rationale: "Synthetic rationale.",
      viewpointId: null,
      reviewStatus: "reviewed",
    },
  ]);
  // Every mutable authored field is refreshed on conflict from `excluded.*`; votes/created_at are not.
  assert.deepEqual(Object.keys(call.config.set).sort(), [
    "evidenceLabel", "fromRange", "rationale", "reviewStatus", "sourceId", "toRange", "type", "viewpointId",
  ]);
  assert.equal(render(call.config.set.rationale as SQL).sql, "excluded.rationale");
  assert.equal(render(call.config.set.reviewStatus as SQL).sql, "excluded.review_status");
});

test("DB: upsertConnectionRows chunks (chunkSize 1 over 2 rows -> 2 statements) and skips an empty list", async () => {
  const two = fakeUpsertDb();
  await upsertConnectionRows(two.db as never, [ROW, { ...ROW, id: "conn-test-2" }], 1);
  assert.equal(two.calls.length, 2);
  const none = fakeUpsertDb();
  await upsertConnectionRows(none.db as never, []);
  assert.equal(none.calls.length, 0);
});

function fakeSelectDb(returned: { id: string }[]) {
  const captured: { where?: SQL } = {};
  const db = {
    select: () => ({
      from: () => ({
        where: (clause: SQL) => {
          captured.where = clause;
          return Promise.resolve(returned);
        },
      }),
    }),
  };
  return { db, captured };
}

test("DB: findMissingConnectionIds requires the row to be REVIEWED -- the WHERE clause filters on review_status = 'reviewed'", async () => {
  const { db, captured } = fakeSelectDb([{ id: "conn-a" }]);
  const missing = await findMissingConnectionIds(db as never, ["conn-b", "conn-a", "conn-b"]);
  assert.deepEqual(missing, ["conn-b"]);
  assert.ok(captured.where);
  const q = render(captured.where as SQL);
  assert.match(q.sql, /"graph_edges"\."id" in/);
  assert.match(q.sql, /"graph_edges"\."review_status" = /);
  assert.ok(q.params.includes("reviewed"), `params: ${JSON.stringify(q.params)}`);
});

test("DB: findMissingConnectionIds([]) returns [] without querying", async () => {
  const db = {
    select: () => {
      throw new Error("must not query");
    },
  };
  assert.deepEqual(await findMissingConnectionIds(db as never, []), []);
});

test("DB: findMissingConnectionIds propagates a query failure (e.g. migration 0013 missing) -- the build gate must fail loud, never 'nothing missing'", async () => {
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.reject(new Error('column "review_status" does not exist')) }) }),
  };
  await assert.rejects(() => findMissingConnectionIds(db as never, ["conn-a"]), /review_status/);
});

test("SHAPE: upsertConnectionRows (db, rows) and findMissingConnectionIds (db, ids) are exported async functions", () => {
  assert.equal(upsertConnectionRows.length, 2);
  assert.equal(upsertConnectionRows.constructor.name, "AsyncFunction");
  assert.equal(findMissingConnectionIds.length, 2);
  assert.equal(findMissingConnectionIds.constructor.name, "AsyncFunction");
});
