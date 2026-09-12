/**
 * CONTENTPIPE-001 — zod schema for lesson frontmatter (BUILD_PLAN.md §5.1's
 * own field list, verbatim): `passage`, `stage`, `methodFocus`, `contextId`,
 * `connectionIds[]`, `positionIds[]`, `sources[]`, `author`, `status`.
 *
 * Pure, no filesystem/network/DB access — `validate.ts` is the only file in
 * this pipeline that touches real files, and `build.ts` the only one that
 * touches Postgres, matching the logic-vs-IO split
 * `scripts/lib/releaseMigrate.ts`/`scripts/release-migrate.mts` and
 * `scripts/lib/importCrossReferences.ts`/`scripts/import-cross-references.mts`
 * already established (both read as precedent before writing this file).
 *
 * SCOPE NOTE (real, deliberate limitation — see CONTENTPIPE-001's own
 * acceptance criteria): `contextId`/`connectionIds[]`/`positionIds[]`/
 * `sources[]` reference `passageContexts`/`graph_edges` (as authored rows,
 * not the bulk-imported GRAPHEDGES-001 ones)/`positions`/a full sources
 * table — none of which exist yet (`db/schema.ts`'s own GRAPHEDGES-001
 * comment: "passageContexts/doctrines/graph_edge_evidence remain unbuilt").
 * This schema can therefore only validate that these values are
 * well-formed ID-shaped strings, never that they resolve to a real row.
 * That resolution is future work for whichever task actually builds those
 * tables.
 *
 * Author: Kenneth Hill
 */

import { z } from "zod";

import { type CanonTable, validateCanonicalRange } from "@/lib/bible/range";
import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";

// ---------------------------------------------------------------------------
// passage — reuses the real CanonicalRangeV1 contract (lib/contracts/range-v1.ts)
// verbatim rather than inventing a parallel string format, per this task's
// own acceptance criteria.
// ---------------------------------------------------------------------------

/**
 * A `CanonTable` that treats every chapter/verse number as in-bounds. Used
 * ONLY here, so this pure schema module can reuse the real
 * `validateCanonicalRange` (never re-implement its malformed-key /
 * cross-book / reversed-range checks a second time) without needing real
 * filesystem access to the shipped BSB corpus that genuine bounds-checking
 * requires (`lib/bible/range.ts`'s own `CanonTable` doc comment: "built from
 * the real shipped corpus"). That means this schema catches a malformed key
 * ("1.1"), a cross-book range, or a reversed range, but NOT an
 * out-of-bounds one ("Genesis 51:1") — `validate.ts` closes that gap for
 * real by re-checking every passage against the real `CanonTable` it builds
 * from `public/bible/*`, the same technique
 * `scripts/import-cross-references.mts`'s `buildRealCanonTable` already
 * established for exactly this reason.
 */
const PERMISSIVE_CANON_TABLE: CanonTable = {
  chapterCount: () => Number.MAX_SAFE_INTEGER,
  verseCount: () => Number.MAX_SAFE_INTEGER,
};

/**
 * Frontmatter authors only need to write `start`/`end` — `versificationId`
 * defaults to the one versification this contract speaks today
 * (`CANONICAL_VERSIFICATION_ID`, see `lib/contracts/range-v1.ts`) when
 * omitted, via `normalizeFrontmatterPassage` below. An explicit,
 * *mismatched* `versificationId` is still a real validation error, not
 * silently overwritten.
 */
export function normalizeFrontmatterPassage(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const value = raw as Record<string, unknown>;
  if (value.versificationId !== undefined) return value;
  return { ...value, versificationId: CANONICAL_VERSIFICATION_ID };
}

export const CanonicalRangeV1Schema = z
  .object({
    versificationId: z.literal(CANONICAL_VERSIFICATION_ID),
    start: z.string(),
    end: z.string(),
  })
  .strict()
  .superRefine((range, ctx) => {
    const result = validateCanonicalRange(range as CanonicalRangeV1, PERMISSIVE_CANON_TABLE);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: `${result.reason}: ${result.detail}` });
    }
  });

