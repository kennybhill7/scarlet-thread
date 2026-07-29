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

let mapPromise: Promise<VerseMapFile> | null = null;

function loadVerseMap(): Promise<VerseMapFile> {
  if (!mapPromise) {
    mapPromise = fetch("/bible/versemap.json")
      .then((response) => (response.ok ? response.json() : {}))
      .catch(() => ({}));
  }
  return mapPromise;
}

/**
 * True if this chapter has a known divergence in some bundled version. The
 * reader uses this to decide whether to fetch alignment data at all — most
 * chapters never need to.
 */
export async function chapterMayDiverge(chapterKey: RefKey): Promise<boolean> {
  const maps = await loadVerseMap();
  return Object.values(maps).some((m) => m?.divergentChapters.includes(chapterKey));
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
 */
export async function alignChapter(
  fromVersion: VersionId,
  toVersion: VersionId,
  chapterKey: RefKey,
  fromVerseCount: number,
): Promise<AlignedRow[]> {
  const maps = await loadVerseMap();
  const involvesSpanish = fromVersion === "SBL" || toVersion === "SBL";
  const spanishSide = involvesSpanish ? maps["SBL"] : undefined;

  const identity: AlignedRow[] = Array.from({ length: fromVerseCount }, (_, i) => {
    const verse = i + 1;
    const parsed = parseKey(chapterKey);
    const toKey = parsed ? verseKey(parsed.book, parsed.chapter, verse) : null;
    return { fromVerse: verse, toKey };
  });

  if (!spanishSide || !spanishSide.divergentChapters.includes(chapterKey)) {
    return identity;
  }

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
  const parsed = parseKey(chapterKey);
  if (!parsed) return identity;

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

/** The explanatory note for a divergent chapter, or null if it aligns cleanly. */
export async function divergenceNote(chapterKey: RefKey): Promise<string | null> {
  const maps = await loadVerseMap();
  for (const map of Object.values(maps)) {
    if (map?.notes[chapterKey]) return map.notes[chapterKey];
  }
  return null;
}
