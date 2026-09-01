"use client";

import { useEffect, useId, useState } from "react";

import { humanizeToken, optionsFrom } from "@/components/study/ClaimComposer";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import {
  TEACHING_SECTION_KINDS,
  type StudySession,
  type TeachingDraft,
  type TeachingSection,
  type TeachingSectionKind,
} from "@/lib/contracts/study-v2";
import { listLocalV2Entities, saveLocalTeachingDraft, saveLocalTeachingSection } from "@/lib/sync/store";

import { LockedNotice } from "./LockedNotice";
import { bodyStyle, noticeStyle } from "./styles";

/**
 * TEACHDRAFTPANE-001 (wave 17) — BUILD_PLAN §4 row 8, "Teach — Teach It
 * Back". Unlocked per the EXISTING gate (`lib/workspace/gating.ts`'s
 * `teach: hasFinalizedApplication(applications)`, untouched by this task) —
 * >=1 finalized `Application` exists for the session. Writes a
 * `TeachingDraft` through the ALREADY-BUILT `saveLocalTeachingDraft` vault
 * writer (`lib/sync/store.ts`, read-only here) — the same "one write path"
 * discipline every other real section in this shell follows; this component
 * has no IndexedDB access of its own beyond the store's own exported
 * functions.
 *
 * ---------------------------------------------------------------------------
 * TEACHOUTLINE-001 (this task) — the section-by-section outline builder.
 *
 * TEACHSECTIONSYNC-001 (wave 18, already merged) added the ninth sync entity
 * this file's own prior header named as the blocker: `TeachingSection`
 * (`lib/contracts/study-v2.ts`, read-only here), `saveLocalTeachingSection`
 * and the generic `listLocalV2Entities` reader (`lib/sync/store.ts`, both
 * read-only here). This task builds ONLY the UI on top of that
 * already-built plumbing — no new sync entity, no new write path, no new
 * IndexedDB access of its own.
 *
 * WHICH DRAFT DOES THE OUTLINE ATTACH TO? A session could in principle have
 * more than one `TeachingDraft` (nothing stops a learner from saving the
 * draft form twice). `pickCurrentDraft` below resolves this the same way
 * every "most recent wins" default in this codebase already does: the
 * non-deleted `TeachingDraft` for this session with the LATEST `createdAt`
 * (ties broken by `id` descending — arbitrary but deterministic, never
 * `Math.random()` or array order). This is a plain default, not a full
 * picker — a learner with two real, distinct drafts for one session has no
 * way to choose which one they are outlining, and no way to see the other
 * exists. If that ever stops being good enough, a future task needs: (a) a
 * draft-selector control here (chips or a dropdown over
 * `listLocalV2Entities("teachingDraft")` filtered by `sessionId`, exactly
 * the same read this task already does), and (b) the outline's `draftId`
 * following whichever draft is selected rather than always the newest.
 *
 * SOFT DELETE, NOT HARD DELETE (acceptance criterion 6): removing a section
 * sets `deletedAt` (via `buildRemovedSectionRecord`) and persists that
 * through the real vault writer — it does NOT remove the row from
 * IndexedDB. This matches EVERY other v2 entity's own convention
 * (`lib/contracts/study-v2.ts`'s `deletedAt?: string | null` on every one of
 * the nine interfaces, and `StudySection`'s own sibling entities all honor
 * it) and is the only choice consistent with this app's sync model: a
 * silent hard-delete here would have no trace to reconcile against a server
 * pull, unlike every other delete in this codebase. `activeSectionsForDraft`
 * filters `deletedAt`-set rows out of what renders, exactly the same
 * "filter after write, never delete the write" shape `db/schema.ts`'s
 * soft-delete columns already assume everywhere else.
 *
 * KIND PICKER (acceptance criteria 1, 7, 8b): `TeachOutlinePanel` below
 * derives its kind chips from `optionsFrom(TEACHING_SECTION_KINDS)` — the
 * SAME `optionsFrom`/`humanizeToken` pair `ClaimComposer.tsx`'s own claim
 * kind picker and `ConnectSection.tsx`'s connection-type picker already use
 * (read-only imports, not re-implemented here) — never a retyped literal
 * list. `humanizeToken` is a MECHANICAL string transform (split on `_`,
 * capitalize) with no per-kind lookup table, so "objection" renders
 * "Objection" and "not_justified" renders "Not justified" and nothing more
 * — no kind, "not_justified"/"objection" included, gets an added
 * description, example, or hint about what a passage means. A learner
 * recording an "objection" or a "not_justified" note is doing THEIR OWN
 * reasoning about what does or doesn't hold; this UI supplies the category
 * label only, never the verdict. `tests/teach-pane.test.ts`'s dedicated
 * ASSERTION-LINE test proves this against every kind in
 * `TEACHING_SECTION_KINDS`, not just the free-text body field.
 *
 * "NOTHING DEFAULTS" (acceptance criterion 7): `BLANK_SECTION_FIELDS.kind`
 * is `null`; no chip in `TeachOutlinePanel`'s kind fieldset ever renders
 * `aria-pressed="true"` until a learner clicks one — the same discipline
 * `ClaimComposer`'s `BLANK_CLAIM_SELECTION` and `ConnectSection`'s
 * `BLANK_CONNECTION_SELECTION` already enforce and this codebase already
 * mutation-proves for those two pickers.
 *
 * SORT ORDER (acceptance criterion 4): `nextSectionSortOrder` assigns one
 * past the current max `sortOrder` among that draft's non-deleted sections
 * (or `0` if none exist) — the learner never types a raw ordering number.
 * `swapSectionOrder` is the pure reorder step (move-up/move-down only; no
 * drag-and-drop library exists in this codebase and pulling one in is out
 * of scope per this task's own spec). `persistNewSection` /
 * `persistSectionReorder` / `persistSectionRemoval` are the three places
 * pure logic meets the real vault writer, each accepting an injectable
 * `save` function (default: the real `saveLocalTeachingSection`) —
 * `ConnectSection.tsx`'s own `fetchImpl` seam, reused for the same reason:
 * testable end-to-end (including "a reload shows the new order", proven
 * against the real `fake-indexeddb`-backed vault in the test file) without
 * a DOM.
 *
 * TESTABLE WITHOUT A DOM (acceptance criterion 9): every add/reorder/remove
 * decision — `sectionFieldsReadiness`, `nextSectionSortOrder`,
 * `buildTeachingSectionRecord`, `activeSectionsForDraft`, `pickCurrentDraft`,
 * `swapSectionOrder`, `buildRemovedSectionRecord`, and the three `persist*`
 * wrappers — is a plain exported function. `TeachOutlinePanel` itself is
 * HOOKLESS (props in, markup out), exactly `ConnectSection.tsx`'s
 * `EvidenceLabelField` / `ClaimComposer.tsx`'s `PromoteFields` precedent, so
 * it can be rendered directly with controlled props for structural/copy
 * assertions without waiting on `TeachSection`'s own `useEffect` load (which
 * — like `ConnectSection`'s `UserThreadsPanel` fetch — never fires under
 * `renderToStaticMarkup`, this repo's only render tool; see the test file's
 * own environment note).
 * ---------------------------------------------------------------------------
 *
 * TEACHMODE-001 (this task) — the "For me" / "For the room" display-order
 * toggle on top of the SAME `activeSectionsForDraft` rows above. This is
 * PRESENTATION-ONLY: no new sync entity, no new schema field, no write of
 * any kind (`TeachingSection.sortOrder` is never touched), and the exact
 * same discipline the rest of this file follows: a plain exported pure
 * function (`reorderForRoom`) plus one `useState<TeachViewMode>` in the
 * stateful shell (`TeachSection`), never a hook or DOM dependency inside
 * `TeachOutlinePanel` itself.
 *
 * DEFAULT ("for me"): identical to every prior wave's ONLY behavior —
 * `activeSectionsForDraft`'s own `sortOrder` order, completely unchanged.
 * `TeachSection` seeds `useState<TeachViewMode>("for-me")`, so nothing about
 * today's outline changes for a learner who never touches the new toggle.
 *
 * "FOR THE ROOM" ORDER (`reorderForRoom`, `FOR_ROOM_KIND_ORDER`): groups the
 * SAME rows by `kind` into the sequence a listener needs context before the
 * teacher's own discovery — `context`, then `connection`/`theology`, then
 * `illustration`, then `application`/`discussion`, then `objection`/
 * `not_justified` last (a listener needs the teacher's own case laid out
 * before hearing what the teacher decided NOT to run with). Within each
 * kind, original relative `sortOrder` is preserved via an explicit index
 * tie-break in the sort comparator, not bare reliance on the sort engine
 * being stable — provable without depending on V8's own guarantees.
 *
 * `outline` and `prayer` are NOT named in TEACHMODE-001's own ordering rule
 * (only "wherever they naturally fall, pick a stable, documented
 * position") — this file places `outline` FIRST and `prayer` LAST. Reasoning:
 * `outline` is a roadmap ("here's where this teaching is going"), exactly
 * the kind of context-before-content signal "for the room" mode exists to
 * front-load — the same reason `context` itself sits near the front rather
 * than in the middle. `prayer` closes a teaching in essentially every
 * convention this app's own users teach in; opening mid-`context` or
 * -`connection` with a prayer this task has no basis to place there would be
 * the odd editorial choice, closing in one is not. Neither placement is
 * claimed as THE single correct answer — it is one defensible, DOCUMENTED
 * convention, exactly the standard this file already holds
 * `FORMAT_PRESETS`'s minute values to.
 *
 * NO NEW COPY (assertion-line safety): `reorderForRoom` returns the SAME
 * `TeachingSection` objects, unmodified — same `id`, `kind`, `body`,
 * `sortOrder` field (its stored value is preserved even though display order
 * no longer matches it), everything. It only changes ARRAY ORDER. No label,
 * description, or summary is added anywhere by this task;
 * `tests/teach-pane.test.ts`'s TEACHMODE-001 tests prove this directly
 * (every section from the input appears exactly once in the output, with an
 * unmodified `body`) alongside the existing ASSERTION-LINE suite.
 *
 * OUT OF SCOPE (explicitly, per this task's own instructions): the "Where /
 * Tension / Image" relabeling shown in Claude Design's mockup
 * (`design/scarlet-thread-app/Scarlet Thread App.dc.html`, "6 — Teach mode —
 * for me, vs. for the room") invents category labels ("Where"/"Tension"/
 * "Image") with no correspondence to `TEACHING_SECTION_KINDS` at all —
 * reconciling that is a bigger, undecided product/content question this
 * task does not attempt. `reorderForRoom` reorders the EXISTING ten kinds;
 * it does not rename, relabel, merge, or reinterpret any of them.
 * ---------------------------------------------------------------------------
 *
 * THE ASSERTION LINE (docs/decisions/2026-08-18-teaching-not-theology.md) —
 * every free-text prompt below asks the LEARNER what THEY will teach, to
 * whom, and how THEY connect it to the gospel (or, for the outline, what
 * THEY will say in each part) — never what the app asserts the passage
 * means. No field starts pre-filled with an example sentence about any
 * actual passage (`BLANK_TEACH_FIELDS`/`BLANK_SECTION_FIELDS` are the only
 * seeds — see `tests/teach-pane.test.ts`'s ASSERTION-LINE tests).
 *
 * FORMAT PRESETS (acceptance criterion 1, TEACHDRAFTPANE-001): BUILD_PLAN §4
 * row 8 names four formats ("60-second/5-minute/15-minute/30-minute
 * presets, which set durationMinutes") but gives no numeric values anywhere
 * in either source doc — `FORMAT_PRESETS` below is the ONE place they are
 * chosen and defended, and the ONE place `tests/teach-pane.test.ts`'s
 * mutation proof targets:
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

/**
 * "Most recently created, non-deleted draft for this session" — see this
 * file's header for why this default was chosen and what a future
 * multi-draft picker would need. Ties (identical `createdAt`) break on `id`
 * descending, purely for a deterministic return value; no real-world
 * significance is claimed for that ordering.
 */
