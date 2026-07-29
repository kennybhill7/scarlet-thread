"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ThreadPicker } from "@/components/threads/ThreadPicker";
import { inkUrlSchema } from "@/lib/api/entries";
import type { Entry, Thread } from "@/lib/contracts";
import { syncNow } from "@/lib/sync/client";
import { nextTimestamp } from "@/lib/sync/time";
import {
  listLocalEntries,
  listLocalThreads,
  saveLocalEntry,
} from "@/lib/sync/store";

import styles from "./entry-list.module.css";

type EntryListProps = {
  chapter: string;
};

export function EntryList({ chapter }: EntryListProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftThreads, setDraftThreads] = useState<string[]>([]);
  const [draftInkUrl, setDraftInkUrl] = useState("");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [status, setStatus] = useState("");
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [writing, setWriting] = useState(false);
  const writeInFlight = useRef(false);

  async function reload() {
    setEntries(await listLocalEntries(chapter));
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      if (navigator.onLine) {
        try {
          await syncNow();
        } catch {
          // Local writing remains authoritative and readable.
        }
      }
      try {
        const [items, availableThreads] = await Promise.all([
          listLocalEntries(chapter),
          listLocalThreads(),
        ]);
        if (!active) return;
        setEntries(items);
        setThreads(availableThreads);
      } catch {
        if (active) {
          setLoadError(true);
          setStatus(
            "Writing could not be loaded from this device. Please reload before making changes.",
          );
        }
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [chapter]);

  async function persist(entry: Entry, successMessage: string) {
    if (writeInFlight.current) return false;
    writeInFlight.current = true;
    setWriting(true);
    try {
      await saveLocalEntry(entry);
      await reload();
      if (navigator.onLine) {
        try {
          await syncNow();
          setStatus(successMessage);
        } catch {
          setStatus(`${successMessage} Sync will retry.`);
        }
      } else {
        setStatus(`${successMessage} Sync will wait.`);
      }
      return true;
    } catch (error) {
      setStatus(
        error instanceof Error && error.message.includes("at least one thread")
          ? "The change was not saved. Active writing must keep at least one thread link."
          : "This device could not save the change. Please try again.",
      );
      return false;
    } finally {
      writeInFlight.current = false;
      setWriting(false);
    }
  }

  async function saveEdit(entry: Entry) {
    const body = draft.trim();
    if (!body) return;
    if (draftThreads.length === 0) {
      setStatus("Choose at least one thread before saving this entry.");
      return;
    }
    const cleanInkUrl = draftInkUrl.trim();
    if (cleanInkUrl && !inkUrlSchema.safeParse(cleanInkUrl).success) {
      setStatus(
        "Use an Apple Notes, iCloud, HTTP, or HTTPS link for the ink sketch.",
      );
      return;
    }
    const saved = await persist(
      {
        ...entry,
        body,
        threads: draftThreads,
        ...(cleanInkUrl
          ? { inkUrl: cleanInkUrl }
          : { inkUrl: undefined }),
        updatedAt: nextTimestamp(entry.updatedAt),
      },
      "Entry updated.",
    );
    if (saved) {
      setEditing(null);
      setDraft("");
      setDraftThreads([]);
      setDraftInkUrl("");
    }
  }

  async function remove(entry: Entry) {
    if (
      !window.confirm(
        "Remove this entry from the chapter and its thread backlinks?",
      )
    ) {
      return;
    }
    const removedAt = nextTimestamp(entry.updatedAt);
    await persist(
      {
        ...entry,
        deletedAt: removedAt,
        updatedAt: removedAt,
      },
      "Entry removed.",
    );
  }

  async function toggleAnswered(entry: Entry) {
    const updatedAt = nextTimestamp(entry.updatedAt);
    await persist(
      {
        ...entry,
        answeredAt: entry.answeredAt ? null : updatedAt,
        updatedAt,
      },
      entry.answeredAt ? "Question reopened." : "Question marked answered.",
    );
  }

  if (!ready) {
    return (
      <section className={styles.empty} aria-busy="true">
        <p>Loading writing…</p>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className={styles.empty} role="alert">
        <p>{status}</p>
      </section>
    );
  }

  if (entries.length === 0) {
    return (
      <section className={styles.empty}>
        {status ? (
          <p className={styles.status} aria-live="polite">
            {status}
          </p>
        ) : null}
        <p>No writing here yet.</p>
        <span>Empty chapters are addresses, not unfinished work.</span>
      </section>
    );
  }

  return (
    <section className={styles.list} aria-label="Chapter entries">
      <p className={styles.status} aria-live="polite">
        {status}
      </p>
      {entries.map((entry) => (
        <article className={styles.entry} key={entry.id}>
          <header>
            <div>
              <span className={styles.kind}>{entry.kind}</span>
              {entry.verse ? (
                <span className={styles.verse}>{entry.verse}</span>
              ) : null}
            </div>
            <time dateTime={entry.updatedAt}>
              {new Intl.DateTimeFormat(undefined, {
                month: "short",
                day: "numeric",
              }).format(new Date(entry.updatedAt))}
            </time>
          </header>

          {editing === entry.id ? (
            <div className={styles.editor}>
              <textarea
                autoFocus
                disabled={writing}
                maxLength={100_000}
                onChange={(event) => setDraft(event.target.value)}
                rows={5}
                value={draft}
              />
              <ThreadPicker
                disabled={writing}
                onChange={setDraftThreads}
                selected={draftThreads}
                threads={threads}
              />
              <label className={styles.editLabel}>
                Apple Notes ink link
                <input
                  disabled={writing}
                  inputMode="url"
                  maxLength={2_048}
                  onChange={(event) => setDraftInkUrl(event.target.value)}
                  type="url"
                  value={draftInkUrl}
                />
              </label>
              <div>
                <button
                  disabled={writing}
                  onClick={() => {
                    setEditing(null);
                    setDraft("");
                    setDraftThreads([]);
                    setDraftInkUrl("");
                  }}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  disabled={writing}
                  onClick={() => void saveEdit(entry)}
                  type="button"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <p className={styles.body}>{entry.body}</p>
          )}

          {entry.threads.length > 0 ? (
            <div className={styles.threads}>
              {entry.threads.map((thread) => (
                <Link href={`/threads/${thread}`} key={thread}>
                  {thread.replaceAll("-", " ")}
                </Link>
              ))}
            </div>
          ) : null}

          {entry.inkUrl ? (
            <a
              className={styles.ink}
              href={entry.inkUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open ink in Apple Notes
            </a>
          ) : null}

          <footer>
            {entry.kind === "question" ? (
              <button
                disabled={writing}
                onClick={() => void toggleAnswered(entry)}
                type="button"
              >
                {entry.answeredAt ? "Reopen" : "Mark answered"}
              </button>
            ) : null}
            <button
              disabled={writing}
              onClick={() => {
                setEditing(entry.id);
                setDraft(entry.body);
                setDraftThreads(entry.threads);
                setDraftInkUrl(entry.inkUrl ?? "");
              }}
              type="button"
            >
              Edit
            </button>
            <button
              disabled={writing}
              onClick={() => void remove(entry)}
              type="button"
            >
              Remove
            </button>
          </footer>
        </article>
      ))}
    </section>
  );
}
