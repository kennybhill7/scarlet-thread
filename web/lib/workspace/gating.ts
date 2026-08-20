/**
 * WORKSPACESHELL-001 — the Passage Workspace's gating state machine.
 *
 * Pure functions only (no React, no DOM, no I/O), computing which of the
 * eight BUILD_PLAN §4 sections are UNLOCKED given a session plus its own
 * claims/applications, matching BUILD_PLAN §4's gating column. This module
 * answers ONE question per step — "has the learner earned curated help
 * here?" — truthfully, independent of how `components/workspace/
 * WorkspaceShell.tsx` chooses to use that answer when deciding what to put
 * in the DOM (see that file's own header comment for why "locked" does not
 * mean "removed from the page" in this shell).
 *
 * ---------------------------------------------------------------------------
 * GATING TABLE (BUILD_PLAN.md §4, "Curated help unlocks after" column) —
 * transcribed, not re-derived:
 *
 *   1. Read      — always (first, before anything else)
 *   2. Observe   — passage marked read
 *   3. Context   — >=1 observation
 *   4. Connect   — an attempted comparison
 *   5. Theology  — >=1 claim (connection optional — "Theology does not
 *                  require a Connection first", BUILD_PLAN.md:162)
 *   6. Conviction— optional, never gated
 *   7. Apply     — >=1 theology claim
 *   8. Teach     — >=1 finalized application
 *
 * This task's own acceptance criteria restate rows 3 and 5 slightly more
 * generally than the table's literal "observation" wording — "Context
 * unlocks after >=1 claim exists for the session" and "Theology unlocks
 * after >=1 claim exists" (any kind, not specifically "observation" for
 * Context). Both rows end up with the SAME predicate (`hasAnyClaim`) as a
 * result, which is not a bug: it is what "Theology does not require a
 * Connection first" already implies once Context is *also* not restricted
 * to a specific claim kind — a learner who has recorded any claim at all
 * (an observation, a question, anything) has done work past bare reading,
 * and both Context and Theology open on that same bar. This module follows
 * the acceptance criteria's own wording (the binding text for this task)
 * over the table's narrower "observation" phrasing, and documents the
 * divergence here rather than silently picking one.
 * ---------------------------------------------------------------------------
 */

import {
  STUDY_SESSION_STEPS,
  type Application,
  type ClaimKind,
  type StudyClaim,
  type StudySessionStep,
} from "@/lib/contracts/study-v2";

export interface GatingClaim {
  kind: ClaimKind;
  deletedAt?: string | null;
}

export interface GatingApplication {
  status: string;
  deletedAt?: string | null;
}

export interface GatingSession {
  readGateAt?: string | null;
}

export interface WorkspaceGatingInput {
  session: GatingSession;
  claims: GatingClaim[];
  applications: GatingApplication[];
}

function liveClaims(claims: GatingClaim[]): GatingClaim[] {
  return claims.filter((claim) => !claim.deletedAt);
}

function liveApplications(applications: GatingApplication[]): GatingApplication[] {
  return applications.filter((application) => !application.deletedAt);
}

/** True once at least one non-deleted claim exists for the session (any kind). */
export function hasAnyClaim(claims: GatingClaim[]): boolean {
  return liveClaims(claims).length > 0;
}

/** True once at least one non-deleted claim of the given kind exists. */
export function hasClaimOfKind(claims: GatingClaim[], kind: ClaimKind): boolean {
  return liveClaims(claims).some((claim) => claim.kind === kind);
}

/**
 * CONNECT GATE — "an attempted comparison" (BUILD_PLAN.md:169), the vaguest
 * gate in the table, so the interpretation is spelled out and defended here
 * rather than picked silently.
 *
 * Interpretation: a claim of kind `"context"` or `"interpretation"` counts
 * as an attempted comparison. Neither kind requires a second passage or a
 * `UserConnection` row to exist yet (Connect's own "Writes" column allows
 * `no_warrant_yet` — BUILD_PLAN.md:169 — so the gate cannot require the
 * connection ITSELF to already exist; that would make the gate impossible
 * to satisfy honestly for a learner who correctly finds no warrant). Both
 * "context" (placing the passage against its own historical/literary
 * surroundings) and "interpretation" (attempting what it means) are the
 * learner reasoning ABOUT something wider than the bare words on the page —
 * the same shape of stretch a cross-passage comparison requires, just not
 * yet aimed at a second passage. A bare "observation" claim (noticing
 * something IN the text, CLAIM_KINDS' first and narrowest kind) is
 * deliberately excluded: noticing is not yet comparing anything to
 * anything. "question"/"conviction"/"application"/"teaching_seed" are
 * excluded for the same reason — none of them are an attempt to relate this
 * passage to something else.
 */
