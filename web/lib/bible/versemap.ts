/**
 * Cross-version verse alignment for the parallel (side-by-side) reader.
 *
 * 1,187 of the Bible's 1,189 chapters align 1:1 between every bundled version.
 * The exceptions are real: the Spanish text (SBL) places Paul's closing
 * doxology at Romans 14:24-26, where English editions following the critical
 * text place it at Romans 16:25-27. That is a textual-tradition difference,
 * not a translation choice, and it is documented in
 * tools/versification-report.md and encoded by tools/build_spanish.py into
 * /public/bible/versemap.json.
 *
 * This module is the ONLY place that is allowed to assume alignment. Every
 * other verse-by-verse comparison must go through alignChapter() rather than
 * zipping two verse arrays by index — a silent off-by-one here reads as a
 * translation being wrong, when the translation is fine and the assumption
 * was not.
 *
 * Fail-closed contract: a chapter can be in one of three divergence states —
 * confirmed non-divergent, confirmed divergent (with alignment data), or
 * unknown because the map failed to load. The third state must never be
 * treated as the first. chapterMayDiverge() and getDivergenceStatus() report
 * "unknown" as "may diverge"; alignChapter() throws VerseMapUnavailableError
 * rather than handing back an identity zip that looks just as confident as a
 * real alignment. divergenceNote() surfaces a generic warning in the same
 * failure case so the existing note UI in the reader carries it without any
 * caller changes.
 *
 * "Failed to load" is deliberately broad. Transport failure (network error,
 * non-2xx) and unparseable JSON are the obvious cases, but the dangerous one
 * is a response that parses fine and is *structurally wrong* — a partial or
 * stale deploy of versemap.json serving `{}`, `null`, or an entry missing
 * divergentChapters. Those parse as "loaded", and without a shape check they
 * read as "loaded, and it confirms no divergence" — which is the exact silent
 * misalignment this module exists to prevent (English 16:25-27 paired against
 * the blank Spanish 16:25 slot, 27 confident identity rows, no warning). So
 * the payload is validated against the minimum shape below and anything that
 * does not satisfy it takes the same fail-closed path as a dead network.
 *
 * Track A owns this file.
 */

import type { RefKey, VersionId } from "@/lib/contracts";
import { parseKey, verseKey } from "@/lib/bible/reference";
import { fetchWithCache } from "@/lib/bible/loader";

interface VersionVerseMap {
  comparedTo: VersionId;
  toEnglish: Record<string, string | null>;
  toSpanish: Record<string, string>;
  notes: Record<string, string>;
  divergentChapters: string[];
}

type VerseMapFile = Partial<Record<VersionId, VersionVerseMap>>;

type VerseMapLoadResult =
  | { ok: true; maps: VerseMapFile }
  | { ok: false; maps: Record<string, never>; reason: string };

/**
 * The versions this module knows how to align through the map. Today only the
 * Spanish text diverges, and tools/build_spanish.py emits exactly one entry
 * ("SBL"). alignChapter() short-circuits to identity for any pair that
 * touches none of these WITHOUT consulting the map at all — that is what
 * keeps the 1,187-chapter path a cheap identity zip and what lets an
 * English-vs-English pairing keep working while the map is unavailable.
 *
 * Because that short-circuit runs before the load, a second divergent version
 * added to versemap.json but NOT added here would be silently mis-aligned.
 * validateVerseMap() closes that hole from the other side: any loaded entry
 * that declares divergent chapters while not listed here fails the whole load
 * closed, loudly, instead of being skipped.
 */
const DIVERGENT_VERSIONS: readonly VersionId[] = ["SBL"];

/** Thrown by alignChapter() when the map could not be loaded and the pair involves a version with known divergence, so alignment status is unknown rather than confirmed identity. */
export class VerseMapUnavailableError extends Error {
  readonly chapterKey: RefKey;

  constructor(chapterKey: RefKey, reason?: string) {
    super(
      `Verse alignment map failed to load; cannot confirm divergence status for chapter ${chapterKey}` +
        (reason ? ` (${reason})` : ""),
    );
    this.name = "VerseMapUnavailableError";
    this.chapterKey = chapterKey;
  }
}

