"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import type { CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import {
  CLAIM_CONFIDENCES,
  CLAIM_EVIDENCE_TYPES,
  CLAIM_KINDS,
  DOCTRINE_STATUSES,
  EPISTEMIC_BASES,
  type ClaimConfidence,
  type ClaimEvidence,
  type ClaimEvidenceType,
  type ClaimKind,
  type DoctrineStatus,
  type EpistemicBasis,
  type StudyClaim,
  type StudySession,
} from "@/lib/contracts/study-v2";
import {
  saveLocalClaimEvidence,
  saveLocalStudyClaim,
  saveLocalStudySession,
} from "@/lib/sync/store";

import styles from "./claim-composer.module.css";

/**
 * V2COMPOSER-001 — the first authoring surface for the v2 evidence model
 * (BUILD_PLAN §3.4: "NoteComposer gains ... a 'promote to claim' action that
 * upgrades an observation into a typed StudyClaim with evidence"). Writes
 * exclusively through V2VAULT-001's existing offline vault writers
 * (`saveLocalStudySession` / `saveLocalStudyClaim` / `saveLocalClaimEvidence`,
 * `lib/sync/store.ts`, a readOnlyPath here) — no new write path, no direct
 * IndexedDB access of its own (tenet 7 at the client layer).
 *
 * ---------------------------------------------------------------------------
 * THE ASSERTION LINE (docs/decisions/2026-08-18-teaching-not-theology.md) —
 * read before changing any string in this file.
 *
 * This composer prompts for METHOD (what kind of claim, what warrant backs
 * it, how confident the learner is, what evidence supports it) and shows the
 * learner back their OWN words (the observation body they typed, quoted
 * verbatim in the "What you recorded" block below). It supplies, suggests,
 * or defaults NOTHING about what the passage MEANS:
 *
 *   - No claim kind, epistemic basis, confidence, or doctrine status ever
 *     starts pre-selected. `BLANK_CLAIM_SELECTION` (below) is the render
 *     body's actual useState seed, not a separate "for real" default living
 *     elsewhere — see its own comment and MUTATION PROOF §6 in
 *     tests/study-composer.test.ts.
 *   - Every option list (kind/epistemicBasis/confidence/doctrineStatus/
 *     evidenceType) is `optionsFrom(...)` over the live array exported by
 *     lib/contracts/study-v2.ts — never a hand-retyped literal union. A
 *     value added to any of those five arrays appears here automatically;
 *     tests/study-composer.test.ts proves each option list's values equal
 *     the contract array's values exactly.
 *   - Field labels name the METHOD category being chosen ("What kind of
 *     claim is this?", "What is your warrant?", "How confident are you?")
 *     and, for doctrineStatus, are explicit that the field describes how
 *     widely held a position is, never whether it is correct — the exact
 *     framing BUILD_PLAN §6 gives the Positions Library's own status badge.
 *   - The observation textarea's placeholder asks a method question
 *     ("What do you notice in the words themselves?") and supplies no
 *     example sentence about any actual passage — NoteComposer.tsx's own
 *     placeholder ("The serpent changes God's wording…") was deliberately
 *     NOT copied here, because a worked example is itself a suggested
 *     observation.
 *   - Evidence notes, the observation body, and every free-text field are
 *     100% learner-authored; this component never writes a character into
 *     any of them itself.
 * ---------------------------------------------------------------------------
 *
 * EVIDENCE-REQUIRED DECISION (acceptance criterion 5): this composer
 * REFUSES to save a claim with zero evidence rather than saving one flagged
 * "unevidenced". Reasoning: BUILD_PLAN §3.3 already gives claim_evidence a
 * structural "unsupported" badge for the READ side of an interpretation
 * that ended up with none (evidence attached later, or never). This
 * composer is the WRITE side of a single, one-shot promotion action — the
 * "promote to claim" affordance IS the "add the evidence you chose" step
 * (BUILD_PLAN §3.4's own wording: "upgrades an observation into a typed
 * StudyClaim with evidence"), so a promotion with nothing chosen has not
 * actually done the thing the button describes. Refusing keeps the vault
 * free of `study_claims` rows this component itself knows are incomplete,
 * rather than manufacturing an "unevidenced" state whose only consumer
 * (a badge on some future reading surface) is out of this task's scope to
 * build or test. See `promoteReadiness` below and its mutation proof in
 * tests/study-composer.test.ts.
 *
 * NOT WIRED TO A PAGE (SCOPE-BOUNDARY-001): this task owns only
 * `web/components/study/`; no `app/(app)/study/[sessionId]/page.tsx` exists
 * yet (BUILD_PLAN §4/Phase 2, a later task). A caller supplies `workspaceId`
 * and `range` as props; how a real page resolves the caller's own workspace
 * id from their session (never from a caller-supplied id, per the pattern
 * EXPORTV2-001 established) is that future task's job, not this component's.
 */