export function hasAttemptedComparison(claims: GatingClaim[]): boolean {
  return liveClaims(claims).some(
    (claim) => claim.kind === "context" || claim.kind === "interpretation",
  );
}

/**
 * APPLY / TEACH's "finalized application" — `Application.status` is typed
 * plain `string` in lib/contracts/study-v2.ts (that file's own gap #3: no
 * document enumerates its values). BUILD_PLAN §4's Apply row is the only
 * textual hook available: "drafts save anytime; bridge fields checked at
 * finalize." "draft" is the one status word BUILD_PLAN itself uses for the
 * unfinished state, so this treats any OTHER non-empty status as finalized,
 * rather than inventing a second undocumented literal (e.g. "finalized")
 * this module has no authority to declare canonical.
 */
export function isApplicationFinalized(application: GatingApplication): boolean {
  const status = application.status.trim().toLowerCase();
  return status.length > 0 && status !== "draft";
}

/** True once at least one non-deleted application is finalized (see above). */
export function hasFinalizedApplication(applications: GatingApplication[]): boolean {
  return liveApplications(applications).some(isApplicationFinalized);
}

/**
 * Human-readable explanation for each step — shown by the shell whenever a
 * section is locked (BUILD_PLAN/acceptance criterion 3: "A locked section
 * explains WHY it is locked"). Written for the reader, not the developer.
 */
export const STEP_GATE_EXPLANATIONS: Record<StudySessionStep, string> = {
  read: "Always open — Scripture alone, before anything else.",
  observe: "Unlocks once this passage is marked read.",
  context: "Unlocks after your first claim in this session.",
  connect: "Unlocks after you attempt a comparison — a context or interpretation claim.",
  theology: "Unlocks after your first claim in this session — a connection is not required first.",
  conviction: "Never locked. Open at any point in your study — nothing here is scored or shared.",
  apply: "Unlocks after your first theology claim.",
  teach: "Unlocks after you finalize an application.",
};

export interface StepGateResult {
  step: StudySessionStep;
  unlocked: boolean;
  /** Always present, whether locked or unlocked — see STEP_GATE_EXPLANATIONS. */
  explanation: string;
}

/**
 * The gating table, computed. `STUDY_SESSION_STEPS` order in, same order
 * out — callers that need BUILD_PLAN §4's row order (every current caller)
 * get it for free without re-sorting.
 */
export function computeStepGates(input: WorkspaceGatingInput): StepGateResult[] {
  const { session, claims, applications } = input;
  const unlockedByStep: Record<StudySessionStep, boolean> = {
    read: true,
    observe: Boolean(session.readGateAt),
    context: hasAnyClaim(claims),
    connect: hasAttemptedComparison(claims),
    theology: hasAnyClaim(claims),
    conviction: true,
    apply: hasClaimOfKind(claims, "theology"),
    teach: hasFinalizedApplication(applications),
  };
  return STUDY_SESSION_STEPS.map((step) => ({
    step,
    unlocked: unlockedByStep[step],
    explanation: STEP_GATE_EXPLANATIONS[step],
  }));
}

/** Convenience lookup for one step, built on `computeStepGates` (never a parallel computation). */
export function isStepUnlocked(input: WorkspaceGatingInput, step: StudySessionStep): boolean {
  return computeStepGates(input).find((gate) => gate.step === step)?.unlocked ?? false;
}

/** Adapts real `StudyClaim[]` / `Application[]` records into this module's minimal shape. */
export function gatingInputFromRecords(
  session: GatingSession,
  claims: StudyClaim[],
  applications: Application[],
): WorkspaceGatingInput {
  return { session, claims, applications };
}
