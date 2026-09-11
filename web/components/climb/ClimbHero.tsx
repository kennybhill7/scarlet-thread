import Link from "next/link";
import styles from "./ClimbHero.module.css";

interface ClimbHeroProps {
  stagesWithWork: number;
  totalStages: number;
  threadCount: number;
  openQuestions: number;
}

export function ClimbHero({ stagesWithWork, totalStages, threadCount, openQuestions }: ClimbHeroProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.eyebrowRow}>
        <p className={styles.eyebrow}>Scarlet Thread</p>
        {/* STORYMAP-001 — a sibling icon link next to the settings gear,
            matching that exact existing pattern (same A-040 data-tap
            reasoning below applies here too), rather than earning the Story
            Map a fourth tab (TabBar.tsx's own deliberate three-tab-only
            navigation discipline — see that file's header comment). */}
        <div className={styles.eyebrowIcons}>
          <Link href="/map" className={styles.settingsLink} aria-label="Story Map — cross-reference arcs across the whole canon" data-tap>
            ◠
          </Link>
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

      <Link href="/read/1/1" className={styles.cta}>
        <span>Begin at Genesis 1</span>
        <span className={styles.ctaArrow} aria-hidden="true">
          →
        </span>
      </Link>
    </div>
  );
}
