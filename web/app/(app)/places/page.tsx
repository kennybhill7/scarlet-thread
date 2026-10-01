import PlaceLens from "@/components/lens/PlaceLens";
import { BackToJourney } from "@/components/climb/BackToJourney";

import styles from "./places.module.css";

/**
 * NAV-001 — the Places lens's host page.
 *
 * PLACELENS-001 built the real `PlaceLens` component (`components/lens/
 * PlaceLens/`) and its own lazy, `ssr: false` entry point
 * (`components/lens/PlaceLens/index.ts`, "a host page that already is a
 * Client Component may instead import..." — this page is NOT a Client
 * Component, so it imports that default entry point exactly as documented)
 * but, per that task's own report, mounted it nowhere — nothing hosted it
 * before this task. This is that mount.
 *
 * Kept deliberately minimal, per this task's own brief: just enough chrome
 * to render the lens full-screen with a persistent, real "back to Journey"
 * control (`BackToJourney`) above it — a fuller "lens opens inside study"
 * integration (plan §A.2's "Lenses open *inside* study as sheets over the
 * text") is explicitly out of scope for this task.
 *
 * No auth check of its own — `app/(app)/layout.tsx` already gates the whole
 * `(app)` route group, the same precedent `app/(app)/settings/page.tsx` and
 * `app/(app)/map/page.tsx` document for themselves.
 */
export default function PlacesPage() {
  return (
    <div className={styles.wrap}>
      <BackToJourney />
      <div className={styles.lens}>
        <PlaceLens />
      </div>
    </div>
  );
}
