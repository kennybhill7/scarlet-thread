/**
 * MOUNTAINWHY-001 — extends the assertion-line lint (BUILD_PLAN.md §5.0 rule
 * 4, `validate.ts`'s `lintAssertionLanguage`) to the Mountain's 11-stage lens
 * data, per design/PRODUCT_EXPERIENCE_PLAN_2026-09-25.md §G4: "the assertion
 * line is enforced on lessons only; the Mountain lens, Story Map legend, and
 * future tours/captions can assert without lint... Extend `validate.ts` lint
 * to content/tours, content/places notes, stage titles (`stages.json` moved
 * into content/)."
 *
 * Logic-vs-IO split, same discipline this pipeline's other modules use
 * (`validate.ts`'s own header; `connectionSchema.ts`/`placeSchema.ts`): the
 * pure lint (`lintLensStages`) takes plain data and returns matches, no I/O;
 * `loadLensStages`/`lintLensFile` below are the one place this module
 * touches the real filesystem, and `validate.ts`'s `main()` is the one place
 * that reports results and sets an exit code -- this file has no CLI
 * entrypoint of its own.
 *
 * Author: Kenneth Hill
 */

import { readFileSync } from "node:fs";

import { VERDICT_PATTERNS, type VerdictPattern } from "./schema";

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/**
 * One pattern beyond the four lesson-prose `VERDICT_PATTERNS`, scoped
 * specifically to this lens's stage titles/summaries.
 *
 * JUSTIFICATION (false positives are a real cost, per this task's own
 * brief, so this is deliberately narrow): a bare parenthetical divine-
 * identity tag directly after a name -- "Jesus Christ (God)" is the real
 * example this task found in the Mountain's own data before this task's
 * title rewrite -- asserts a specific, historically contested doctrinal
 * claim (the deity of Christ, the subject of the first ecumenical councils)
 * as a parenthetical fact: no quotation, no cited source, no "Positions"-
 * style framing, nothing a reader could check or disagree with on the
 * screen itself. That is exactly the unlabeled-verdict risk the assertion
 * line exists to catch, and it belongs here rather than as a general
 * `VERDICT_PATTERNS` addition because lesson prose already has the
 * Positions-block/blockquote exemptions and a human reviewer pass
 * (content/README.md); this file's titles/summaries have neither.
 *
 * Kept narrow on purpose: it only fires on a parenthetical containing one of
 * a short, closed list of divine-name tokens immediately after a word
 * character (so "(see Genesis 3)" or "the LORD said" in ordinary descriptive
 * text never match -- both this file's own real content, after this task's
 * rewrite, and the test fixtures below confirm that). It is not a general
 * "any mention of God is suspect" rule; mentioning God or the LORD as an
 * ordinary subject/object of a sentence is not what this pattern tests for.
 */
const BARE_DIVINE_IDENTITY_PARENTHETICAL: VerdictPattern = {
  id: "bare-divine-identity-parenthetical",
  regex: /\w\s*\((?:God|the LORD|Yahweh|Jehovah)\)/i,
};

/** The four lesson-prose patterns, plus the one above, scoped to this file's own content. */
export const LENS_LINT_PATTERNS: VerdictPattern[] = [...VERDICT_PATTERNS, BARE_DIVINE_IDENTITY_PARENTHETICAL];

// ---------------------------------------------------------------------------
// Pure lint
// ---------------------------------------------------------------------------

export interface LensStageLintInput {
  slug: string;
  title: string;
  summary: string;
}

export interface LensLintMatch {
  slug: string;
  field: "title" | "summary";
  /** 1-based line number within `summary`; always 1 for a `title` match (titles are single-line). */
  line: number;
  patternId: string;
  excerpt: string;
}

/**
 * Runs {@link LENS_LINT_PATTERNS} over every stage's `title` (one line) and
 * `summary` (checked line by line, same as `lintAssertionLanguage` does for
 * lesson bodies -- a multi-line summary's second line is just as checkable
 * as its first). No Positions-block or blockquote exemption here: this
 * file's own shape has no such blocks, see this module's header.
 */
export function lintLensStages(stages: readonly LensStageLintInput[]): LensLintMatch[] {
  const matches: LensLintMatch[] = [];

  for (const stage of stages) {
    for (const pattern of LENS_LINT_PATTERNS) {
      if (pattern.regex.test(stage.title)) {
        matches.push({ slug: stage.slug, field: "title", line: 1, patternId: pattern.id, excerpt: stage.title });
      }
    }

    const summaryLines = stage.summary.split(/\r?\n/);
    summaryLines.forEach((rawLine, index) => {
      const line = rawLine.trim();
      if (line === "") return;
      for (const pattern of LENS_LINT_PATTERNS) {
        if (pattern.regex.test(line)) {
          matches.push({ slug: stage.slug, field: "summary", line: index + 1, patternId: pattern.id, excerpt: line });
        }
      }
    });
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Real IO — the one place this module reads a file.
// ---------------------------------------------------------------------------

/**
 * Reads and loosely shape-checks `filePath` (expected: a JSON array of
 * objects, each with at least `slug`/`title`/`summary` strings -- the exact
 * shape `content/lens/eleven-stages.json` ships, per `db/seed.ts`'s own
 * `seedStageSchema`, which remains this repo's one real structural
 * validator for the file; this function only needs enough of the shape to
 * lint text, not full schema enforcement). Returns `null` (never throws) for
 * a missing file -- a missing lens file is this script's honest "nothing to
 * lint yet" state, matching `findMarkdownFiles`'s own missing-directory
 * convention in `validate.ts`.
 */
export function loadLensStages(filePath: string): LensStageLintInput[] | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${filePath} must be a JSON array of stage objects`);
  }

  return parsed.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`${filePath}[${index}] is not an object`);
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.slug !== "string" || typeof row.title !== "string" || typeof row.summary !== "string") {
      throw new Error(`${filePath}[${index}] is missing a string slug/title/summary`);
    }
    return { slug: row.slug, title: row.title, summary: row.summary };
  });
}

/** Real IO + pure lint, composed. `null` (file absent) lints as zero matches, never an error. */
export function lintLensFile(filePath: string): LensLintMatch[] {
  const stages = loadLensStages(filePath);
  if (!stages) return [];
  return lintLensStages(stages);
}
