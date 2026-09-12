#!/usr/bin/env -S npx tsx
/**
 * CONTENTPIPE-001 — the content-compiler's validate step (BUILD_PLAN.md §5.1:
 * "Build the compiler in `web/scripts/content/`: `validate.ts` (schema + ref
 * resolution + the assertion-line rules below)").
 *
 * SCOPE NARROWING #1 (stated here and in `content/README.md`): §5.1 says
 * lessons are authored as MDX. No MDX tooling exists anywhere in this
 * repo's dependencies. Lessons are authored as plain Markdown + a small,
 * real YAML-subset frontmatter block instead — `tools/import_vault.py`'s
 * own `parse_frontmatter()` is this repo's working precedent for exactly
 * this shape (even though it is Python), extended here to support the
 * lists/nested-object frontmatter values (`connectionIds[]`, `passage`)
 * this schema needs, since no YAML library is a real dependency of this
 * project either (`js-yaml` appears only as a transitive-dependency
 * `overrides` pin in `package.json`, never installed for direct use). The
 * supported subset is documented immediately above `parseFrontmatterYaml`
 * below and in `content/README.md`.
 *
 * Pure logic (frontmatter splitting/parsing, schema validation via
 * `./schema`, and the assertion-line lint) lives in this file as exported
 * functions with no side effects; `web/tests/content-validate.test.ts`
 * exercises all of it directly, no filesystem access required. The real
 * filesystem walk and CLI entrypoint are confined to `runValidation`/`main`
 * at the bottom, guarded so importing this module (as the test file, and
 * `build.ts`, both do) never triggers real I/O — the same logic-vs-IO
 * discipline `scripts/lib/releaseMigrate.ts`/`scripts/release-migrate.mts`
 * and `scripts/lib/importCrossReferences.ts`/`scripts/import-cross-references.mts`
 * already established, collapsed into one file per CONTENTPIPE-001's own
 * registered `ownedPaths`.
 *
 * Run via `npm run content:validate` from `web/`.
 *
 * Author: Kenneth Hill
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseLessonFrontmatter, type LessonFrontmatter } from "./schema";

// ---------------------------------------------------------------------------
// Frontmatter / body split — `tools/import_vault.py`'s `FRONTMATTER` regex,
// ported verbatim (`\A---\r?\n(.*?)\r?\n---\r?\n`).
// ---------------------------------------------------------------------------

export interface SplitFrontmatterResult {
  frontmatterText: string;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Returns `null` (never throws) when `raw` does not open with a `---`
 * frontmatter block at all — a real, reportable validation failure the
 * caller turns into an error, not a crash. */
export function splitFrontmatter(raw: string): SplitFrontmatterResult | null {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return null;
  return { frontmatterText: match[1], body: raw.slice(match[0].length) };
}

// ---------------------------------------------------------------------------
// Minimal YAML-subset frontmatter parser.
//
// Supported grammar, and nothing else (anything outside this is a real,
// reported parse error — never silently ignored or best-effort guessed):
//
//   key: value              -- scalar. Quoted ("..." or '...') strings keep
//                               their contents verbatim; bare `true`/`false`
//                               become booleans; a bare all-digit token
//                               becomes a number (so `stage: 3` parses as
//                               3, not "3"); anything else stays a string
//                               (so `start: 1.3.1` stays the string
//                               "1.3.1" -- it is not all-digit).
//   key:
//     - item
//     - item                -- a list, only when the FIRST non-blank
//                               indented line under `key:` starts with
//                               "- ". Every scalar coercion rule above
//                               applies to each item.
//   key:
//     subkey: value
//     subkey: value          -- a ONE-LEVEL nested mapping of scalars, used
//                               for `passage: { start, end }`. Only when the
//                               first indented line does NOT start with "- ".
//   key:                     -- (nothing indented follows) -> empty list.
//   # comment / blank line   -- ignored, top level or inside a block.
//
// Top-level keys must be at zero indentation; anything indented that is not
// immediately preceded by a `key:` block opener is a parse error. No
// multi-level nesting, no flow syntax (`[a, b]` / `{a: b}`), no anchors,
// no multi-line scalars -- none of §5.1's fields need them today, and
// adding them un-asked would be exactly the kind of half-built tooling
// CONTENTPIPE-001's own scope narrowing says not to do.
// ---------------------------------------------------------------------------

