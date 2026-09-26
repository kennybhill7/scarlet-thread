/**
 * CURATEDEDGES-002 — zod schema + pure set-level checks for
 * `content/connections/<slug>.json`, the authored, human-reviewed connection
 * rows that become `graph_edges` rows with `review_status = 'reviewed'`
 * (`db:sync-connections`). Frozen contract "C1":
 *
 * ```json
 * {
 *   "id": "conn-gen3-adam-romans5",
 *   "fromRange": { "versificationId": "...", "start": "1.3.1", "end": "1.3.24" },
 *   "toRange":   { "versificationId": "...", "start": "45.5.12", "end": "45.5.21" },
 *   "type": "type_antitype",
 *   "evidenceLabel": "explicit",
 *   "rationale": "2-4 sentences, no verdict language ...",
 *   "sourceId": "source-...",
 *   "viewpointId": null
 * }
 * ```
 *
 * One connection per file. Pure, no filesystem/DB access — `validate.ts`
 * owns the directory walk (`loadConnections`), exactly the logic-vs-IO split
 * `schema.ts`/`validate.ts` already use.
 *
 * Deliberate restrictions beyond the C1 shape:
 *  - `type` may not be `personal_resonance` (BUILD_PLAN §3.3: personal
 *    overlays stay in `user_connections`, "never written" to `graph_edges`).
 *  - `rationale` is scanned with the same `VERDICT_PATTERNS` the lesson-body
 *    lint uses. Unlike a lesson body there is no `## Positions` / quoted-source
 *    escape hatch and no `assertionReviewed` key: a rationale states why THIS
 *    type at THIS strength, never a doctrinal verdict.
 *
 * Author: Kenneth Hill
 */

import { z } from "zod";

import { CONNECTION_TYPES, EVIDENCE_LABELS } from "@/lib/contracts/study-v2";

import { CanonicalRangeV1Schema, idLikeSchema, normalizeFrontmatterPassage, VERDICT_PATTERNS } from "./schema";

/** A range field: `versificationId` may be omitted (defaults to the one
 * versification this contract speaks, same as lesson `passage`); a
 * mismatched explicit one is still an error. */
const rangeField = z.preprocess(normalizeFrontmatterPassage, CanonicalRangeV1Schema);

export const ConnectionFileSchema = z
  .object({
    id: idLikeSchema("id"),
    fromRange: rangeField,
    toRange: rangeField,
    type: z.enum(CONNECTION_TYPES).refine((type) => type !== "personal_resonance", {
      message: 'type "personal_resonance" is a personal overlay (user_connections) and may never be a curated graph_edges row',
    }),
    evidenceLabel: z.enum(EVIDENCE_LABELS),
    rationale: z
      .string()
      .trim()
      .min(1, "rationale must not be empty")
      .superRefine((text, ctx) => {
        for (const pattern of VERDICT_PATTERNS) {
          const match = pattern.regex.exec(text);
          if (match) {
            ctx.addIssue({
              code: "custom",
              message:
                `rationale reads like a doctrinal verdict (pattern "${pattern.id}": "${match[0]}") -- ` +
                "state why THIS type at THIS strength, not what the passage proves",
            });
          }
        }
      }),
    sourceId: idLikeSchema("sourceId"),
    viewpointId: idLikeSchema("viewpointId").nullable().default(null),
  })
  .strict();

export type ConnectionFileRow = z.infer<typeof ConnectionFileSchema>;

export type ConnectionParseResult =
  | { ok: true; connection: ConnectionFileRow }
  | { ok: false; errors: string[] };

/** Validates one parsed `content/connections/*.json` value. Every zod issue
 * becomes one `"<dot.path>: <message>"` string; a non-object (including an
 * array — one connection per file) is a single root error. */
export function parseConnectionFile(raw: unknown): ConnectionParseResult {
  if (Array.isArray(raw)) {
    return { ok: false, errors: ["(root): a connection file holds exactly one connection object, not an array"] };
  }
  const result = ConnectionFileSchema.safeParse(raw);
  if (result.success) return { ok: true, connection: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`),
  };
}

export interface ConnectionSourceFile {
  filePath: string;
  /** The parsed JSON value, or a JSON parse failure message. */
  parsed: { ok: true; value: unknown } | { ok: false; error: string };
}

export interface ConnectionSetResult {
  ok: boolean;
  /** Valid connection rows, in input (file-sorted) order. */
  connections: ConnectionFileRow[];
  /** Every id that parsed out of some file, even one that failed a later
   * cross-file rule -- so a lesson referencing it is not ALSO reported as
   * naming a nonexistent file. */
  declaredIds: string[];
  /** Every error, already prefixed with its file path. */
  errors: string[];
}

/**
 * Validates every file of a `content/connections/` set: schema, then the
 * two cross-file rules — no duplicate `id`, and every `sourceId` present in
 * `registryIds` (the ids of `content/source-registry.json`). An empty input
 * (no `content/connections/` directory yet) is a valid, zero-row result.
 */
export function validateConnectionSet(
  files: readonly ConnectionSourceFile[],
  registryIds: ReadonlySet<string>,
): ConnectionSetResult {
  const errors: string[] = [];
  const connections: ConnectionFileRow[] = [];
  const firstFileForId = new Map<string, string>();

  for (const file of files) {
    if (!file.parsed.ok) {
      errors.push(`${file.filePath}: invalid JSON (${file.parsed.error})`);
      continue;
    }
    const result = parseConnectionFile(file.parsed.value);
    if (!result.ok) {
      for (const error of result.errors) errors.push(`${file.filePath}: ${error}`);
      continue;
    }
    const connection = result.connection;
    let fileOk = true;

    const earlier = firstFileForId.get(connection.id);
    if (earlier !== undefined) {
      errors.push(`${file.filePath}: duplicate connection id "${connection.id}" (already defined in ${earlier})`);
      fileOk = false;
    } else {
      firstFileForId.set(connection.id, file.filePath);
    }

    if (!registryIds.has(connection.sourceId)) {
      errors.push(
        `${file.filePath}: sourceId "${connection.sourceId}" is absent from content/source-registry.json`,
      );
      fileOk = false;
    }

    if (fileOk) connections.push(connection);
  }

  return { ok: errors.length === 0, connections, declaredIds: [...firstFileForId.keys()], errors };
}

/**
 * Lesson `connectionIds[]` entries that name no connection. `lessons` is
 * `{ slug, connectionIds }` per lesson; `knownIds` is every valid connection
 * id. One error string per (lesson, unresolved id), in input order.
 */
export function unresolvedLessonConnectionIds(
  lessons: readonly { slug: string; connectionIds: readonly string[] }[],
  knownIds: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  for (const lesson of lessons) {
    for (const id of lesson.connectionIds) {
      if (!knownIds.has(id)) {
        errors.push(`lesson ${lesson.slug}: connectionIds[] "${id}" names no file in content/connections/`);
      }
    }
  }
  return errors;
}
