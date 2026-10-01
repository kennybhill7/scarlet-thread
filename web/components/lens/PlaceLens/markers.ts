/**
 * PLACELENS-001 — composes `geometry.ts` (projection math) with
 * `tierStyle.ts` (confidence -> style) and `types.ts` (the place data) into
 * the flat list `PlaceLensSvg`'s HTML marker overlay actually renders. Pure:
 * no React, no DOM — `node:test`-able the same way `geometry.ts`/
 * `tierStyle.ts` are.
 *
 * This is also where the one honesty rule that spans BOTH modules is
 * enforced for real: a marker is only ever produced for a place that is
 * BOTH located (`isLocated`, from `types.ts`) AND renderable
 * (`isRenderable`, from `tierStyle.ts` — tier !== "unlocated"). The two
 * checks should always agree (a located place is never tier "unlocated" —
 * `places_unlocated_no_coords_check`/`places_located_has_coords_check` in
 * `db/schema.ts` enforce this at the DB layer, `PlaceRowSchema` enforces it
 * upstream of that), but `projectVisiblePlaces` checks both anyway rather
 * than trusting the invariant silently — a single data bug must never put a
 * pin where the dataset says there is none.
 */
import { buildProjection, isFrontFacing, projectPoint, type ProjectionConfig, type Rotation } from "./geometry";
import { styleForTier, isRenderable, type TierStyle } from "./tierStyle";
import { isLocated, type LensPlace } from "./types";

export interface ProjectedMarker {
  id: string;
  name: string;
  x: number;
  y: number;
  style: TierStyle;
}

export interface ProjectedCandidate {
  description: string;
  x: number;
  y: number;
}

/**
 * The visible (front-hemisphere), drawable markers for `places` at
 * `config`'s current rotation/scale. Back-hemisphere and unlocated/
 * non-renderable places are simply absent from the result — never present
 * with `null` coordinates.
 */
export function projectVisiblePlaces(places: readonly LensPlace[], config: ProjectionConfig): ProjectedMarker[] {
  const projection = buildProjection(config);
  const markers: ProjectedMarker[] = [];
  for (const place of places) {
    if (!isLocated(place) || !isRenderable(place.tier)) continue;
    if (!isFrontFacing(config.rotation, place.lon, place.lat)) continue;
    const point = projectPoint(projection, place.lon, place.lat);
    if (!point) continue;
    markers.push({ id: place.id, name: place.name, x: point[0], y: point[1], style: styleForTier(place.tier) });
  }
  return markers;
}

/** The ghost/candidate markers for ONE (contested) place, e.g. when selected. */
export function projectCandidates(
  place: LensPlace,
  rotation: Rotation,
  config: ProjectionConfig,
): ProjectedCandidate[] {
  const projection = buildProjection(config);
  const out: ProjectedCandidate[] = [];
  for (const candidate of place.candidates) {
    if (!isFrontFacing(rotation, candidate.lon, candidate.lat)) continue;
    const point = projectPoint(projection, candidate.lon, candidate.lat);
    if (!point) continue;
    out.push({ description: candidate.description, x: point[0], y: point[1] });
  }
  return out;
}
