"use client";

import { LessonDetails, LessonProse } from "@/components/lesson";
import { ClaimComposer } from "@/components/study";
import type { ClaimComposerSavedResult } from "@/components/study";
import type { PublishedLessonMatch } from "@/lib/content/publishedLessons";
import type { ClaimKind, StudySession } from "@/lib/contracts/study-v2";

import { LockedNotice } from "./LockedNotice";
import { bodyStyle, noticeStyle } from "./styles";

/**
 * CLAIMPANES-001 — BUILD_PLAN §4 row 3, "Context — The Context Window".
 * Unlocked per the EXISTING gate (`lib/workspace/gating.ts`'s
 * `context: hasAnyClaim(claims)`, untouched by this task) — >=1 claim exists
 * for the session. Mounts the real `ClaimComposer`, narrowed via the
 * criterion-2 `offeredKinds` prop to `["interpretation"]` (see
 * `lib/workspace/renderState.ts`'s `SECTION_OFFERED_KINDS` and
 * `ClaimComposer.tsx`'s own header for the full reasoning) — the learner's
 * attempt at the original-audience meaning, BUILD_PLAN.md:168's own wording.
 *
 * RELEASEREADER-001: when `curatedLesson` is present AND carries real
 * `## Context` prose (`lib/content/publishedLessons.ts`'s
 * `contextProse`), that prose renders INSTEAD OF the fixed "no curated
 * context yet" notice — above the still-always-present `ClaimComposer`
 * (the learner's own attempt still happens either way; curated context
 * supplements it, never replaces it, per BUILD_PLAN's own tenet 1
 * discipline). For every other passage (no `curatedLesson`, or one with no
 * `## Context` section), the original fixed notice renders completely
 * unchanged — BUILD_PLAN.md:168 itself allows exactly that state ("no
 * curated context yet for this passage" for uncovered units), and this is a
 * real regression guard: `tests/workspace-shell.test.ts`'s RENDER section proves the
 * no-curated-lesson render is byte-identical to before this task.
 *
 * Gated the SAME way Observe is (READGATE-001): the real, write-capable
 * composer does not mount before its own gate is met; `LockedNotice` shows
 * instead, never a bare disabled control with no explanation.
 */
export interface ContextSectionProps {
  workspaceId: string;
  session: StudySession;
  unlocked: boolean;
  offeredKinds: readonly ClaimKind[];
  onSaved: (result: ClaimComposerSavedResult) => void;
  curatedLesson?: PublishedLessonMatch | null;
}

export function ContextSection({
  workspaceId,
  session,
  unlocked,
  offeredKinds,
  onSaved,
  curatedLesson = null,
}: ContextSectionProps) {
  if (!unlocked) {
    return (
      <LockedNotice
        testId="context-locked"
        message="Locked until your first claim in this session. Use Observe above first, then this composer opens."
      />
    );
  }

  return (
    <div style={bodyStyle}>
      {curatedLesson?.introProse ? (
        <LessonProse
          heading="What this lesson practices"
          markdown={curatedLesson.introProse}
          testId="context-lesson-intro"
        />
      ) : null}
      {curatedLesson?.contextProse ? (
        <LessonProse
          heading="Context from this lesson"
          markdown={curatedLesson.contextProse}
          testId="context-curated-content"
        />
      ) : (
        <p style={noticeStyle} data-testid="context-no-curated-notice">
          {curatedLesson
            ? "This lesson has no context notes for this passage. Your own attempt always comes first. Below, write what you think this passage meant to its original audience."
            : "No lesson has been written for this passage yet. You can still record your own observations, and your own attempt always comes first. Below, write what you think this passage meant to its original audience."}
        </p>
      )}
      {curatedLesson?.literaryDesignProse ? (
        <LessonDetails
          markdown={curatedLesson.literaryDesignProse}
          summary="How this passage is built"
          testId="context-literary-design"
        />
      ) : null}
      {curatedLesson?.questionsToCarryProse ? (
        <LessonDetails
          markdown={curatedLesson.questionsToCarryProse}
          summary="Questions to carry"
          testId="context-questions-to-carry"
        />
      ) : null}
      <ClaimComposer
        offeredKinds={offeredKinds}
        onSaved={onSaved}
        range={session.range}
        session={session}
        workspaceId={workspaceId}
      />
    </div>
  );
}
