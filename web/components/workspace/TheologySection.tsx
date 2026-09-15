"use client";

import { ClaimComposer } from "@/components/study";
import type { ClaimComposerSavedResult } from "@/components/study";
import type { PublishedLessonMatch } from "@/lib/content/publishedLessons";
import type { ClaimKind, StudySession } from "@/lib/contracts/study-v2";

import { LockedNotice } from "./LockedNotice";
import { bodyStyle, noticeStyle } from "./styles";

/**
 * CLAIMPANES-001 — BUILD_PLAN §4 row 5, "Theology — The Theology Table".
 * Unlocked per the EXISTING gate (`lib/workspace/gating.ts`'s
 * `theology: hasAnyClaim(claims)`, untouched by this task) — >=1 claim
 * exists for the session. Deliberately, per BUILD_PLAN.md:162, a
 * CONNECTION IS NOT REQUIRED FIRST ("Theology does not require a Connection
 * first...forcing a connection trains users to invent one") — the gate
 * computation this component reads is exactly the one
 * `tests/workspace-shell.test.ts`'s prior-wave mutation proof already
 * covers, re-run in this task to confirm the refactor did not quietly
 * couple them (see this task's commit message).
 *
 * Mounts the real `ClaimComposer`, narrowed via the criterion-2
 * `offeredKinds` prop to `["theology"]` — a theology claim carries a
 * `DoctrineStatus` (`ClaimComposer.tsx`'s own `PromoteFields` already shows
 * that fieldset once `kind === "theology"`, unchanged by this task).
 *
 * RELEASEREADER-001: when `curatedLesson` is present AND carries real
 * `## Positions` prose (`lib/content/publishedLessons.ts`'s
 * `positionsProse` — named positions, reported descriptively, exactly the
 * content shape BUILD_PLAN §5.0 permits a lesson to assert), that prose
 * renders INSTEAD OF the fixed "no curated doctrine content yet" notice.
 * This is NOT rendered as if it were the app's own doctrinal verdict — the
 * surrounding copy already frames the learner's own theology claim as
 * separate and their own, and this task only replaces the one "nothing
 * exists yet" sentence, nothing else in that framing. For every other
 * passage (no `curatedLesson`, or one with no `## Positions` section), the
 * original fixed notice renders completely unchanged — a real regression
 * guard proven by `tests/workspace-shell.test.ts`'s RENDER section.
 */
export interface TheologySectionProps {
  workspaceId: string;
  session: StudySession;
  unlocked: boolean;
  offeredKinds: readonly ClaimKind[];
  onSaved: (result: ClaimComposerSavedResult) => void;
  curatedLesson?: PublishedLessonMatch | null;
}

export function TheologySection({
  workspaceId,
  session,
  unlocked,
  offeredKinds,
  onSaved,
  curatedLesson = null,
}: TheologySectionProps) {
  if (!unlocked) {
    return (
      <LockedNotice
        testId="theology-locked"
        message="Locked until your first claim in this session. A connection is not required first — use Observe above, then this composer opens."
      />
    );
  }

  return (
    <div style={bodyStyle}>
      {curatedLesson?.positionsProse ? (
        <p style={noticeStyle} data-testid="theology-curated-content">
          {curatedLesson.positionsProse}
        </p>
      ) : (
        <p style={noticeStyle} data-testid="theology-no-curated-notice">
          No curated doctrine content yet for this passage — Phase 4&rsquo;s Positions Library has not been built.
          What follows is your own claim, warranted by your own evidence.
        </p>
      )}
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
