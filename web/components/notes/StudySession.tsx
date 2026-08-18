"use client";

import { useState, type ReactNode } from "react";

import { DailyLoop } from "@/components/notes/DailyLoop";
import { EntryList } from "@/components/notes/EntryList";
import { NoteComposer } from "@/components/notes/NoteComposer";
import type { RefKey } from "@/lib/contracts";
import { syncNow } from "@/lib/sync/client";
import { markChapterRead } from "@/lib/sync/store";

import styles from "./study-session.module.css";

type StudySessionProps = {
  chapter: string;
  /** A verse picked in the reader, if any. Optional -- chapter-level capture
   *  must keep working with no verse selected. */
  selectedVerse?: RefKey | null;
  children: ReactNode;
};

/**
 * Decides whether the capture composer is visible and, if so, exactly what
 * it receives. Pulled out as a pure function -- rather than left inline in
 * the render body -- so the read-before-write gate (readComplete) and the
 * verse-threading (selectedVerse -> verse) are each independently testable
 * without needing to drive the "I'm finished reading" click through a DOM
 * that this repo's test runner does not have. This is the exact function the
 * render body below calls, not a parallel reimplementation of its logic.
 */
export function composerRenderState(
  readComplete: boolean,
  chapter: RefKey,
  selectedVerse: RefKey | null | undefined,
): { visible: false } | { visible: true; chapter: RefKey; verse: RefKey | undefined } {
  if (!readComplete) return { visible: false };
  return { visible: true, chapter, verse: selectedVerse ?? undefined };
}

function localDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function StudySessionState({ chapter, selectedVerse, children }: StudySessionProps) {
  const [readComplete, setReadComplete] = useState(false);
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState("");
  const [entryRevision, setEntryRevision] = useState(0);
  const composer = composerRenderState(readComplete, chapter, selectedVerse);

  async function finishReading() {
    setMarking(true);
    setMarkError("");
    const readAt = new Date().toISOString();
    try {
      await markChapterRead({ chapter, readAt });
      setReadComplete(true);
      if (navigator.onLine) {
        void syncNow().catch(() => {
          // The local mark is authoritative until the automatic retry succeeds.
        });
      }
    } catch {
      setMarkError(
        "This device could not save your reading progress. Your notes are still closed so nothing is lost; please try again.",
      );
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className={styles.session}>
      {children}

      <section className={styles.transition}>
        {!readComplete ? (
          <>
            <p className={styles.eyebrow}>WHEN YOU’RE READY</p>
            <h2>Stay with the text before opening your notes.</h2>
            <p>
              Read first. Observe before summarizing. Nothing below is counting
              the minutes or waiting to punish a missed day.
            </p>
            <button
              disabled={marking}
              onClick={() => void finishReading()}
              type="button"
            >
              {marking ? "Saving…" : "I’m finished reading"}
            </button>
            {markError ? (
              <p className={styles.error} role="alert">
                {markError}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className={styles.eyebrow}>NOW WRITE</p>
            <h2>What stayed with you?</h2>
          </>
        )}
      </section>

      <div className={styles.writing} data-open={readComplete || undefined}>
        {composer.visible ? (
          <>
            <NoteComposer
              chapter={composer.chapter}
              verse={composer.verse}
              onSaved={() => setEntryRevision((value) => value + 1)}
              readComplete
            />
            <EntryList chapter={chapter} key={entryRevision} />
            <DailyLoop date={localDate()} chapter={chapter} />
          </>
        ) : null}
      </div>
    </div>
  );
}

export function StudySession(props: StudySessionProps) {
  return <StudySessionState key={props.chapter} {...props} />;
}