export function pickCurrentDraft(drafts: readonly TeachingDraft[], sessionId: string): TeachingDraft | null {
  const active = drafts.filter((draft) => draft.sessionId === sessionId && !draft.deletedAt);
  if (active.length === 0) return null;
  const sorted = active.slice().sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt.localeCompare(a.createdAt);
    return b.id.localeCompare(a.id);
  });
  return sorted[0];
}

// ---------------------------------------------------------------------------
// Outline sections — the ordered kind/sortOrder/body list under a draft.
// ---------------------------------------------------------------------------

export interface NewSectionFields {
  kind: TeachingSectionKind | null;
  body: string;
}

/** Nothing pre-selected — see this file's header, "NOTHING DEFAULTS". */
export const BLANK_SECTION_FIELDS: NewSectionFields = {
  kind: null,
  body: "",
};

export interface SectionFieldsReadiness {
  ready: boolean;
  missing: string[];
}

export function sectionFieldsReadiness(fields: NewSectionFields): SectionFieldsReadiness {
  const missing: string[] = [];
  if (!fields.kind) missing.push("Choose what kind of outline point this is.");
  if (!fields.body.trim()) missing.push("Write this part of your outline.");
  return { ready: missing.length === 0, missing };
}

/**
 * One past the current maximum `sortOrder` among that draft's non-deleted
 * sections, or `0` if none exist yet. MUTATION-TARGET (acceptance criterion
 * 10a) — see `tests/teach-pane.test.ts`'s own mutation-proof section.
 */
