/**
 * OPENING-001 — pure flag-read/write logic for the first-run opening
 * sequence (globe -> world map -> Eden region -> real Eden scene -> fade
 * into the real Mountain home page). See design/OPENING_SEQUENCE_VISION.md
 * for the decided spec this implements.
 *
 * Same storage-parameter discipline as lib/theme.ts: storage is accepted as
 * an argument (never a bare `window.localStorage` reference inside these
 * functions) so every function here is callable from a plain node:test run
 * with a minimal in-memory stub — no DOM/jsdom dependency at all. Real call
 * sites (OpeningSequence.tsx, ReplayJourney.tsx) pass `window.localStorage`.
 *
 * Key naming follows the SAME convention lib/theme.ts's THEME_STORAGE_KEY
 * documents: the established prefix in this app is "bible-brain:*", not
 * "scarlet-thread:*" — see lib/bible/lastRead.ts and lib/theme.ts.
 */

export const OPENING_SEEN_STORAGE_KEY = "bible-brain:opening-seen";

/**
 * "Replay the Journey" (components/settings/ReplayJourney.tsx) forces the
 * sequence to show again by navigating to "/" with this query param, rather
 * than only clearing the stored flag. Two reasons: (1) it works even before
 * the clear has been read back by anything, and (2) it forces a REAL, full
 * navigation (see ReplayJourney.tsx's own header for why a hard navigation
 * matters here, not a soft client-side one) which guarantees the pre-paint
 * bootstrap script below actually runs again.
 */
export const OPENING_REPLAY_PARAM = "opening";
export const OPENING_REPLAY_VALUE = "replay";

export function hasSeenOpening(
  storage: Pick<Storage, "getItem"> | undefined,
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(OPENING_SEEN_STORAGE_KEY) === "1";
  } catch {
    // Storage can throw in private-browsing edge cases (same rationale as
    // lib/theme.ts's readStoredThemePreference). Falling back to "not seen"
    // is the safe default in isolation, but shouldShowOpening below also
    // folds in reduced-motion, which wins regardless.
    return false;
  }
}

export function markOpeningSeen(
  storage: Pick<Storage, "setItem"> | undefined,
): void {
  if (!storage) return;
  try {
    storage.setItem(OPENING_SEEN_STORAGE_KEY, "1");
  } catch {
    // Losing this write is not worth surfacing an error over — same
    // tradeoff lib/theme.ts's writeThemePreference makes. Worst case a
    // device that cannot persist localStorage sees the sequence again next
    // time, which is a Skip button away regardless.
  }
}

export function clearOpeningSeen(
  storage: Pick<Storage, "removeItem"> | undefined,
): void {
  if (!storage) return;
  try {
    storage.removeItem(OPENING_SEEN_STORAGE_KEY);
  } catch {
    // Same tradeoff as above.
  }
}

/** Whether the URL itself is forcing a replay, independent of the stored flag. */
export function isReplayRequested(search: string): boolean {
  try {
    return (
      new URLSearchParams(search).get(OPENING_REPLAY_PARAM) ===
      OPENING_REPLAY_VALUE
    );
  } catch {
    return false;
  }
}

/** href ReplayJourney navigates to. A function, not a hand-typed string
 *  constant at the call site, so the param name/value can never drift out
 *  of sync with isReplayRequested above. */
export function replayHref(): string {
  return `/?${OPENING_REPLAY_PARAM}=${OPENING_REPLAY_VALUE}`;
}

/**
 * The one decision every caller goes through — mirrors lib/theme.ts's
 * resolveReading() being the single function neither the bootstrap script
 * nor the live component may disagree about.
 *
 * Reduced motion wins unconditionally, even over an explicit replay
 * request: requirement 5 is "must skip straight to the real content," full
 * stop, not "skip unless the user asked to see it again." A visitor with
 * `prefers-reduced-motion: reduce` cannot get a motion sequence from this
 * feature at all — see OpeningSequence.tsx and OpeningSequence.module.css
 * for the two independent (JS + CSS) guarantees of that, matching
 * Mountain.tsx/Mountain.module.css's own rigor for the same class of
 * requirement.
 */
