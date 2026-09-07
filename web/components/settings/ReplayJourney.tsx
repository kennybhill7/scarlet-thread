"use client";

import { clearOpeningSeen, replayHref } from "@/lib/opening/openingSequence";
import styles from "./ReplayJourney.module.css";

/**
 * OPENING-001, decision 2 — "A 'Replay the Journey' entry in Settings lets
 * anyone (Ken included, for review) re-trigger it on demand"
 * (design/OPENING_SEQUENCE_VISION.md). Appended AFTER ThemePicker, the last
 * section in app/(app)/settings/page.tsx today, per that task's own
 * constraint: the only enforced order test
 * (tests/protected-integrations.test.ts, "settings renders downloads, then
 * export, then clear device") checks ONLY offline < export < clear, so
 * appending here — same as ThemePicker itself was appended after
 * DeviceSessionControls — cannot disturb it.
 *
 * WHY THIS IS A REAL <a> (a full navigation), NOT a router-driven
 * transition: the whole "show first-run sequence with no hydration flash"
 * mechanism in
 * OpeningSequence.tsx depends on a blocking inline <script> that only the
 * BROWSER'S OWN HTML PARSER executes — that only happens on a real page
 * load. A Next.js client-side (soft) navigation to "/" would instead mount
 * OpeningSequence via React's client render, where that inline script text
 * is inert (see OpeningSequence.tsx's own "KNOWN GAP" note). Forcing a hard
 * navigation here guarantees the replay actually shows the sequence instead
 * of silently landing on the plain Mountain page — the same reasoning
 * DeviceSessionControls.tsx documents for using `window.location.assign`
 * instead of a router transition after its own destructive flow.
 *
 * clearOpeningSeen() is written first, before navigating, as a belt-and-
 * suspenders proof of intent (the query param on replayHref() alone is
 * already sufficient for the bootstrap script to show the sequence, since
 * shouldShowOpening()/the script check the replay param BEFORE the stored
 * flag) — it also means a later plain visit to "/" (no replay param) after
 * this click still shows the sequence once more, rather than silently
 * re-marking it seen from the replay alone.
 */
export function ReplayJourney() {
  function onClick() {
    clearOpeningSeen(typeof window === "undefined" ? undefined : window.localStorage);
  }

  return (
    <section className={styles.section} aria-labelledby="replay-journey-title">
      <p className={styles.eyebrow}>THE OPENING</p>
      <h2 id="replay-journey-title" className={styles.title}>
        Replay the journey
      </h2>
      <p className={styles.copy}>
        Watch the globe-to-Eden opening again — the same first-run sequence
        this device saw once, from the very start.
      </p>
      <a className={styles.button} href={replayHref()} onClick={onClick}>
        Replay the journey
      </a>
    </section>
  );
}
