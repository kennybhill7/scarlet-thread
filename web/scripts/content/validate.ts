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

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { BibleIndex, BookData } from "@/lib/contracts";
import { buildPassageCanon, toCanonTable } from "@/lib/bible/passageCanon";
import type { CanonTable } from "@/lib/bible/range";

import { unresolvedLessonConnectionIds, validateConnectionSet, type ConnectionFileRow, type ConnectionSetResult } from "./connectionSchema";
import { lintLensFile } from "./lensLint";
import { unresolvedLessonPlaceIds, validatePlaceSet, type CompiledPlace, type PlaceSetResult } from "./placeSchema";
import { parseLessonFrontmatter, VERDICT_PATTERNS, type LessonFrontmatter, type VerdictPattern } from "./schema";

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

// `VerdictPattern` / `VERDICT_PATTERNS` now live in `./schema` (CURATEDEDGES-002:
// `connectionSchema.ts` reuses them for connection rationales) and are
// re-exported here so existing importers are unchanged.
export { VERDICT_PATTERNS, type VerdictPattern };

export interface LintMatch {
  /** 1-based line number within the lesson body (frontmatter excluded). */
  line: number;
  patternId: string;
  excerpt: string;
}

/**
 * LESSONSHAPE-001 — the generalized form of the "Positions" heading-block
 * technique immediately below, parameterized by heading text instead of
 * hardcoded to "Positions". This is the exact same algorithm
 * `lib/content/publishedLessons.ts`'s own `findHeadingBlockLines`
 * (RELEASEREADER-001) already uses on the reading side of this pipeline —
 * that file is `lib/content/` (app-side, reads an already-compiled release
 * bundle) and this one is `scripts/content/` (script-side, walks real
 * lesson source files); the two layers deliberately do not import from each
 * other (`content/README.md`'s own "compiler vs. reader" split), so this is
 * a second, independent implementation of the identical documented
 * technique rather than a shared module — exactly the same trade
 * `publishedLessons.ts`'s own header comment already made and documented
 * for "Positions" itself.
 *
 * A markdown ATX level-2 heading whose text exactly matches `headingText`
 * (`## <headingText>`, trimmed, case-sensitive) opens a block; the block
 * includes that heading line itself and every line after it, up to (not
 * including) the next `##` heading or the end of the body.
 */