export type FrontmatterScalar = string | number | boolean;
export type FrontmatterValue = FrontmatterScalar | FrontmatterScalar[] | Record<string, FrontmatterScalar>;

export type FrontmatterYamlResult =
  | { ok: true; data: Record<string, FrontmatterValue> }
  | { ok: false; errors: string[] };

function coerceScalar(raw: string): FrontmatterScalar {
  const trimmed = raw.trim();
  const isDoubleQuoted = trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
  const isSingleQuoted = trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'");
  if (isDoubleQuoted || isSingleQuoted) return trimmed.slice(1, -1);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function indentOf(line: string): number {
  return /^ */.exec(line)?.[0].length ?? 0;
}

export function parseFrontmatterYaml(text: string): FrontmatterYamlResult {
  const errors: string[] = [];
  const data: Record<string, FrontmatterValue> = {};
  const lines = text.split(/\r?\n/);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    if (indentOf(line) !== 0) {
      errors.push(`line ${i + 1}: unexpected indentation at the top level: "${line}"`);
      i++;
      continue;
    }
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      errors.push(`line ${i + 1}: expected "key: value", got "${line}"`);
      i++;
      continue;
    }
    const key = line.slice(0, colonIndex).trim();
    const rest = line.slice(colonIndex + 1).trim();
    if (!key) {
      errors.push(`line ${i + 1}: empty key`);
      i++;
      continue;
    }

    if (rest !== "") {
      data[key] = coerceScalar(rest);
      i++;
      continue;
    }

    // `key:` with nothing after the colon -- gather every immediately
    // following indented (or blank) line as this key's block value.
    const blockLines: { line: string; lineNumber: number }[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      const nextTrimmed = next.trim();
      if (nextTrimmed === "" || nextTrimmed.startsWith("#")) {
        j++;
        continue;
      }
      if (indentOf(next) === 0) break;
      blockLines.push({ line: next, lineNumber: j + 1 });
      j++;
    }

    if (blockLines.length === 0) {
      data[key] = [];
      i = j;
      continue;
    }

    if (blockLines[0].line.trim().startsWith("- ")) {
      const items: FrontmatterScalar[] = [];
      for (const { line: itemLine, lineNumber } of blockLines) {
        const itemTrimmed = itemLine.trim();
        if (!itemTrimmed.startsWith("- ")) {
          errors.push(`line ${lineNumber}: expected a "- item" list entry under "${key}:", got "${itemLine}"`);
          continue;
        }
        items.push(coerceScalar(itemTrimmed.slice(2)));
      }
      data[key] = items;
    } else {
      const nested: Record<string, FrontmatterScalar> = {};
      for (const { line: subLine, lineNumber } of blockLines) {
        const subColon = subLine.indexOf(":");
        if (subColon === -1) {
          errors.push(`line ${lineNumber}: expected "key: value" inside "${key}:", got "${subLine}"`);
          continue;
        }
        const subKey = subLine.slice(0, subColon).trim();
        const subValue = subLine.slice(subColon + 1).trim();
        if (!subKey) {
          errors.push(`line ${lineNumber}: empty nested key inside "${key}:"`);
          continue;
        }
        nested[subKey] = coerceScalar(subValue);
      }
      data[key] = nested;
    }
    i = j;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// The assertion-line lint (§5.1 / §5.0 rule 4, "the assertion line,
// mechanized"): flags declarative doctrinal-verdict language in lesson body
// prose UNLESS it sits inside a "Positions" block or a quoted/attributed
// source. "It is a review aid, not a proof" (§5.1's own words) -- it fails
// loudly, and is silenced only by the schema-enforced `assertionReviewed`
// frontmatter key (never silently; see `validateLessonSource` below, which
// always reports a silenced match as a warning, not a swallowed one).
// ---------------------------------------------------------------------------

export interface VerdictPattern {
  id: string;
  regex: RegExp;
}

/** The exact four phrases BUILD_PLAN.md §5.1 names, case-insensitive. */
export const VERDICT_PATTERNS: VerdictPattern[] = [
  { id: "this-passage-teaches-that", regex: /this passage teaches that/i },
  { id: "the-correct-view-is", regex: /the correct view is/i },
  { id: "this-proves", regex: /this proves/i },
  { id: "this-means", regex: /this means/i },
];

export interface LintMatch {
  /** 1-based line number within the lesson body (frontmatter excluded). */
  line: number;
  patternId: string;
  excerpt: string;
}

/**
 * The "Positions" convention this task defines (§5.1 asks for "a real,
 * simple convention you define and document"): a markdown ATX level-2
 * heading whose text is exactly "Positions" (`## Positions`) opens a
 * block; the block includes that heading line itself and every line after
 * it, up to (not including) the next `##` heading or the end of the body.
 * Nothing fancier — no HTML-comment delimiters, no case-insensitivity, so
 * the convention stays trivially greppable by a human author too.
 */
export function findPositionsBlockLines(bodyLines: string[]): Set<number> {
  const inside = new Set<number>();
  let active = false;
  bodyLines.forEach((line, index) => {
    const trimmed = line.trim();
    if (/^##\s+/.test(trimmed)) {
      active = trimmed.replace(/^##\s+/, "").trim() === "Positions";
      if (active) inside.add(index);
      return;
    }
    if (active) inside.add(index);
  });
  return inside;
}

/**
 * Runs {@link VERDICT_PATTERNS} over every body line, skipping lines inside
 * a Positions block ({@link findPositionsBlockLines}) and lines that are a
 * markdown blockquote (`> ...`) — the "quoted, attributed source" exemption
 * §5.1 names. Every remaining match is reported; nothing is deduplicated or
 * capped, so a lesson with five verdict lines shows all five.
 */
export function lintAssertionLanguage(body: string): LintMatch[] {
  const lines = body.split(/\r?\n/);
  const positionsLines = findPositionsBlockLines(lines);
  const matches: LintMatch[] = [];
  lines.forEach((line, index) => {
    if (line.trim().startsWith(">")) return;
    if (positionsLines.has(index)) return;
    for (const pattern of VERDICT_PATTERNS) {
      if (pattern.regex.test(line)) {
        matches.push({ line: index + 1, patternId: pattern.id, excerpt: line.trim() });
      }
    }
  });
  return matches;
}

// ---------------------------------------------------------------------------
// Full per-file validation: schema + lint + the sources[]-when-Positions
// heuristic.
// ---------------------------------------------------------------------------

export interface LessonValidationResult {
  ok: boolean;
  filePath: string;
  errors: string[];
  warnings: string[];
  frontmatter?: LessonFrontmatter;
  body?: string;
}

export function validateLessonSource(filePath: string, raw: string): LessonValidationResult {
  const warnings: string[] = [];

  const split = splitFrontmatter(raw);
  if (!split) {
    return {
      ok: false,
      filePath,
      errors: ['no YAML frontmatter block found (expected a leading "---" ... "---" block)'],
      warnings,
    };
  }

  const parsedYaml = parseFrontmatterYaml(split.frontmatterText);
  if (!parsedYaml.ok) {
    return { ok: false, filePath, errors: parsedYaml.errors.map((error) => `frontmatter: ${error}`), warnings };
  }

  const frontmatterResult = parseLessonFrontmatter(parsedYaml.data);
  if (!frontmatterResult.ok) {
    return {
      ok: false,
      filePath,
      errors: frontmatterResult.errors.map((error) => `frontmatter: ${error}`),
      warnings,
    };
  }
  const frontmatter = frontmatterResult.frontmatter;
  const errors: string[] = [];

  const lintMatches = lintAssertionLanguage(split.body);
  if (lintMatches.length > 0) {
    if (frontmatter.assertionReviewed) {
      warnings.push(
        `assertion-line lint silenced via assertionReviewed: "${frontmatter.assertionReviewed}" ` +
          `(${lintMatches.length} match(es): ${lintMatches
            .map((match) => `line ${match.line} "${match.patternId}"`)
            .join(", ")})`,
      );
    } else {
      for (const match of lintMatches) {
        errors.push(
          `assertion-line lint: line ${match.line} reads like a doctrinal verdict (pattern "${match.patternId}": ` +
            `"${match.excerpt}") outside a "## Positions" block and not a quoted source. Move it into a ` +
            `"## Positions" block, attribute it as a quoted source ("> ..."), or add an explicit ` +
            `"assertionReviewed: <reason>" frontmatter key.`,
        );
      }
    }
  }

  const hasPositionsBlock = findPositionsBlockLines(split.body.split(/\r?\n/)).size > 0;
  if (hasPositionsBlock && frontmatter.sources.length === 0) {
    errors.push(
      'lesson has a "## Positions" block but sources[] is empty -- §5.1 requires every positions block to name ' +
        "sourced traditions; at minimum sources[] must be non-empty (heuristic; see schema.ts's SCOPE NOTE on why " +
        "full per-tradition source resolution isn't built yet).",
    );
  }

  return { ok: errors.length === 0, filePath, errors, warnings, frontmatter, body: split.body };
}

// ---------------------------------------------------------------------------
// Real filesystem walk + CLI entrypoint. Guarded so importing this module
// (as `build.ts` and the test file both do, for the pure functions above)
// never touches the filesystem or calls `process.exit` on its own.
// ---------------------------------------------------------------------------

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CURRICULUM_DIR = path.join(SCRIPT_DIR, "..", "..", "..", "content", "curriculum");

/** Recursively lists every `.md` file under `dir`, sorted for deterministic
 * output. A missing `dir` (the honest starting state: no `content/`
 * directory exists yet) returns `[]`, never throws — an empty curriculum is
 * a valid, not an erroneous, state. */
export function findMarkdownFiles(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files.sort();
}

export interface RunValidationResult {
  ok: boolean;
  results: LessonValidationResult[];
}

/** Real IO (reads every `.md` file under `curriculumDir`) but no console
 * output and no process-exit side effects — `main` below owns reporting,
 * `build.ts` calls this directly to get validated lessons. */
export function runValidation(curriculumDir: string): RunValidationResult {
  const files = findMarkdownFiles(curriculumDir);
  const results = files.map((filePath) => validateLessonSource(filePath, readFileSync(filePath, "utf8")));
  return { ok: results.every((result) => result.ok), results };
}

async function main(): Promise<void> {
  const { ok, results } = runValidation(CURRICULUM_DIR);

  if (results.length === 0) {
    console.log(
      `No lesson files found under ${path.relative(process.cwd(), CURRICULUM_DIR)} -- nothing to validate yet ` +
        "(the honest starting state: no lesson content has been authored through this pipeline).",
    );
  }

  for (const result of results) {
    const rel = path.relative(process.cwd(), result.filePath);
    console.log(result.ok ? `OK   ${rel}` : `FAIL ${rel}`);
    for (const error of result.errors) console.log(`  - ${error}`);
    for (const warning of result.warnings) console.log(`  ! ${warning}`);
  }

  console.log("");
  console.log(`${results.filter((result) => result.ok).length}/${results.length} lesson file(s) valid.`);

  if (!ok) process.exitCode = 1;
}

const isMainModule = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error("[fatal] Unhandled error in content:validate:", error);
    process.exitCode = 1;
  });
}
