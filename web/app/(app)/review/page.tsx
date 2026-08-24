import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { listEntries } from "@/lib/db/entries";
import { computeMotifCandidates, type RadarMotifCandidate } from "@/lib/db/radar";
import { getReviewSnapshot } from "@/lib/db/review";
import { listThreads } from "@/lib/db/threads";
import type { Entry, ReviewSnapshot, Thread } from "@/lib/contracts";
import { MotifRadarPanel } from "@/components/motif-radar";
import styles from "./review.module.css";

// ---------------------------------------------------------------------------
// Thread radar — RADAR-001 / BUILD_PLAN.md §3.5: the radar emits MOTIF
// CANDIDATES, never Connection rows (a theological edge exists only after
// the learner has compared both texts and written a rationale). The lexical
// engine itself lives in `lib/db/radar.ts` — see that file for the
// third-sighting rule and the A-045 honest-coverage fix; this page only
// fetches entries/threads and renders what it returns.
// ---------------------------------------------------------------------------

export interface TeachingEntry {
  body: string;
  chapter: string;
  threads: string[];
}

export interface ReviewPageData {
  snapshot: ReviewSnapshot;
  /** Motif candidates, never Connection rows — see lib/db/radar.ts. */
  motifCandidates: RadarMotifCandidate[];
  teaching: TeachingEntry[];
  orphanEntries: { id: string; label: string }[];
  /**
   * Reader-facing titles for `snapshot.coldThreads`. `lib/db/review.ts` puts
   * slugs in that field ("covenant-faithfulness") where the old seed bridge
   * put titles ("Covenant Faithfulness"). That module is not ours to change,
   * so the slug -> title lookup happens here, off the threads we already
   * fetched, falling back to the raw slug if no title is known.
   */
  coldThreads: string[];
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
    const motifCandidates = computeMotifCandidates(entries, threads);
    const orphanEntries = snapshot.orphanEntries
      .map((id) => entriesById.get(id))
      .filter((entry): entry is Entry => Boolean(entry))
      .map((entry) => ({ id: entry.id, label: orphanLabel(entry) }));

    const titleBySlug = new Map<string, string>();
    for (const thread of snapshot.threads) titleBySlug.set(thread.slug, thread.title);
    for (const thread of threads) titleBySlug.set(thread.slug, thread.title);
    const coldThreads = snapshot.coldThreads.map((slug) => titleBySlug.get(slug) ?? slug);

    return {
      status: "ok",
      data: { snapshot, motifCandidates, teaching, orphanEntries, coldThreads },
    };
  } catch {
    return { status: "setup-incomplete" };
  }
}

// ---------------------------------------------------------------------------
// Session resolution — telling "signed out" apart from "database down".
//
// `auth()` uses `session: { strategy: "database" }` with the Drizzle adapter,
// so the session lookup itself is a database read. When the database is
// unreachable, @auth/core catches the adapter throw and next-auth's
// parseSessionResponse turns the non-OK response into `null` — indistinguishable
// from a real signed-out visitor. Redirecting straight to /sign-in on that null
// tells the owner they are SIGNED OUT when in fact the database is dead, which
// is exactly the mislabeling this page exists to eliminate.
//
// So before trusting a null session we probe the database directly. If the
// probe also fails, the honest answer is "setup incomplete", not "sign in".
//
// SCOPE NOTE (SCOPE-BOUNDARY-001): this only helps for requests that actually
// reach the page. `web/proxy.ts` re-exports the same `auth` as middleware with
// a matcher that covers /review, so in a normal browser navigation the
// middleware performs the same database-backed session lookup one layer
// earlier and redirects to /sign-in before this component ever runs. Closing
// that hole requires editing proxy.ts and/or lib/auth/config.ts, both of which
// are outside this change's owned paths. See the commit message.
// ---------------------------------------------------------------------------

/**
 * A user id that cannot exist. The probe is a normal tenant-scoped read, so it
 * returns an empty list against a healthy database and reveals nothing; only
 * its throw/no-throw behaviour is used.
 */
