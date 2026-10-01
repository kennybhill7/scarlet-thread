import Link from "next/link";

import styles from "./BackToJourney.module.css";

/**
 * NAV-001 — a persistent, real "back to Journey" control (plan §A.2: "Each
 * lens opens as a full-screen surface with a persistent 'back to Journey'").
 *
 * `app/(app)/layout.tsx` already mounts the real `TabBar` (now labeled
 * "Journey", see that component's own header) below every screen in the
 * `(app)` group, including every lens page this control is used on — so a
 * real, persistent, non-browser-back way back to "/" already exists ambient
 * to every page here. This component exists anyway because the task brief
 * for the new `/places` page is explicit ("keep that page itself minimal --
 * just enough to render the lens full-screen with a 'back to Journey'
 * control") and a reader deep in a full-screen-feeling lens should not have
 * to notice and trust a tab bar below the fold — a labeled, sticky control
 * at the TOP of the lens is the more honest reading of "persistent, real...
 * not just rely on browser back."
 *
 * Mounted on: `app/(app)/places/page.tsx` (new), and the happy-path render
 * of `app/(app)/map/page.tsx`, `app/(app)/mirror/[stageSlug]/page.tsx`,
 * `app/(app)/threads/[slug]/page.tsx` (existing lens pages this task touches
 * minimally, per its own brief). Deliberately NOT added to those three
 * pages' setup-incomplete/no-mirror/broken-mirror/not-found branches -- this
 * repo's established convention (see `app/(app)/page.tsx`'s own
 * `SetupIncomplete` header) is that a failure/edge screen stays minimal and
 * visually distinct from ordinary content, not decorated with the same chrome
 * as a working page.
 */
export function BackToJourney() {
  return (
    <Link href="/" className={styles.back} data-tap data-testid="back-to-journey">
      <span aria-hidden="true">←</span> Journey
    </Link>
  );
}
