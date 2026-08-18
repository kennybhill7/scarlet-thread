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
 * Track A owns this file.
 */

import type { RefKey, VersionId } from "@/lib/contracts";
import { parseKey, verseKey } from "@/lib/bible/reference";

interface VersionVerseMap {
  comparedTo: VersionId;
  toEnglish: Record<string, string | null>;
  toSpanish: Record<string, string>;
  notes: Record<string, string>;
  divergentChapters: string[];
}

type VerseMapFile = Partial<Record<VersionId, VersionVerseMap>>;

interface VerseMapLoadResult {
  ok: boolean;
  maps: VerseMapFile;
}

/** Thrown by alignChapter() when the map could not be loaded and the pair involves a version with known divergence, so alignment status is unknown rather than confirmed identity. */
export class VerseMapUnavailableError extends Error {
  readonly chapterKey: RefKey;

  constructor(chapterKey: RefKey) {
    super(`Verse alignment map failed to load; cannot confirm divergence status for chapter ${chapterKey}`);
    this.name = "VerseMapUnavailableError";
    this.chapterKey = chapterKey;
  }
}

let mapPromise: Promise<VerseMapLoadResult> | null = null;

function loadVerseMap(): Promise<VerseMapLoadResult> {
  if (!mapPromise) {
    mapPromise = fetch("/bible/versemap.json")
      .then(async (response) => {
        if (!response.ok) return { ok: false, maps: {} };
        try {
          const maps = (await response.json()) as VerseMapFile;
          return { ok: true, maps };
        } catch {
          return { ok: false, maps: {} }; // malformed/unparseable JSON
        }
      })
      .catch(() => ({ ok: false, maps: {} })); // network error
  }
  return mapPromise;
}

/** @internal test-only: forces the next loadVerseMap() call to re-fetch instead of reusing a cached result. */
export function __resetVerseMapCacheForTests(): void {
  mapPromise = null;
}

export type DivergenceStatus = "no-divergence" | "diverges" | "unknown";

async function resolveDivergence(chapterKey: RefKey): Promise<DivergenceStatus> {
  const result = await loadVerseMap();
  if (!result.ok) return "unknown";
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
 * EN->ES) out of the stored map; the map itself is keyed by the Spanish
 * version since that's the only side with divergence today.
 *
 * Throws VerseMapUnavailableError instead of returning an identity zip when
 * the pair involves the Spanish version and the map failed to load — an
 * identity zip returned here would look exactly like a confirmed alignment,
 * silently mispairing verses for a genuinely divergent chapter. Pairs that
 * never involve a version with recorded divergence (e.g. two English
 * versions) are unaffected by map load status and still resolve to identity.
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

  const involvesSpanish = fromVersion === "SBL" || toVersion === "SBL";
  if (!involvesSpanish) return identity;

  const result = await loadVerseMap();
  if (!result.ok) {
    throw new VerseMapUnavailableError(chapterKey);
  }
  const spanishSide = result.maps["SBL"];

  if (!spanishSide || !spanishSide.divergentChapters.includes(chapterKey)) {
    return identity;
  }
  if (!parsed) return identity;

  // Spanish is the "from" side: walk its verses through toEnglish. Its own
  // orphan verses (toEnglish -> null) surface naturally in the main loop
  // below, at their own verse number, so no extra pass is needed there.
  //
  // English is the "from" side: walk through toSpanish, but that only
  // produces a row per ENGLISH verse -- it can't also produce the blank-slot
  // Spanish verse (16:25 in this text: numbered but textless, its content
  // relocated to 14:24-26) since no English verse maps onto it. That has to
  // be added as an explicit gap row, scoped to keys inside this same chapter
  // so an unrelated future divergence elsewhere can't leak a stray row in.
  const direction = fromVersion === "SBL" ? spanishSide.toEnglish : spanishSide.toSpanish;
  const gapKeys =
    fromVersion === "SBL"
      ? []
      : Object.entries(spanishSide.toEnglish)
          .filter(([source, target]) => target === null && source.startsWith(`${chapterKey}.`))
          .map(([source]) => source);

  const rows: AlignedRow[] = [];

  for (let verse = 1; verse <= fromVerseCount; verse += 1) {
    const key = verseKey(parsed.book, parsed.chapter, verse);
    const mapped = Object.prototype.hasOwnProperty.call(direction, key) ? direction[key] : key;
    rows.push({ fromVerse: verse, toKey: mapped });
  }

  // gapKeys is already scoped to the English->Spanish direction and this
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
 * unknown, so every chapter gets the warning rather than none of them.
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
