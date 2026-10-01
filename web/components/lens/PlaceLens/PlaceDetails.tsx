/**
 * PLACELENS-001 — the selected place's panel: tier badge + honesty note
 * (confidence-as-geometry's TEXT half — the globe/list's dashed marker is
 * the GEOMETRY half; task brief: "a visible 'location disputed' note on
 * click", matching `design/globe-exploration/app.js`'s `renderCard()`),
 * "also proposed" candidates for contested places, and the passage list with
 * "Open in Connect" actions (`passageList.ts`'s contract). Hookless.
 */
import { buildPassageList } from "./passageList";
import { styleForTier } from "./tierStyle";
import type { LensPlace } from "./types";
import type { CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import styles from "./PlaceLens.module.css";

export interface PlaceDetailsProps {
  idPrefix: string;
  place: LensPlace;
  /** Called with the range AND a ready-to-append `?openRange=...` query string. */
  onOpenInConnect?: (range: CanonicalRangeV1, connectQueryParam: string) => void;
}

export function PlaceDetails({ idPrefix, place, onOpenInConnect }: PlaceDetailsProps) {
  const style = styleForTier(place.tier);
  const located = place.lon !== null && place.lat !== null;
  const passages = buildPassageList(place);
  const headingId = `${idPrefix}-details-heading`;

  return (
    <section className={styles.details} aria-labelledby={headingId} data-testid="place-details">
      <h3 id={headingId} className={styles.detailsName}>
        {place.name}
      </h3>
      <span className={styles.tierBadge} data-contested={style.isContested}>
        {style.label}
      </span>
      {place.note ? <p className={styles.detailsNote}>{place.note}</p> : null}
      {!located ? (
        <p className={styles.detailsNote} data-testid="unlocated-note">
          No marker is shown on the globe for {place.name} — this location is not known with enough confidence to
          place a pin.
        </p>
      ) : null}
      {place.modernName ? <p className={styles.detailsNote}>Modern site: {place.modernName}</p> : null}
      {place.candidates.length > 0 ? (
        <p className={styles.candidateList}>
          Also proposed: {place.candidates.map((candidate) => candidate.description).join(", ")}
        </p>
      ) : null}

      <h4 className={styles.srOnly} id={`${idPrefix}-passages-heading`}>
        Scripture references
      </h4>
      <ul className={styles.passageList} aria-labelledby={`${idPrefix}-passages-heading`}>
        {passages.map((passage) => (
          <li key={passage.connectQueryParam} className={styles.passageItem}>
            <span className={styles.passageRef}>
              {passage.display}
              {!passage.inDatasetVerseList ? <span className={styles.passageHandAdded}> (added)</span> : null}
            </span>
            <button
              type="button"
              className={styles.passageOpenLink}
              onClick={() => onOpenInConnect?.(passage.range, passage.connectQueryParam)}
            >
              Open in Connect
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
