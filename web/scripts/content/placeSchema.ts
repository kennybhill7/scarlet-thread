/**
 * PLACES-001 — zod schema + pure set-level checks for `content/places/`, the
 * place layer (PRODUCT_EXPERIENCE_PLAN §C.1) that `npm run db:sync-places`
 * copies into the `places` / `place_candidates` / `place_passages` tables.
 *
 * Files (all generated except curation.json):
 *   - `places.jsonl`   one JSON object per place, written by
 *                      `tools/build-places.mjs` from the OpenBible.info Bible
 *                      Geocoding Data (CC BY 4.0, commit pinned).
 *   - `DATASET.json`   the dataset's provenance: pinned commit, licence, the
 *                      attribution string, counts.
 *   - `curation.json`  HAND-MAINTAINED tier / note / name overrides; the only
 *                      place a person changes what the generator computed.
 *
 * This module is pure (no filesystem / DB): `validate.ts` owns the reads
 * (`loadPlaces`), exactly the schema-vs-IO split `connectionSchema.ts` uses.
 * The canon (`CanonTable`) is INJECTED — `validate.ts` builds it from the real
 * shipped corpus (`public/bible/BSB/*`), so a passage reference is bounds
 * checked against real chapter/verse counts, never against a permissive stub.
 *
 * The honesty rules (PLAN §C.1 / G5) are enforced here, as errors, not
 * conventions:
 *   1. `unlocated` places carry NO coordinates and NO candidates; a located
 *      tier carries both coordinates (paired, in range). `kind === "unlocated"`
 *      exactly when `tier === "unlocated"`.
 *   2. `disputed` / `uncertain` places carry a note and/or candidates.
 *   3. a `region` / `route` / `water` place carries a note (its marker is one
 *      representative point, not an extent — that must be said).
 *   4. every passage reference parses (`lib/bible/osis.ts`) and is in bounds
 *      of the real canon.
 *   5. duplicate ids are rejected; every `sourceId` is in
 *      `content/source-registry.json`.
 *   6. `DATASET.json` carries the exact attribution string and a pinned
 *      40-hex commit; the place count in it matches the rows.
 *   7. notes never read like a doctrinal verdict (the shared
 *      `VERDICT_PATTERNS`, no escape hatch).
 *   8. curation.json and the generated rows agree (a stale generated file —
 *      curation edited but the builder not re-run — is an error).
 *
 * Author: Kenneth Hill
 */

import { z } from "zod";