export function findHeadingBlockLines(bodyLines: string[], headingText: string): Set<number> {
  const inside = new Set<number>();
  let active = false;
  bodyLines.forEach((line, index) => {
    const trimmed = line.trim();
    if (/^##\s+/.test(trimmed)) {
      active = trimmed.replace(/^##\s+/, "").trim() === headingText;
      if (active) inside.add(index);
      return;
    }
    if (active) inside.add(index);
  });
  return inside;
}

/**
 * The "Positions" convention this task defines (§5.1 asks for "a real,
 * simple convention you define and document"): a markdown ATX level-2
 * heading whose text is exactly "Positions" (`## Positions`) opens a
 * block; the block includes that heading line itself and every line after
 * it, up to (not including) the next `##` heading or the end of the body.
 * Nothing fancier — no HTML-comment delimiters, no case-insensitivity, so
 * the convention stays trivially greppable by a human author too.
 *
 * A thin, name-preserving wrapper over {@link findHeadingBlockLines} — kept
 * as its own exported function (rather than inlining `"Positions"` at every
 * call site) because `tests/content-validate.test.ts` already calls it
 * directly by this name, and because "the Positions block" is a real,
 * named concept elsewhere in this file (`lintAssertionLanguage`,
 * `validateLessonSource`'s sources[]-when-Positions heuristic).
 */
export function findPositionsBlockLines(bodyLines: string[]): Set<number> {
  return findHeadingBlockLines(bodyLines, "Positions");
}

/**
 * LESSONSHAPE-001 — whether `body` has a `## <headingText>` block with real,
 * non-blank content under it. Used by the new required-section rule below
 * (`## Teach-Back Prompts`): a bare heading with nothing under it is treated
 * the same as the heading being entirely absent — the identical "prose or
 * nothing" standard `lib/content/publishedLessons.ts`'s `extractHeadingProse`
 * already applies on the reading side, reimplemented narrowly here
 * (existence + non-empty check only, no prose extraction, no `null` return)
 * so `scripts/content/` does not import from `lib/content/` — see
 * `findHeadingBlockLines` above for why these two layers each keep their own
 * copy of this technique.
 */
export function hasNonEmptyHeadingSection(body: string, headingText: string): boolean {
  const lines = body.split(/\r?\n/);
  const blockLines = [...findHeadingBlockLines(lines, headingText)].sort((a, b) => a - b);
  if (blockLines.length === 0) return false;
  // blockLines[0] is always the heading line itself (see findHeadingBlockLines)
  // — skip it so a heading with nothing but blank lines under it correctly
  // counts as "no real content", not "present".
  return blockLines.slice(1).some((index) => lines[index].trim().length > 0);
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

/** LESSONSHAPE-001 — the one required-but-optional-content heading, named
 * once here so the error message and the check itself never drift apart. */
export const REQUIRED_TEACH_BACK_HEADING = "Teach-Back Prompts";

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

  // LESSONSHAPE-001 — §5.1's own CI-rules bullet: "a teach-back prompt set
  // exists". Unlike `## Context`/`## Literary Design`/`## Practice Bridge
  // Example` (all optional, undocumented to this validator on purpose — see
  // content/README.md), `## Teach-Back Prompts` is REQUIRED on every lesson,
  // mechanized the same way the `## Positions`/sources[] heuristic above is:
  // a structural check ("the heading exists with real, non-blank content
  // under it"), not a semantic one that confirms all five named prompts
  // (BUILD_PLAN.md §5.2) are actually present -- that judgment call stays
  // with a human reviewer, exactly the discipline the assertion-line lint
  // and the Positions/sources[] heuristic above both already use.
  if (!hasNonEmptyHeadingSection(split.body, REQUIRED_TEACH_BACK_HEADING)) {
    errors.push(
      `lesson is missing a non-empty "## ${REQUIRED_TEACH_BACK_HEADING}" section -- BUILD_PLAN.md §5.1 requires ` +
        "every lesson to ship a teach-back prompt set (a blind-explain prompt, a five-minute-outline prompt, a " +
        'likely-objection prompt, a "what this passage does not establish" prompt, and a "defend one connection ' +
        'or give a reasoned no_warrant_yet" prompt -- see content/README.md). Add a ' +
        `"## ${REQUIRED_TEACH_BACK_HEADING}" heading with real content under it.`,
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

/** MOUNTAINWHY-001 — `content/lens/eleven-stages.json`, sibling of `content/curriculum/`. */
export const LENS_STAGES_PATH = path.join(SCRIPT_DIR, "..", "..", "..", "content", "lens", "eleven-stages.json");

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

/** `content/connections/` — sibling of `content/curriculum/`. */
export const CONNECTIONS_DIR = path.join(SCRIPT_DIR, "..", "..", "..", "content", "connections");

/** Recursively lists every `.json` file under `dir`, sorted. A missing
 * `dir` (`content/connections/` does not exist until the first connection
 * is authored) returns `[]`, never throws -- zero connections is a valid
 * state. */
export function findJsonFiles(dir: string): string[] {
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
      files.push(...findJsonFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(full);
    }
  }
  return files.sort();
}

/** Ids of `content/source-registry.json`-shaped entries at `registryPath`.
 * A missing/unreadable/malformed registry yields an empty set (so every
 * connection `sourceId` is then reported absent) -- `build.ts` separately
 * refuses to build with an unloadable registry. */
export function loadSourceRegistryIds(registryPath: string): Set<string> {
  try {
    const raw = JSON.parse(readFileSync(registryPath, "utf8")) as unknown;
    if (!Array.isArray(raw)) return new Set();
    return new Set(
      raw.flatMap((entry) =>
        typeof entry === "object" && entry !== null && typeof (entry as { id?: unknown }).id === "string"
          ? [(entry as { id: string }).id]
          : [],
      ),
    );
  } catch {
    return new Set();
  }
}

/** Real IO: reads and validates every `*.json` under `connectionsDir`
 * against the C1 schema and `registryIds` (see `validateConnectionSet`).
 * No console output, no process-exit side effects. */
export function loadConnections(connectionsDir: string, registryIds: ReadonlySet<string>): ConnectionSetResult {
  const files = findJsonFiles(connectionsDir).map((filePath) => {
    let parsed: { ok: true; value: unknown } | { ok: false; error: string };
    try {
      parsed = { ok: true, value: JSON.parse(readFileSync(filePath, "utf8")) as unknown };
    } catch (error) {
      parsed = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    return { filePath: path.relative(connectionsDir, filePath).split(path.sep).join("/"), parsed };
  });
  return validateConnectionSet(files, registryIds);
}

/** `content/places/` -- sibling of `content/curriculum/`. */
export const PLACES_DIR = path.join(SCRIPT_DIR, "..", "..", "..", "content", "places");
/** `web/public/bible/` -- the shipped corpus the place passages are bounds-checked against. */
export const BIBLE_PUBLIC_DIR = path.join(SCRIPT_DIR, "..", "..", "public", "bible");

/** A real `CanonTable` from the shipped BSB corpus (chapter counts from
 * `index.json`, verse counts from each book's own JSON) -- never a permissive
 * stub. Only called when there are place rows to check. */
export function loadRealCanonTable(bibleDir: string = BIBLE_PUBLIC_DIR): CanonTable {
  const index = JSON.parse(readFileSync(path.join(bibleDir, "index.json"), "utf8")) as BibleIndex;
  const canon = buildPassageCanon(
    index.books,
    (book) => JSON.parse(readFileSync(path.join(bibleDir, "BSB", `${book}.json`), "utf8")) as BookData,
  );
  return toCanonTable(canon);
}

function readOptionalText(filePath: string): string | null {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : null;
}

function readOptionalJson(filePath: string): { ok: true; value: unknown } | { ok: false; error: string } | undefined {
  const text = readOptionalText(filePath);
  if (text === null) return undefined;
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Real IO: reads `places.jsonl`, `DATASET.json` and `curation.json` from
 * `placesDir` and validates them (`validatePlaceSet`). A missing directory
 * (or missing files) is a valid, zero-row result. The canon is built from the
 * real corpus lazily -- only if there are rows to check -- unless `canon` is
 * injected (tests). */
export function loadPlaces(
  placesDir: string,
  registryIds: ReadonlySet<string>,
  canon?: CanonTable,
): PlaceSetResult {
  const jsonl = readOptionalText(path.join(placesDir, "places.jsonl"));
  const hasRows = jsonl !== null && jsonl.trim() !== "";
  return validatePlaceSet(
    {
      jsonl,
      dataset: readOptionalJson(path.join(placesDir, "DATASET.json")),
      curation: readOptionalJson(path.join(placesDir, "curation.json")),
    },
    registryIds,
    canon ?? (hasRows ? loadRealCanonTable() : { chapterCount: () => undefined, verseCount: () => undefined }),
  );
}

export interface RunValidationOptions {
  /** Defaults to `<curriculumDir>/../connections`. */
  connectionsDir?: string;
  /** Defaults to `<curriculumDir>/../source-registry.json`. */
  sourceRegistryPath?: string;
  /** PLACES-001. Defaults to `<curriculumDir>/../places`. */
  placesDir?: string;
  /** PLACES-001. Injected canon (tests); defaults to the real shipped corpus. */
  canon?: CanonTable;
}

export interface RunValidationResult {
  ok: boolean;
  results: LessonValidationResult[];
  /** CURATEDEDGES-002 -- every `content/connections/` problem, plus every
   * lesson `connectionIds[]` entry that names no connection file. Empty when
   * fine. Any entry here also makes `ok` false. Optional only so hand-built
   * lesson-only fixtures (tests) stay valid; `runValidation` always sets it. */
  connectionErrors?: string[];
  /** Valid connection rows loaded from `connectionsDir` (empty if none). */
  connections?: ConnectionFileRow[];
  /** PLACES-001 -- every `content/places/` problem, plus every lesson
   * `placeIds[]` entry that names no place. Any entry also makes `ok` false. */
  placeErrors?: string[];
  /** Valid, compiled places loaded from `placesDir` (empty if none). */
  places?: CompiledPlace[];
}

/** Real IO (reads every `.md` file under `curriculumDir`, every `.json`
 * under the connections dir) but no console output and no process-exit side
 * effects -- `main` below owns reporting, `build.ts` calls this directly to
 * get validated lessons. */
export function runValidation(curriculumDir: string, options: RunValidationOptions = {}): RunValidationResult {
  const files = findMarkdownFiles(curriculumDir);
  const results = files.map((filePath) => validateLessonSource(filePath, readFileSync(filePath, "utf8")));

  const connectionsDir = options.connectionsDir ?? path.resolve(curriculumDir, "..", "connections");
  const registryPath = options.sourceRegistryPath ?? path.resolve(curriculumDir, "..", "source-registry.json");
  const connectionSet = loadConnections(connectionsDir, loadSourceRegistryIds(registryPath));
  const connectionErrors = [
    ...connectionSet.errors,
    ...unresolvedLessonConnectionIds(
      results.flatMap((result) =>
        result.frontmatter
          ? [{ slug: slugForLessonFile(result.filePath, curriculumDir), connectionIds: result.frontmatter.connectionIds }]
          : [],
      ),
      new Set(connectionSet.declaredIds),
    ),
  ];

  const placesDir = options.placesDir ?? path.resolve(curriculumDir, "..", "places");
  const placeSet = loadPlaces(placesDir, loadSourceRegistryIds(registryPath), options.canon);
  const placeErrors = [
    ...placeSet.errors,
    ...unresolvedLessonPlaceIds(
      results.flatMap((result) =>
        result.frontmatter
          ? [{ slug: slugForLessonFile(result.filePath, curriculumDir), placeIds: result.frontmatter.placeIds }]
          : [],
      ),
      new Set(placeSet.declaredIds),
    ),
  ];

  return {
    ok: results.every((result) => result.ok) && connectionErrors.length === 0 && placeErrors.length === 0,
    results,
    connectionErrors,
    connections: connectionSet.connections,
    placeErrors,
    places: placeSet.places,
  };
}

function slugForLessonFile(filePath: string, curriculumDir: string): string {
  return path.relative(curriculumDir, filePath).split(path.sep).join("/").replace(/.md$/, "");
}

async function main(): Promise<void> {
  const { ok, results, connectionErrors = [], connections = [], placeErrors = [], places = [] } = runValidation(CURRICULUM_DIR);

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

  for (const error of connectionErrors) console.log(`FAIL connections: ${error}`);
  for (const error of placeErrors) console.log(`FAIL places: ${error}`);

  // MOUNTAINWHY-001 — PRODUCT_EXPERIENCE_PLAN §G4's own fix: "Extend
  // validate.ts lint to ... stage titles (stages.json moved into content/)".
  const lensMatches = lintLensFile(LENS_STAGES_PATH);
  for (const match of lensMatches) {
    console.log(
      `FAIL lens: ${match.slug} ${match.field}${match.field === "summary" ? ` line ${match.line}` : ""} reads ` +
        `like a doctrinal verdict (pattern "${match.patternId}": "${match.excerpt}")`,
    );
  }

  console.log("");
  console.log(`${results.filter((result) => result.ok).length}/${results.length} lesson file(s) valid.`);
  console.log(
    connectionErrors.length === 0
      ? `${connections.length} connection file(s) valid.`
      : `${connectionErrors.length} connection error(s).`,
  );
  console.log(placeErrors.length === 0 ? `${places.length} place(s) valid.` : `${placeErrors.length} place error(s).`);
  console.log(lensMatches.length === 0 ? "Lens content: no assertion-line lint hits." : `${lensMatches.length} lens lint error(s).`);

  if (!ok || lensMatches.length > 0) process.exitCode = 1;
}

const isMainModule = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error("[fatal] Unhandled error in content:validate:", error);
    process.exitCode = 1;
  });
}
