"use client";

import { useId, useState } from "react";

import type { Thread } from "@/lib/contracts";
import { syncNow } from "@/lib/sync/client";
import { listLocalThreads, saveLocalThread } from "@/lib/sync/store";

import styles from "./thread-creator.module.css";

type ThreadCreatorProps = {
  onCreated?: (thread: Thread) => void;
};

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120)
    .replace(/-$/, "");
}

export function ThreadCreator({ onCreated }: ThreadCreatorProps) {
  const titleId = useId();
  const definitionId = useId();
  const seeingId = useId();
  const confirmationId = useId();
  const [title, setTitle] = useState("");
  const [definition, setDefinition] = useState("");
  const [seeing, setSeeing] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanTitle = title.trim();
    const slug = slugify(cleanTitle);
    if (!confirmed || !cleanTitle || !slug) return;

    setSaving(true);
    try {
      const existing = await listLocalThreads();
      if (existing.some((thread) => thread.slug === slug)) {
        setStatus("That thread already exists.");
        return;
      }

      const now = new Date().toISOString();
      const thread: Thread = {
        slug,
        title: cleanTitle,
        definition: definition.trim(),
        seeing: seeing.trim(),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await saveLocalThread(thread);
      onCreated?.(thread);
      setTitle("");
      setDefinition("");
      setSeeing("");
      setConfirmed(false);
      if (navigator.onLine) {
        try {
          await syncNow();
          setStatus("Thread created and synced.");
        } catch {
          setStatus("Thread created here. Sync will retry.");
        }
      } else {
        setStatus("Thread created here. Sync will wait.");
      }
    } catch {
      setStatus("The thread could not be saved on this device.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <header>
        <p className={styles.eyebrow}>NEW THREAD</p>
        <h2>Name what keeps returning.</h2>
        <p>
          Threads begin on the third sighting—not the first interesting verse.
        </p>
      </header>

      <label htmlFor={titleId}>Title</label>
      <input
        disabled={saving}
        id={titleId}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
        required
        value={title}
      />

      <label htmlFor={definitionId}>In one line</label>
      <textarea
        disabled={saving}
        id={definitionId}
        maxLength={2_000}
        onChange={(event) => setDefinition(event.target.value)}
        rows={2}
        value={definition}
      />

      <label htmlFor={seeingId}>What I’m seeing</label>
      <textarea
        disabled={saving}
        id={seeingId}
        maxLength={100_000}
        onChange={(event) => setSeeing(event.target.value)}
        rows={4}
        value={seeing}
      />

      <label className={styles.confirm} htmlFor={confirmationId}>
        <input
          checked={confirmed}
          disabled={saving}
          id={confirmationId}
          onChange={(event) => setConfirmed(event.target.checked)}
          type="checkbox"
        />
        <span>This is the third sighting.</span>
      </label>

      <footer>
        <p aria-live="polite">{status}</p>
        <button
          disabled={saving || !confirmed || !title.trim()}
          type="submit"
        >
          {saving ? "Creating…" : "Create thread"}
        </button>
      </footer>
    </form>
  );
}
