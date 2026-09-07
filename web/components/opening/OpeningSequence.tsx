"use client";

import { useEffect, useRef, useState } from "react";
import {
  EDEN_ORIGIN,
  getOpeningBootstrapScript,
  markOpeningSeen,
} from "@/lib/opening/openingSequence";
import { Globe } from "./Globe";
import styles from "./OpeningSequence.module.css";

/**
 * OPENING-001 — the first-run opening sequence orchestrator
 * (design/OPENING_SEQUENCE_VISION.md): globe -> world map -> zoom into the
 * map's Eden region -> the real Eden/Creation scene image -> fade into the
 * real Mountain home page. Shown once per device, replayable from Settings
 * (components/settings/ReplayJourney.tsx).
 *
 * Wraps app/(app)/page.tsx's existing returned JSX unchanged, as `children`
 * — that Server Component stays a Server Component; this is the one client
 * boundary that decides, client-side and with no hydration flash, whether
 * to show the sequence overlay first or render children straight through.
 *
 * HOW THE NO-FLASH DECISION WORKS (mirrors lib/theme.ts's pre-paint
 * bootstrap script / app/layout.tsx's blocking <script>, scoped to this
 * component's own subtree instead of <html> — see
 * lib/opening/openingSequence.ts#getOpeningBootstrapScript for the full
 * rationale):
 *
 *   1. The wrapper <div id={ROOT_ID}> below is rendered with
 *      data-opening-visible="false" as a real, static JSX attribute — the
 *      safe default if JS never runs at all (no-JS visitor): show the real
 *      Mountain page immediately, never a stuck or missing overlay.
 *   2. Its FIRST child is a blocking <script> (rendered server-side, so the
 *      browser executes it while parsing this element, before painting
 *      anything inside it) that flips the attribute to "true" IF this is a
 *      genuine first run (not reduced-motion, and either a replay was
 *      requested or the local flag says "not seen yet"). This is the ONLY
 *      thing that decides first-paint visibility.
 *   3. OpeningSequence.module.css keys the overlay's opacity/pointer-events
 *      and the content's visibility purely off that one attribute, so the
 *      very first paint is already correct — no React state is involved in
 *      that decision, so there is nothing for hydration to mismatch.
 *   4. Only AFTER mount does React state (`stage`) take over, to run the
 *      actual timed sequence and, at the end, hand back control by flipping
 *      the very same attribute to "false" again (see finish() below) —
 *      which is also what lets the CSS crossfade the overlay back out
 *      smoothly rather than popping, since content was already
 *      `visibility: visible` underneath the still-opaque overlay the moment
 *      the attribute flips (see the CSS file's own comment).
 *
 * KNOWN GAP, stated rather than hidden (same discipline
 * DeviceSessionControls.tsx's RESIDUAL GAP note uses): the blocking script
 * only runs on a real HTML parse -- a hard navigation / full page load. A
 * Next.js soft client-side transition into "/" (no full reload) would mount
 * this component via React's client render instead, where the inline
 * <script> text is never executed by the browser. The fallback in that rare
 * case is exactly the static JSX default: data-opening-visible stays
 * "false", so the visitor just gets the real Mountain page immediately with
 * no overlay -- a safe, non-broken outcome, never a flash of the wrong
 * thing, just a missed first-run cinematic on an edge path. This is also
 * WHY ReplayJourney.tsx forces a real (not client-routed) navigation to
 * "/?opening=replay" -- see its own header.
 */

type Stage = "globe" | "map-arrive" | "map-zoom" | "eden" | "fade-out" | "hidden";

const TIMING = {
  globeAutoAdvanceMs: 7000,
  globeInteractedAdvanceMs: 900,
  mapArriveMs: 1100,
  mapZoomMs: 2600,
  edenMs: 1800,
  // Keep in sync with OpeningSequence.module.css's .overlay transition-duration.
  fadeOutMs: 900,
} as const;

const ROOT_ID = "opening-sequence-root";