export function nextSectionSortOrder(sections: readonly TeachingSection[], draftId: string): number {
  const active = sections.filter((section) => section.draftId === draftId && !section.deletedAt);
  if (active.length === 0) return 0;
  return Math.max(...active.map((section) => section.sortOrder)) + 1;
}

/** Non-deleted sections for one draft, in `sortOrder`. The one place display order is computed. */
export function activeSectionsForDraft(sections: readonly TeachingSection[], draftId: string): TeachingSection[] {
  return sections
    .filter((section) => section.draftId === draftId && !section.deletedAt)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

// ---------------------------------------------------------------------------
// "For me" / "For the room" display-order toggle — see this file's header,
// TEACHMODE-001. Presentation-only: no sortOrder write, no new entity.
// ---------------------------------------------------------------------------

export type TeachViewMode = "for-me" | "for-room";

/** The toggle's own two options, in display order — the ONE place these labels live. */
export const TEACH_VIEW_MODES: readonly { key: TeachViewMode; label: string }[] = [
  { key: "for-me", label: "For me" },
  { key: "for-room", label: "For the room" },
];

/**
 * The "for the room" kind-group order — see this file's header for the full
 * reasoning behind each group's position, and specifically why `outline`
 * sits first and `prayer` sits last. Every member of `TEACHING_SECTION_KINDS`
 * appears here exactly once (`tests/teach-pane.test.ts` proves this directly
 * against the live `TEACHING_SECTION_KINDS` array, not a copy of it).
 */
export const FOR_ROOM_KIND_ORDER: readonly TeachingSectionKind[] = [
  "outline",
  "context",
  "connection",
  "theology",
  "illustration",
  "application",
  "discussion",
  "objection",
  "not_justified",
  "prayer",
];

function forRoomRank(kind: TeachingSectionKind): number {
  const index = FOR_ROOM_KIND_ORDER.indexOf(kind);
  // Every TeachingSectionKind appears exactly once in FOR_ROOM_KIND_ORDER
  // (proven by a dedicated test) -- this fallback only guards a future kind
  // being added to TEACHING_SECTION_KINDS without a matching update here,
  // sending it to the end rather than throwing.
  return index === -1 ? FOR_ROOM_KIND_ORDER.length : index;
}

/**
 * "For the room" display-order transform — PRESENTATION ONLY (this file's
 * header, TEACHMODE-001). Takes `activeSectionsForDraft`'s own output
 * (already filtered to one draft's non-deleted rows, sorted by `sortOrder`)
 * and returns a NEW array in `FOR_ROOM_KIND_ORDER` order. Every record
 * returned is the SAME object, untouched — no field is read except `kind`
 * for ranking, and `sortOrder` itself is never rewritten. Ties (same kind)
 * keep their original relative order via an explicit index tie-break in the
 * comparator, not bare reliance on `Array.prototype.sort` being stable.
 */
export function reorderForRoom(sections: readonly TeachingSection[]): TeachingSection[] {
  return sections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => {
      const rankDelta = forRoomRank(a.section.kind) - forRoomRank(b.section.kind);
      if (rankDelta !== 0) return rankDelta;
      return a.index - b.index;
    })
    .map((entry) => entry.section);
}

