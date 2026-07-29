"use client";

import { useEffect, useId, useState } from "react";

import { ThreadPicker } from "@/components/threads/ThreadPicker";
import { ThreadCreator } from "@/components/threads/ThreadCreator";
import { inkUrlSchema } from "@/lib/api/entries";
import type { Entry, EntryKind, Thread } from "@/lib/contracts";
import { installOnlineSync, syncNow } from "@/lib/sync/client";
import {
  listLocalEntries,
  listLocalThreads,
  saveLocalEntry,
} from "@/lib/sync/store";

import styles from "./note-composer.module.css";

type NoteComposerProps = {
  chapter: string;
  verse?: string;
  readComplete: boolean;
  onSaved?: (entry: Entry) => void;
};

const captureKinds: { value: EntryKind; label: string }[] = [
  { value: "observation", label: "Observation" },
  { value: "question", label: "Question" },
  { value: "note", label: "Note" },
];

export function NoteComposer({
  chapter,
  verse,
  readComplete,
  onSaved,
}: NoteComposerProps) {
  const bodyId = useId();
  const inkId = useId();
  const [kind, setKind] = useState<EntryKind>("observation");
  const [body, setBody] = useState("");
  const [inkUrl, setInkUrl] = useState("");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThreads, setSelectedThreads] = useState<string[]>([]);
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "queued" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      if (navigator.onLine) {
        try {
          await syncNow();
        } catch {
          // Capture stays available from the local store.
        }
      }
      try {
        const [items, chapterEntries] = await Promise.all([
          listLocalThreads(),
          listLocalEntries(chapter),
        ]);
        if (!active) return;
        setThreads(items);
        setSelectedThreads([
          ...new Set(chapterEntries.flatMap((entry) => entry.threads)),
        ]);
      } catch {
        if (active) {
          setStatus("error");
          setMessage(
            "This device could not load your threads. Reload before writing.",
          );
        }
      }
    })();
    const uninstall = installOnlineSync(() => {
      setStatus("queued");
      setMessage("Saved here. Sync will retry when the connection is ready.");
    });
    return () => {
      active = false;
      uninstall();
    };
  }, [chapter]);

  if (!readComplete) {
    return (
      <aside className={styles.locked} aria-live="polite">
        <p className={styles.eyebrow}>READ FIRST</p>
        <h2>The page stays quiet until the reading is finished.</h2>
        <p>
          Ten minutes with the text before writing. Your observation will still
          be here when you return.
        </p>
      </aside>
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanBody = body.trim();
    if (!cleanBody || selectedThreads.length === 0) return;
    const cleanInkUrl = inkUrl.trim();
    if (cleanInkUrl && !inkUrlSchema.safeParse(cleanInkUrl).success) {
      setStatus("error");
      setMessage(
        "Use an Apple Notes, iCloud, HTTP, or HTTPS link for the ink sketch.",
      );
      return;
    }

    setStatus("saving");
    setMessage("Saving on this device…");
    const now = new Date().toISOString();
    const entry: Entry = {
      id: crypto.randomUUID(),
      kind,
      body: cleanBody,
      chapter,
      ...(verse ? { verse } : {}),
      threads: selectedThreads,
      answeredAt: kind === "question" ? null : undefined,
      ...(cleanInkUrl ? { inkUrl: cleanInkUrl } : {}),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    try {
      await saveLocalEntry(entry);
      onSaved?.(entry);
      setBody("");
      setInkUrl("");
      setSelectedThreads([]);

      if (!navigator.onLine) {
        setStatus("queued");
        setMessage("Saved on this device. It will sync when you are online.");
        return;
      }

      try {
        await syncNow();
        setStatus("saved");
        setMessage("Saved here and synced.");
      } catch {
        setStatus("queued");
        setMessage("Saved here. Sync will retry automatically.");
      }
    } catch {
      setStatus("error");
      setMessage("This device could not save the entry. Nothing was discarded.");
    }
  }

  return (
    <form className={styles.composer} onSubmit={submit}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>CAPTURE</p>
          <h2>What did you notice?</h2>
        </div>
        <span className={styles.reference}>{verse ?? chapter}</span>
      </header>

      <div className={styles.kinds} aria-label="Entry type" role="group">
        {captureKinds.map((option) => (
          <button
            aria-pressed={kind === option.value}
            data-active={kind === option.value || undefined}
            key={option.value}
            onClick={() => setKind(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      <label className={styles.label} htmlFor={bodyId}>
        {kind === "observation"
          ? "An observation, not a summary"
          : kind === "question"
            ? "A question worth leaving open"
            : "Your note"}
      </label>
      <textarea
        autoCapitalize="sentences"
        className={styles.textarea}
        disabled={status === "saving"}
        id={bodyId}
        maxLength={100_000}
        onChange={(event) => setBody(event.target.value)}
        placeholder={
          kind === "observation"
            ? "The serpent changes God’s wording…"
            : "Write what is alive in the text."
        }
        required
        rows={6}
        value={body}
      />

      <ThreadPicker
        disabled={status === "saving"}
        onChange={setSelectedThreads}
        selected={selectedThreads}
        threads={threads}
      />
      {selectedThreads.length === 0 ? (
        <p className={styles.threadRequired}>
          Link at least one thread. This is the one rule that holds the study
          together.
        </p>
      ) : null}
      <details className={styles.newThread}>
        <summary>Start a new thread</summary>
        <ThreadCreator
          onCreated={(thread) => {
            setThreads((current) =>
              [...current, thread].sort((a, b) =>
                a.title.localeCompare(b.title),
              ),
            );
            setSelectedThreads((current) =>
              current.includes(thread.slug)
                ? current
                : [...current, thread.slug],
            );
          }}
        />
      </details>

      <div>
        <label className={styles.label} htmlFor={inkId}>
          Apple Notes ink link <span>optional</span>
        </label>
        <input
          className={styles.input}
          disabled={status === "saving"}
          id={inkId}
          inputMode="url"
          maxLength={2_048}
          onChange={(event) => setInkUrl(event.target.value)}
          placeholder="applenotes:…"
          type="url"
          value={inkUrl}
        />
      </div>

      <footer className={styles.footer}>
        <p aria-live="polite" data-state={status}>
          {message}
        </p>
        <button
          className={styles.save}
          disabled={
            status === "saving" ||
            !body.trim() ||
            selectedThreads.length === 0
          }
          type="submit"
        >
          {status === "saving" ? "Saving…" : "Save entry"}
        </button>
      </footer>
    </form>
  );
}
