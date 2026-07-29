"use client";

import type { Thread } from "@/lib/contracts";

import styles from "./thread-picker.module.css";

type ThreadPickerProps = {
  threads: Thread[];
  selected: string[];
  onChange: (slugs: string[]) => void;
  disabled?: boolean;
};

export function ThreadPicker({
  threads,
  selected,
  onChange,
  disabled = false,
}: ThreadPickerProps) {
  function toggle(slug: string) {
    onChange(
      selected.includes(slug)
        ? selected.filter((item) => item !== slug)
        : [...selected, slug],
    );
  }

  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend>Threads</legend>
      <p className={styles.help}>
        Link an existing thread. Start a new one only after the third sighting.
      </p>
      {threads.length === 0 ? (
        <p className={styles.empty}>No threads are available on this device yet.</p>
      ) : (
        <div className={styles.options}>
          {threads.map((thread) => {
            const active = selected.includes(thread.slug);
            return (
              <button
                aria-pressed={active}
                className={styles.chip}
                data-active={active || undefined}
                key={thread.slug}
                onClick={() => toggle(thread.slug)}
                type="button"
              >
                {thread.title}
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