/**
 * Pure record builder — the only place a `TeachingSection` is assembled.
 * Throws rather than silently building an incomplete record, exactly
 * `buildTeachingDraftRecord`'s own precedent above.
 */
export function buildTeachingSectionRecord(params: {
  id: string;
  workspaceId: string;
  draftId: string;
  fields: NewSectionFields;
  sortOrder: number;
  now: string;
}): TeachingSection {
  const { fields } = params;
  if (!fields.kind) throw new Error("buildTeachingSectionRecord requires a kind");
  if (!fields.body.trim()) throw new Error("buildTeachingSectionRecord requires a body");
  return {
    id: params.id,
    workspaceId: params.workspaceId,
    draftId: params.draftId,
    kind: fields.kind,
    sortOrder: params.sortOrder,
    body: fields.body.trim(),
    revision: 1,
    createdAt: params.now,
    updatedAt: params.now,
    deletedAt: null,
  };
}

export interface ReorderResult {
  updated: [TeachingSection, TeachingSection];
}

/**
 * Pure swap of two ADJACENT-IN-DISPLAY-ORDER sections' `sortOrder` values.
 * `ordered` must already be in display order (`activeSectionsForDraft`'s
 * output) — this function does not re-sort. Returns `null` (no-op) if the
 * target section is already at that boundary (moving the first section up,
 * or the last down) rather than throwing, so a caller can simply skip the
 * write. Both returned records carry a bumped `revision`/`updatedAt`, same
 * shape every other v2 update in this codebase uses.
 */
