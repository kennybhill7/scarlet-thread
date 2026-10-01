/**
 * PLACELENS-001 — building a place's passage list, and the "Open in
 * Connect" contract (task brief: "a real link/action from a place's passage
 * list into the existing Connect section's passage picker
 * (`components/ui/PassagePicker.tsx`) for that range — wire it as a
 * URL/callback contract a parent page can use; you do not need to build the
 * page that hosts this").
 *
 * The contract is a `CanonicalRangeV1`, formatted with
 * `formatCanonicalRangeKey` (`lib/bible/range.ts` — the SAME compact
 * "<start>-<end>" key `ConnectSection.tsx`'s own range picker state already
 * round-trips through `parseCanonicalRangeKey`), carried two ways so either
 * kind of host page can use it without this lens needing to know which:
 *   - `connectQueryParam`: a ready-to-use query string value
 *     (`?openRange=1.2.8-1.2.8`) for a host that reads the URL.
 *   - the raw `CanonicalRangeV1` itself, for a host that wires
 *     `PlaceLens`'s `onOpenInConnect` callback prop directly to in-memory
 *     state (e.g. passing it straight to `<PassagePicker value={range} />`).
 */
import { formatCanonicalRangeKey } from "@/lib/bible/range";
import type { CanonicalRangeV1 } from "@/lib/contracts/range-v1";

import type { LensPlace, LensPlacePassage } from "./types";

export interface PassageListItem {
  range: CanonicalRangeV1;
  display: string;
  inDatasetVerseList: boolean;
  /** `?openRange=<key>` — append to a host page's own URL. */
  connectQueryParam: string;
}

/** The query param name the "Open in Connect" link/callback contract uses. */
export const OPEN_RANGE_QUERY_KEY = "openRange";

function toListItem(passage: LensPlacePassage): PassageListItem {
  const key = formatCanonicalRangeKey(passage.range);
  return {
    range: passage.range,
    display: passage.display,
    inDatasetVerseList: passage.inDatasetVerseList,
    connectQueryParam: `${OPEN_RANGE_QUERY_KEY}=${encodeURIComponent(key)}`,
  };
}

/**
 * A place's passages, sorted canon order (the dataset's own listing order —
 * already canon order from `compilePlace`'s pass-through, but sorted here
 * explicitly rather than trusted, since a future curation.json hand-added
 * `extraPassages` entry is appended, not inserted in order).
 */
export function buildPassageList(place: LensPlace): PassageListItem[] {
  return [...place.passages]
    .sort((a, b) => compareRangeStart(a.range, b.range))
    .map(toListItem);
}

function compareRangeStart(a: CanonicalRangeV1, b: CanonicalRangeV1): number {
  const left = a.start.split(".").map(Number);
  const right = b.start.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Builds a full href for a host page whose base path accepts `?openRange=`. */
export function buildConnectHref(basePath: string, range: CanonicalRangeV1): string {
  const key = formatCanonicalRangeKey(range);
  const separator = basePath.includes("?") ? "&" : "?";
  return `${basePath}${separator}${OPEN_RANGE_QUERY_KEY}=${encodeURIComponent(key)}`;
}