function unavailable(reason: string): VerseMapLoadResult {
  return { ok: false, maps: {}, reason };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown, allowNullValues: boolean): boolean {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every(
    (entry) => typeof entry === "string" || (allowNullValues && entry === null),
  );
}

/**
 * The minimum shape that counts as a usable verse map. Anything short of this
 * is treated as UNAVAILABLE, not as "loaded and confirms no divergence":
 *
 *   1. The payload is a non-null, non-array object. (`null` and `[]` out.)
 *   2. It is not empty. tools/build_spanish.py always emits at least the
 *      "SBL" entry, so `{}` is never a legitimate build output — it is a
 *      partial/stale/truncated deploy, and it is precisely the payload that
 *      would otherwise read as "no divergence anywhere".
 *   3. Every entry is a well-formed VersionVerseMap: `comparedTo` a string,
 *      `divergentChapters` an array of strings, and `toEnglish` /
 *      `toSpanish` / `notes` string-keyed records (toEnglish may map to null
 *      to declare a verse with no counterpart). A missing or wrong-typed key
 *      here is what previously produced a raw TypeError out of
 *      `divergentChapters.includes(...)` instead of the declared failure.
 *   4. Every entry that declares divergent chapters is a version this module
 *      knows how to align (DIVERGENT_VERSIONS). See the note there.
 *   5. Every version listed in DIVERGENT_VERSIONS is present. The map's whole
 *      job is to carry the Spanish divergence; a payload that dropped it
 *      cannot confirm alignment for the parallel pane, so "absent" must mean
 *      unknown rather than clean.
 */
function validateVerseMap(payload: unknown): VerseMapLoadResult {
  if (!isPlainObject(payload)) {
    return unavailable("payload is not an object");
  }

  const entries = Object.entries(payload);
  if (entries.length === 0) {
    return unavailable("payload declares no versions");
  }

  for (const [version, entry] of entries) {
    if (!isPlainObject(entry)) {
      return unavailable(`entry "${version}" is not an object`);
    }
    if (typeof entry.comparedTo !== "string") {
      return unavailable(`entry "${version}" is missing comparedTo`);
    }
    const divergentChapters: unknown = entry.divergentChapters;
    if (
      !Array.isArray(divergentChapters) ||
      !divergentChapters.every((chapter: unknown) => typeof chapter === "string")
    ) {
      return unavailable(`entry "${version}" is missing a valid divergentChapters array`);
    }
    if (!isStringRecord(entry.toEnglish, true)) {
      return unavailable(`entry "${version}" is missing a valid toEnglish map`);
    }
    if (!isStringRecord(entry.toSpanish, false)) {
      return unavailable(`entry "${version}" is missing a valid toSpanish map`);
    }
    if (!isStringRecord(entry.notes, false)) {
      return unavailable(`entry "${version}" is missing a valid notes map`);
    }
    if (divergentChapters.length > 0 && !DIVERGENT_VERSIONS.includes(version as VersionId)) {
      return unavailable(
        `entry "${version}" declares divergent chapters but this build can only align ${DIVERGENT_VERSIONS.join(", ")}`,
      );
    }
  }

  for (const version of DIVERGENT_VERSIONS) {
    if (!Object.prototype.hasOwnProperty.call(payload, version)) {
      return unavailable(`payload is missing the "${version}" entry`);
    }
  }

  return { ok: true, maps: payload as VerseMapFile };
}

/**
 * Only a SUCCESSFUL load is memoized for the life of the module. A failure
 * used to be memoized too, which meant one bad fetch — an offline app start
 * before the retry below ever got a chance to run, say — disabled the
 * Spanish pane for the whole session, with no retry until a full page reload
 * (module state survives client-side navigation).
 *
 * The fetch itself goes through lib/bible/loader.ts's fetchWithCache() (the
 * same cache-then-network path index.json and book files use, cache
 * bible-brain-scripture-v1) rather than a bare fetch(), so versemap.json is
 * available offline once it has been fetched or prefetched once — a bare
 * fetch() here used to mean an offline app launch lost the Spanish parallel
 * pane for every one of the 1,189 chapters, not just Romans 14/16
 * (VMCACHE-001).
 *
 * Failures now clear the memo so the next call re-fetches, with two brakes on
 * a hammering caller: an in-flight promise is still shared, so N concurrent
 * callers cost exactly one fetch; and after a failure settles, calls inside
 * RETRY_COOLDOWN_MS reuse the failure result without touching the network.
 */
