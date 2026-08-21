/**
 * WORKSPACESHELL-001 — pure render-state decisions for
 * `components/workspace/WorkspaceShell.tsx`, kept out of the component body
 * per this repo's established pattern (`components/notes/StudySession.tsx`'s
 * `composerRenderState`, `app/(app)/study/[sessionId]/page.tsx`'s own
 * `resolveStudyPageData`): pure functions the render body actually calls,
 * never a parallel test-only reimplementation.
 *
 * ---------------------------------------------------------------------------
 * WHY "LOCKED" GENERALLY DOES NOT REMOVE CONTENT FROM THE DOM HERE — EXCEPT
 * OBSERVE, AS OF READGATE-001 (read before changing `computeWorkspaceSections`
 * or `WorkspaceShell.tsx`'s Observe branch):
 *
 * `lib/workspace/gating.ts` answers "has this section's curated help been
 * earned yet?" truthfully. For six of the eight sections (Context, Connect,
 * Theology, Conviction, Apply, Teach — the placeholders) and for Read, this
 * module still does NOT use that answer to decide whether a section's real
 * content appears in the page at all — only whether a "why this is locked"
 * explanation is ALSO shown alongside it (accessible-accordion practice:
 * keeping every panel's real content in the DOM, toggling only visibility/
 * expansion, is the standard pattern for a JS-optional, screen-reader-
 * friendly disclosure widget).
 *
 * OBSERVE IS THE ONE DELIBERATE EXCEPTION (READGATE-001, 2026-08-20): Ken
 * decided, in response to WORKSPACESHELL-001 explicitly surfacing this as an
 * open product question rather than resolving it silently, that BUILD_PLAN
 * tenet 1 ("read before you write... enforced in UI state, not honor
 * system") must be honored for real. The reasoning WORKSPACESHELL-001
 * recorded here for leaving Observe's content unconditional no longer holds,
 * and is corrected rather than left standing:
 *
 *   1. Production reality has changed: `components/reader/StudyEntry.tsx`
 *      and `components/study/ClaimComposer.tsx`'s own `buildNewStudySession`/
 *      `buildStudySessionDraft` now create every new v2 session with
 *      `currentStep: "read"` (not `"observe"`), so a freshly started session
 *      no longer starts sitting on Observe before the read gate is set —
 *      there is no longer a production session this reversal could strand.
 *   2. `tests/study-page.test.ts` and `tests/study-composer.test.ts` are no
 *      longer frozen against the old `readGateAt: null` -> composer-renders
 *      fixture — READGATE-001 explicitly authorizes and requires updating
 *      that exact assumption in both files.
 *   3. Accessible-accordion practice does not require every section's LIVE,
 *      WRITE-CAPABLE surface to be reachable before its own stated
 *      prerequisite is met — it requires the reader not be lied to. Observe
 *      still shows its lock notice (same as every other locked section) when
 *      not yet unlocked; what changes is that the real `ClaimComposer` no
 *      longer mounts alongside that notice while the passage has not been
 *      marked read (`isPassageMarkedRead(session)`, below) — an honor-system
 *      gate on the app's very first authoring surface undercuts the app's
 *      central premise, and BUILD_PLAN tenet 1 is fixed for every phase, not
 *      a detail this shell gets to relax.
 *
 * Concretely: `computeWorkspaceSections`'s `contentMode` for Observe stays
 * `"observe"` regardless of lock state (it still describes WHICH kind of
 * real surface this section HAS, independent of visibility — the six
 * placeholder sections are unaffected by any of this, and Read remains
 * always-open and ungated exactly as before). `WorkspaceShell.tsx` is the
 * layer that now additionally checks `isPassageMarkedRead(session)` before
 * mounting the real `ClaimComposer` inside a `contentMode === "observe"`
 * section, and renders the same kind of honest "why locked" treatment the
 * placeholder sections already use otherwise — see that file's own header
 * comment for the render-side half of this.
 *
 * CLAIMPANES-001 (2026-08-21) extends the SAME exception to Context and
 * Theology, now their own `contentMode`s ("context" / "theology") rather
 * than "placeholder": each mounts a real, write-capable `ClaimComposer`
 * (narrowed to one offered `ClaimKind` — see `SECTION_OFFERED_KINDS` below
 * and this task's commit message for the criterion-2 design decision) once
 * its own gate from `lib/workspace/gating.ts` (UNTOUCHED by this task) is
 * satisfied, and a `LockedNotice` otherwise — the identical shape READGATE-001
 * established for Observe, not a new pattern. Conviction also becomes its
 * own `contentMode` ("conviction"), but is never gated: its section always
 * mounts the real composer unconditionally, both because
 * `computeStepGates` already returns `unlocked: true` for it and, more
 * importantly, because `ConvictionSection.tsx` itself never reads an
 * `unlocked` prop at all — "never gated" is a property of that component,
 * not an inference from today's gate value. Connect/Apply/Teach remained
 * "placeholder" as of CLAIMPANES-001 — architecturally different, out of
 * that task's scope.
 *
 * APPLYPANE-001 (2026-08-21) graduates Apply to its own `contentMode`
 * ("apply"), the SAME shape again: `ApplySection.tsx` mounts once
 * `lib/workspace/gating.ts`'s `apply` gate (>=1 theology claim, UNTOUCHED by
 * this task) is satisfied, `LockedNotice` otherwise. Apply is NOT a
 * `ClaimComposer` mount at all — it writes a whole different v2 entity
 * (`Application`, via `saveLocalApplication`, `lib/sync/store.ts`) with its
 * own bridge-field form, so it carries no `offeredKinds` entry below (stays
 * `undefined`, same as Read/Observe/Connect/Teach — "not applicable" is
 * correct for a non-`ClaimComposer` section, not a gap). Connect/Teach remain
 * "placeholder" — still out of this task's scope (see `WorkspaceShell.tsx`'s
 * header).
 * ---------------------------------------------------------------------------
 */

