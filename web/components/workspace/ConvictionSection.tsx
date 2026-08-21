"use client";

import { ClaimComposer } from "@/components/study";
import type { ClaimComposerSavedResult } from "@/components/study";
import type { ClaimKind, StudySession } from "@/lib/contracts/study-v2";

import { bodyStyle, noticeStyle } from "./styles";

/**
 * CLAIMPANES-001 — BUILD_PLAN §4 row 6, "Conviction — The Conviction Room".
 * NEVER gated, by construction of THIS component, not merely because
 * `lib/workspace/gating.ts`'s `computeStepGates` currently always returns
 * `unlocked: true` for it (untouched by this task either way): this
 * component takes no `unlocked` prop and has no locked branch at all — the
 * real composer mounts unconditionally on every render, full stop.
 *
 * Mounts the real `ClaimComposer`, narrowed via the criterion-2
 * `offeredKinds` prop to `["conviction"]`.
 *
 * PRIVACY (acceptance criterion 5): BUILD_PLAN §4 row 6 and BUILD_PLAN §3.3
 * describe conviction claims as private-by-design across five surfaces
 * (analytics, server telemetry, sharing, AI retrieval, teaching promotion).
 * Grepping this codebase (see this task's commit message for the exact
 * commands run) found FOUR of those five do not exist ANYWHERE in this
 * codebase yet — no analytics/telemetry/sharing/AI-retrieval surface reads
 * `StudyClaim` rows at all today — so there is nothing to newly exclude
 * from, and no speculative privacy infrastructure is built here for
 * features that do not exist. The one concrete obligation this task DOES
 * have: this component adds no new read path of any kind. The claim this
 * mounts saves through the exact same `saveLocalStudyClaim` vault writer
 * every other kind uses (`ClaimComposer.tsx`, a readOnlyPath-turned-owned
 * sibling here), scoped by the SAME `workspaceId` this section itself
 * receives from its caller (`WorkspaceShell.tsx`, which in turn only ever
 * has its own signed-in caller's own workspace id — see
 * `app/(app)/study/[sessionId]/page.tsx`'s own "WORKSPACE RESOLUTION" — and
 * that page's existing hostile tests, read-only here, already prove a
 * session id belonging to another workspace 404s rather than leaking). A
 * conviction claim written here is therefore visible only inside its own
 * workspace's own view of its own data, exactly like every other claim kind
 * — nothing added here exposes it any more widely than that.
 */
export interface ConvictionSectionProps {
  workspaceId: string;
  session: StudySession;
  offeredKinds: readonly ClaimKind[];
  onSaved: (result: ClaimComposerSavedResult) => void;
}

export function ConvictionSection({ workspaceId, session, offeredKinds, onSaved }: ConvictionSectionProps) {
  return (
    <div style={bodyStyle}>
      <p style={noticeStyle} data-testid="conviction-privacy-notice">
        Nothing here is scored, shared, or fed to any analytics, telemetry, or AI-retrieval surface — this app has
        none of those today, and a conviction claim stays inside your own workspace&rsquo;s own view of its own data
        either way. Open at any point in your study.
      </p>
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
