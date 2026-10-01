/**
 * PLACELENS-001 — the list-equivalent the task brief requires as the
 * accessibility floor: "a non-map, fully keyboard/screen-reader-usable list
 * view of the same places (same data, a `<ul>`/table), reachable without
 * ever touching the SVG — this is not optional". Hookless, same discipline
 * as `PlaceLensSvg.tsx`: props in, markup out, `renderToStaticMarkup`-safe.
 *
 * Shows EVERY place, including unlocated ones (Eden) — the globe can never
 * show those (no coordinates to put a marker at), so if this list hid them
 * too, a screen-reader user would get genuinely less information than a
 * sighted one who happens to open `PlaceDetails` for a selected place. Each
 * row is a single real `<button>` (not a link; selecting a place updates
 * this same page's state, same as clicking a marker) inside a `<li>`, native
 * HTML giving the right semantics for free the way `PassagePicker.tsx`'s own
 * header argues for `<select>`.
 */
import { isRenderable, styleForTier } from "./tierStyle";
import type { LensPlace } from "./types";
import styles from "./PlaceLens.module.css";

export interface PlaceListProps {
  idPrefix: string;
  places: readonly LensPlace[];
  selectedId: string | null;
  onSelectPlace?: (id: string) => void;
  /** The heading text; a caller embedding this inside its own section can pass "" to suppress it. */
  heading?: string;
}

export function PlaceList({ idPrefix, places, selectedId, onSelectPlace, heading = "All places" }: PlaceListProps) {
  const headingId = `${idPrefix}-list-heading`;
  return (
    <section aria-labelledby={heading ? headingId : undefined} aria-label={heading ? undefined : "All places"}>
      {heading ? (
        <h3 id={headingId} className={styles.srOnly}>
          {heading}
        </h3>
      ) : null}
      <ul className={styles.list} data-testid="place-list">
        {places.map((place) => {
          const located = isRenderable(place.tier) && place.lon !== null && place.lat !== null;
          const style = styleForTier(place.tier);
          return (
            <li key={place.id}>
              <button
                type="button"
                id={`${idPrefix}-list-${place.id}`}
                className={styles.listButton}
                aria-current={selectedId === place.id ? "true" : undefined}
                onClick={() => onSelectPlace?.(place.id)}
              >
                <span>{place.name}</span>
                <span className={located ? undefined : styles.listUnlocated}>
                  {style.label}
                  {!located ? " — no marker on the globe" : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
