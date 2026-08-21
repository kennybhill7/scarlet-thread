"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import type { StudySession, TeachingDraft } from "@/lib/contracts/study-v2";
import { saveLocalTeachingDraft } from "@/lib/sync/store";

import { LockedNotice } from "./LockedNotice";
import { bodyStyle, noticeStyle } from "./styles";

/**
 * TEACHDRAFTPANE-001 — BUILD_PLAN §4 row 8, "Teach — Teach It Back".
 * Unlocked per the EXISTING gate (`lib/workspace/gating.ts`'s
 * `teach: hasFinalizedApplication(applications)`, untouched by this task) —
 * >=1 finalized `Application` exists for the session. Writes a
 * `TeachingDraft` through the ALREADY-BUILT `saveLocalTeachingDraft` vault
 * writer (`lib/sync/store.ts`, read-only here) — the same "one write path"
 * discipline every other real section in this shell follows; this component
 * has no IndexedDB access of its own.
 *
 * ---------------------------------------------------------------------------
 * SCOPE BOUNDARY — draft-level fields ONLY, not the section-by-section
 * outline builder BUILD_PLAN §4 also describes. VERIFIED, not merely
 * asserted — see this task's own commit message for the exact grep commands
 * run and their verbatim output:
 *
 *   `grep -rn "teachingSection\|TeachingSection\|teaching_sections"` across
 *   `lib/sync/store.ts`, `lib/contracts/sync-v2.ts`, and `lib/api/sync-v2.ts`
 *   returns NOTHING in all three files. A `teaching_sections` Postgres table
 *   does exist (`db/schema.ts`'s `teachingSections`/`teachingSectionKindEnum`),
 *   but `SYNC_ENTITIES_V2` (`lib/contracts/sync-v2.ts`) lists exactly eight
 *   entities — `session`, `claim`, `evidence`, `motif`, `motifSighting`,
 *   `connection`, `application`, `teachingDraft` — and `teachingSection` is
 *   not one of them, and `lib/sync/store.ts` has no `saveLocalTeachingSection`
 *   (or similarly named) writer at all. Building the ordered
 *   kind/sortOrder/body outline builder BUILD_PLAN describes would require
 *   adding a NINTH sync entity across the contract (`lib/contracts/
 *   sync-v2.ts`), the API validation layer (`lib/api/sync-v2.ts`), and the
 *   vault (`lib/sync/store.ts`) — files this task does not own and must not
 *   speculatively touch. This component therefore builds ONLY the four
 *   `TeachingDraft` top-level fields (title/bigIdea/audience/
 *   gospelConnection) plus the format-preset -> durationMinutes mapping, and
 *   tells the learner exactly that (see `teach-outline-not-available-notice`
 *   below) rather than presenting a broken or silently absent "add section"
 *   control with no explanation. The outline builder is explicit follow-up
 *   work, gated behind that sync-entity addition landing first.
 * ---------------------------------------------------------------------------
 *
 * THE ASSERTION LINE (docs/decisions/2026-08-18-teaching-not-theology.md) —
 * every free-text prompt below asks the LEARNER what THEY will teach, to
 * whom, and how THEY connect it to the gospel — never what the app asserts
 * the passage means. No field starts pre-filled with an example sentence
 * about any actual passage (`BLANK_TEACH_FIELDS` is the one and only seed —
 * see `tests/teach-pane.test.ts`'s ASSERTION-LINE test).
 *
 * FORMAT PRESETS (acceptance criterion 1): BUILD_PLAN §4 row 8 names four
 * formats ("60-second/5-minute/15-minute/30-minute presets, which set
 * durationMinutes") but gives no numeric values anywhere in either source
 * doc — `FORMAT_PRESETS` below is the ONE place they are chosen and
 * defended, and the ONE place `tests/teach-pane.test.ts`'s mutation proof
 * targets:
 *
 *   - "60-second" -> 1 minute. NOT 0: `syncTeachingDraftV2Schema`
 *     (`lib/api/sync-v2.ts`, read-only here) types `durationMinutes` as
 *     `z.number().int().positive().max(600)` — zero is not a positive
 *     integer and would fail that schema outright, and the nearest whole
 *     minute below "under a minute" is one minute, not zero.
 *   - "5-minute" -> 5, "15-minute" -> 15, "30-minute" -> 30: literal readings
 *     of their own names, no judgment call needed.
 * ---------------------------------------------------------------------------
 */