import { parseVerseKeyStrict } from "@/lib/bible/range";
import type { CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import type { ClaimKind, StudySession, StudySessionStep } from "@/lib/contracts/study-v2";
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

export type SectionContentMode = "read" | "observe" | "context" | "theology" | "conviction" | "apply" | "placeholder";

/** Which sections have a REAL surface built so far; Connect/Teach remain honest placeholders (deliberate scope boundary — see WorkspaceShell.tsx). Apply graduated in APPLYPANE-001. */
const STEP_CONTENT_MODE: Record<StudySessionStep, SectionContentMode> = {
  read: "read",
  observe: "observe",
  context: "context",
  connect: "placeholder",
  theology: "theology",
  conviction: "conviction",
  apply: "apply",
  teach: "placeholder",
};

/**
 * CLAIMPANES-001 acceptance criterion 2's design decision, applied
 * identically to all three sections it covers (see this task's commit
 * message for the full reasoning): Context/Theology/Conviction each mount
 * `ClaimComposer` with its `offeredKinds` prop narrowed to the ONE
 * `ClaimKind` that section's own BUILD_PLAN §4 row writes — never more than
 * one, and never a kind other than the row's own ("Context...writes...
 * interpretation", "Theology...writes...theology", "Conviction...writes...
 * conviction"). `undefined` (Read/Observe/Connect/Apply/Teach) means "not
 * applicable" — Apply (APPLYPANE-001) is real but is not a `ClaimComposer`
 * mount at all (it writes `Application`, a different v2 entity, through its
 * own `ApplySection.tsx` form), so it stays `undefined` here alongside the
 * still-unbuilt Connect/Teach placeholders — "not applicable" and "not built
 * yet" both resolve to the same `undefined`, which is correct: this map only
 * ever answers "which ClaimKind does this section's ClaimComposer offer,"
 * and Apply's answer to that question is "none, it isn't one." Observe stays
 * the ORIGINAL, unmodified, full-eight-kind
 * `ClaimComposer` mount; it predates this decision and is not one of the
 * three sections it governs.
 */
const SECTION_OFFERED_KINDS: Partial<Record<StudySessionStep, readonly ClaimKind[]>> = {
  context: ["interpretation"],
  theology: ["theology"],
  conviction: ["conviction"],
};

/** Pure lookup — the one place `SECTION_OFFERED_KINDS` is read, so a test can prove `computeWorkspaceSections`' output without reaching into JSX. */
export function offeredKindsForStep(step: StudySessionStep): readonly ClaimKind[] | undefined {
  return SECTION_OFFERED_KINDS[step];
}

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
  /** The single `ClaimKind` this section's `ClaimComposer` offers, per `SECTION_OFFERED_KINDS` above; `undefined` where not applicable. */
  offeredKinds: readonly ClaimKind[] | undefined;
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
      offeredKinds: offeredKindsForStep(step),
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
 * does not overwrite the original timestamp.
 *
 * READGATE-001 (2026-08-20), acceptance criterion 3: this write ALSO
 * advances `currentStep` from `"read"` to `"observe"` in the same update —
 * ONLY that one transition. A session already sitting on any step other
 * than `"read"` (the learner has already moved on, e.g. by using an
 * accordion section directly) keeps its own `currentStep` untouched; this
 * function never moves a session backward, and never invents auto-advance
 * behavior for any of the other six steps — that is separate, harder,
 * future work this task deliberately does not improvise (see
 * `WorkspaceShell.tsx`'s own header and this task's commit message). The
 * idempotent-timestamp behavior above is unchanged: a second click after the
 * gate is already set still only bumps `revision`/`updatedAt`, and by then
 * `currentStep` has typically already moved past `"read"` so the `=== "read"`
 * check below is simply false on that second call — not a special case.
 */
export function buildReadGateUpdate(session: StudySession, now: string): StudySession {
  return {
    ...session,
    readGateAt: session.readGateAt ?? now,
    currentStep: session.currentStep === "read" ? "observe" : session.currentStep,
    revision: session.revision + 1,
    updatedAt: now,
  };
}

/** True once this session's read gate is set — the one condition the Read section's own control needs to know about itself. */
export function isPassageMarkedRead(session: Pick<StudySession, "readGateAt">): boolean {
  return Boolean(session.readGateAt);
}
