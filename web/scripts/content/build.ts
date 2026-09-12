#!/usr/bin/env -S npx tsx
/**
 * CONTENTPIPE-001 — the content-compiler's build step (BUILD_PLAN.md §5.1:
 * "Build the compiler in `web/scripts/content/`: ... `build.ts`,
 * `publish.ts` (signed, checksummed catalog-release manifest to durable
 * append-only storage, independent of any single Vercel deployment) ...").
 *
 * SCOPE NARROWING #2 (stated here and in `content/README.md`): builds the
 * checksummed part for real -- a real SHA-256 hash over the compiled
 * release bundle's canonical (stable-key-order) JSON serialization,
 * independently re-verifiable by anyone with the bundle -- but skips
 * literal cryptographic signing (no keypair/signature scheme). This is a
 * solo-operator internal tool today, not a multi-party trust boundary,
 * so a signature would authenticate nothing a checksum doesn't already
 * cover (tamper-evidence), at the cost of key-management machinery this
 * task has no real need for yet. "Durable, append-only storage,
 * independent of any single Vercel deployment" is satisfied by writing to
 * the new `catalog_releases` Postgres table (`db/schema.ts`) -- it lives in
 * the database, not in a Vercel build's output directory -- rather than
 * standing up a genuinely separate object-storage integration this task
 * does not need. `publish.ts`/`verify-release.ts` as named by §5.1 are not
 * built here: this task is schema + validate + build only, per
 * CONTENTPIPE-001's own registered scope.
 *
 * Pure logic (canonical JSON serialization, the SHA-256 checksum, and
 * release-bundle assembly from already-validated lessons) is exported with
 * no side effects; `web/tests/content-build.test.ts` exercises it directly.
 * Real IO (walking `content/curriculum/` via `validate.ts`'s
 * `runValidation`, and writing the `catalog_releases` row over a real
 * Postgres connection) is confined to `main`, guarded the same way
 * `validate.ts` guards its own `main` -- importing this module for its pure
 * functions never touches a filesystem or a database.
 *
 * Requires `DATABASE_URL` to actually write a release row (same convention
 * `scripts/import-cross-references.mts` already uses) -- this repo's dev
 * environment has no `.env.local` configured, so the real Postgres write
 * has not been exercised live as part of building this task; the compile
 * step (validation -> bundle -> checksum) above it is real and is what
 * `content-build.test.ts` proves deterministic.
 *
 * Run via `npm run content:build` from `web/`.
 *
 * Author: Kenneth Hill
 */

import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "@/db/schema";
import { catalogReleases } from "@/db/schema";

import type { LessonFrontmatter } from "./schema";
import { CURRICULUM_DIR, runValidation, type RunValidationResult } from "./validate";

// ---------------------------------------------------------------------------
// Canonical JSON — recursively sorts every object's keys before
// `JSON.stringify` so the same logical bundle always serializes to the
// exact same bytes, regardless of property insertion order upstream. Pure.
// ---------------------------------------------------------------------------

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Deterministic JSON serialization: same logical value in, same string out,
 * every time, independent of key insertion order at any depth. */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

/** A real SHA-256 hex digest over {@link canonicalJsonStringify}'s output —
 * independently reproducible by anyone holding the same bundle value. */
export function computeChecksum(value: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(value)).digest("hex");
}

// ---------------------------------------------------------------------------
// Release bundle assembly
// ---------------------------------------------------------------------------

export interface ReleaseBundleLesson {
  frontmatter: LessonFrontmatter;
  body: string;
}

export interface ReleaseBundle {
  schemaVersion: 1;
  lessonCount: number;
  /** Keyed by slug (the lesson's path under `content/curriculum/`, minus
   * the `.md` extension, forward-slash separated) -- stable and
   * human-readable, unlike a random id. */
  lessons: Record<string, ReleaseBundleLesson>;
}

export interface CompileLessonInput {
  slug: string;
  frontmatter: LessonFrontmatter;
  body: string;
}