let mapPromise: Promise<VerseMapLoadResult> | null = null;
let lastFailure: { at: number; result: VerseMapLoadResult } | null = null;
let retryCooldownMs = 3_000;

function loadVerseMap(): Promise<VerseMapLoadResult> {
  if (mapPromise) return mapPromise;

  if (lastFailure && Date.now() - lastFailure.at < retryCooldownMs) {
    return Promise.resolve(lastFailure.result);
  }

  const pending: Promise<VerseMapLoadResult> = fetchWithCache("/bible/versemap.json")
    .then(async (response) => {
      if (!response.ok) return unavailable(`HTTP ${response.status}`);
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return unavailable("response body is not valid JSON");
      }
      return validateVerseMap(payload);
    })
    .catch((error: unknown) => unavailable(error instanceof Error ? error.message : "network error"))
    .then((result) => {
      if (result.ok) {
        lastFailure = null;
      } else {
        // Drop the memo so the very next call retries instead of inheriting a
        // dead map forever; remember the failure only for the cooldown window.
        lastFailure = { at: Date.now(), result };
        if (mapPromise === pending) mapPromise = null;
      }
      return result;
    });

  mapPromise = pending;
  return pending;
}

/** @internal test-only: forces the next loadVerseMap() call to re-fetch instead of reusing a cached result. */
export function __resetVerseMapCacheForTests(): void {
  mapPromise = null;
  lastFailure = null;
  retryCooldownMs = 3_000;
}

/** @internal test-only: shortens (or disables, with 0) the post-failure retry cooldown. */
export function __setVerseMapRetryCooldownForTests(ms: number): void {
  retryCooldownMs = ms;
}

export type DivergenceStatus = "no-divergence" | "diverges" | "unknown";

async function resolveDivergence(chapterKey: RefKey): Promise<DivergenceStatus> {
  const result = await loadVerseMap();
  if (!result.ok) return "unknown";
  // Safe to read divergentChapters directly: validateVerseMap() has already
  // proved every entry carries one as an array of strings.
  const diverges = Object.values(result.maps).some((m) => m?.divergentChapters.includes(chapterKey));
  return diverges ? "diverges" : "no-divergence";
}

/**
 * Reports one of three states for a chapter, kept distinct on purpose: the
 * map loaded and confirms no divergence, the map loaded and confirms
 * divergence, or the map failed to load and divergence is unknown. Callers
 * must not collapse "unknown" into "no-divergence".
 */
export async function getDivergenceStatus(chapterKey: RefKey): Promise<DivergenceStatus> {
  return resolveDivergence(chapterKey);
}

/**
 * True if this chapter has a known divergence in some bundled version, OR if
 * the map could not be loaded and divergence status is therefore unknown
 * (fail closed — treated the same as "may diverge"). The reader uses this to
 * decide whether to fetch alignment data at all — most chapters never need
 * to, but "map unavailable" must never be read as "safe to skip".
 */
export async function chapterMayDiverge(chapterKey: RefKey): Promise<boolean> {
  return (await resolveDivergence(chapterKey)) !== "no-divergence";
}

export interface AlignedRow {
  /** Verse number in the "from" version, or null if this row has no source there. */
  fromVerse: number | null;
  /** Corresponding key in the "to" version, or null if there is no counterpart. */
  toKey: RefKey | null;
}

/**
 * Produces the row-by-row pairing for one chapter between two versions. For
 * the 1,187 unaffected chapters this is just an identity zip — cheap and
 * correct. For Romans 14/16 it consults the declared map instead of guessing.
 *
 * `fromVersion` is only used to pick the correct direction (ES->EN or
 * EN->ES) out of the stored map; the map itself is keyed by the divergent
 * version since that's the only side with divergence today.
 *
 * Throws VerseMapUnavailableError instead of returning an identity zip when
 * the pair involves a version with recorded divergence and the map failed to
 * load or failed its shape check — an identity zip returned here would look
 * exactly like a confirmed alignment, silently mispairing verses for a
 * genuinely divergent chapter. Pairs that never involve a version with
 * recorded divergence (e.g. two English versions) are unaffected by map load
 * status and still resolve to identity without touching the map.
 */