export function swapSectionOrder(
  ordered: readonly TeachingSection[],
  sectionId: string,
  direction: "up" | "down",
  now: string,
): ReorderResult | null {
  const index = ordered.findIndex((section) => section.id === sectionId);
  if (index === -1) return null;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= ordered.length) return null;
  const current = ordered[index];
  const target = ordered[targetIndex];
  const updatedCurrent: TeachingSection = {
    ...current,
    sortOrder: target.sortOrder,
    revision: current.revision + 1,
    updatedAt: now,
  };
  const updatedTarget: TeachingSection = {
    ...target,
    sortOrder: current.sortOrder,
    revision: target.revision + 1,
    updatedAt: now,
  };
  return { updated: [updatedCurrent, updatedTarget] };
}

/** Soft-delete — see this file's header, "SOFT DELETE, NOT HARD DELETE". */
export function buildRemovedSectionRecord(section: TeachingSection, now: string): TeachingSection {
  return { ...section, deletedAt: now, revision: section.revision + 1, updatedAt: now };
}

type SaveSection = (section: TeachingSection) => Promise<void>;

/**
 * Assigns `sortOrder` (`nextSectionSortOrder`), builds the record
 * (`buildTeachingSectionRecord`), and persists it through the real vault
 * writer — `save` defaults to the real `saveLocalTeachingSection`, injected
 * exactly `ConnectSection.tsx`'s own `fetchImpl` seam, so a test can supply
 * a fake and inspect exactly what was written without a DOM.
 */
export async function persistNewSection(params: {
  id: string;
  workspaceId: string;
  draftId: string;
  fields: NewSectionFields;
  existingSections: readonly TeachingSection[];
  now: string;
  save?: SaveSection;
}): Promise<TeachingSection> {
  const save = params.save ?? saveLocalTeachingSection;
  const sortOrder = nextSectionSortOrder(params.existingSections, params.draftId);
  const record = buildTeachingSectionRecord({
    id: params.id,
    workspaceId: params.workspaceId,
    draftId: params.draftId,
    fields: params.fields,
    sortOrder,
    now: params.now,
  });
  await save(record);
  return record;
}