export interface FormatPreset {
  key: string;
  label: string;
  durationMinutes: number;
}

/**
 * The one, single-source-of-truth mapping from a format preset to the
 * `durationMinutes` value it sets. Both the chip picker below and
 * `durationMinutesForPresetKey` read THIS array — never a second, separately
 * maintained copy of the numbers.
 */
export const FORMAT_PRESETS: readonly FormatPreset[] = [
  { key: "60-second", label: "60-second", durationMinutes: 1 },
  { key: "5-minute", label: "5-minute", durationMinutes: 5 },
  { key: "15-minute", label: "15-minute", durationMinutes: 15 },
  { key: "30-minute", label: "30-minute", durationMinutes: 30 },
];

/** Pure lookup — the one place `FORMAT_PRESETS` is read for its numeric value, so a test can prove the mapping without reaching into JSX. */
export function durationMinutesForPresetKey(key: string | null): number | null {
  if (!key) return null;
  return FORMAT_PRESETS.find((preset) => preset.key === key)?.durationMinutes ?? null;
}

// ---------------------------------------------------------------------------
// Draft fields — the four TeachingDraft top-level fields this task owns,
// plus which format preset (if any) is chosen. Nothing here starts
// pre-filled with content about a passage — see this file's header.
// ---------------------------------------------------------------------------

export interface TeachDraftFields {
  title: string;
  bigIdea: string;
  audience: string;
  gospelConnection: string;
  presetKey: string | null;
}

/**
 * The composer's one and only starting point. Every field blank, no preset
 * chosen — `TeachSection` seeds its `useState<TeachDraftFields>` call from
 * THIS object, not a re-typed literal written separately in the render body.
 */
export const BLANK_TEACH_FIELDS: TeachDraftFields = {
  title: "",
  bigIdea: "",
  audience: "",
  gospelConnection: "",
  presetKey: null,
};

export interface TeachDraftReadiness {
  ready: boolean;
  /** Human-readable reasons, in a stable order, for what is still missing. */
  missing: string[];
}

export function teachDraftReadiness(fields: TeachDraftFields): TeachDraftReadiness {
  const missing: string[] = [];
  if (!fields.title.trim()) missing.push("Give this teaching a title.");
  if (!fields.bigIdea.trim()) missing.push("Write the big idea you want to teach.");
  if (!fields.audience.trim()) missing.push("Say who you will teach this to.");
  if (!fields.gospelConnection.trim()) missing.push("Write the gospel connection, in your own words.");
  if (durationMinutesForPresetKey(fields.presetKey) === null) missing.push("Choose how long you will teach.");
  return { ready: missing.length === 0, missing };
}

/**
 * Pure record builder — the only place a `TeachingDraft` is assembled.
 * Throws if called before every required field is filled, exactly the
 * `ClaimComposer.tsx`/`buildStudyClaimDraft` precedent (this file's caller,
 * `submit` below, never calls this before `teachDraftReadiness` confirms
 * `ready`).
 */
export function buildTeachingDraftRecord(params: {
  id: string;
  workspaceId: string;
  sessionId: string;
  fields: TeachDraftFields;
  now: string;
}): TeachingDraft {
  const { fields } = params;
  const durationMinutes = durationMinutesForPresetKey(fields.presetKey);
  if (!fields.title.trim()) throw new Error("buildTeachingDraftRecord requires a title");
  if (!fields.bigIdea.trim()) throw new Error("buildTeachingDraftRecord requires a bigIdea");
  if (!fields.audience.trim()) throw new Error("buildTeachingDraftRecord requires an audience");
  if (!fields.gospelConnection.trim()) throw new Error("buildTeachingDraftRecord requires a gospelConnection");
  if (durationMinutes === null) throw new Error("buildTeachingDraftRecord requires a chosen format preset");
  return {
    id: params.id,
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    title: fields.title.trim(),
    bigIdea: fields.bigIdea.trim(),
    // `audience` is typed plain `string` in lib/contracts/study-v2.ts (no
    // enumerated value set exists in either source doc, that file's own
    // documented gap) — the learner's own free text, not a picker.
    audience: fields.audience.trim(),
    durationMinutes,
    gospelConnection: fields.gospelConnection.trim(),
    // "draft" matches this codebase's own established convention for a
    // freshly-created, not-yet-finalized record — the same literal
    // `StudyClaim.status` and `STUDY_CLAIM_STATUSES[0]` already use
    // (`lib/contracts/study-v2.ts`), and TeachingDraft.status is likewise
    // typed plain `string` with no enumerated value set (that file's own
    // documented gap #3) — this is not a guessed second vocabulary.
    status: "draft",
    revision: 1,
    createdAt: params.now,
    updatedAt: params.now,
    deletedAt: null,
  };
}