export function OpeningSequence({ children }: { children: React.ReactNode }) {
  const [stage, setStage] = useState<Stage>("globe");
  const timersRef = useRef<number[]>([]);
  const finishedRef = useRef(false);

  function clearTimers() {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  }

  function schedule(fn: () => void, ms: number) {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
  }

  function finish() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    clearTimers();
    markOpeningSeen(typeof window === "undefined" ? undefined : window.localStorage);
    document.getElementById(ROOT_ID)?.setAttribute("data-opening-visible", "false");
    setStage("fade-out");
  }

  // Mount-time guard, run once: read back what the pre-paint script already
  // decided (see this file's header) and, if it decided NOT to show the
  // sequence -- either because this device has already seen it, or because
  // prefers-reduced-motion was active (requirement 5: reduced motion "must
  // skip straight to the real content" -- unconditionally, so this is
  // checked here too, not only in the bootstrap script) -- make sure
  // nothing below ever schedules a timer or lets Globe's onAdvance progress
  // the sequence.
  //
  // Deliberately NOT a setState call (`stage` simply stays at its initial
  // "globe" value in this branch): CSS is the sole source of truth for
  // whether the overlay is actually visible (data-opening-visible defaults
  // to "false" in this component's own JSX, and the reduced-motion media
  // query in OpeningSequence.module.css independently forces the overlay
  // hidden regardless of that attribute -- the same two-guarantee pattern
  // Mountain.module.css uses for --mountain-progress), so an inert,
  // CSS-masked `<Globe>` costing nothing but its own one-shot 7s timeout is
  // an acceptable, and simpler, tradeoff than fighting hydration for a
  // render-affecting flag. finishedRef is what actually stops any further
  // progress: every advance path below (Globe's onAdvance, finish() itself)
  // checks it first.
  useEffect(() => {
    const root = document.getElementById(ROOT_ID);
    const active = root?.getAttribute("data-opening-visible") === "true";
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!active || reducedMotion) {
      finishedRef.current = true;
      return;
    }

    // Live guard: an OS-level reduced-motion toggle mid-sequence bails
    // immediately too, same discipline as Mountain.tsx's own matchMedia
    // change listener for --mountain-progress. finish() is called from
    // this event-driven callback, never synchronously from the effect body
    // itself.
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    function onChange() {
      if (mql.matches) finish();
    }
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The timed portion of the sequence -- everything after the globe, which
  // advances itself via <Globe onAdvance>. Each stage schedules exactly the
  // next one; finish() (Skip, or the natural end after "eden") is the only
  // way out, and clears every pending timer so nothing fires late. Guarded
  // by finishedRef so the never-actually-playing path above (reduced
  // motion / already seen) can never schedule anything either, even though
  // `stage` stays "globe" there instead of moving to "hidden".
  useEffect(() => {
    if (finishedRef.current) return;
    if (stage === "map-arrive") schedule(() => setStage("map-zoom"), TIMING.mapArriveMs);
    if (stage === "map-zoom") schedule(() => setStage("eden"), TIMING.mapZoomMs);
    if (stage === "eden") schedule(finish, TIMING.edenMs);
    if (stage === "fade-out") schedule(() => setStage("hidden"), TIMING.fadeOutMs);
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  useEffect(() => clearTimers, []);

  const playing = stage !== "hidden";

  return (
    <div id={ROOT_ID} className={styles.root} data-opening-visible="false">
      <script dangerouslySetInnerHTML={{ __html: getOpeningBootstrapScript() }} />

      {playing ? (
        <div
          className={styles.overlay}
          data-stage={stage}
          role="dialog"
          aria-modal="true"
          aria-label="The opening sequence"
          aria-hidden={stage === "fade-out"}
        >
          <button type="button" className={styles.skip} onClick={finish}>
            Skip
          </button>

          {stage === "globe" ? (
            <Globe
              onAdvance={() => {
                // Guards the never-actually-playing path above (reduced
                // motion / already seen): finishedRef is already true there,
                // so Globe's own one-shot auto-advance timer firing later is
                // a harmless no-op instead of starting the map beat.
                if (!finishedRef.current) setStage("map-arrive");
              }}
              autoAdvanceMs={TIMING.globeAutoAdvanceMs}
              interactedAdvanceMs={TIMING.globeInteractedAdvanceMs}
            />
          ) : null}

          {stage === "map-arrive" || stage === "map-zoom" ? (
            <div className={styles.mapStage}>
              <img
                src="/opening/map-world.png"
                alt="A hand-painted map of the whole story, from Eden to the New Jerusalem."
                className={styles.mapImage}
                data-zoom={stage === "map-zoom"}
                style={{
                  // EDEN_ORIGIN -- see lib/opening/openingSequence.ts for
                  // how this was measured against the real map image.
                  ["--eden-origin-x" as string]: `${EDEN_ORIGIN.xPct}%`,
                  ["--eden-origin-y" as string]: `${EDEN_ORIGIN.yPct}%`,
                }}
              />
            </div>
          ) : null}

          {stage === "eden" || stage === "fade-out" ? (
            <div className={styles.edenStage}>
              <img
                src="/climb/scenes/01-creation.png"
                alt="The Garden of Eden, at the beginning of the story."
                className={styles.edenImage}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={styles.content}>{children}</div>
    </div>
  );
}
