/**
 * MOUNTAINWHY-001 — read-side access to content/lens/eleven-stages.json and
 * content/lens/why-this-shape.json, for app/(app)/mountain-why/page.tsx.
 *
 * Deliberately reads content/lens/ directly from disk rather than going
 * through the lesson/connection/place pipeline's compile-to-`catalog_releases`
 * step (`scripts/content/build.ts`): the 11 mountain stages are NOT part of
 * that pipeline (lessons/connections/places are — see content/README.md).
 * They already have their own, separate, simpler established path: a JSON
 * seed file compiled once by `db:seed` into the `stages` Postgres table,
 * which `app/(app)/page.tsx` and `app/(app)/mirror/[stageSlug]/page.tsx`
 * both read directly (`db.select().from(stagesTable)`). This module adds a
 * THIRD read path (straight off content/lens/eleven-stages.json) rather than
 * querying `stages` for one specific reason: the "Why this shape?" screen is
 * disclosing the LENS's own curated content, identical for every learner and
 * independent of any one learner's session/auth state (`PlacesPage`'s own
 * precedent: a lens page with no DB call at all), and reading the file
 * directly means this screen reflects a content change (e.g. a future title
 * edit) without requiring a `db:seed` re-run first. The tradeoff, stated
 * plainly for whoever next touches this: after this task's title rewrite,
 * this screen shows the NEW titles immediately, while the Mountain/Mirror
 * (both DB-backed) keep showing the OLD titles until `npm run db:seed` is
 * run again — see this task's own final report.
 *
 * LOGIC-VS-IO SPLIT (same discipline `scripts/content/lensLint.ts` and
 * `scripts/content/validate.ts` already use): `parseLensStages`/
 * `parseLensDisclosure` are pure — given an already-`JSON.parse`d value,
 * they narrow/validate it with no filesystem access, and are what
 * `tests/lens-stages.test.ts` exercises directly. `loadLensStages`/
 * `loadLensDisclosure` are the only two functions here that touch a real
 * file.
 *
 * Author: Kenneth Hill
 */

import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

export type MountainSide = "ascent" | "peak" | "descent";

export interface LensStage {
  slug: string;
  title: string;
  stage: number;
  side: MountainSide;
  mirror: string | null;
  chapters: string[];
  summary: string;
}

function isMountainSide(value: unknown): value is MountainSide {
  return value === "ascent" || value === "peak" || value === "descent";
}

/** Pure: validates/narrows an already-`JSON.parse`d value. No I/O. */
export function parseLensStages(raw: unknown): LensStage[] {
  if (!Array.isArray(raw)) {
    throw new Error("content/lens/eleven-stages.json must be a JSON array");
  }
  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`content/lens/eleven-stages.json[${index}] is not an object`);
    }
    const row = entry as Record<string, unknown>;
    if (
      typeof row.slug !== "string" ||
      typeof row.title !== "string" ||
      typeof row.stage !== "number" ||
      !isMountainSide(row.side) ||
      (row.mirror !== null && typeof row.mirror !== "string") ||
      !Array.isArray(row.chapters) ||
      typeof row.summary !== "string"
    ) {
      throw new Error(
        `content/lens/eleven-stages.json[${index}] (slug ${String(row.slug)}) has an unexpected shape`,
      );
    }
    return {
      slug: row.slug,
      title: row.title,
      stage: row.stage,
      side: row.side,
      mirror: row.mirror,
      chapters: row.chapters.map((chapter) => String(chapter)),
      summary: row.summary,
    };
  });
}

const DEFAULT_STAGES_PATH = path.join(process.cwd(), "..", "content", "lens", "eleven-stages.json");

/** Real IO. Throws rather than degrading to an empty list — a disclosure
 * page about the lens with no real stage data to show is a genuine failure,
 * unlike `lib/vault/seed.ts`'s ENOENT-to-`[]` fallback for a DIFFERENT,
 * gitignored, optional-at-build-time file. */
export function loadLensStages(filePath: string = DEFAULT_STAGES_PATH): LensStage[] {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  return parseLensStages(raw);
}

// ---------------------------------------------------------------------------
// Disclosure copy (content/lens/why-this-shape.json)
// ---------------------------------------------------------------------------

export interface LensOtherLens {
  id: string;
  label: string;
  available: boolean;
  description: string;
}

export interface LensDisclosure {
  id: string;
  title: string;
  author: string;
  /** "draft" | "in_review" | "published" — same vocabulary lesson
   * frontmatter uses (`scripts/content/schema.ts`'s `LESSON_STATUSES`), not
   * re-validated against that exact union here (this file deliberately does
   * not import the lesson schema — see this module's header on why stages
   * stay outside that pipeline) but kept as a plain string for the same
   * reason `ContinueCardSession.currentStep` stays a plain string
   * (ContinueCard.tsx): render code checks the one value it cares about
   * ("draft") defensively rather than assuming a closed set.
   */
  status: string;
  statusNote: string;
  whatThisIs: string[];
  author_statement: string;
  method: string[];
  cautions: string[];
  otherLenses: LensOtherLens[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOtherLensArray(value: unknown): value is LensOtherLens[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).id === "string" &&
        typeof (item as Record<string, unknown>).label === "string" &&
        typeof (item as Record<string, unknown>).available === "boolean" &&
        typeof (item as Record<string, unknown>).description === "string",
    )
  );
}

/** Pure: validates/narrows an already-`JSON.parse`d value. No I/O. */
export function parseLensDisclosure(raw: unknown): LensDisclosure {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("content/lens/why-this-shape.json must be a JSON object");
  }
  const row = raw as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.title !== "string" ||
    typeof row.author !== "string" ||
    typeof row.status !== "string" ||
    typeof row.statusNote !== "string" ||
    !isStringArray(row.whatThisIs) ||
    typeof row.author_statement !== "string" ||
    !isStringArray(row.method) ||
    !isStringArray(row.cautions) ||
    !isOtherLensArray(row.otherLenses)
  ) {
    throw new Error("content/lens/why-this-shape.json has an unexpected shape");
  }
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    status: row.status,
    statusNote: row.statusNote,
    whatThisIs: row.whatThisIs,
    author_statement: row.author_statement,
    method: row.method,
    cautions: row.cautions,
    otherLenses: row.otherLenses,
  };
}

const DEFAULT_DISCLOSURE_PATH = path.join(process.cwd(), "..", "content", "lens", "why-this-shape.json");

/** Real IO. */
export function loadLensDisclosure(filePath: string = DEFAULT_DISCLOSURE_PATH): LensDisclosure {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  return parseLensDisclosure(raw);
}