// ---------------------------------------------------------------------------
// Pure option-list derivation — every picker below is built from ONE of
// these calls over a lib/contracts/study-v2.ts array, never a separate
// hand-typed list. `humanizeToken` is a mechanical string transform (no
// lookup table to maintain), so a new value added to any source array gets
// a legible label with nothing here to edit.
// ---------------------------------------------------------------------------

export function humanizeToken(value: string): string {
  const words = value.split("_").filter(Boolean);
  if (words.length === 0) return value;
  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export function optionsFrom<T extends string>(values: readonly T[]): SelectOption<T>[] {
  return values.map((value) => ({ value, label: humanizeToken(value) }));
}

// ---------------------------------------------------------------------------
// Claim-selection draft — the four fields the assertion line forbids
// defaulting.
// ---------------------------------------------------------------------------

export interface ClaimSelectionDraft {
  kind: ClaimKind | null;
  epistemicBasis: EpistemicBasis | null;
  confidence: ClaimConfidence | null;
  /** Theology claims only (study-v2.ts's own StudyClaim.doctrineStatus rule). */
  doctrineStatus: DoctrineStatus | null;
}

/**
 * The composer's one and only starting point for `kind` / `epistemicBasis` /
 * `confidence` / `doctrineStatus`: every field null. `ClaimComposer` below
 * seeds its `useState<ClaimSelectionDraft>` call from THIS object — not a
 * re-typed `{ kind: null, ... }` literal written separately in the render
 * body — so there is exactly one place in this file a "helpful" default
 * could be smuggled back in, and it is the one place
 * tests/study-composer.test.ts's mutation proof for acceptance criterion 6
 * watches.
 */
export const BLANK_CLAIM_SELECTION: ClaimSelectionDraft = {
  kind: null,
  epistemicBasis: null,
  confidence: null,
  doctrineStatus: null,
};

/**
 * Choosing a claim kind. Resets `doctrineStatus` to null whenever the kind
 * moves away from "theology" — `syncStudyClaimV2Schema`'s own superRefine
 * (lib/api/sync-v2.ts) rejects a non-theology claim that carries a
 * doctrineStatus, so a stale selection left over from an earlier "theology"
 * pick must not silently ride along on, say, an "interpretation" claim.
 */
export function selectKind(selection: ClaimSelectionDraft, kind: ClaimKind): ClaimSelectionDraft {
  return { ...selection, kind, doctrineStatus: kind === "theology" ? selection.doctrineStatus : null };
}

export function selectEpistemicBasis(
  selection: ClaimSelectionDraft,
  epistemicBasis: EpistemicBasis,
): ClaimSelectionDraft {
  return { ...selection, epistemicBasis };
}

export function selectConfidence(selection: ClaimSelectionDraft, confidence: ClaimConfidence): ClaimSelectionDraft {
  return { ...selection, confidence };
}

export function selectDoctrineStatus(
  selection: ClaimSelectionDraft,
  doctrineStatus: DoctrineStatus,
): ClaimSelectionDraft {
  return { ...selection, doctrineStatus };
}

// ---------------------------------------------------------------------------
// Evidence drafts — the learner's own chosen evidence rows.
// ---------------------------------------------------------------------------

export interface EvidenceDraft {
  /** UI-only stable key for React list rendering; never persisted. */
  id: string;
  type: ClaimEvidenceType | null;
  note: string;
}

export function blankEvidenceDraft(id: string): EvidenceDraft {
  return { id, type: null, note: "" };
}

/** An evidence row counts once it names a type AND carries a non-empty note. */
export function validEvidenceDrafts(evidence: EvidenceDraft[]): EvidenceDraft[] {
  return evidence.filter((row) => row.type !== null && row.note.trim().length > 0);
}

export function updateEvidenceRow(
  evidence: EvidenceDraft[],
  id: string,
  patch: Partial<Pick<EvidenceDraft, "type" | "note">>,
): EvidenceDraft[] {
  return evidence.map((row) => (row.id === id ? { ...row, ...patch } : row));
}

export function addEvidenceRow(evidence: EvidenceDraft[], id: string): EvidenceDraft[] {
  return [...evidence, blankEvidenceDraft(id)];
}

export function removeEvidenceRow(evidence: EvidenceDraft[], id: string): EvidenceDraft[] {
  return evidence.filter((row) => row.id !== id);
}

// ---------------------------------------------------------------------------
// Readiness — the single gate the "Save claim" button and the missing-field
// list both read. Refuses (criterion 5) rather than allowing an unevidenced
// save; see this file's header for why.
// ---------------------------------------------------------------------------

export interface PromoteReadiness {
  ready: boolean;
  /** Human-readable reasons, in a stable order, for what is still missing. */
  missing: string[];
}

export function promoteReadiness(
  body: string,
  selection: ClaimSelectionDraft,
  evidence: EvidenceDraft[],
): PromoteReadiness {
  const missing: string[] = [];
  if (!body.trim()) missing.push("Write what you observed.");
  if (!selection.kind) missing.push("Choose a claim kind.");
  if (!selection.epistemicBasis) missing.push("Choose an epistemic basis.");
  if (!selection.confidence) missing.push("Choose a confidence level.");
  if (selection.kind === "theology" && !selection.doctrineStatus) {
    missing.push("Choose how widely held this is (theology claims only).");
  }
  if (validEvidenceDrafts(evidence).length === 0) {
    missing.push("Add at least one piece of evidence — a claim with no basis can’t be saved.");
  }
  return { ready: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Record builders — pure, deterministic (caller supplies id/now), and the
// only place StudySession/StudyClaim/ClaimEvidence records are assembled.
// Each throws if called before its own required selection is complete,
// which `submit` below never does (it gates on `promoteReadiness` first) —
// the throw exists so a future caller of these exported builders cannot
// silently produce a record the assertion line, or the schema itself, would
// reject.
// ---------------------------------------------------------------------------

/**
 * Field-for-field identical to `components/reader/StudyEntry.tsx`'s own
 * `buildNewStudySession` (an ownedPath here as of READGATE-001, previously
 * readOnly) — same seven fixed fields, same values, deliberately a SEPARATE,
 * LOCAL copy rather than a shared import (see that file's own comment for
 * why: importing this component's `Button`/`Field` UI dependencies into
 * `ChapterReader.tsx`'s module graph would break two of that file's own
 * unrelated existing tests). `tests/study-entry.test.ts` asserts the two
 * builders' `currentStep` values stay identical to each other (READGATE-001
 * acceptance criterion 1), so a future edit to one that forgets the other
 * fails loudly there.
 *
 * READGATE-001 (2026-08-20): `currentStep` changed from `"observe"` to
 * `"read"` — a freshly-started session must land on Read, never skip
 * straight to Observe, so the passage-read gate (`lib/workspace/
 * renderState.ts`'s `isPassageMarkedRead`) is enforced in UI state rather
 * than relying on the learner having already read before tapping "start a
 * study" (BUILD_PLAN tenet 1).
 */
export function buildStudySessionDraft(params: {
  id: string;
  workspaceId: string;
  range: CanonicalRangeV1;
  now: string;
}): StudySession {
  return {
    id: params.id,
    workspaceId: params.workspaceId,
    range: params.range,
    mode: "encounter",
    workflowState: "active",
    connectionState: "unexamined",
    catalogReleaseId: null,
    readGateAt: null,
    currentStep: "read",
    revision: 1,
    createdAt: params.now,
    updatedAt: params.now,
    deletedAt: null,
  };
}

export function buildStudyClaimDraft(params: {
  id: string;
  workspaceId: string;
  sessionId: string;
  range: CanonicalRangeV1;
  body: string;
  selection: ClaimSelectionDraft;
  now: string;
}): StudyClaim {
  const { kind, epistemicBasis, confidence, doctrineStatus } = params.selection;
  if (!kind) throw new Error("buildStudyClaimDraft requires a chosen claim kind");
  if (!epistemicBasis) throw new Error("buildStudyClaimDraft requires a chosen epistemic basis");
  if (!confidence) throw new Error("buildStudyClaimDraft requires a chosen confidence level");
  if (kind === "theology" && !doctrineStatus) {
    throw new Error("buildStudyClaimDraft requires a chosen doctrineStatus for theology claims");
  }
  return {
    id: params.id,
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    kind,
    epistemicBasis,
    body: params.body.trim(),
    passage: params.range,
    confidence,
    provenance: "learner",
    doctrineStatus: kind === "theology" ? doctrineStatus : null,
    status: "draft",
    revision: 1,
    createdAt: params.now,
    updatedAt: params.now,
    deletedAt: null,
  };
}

export function buildClaimEvidenceDraft(params: {
  id: string;
  workspaceId: string;
  claimId: string;
  range: CanonicalRangeV1;
  draft: EvidenceDraft;
  now: string;
}): ClaimEvidence {
  if (!params.draft.type) throw new Error("buildClaimEvidenceDraft requires a chosen evidence type");
  const note = params.draft.note.trim();
  if (!note) throw new Error("buildClaimEvidenceDraft requires a non-empty note");
  return {
    id: params.id,
    workspaceId: params.workspaceId,
    claimId: params.claimId,
    evidenceType: params.draft.type,
    // The passage the evidence is anchored to is only meaningful for
    // evidenceType "passage" (context/connection/source evidence points
    // elsewhere — a citationId/contentBlockId this task has no picker UI
    // for; see the report). Omitted for the other three types rather than
    // attaching a reference that would not describe what was cited.
    ...(params.draft.type === "passage" ? { canonicalReference: params.range } : {}),
    note,
    revision: 1,
    createdAt: params.now,
    updatedAt: params.now,
    deletedAt: null,
  };
}

// ---------------------------------------------------------------------------
// PromoteFields — the promote-to-claim stage's picker + evidence markup.
// Deliberately HOOKLESS: every value it shows comes from props, and every
// interaction calls straight through to one of the pure functions above via
// a callback prop, exactly the composerRenderState/VerseColumn precedent
// (components/notes/StudySession.tsx, components/reader/ChapterReader.tsx)
// — "pure functions the render body ACTUALLY CALLS, never a parallel
// reimplementation." Because it takes no hooks, tests/study-composer.test.ts
// calls it directly as a plain function (no React render pass needed) to get
// its real returned element tree, and can invoke the onClick a rendered Chip
// actually carries — proving the click really runs `selectKind` (etc.), not
// a duplicate of it.
// ---------------------------------------------------------------------------

export interface PromoteFieldsProps {
  body: string;
  selection: ClaimSelectionDraft;
  evidence: EvidenceDraft[];
  readiness: PromoteReadiness;
  disabled: boolean;
  onSelectionChange: (next: ClaimSelectionDraft) => void;
  onEvidenceChange: (next: EvidenceDraft[]) => void;
}

export function PromoteFields({
  body,
  selection,
  evidence,
  readiness,
  disabled,
  onSelectionChange,
  onEvidenceChange,
}: PromoteFieldsProps) {
  return (
    <section className={styles.promote} aria-label="Promote to a typed claim">
      <p className={styles.eyebrow}>PROMOTE</p>
      <h3>Turn this into a typed claim</h3>
      <p className={styles.methodNote}>
        Choose what kind of claim this is, what warrant supports it, and how confident you are.
        This app does not choose these for you.
      </p>

      <p className={styles.recordedLabel}>What you recorded</p>
      <blockquote className={styles.recorded}>{body}</blockquote>

      <fieldset className={styles.field}>
        <legend className={styles.label}>What kind of claim is this?</legend>
        <div className={styles.chips} role="group">
          {optionsFrom(CLAIM_KINDS).map((option) => (
            <Chip
              active={selection.kind === option.value}
              aria-pressed={selection.kind === option.value}
              data-field="kind"
              data-value={option.value}
              disabled={disabled}
              key={option.value}
              onClick={() => onSelectionChange(selectKind(selection, option.value))}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.field}>
        <legend className={styles.label}>What is your warrant for this?</legend>
        <div className={styles.chips} role="group">
          {optionsFrom(EPISTEMIC_BASES).map((option) => (
            <Chip
              active={selection.epistemicBasis === option.value}
              aria-pressed={selection.epistemicBasis === option.value}
              data-field="epistemicBasis"
              data-value={option.value}
              disabled={disabled}
              key={option.value}
              onClick={() => onSelectionChange(selectEpistemicBasis(selection, option.value))}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.field}>
        <legend className={styles.label}>How confident are you?</legend>
        <div className={styles.chips} role="group">
          {optionsFrom(CLAIM_CONFIDENCES).map((option) => (
            <Chip
              active={selection.confidence === option.value}
              aria-pressed={selection.confidence === option.value}
              data-field="confidence"
              data-value={option.value}
              disabled={disabled}
              key={option.value}
              onClick={() => onSelectionChange(selectConfidence(selection, option.value))}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      {selection.kind === "theology" ? (
        <fieldset className={styles.field}>
          <legend className={styles.label}>
            How widely held is this? <span>describes standing, not correctness</span>
          </legend>
          <div className={styles.chips} role="group">
            {optionsFrom(DOCTRINE_STATUSES).map((option) => (
              <Chip
                active={selection.doctrineStatus === option.value}
                aria-pressed={selection.doctrineStatus === option.value}
                data-field="doctrineStatus"
                data-value={option.value}
                disabled={disabled}
                key={option.value}
                onClick={() => onSelectionChange(selectDoctrineStatus(selection, option.value))}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className={styles.evidence}>
        <p className={styles.label}>Evidence</p>
        <p className={styles.methodNote}>
          What in the text — or in your own study — supports this claim? Add at least one.
        </p>
        <div className={styles.evidenceList}>
          {evidence.map((row) => (
            <div className={styles.evidenceRow} data-evidence-row={row.id} key={row.id}>
              <label className={styles.evidenceType}>
                <span className={styles.label}>Evidence type</span>
                <select
                  data-field="evidenceType"
                  disabled={disabled}
                  onChange={(event) =>
                    onEvidenceChange(
                      updateEvidenceRow(evidence, row.id, {
                        type: (event.target.value || null) as ClaimEvidenceType | null,
                      }),
                    )
                  }
                  value={row.type ?? ""}
                >
                  <option value="">Choose…</option>
                  {optionsFrom(CLAIM_EVIDENCE_TYPES).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                disabled={disabled}
                hint="Your own words."
                id={`evidence-note-${row.id}`}
                label="What supports this claim?"
                onChange={(event) =>
                  onEvidenceChange(updateEvidenceRow(evidence, row.id, { note: event.target.value }))
                }
                value={row.note}
              />
              {evidence.length > 1 ? (
                <Button
                  data-action="remove-evidence"
                  disabled={disabled}
                  onClick={() => onEvidenceChange(removeEvidenceRow(evidence, row.id))}
                  type="button"
                  variant="ghost"
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        <Button
          data-action="add-evidence"
          disabled={disabled}
          onClick={() => onEvidenceChange(addEvidenceRow(evidence, crypto.randomUUID()))}
          type="button"
          variant="secondary"
        >
          + Add evidence
        </Button>
      </div>

      {readiness.missing.length > 0 ? (
        <ul className={styles.missing} aria-live="polite">
          {readiness.missing.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The stateful shell
// ---------------------------------------------------------------------------

export interface ClaimComposerSavedResult {
  session: StudySession;
  claim: StudyClaim;
  evidence: ClaimEvidence[];
}

export interface ClaimComposerProps {
  /**
   * The caller's own workspace id, already resolved server-side from their
   * session (never a caller-supplied id — see this file's header). This
   * component trusts its caller for that resolution; it does not perform it.
   */
  workspaceId: string;
  /** The passage this study is about. */
  range: CanonicalRangeV1;
  /** An existing session to attach the claim to. Omit to start a new one. */
  session?: StudySession;
  onSaved?: (result: ClaimComposerSavedResult) => void;
}

function formatRange(range: CanonicalRangeV1): string {
  return range.start === range.end ? range.start : `${range.start}–${range.end}`;
}

export function ClaimComposer({ workspaceId, range, session, onSaved }: ClaimComposerProps) {
  const bodyId = useId();
  const [body, setBody] = useState("");
  const [selection, setSelection] = useState<ClaimSelectionDraft>(BLANK_CLAIM_SELECTION);
  const [evidence, setEvidence] = useState<EvidenceDraft[]>([blankEvidenceDraft(crypto.randomUUID())]);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  const readiness = promoteReadiness(body, selection, evidence);
  const showPromote = body.trim().length > 0;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!readiness.ready || status === "saving") return;

    setStatus("saving");
    setMessage("Saving to this device…");
    const now = new Date().toISOString();

    try {
      const activeSession =
        session ?? buildStudySessionDraft({ id: crypto.randomUUID(), workspaceId, range, now });
      if (!session) {
        await saveLocalStudySession(activeSession);
      }

      const claim = buildStudyClaimDraft({
        id: crypto.randomUUID(),
        workspaceId,
        sessionId: activeSession.id,
        range,
        body,
        selection,
        now,
      });
      await saveLocalStudyClaim(claim);

      const evidenceRecords = validEvidenceDrafts(evidence).map((draft) =>
        buildClaimEvidenceDraft({
          id: crypto.randomUUID(),
          workspaceId,
          claimId: claim.id,
          range,
          draft,
          now,
        }),
      );
      await Promise.all(evidenceRecords.map((record) => saveLocalClaimEvidence(record)));

      setStatus("saved");
      setMessage("Saved to this device.");
      setBody("");
      setSelection(BLANK_CLAIM_SELECTION);
      setEvidence([blankEvidenceDraft(crypto.randomUUID())]);
      onSaved?.({ session: activeSession, claim, evidence: evidenceRecords });
    } catch {
      setStatus("error");
      setMessage("This device could not save the claim. Nothing was discarded — please try again.");
    }
  }

  return (
    <form className={styles.composer} onSubmit={submit}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>OBSERVE</p>
          <h2>What did you notice in the text?</h2>
        </div>
        <span className={styles.reference}>{formatRange(range)}</span>
      </header>

      <label className={styles.label} htmlFor={bodyId}>
        Your observation
      </label>
      <textarea
        className={styles.textarea}
        disabled={status === "saving"}
        id={bodyId}
        maxLength={100_000}
        onChange={(event) => setBody(event.target.value)}
        placeholder="What do you notice in the words themselves?"
        rows={5}
        value={body}
      />

      {showPromote ? (
        <PromoteFields
          body={body}
          disabled={status === "saving"}
          evidence={evidence}
          onEvidenceChange={setEvidence}
          onSelectionChange={setSelection}
          readiness={readiness}
          selection={selection}
        />
      ) : null}

      <footer className={styles.footer}>
        <p aria-live="polite" data-state={status}>
          {message}
        </p>
        <Button disabled={!readiness.ready || status === "saving"} type="submit">
          {status === "saving" ? "Saving…" : "Save claim"}
        </Button>
      </footer>
    </form>
  );
}
