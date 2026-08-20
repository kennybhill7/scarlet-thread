/**
 * WORKSPACESHELL-001 — pure render-state decisions for
 * `components/workspace/WorkspaceShell.tsx`, kept out of the component body
 * per this repo's established pattern (`components/notes/StudySession.tsx`'s
 * `composerRenderState`, `app/(app)/study/[sessionId]/page.tsx`'s own
 * `resolveStudyPageData`): pure functions the render body actually calls,
 * never a parallel test-only reimplementation.
 *
 * ---------------------------------------------------------------------------
 * WHY "LOCKED" NEVER REMOVES CONTENT FROM THE DOM HERE (read before changing
 * `computeWorkspaceSections`):
 *
 * `lib/workspace/gating.ts` answers "has this section's curated help been
 * earned yet?" truthfully. This module deliberately does NOT use that
 * answer to decide whether a section's real content (the Read
 * mark-as-read control, the mounted `ClaimComposer`) appears in the page at
 * all — only whether a "why this is locked" explanation is ALSO shown
 * alongside it. Three independent reasons, all binding:
 *
 *   1. Production reality: `components/reader/StudyEntry.tsx` (readOnlyPath
 *      here) creates every new v2 session with `currentStep: "observe"` and
 *      `readGateAt: null` in the SAME object literal — a freshly started
 *      session is, by the app's own existing behavior, already sitting on
 *      the Observe step before the read gate is set. A shell that hard-hid
 *      `ClaimComposer` whenever `readGateAt` is null would strand the
 *      learner at the very first screen this repo's own code puts them on,
 *      for a step this task does not own the fix to (StudyEntry.tsx is
 *      read-only here).
 *   2. `tests/study-page.test.ts` (frozen, read-only, must keep passing
 *      unweakened per this task's acceptance criteria) exercises exactly
 *      that fixture — `sampleSession()`'s `readGateAt: null`,
 *      `currentStep: "observe"` — and asserts the real `ClaimComposer`
 *      renders (`COMPOSER_HEADLINE` in the HTML). There is no way to
 *      satisfy that frozen assertion AND hard-gate Observe's content on
 *      `readGateAt` at the same time.
 *   3. Accessible-accordion practice: keeping every panel's real content in
 *      the DOM (toggling only visibility/expansion) rather than
 *      conditionally unmounting it is the standard pattern for a
 *      JS-optional, screen-reader-friendly disclosure widget, and matches
 *      criterion 3's own instruction — "never a bare disabled control with
 *      NO EXPLANATION" implies the explanation is additive, not a
 *      replacement for content.
 *
 * The `contentMode` a section renders is therefore a plain function of WHICH
 * step it is, never of `unlocked`. `unlocked` (and its `explanation`) drives
 * two things only: whether the "locked" notice is shown, and which section
 * is expanded by default (the session's own `currentStep` — see
 * `computeWorkspaceSections` below).
 * ---------------------------------------------------------------------------
 */

