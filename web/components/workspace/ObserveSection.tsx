"use client";

import { ClaimComposer } from "@/components/study";
import type { ClaimComposerSavedResult } from "@/components/study";
import type { StudySession } from "@/lib/contracts/study-v2";
import { isPassageMarkedRead } from "@/lib/workspace/renderState";

import { LockedNotice } from "./LockedNotice";
import { bodyStyle } from "./styles";

/**
 * CLAIMPANES-001 — extracted from `WorkspaceShell.tsx` (READGATE-001), no
 * behavior change. Mounts the real, UNMODIFIED `ClaimComposer` (full
 * eight-kind picker — Observe predates this task's criterion-2 decision and
 * is not one of the three sections that decision applies to) ONLY once
 * `isPassageMarkedRead(session)` is true; otherwise shows the same honest
 * "why locked" treatment every other gated real surface uses (`LockedNotice`,
 * generalized here from the original inline `ObserveLocked`).
 */
export interface ObserveSectionProps {
  workspaceId: string;
  session: StudySession;
  onSaved: (result: ClaimComposerSavedResult) => void;
}

export function ObserveSection({ workspaceId, session, onSaved }: ObserveSectionProps) {
  return (
    <div style={bodyStyle}>
      {isPassageMarkedRead(session) ? (
        <ClaimComposer workspaceId={workspaceId} range={session.range} session={session} onSaved={onSaved} />
      ) : (
        <LockedNotice
          testId="observe-locked"
          message="Locked until you mark this passage as read. Read comes first — use the Read section above, then this composer opens."
        />
      )}
    </div>
  );
}