/**
 * Computes the swap (`swapSectionOrder`) and persists BOTH updated sections
 * through the real vault writer — not just one. `save` defaults to the real
 * `saveLocalTeachingSection`. MUTATION-TARGET (acceptance criterion 10b):
 * breaking this to only await the first `save` call (dropping the second)
 * must fail a named test.
 */
export async function persistSectionReorder(
  ordered: readonly TeachingSection[],
  sectionId: string,
  direction: "up" | "down",
  now: string,
  save: SaveSection = saveLocalTeachingSection,
): Promise<ReorderResult | null> {
  const result = swapSectionOrder(ordered, sectionId, direction, now);
  if (!result) return null;
  await save(result.updated[0]);
  await save(result.updated[1]);
  return result;
}

/** Builds the soft-deleted record (`buildRemovedSectionRecord`) and persists it through the real vault writer. */
export async function persistSectionRemoval(
  section: TeachingSection,
  now: string,
  save: SaveSection = saveLocalTeachingSection,
): Promise<TeachingSection> {
  const updated = buildRemovedSectionRecord(section, now);
  await save(updated);
  return updated;
}

// ---------------------------------------------------------------------------
// TeachOutlinePanel — HOOKLESS (props in, markup out). See this file's
// header, "TESTABLE WITHOUT A DOM".
// ---------------------------------------------------------------------------

export interface TeachOutlinePanelProps {
  sections: readonly TeachingSection[];
  disabled: boolean;
  newSectionFields: NewSectionFields;
  sectionReadiness: SectionFieldsReadiness;
  onFieldsChange: (fields: NewSectionFields) => void;
  onAddSection: (event: React.FormEvent<HTMLFormElement>) => void;
  onMove: (sectionId: string, direction: "up" | "down") => void;
  onRemove: (sectionId: string) => void;
  addStatus: "idle" | "saving" | "saved" | "error";
  addMessage: string;
  /** "for-me" (default) vs "for-room" — see this file's header, TEACHMODE-001. `sections` above is already in the caller's chosen display order; this panel only renders the toggle, it never reorders. */
  viewMode: TeachViewMode;
  onViewModeChange: (mode: TeachViewMode) => void;
}