// ---------------------------------------------------------------------------
// stage — this app's real 1-11 mountain-stage numbers (lib/contracts.ts's
// `Stage.stage`: "1-11. Position on the mountain.").
// ---------------------------------------------------------------------------

export const MIN_STAGE = 1;
export const MAX_STAGE = 11;

export const stageSchema = z
  .number()
  .int("stage must be a whole number")
  .min(MIN_STAGE, `stage must be between ${MIN_STAGE} and ${MAX_STAGE}`)
  .max(MAX_STAGE, `stage must be between ${MIN_STAGE} and ${MAX_STAGE}`);

// ---------------------------------------------------------------------------
// ID-shaped reference fields — see the SCOPE NOTE in this file's header.
// ---------------------------------------------------------------------------

/** Non-empty, no interior/leading/trailing whitespace — "looks like an id",
 * nothing more. Deliberately does not require a specific character set
 * (slug, UUID, etc.) since none of the tables these ids would reference
 * exist yet to define a real convention. */
const NO_WHITESPACE_RE = /^\S+$/;

function idLikeSchema(label: string) {
  return z
    .string()
    .trim()
    .min(1, `${label} must not be empty`)
    .regex(NO_WHITESPACE_RE, `${label} must not contain whitespace`);
}

// ---------------------------------------------------------------------------
// status — §5.1: "status: draft | in_review | published"
// ---------------------------------------------------------------------------

export const LESSON_STATUSES = ["draft", "in_review", "published"] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

// ---------------------------------------------------------------------------
// Full lesson frontmatter
// ---------------------------------------------------------------------------

export const LessonFrontmatterSchema = z
  .object({
    passage: CanonicalRangeV1Schema,
    stage: stageSchema,
    methodFocus: z.string().trim().min(1, "methodFocus must not be empty"),
    /** Optional today: `passageContexts` does not exist yet, so nothing
     * downstream depends on every lesson naming one. */
    contextId: idLikeSchema("contextId").optional(),
    connectionIds: z.array(idLikeSchema("connectionIds[]")).default([]),
    positionIds: z.array(idLikeSchema("positionIds[]")).default([]),
    sources: z.array(idLikeSchema("sources[]")).default([]),
    /** BUILD_PLAN tenet 6: "every curated lesson names its author." Required,
     * never defaulted. */
    author: z.string().trim().min(1, "author is required"),
    status: z.enum(LESSON_STATUSES),
    /**
     * The §5.1 escape hatch for the verdict-language lint in `validate.ts`:
     * "silenced only by an explicit, reviewed `assertionReviewed: <reason>`
     * frontmatter key, never silently." A reason is required (not just a
     * boolean) so a silenced lesson always carries a human-readable record
     * of why.
     */
    assertionReviewed: z
      .string()
      .trim()
      .min(1, "assertionReviewed must state a reason, not just be present")
      .optional(),
  })
  .strict();

export type LessonFrontmatter = z.infer<typeof LessonFrontmatterSchema>;

export type LessonFrontmatterParseResult =
  | { ok: true; frontmatter: LessonFrontmatter }
  | { ok: false; errors: string[] };

/**
 * Validates a raw parsed-frontmatter object (as produced by
 * `validate.ts`'s `parseFrontmatterYaml`) against {@link LessonFrontmatterSchema},
 * normalizing `passage.versificationId` first (see
 * {@link normalizeFrontmatterPassage}). Every zod issue is rendered as one
 * `"<dot.path>: <message>"` string — never swallowed.
 */
export function parseLessonFrontmatter(raw: unknown): LessonFrontmatterParseResult {
  const normalized =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>), passage: normalizeFrontmatterPassage((raw as Record<string, unknown>).passage) }
      : raw;

  const result = LessonFrontmatterSchema.safeParse(normalized);
  if (result.success) return { ok: true, frontmatter: result.data };

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
  return { ok: false, errors };
}
