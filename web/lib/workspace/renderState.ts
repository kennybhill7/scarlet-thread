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
 * Teach remains "placeholder" as of these two same-day sibling tasks —
 * TEACHDRAFTPANE-001 (also 2026-08-21) graduates it too, the SAME exception
 * a fourth time: its own `contentMode` ("teach"), gated on the EXISTING
 * `teach: hasFinalizedApplication(applications)` gate (`lib/workspace/
 * gating.ts`, untouched). Unlike Context/Theology/Conviction, Teach's real
 * surface is NOT a narrowed `ClaimComposer` mount — a `TeachingDraft` is an
 * architecturally different record (title/bigIdea/audience/durationMinutes/
 * gospelConnection, not a `StudyClaim`), so it gets its own composer,
 * `TeachSection.tsx`, writing through the already-built
 * `saveLocalTeachingDraft` vault writer. Deliberately DRAFT-LEVEL FIELDS
 * ONLY, not the section-by-section outline builder BUILD_PLAN also
 * describes — see `TeachSection.tsx`'s own header for the verified (not
 * merely asserted) scope boundary.
 *
 * As of this integration (2026-08-21), all eight sections have graduated
 * from the generic placeholder — Read, Observe, Context, Connect, Theology,
 * Conviction, Apply, and Teach are all real. The section-by-section outline
 * builder inside Teach (ordered kind/sortOrder/body rows) is the one piece
 * of Phase 2's BUILD_PLAN section 4 spec still unbuilt, gated behind a
 * ninth sync entity that does not exist yet — see `TeachSection.tsx`'s own
 * header.
 * ---------------------------------------------------------------------------
 */

import { parseVerseKeyStrict } from "@/lib/bible/range";
import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import {
  isPersonalResonanceEvidenceLabelValid,
  type ClaimKind,
  type ConnectionType,
  type EvidenceLabel,
  type StudySession,
  type StudySessionStep,
  type UserConnection,
} from "@/lib/contracts/study-v2";
import { EVIDENCE_LABELS, STUDY_SESSION_STEPS } from "@/lib/contracts/study-v2";
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

export type SectionContentMode =
  | "read"
  | "observe"
  | "context"
  | "connect"
  | "theology"
  | "conviction"
  | "apply"
  | "teach"
  | "placeholder";

