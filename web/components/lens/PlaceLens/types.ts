/**
 * PLACELENS-001 — the lens's own data contract.
 *
 * This is NOT `scripts/content/placeSchema.ts`'s `CompiledPlace` (that type
 * stays owned by the content pipeline, outside this task's writable paths).
 * It is the trimmed, client-ready shape `data/generate-places-json.mts`
 * writes into `public/map/places.json` — one field added
 * (`passages[].display`, a pre-formatted "Genesis 2:8" string baked in at
 * generation time so the browser never needs the whole 66-book canon just to
 * label a reference) and `sourceId`/`datasetScore`/etc. dropped (the lens has
 * no use for them; dropping them is most of the client bundle saving).
 *
 * Field-for-field, every value here traces back to `content/places/
 * places.jsonl` (PLACES-001, OpenBible.info Bible Geocoding Data, CC BY 4.0)
 * through the SAME `PlaceRowSchema` + `compilePlace` the production DB sync
 * uses (`scripts/content/placeSchema.ts`) — see that file's header for the
 * honesty rules this type inherits structurally:
 *   - `tier === "unlocated"` <=> `lon`/`lat` both null <=> `kind === "unlocated"`.
 *   - `tier` "disputed"/"uncertain" carries a `note` and/or `candidates`.
 */

import type { CanonicalRangeV1 } from "@/lib/contracts/range-v1";

export const PLACE_KINDS = ["point", "region", "route", "water", "unlocated"] as const;
export type LensPlaceKind = (typeof PLACE_KINDS)[number];

export const PLACE_TIERS = ["identified", "likely", "uncertain", "disputed", "unlocated"] as const;
export type LensPlaceTier = (typeof PLACE_TIERS)[number];

export interface LensPlaceCandidate {
  description: string;
  lon: number;
  lat: number;
  score: number;
}

export interface LensPlacePassage {
  range: CanonicalRangeV1;
  /** Pre-formatted display string ("Genesis 2:8"), baked in at generation time. */
  display: string;
  /** False only for a reference added by hand in curation.json (not in OpenBible's own verse list). */
  inDatasetVerseList: boolean;
}

export interface LensPlace {
  id: string;
  name: string;
  kind: LensPlaceKind;
  tier: LensPlaceTier;
  /** Null exactly when tier is "unlocated" — enforced upstream, re-checked by tierStyle.ts. */
  lon: number | null;
  lat: number | null;
  coordinateBasis: string | null;
  modernName: string | null;
  note: string | null;
  candidates: LensPlaceCandidate[];
  passages: LensPlacePassage[];
}

/** The whole `public/map/places.json` document. */
export interface PlaceLensDataset {
  /** CC BY 4.0 requires this exact string to be visible in the lens (plan §C.8). */
  attribution: string;
  sourceUrl: string;
  /** Pinned OpenBible.info dataset commit this was generated from. */
  datasetCommit: string;
  /** ISO timestamp of generation, for the Settings "last updated" line. */
  generatedAt: string;
  places: LensPlace[];
}

/** A place with real coordinates (the only ones a marker/arc can be drawn for). */
export interface LocatedLensPlace extends LensPlace {
  lon: number;
  lat: number;
}

export function isLocated(place: LensPlace): place is LocatedLensPlace {
  return place.lon !== null && place.lat !== null;
}
