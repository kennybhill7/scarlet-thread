import Link from "next/link";
import { getReview, getTeaching, getThreadRadar } from "@/lib/vault/seed";
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
  const [review, radar, teaching] = await Promise.all([getReview(), getThreadRadar(), getTeaching()]);
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
          Notes linking in, per thread. Open the two or three you touched this week, read your own
          lines back, add what you&apos;re seeing.
        </p>
        <div className={styles.bars}>
          {review.threads.map((thread) => {
            const pct = topThread ? Math.max(4, (thread.inbound / Math.max(1, topThread.inbound)) * 100) : 0;
            return (
              <Link key={thread.slug} href={`/threads/${thread.slug}`} className={styles.barRow}>
                <span className={styles.barName}>{thread.title}</span>
                <div className={styles.barTrack}>
                  <div className={styles.barFill} style={{ width: `${pct}%` }} />
                </div>
                <span className={styles.barValue}>{thread.inbound}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Thread radar</h2>
        <p className={styles.hint}>
          Words showing up more than once with no thread covering them yet. Not a suggestion of
          what they mean — just a note that you&apos;ve seen something twice. The guide&apos;s own
          rule: make a thread on the third sighting, not the first.
        </p>
        {radar.length === 0 ? (
          <p className={styles.ok}>Nothing repeating outside your existing threads right now.</p>
        ) : (
          <div className={styles.radar}>
            {radar.map((hit) => (
              <div key={hit.word} className={styles.radarHit}>
                <span className={styles.radarWord}>{hit.word}</span>
                <span className={styles.radarCount}>
                  in {hit.count} entries · {hit.chapters.join(", ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Worth teaching</h2>
        <p className={styles.hint}>
          The step that turns study into leadership. What you don&apos;t give away, you lose.
        </p>
        {teaching.length === 0 ? (
          <p className={styles.ok}>
            Nothing marked yet — that&apos;s the step everyone skips. Find one thing this week.
          </p>
        ) : (
          <ul className={styles.list}>
            {teaching.map((t) => (
              <li key={t.body}>{t.body}</li>
            ))}
          </ul>
        )}
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