/** All eight sections now have a real surface (deliberate scope boundary on Teach's own outline builder remains — see WorkspaceShell.tsx / TeachSection.tsx). */
const STEP_CONTENT_MODE: Record<StudySessionStep, SectionContentMode> = {
  read: "read",
  observe: "observe",
  context: "context",
  connect: "connect",
  theology: "theology",
  conviction: "conviction",
  apply: "apply",
  teach: "teach",
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

// ---------------------------------------------------------------------------
// Connect section — CONNECTPANE-001 (BUILD_PLAN §4 row 4, "Connect — The
// Scarlet Thread Map"). All payload-construction and selection-mechanics for
// `components/workspace/ConnectSection.tsx` live here, per this task's own
// acceptance criterion 7 ("any payload-construction or gating logic lives in
// a pure function under lib/workspace/, not inline JSX a test cannot
// reach") — the same discipline `buildStudyClaimDraft`/`selectKind` in
// `components/study/ClaimComposer.tsx` already established for claims,
// applied here to the separate `UserConnection` entity.
//
// No new write path: `ConnectSection.tsx` calls `saveLocalUserConnection`
// (typed connection) or `saveLocalStudySession` (no_warrant_yet) — both
// already-built `lib/sync/store.ts` writers (readOnlyPath here) — with the
// records these functions build.
// ---------------------------------------------------------------------------

/**
 * BUILD_PLAN §3.3 / `db/schema.ts`'s own comment on `user_connections.
 * rationale` ("Required, minimum 20 characters"), confirmed against the
 * REAL enforced value rather than guessed: `lib/api/sync-v2.ts`'s
 * `syncUserConnectionV2Schema` (the schema `saveLocalUserConnection` itself
 * validates every local write against, via `v2PayloadSchemas` in
 * `lib/sync/store.ts`) types the field `z.string().trim().min(20).max(20_000)`
 * — 20 is the real, live-enforced minimum, not a number picked from the
 * comment alone.
 */
export const CONNECTION_RATIONALE_MIN_LENGTH = 20;

/**
 * The two fields a Connect submission must choose, kept separate from the
 * range/rationale text state (plain component `useState` strings in
 * `ConnectSection.tsx` — no assertion-line risk in holding raw text) because
 * `type` and `evidenceLabel` have a REAL, enforced coupling
 * (`isPersonalResonanceEvidenceLabelValid`, `lib/contracts/study-v2.ts`) that
 * must be impossible to violate through this file's own mutator functions,
 * not just discouraged by them.
 */
export interface ConnectionSelectionDraft {
  type: ConnectionType | null;
  evidenceLabel: EvidenceLabel | null;
}

/** Mirrors `ClaimComposer.tsx`'s `BLANK_CLAIM_SELECTION` — nothing starts pre-selected (teaching-not-theology assertion-line discipline extends to "the app never picks a connection type for you" too). */
export const BLANK_CONNECTION_SELECTION: ConnectionSelectionDraft = {
  type: null,
  evidenceLabel: null,
};

/**
 * The ONLY evidence label a `personal_resonance` connection may ever carry —
 * `db/schema.ts`'s `user_connections_personal_resonance_devotional_check`,
 * transcribed as a single-element array so the render side
 * (`evidenceLabelOptionsFor`, below) can hand it straight to `optionsFrom`
 * exactly like every unrestricted field's full array.
 */
const PERSONAL_RESONANCE_ONLY_EVIDENCE_LABELS: readonly EvidenceLabel[] = ["devotional"];

/**
 * THE STRUCTURAL HALF of the CHECK-constraint guarantee (acceptance
 * criterion 2): `ConnectSection.tsx`'s evidence-label chip fieldset renders
 * `optionsFrom(evidenceLabelOptionsFor(selection.type))`, never the bare
 * `EVIDENCE_LABELS` array directly — so the moment `type` is
 * `"personal_resonance"`, the ONLY chip that exists in the rendered tree is
 * "devotional". A learner cannot click a chip that was never rendered; this
 * is stronger than merely disabling the other three, because there is
 * nothing in the DOM to disable in the first place.
 */
export function evidenceLabelOptionsFor(type: ConnectionType | null): readonly EvidenceLabel[] {
  return type === "personal_resonance" ? PERSONAL_RESONANCE_ONLY_EVIDENCE_LABELS : EVIDENCE_LABELS;
}

/**
 * Choosing a connection type. THE AUTO-LOCK HALF of the CHECK-constraint
 * guarantee (acceptance criterion 2, the "auto-locking...and saying so
 * visibly" branch this task chose over silent filtering alone —
 * `ConnectSection.tsx`'s own header comment defends the choice): the instant
 * `type` becomes `"personal_resonance"`, `evidenceLabel` is force-set to
 * `"devotional"` in the SAME update, mirroring `selectKind`'s
 * `doctrineStatus` reset in `ClaimComposer.tsx` exactly — a stale
 * non-devotional label left over from a PRIOR type selection can never ride
 * along silently.
 */
export function selectConnectionType(
  selection: ConnectionSelectionDraft,
  type: ConnectionType,
): ConnectionSelectionDraft {
  return {
    ...selection,
    type,
    evidenceLabel: type === "personal_resonance" ? "devotional" : selection.evidenceLabel,
  };
}

/**
 * Choosing an evidence label directly. BELT-AND-SUSPENDERS (acceptance
 * criterion 2's own "a test must prove the UI can never construct a payload
 * the CHECK constraint would refuse"): the render-side narrowing above
 * (`evidenceLabelOptionsFor`) already makes it structurally impossible for
 * `ConnectSection.tsx`'s OWN rendered chips to call this with an invalid
 * combination, but this function refuses the invalid combination itself too
 * — a no-op that returns `selection` unchanged — so a FUTURE caller of this
 * exported function (a different mount, a test, a refactor that forgets the
 * render-side narrowing) still cannot construct it either. Both halves are
 * proven independently in `tests/connect-pane.test.ts`.
 */
export function selectEvidenceLabel(
  selection: ConnectionSelectionDraft,
  evidenceLabel: EvidenceLabel,
): ConnectionSelectionDraft {
  if (selection.type === "personal_resonance" && evidenceLabel !== "devotional") return selection;
  return { ...selection, evidenceLabel };
}

/**
 * Parses the learner-typed "other passage" boundary keys into a
 * `CanonicalRangeV1`, or `null` for anything malformed. DESIGN DECISION
 * (acceptance criterion 1's "typing a reference" option, defended here since
 * no reusable verse-PICKER widget exists anywhere in this codebase — grepped,
 * not assumed; see this task's commit message): rather than inventing a new
 * picker, this reuses the exact canonical-key TEXT FORM this app already
 * shows learners today — `ClaimComposer.tsx`'s own `formatRange` renders a
 * session's range as "1.3.1–1.3.6" directly in the composer header, so
 * asking a learner to TYPE a boundary in that same "book.chapter.verse" form
 * is consistent with what they already read elsewhere in this workspace, not
 * a new convention. Parsing reuses `parseVerseKeyStrict`
 * (`lib/bible/range.ts`, already imported by this file for `readLinkParams`)
 * unmodified — the one existing strict boundary-key parser in this codebase
 * — plus a same-book, start-<=-end structural check. This matches, not
 * exceeds, the validation depth `lib/api/sync-v2.ts`'s own
 * `canonicalRangeV1Schema` enforces server-side (structural only — full
 * canon-bounds checking needs a `CanonTable` neither this module nor the
 * server schema has); if the learner types a nonexistent verse (e.g. a
 * chapter with too few verses), that already-existing server-side gap is
 * unchanged by this task, not newly introduced by it.
 */
export function parseTypedRange(startKey: string, endKey: string): CanonicalRangeV1 | null {
  const start = startKey.trim();
  const end = endKey.trim();
  const parsedStart = parseVerseKeyStrict(start);
  const parsedEnd = parseVerseKeyStrict(end);
  if (!parsedStart || !parsedEnd) return null;
  if (parsedStart.book !== parsedEnd.book) return null;
  if (parsedStart.chapter > parsedEnd.chapter) return null;
  if (parsedStart.chapter === parsedEnd.chapter && parsedStart.verse > parsedEnd.verse) return null;
  return { versificationId: CANONICAL_VERSIFICATION_ID, start, end };
}

export interface ConnectionReadiness {
  ready: boolean;
  /** Human-readable reasons, in a stable order, for what is still missing — same shape as ClaimComposer.tsx's PromoteReadiness. */
  missing: string[];
}

/** The single gate `ConnectSection.tsx`'s "Save connection" button and its missing-field list both read. */
export function connectionReadiness(params: {
  toRange: CanonicalRangeV1 | null;
  selection: ConnectionSelectionDraft;
  rationale: string;
}): ConnectionReadiness {
  const missing: string[] = [];
  if (!params.toRange) {
    missing.push(
      "Enter the other passage's start and end as book.chapter.verse (e.g. 1.3.15), start on or before end, same book.",
    );
  }
  if (!params.selection.type) missing.push("Choose a connection type.");
  if (!params.selection.evidenceLabel) missing.push("Choose an evidence label.");
  if (params.rationale.trim().length < CONNECTION_RATIONALE_MIN_LENGTH) {
    missing.push(`Write your rationale — at least ${CONNECTION_RATIONALE_MIN_LENGTH} characters.`);
  }
  return { ready: missing.length === 0, missing };
}

/**
 * Builds the `UserConnection` record `ConnectSection.tsx` saves through
 * `saveLocalUserConnection`. Throws if called before its own required
 * selection is complete or with a rationale under the schema's own minimum
 * — `submit` in `ConnectSection.tsx` never does either (it gates on
 * `connectionReadiness` first) — mirroring `buildStudyClaimDraft`'s own
 * defensive-throw shape exactly. The `isPersonalResonanceEvidenceLabelValid`
 * check is the THIRD, final layer of the CHECK-constraint guarantee (after
 * the render-side narrowing and `selectEvidenceLabel`'s own guard) — by this
 * point it is structurally unreachable through this file's own selection
 * mutators, and the throw exists so a future caller of this exported builder
 * cannot silently produce the one record the database itself would refuse.
 */
export function buildUserConnectionDraft(params: {
  id: string;
  workspaceId: string;
  fromRange: CanonicalRangeV1;
  toRange: CanonicalRangeV1;
  selection: ConnectionSelectionDraft;
  rationale: string;
  threadSlug: string | null;
  now: string;
}): UserConnection {
  const { type, evidenceLabel } = params.selection;
  if (!type) throw new Error("buildUserConnectionDraft requires a chosen connection type");
  if (!evidenceLabel) throw new Error("buildUserConnectionDraft requires a chosen evidence label");
  if (!isPersonalResonanceEvidenceLabelValid({ type, evidenceLabel })) {
    throw new Error('personal_resonance connections require evidenceLabel "devotional"');
  }
  const rationale = params.rationale.trim();
  if (rationale.length < CONNECTION_RATIONALE_MIN_LENGTH) {
    throw new Error(
      `buildUserConnectionDraft requires a rationale of at least ${CONNECTION_RATIONALE_MIN_LENGTH} characters`,
    );
  }
  return {
    id: params.id,
    workspaceId: params.workspaceId,
    fromRange: params.fromRange,
    toRange: params.toRange,
    type,
    evidenceLabel,
    rationale,
    threadSlug: params.threadSlug ?? null,
    status: "draft",
    revision: 1,
    createdAt: params.now,
    updatedAt: params.now,
    deletedAt: null,
  };
}

/**
 * NO_WARRANT_YET DESIGN DECISION (acceptance criterion 3 — "there is no
 * existing precedent for this specific action anywhere in the codebase, so
 * state your reasoning plainly"):
 *
 * This records `no_warrant_yet` as a `StudySession.connectionState`
 * transition, nothing more, defended as follows:
 *
 *   1. `"no_warrant_yet"` is already a real, reviewed member of
 *      `STUDY_SESSION_CONNECTION_STATES` (`lib/contracts/study-v2.ts`) —
 *      grepped across the whole codebase before writing this function: no
 *      production code path had EVER written it (every session is minted
 *      with `connectionState: "unexamined"` and nothing transitions it
 *      afterward, confirmed by reading `StudyEntry.tsx`'s and
 *      `ClaimComposer.tsx`'s own session builders). The literal was reserved
 *      for exactly this moment and has sat unused; this task is the first to
 *      write it, not the first to invent it.
 *   2. It reuses the ALREADY-BUILT `saveLocalStudySession` writer — no new
 *      table, no new column, no schema change. `db/schema.ts` is out of this
 *      task's owned/read-only paths, so adding a dedicated "why no warrant"
 *      free-text column would be an uncoordinated, destructive-migration-risk
 *      change this task has no authority to make (LESSONS.md's own
 *      GENERATED-MIGRATION-FK-ORDER-001/CROSS-TABLE-INVARIANT-001 entries are
 *      exactly the kind of schema surprise this avoids by not touching it).
 *   3. It is the minimal HONEST fact this session can record about itself:
 *      "the learner reached Connect (attempted a comparison, since that is
 *      this section's own gate) and concluded, for now, that no connection
 *      is warranted" — BUILD_PLAN's own framing of this as a legitimate,
 *      valued outcome, not a failure state. A free-text "why not" note would
 *      invite the exact thing the assertion line forbids elsewhere (the app
 *      grading or interpreting the learner's reasoning); recording the FACT
 *      of the honest decision, without asking the app to characterize it
 *      further, keeps this outcome as unadjudicated as every claim kind
 *      already is.
 *   4. It is idempotent in the same sense `buildReadGateUpdate` is NOT
 *      required to be (unlike the read gate, there is no "first timestamp
 *      wins" semantic to preserve here — `connectionState` is a plain
 *      current-state enum, not a first-occurrence timestamp) — a learner can
 *      revisit Connect, actually record a real connection later, and this
 *      transition does not block that; nothing here locks the session out of
 *      ever having `connectionState` become `"provisional"`/`"linked"` by
 *      some FUTURE write this task does not build (out of scope: no code
 *      anywhere transitions connectionState to those two values yet either,
 *      and inventing that unstated semantic here — e.g. auto-flipping to
 *      "linked" the moment ANY typed connection saves — risks conflicting
 *      with whatever a future task defines for it. `ConnectSection.tsx`
 *      therefore does NOT touch `connectionState` when a typed connection
 *      saves — only this one, explicitly-required transition).
 */
export function buildNoWarrantYetUpdate(session: StudySession, now: string): StudySession {
  return {
    ...session,
    connectionState: "no_warrant_yet",
    revision: session.revision + 1,
    updatedAt: now,
  };
}