import { parseOsis } from "@/lib/bible/osis";
import type { CanonTable } from "@/lib/bible/range";
import type { CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import { PLACE_KINDS, PLACE_TIERS } from "@/db/schema";

import { idLikeSchema, VERDICT_PATTERNS } from "./schema";

/** The exact attribution CC BY 4.0 requires to be shown (PLAN §C.8, G3). */
export const PLACES_ATTRIBUTION = "Place data © OpenBible.info, CC BY 4.0";
/** The `content/source-registry.json` / `sources` row every place cites. */
export const PLACES_SOURCE_ID = "source-openbible-geocoding";

/** Place ids are slugs: lowercase letters, digits, hyphens. */
const PLACE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;

const placeIdSchema = idLikeSchema("id").regex(PLACE_ID_RE, "id must be a slug (lowercase letters, digits, hyphens)");

const lonSchema = z.number().min(-180).max(180);
const latSchema = z.number().min(-90).max(90);

const nonEmptyText = (label: string) => z.string().trim().min(1, `${label} must not be empty`);

export const PlaceCandidateSchema = z
  .object({
    description: nonEmptyText("candidate description"),
    lon: lonSchema,
    lat: latSchema,
    score: z.number().int(),
  })
  .strict();

export const ExtraPassageSchema = z
  .object({
    osis: nonEmptyText("osis"),
    /** Why a reference the dataset does not list was added by hand. */
    note: nonEmptyText("extraPassages[].note"),
  })
  .strict();

export const PlaceRowSchema = z
  .object({
    id: placeIdSchema,
    name: nonEmptyText("name"),
    ancientId: nonEmptyText("ancientId"),
    kind: z.enum(PLACE_KINDS),
    tier: z.enum(PLACE_TIERS),
    tierBasis: z.enum(["computed", "curated"]),
    /** What the builder's rules said, recorded only when a person overrode it. */
    computedTier: z.enum(PLACE_TIERS).nullable(),
    lon: lonSchema.nullable(),
    lat: latSchema.nullable(),
    coordinateBasis: z.string().trim().min(1).nullable(),
    modernName: z.string().trim().min(1).nullable(),
    note: z.string().trim().min(1).nullable(),
    sourceId: idLikeSchema("sourceId"),
    datasetScore: z.number().int(),
    voteCount: z.number().int().min(0),
    identificationsInDataset: z.number().int().min(0),
    candidates: z.array(PlaceCandidateSchema),
    /** The dataset's own verse list, OSIS ("Gen.2.8"). */
    passages: z.array(nonEmptyText("passages[]")),
    /** References a person added in curation.json (the dataset list lacks them). */
    extraPassages: z.array(ExtraPassageSchema),
  })
  .strict()
  .superRefine((row, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    const unlocated = row.tier === "unlocated";

    if (unlocated !== (row.kind === "unlocated")) {
      issue(`kind "${row.kind}" and tier "${row.tier}" disagree: kind is "unlocated" exactly when tier is "unlocated"`);
    }
    if ((row.lon === null) !== (row.lat === null)) {
      issue("lon and lat must both be set or both be null");
    }
    if (unlocated) {
      if (row.lon !== null || row.lat !== null) issue("an unlocated place must have NO coordinates (lon/lat must be null)");
      if (row.candidates.length > 0) issue("an unlocated place must have no candidates (they would put a pin on the earth)");
      if (row.coordinateBasis !== null) issue("an unlocated place must have no coordinateBasis");
    } else if (row.lon === null || row.lat === null) {
      issue(`a "${row.tier}" place must have coordinates (lon and lat)`);
    }

    if ((row.tier === "disputed" || row.tier === "uncertain") && row.note === null && row.candidates.length === 0) {
      issue(`a ${row.tier} place must carry a plain-language note and/or candidates`);
    }
    if ((row.kind === "region" || row.kind === "route" || row.kind === "water") && row.note === null) {
      issue(`a ${row.kind} place must carry a note (its marker is one representative point, not its extent)`);
    }

    if (row.tierBasis === "curated" && row.computedTier === null) {
      issue('tierBasis "curated" requires computedTier (what the builder rules said before the override)');
    }
    if (row.tierBasis === "computed" && row.computedTier !== null) {
      issue('tierBasis "computed" must have computedTier null');
    }

    if (row.passages.length + row.extraPassages.length === 0) {
      issue("a place needs at least one passage");
    }
    const seen = new Set<string>();
    for (const osis of [...row.passages, ...row.extraPassages.map((extra) => extra.osis)]) {
      if (seen.has(osis)) issue(`duplicate passage "${osis}"`);
      seen.add(osis);
    }

    if (row.note !== null) {
      for (const pattern of VERDICT_PATTERNS) {
        const match = pattern.regex.exec(row.note);
        if (match) issue(`note reads like a doctrinal verdict (pattern "${pattern.id}": "${match[0]}")`);
      }
    }
  });

export type PlaceRow = z.infer<typeof PlaceRowSchema>;

export const PlaceDatasetSchema = z
  .object({
    name: nonEmptyText("name"),
    repo: nonEmptyText("repo"),
    page: nonEmptyText("page"),
    licence: z.literal("CC BY 4.0"),
    attribution: z.literal(PLACES_ATTRIBUTION),
    sourceId: idLikeSchema("sourceId"),
    commit: z.string().regex(COMMIT_RE, "commit must be a pinned 40-hex git sha"),
    generatedBy: nonEmptyText("generatedBy"),
    note: nonEmptyText("note"),
    tierRules: z.record(z.string(), z.number()),
    counts: z
      .object({
        datasetEntries: z.number().int().min(0),
        places: z.number().int().min(0),
        byTier: z.record(z.string(), z.number().int().min(0)),
        curated: z.number().int().min(0),
      })
      .strict(),
    excluded: z.record(z.string(), z.object({ count: z.number().int().min(0), ids: z.array(z.string()) }).strict()),
  })
  .strict();

export type PlaceDataset = z.infer<typeof PlaceDatasetSchema>;

const CurationEntrySchema = z
  .object({
    id: placeIdSchema,
    name: nonEmptyText("name").optional(),
    tier: z.enum(PLACE_TIERS).optional(),
    note: z.string().optional(),
    identificationIndex: z.number().int().min(0).optional(),
    extraPassages: z.array(ExtraPassageSchema).optional(),
  })
  .strict();

export const PlaceCurationSchema = z
  .object({
    _about: z.string().optional(),
    places: z.record(z.string(), CurationEntrySchema),
    exclude: z.record(z.string(), z.string()),
  })
  .strict();

export type PlaceCuration = z.infer<typeof PlaceCurationSchema>;

// ---------------------------------------------------------------------------
// Compiled rows — what `db:sync-places` writes (ranges resolved).
// ---------------------------------------------------------------------------

export interface CompiledPlacePassage {
  range: CanonicalRangeV1;
  inDatasetVerseList: boolean;
  note: string | null;
}

export interface CompiledPlace {
  id: string;
  name: string;
  ancientId: string;
  kind: PlaceRow["kind"];
  tier: PlaceRow["tier"];
  lon: number | null;
  lat: number | null;
  coordinateBasis: string | null;
  modernName: string | null;
  note: string | null;
  sourceId: string;
  datasetScore: number;
  voteCount: number;
  identificationsInDataset: number;
  candidates: { description: string; lon: number; lat: number; score: number }[];
  passages: CompiledPlacePassage[];
}

/**
 * Resolves every OSIS reference of `row` to a `CanonicalRangeV1` with the REAL
 * canon. Returns the compiled place, or one error string per reference that
 * does not parse / is out of bounds. Never throws.
 */
export function compilePlace(row: PlaceRow, canon: CanonTable): { ok: true; place: CompiledPlace } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const passages: CompiledPlacePassage[] = [];
  const seenRanges = new Set<string>();
  const add = (osis: string, inDatasetVerseList: boolean, note: string | null) => {
    const range = parseOsis(osis, canon);
    if (range === null) {
      errors.push(`passage "${osis}" is not a valid in-bounds reference in the canon`);
      return;
    }
    // place_passages is UNIQUE (place_id, range): two spellings of one range would violate it at sync time.
    const key = `${range.start}-${range.end}`;
    if (seenRanges.has(key)) {
      errors.push(`passage "${osis}" resolves to a range (${key}) this place already has`);
      return;
    }
    seenRanges.add(key);
    passages.push({ range, inDatasetVerseList, note });
  };
  for (const osis of row.passages) add(osis, true, null);
  for (const extra of row.extraPassages) add(extra.osis, false, extra.note);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    place: {
      id: row.id,
      name: row.name,
      ancientId: row.ancientId,
      kind: row.kind,
      tier: row.tier,
      lon: row.lon,
      lat: row.lat,
      coordinateBasis: row.coordinateBasis,
      modernName: row.modernName,
      note: row.note,
      sourceId: row.sourceId,
      datasetScore: row.datasetScore,
      voteCount: row.voteCount,
      identificationsInDataset: row.identificationsInDataset,
      candidates: row.candidates.map((candidate) => ({ ...candidate })),
      passages,
    },
  };
}

