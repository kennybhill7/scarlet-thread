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
  /**
   * CODEX_AUDIT.md A-032 -- true once the reader actually has loaded chapter
   * text to have read (ChapterReader.tsx computes this from its own
   * `primaryVerses`: non-null and non-empty), false while still loading OR
   * after a load error. Without this, "I'm finished reading" gated only on
   * its own click-set local boolean -- a reader who hit a load error could
   * still click it and unlock the composer with nothing actually read. This
   * is READGATE-001's same "a learner must not be able to write a typed claim
   * before the passage is marked read" discipline, applied here to the v1
   * flow it never touched.
   */
  textAvailable: boolean;
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
 *
 * `textAvailable` defaults to `true` so every pre-existing 3-argument call
 * site (this repo's own tests/verse-selection.test.ts, out of this task's
 * owned paths) keeps testing exactly what it always tested -- the
 * readComplete/selectedVerse gating this function already had -- without
 * being rewritten for an unrelated concern. Every REAL caller (StudySession
 * below) always passes it explicitly.
 */
export function composerRenderState(
  readComplete: boolean,
  chapter: RefKey,
  selectedVerse: RefKey | null | undefined,
  textAvailable: boolean = true,
): { visible: false } | { visible: true; chapter: RefKey; verse: RefKey | undefined } {
  if (!readComplete || !textAvailable) return { visible: false };
  return { visible: true, chapter, verse: selectedVerse ?? undefined };
}

/**
 * CODEX_AUDIT.md A-032 -- the single decision both the "I'm finished
 * reading" button's `disabled` prop and finishReading()'s own guard read
 * from, so the two can never drift to different answers. Exported, same
 * reasoning as composerRenderState above: directly unit-testable without a
 * DOM, and it is the exact function the render body and finishReading()
 * both call.
 */
export function canFinishReading(marking: boolean, textAvailable: boolean): boolean {
  return !marking && textAvailable;
}

function localDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function StudySessionState({ chapter, selectedVerse, textAvailable, children }: StudySessionProps) {
  const [readComplete, setReadComplete] = useState(false);
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState("");
  const [entryRevision, setEntryRevision] = useState(0);
  const composer = composerRenderState(readComplete, chapter, selectedVerse, textAvailable);

  async function finishReading() {
    // CODEX_AUDIT.md A-032 -- belt-and-suspenders alongside the disabled
    // button below: even if this were somehow invoked while there is no
    // loaded chapter text (a load error, an offline chapter, an empty
    // response), it must never write a "read" mark or open the composer.
    if (!canFinishReading(marking, textAvailable)) return;
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
              disabled={!canFinishReading(marking, textAvailable)}
              onClick={() => void finishReading()}
              type="button"
            >
              {marking ? "Saving…" : "I’m finished reading"}
            </button>
            {!textAvailable ? (
              <p className={styles.hint}>
                This chapter hasn’t loaded yet, so there’s nothing here to mark as read.
              </p>
            ) : null}
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
