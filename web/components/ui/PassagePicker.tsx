"use client";

import { useId, useState } from "react";

import type { PassageCanon, PassageCanonBook } from "@/lib/bible/passageCanon";
import { chapterCountOf, verseCountOf } from "@/lib/bible/passageCanon";
import {
  EMPTY_PICKER_STATE,
  checkPickerState,
  describePickerRange,
  rangeToPickerState,
  stepPassagePicker,
  type PassagePickerAction,
  type PassagePickerOptions,
  type PassagePickerState,
  type PickerField,
} from "@/lib/bible/passagePickerState";
import type { CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import styles from "./PassagePicker.module.css";

/**
 * PICKERLIB-001 (contract C3) — pick a passage as book -> chapter -> start
 * verse -> end verse and emit a `CanonicalRangeV1`, instead of asking a
 * learner to type "book.chapter.verse" keys. Wired into
 * `workspace/ConnectSection.tsx` by RANGEPICKER-002 (`surface="shell"`).
 *
 * Two layers, same split as the rest of this repo's tested components:
 *   - `PassagePickerView` — hookless, props in / markup out. Tested with
 *     `renderToStaticMarkup`. Takes an explicit `idPrefix` (no `useId`), the
 *     current `state`, and an `onAction` callback.
 *   - `PassagePicker` — thin stateful wrapper: `useState` + `useId`, runs
 *     every action through the pure `reducePassagePicker` (lib/bible/
 *     passagePickerState.ts, where the clamp / ordering rules live and are
 *     tested) and calls `onChange(range | null)` when the emitted range
 *     changes. Uncontrolled: `value` seeds the initial selection only.
 *
 * The canon is DATA, supplied by the caller (`PassageCanon`, built from the
 * real corpus by `lib/bible/passageCanon.ts`); this file never imports corpus
 * JSON.
 *
 * Accessibility: native <select>s (keyboard-complete and screen-reader
 * correct for free — arrows, type-ahead, Enter/Escape), each with a real
 * <label for>, grouped in a <fieldset>/<legend>. A select is `disabled` until
 * the level above it is chosen. `aria-invalid` + `aria-describedby` point the
 * failing select at a `role="alert"` message; every other select is described
 * by a polite `role="status"` line that reads the current selection back
 * ("Genesis 3:1–24 (whole chapter)"). 44px targets and visible focus come from
 * the CSS module (tokens from app/globals.css, both reading themes).
 */

export type { PassagePickerAction, PassagePickerState } from "@/lib/bible/passagePickerState";

export interface PassagePickerViewProps {
  /** Unique per picker instance on a page; every control id derives from it. */
  idPrefix: string;
  canon: PassageCanon;
  state: PassagePickerState;
  onAction?: (action: PassagePickerAction) => void;
  /** Legend text. Default "Passage". */
  label?: string;
  /** Show an end-chapter select so a range may span chapters (Gen 1:1–2:3). Default false. */
  allowCrossChapter?: boolean;
  disabled?: boolean;
  /** Parent-supplied error (e.g. "Choose a passage"); shown and marked on the first control that needs attention. */
  error?: string;
  className?: string;
  /**
   * Which colour family the picker sits on. "page" (default): the reading
   * page (`--page-*`, follows the parchment/midnight reading theme). "shell":
   * the always-dark Passage Workspace shell (`--shell-*`, theme-independent).
   * The two are NOT interchangeable: `:root` defines both families at once, so
   * a `var(--page-x, var(--shell-x))` chain never actually falls back, and a
   * parchment-theme picker dropped into the dark shell paints muted page text
   * on `--shell-bg` (RANGEPICKER-002 measured ~3.9:1). Contrast of both
   * surfaces, in both reading themes, is asserted in
   * tests/passage-picker-contrast.test.ts.
   */
  surface?: "page" | "shell";
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
}

/**
 * The selectable numbers `from..to`, plus the state's CURRENT value when it is
 * outside that span (an invalid state handed in from outside): a select whose
 * value has no matching option silently displays its first option, which would
 * make the invalid state look valid.
 */
function choices(from: number, to: number, current: number | null): number[] {
  const numbers = range(from, to);
  if (current !== null && Number.isInteger(current) && !numbers.includes(current)) {
    numbers.push(current);
    numbers.sort((a, b) => a - b);
  }
  return numbers;
}

function BookOptions({ canon }: { canon: PassageCanon }) {
  const groups: Array<[string, PassageCanonBook[]]> = [
    ["Old Testament", canon.filter((b) => b.testament === "OT")],
    ["New Testament", canon.filter((b) => b.testament === "NT")],
  ];
  const ungrouped = canon.filter((b) => b.testament !== "OT" && b.testament !== "NT");
  return (
    <>
      <option value="">Choose a book</option>
      {groups.map(([name, books]) =>
        books.length > 0 ? (
          <optgroup key={name} label={name}>
            {books.map((b) => (
              <option key={b.n} value={b.n}>
                {b.name}
              </option>
            ))}
          </optgroup>
        ) : null,
      )}
      {ungrouped.map((b) => (
        <option key={b.n} value={b.n}>
          {b.name}
        </option>
      ))}
    </>
  );
}

function parseChoice(value: string): number | null {
  return value === "" ? null : Number(value);
}

/** Hookless render of the picker. See the file header. */
export function PassagePickerView({
  idPrefix,
  canon,
  state,
  onAction,
  label = "Passage",
  allowCrossChapter = false,
  disabled = false,
  error,
  className,
  surface = "page",
}: PassagePickerViewProps) {
  const options: PassagePickerOptions = { allowCrossChapter };
  const check = checkPickerState(state, canon, options);
  const emit = (action: PassagePickerAction) => onAction?.(action);

  const statusId = `${idPrefix}-status`;
  const errorId = `${idPrefix}-error`;
  const ids = {
    book: `${idPrefix}-book`,
    chapter: `${idPrefix}-chapter`,
    startVerse: `${idPrefix}-start-verse`,
    endChapter: `${idPrefix}-end-chapter`,
    endVerse: `${idPrefix}-end-verse`,
  } satisfies Record<PickerField, string>;

  // Which control (if any) carries aria-invalid, and what the message says.
  let invalidField: PickerField | null = null;
  let errorText: string | undefined;
  if (check.status === "invalid") {
    invalidField = check.field;
    errorText = check.message;
  } else if (error) {
    errorText = error;
    invalidField =
      state.book === null ? "book" : state.chapter === null ? "chapter" : "startVerse";
  }

  const summary =
    check.status === "valid"
      ? describePickerRange(check.range, canon)
      : check.status === "incomplete"
        ? check.message
        : check.status === "empty"
          ? "Choose a book, then a chapter, then the verses."
          : "Fix the highlighted field.";

  const bookChosen = state.book !== null && check.status !== "empty";
  const chapters = state.book === null ? 0 : (chapterCountOf(canon, state.book) ?? 0);
  const chapterChosen = bookChosen && state.chapter !== null;
  const startVerses =
    chapterChosen && state.book !== null && state.chapter !== null
      ? (verseCountOf(canon, state.book, state.chapter) ?? 0)
      : 0;
  const endChapter = state.endChapter ?? state.chapter;
  const endVerses =
    chapterChosen && state.book !== null && endChapter !== null
      ? (verseCountOf(canon, state.book, endChapter) ?? 0)
      : 0;
  // A same-chapter end verse can never precede the start, so those options aren't offered.
  const endVerseFloor = endChapter === state.chapter ? (state.startVerse ?? 1) : 1;
  const endChapterFloor = state.chapter ?? 1;

  const describedBy = (field: PickerField) =>
    invalidField === field && errorText ? `${errorId} ${statusId}` : statusId;
  const common = (field: PickerField, isDisabled: boolean) => ({
    id: ids[field],
    className: styles.select,
    disabled: disabled || isDisabled,
    "aria-invalid": invalidField === field ? (true as const) : undefined,
    "aria-describedby": describedBy(field),
  });

  const fieldClass = [styles.picker, className].filter(Boolean).join(" ");

  return (
    <fieldset className={fieldClass} disabled={disabled} data-testid="passage-picker" data-surface={surface}>
      <legend className={styles.legend}>{label}</legend>
      <div className={styles.grid}>
        <div className={`${styles.cell} ${styles.cellWide}`}>
          <label htmlFor={ids.book} className={styles.label}>
            Book
          </label>
          <select
            {...common("book", false)}
            value={state.book === null ? "" : String(state.book)}
            onChange={(event) => emit({ type: "book", book: parseChoice(event.currentTarget.value) })}
          >
            <BookOptions canon={canon} />
          </select>
        </div>

        <div className={styles.cell}>
          <label htmlFor={ids.chapter} className={styles.label}>
            Chapter
          </label>
          <select
            {...common("chapter", !bookChosen)}
            value={state.chapter === null ? "" : String(state.chapter)}
            onChange={(event) => emit({ type: "chapter", chapter: parseChoice(event.currentTarget.value) })}
          >
            <option value="">Choose a chapter</option>
            {choices(1, chapters, state.chapter).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.cell}>
          <label htmlFor={ids.startVerse} className={styles.label}>
            From verse
          </label>
          <select
            {...common("startVerse", !chapterChosen)}
            value={state.startVerse === null ? "" : String(state.startVerse)}
            onChange={(event) => emit({ type: "startVerse", verse: parseChoice(event.currentTarget.value) })}
          >
            {!chapterChosen || state.startVerse === null ? <option value="">Verse</option> : null}
            {choices(1, startVerses, state.startVerse).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        {allowCrossChapter ? (
          <div className={styles.cell}>
            <label htmlFor={ids.endChapter} className={styles.label}>
              To chapter
            </label>
            <select
              {...common("endChapter", !chapterChosen)}
              value={endChapter === null ? "" : String(endChapter)}
              onChange={(event) => emit({ type: "endChapter", chapter: parseChoice(event.currentTarget.value) })}
            >
              {!chapterChosen || endChapter === null ? <option value="">Chapter</option> : null}
              {choices(endChapterFloor, chapters, endChapter).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className={styles.cell}>
          <label htmlFor={ids.endVerse} className={styles.label}>
            To verse
          </label>
          <select
            {...common("endVerse", !chapterChosen)}
            value={state.endVerse === null ? "" : String(state.endVerse)}
            onChange={(event) => emit({ type: "endVerse", verse: parseChoice(event.currentTarget.value) })}
          >
            {!chapterChosen || state.endVerse === null ? <option value="">Verse</option> : null}
            {choices(endVerseFloor, endVerses, state.endVerse).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p id={statusId} role="status" aria-live="polite" className={styles.status}>
        {summary}
      </p>
      {errorText ? (
        <p id={errorId} role="alert" className={styles.error}>
          {errorText}
        </p>
      ) : null}
    </fieldset>
  );
}

export interface PassagePickerProps {
  canon: PassageCanon;
  /** Seeds the initial selection only (uncontrolled). An invalid or out-of-canon range starts empty. */
  value?: CanonicalRangeV1 | null;
  /** Called with the complete, valid range — or null when the selection is not (or no longer) a valid range. */
  onChange?: (range: CanonicalRangeV1 | null) => void;
  label?: string;
  allowCrossChapter?: boolean;
  disabled?: boolean;
  error?: string;
  className?: string;
  /** Override the generated id prefix (stable ids for tests / anchors). */
  idPrefix?: string;
  /** See `PassagePickerViewProps.surface`. */
  surface?: "page" | "shell";
}

/** Stateful wrapper around `PassagePickerView`. */
export function PassagePicker({
  canon,
  value = null,
  onChange,
  label,
  allowCrossChapter = false,
  disabled,
  error,
  className,
  idPrefix,
  surface,
}: PassagePickerProps) {
  const generatedId = useId();
  const options: PassagePickerOptions = { allowCrossChapter };
  const [state, setState] = useState<PassagePickerState>(
    () => (value ? rangeToPickerState(value, canon) : null) ?? EMPTY_PICKER_STATE,
  );

  function onAction(action: PassagePickerAction) {
    const step = stepPassagePicker(state, action, canon, options);
    if (!step.changed) return;
    setState(step.state);
    if (step.emit) onChange?.(step.emit.range);
  }

  return (
    <PassagePickerView
      idPrefix={idPrefix ?? `passage-picker-${generatedId}`}
      canon={canon}
      state={state}
      onAction={onAction}
      label={label}
      allowCrossChapter={allowCrossChapter}
      disabled={disabled}
      error={error}
      className={className}
      surface={surface}
    />
  );
}
