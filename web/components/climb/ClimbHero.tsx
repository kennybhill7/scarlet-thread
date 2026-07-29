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
        <Link href="/settings" className={styles.settingsLink} aria-label="Offline settings">
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

      <Link href="/read/1/1" className={styles.cta}>
        Begin at Genesis 1 →
      </Link>
    </div>
  );
}