// ---------------------------------------------------------------------------
// The whole set
// ---------------------------------------------------------------------------

export interface PlaceSetInput {
  /** `places.jsonl` text, or null when the file does not exist. */
  jsonl: string | null;
  /** Parsed `DATASET.json`, `undefined` when the file does not exist, or a parse-failure message. */
  dataset: { ok: true; value: unknown } | { ok: false; error: string } | undefined;
  /** Parsed `curation.json`, `undefined` when absent. */
  curation: { ok: true; value: unknown } | { ok: false; error: string } | undefined;
}

export interface PlaceSetResult {
  ok: boolean;
  places: CompiledPlace[];
  /** Every id that parsed out of a row, even one that failed a later rule. */
  declaredIds: string[];
  errors: string[];
}

/**
 * Validates a whole `content/places/` directory's contents. No `places.jsonl`
 * (or an empty one) and no DATASET.json is a valid, zero-row result — the
 * directory does not have to exist. Rows without a DATASET.json (no
 * attribution) are an error.
 */
export function validatePlaceSet(input: PlaceSetInput, registryIds: ReadonlySet<string>, canon: CanonTable): PlaceSetResult {
  const errors: string[] = [];
  const places: CompiledPlace[] = [];
  const declared = new Map<string, number>();
  const rowsById = new Map<string, PlaceRow>();

  const lines = (input.jsonl ?? "").split(/\r?\n/);
  const nonBlank = lines.map((text, index) => ({ text, line: index + 1 })).filter((entry) => entry.text.trim() !== "");

  // ---- DATASET.json (attribution + pinned commit) ----
  let dataset: PlaceDataset | null = null;
  if (input.dataset === undefined) {
    if (nonBlank.length > 0) {
      errors.push("DATASET.json: missing -- places.jsonl needs DATASET.json for the pinned dataset commit and the CC BY 4.0 attribution");
    }
  } else if (!input.dataset.ok) {
    errors.push(`DATASET.json: invalid JSON (${input.dataset.error})`);
  } else {
    const parsed = PlaceDatasetSchema.safeParse(input.dataset.value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push(`DATASET.json: ${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`);
    } else {
      dataset = parsed.data;
    }
  }

  // ---- rows ----
  for (const { text, line } of nonBlank) {
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch (error) {
      errors.push(`places.jsonl line ${line}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const parsed = PlaceRowSchema.safeParse(value);
    if (!parsed.success) {
      const label = typeof (value as { id?: unknown } | null)?.id === "string" ? ` (${(value as { id: string }).id})` : "";
      for (const issue of parsed.error.issues) {
        errors.push(`places.jsonl line ${line}${label}: ${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`);
      }
      const id = (value as { id?: unknown } | null)?.id;
      if (typeof id === "string" && !declared.has(id)) declared.set(id, line);
      continue;
    }
    const row = parsed.data;
    const first = declared.get(row.id);
    if (first !== undefined) {
      errors.push(`places.jsonl line ${line} (${row.id}): duplicate place id (first declared on line ${first})`);
      continue;
    }
    declared.set(row.id, line);
    rowsById.set(row.id, row);

    if (!registryIds.has(row.sourceId)) {
      errors.push(`places.jsonl line ${line} (${row.id}): sourceId "${row.sourceId}" is absent from content/source-registry.json`);
      continue;
    }
    if (dataset !== null && row.sourceId !== dataset.sourceId) {
      errors.push(`places.jsonl line ${line} (${row.id}): sourceId "${row.sourceId}" differs from DATASET.json sourceId "${dataset.sourceId}"`);
      continue;
    }

    const compiled = compilePlace(row, canon);
    if (!compiled.ok) {
      for (const error of compiled.errors) errors.push(`places.jsonl line ${line} (${row.id}): ${error}`);
      continue;
    }
    places.push(compiled.place);
  }

  if (dataset !== null && dataset.counts.places !== nonBlank.length) {
    errors.push(`DATASET.json: counts.places is ${dataset.counts.places} but places.jsonl has ${nonBlank.length} row(s) -- regenerate with tools/build-places.mjs`);
  }
  if (dataset !== null && !registryIds.has(dataset.sourceId)) {
    errors.push(`DATASET.json: sourceId "${dataset.sourceId}" is absent from content/source-registry.json`);
  }

  // ---- curation.json vs the generated rows ----
  if (input.curation !== undefined) {
    if (!input.curation.ok) {
      errors.push(`curation.json: invalid JSON (${input.curation.error})`);
    } else {
      const parsed = PlaceCurationSchema.safeParse(input.curation.value);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) errors.push(`curation.json: ${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`);
      } else if (nonBlank.length > 0) {
        const curatedIds = new Set<string>();
        for (const [friendlyId, entry] of Object.entries(parsed.data.places)) {
          curatedIds.add(entry.id);
          const row = rowsById.get(entry.id);
          if (row === undefined) {
            if (declared.has(entry.id)) continue; // present but failed schema: already reported
            errors.push(`curation.json "${friendlyId}": id "${entry.id}" is not in places.jsonl -- regenerate with tools/build-places.mjs`);
            continue;
          }
          if (entry.tier !== undefined && (row.tier !== entry.tier || row.tierBasis !== "curated")) {
            errors.push(`curation.json "${friendlyId}": tier "${entry.tier}" is not what places.jsonl has for "${entry.id}" (${row.tier}, ${row.tierBasis}) -- regenerate with tools/build-places.mjs`);
          }
          if (entry.note !== undefined && (row.note ?? "") !== entry.note.trim()) {
            errors.push(`curation.json "${friendlyId}": note differs from places.jsonl for "${entry.id}" -- regenerate with tools/build-places.mjs`);
          }
          if (entry.name !== undefined && row.name !== entry.name) {
            errors.push(`curation.json "${friendlyId}": name differs from places.jsonl for "${entry.id}" -- regenerate with tools/build-places.mjs`);
          }
        }
        for (const row of rowsById.values()) {
          if (row.tierBasis === "curated" && !curatedIds.has(row.id)) {
            errors.push(`places.jsonl (${row.id}): tierBasis "curated" but curation.json has no entry for it`);
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, places, declaredIds: [...declared.keys()], errors };
}

/**
 * Lesson `placeIds[]` entries that name no place. `lessons` is
 * `{ slug, placeIds }` per lesson; `knownIds` is every declared place id. One
 * error string per (lesson, unresolved id), in input order.
 */
export function unresolvedLessonPlaceIds(
  lessons: readonly { slug: string; placeIds: readonly string[] }[],
  knownIds: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  for (const lesson of lessons) {
    for (const id of lesson.placeIds) {
      if (!knownIds.has(id)) {
        errors.push(`lesson ${lesson.slug}: placeIds[] "${id}" names no place in content/places/places.jsonl`);
      }
    }
  }
  return errors;
}
