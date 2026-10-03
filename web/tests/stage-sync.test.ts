/**
 * SYNCSTAGES-001 — tests for the shared stage loader/validator
 * (`lib/content/stageSeed.ts`) and the stage upsert builder
 * (`lib/db/stages.ts`) that both `db/seed.ts` and `scripts/sync-stages.mts`
 * write through.
 *
 * Same split as `tests/source-registry-sync.test.ts`: validation and row
 * mapping are pure, so they get real unit tests. The write itself needs a live
 * Postgres, which this environment does not have (one instance, production),
 * so `buildStageUpserts` is checked by rendering its statements with
 * `.toSQL()` on a drizzle client built against a dummy URL. The neon-http
 * driver is network-lazy (see `lib/db/index.ts`), and `.toSQL()` only renders
 * SQL text, so no connection is opened and `DATABASE_URL` is never read.
 *
 * Author: Kenneth Hill
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "@/db/schema";
import {
  STAGE_SEED_PATH,
  stageInsertValues,
  stageUpsertSet,
  validateStageSeed,
  type SeedStage,
} from "@/lib/content/stageSeed";
import { buildStageUpserts, upsertStageRows } from "@/lib/db/stages";

function realStages(): SeedStage[] {
  return JSON.parse(readFileSync(STAGE_SEED_PATH, "utf8")) as SeedStage[];
}

function errorsOf(raw: unknown): string[] {
  const result = validateStageSeed(raw);
  assert.equal(result.ok, false, "expected the stage list to be rejected");
  return result.ok ? [] : result.errors;
}

// ===========================================================================
// validateStageSeed — the shared gate
// ===========================================================================

test("STAGE-SYNC: the real content/lens/eleven-stages.json passes, with 11 stages numbered 1-11", () => {
  const result = validateStageSeed(realStages());
  assert.equal(result.ok, true, result.ok ? "" : result.errors.join("\n"));
  if (!result.ok) return;
  assert.equal(result.stages.length, 11);
  assert.deepEqual(
    result.stages.map((stage) => stage.stage).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  );
});

test("STAGE-SYNC: a 10-stage list is rejected with the stage count", () => {
  // Drop the peak (mirror null) so every remaining mirror pair stays intact
  // and the ONLY problem is the count.
  const ten = realStages().filter((stage) => stage.mirror !== null);
  assert.equal(ten.length, 10);
  assert.deepEqual(errorsOf(ten), ["Expected 11 mountain stages, found 10"]);
});

test("STAGE-SYNC: a non-reciprocal mirror pairing is rejected", () => {
  const stages = realStages();
  const a = stages.find((stage) => stage.stage === 1);
  const b = stages.find((stage) => stage.stage === 2);
  assert.ok(a && b && a.mirror && b.mirror);
  // Point stage 1 at stage 2's mirror target: that stage mirrors stage 2, not
  // stage 1, so the pairing is no longer reciprocal (and stage 1's real
  // partner now mirrors a stage that no longer mirrors it back).
  const brokenFrom = a.slug;
  a.mirror = b.mirror;
  const errors = errorsOf(stages);
  assert.ok(
    errors.includes(`Stage ${brokenFrom} mirror is not reciprocal`),
    `expected a reciprocity error, got:\n${errors.join("\n")}`,
  );
});

test("STAGE-SYNC: a mirror naming a stage that does not exist is rejected", () => {
  const stages = realStages();
  const first = stages[0];
  assert.ok(first);
  first.mirror = "no-such-stage";
  const errors = errorsOf(stages);
  assert.ok(errors.includes(`Stage ${first.slug} has unknown mirror no-such-stage`), errors.join("\n"));
});

test("STAGE-SYNC: duplicate stage numbers are rejected", () => {
  const stages = realStages();
  const [first, second] = stages;
  assert.ok(first && second);
  second.stage = first.stage;
  const errors = errorsOf(stages);
  assert.ok(errors.includes(`Duplicate or invalid stage number: ${first.stage}`), errors.join("\n"));
});

test("STAGE-SYNC: schema violations (extra key, bad side) are rejected before the preflight rules", () => {
  const stages = realStages() as unknown as Record<string, unknown>[];
  stages[0] = { ...stages[0], extra: true };
  stages[1] = { ...stages[1], side: "sideways" };
  const errors = errorsOf(stages);
  assert.ok(errors.some((error) => error.startsWith("0:")), errors.join("\n"));
  assert.ok(errors.some((error) => error.startsWith("1.side:")), errors.join("\n"));
});

// ===========================================================================
// Row mapping — exactly the columns db:seed's stageUpsert set
// ===========================================================================

test("STAGE-SYNC: the insert row carries every stages column and the conflict set is every column except slug", () => {
  const [stage] = realStages();
  assert.ok(stage);
  assert.deepEqual(Object.keys(stageInsertValues(stage)).sort(), [
    "chapters", "mirror", "side", "slug", "stage", "summary", "title",
  ]);
  assert.deepEqual(Object.keys(stageUpsertSet(stage)).sort(), [
    "chapters", "mirror", "side", "stage", "summary", "title",
  ]);
  assert.deepEqual(stageUpsertSet(stage), {
    title: stage.title,
    stage: stage.stage,
    side: stage.side,
    mirror: stage.mirror,
    chapters: stage.chapters,
    summary: stage.summary,
  });
});

test("STAGE-SYNC: buildStageUpserts renders one ON CONFLICT (slug) DO UPDATE per stage, touching only stages", () => {
  const db = drizzle("postgresql://offline:offline@127.0.0.1:5432/offline", { schema });
  const result = validateStageSeed(realStages());
  assert.ok(result.ok);
  if (!result.ok) return;
  const [first, ...rest] = result.stages;
  assert.ok(first);
  const statements = buildStageUpserts(db, [first, ...rest]);
  assert.equal(statements.length, 11);
  statements.forEach((statement, index) => {
    const { sql, params } = (statement as unknown as { toSQL(): { sql: string; params: unknown[] } }).toSQL();
    assert.match(sql, /^insert into "stages" \("slug", "title", "stage", "side", "mirror", "chapters", "summary"\) values /);
    assert.match(
      sql,
      /on conflict \("slug"\) do update set "title" = \$\d+, "stage" = \$\d+, "side" = \$\d+, "mirror" = \$\d+, "chapters" = \$\d+, "summary" = \$\d+$/,
    );
    assert.doesNotMatch(sql, /"(threads|people|entries|entry_threads|users)"/);
    // Input order is preserved: statement i writes stage i.
    assert.equal(params[0], result.stages[index]?.slug);
  });
});

test("STAGE-SYNC: upsertStageRows sends every stage in exactly ONE db.batch (atomic, never partial)", async () => {
  const db = drizzle("postgresql://offline:offline@127.0.0.1:5432/offline", { schema });
  const calls: unknown[][] = [];
  // Replace the network call with a spy; statement building stays real.
  (db as unknown as { batch: (statements: unknown[]) => Promise<unknown[]> }).batch = async (statements) => {
    calls.push(statements);
    return [];
  };
  const result = validateStageSeed(realStages());
  assert.ok(result.ok);
  if (!result.ok) return;
  const [first, ...rest] = result.stages;
  assert.ok(first);
  await upsertStageRows(db, [first, ...rest]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.length, 11);
});

test("SHAPE: upsertStageRows is an exported async function taking (db, rows)", () => {
  assert.equal(typeof upsertStageRows, "function");
  assert.equal(upsertStageRows.length, 2);
  assert.equal(upsertStageRows.constructor.name, "AsyncFunction");
});