/**
 * Compiles already-validated lessons into one deterministic {@link ReleaseBundle}.
 * Succeeds with `lessonCount: 0` and an empty `lessons` map when given an
 * empty array -- the honest starting state after CONTENTPIPE-001 (no lesson
 * content authored yet) must build a valid, empty release, not error out.
 * Throws (a real, loud failure, never a silent overwrite) if two inputs
 * share a slug.
 */
export function compileReleaseBundle(lessons: CompileLessonInput[]): ReleaseBundle {
  const sorted = [...lessons].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const lessonMap: Record<string, ReleaseBundleLesson> = {};
  for (const lesson of sorted) {
    if (Object.prototype.hasOwnProperty.call(lessonMap, lesson.slug)) {
      throw new Error(`duplicate lesson slug "${lesson.slug}" -- two content files compiled to the same key`);
    }
    lessonMap[lesson.slug] = { frontmatter: lesson.frontmatter, body: lesson.body };
  }
  return { schemaVersion: 1, lessonCount: sorted.length, lessons: lessonMap };
}

/** Derives a lesson's bundle slug from its real file path relative to
 * `curriculumDir`: forward-slash separated, `.md` stripped. */
export function slugFor(filePath: string, curriculumDir: string): string {
  return path.relative(curriculumDir, filePath).split(path.sep).join("/").replace(/\.md$/, "");
}

export interface BuildResult {
  ok: boolean;
  bundle?: ReleaseBundle;
  checksum?: string;
  /** One entry per failed lesson file, already prefixed with its path --
   * empty when `ok` is true. */
  errors: string[];
}

/**
 * Turns a `validate.ts` `runValidation` result into a {@link BuildResult}.
 * Refuses (does not partially publish) if ANY lesson under `curriculumDir`
 * fails validation -- a broken lesson should never silently drop out of a
 * release, per this pipeline's own "fail loudly" discipline.
 */
export function buildReleaseFromValidation(curriculumDir: string, validation: RunValidationResult): BuildResult {
  if (!validation.ok) {
    const errors = validation.results
      .filter((result) => !result.ok)
      .flatMap((result) =>
        result.errors.map((error) => `${path.relative(curriculumDir, result.filePath)}: ${error}`),
      );
    return { ok: false, errors };
  }

  const lessons: CompileLessonInput[] = validation.results.map((result) => ({
    slug: slugFor(result.filePath, curriculumDir),
    // Safe: every result here has `ok: true` (checked above), and
    // `validateLessonSource` always sets `frontmatter`/`body` together with
    // `ok: true`.
    frontmatter: result.frontmatter as LessonFrontmatter,
    body: result.body as string,
  }));

  const bundle = compileReleaseBundle(lessons);
  const checksum = computeChecksum(bundle);
  return { ok: true, bundle, checksum, errors: [] };
}

// ---------------------------------------------------------------------------
// Real filesystem walk + Postgres write + CLI entrypoint.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const validation = runValidation(CURRICULUM_DIR);
  const result = buildReleaseFromValidation(CURRICULUM_DIR, validation);

  if (!result.ok) {
    console.error(`content:build refused -- ${result.errors.length} lesson(s) failed validation:`);
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  const bundle = result.bundle as ReleaseBundle;
  const checksum = result.checksum as string;
  console.log(`Compiled ${bundle.lessonCount} lesson(s) from content/curriculum/.`);
  console.log(`SHA-256 checksum: ${checksum}`);

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required to write the catalog_releases row (set it in the environment or " +
        "web/.env.local, the same convention scripts/import-cross-references.mts uses). The compile step above " +
        "succeeded regardless -- this failure is only the durable-storage write.",
    );
  }

  const db = drizzle(process.env.DATABASE_URL, { schema });
  const id = crypto.randomUUID();
  await db.insert(catalogReleases).values({
    id,
    checksum,
    lessonCount: bundle.lessonCount,
    bundle,
  });
  console.log(`Wrote catalog_releases row ${id}.`);
}

const isMainModule = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error("[fatal] Unhandled error in content:build:", error);
    process.exitCode = 1;
  });
}
