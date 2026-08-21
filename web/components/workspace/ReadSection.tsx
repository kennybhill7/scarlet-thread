"use client";

import { useState } from "react";

import Link from "next/link";

import type { StudySession } from "@/lib/contracts/study-v2";
import { saveLocalStudySession } from "@/lib/sync/store";
import { buildReadGateUpdate, isPassageMarkedRead, readLinkParams } from "@/lib/workspace/renderState";

import { bodyStyle } from "./styles";

/**
 * CLAIMPANES-001 — extracted verbatim from `WorkspaceShell.tsx`
 * (WORKSPACESHELL-001/READGATE-001), no behavior change. Read is always
 * open (never gated) — see `lib/workspace/gating.ts`.
 */
export interface ReadSectionProps {
  session: StudySession;
  onMarkedRead: (updated: StudySession) => void;
}

export function ReadSection({ session, onMarkedRead }: ReadSectionProps) {
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState("");
  const linkParams = readLinkParams(session.range);
  const alreadyRead = isPassageMarkedRead(session);

  async function markRead() {
    setMarking(true);
    setError("");
    try {
      const updated = buildReadGateUpdate(session, new Date().toISOString());
      await saveLocalStudySession(updated);
      onMarkedRead(updated);
    } catch {
      setError(
        "This device could not save your reading progress. Nothing else here is affected; please try again.",
      );
    } finally {
      setMarking(false);
    }
  }

  return (
    <div style={bodyStyle}>
      {linkParams ? (
        <p>
          <Link href={`/read/${linkParams.book}/${linkParams.chapter}`}>Open this passage in the reader</Link>
        </p>
      ) : null}
      {alreadyRead ? (
        <p data-testid="read-gate-set">Marked read on {session.readGateAt}.</p>
      ) : (
        <button type="button" onClick={() => void markRead()} disabled={marking} data-testid="mark-read-button">
          {marking ? "Saving…" : "Mark this passage as read"}
        </button>
      )}
      {error ? (
        <p role="alert" data-testid="mark-read-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