export function TeachOutlinePanel({
  sections,
  disabled,
  newSectionFields,
  sectionReadiness,
  onFieldsChange,
  onAddSection,
  onMove,
  onRemove,
  addStatus,
  addMessage,
  viewMode,
  onViewModeChange,
}: TeachOutlinePanelProps) {
  // Move up/down swap `sortOrder` between what the caller's `onMove` treats
  // as ADJACENT rows -- i.e. adjacent in the real "for me" order (see
  // `TeachSection`'s own `moveSection`, which always reorders
  // `orderedSections`, never this panel's `sections` prop). In "for the
  // room" view, two visually-adjacent rows are often NOT adjacent in that
  // real order, so a Move button here would silently act on a different
  // pair than the one the learner sees next to it. Disabling reorder (never
  // Remove, and never the add-outline-point form below) while viewing "for
  // the room" avoids that mismatch rather than leaving a control that lies
  // about what it's about to do.
  const moveControlsDisabled = viewMode === "for-room";
  return (
    <section aria-label="Teaching outline" data-testid="teach-outline-panel">
      <p style={noticeStyle}>
        Build your teaching out section by section. Each part is your own reasoning, in your own words — nothing
        here is supplied or suggested by the app.
      </p>

      <div aria-label="Outline view" data-testid="teach-view-mode-toggle" role="group">
        {TEACH_VIEW_MODES.map((mode) => (
          <Chip
            active={viewMode === mode.key}
            aria-pressed={viewMode === mode.key}
            data-view-mode={mode.key}
            key={mode.key}
            onClick={() => onViewModeChange(mode.key)}
          >
            {mode.label}
          </Chip>
        ))}
      </div>

      {sections.length === 0 ? (
        <p style={noticeStyle} data-testid="teach-outline-empty">
          No outline points yet.
        </p>
      ) : (
        <ol data-testid="teach-outline-list">
          {sections.map((section, index) => (
            <li data-testid="teach-outline-item" key={section.id}>
              <span data-testid="teach-outline-item-kind">{humanizeToken(section.kind)}</span>
              <p data-testid="teach-outline-item-body">{section.body}</p>
              <div aria-label="Reorder or remove this outline point" role="group">
                <Button
                  disabled={disabled || moveControlsDisabled || index === 0}
                  onClick={() => onMove(section.id, "up")}
                  type="button"
                  variant="secondary"
                >
                  Move up
                </Button>
                <Button
                  disabled={disabled || moveControlsDisabled || index === sections.length - 1}
                  onClick={() => onMove(section.id, "down")}
                  type="button"
                  variant="secondary"
                >
                  Move down
                </Button>
                <Button disabled={disabled} onClick={() => onRemove(section.id)} type="button" variant="secondary">
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <form data-testid="teach-outline-add-form" onSubmit={onAddSection}>
        <fieldset>
          <legend style={noticeStyle}>What kind of outline point is this?</legend>
          <div role="group">
            {optionsFrom(TEACHING_SECTION_KINDS).map((option) => (
              <Chip
                active={newSectionFields.kind === option.value}
                aria-pressed={newSectionFields.kind === option.value}
                data-field="kind"
                data-value={option.value}
                disabled={disabled}
                key={option.value}
                onClick={() => onFieldsChange({ ...newSectionFields, kind: option.value })}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </fieldset>

        <Field
          disabled={disabled}
          hint="Your own reasoning for this part of your teaching, in your own words."
          label="What will you say in this part?"
          onChange={(event) => onFieldsChange({ ...newSectionFields, body: event.target.value })}
          value={newSectionFields.body}
        />

        {sectionReadiness.missing.length > 0 ? (
          <ul aria-live="polite" data-testid="teach-outline-missing">
            {sectionReadiness.missing.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}

        <footer>
          <p aria-live="polite" data-state={addStatus}>
            {addMessage}
          </p>
          <Button disabled={!sectionReadiness.ready || disabled} type="submit" variant="actionRow">
            {addStatus === "saving" ? "Saving…" : "Add to outline"}
          </Button>
        </footer>
      </form>
    </section>
  );
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

  const [drafts, setDrafts] = useState<TeachingDraft[]>([]);
  const [sections, setSections] = useState<TeachingSection[]>([]);
  const [outlineLoaded, setOutlineLoaded] = useState(false);
  const [sectionFields, setSectionFields] = useState<NewSectionFields>(BLANK_SECTION_FIELDS);
  const [addStatus, setAddStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [addMessage, setAddMessage] = useState("");
  const [outlineActionStatus, setOutlineActionStatus] = useState<"idle" | "busy" | "error">("idle");
  const [outlineActionMessage, setOutlineActionMessage] = useState("");
  // Display-order preference only -- see this file's header, TEACHMODE-001.
  // Defaults to "for-me" (today's only behavior); never persisted, never
  // written through the vault, never touches `sortOrder`.
  const [viewMode, setViewMode] = useState<TeachViewMode>("for-me");

  // Loads this device's existing TeachingDraft/TeachingSection rows so a
  // reload shows real, persisted state rather than starting the outline
  // over. Never fires under `renderToStaticMarkup` (no browser commit
  // phase) — see this file's header, "TESTABLE WITHOUT A DOM" — so the
  // render tests exercise `TeachOutlinePanel` directly with controlled
  // props instead of waiting on this effect.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [loadedDrafts, loadedSections] = await Promise.all([
        listLocalV2Entities("teachingDraft"),
        listLocalV2Entities("teachingSection"),
      ]);
      if (!cancelled) {
        setDrafts(loadedDrafts);
        setSections(loadedSections);
        setOutlineLoaded(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [session.id]);

  if (!unlocked) {
    return (
      <LockedNotice
        testId="teach-locked"
        message="Locked until you finalize an application. Use Apply above first, then this composer opens."
      />
    );
  }

  const readiness = teachDraftReadiness(fields);
  const currentDraft = pickCurrentDraft(drafts, session.id);
  const orderedSections = currentDraft ? activeSectionsForDraft(sections, currentDraft.id) : [];
  // "for-room" is a pure reorder of `orderedSections` -- see this file's
  // header, TEACHMODE-001. Move/remove actions above always operate on
  // `orderedSections` (the real, sortOrder-based display), never on this
  // derived view, so a reorder-for-room never disturbs the actual outline.
  const displaySections = viewMode === "for-room" ? reorderForRoom(orderedSections) : orderedSections;
  const sectionReadiness = sectionFieldsReadiness(sectionFields);

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
      // Newly created draft becomes the "most recently created" one
      // (pickCurrentDraft) immediately, without waiting for another vault
      // read — the outline area opens for it right away.
      setDrafts((previous) => [...previous, draft]);
      setOutlineLoaded(true);
      onSaved?.(draft);
    } catch {
      setStatus("error");
      setMessage("This device could not save this teaching draft. Nothing was discarded — please try again.");
    }
  }

  async function addSection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentDraft || !sectionReadiness.ready || addStatus === "saving") return;

    setAddStatus("saving");
    setAddMessage("Saving to this device…");
    const now = new Date().toISOString();

    try {
      const record = await persistNewSection({
        id: crypto.randomUUID(),
        workspaceId,
        draftId: currentDraft.id,
        fields: sectionFields,
        existingSections: sections,
        now,
      });
      setSections((previous) => [...previous, record]);
      setSectionFields(BLANK_SECTION_FIELDS);
      setAddStatus("saved");
      setAddMessage("Saved to this device.");
    } catch {
      setAddStatus("error");
      setAddMessage("This device could not save this outline point. Nothing was discarded — please try again.");
    }
  }

  async function moveSection(sectionId: string, direction: "up" | "down") {
    if (outlineActionStatus === "busy") return;
    setOutlineActionStatus("busy");
    setOutlineActionMessage("Saving to this device…");
    const now = new Date().toISOString();
    try {
      const result = await persistSectionReorder(orderedSections, sectionId, direction, now);
      if (result) {
        const [a, b] = result.updated;
        setSections((previous) => previous.map((section) => (section.id === a.id ? a : section.id === b.id ? b : section)));
      }
      setOutlineActionStatus("idle");
      setOutlineActionMessage("");
    } catch {
      setOutlineActionStatus("error");
      setOutlineActionMessage("This device could not reorder the outline. Nothing was discarded — please try again.");
    }
  }

  async function removeSection(sectionId: string) {
    const target = sections.find((section) => section.id === sectionId);
    if (!target || outlineActionStatus === "busy") return;
    setOutlineActionStatus("busy");
    setOutlineActionMessage("Saving to this device…");
    const now = new Date().toISOString();
    try {
      const updated = await persistSectionRemoval(target, now);
      setSections((previous) => previous.map((section) => (section.id === updated.id ? updated : section)));
      setOutlineActionStatus("idle");
      setOutlineActionMessage("");
    } catch {
      setOutlineActionStatus("error");
      setOutlineActionMessage("This device could not remove that outline point. Nothing was discarded — please try again.");
    }
  }

  return (
    <div style={bodyStyle}>
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
          <Button disabled={!readiness.ready || status === "saving"} type="submit" variant="actionRow">
            {status === "saving" ? "Saving…" : "Save teaching draft"}
          </Button>
        </footer>
      </form>

      {!outlineLoaded ? (
        <p style={noticeStyle} data-testid="teach-outline-checking">
          Checking this device for an existing teaching draft…
        </p>
      ) : !currentDraft ? (
        <p style={noticeStyle} data-testid="teach-outline-awaiting-draft">
          Save a teaching draft above first — then build its outline here, section by section.
        </p>
      ) : (
        <>
          {outlineActionStatus === "error" ? (
            <p role="alert" style={noticeStyle}>
              {outlineActionMessage}
            </p>
          ) : null}
          <TeachOutlinePanel
            addMessage={addMessage}
            addStatus={addStatus}
            disabled={outlineActionStatus === "busy"}
            newSectionFields={sectionFields}
            onAddSection={addSection}
            onFieldsChange={setSectionFields}
            onMove={(sectionId, direction) => void moveSection(sectionId, direction)}
            onRemove={(sectionId) => void removeSection(sectionId)}
            onViewModeChange={setViewMode}
            sectionReadiness={sectionReadiness}
            sections={displaySections}
            viewMode={viewMode}
          />
        </>
      )}
    </div>
  );
}