import { parseVerseKeyStrict } from "@/lib/bible/range";
import type { CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import type { StudySession, StudySessionStep } from "@/lib/contracts/study-v2";
import { STUDY_SESSION_STEPS } from "@/lib/contracts/study-v2";
import { computeStepGates, type StepGateResult, type WorkspaceGatingInput } from "@/lib/workspace/gating";

/** BUILD_PLAN §4's own product name for each section — must reach an assistive-tech user, not just a visual label. */
export const STEP_PRODUCT_NAMES: Record<StudySessionStep, string> = {
  read: "The Quiet Page",
  observe: "The Evidence Desk",
  context: "The Context Window",
  connect: "The Scarlet Thread Map",
  theology: "The Theology Table",
  conviction: "The Conviction Room",
  apply: "The Practice Bridge",
  teach: "Teach It Back",
};

/** Plain-English section label, distinct from the product name (both are shown — see the shell). */
export const STEP_LABELS: Record<StudySessionStep, string> = {
  read: "Read",
  observe: "Observe",
  context: "Context",
  connect: "Connect",
  theology: "Theology",
  conviction: "Conviction",
  apply: "Apply",
  teach: "Teach",
};

export type SectionContentMode = "read" | "observe" | "placeholder";

/** Which of the eight sections has a REAL surface built in this task; the rest are honest placeholders (deliberate scope boundary — see WorkspaceShell.tsx). */
const STEP_CONTENT_MODE: Record<StudySessionStep, SectionContentMode> = {
  read: "read",
  observe: "observe",
  context: "placeholder",
  connect: "placeholder",
  theology: "placeholder",
  conviction: "placeholder",
  apply: "placeholder",
  teach: "placeholder",
};

export interface SectionRenderState {
  step: StudySessionStep;
  label: string;
  productName: string;
  unlocked: boolean;
  /** Present only when `!unlocked` — the shell shows it as the "why locked" notice. */
  lockExplanation: string | null;
  /** This section matches the session's own `currentStep` right now. */
  isCurrent: boolean;
  /** Default open/closed state for the accordion `<details>` element. */
  expanded: boolean;
  contentMode: SectionContentMode;
}

/**
 * One row per BUILD_PLAN §4 section, in table order (`STUDY_SESSION_STEPS`
 * order). `gates` is normally `computeStepGates(...)`'s own output, passed
 * in rather than recomputed here so a caller (or a test) can supply a
 * fixed/mutated gate list without needing a full `WorkspaceGatingInput`.
 */
export function computeWorkspaceSections(
  currentStep: string,
  gates: StepGateResult[],
): SectionRenderState[] {
  const gateByStep = new Map(gates.map((gate) => [gate.step, gate]));
  return STUDY_SESSION_STEPS.map((step) => {
    const gate = gateByStep.get(step);
    const unlocked = gate?.unlocked ?? false;
    const isCurrent = step === currentStep;
    return {
      step,
      label: STEP_LABELS[step],
      productName: STEP_PRODUCT_NAMES[step],
      unlocked,
      lockExplanation: unlocked ? null : (gate?.explanation ?? null),
      isCurrent,
      expanded: isCurrent,
      contentMode: STEP_CONTENT_MODE[step],
    };
  });
}

/** `computeWorkspaceSections`, taking the same gating input `computeStepGates` does — the one call sites actually make. */
export function computeWorkspaceSectionsFromSession(
  session: Pick<StudySession, "currentStep">,
  gatingInput: WorkspaceGatingInput,
): SectionRenderState[] {
  return computeWorkspaceSections(session.currentStep, computeStepGates(gatingInput));
}

// ---------------------------------------------------------------------------
// Read section — mark-as-read + a link into the existing reading experience.
// No new write path: this only builds the updated `StudySession` record;
// the caller still writes it with `saveLocalStudySession`
// (`lib/sync/store.ts`, read-only here).
// ---------------------------------------------------------------------------

/**
 * `{ book, chapter }` for a Next.js `/read/[book]/[chapter]` link, derived
 * from the session's own canonical range start — never a second, separately
 * maintained range. Returns `null` for a malformed start key (defensive;
 * every stored range should already be well-formed per RANGE-001) so the
 * caller can omit the link rather than construct a broken href.
 */
export function readLinkParams(range: CanonicalRangeV1): { book: number; chapter: number } | null {
  const parsed = parseVerseKeyStrict(range.start);
  if (!parsed) return null;
  return { book: parsed.book, chapter: parsed.chapter };
}

/**
 * The updated `StudySession` record "mark as read" writes. Idempotent by
 * design (`readGateAt ?? now`): a second click after the gate is already set
 * does not overwrite the original timestamp. Only `readGateAt`, `revision`,
 * and `updatedAt` change — `currentStep` is left exactly as it was; this
 * task does not add a currentStep auto-advance behavior (out of scope —
 * see this task's commit message and WorkspaceShell.tsx's own header).
 */
export function buildReadGateUpdate(session: StudySession, now: string): StudySession {
  return {
    ...session,
    readGateAt: session.readGateAt ?? now,
    revision: session.revision + 1,
    updatedAt: now,
  };
}

/** True once this session's read gate is set — the one condition the Read section's own control needs to know about itself. */
export function isPassageMarkedRead(session: Pick<StudySession, "readGateAt">): boolean {
  return Boolean(session.readGateAt);
}