export function shouldShowOpening(args: {
  storage: Pick<Storage, "getItem"> | undefined;
  search: string;
  reducedMotion: boolean;
}): boolean {
  if (args.reducedMotion) return false;
  if (isReplayRequested(args.search)) return true;
  return !hasSeenOpening(args.storage);
}

/**
 * Returns the source of a small, synchronous IIFE meant for a blocking
 * <script> rendered as the FIRST child of OpeningSequence's own wrapper
 * element, so that wrapper's `data-opening-visible` attribute is correct
 * BEFORE the browser paints the overlay/content beneath it — no flash of
 * the wrong one, and no dependency on React state for that first paint.
 * Exactly the same technique app/layout.tsx uses for the reading theme
 * (lib/theme.ts's getThemeBootstrapScript), scoped here to one component's
 * subtree instead of <html>.
 *
 * This has to be hand-written JS text for the same reason getThemeBootstrapScript
 * does: it runs before any bundle loads, so it cannot literally import or
 * call shouldShowOpening(). What it CAN share with the rest of this module —
 * and does — is the storage key and query-param names/values, all
 * interpolated from the same constants tests/opening-sequence.test.ts
 * exercises, so they cannot silently typo-drift apart. The three-input
 * shape below (reduced motion / replay param / stored flag) is the same
 * shape as shouldShowOpening() and is asserted against literal reference
 * strings in the test file.
 *
 * Fails closed to "false" (real content, no overlay) on any error (storage
 * blocked, matchMedia unavailable, JS disabled entirely) — the wrapper
 * element's own JSX attribute already defaults to "false" for exactly this
 * reason, so a no-JS visitor or a mid-script exception never sees a stuck
 * overlay; they just get the real Mountain page immediately, same as a
 * returning visitor.
 */
export function getOpeningBootstrapScript(): string {
  const key = JSON.stringify(OPENING_SEEN_STORAGE_KEY);
  const param = JSON.stringify(OPENING_REPLAY_PARAM);
  const value = JSON.stringify(OPENING_REPLAY_VALUE);
  return (
    "(function(){try{" +
    "var reduced=false;" +
    "try{reduced=!!(window.matchMedia&&window.matchMedia(\"(prefers-reduced-motion: reduce)\").matches);}catch(e){}" +
    "var replay=false;" +
    `try{replay=new URLSearchParams(window.location.search).get(${param})===${value};}catch(e){}` +
    "var seen=false;" +
    `try{seen=window.localStorage.getItem(${key})==="1";}catch(e){}` +
    "var show=!reduced&&(replay||!seen);" +
    "if(show&&document.currentScript&&document.currentScript.parentElement){" +
    'document.currentScript.parentElement.setAttribute("data-opening-visible","true");' +
    "}" +
    "}catch(e){}})();"
  );
}

// --- Where Eden is actually painted on the world map -----------------------
//
// design/scarlet-thread-app/assets/map-world.png is 1536x1024px (verified
// via a real pixel-dimension read, 2026-09-07). Cropping and visually
// inspecting the image at x:0-320,y:600-1024 (i.e. the box below) confirms
// Adam and Eve, the tree with the serpent, the waterfall, the lion, AND the
// scarlet thread's own starting knot all sit inside it — this is the real
// Eden vignette, not an assumption. EDEN_REGION is that verified bounding
// box, expressed as percentages of the image; EDEN_ORIGIN is the couple's
// own position within it, used as the zoom's transform-origin so the
// animation converges on them rather than on the box's geometric center.

export const EDEN_REGION = {
  xPct: 0,
  yPct: 58.6,
  widthPct: 20.8,
  heightPct: 41.4,
} as const;

export const EDEN_ORIGIN = {
  xPct: 9,
  yPct: 81,
} as const;
