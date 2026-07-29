import { getReview } from "@/lib/vault/seed";
import styles from "./review.module.css";

function List({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className={styles.ok}>{empty}</p>;
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export default async function ReviewPage() {
  const review = await getReview();
  const topThread = review.threads[0];

  return (
    <div className={styles.wrap}>
      <p className={styles.eyebrow}>Sunday review</p>
      <h1 className={styles.title}>Where God has been working</h1>
      <p className={styles.sub}>
        The four things worth checking weekly. {review.openQuestions} open question
        {review.openQuestions === 1 ? "" : "s"} you&apos;re carrying.
      </p>

      <section className={styles.section}>
        <h2 className={styles.h2}>Thread strength</h2>
        <p className={styles.hint}>
          Notes linking in, per thread. The longest bar is usually not the one you expected.
        </p>
        <div className={styles.bars}>
          {review.threads.map((thread) => {
            const pct = topThread ? Math.max(4, (thread.inbound / Math.max(1, topThread.inbound)) * 100) : 0;
            return (
              <div key={thread.slug} className={styles.barRow}>
                <span className={styles.barName}>{thread.title}</span>
                <div className={styles.barTrack}>
                  <div className={styles.barFill} style={{ width: `${pct}%` }} />
                </div>
                <span className={styles.barValue}>{thread.inbound}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Threads with nothing linking in yet</h2>
        <List items={review.coldThreads} empty="Every thread has at least one entry running into it." />
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Orphans — connect them or delete them</h2>
        <List items={review.orphanPeople} empty="No orphans. Everything is connected to something." />
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Mirror integrity</h2>
        <List
          items={review.mirrorBreaks.map((m) => `${m.stage} — ${m.issue}`)}
          empty="All eleven mirror pairs point both ways."
        />
      </section>
    </div>
  );
}
