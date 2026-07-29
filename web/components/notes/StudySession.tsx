"use client";

import { useState, type ReactNode } from "react";

import { DailyLoop } from "@/components/notes/DailyLoop";
import { EntryList } from "@/components/notes/EntryList";
import { NoteComposer } from "@/components/notes/NoteComposer";
import { syncNow } from "@/lib/sync/client";
import { markChapterRead } from "@/lib/sync/store";

import styles from "./study-session.module.css";

type StudySessionProps = {
  chapter: string;
  children: ReactNode;
};

function localDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function StudySessionState({ chapter, children }: StudySessionProps) {
  const [readComplete, setReadComplete] = useState(false);
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState("");
  const [entryRevision, setEntryRevision] = useState(0);

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
        {readComplete ? (
          <>
            <NoteComposer
              chapter={chapter}
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
