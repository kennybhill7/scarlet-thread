/**
 * PLACELENS-001 — hookless "props in, markup out" render of the orthographic
 * globe: an SVG background (sphere silhouette, graticule, land — all
 * `aria-hidden`, purely decorative) plus an absolutely-positioned HTML
 * button overlay for every visible, located, renderable-tier marker (real
 * `<button>` elements, not SVG shapes with click handlers, so focus order,
 * keyboard activation and screen-reader semantics come from native HTML
 * instead of being reimplemented — same reasoning `PassagePicker.tsx`'s
 * header gives for native `<select>`s). Candidate ("also proposed") ghost
 * points for the currently-selected contested place render inside the SVG,
 * `aria-hidden`, since they carry no independent action — the honesty note
 * in `PlaceDetails.tsx` is what actually tells a reader about them.
 *
 * No `useState`/`useEffect` here: `PlaceLens.tsx` owns rotation, selection,
 * and data; this component is a pure function of its props, directly
 * renderable by `react-dom/server`'s `renderToStaticMarkup` for a
 * deterministic snapshot test (plan §C.7).
 */
import type { Topology } from "topojson-specification";

import {
  buildProjection,
  graticulePath,
  landPath,
  sphereOutlinePath,
  type ProjectionConfig,
} from "./geometry";
import { projectCandidates, projectVisiblePlaces, type ProjectedMarker } from "./markers";
import type { LensPlace } from "./types";
import styles from "./PlaceLens.module.css";

export interface PlaceLensSvgProps {
  idPrefix: string;
  width: number;
  height: number;
  config: ProjectionConfig;
  /** Null while the land topology is still loading — the sphere/graticule still render. */
  land: Topology | null;
  places: readonly LensPlace[];
  selectedPlace: LensPlace | null;
  onSelectMarker?: (id: string) => void;
}

/** Re-derives the visible marker list from `places`/`config` — pure, same result every render for the same inputs. */
export function visibleMarkersFor(places: readonly LensPlace[], config: ProjectionConfig): ProjectedMarker[] {
  return projectVisiblePlaces(places, config);
}

export function PlaceLensSvg({
  idPrefix,
  width,
  height,
  config,
  land,
  places,
  selectedPlace,
  onSelectMarker,
}: PlaceLensSvgProps) {
  const projection = buildProjection(config);
  const sphere = sphereOutlinePath(projection);
  const graticule = graticulePath(projection);
  const landD = land ? landPath(projection, land) : "";
  const markers = projectVisiblePlaces(places, config);
  const candidates =
    selectedPlace && selectedPlace.tier !== "unlocated"
      ? projectCandidates(selectedPlace, config.rotation, config)
      : [];

  return (
    <div className={styles.stage} data-testid="place-lens-stage">
      <svg
        className={styles.svg}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="An orthographic globe of the biblical world. Drag, use arrow keys, or use the list view below to browse places."
      >
        <path className={styles.sphere} d={sphere} />
        <path className={styles.graticule} d={graticule} />
        {landD ? <path className={styles.land} d={landD} /> : null}
        {candidates.map((candidate, index) => (
          <circle
            key={`${idPrefix}-candidate-${index}`}
            className={styles.candidate}
            cx={candidate.x}
            cy={candidate.y}
            r={4}
            aria-hidden="true"
          />
        ))}
      </svg>
      <div className={styles.markerOverlay} aria-hidden="true">
        {markers.map((marker) => (
          <MarkerDot
            key={marker.id}
            idPrefix={idPrefix}
            marker={marker}
            selected={selectedPlace?.id === marker.id}
            onSelect={onSelectMarker}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The overlay is `aria-hidden` as a group: screen-reader users reach every
 * place through `PlaceList.tsx`'s real, always-present list instead (the
 * component header's "accessibility floor"), never by fishing through a
 * moving, pointer-only globe. An `aria-hidden` ancestor with a focusable
 * descendant is itself an axe violation ("aria-hidden-focus") — a hidden
 * element a keyboard user can still tab into, with nothing read out when
 * they land on it — so every marker button here is `tabIndex={-1}`: a
 * mouse/touch user can still click a marker directly on the globe (a nice
 * shortcut once the globe is visually understood), but it is never a tab
 * stop and never the only way to reach a place.
 */
function MarkerDot({
  idPrefix,
  marker,
  selected,
  onSelect,
}: {
  idPrefix: string;
  marker: ProjectedMarker;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  return (
    <button
      type="button"
      id={`${idPrefix}-marker-${marker.id}`}
      className={styles.marker}
      style={{ left: `${marker.x}px`, top: `${marker.y}px` }}
      data-stroke={marker.style.stroke}
      data-selected={selected ? "true" : "false"}
      aria-pressed={selected}
      aria-label={`${marker.name} — ${marker.style.label}`}
      onClick={() => onSelect?.(marker.id)}
      tabIndex={-1}
    />
  );
}
