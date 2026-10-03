/**
 * SYNCSTAGES-001 — the ONE definition of how `content/lens/eleven-stages.json`
 * (the 11 Mountain stages) is validated and mapped onto the `stages` Postgres
 * table. Shared by both writers of that table:
 *
 *   - `db/seed.ts` (`npm run db:seed`) — the one-time journal import, which
 *     also upserts the stages in the same batch;
 *   - `scripts/sync-stages.mts` (`npm run db:sync-stages`) — the idempotent,
 *     stages-only sync used to push stage title/summary edits to a database
 *     that already holds journal data (where `db:seed` refuses).
 *
 * Extracted verbatim from `db/seed.ts` (its zod `seedStageSchema` and the
 * stage half of its `preflight`), so both paths accept and reject exactly the
 * same files with exactly the same messages.
 *
 * NOT the same thing as `lib/content/lensStages.ts`: that module is the
 * read-side parser for the "Why this shape?" page and deliberately only checks
 * shape. This module is the write-side gate (exactly 11 stages, unique slugs
 * and stage numbers 1-11, valid chapter refs, reciprocal mirror pairs).
 *
 * PURE: no filesystem or database access here except the path constant.
 * `tests/stage-sync.test.ts` exercises every function directly.
 *
 * Author: Kenneth Hill
 */

import path from "node:path";

import { z } from "zod";

import type { stages } from "@/db/schema";
import { chapterRefSchema } from "@/lib/api/entries";

/** Same resolution `db/seed.ts` has always used: npm scripts run from `web/`. */
export const STAGE_SEED_PATH = path.join(process.cwd(), "..", "content", "lens", "eleven-stages.json");

/** The number of stages on the Mountain. */
export const EXPECTED_STAGE_COUNT = 11;

export type SeedStage = typeof stages.$inferInsert;

export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const slugSchema = z.string().regex(slugPattern);
export const seedStageSchema = z.array(
  z
    .object({
      slug: slugSchema,
      title: z.string().trim().min(1),
      stage: z.number().int(),
      side: z.enum(["ascent", "peak", "descent"]),
      mirror: slugSchema.nullable(),
      chapters: z.array(chapterRefSchema),
      summary: z.string(),
    })
    .strict(),
);

/**
 * The stage half of `db/seed.ts`'s preflight. Returns every problem found (in
 * file order); an empty array means the stage list is safe to write.
 */
export function collectStageSeedErrors(stageSeed: readonly SeedStage[]): string[] {
  const errors: string[] = [];
  const stageSlugs = new Set<string>();
  const stageNumbers = new Set<number>();

  if (stageSeed.length !== EXPECTED_STAGE_COUNT) {
    errors.push(`Expected 11 mountain stages, found ${stageSeed.length}`);
  }
  for (const stage of stageSeed) {
    if (!stage.slug || stageSlugs.has(stage.slug)) {
      errors.push(`Duplicate or missing stage slug: ${stage.slug || "(empty)"}`);
    }
    stageSlugs.add(stage.slug);
    if (!Number.isInteger(stage.stage) || stageNumbers.has(stage.stage)) {
      errors.push(`Duplicate or invalid stage number: ${stage.stage}`);
    }
    stageNumbers.add(stage.stage);
    if (stage.stage < 1 || stage.stage > 11) {
      errors.push(`Stage ${stage.slug} is outside the 1-11 mountain`);
    }
    if (!Array.isArray(stage.chapters)) {
      errors.push(`Stage ${stage.slug} has no chapter list`);
    }
    for (const chapter of stage.chapters ?? []) {
      if (!chapterRefSchema.safeParse(chapter).success) {
        errors.push(`Stage ${stage.slug} has invalid chapter ${chapter}`);
      }
    }
  }
  const stagesBySlug = new Map(stageSeed.map((stage) => [stage.slug, stage]));
  for (const stage of stageSeed) {
    if (!stage.mirror) continue;
    const mirror = stagesBySlug.get(stage.mirror);
    if (!mirror) {
      errors.push(`Stage ${stage.slug} has unknown mirror ${stage.mirror}`);
    } else if (mirror.mirror !== stage.slug) {
      errors.push(`Stage ${stage.slug} mirror is not reciprocal`);
    }
  }
  return errors;
}

export type StageSeedResult =
  | { ok: true; stages: SeedStage[] }
  | { ok: false; errors: string[] };

/**
 * Full gate for an already-`JSON.parse`d `eleven-stages.json` value: schema
 * first (same zod schema `db:seed` reads with), then the preflight rules.
 * Never throws for bad content; returns every problem so a caller can refuse
 * the whole write (never a partial sync).
 */
export function validateStageSeed(raw: unknown): StageSeedResult {
  const parsed = seedStageSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    };
  }
  const rows: SeedStage[] = parsed.data;
  const errors = collectStageSeedErrors(rows);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, stages: rows };
}

/** The full row inserted for a stage (every `stages` column). */
export function stageInsertValues(stage: SeedStage): SeedStage {
  return {
    slug: stage.slug,
    title: stage.title,
    stage: stage.stage,
    side: stage.side,
    mirror: stage.mirror,
    chapters: stage.chapters,
    summary: stage.summary,
  };
}

/**
 * The columns overwritten when a stage's slug already exists — every column
 * except the conflict key `slug`. Exactly what `db:seed`'s `stageUpsert` set.
 */
export function stageUpsertSet(stage: SeedStage): Omit<SeedStage, "slug"> {
  return {
    title: stage.title,
    stage: stage.stage,
    side: stage.side,
    mirror: stage.mirror,
    chapters: stage.chapters,
    summary: stage.summary,
  };
}