export async function alignChapter(
  fromVersion: VersionId,
  toVersion: VersionId,
  chapterKey: RefKey,
  fromVerseCount: number,
): Promise<AlignedRow[]> {
  const parsed = parseKey(chapterKey);

  const identity: AlignedRow[] = Array.from({ length: fromVerseCount }, (_, i) => {
    const verse = i + 1;
    const toKey = parsed ? verseKey(parsed.book, parsed.chapter, verse) : null;
    return { fromVerse: verse, toKey };
  });

  const divergentSides = DIVERGENT_VERSIONS.filter(
    (version) => version === fromVersion || version === toVersion,
  );
  // No divergent version on either side: nothing the map could change. Return
  // identity without a load — this is the 1,187-chapter fast path.
  if (divergentSides.length === 0) return identity;
  // Both sides divergent (impossible today, one entry in DIVERGENT_VERSIONS):
  // composing two divergence maps is not implemented, so fail closed rather
  // than picking one arbitrarily.
  if (divergentSides.length > 1) {
    throw new VerseMapUnavailableError(
      chapterKey,
      `cannot align two divergent versions (${fromVersion} vs ${toVersion})`,
    );
  }
  const divergentVersion = divergentSides[0];

  const result = await loadVerseMap();
  if (!result.ok) {
    throw new VerseMapUnavailableError(chapterKey, result.reason);
  }
  // validateVerseMap() guarantees every DIVERGENT_VERSIONS entry exists and is
  // well-formed, so this is a real map, never undefined.
  const divergentSide = result.maps[divergentVersion];

  if (!divergentSide || !divergentSide.divergentChapters.includes(chapterKey)) {
    return identity;
  }
  if (!parsed) return identity;

  // The divergent version is the "from" side: walk its verses through
  // toEnglish. Its own orphan verses (toEnglish -> null) surface naturally in
  // the main loop below, at their own verse number, so no extra pass is
  // needed there.
  //
  // English is the "from" side: walk through toSpanish, but that only
  // produces a row per ENGLISH verse -- it can't also produce the blank-slot
  // Spanish verse (16:25 in this text: numbered but textless, its content
  // relocated to 14:24-26) since no English verse maps onto it. That has to
  // be added as an explicit gap row, scoped to keys inside this same chapter
  // so an unrelated future divergence elsewhere can't leak a stray row in.
  const fromIsDivergent = fromVersion === divergentVersion;
  const direction = fromIsDivergent ? divergentSide.toEnglish : divergentSide.toSpanish;
  const gapKeys = fromIsDivergent
    ? []
    : Object.entries(divergentSide.toEnglish)
        .filter(([source, target]) => target === null && source.startsWith(`${chapterKey}.`))
        .map(([source]) => source);

  const rows: AlignedRow[] = [];

  for (let verse = 1; verse <= fromVerseCount; verse += 1) {
    const key = verseKey(parsed.book, parsed.chapter, verse);
    const mapped = Object.prototype.hasOwnProperty.call(direction, key) ? direction[key] : key;
    rows.push({ fromVerse: verse, toKey: mapped });
  }

  // gapKeys is already scoped to the English->divergent direction and this
  // chapter (see above) -- empty, and this a no-op, in every other case.
  for (const key of gapKeys) {
    rows.push({ fromVerse: null, toKey: key });
  }

  return rows;
}

/**
 * The explanatory note for a divergent chapter, or null if it aligns
 * cleanly. If the map failed to load, returns a generic warning instead of
 * null so the reader's existing note UI carries it — divergence status is
 * unknown, so every chapter gets the warning rather than none of them. It
 * never throws: ChapterReader calls it without a .catch().
 */
export async function divergenceNote(chapterKey: RefKey): Promise<string | null> {
  const result = await loadVerseMap();
  if (!result.ok) {
    return "Verse alignment data is unavailable right now — the parallel view for this chapter may not line up correctly.";
  }
  for (const map of Object.values(result.maps)) {
    if (map?.notes[chapterKey]) return map.notes[chapterKey];
  }
  return null;
}