const PROBE_USER_ID = "00000000-0000-0000-0000-000000000000";

export type SessionState =
  | { status: "authenticated"; userId: string }
  | { status: "signed-out" }
  | { status: "setup-incomplete" };

export type SessionDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } | null } | null>;
  probeDatabase: () => Promise<unknown>;
};

const defaultSessionDeps: SessionDeps = {
  getSession: auth,
  probeDatabase: () => listThreads(PROBE_USER_ID),
};

export async function resolveSessionState(
  deps: SessionDeps = defaultSessionDeps,
): Promise<SessionState> {
  let session: Awaited<ReturnType<SessionDeps["getSession"]>>;
  try {
    session = await deps.getSession();
  } catch {
    // auth() threw outright (adapter error surfaced instead of swallowed).
    // A generic 500 would be another wrong label; name the real problem.
    return { status: "setup-incomplete" };
  }

  const userId = session?.user?.id;
  if (userId) return { status: "authenticated", userId };

  // No session. Either genuinely signed out, or the session lookup silently
  // failed because the database is unreachable. Ask the database directly.
  try {
    await deps.probeDatabase();
  } catch {
    return { status: "setup-incomplete" };
  }

  return { status: "signed-out" };
}

/**
 * The one "we cannot reach your data" screen. Deliberately shares nothing with
 * the ordinary empty-state copy below: different title, an explicit notice, and
 * none of the review sections. If this ever renders the same words as an empty
 * account, tests/review-setup-state.test.ts fails.
 */
function SetupIncomplete({ detail }: { detail: string }) {
  return (
    <div className={styles.wrap}>
      <p className={styles.eyebrow}>Sunday review</p>
      <h1 className={styles.title}>Setup incomplete</h1>
      <p className={styles.setupNotice} data-testid="setup-notice">
        {detail}
      </p>
    </div>
  );
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
  const sessionState = await resolveSessionState();

  if (sessionState.status === "setup-incomplete") {
    return (
      <SetupIncomplete detail="Review couldn't reach the database to check your sign-in. You have not been signed out — this is a configuration problem. Check the database connection and try again." />
    );
  }

  // Guard: no session and the database answered fine, so this really is a
  // signed-out visitor. Never render a word of the journal below this line.
  if (sessionState.status !== "authenticated") redirect("/sign-in");

  const view = await loadReviewViewModel(sessionState.userId);

  if (view.status === "setup-incomplete") {
    return (
      <SetupIncomplete detail="Review couldn't reach your data. This is a configuration problem, not an empty account — check the database connection and try again." />
    );
  }

  const { snapshot: review, motifCandidates, teaching, orphanEntries, coldThreads } = view.data;
  const topThread = review.threads[0];

  return (
    <div className={styles.wrap}>
      <p className={styles.eyebrow}>Sunday review</p>
      <h1 className={styles.title}>What has been recurring in your study</h1>
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
          Words showing up in three or more separate passages that don&apos;t already appear in one of
          your thread titles. A word-frequency hint, not a check that a thread already covers the
          idea — just a note that you&apos;ve seen something three times. The guide&apos;s own rule:
          make a thread on the third sighting, not the first. These are candidates, not connections —
          comparing the passages side by side and writing why is still your work.
        </p>
        {motifCandidates.length === 0 ? (
          <p className={styles.ok}>Nothing repeating outside your existing threads right now.</p>
        ) : (
          <div className={styles.radar}>
            {motifCandidates.map((candidate) => (
              <div key={candidate.normalizedKey} className={styles.radarHit}>
                <span className={styles.radarWord}>{candidate.label}</span>
                <span className={styles.radarCount}>
                  {candidate.status} · in {candidate.passages.length} passages ·{" "}
                  {candidate.passages.join(", ")}
                </span>
              </div>
            ))}
          </div>
        )}

        <h2 className={styles.h2} style={{ marginTop: 20 }}>
          Offered threads
        </h2>
        <MotifRadarPanel />
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
        <List items={coldThreads} empty="Every thread has at least one entry running into it." />
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