// ---------------------------------------------------------------------------
// The stateful shell
// ---------------------------------------------------------------------------

export interface TeachSectionProps {
  workspaceId: string;
  session: StudySession;
  unlocked: boolean;
  /** Additive, optional — called with the saved record after a successful write. Not required for the section to function. */
  onSaved?: (draft: TeachingDraft) => void;
}

export function TeachSection({ workspaceId, session, unlocked, onSaved }: TeachSectionProps) {
  const titleId = useId();
  const [fields, setFields] = useState<TeachDraftFields>(BLANK_TEACH_FIELDS);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  if (!unlocked) {
    return (
      <LockedNotice
        testId="teach-locked"
        message="Locked until you finalize an application. Use Apply above first, then this composer opens."
      />
    );
  }

  const readiness = teachDraftReadiness(fields);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!readiness.ready || status === "saving") return;

    setStatus("saving");
    setMessage("Saving to this device…");
    const now = new Date().toISOString();

    try {
      const draft = buildTeachingDraftRecord({
        id: crypto.randomUUID(),
        workspaceId,
        sessionId: session.id,
        fields,
        now,
      });
      await saveLocalTeachingDraft(draft);

      setStatus("saved");
      setMessage("Saved to this device.");
      setFields(BLANK_TEACH_FIELDS);
      onSaved?.(draft);
    } catch {
      setStatus("error");
      setMessage("This device could not save this teaching draft. Nothing was discarded — please try again.");
    }
  }

  return (
    <div style={bodyStyle}>
      <p style={noticeStyle} data-testid="teach-outline-not-available-notice">
        Building this out section by section isn&rsquo;t available yet — that needs its own sync entity, which
        has not been built (see this section&rsquo;s own scope note). What IS saved below is your title, big idea,
        audience, length, and gospel connection for this teaching — nothing more, nothing fabricated.
      </p>
      <form onSubmit={submit}>
        <Field
          disabled={status === "saving"}
          hint="Your own words — not a passage reference."
          id={titleId}
          label="What will you call this teaching?"
          onChange={(event) => setFields((previous) => ({ ...previous, title: event.target.value }))}
          rows={1}
          value={fields.title}
        />
        <Field
          disabled={status === "saving"}
          hint="One sentence, in your own words."
          label="What is the big idea you want to teach?"
          onChange={(event) => setFields((previous) => ({ ...previous, bigIdea: event.target.value }))}
          value={fields.bigIdea}
        />
        <Field
          disabled={status === "saving"}
          hint="Who is this for?"
          label="Who will you teach this to?"
          onChange={(event) => setFields((previous) => ({ ...previous, audience: event.target.value }))}
          value={fields.audience}
        />
        <Field
          disabled={status === "saving"}
          hint="How do you connect this passage to the gospel, in your own words?"
          label="How does this connect to the gospel?"
          onChange={(event) => setFields((previous) => ({ ...previous, gospelConnection: event.target.value }))}
          value={fields.gospelConnection}
        />

        <fieldset>
          <legend style={noticeStyle}>How long will you teach?</legend>
          <div role="group">
            {FORMAT_PRESETS.map((preset) => (
              <Chip
                active={fields.presetKey === preset.key}
                aria-pressed={fields.presetKey === preset.key}
                data-preset={preset.key}
                disabled={status === "saving"}
                key={preset.key}
                onClick={() => setFields((previous) => ({ ...previous, presetKey: preset.key }))}
              >
                {preset.label}
              </Chip>
            ))}
          </div>
        </fieldset>

        {readiness.missing.length > 0 ? (
          <ul aria-live="polite">
            {readiness.missing.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}

        <footer>
          <p aria-live="polite" data-state={status}>
            {message}
          </p>
          <Button disabled={!readiness.ready || status === "saving"} type="submit">
            {status === "saving" ? "Saving…" : "Save teaching draft"}
          </Button>
        </footer>
      </form>
    </div>
  );
}
