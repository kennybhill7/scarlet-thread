"use client";

import { useEffect, useId, useState } from "react";

import type { DailyLog } from "@/lib/contracts";
import { syncNow } from "@/lib/sync/client";
import { getLocalLog, saveLocalLog } from "@/lib/sync/store";
import { nextTimestamp } from "@/lib/sync/time";

import styles from "./daily-loop.module.css";

type DailyLoopProps = {
  date: string;
  chapter: string | null;
  onChange?: (log: DailyLog) => void;
};

const stepLabels: { key: keyof DailyLog["steps"]; label: string }[] = [
  { key: "read", label: "Read" },
  { key: "observe", label: "Observe" },
  { key: "link", label: "Link" },
  { key: "ask", label: "Ask" },
  { key: "pray", label: "Pray" },
];

/**
 * The rope's one scarlet OUTLINE knot marks the next actionable step -- the
 * first not-yet-done step, in the fixed read/observe/link/ask/pray order
 * (SCARLETTHREAD-001, DailyLoop's steps -> rope-of-knots rebuild). Exported
 * as a plain function, separate from the pure-decoration knot markup, so it
 * is unit-testable without rendering the component (DailyLoop's real state
 * only loads client-side, after a useEffect that never fires under the
 * renderToStaticMarkup SSR technique this repo's other component tests use
 * -- see tests/thread-detail.test.ts's header comment on that limitation).
 * Returns undefined once every step is done: no step is "next" when the
 * loop is finished, matching the reassurance copy ("an unfinished day is
 * never a reset") -- a finished day has no more "next" either.
 */
export function nextIncompleteStepKey(
  steps: DailyLog["steps"],
): keyof DailyLog["steps"] | undefined {
  return stepLabels.find((step) => !steps[step.key])?.key;
}

function emptyLog(date: string, chapter: string | null): DailyLog {
  return {
    date,
    chapter,
    steps: {
      read: false,
      observe: false,
      link: false,
      ask: false,
      pray: false,
    },
    sentence: "",
    carrying: "",
    prayer: "",
    updatedAt: new Date().toISOString(),
  };
}

export function DailyLoop({ date, chapter, onChange }: DailyLoopProps) {
  const sentenceId = useId();
  const carryingId = useId();
  const prayerId = useId();
  const [log, setLog] = useState<DailyLog>(() => emptyLog(date, chapter));
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (navigator.onLine) {
        try {
          await syncNow();
        } catch {
          // The local daily loop remains available.
        }
      }
      try {
        const saved = await getLocalLog(date);
        if (!active) return;
        setLog(saved ?? emptyLog(date, chapter));
      } catch {
        if (active) {
          setLoadError(true);
          setSaveError(true);
          setStatus(
            "Today's reflection could not be loaded from this device. Reload before writing.",
          );
        }
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [chapter, date]);

  async function persist(next: DailyLog) {
    try {
      setSaving(true);
      setSaveError(false);
      await saveLocalLog(next);
      setLog(next);
      onChange?.(next);
      if (!navigator.onLine) {
        setStatus("Saved here. Sync will wait.");
        return;
      }
      try {
        await syncNow();
        setStatus("Saved and synced.");
      } catch {
        setStatus("Saved here. Sync will retry.");
      }
    } catch {
      setSaveError(true);
      setStatus(
        "This device could not save the reflection. Your typed text is still here; please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  function toggleStep(key: keyof DailyLog["steps"]) {
    const next: DailyLog = {
      ...log,
      chapter,
      steps: { ...log.steps, [key]: !log.steps[key] },
      updatedAt: nextTimestamp(log.updatedAt),
    };
    void persist(next);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await persist({
      ...log,
      chapter,
      updatedAt: nextTimestamp(log.updatedAt),
    });
  }

  if (!ready) {
    return (
      <section className={styles.card} aria-busy="true">
        Loading today’s study…
      </section>
    );
  }

  if (loadError) {
    return (
      <section className={styles.card} role="alert">
        {status}
      </section>
    );
  }

  const nextIncompleteKey = nextIncompleteStepKey(log.steps);

  return (
    <form className={styles.card} onSubmit={submit}>
      <header>
        <p className={styles.eyebrow}>TODAY’S LOOP</p>
        <h2>Take the next faithful step.</h2>
        <p className={styles.reassurance}>
          This is a guide, not a streak. An unfinished day is never a reset.
        </p>
      </header>

      <div className={styles.steps} aria-label="Study steps">
        <span className={styles.rail} aria-hidden="true" />
        {stepLabels.map((step) => {
          const done = log.steps[step.key];
          const isCurrent = !done && step.key === nextIncompleteKey;
          const state = done ? "done" : isCurrent ? "current" : "upcoming";
          return (
            <button
              aria-pressed={done}
              className={styles.step}
              data-complete={done || undefined}
              data-state={state}
              disabled={saving}
              key={step.key}
              onClick={() => toggleStep(step.key)}
              type="button"
            >
              <span className={styles.knotWrap} aria-hidden="true">
                <span className={styles.knot} />
              </span>
              <span className={styles.stepLabel}>{step.label}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.fields}>
        <label htmlFor={sentenceId}>One sentence</label>
        <textarea
          disabled={saving}
          id={sentenceId}
          onChange={(event) =>
            setLog({ ...log, sentence: event.target.value })
          }
          rows={2}
          value={log.sentence}
        />

        <label htmlFor={carryingId}>What are you carrying?</label>
        <textarea
          disabled={saving}
          id={carryingId}
          onChange={(event) =>
            setLog({ ...log, carrying: event.target.value })
          }
          rows={2}
          value={log.carrying}
        />

        <label htmlFor={prayerId}>Prayer</label>
        <textarea
          disabled={saving}
          id={prayerId}
          onChange={(event) => setLog({ ...log, prayer: event.target.value })}
          rows={3}
          value={log.prayer}
        />
      </div>

      <footer className={styles.footer}>
        <p aria-live="polite" role={saveError ? "alert" : "status"}>
          {status}
        </p>
        <button className={styles.save} disabled={saving} type="submit">
          {saving ? "Saving…" : "Save reflection"}
        </button>
      </footer>
    </form>
  );
}
