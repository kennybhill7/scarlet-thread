"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { Entry, Thread } from "@/lib/contracts";
import { syncNow } from "@/lib/sync/client";
import { nextTimestamp } from "@/lib/sync/time";
import {
  listLocalEntries,
  listLocalThreads,
  saveLocalThread,
} from "@/lib/sync/store";

import styles from "./thread-detail.module.css";

type ThreadDetailProps = {
  slug: string;
};

type Loaded = {
  thread: Thread;
  entries: Entry[];
};

function chapterHref(chapter: string) {
  const [book, chapterNumber] = chapter.split(".");
  return `/read/${book}/${chapterNumber}`;
}

export function ThreadDetail({ slug }: ThreadDetailProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [ready, setReady] = useState(false);
  const [definition, setDefinition] = useState("");
  const [seeing, setSeeing] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (navigator.onLine) {
        try {
          await syncNow();
        } catch {
          // The local thread remains available for review.
        }
      }
      try {
        const [threads, entries] = await Promise.all([
          listLocalThreads(),
          listLocalEntries(),
        ]);
        if (!active) return;
        const thread = threads.find((item) => item.slug === slug);
        if (thread) {
          setLoaded({
            thread,
            entries: entries.filter((entry) => entry.threads.includes(slug)),
          });
          setDefinition(thread.definition);
          setSeeing(thread.seeing);
        }
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [slug]);

  async function save() {
    if (!loaded) return;
    setSaving(true);
    setMessage("Saving on this device…");
    const thread: Thread = {
      ...loaded.thread,
      definition: definition.trim(),
      seeing: seeing.trim(),
      updatedAt: nextTimestamp(loaded.thread.updatedAt),
    };
    try {
      await saveLocalThread(thread);
      setLoaded({ ...loaded, thread });
      if (navigator.onLine) {
        try {
          await syncNow();
          setMessage("Thread saved and synced.");
        } catch {
          setMessage("Thread saved here. Sync will retry.");
        }
      } else {
        setMessage("Thread saved here. Sync will wait.");
      }
    } catch {
      setMessage("This device could not save the thread.");
    } finally {
      setSaving(false);
    }
  }

  if (!ready) {
    return (
      <section className={styles.state} aria-busy="true">
        Loading thread…
      </section>
    );
  }

  if (loadError) {
    return (
      <section className={styles.state} role="alert">
        <h1>Thread could not be loaded</h1>
        <p>Your device storage or connection is unavailable. Please reload.</p>
        <Link href="/review">Back to Review</Link>
      </section>
    );
  }

  if (!loaded) {
    return (
      <section className={styles.state}>
        <h1>Thread not found on this device</h1>
        <p>Reconnect to sync it, or return to Review.</p>
        <Link href="/review">Back to Review</Link>
      </section>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/review">← Review</Link>
        <p className={styles.eyebrow}>THREAD</p>
        <h1>{loaded.thread.title}</h1>
        <p>
          {loaded.entries.length} linked{" "}
          {loaded.entries.length === 1 ? "entry" : "entries"}
        </p>
      </header>

      <section className={styles.editor}>
        <label htmlFor="thread-definition">In one line</label>
        <textarea
          disabled={saving}
          id="thread-definition"
          maxLength={2_000}
          onChange={(event) => setDefinition(event.target.value)}
          rows={2}
          value={definition}
        />
        <label htmlFor="thread-seeing">What I’m seeing</label>
        <textarea
          disabled={saving}
          id="thread-seeing"
          maxLength={100_000}
          onChange={(event) => setSeeing(event.target.value)}
          rows={7}
          value={seeing}
        />
        <div className={styles.saveRow}>
          <p aria-live="polite">{message}</p>
          <button disabled={saving} onClick={() => void save()} type="button">
            {saving ? "Saving…" : "Save thread"}
          </button>
        </div>
      </section>

      <section className={styles.backlinks}>
        <h2>Where it shows up</h2>
        {loaded.entries.length === 0 ? (
          <p>No linked writing yet. Let the thread stay half-empty.</p>
        ) : (
          <ol>
            {loaded.entries.map((entry) => (
              <li key={entry.id}>
                <Link href={chapterHref(entry.chapter)}>
                  <span>{entry.verse ?? entry.chapter}</span>
                  <p>{entry.body}</p>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
