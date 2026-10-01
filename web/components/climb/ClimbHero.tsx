import Link from "next/link";

import { ContinueCard, type ContinueCardViewModel } from "./ContinueCard";
import styles from "./ClimbHero.module.css";

interface ClimbHeroProps {
  stagesWithWork: number;
  totalStages: number;
  threadCount: number;
  openQuestions: number;
  continueCard: ContinueCardViewModel;
}

export function ClimbHero({
  stagesWithWork,
  totalStages,
  threadCount,
  openQuestions,
  continueCard,
}: ClimbHeroProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.eyebrowRow}>
        <p className={styles.eyebrow}>Scarlet Thread</p>
        {/* NAV-001 — the Story Map icon link that used to live here
            (STORYMAP-001) moved to the Journey page's Lenses row
            (components/climb/LensesRow.tsx), under the Mountain, alongside
            Places/Mirror/Threads (plan §A.2: "Removed from production nav:
            ... the Story Map link buried in the Climb hero (becomes a
            Lens)"). Only the Settings gear remains here. */}
        {/* A-040: a plain <Link> isn't covered by globals.css's
            `button, a[role="button"], [data-tap] { min-height: 44px }`
            selector -- data-tap is this codebase's own convention for
            exactly this class of control (a non-button, non-role="button"
            tap target), so wire it in here rather than hardcoding a
            min-height only in ClimbHero.module.css. */}
        <Link href="/settings" className={styles.settingsLink} aria-label="Offline settings" data-tap>
          ⚙
        </Link>
      </div>
      <h1 className={styles.title}>The Mountain</h1>
      <p className={styles.sub}>
        Eleven stages, front to back. Tap a stage to read its opening chapter.
      </p>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>
            {stagesWithWork}/{totalStages}
          </span>
          <span className={styles.statLabel}>Stages started</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{threadCount}</span>
          <span className={styles.statLabel}>Threads</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{openQuestions}</span>
          <span className={styles.statLabel}>Open questions</span>
        </div>
      </div>

      {/* NAV-001 — replaces the old static "Begin at Genesis 1" CTA with the
          real Continue/Begin card (plan §A.2: "Top card: Continue ... or
          Begin (first run)"). */}
      <ContinueCard data={continueCard} />
    </div>
  );
}
