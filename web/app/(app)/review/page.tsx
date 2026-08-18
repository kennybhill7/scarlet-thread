import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { listEntries } from "@/lib/db/entries";
import { getReviewSnapshot } from "@/lib/db/review";
import { listThreads } from "@/lib/db/threads";
import type { Entry, ReviewSnapshot, Thread } from "@/lib/contracts";
import styles from "./review.module.css";

// ---------------------------------------------------------------------------
// Thread radar — "you've noticed X in three passages, is this becoming a
// thread?" Ported from lib/vault/seed.ts's getThreadRadar(): same algorithm,
// now reading DB entries/threads instead of the build-time seed bridge. See
// that file's history for why distinct-chapter counting (not entry counting)
// is the correct sighting definition.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the", "and", "that", "this", "with", "from", "have", "were", "they",
  "them", "their", "what", "when", "where", "which", "while", "would",
  "could", "should", "there", "here", "then", "than", "into", "over",
  "under", "about", "before", "after", "again", "still", "also", "even",
  "just", "only", "never", "always", "your", "unto", "shall", "will",
  "upon", "hath", "thee", "thou", "thy", "his", "her", "him", "she",
  "who", "was", "are", "for", "not", "but", "you", "all", "one", "two",
  "out", "now", "own", "did", "yet", "every", "between", "chapter",
  "chapters", "verse", "verses", "reads", "reading", "first", "second",
  "third", "fourth", "fifth", "each", "some", "much", "many", "more",
  "most", "less", "least", "such", "same", "other", "another", "these",
  "those", "being", "been", "back", "away", "toward",
  "through", "against", "because", "since", "until", "though", "given",
  "everything", "great", "toward",
]);

const BOOK_NAMES = new Set([
  "genesis", "exodus", "leviticus", "numbers", "deuteronomy", "joshua",
  "judges", "ruth", "samuel", "kings", "chronicles", "ezra", "nehemiah",
  "esther", "job", "psalms", "psalm", "proverbs", "ecclesiastes", "song",
  "songs", "solomon", "isaiah", "jeremiah", "lamentations", "ezekiel",
  "daniel", "hosea", "joel", "amos", "obadiah", "jonah", "micah", "nahum",
  "habakkuk", "zephaniah", "haggai", "zechariah", "malachi", "matthew",
  "mark", "luke", "john", "acts", "romans", "corinthians", "galatians",
  "ephesians", "philippians", "colossians", "thessalonians", "timothy",
  "titus", "philemon", "hebrews", "james", "peter", "jude", "revelation",
]);

function normaliseWord(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export interface RadarHit {
  word: string;
  count: number;
  chapters: string[];
}

export function computeThreadRadar(entries: Entry[], threads: Thread[]): RadarHit[] {
  const threadTitleWords = new Set(
    threads.flatMap((t) => t.title.toLowerCase().split(/[^a-z]+/).filter(Boolean)),
  );
  const threadTitleBySlug = new Map(threads.map((t) => [t.slug, t.title.toLowerCase()]));

  const hits = new Map<string, Set<string>>();

  entries.forEach((entry) => {
    if (entry.kind !== "observation" && entry.kind !== "question") return;
    const entryThreadTitleWords = new Set(
      entry.threads
        .map((slug) => threadTitleBySlug.get(slug))
        .filter((title): title is string => Boolean(title)),
    );

    const words = new Set(
      entry.body
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length >= 5 && !STOPWORDS.has(w) && !BOOK_NAMES.has(w) && !threadTitleWords.has(w))
        .map(normaliseWord),
    );

    for (const word of words) {
      if (entryThreadTitleWords.has(word)) continue;
      if (!hits.has(word)) hits.set(word, new Set());
      hits.get(word)!.add(entry.chapter);
    }
  });

  return Array.from(hits.entries())
    .filter(([, chapters]) => chapters.size >= 3)
    .map(([word, chapters]) => ({ word, count: chapters.size, chapters: Array.from(chapters) }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, 8);
}

export interface TeachingEntry {
  body: string;
  chapter: string;
  threads: string[];
}

export interface ReviewPageData {
  snapshot: ReviewSnapshot;
  radar: RadarHit[];
  teaching: TeachingEntry[];
  orphanEntries: { id: string; label: string }[];
}

export type ReviewViewModel =
  | { status: "setup-incomplete" }
  | { status: "ok"; data: ReviewPageData };

export type ReviewDataDeps = {
  getSnapshot: (userId: string) => Promise<ReviewSnapshot>;
  getEntries: (userId: string) => Promise<Entry[]>;
  getThreads: (userId: string) => Promise<Thread[]>;
};

const defaultDeps: ReviewDataDeps = {
  getSnapshot: getReviewSnapshot,
  getEntries: (userId) => listEntries(userId, {}),
  getThreads: listThreads,
};

function orphanLabel(entry: Entry): string {
  const snippet = entry.body.trim().slice(0, 64);
  return `${entry.chapter} — ${snippet}${entry.body.trim().length > 64 ? "…" : ""}`;
}

/**
 * The one seam between the page and the database. Errors here (missing
 * DATABASE_URL, connection failure, anything else) collapse to
 * "setup-incomplete" rather than reaching the JSX, which is what lets a
 * genuinely empty account still render the ordinary empty-state copy below —
 * the two must never look the same to the reader.
 */
export async function loadReviewViewModel(
  userId: string,
  deps: ReviewDataDeps = defaultDeps,
): Promise<ReviewViewModel> {
  try {
    const [snapshot, entries, threads] = await Promise.all([
      deps.getSnapshot(userId),
      deps.getEntries(userId),
      deps.getThreads(userId),
    ]);

    const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
    const teaching = entries
      .filter((entry) => entry.kind === "teaching")
      .map((entry) => ({ body: entry.body, chapter: entry.chapter, threads: entry.threads }));
    const radar = computeThreadRadar(entries, threads);
    const orphanEntries = snapshot.orphanEntries
      .map((id) => entriesById.get(id))
      .filter((entry): entry is Entry => Boolean(entry))
      .map((entry) => ({ id: entry.id, label: orphanLabel(entry) }));

    return { status: "ok", data: { snapshot, radar, teaching, orphanEntries } };
  } catch {
    return { status: "setup-incomplete" };
  }
}

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
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const view = await loadReviewViewModel(session.user.id);

  if (view.status === "setup-incomplete") {
    return (
      <div className={styles.wrap}>
        <p className={styles.eyebrow}>Sunday review</p>
        <h1 className={styles.title}>Setup incomplete</h1>
        <p className={styles.setupNotice}>
          Review couldn&apos;t reach your data. This is a configuration problem, not an
          empty account — check the database connection and try again.
        </p>
      </div>
    );
  }

  const { snapshot: review, radar, teaching, orphanEntries } = view.data;
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
          Words showing up in three or more separate passages with no thread covering them yet. Not
          a suggestion of what they mean — just a note that you&apos;ve seen something three times.
          The guide&apos;s own rule: make a thread on the third sighting, not the first.
        </p>
        {radar.length === 0 ? (
          <p className={styles.ok}>Nothing repeating outside your existing threads right now.</p>
        ) : (
          <div className={styles.radar}>
            {radar.map((hit) => (
              <div key={hit.word} className={styles.radarHit}>
                <span className={styles.radarWord}>{hit.word}</span>
                <span className={styles.radarCount}>
                  in {hit.count} passages · {hit.chapters.join(", ")}
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
        <List
          items={orphanEntries.map((entry) => entry.label)}
          empty="No orphans. Everything is connected to something."
        />
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
