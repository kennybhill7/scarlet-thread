/**
 * PICKERLIB-001 (contract C3) — the pure state machine behind
 * `components/ui/PassagePicker.tsx`. No React, no DOM: every transition is a
 * plain function of (state, action, canon), so the boundary behaviour (clamps,
 * reversed ranges, cross-chapter) is unit-tested directly.
 *
 * Model: a passage is book -> chapter -> start verse -> (optional end chapter)
 * -> end verse. Choosing a chapter immediately selects the WHOLE chapter
 * (verse 1 through the chapter's real last verse), so the picker emits a valid
 * `CanonicalRangeV1` as soon as a chapter is chosen and the learner narrows it
 * from there. Every transition keeps the state inside the real canon:
 *
 *   - a verse (or chapter) number is clamped to [1, real count] — 0 and
 *     negatives become 1, anything past the end becomes the last verse/chapter;
 *   - a non-integer / NaN / null verse input is ignored (state unchanged);
 *   - end < start is impossible through the reducer: raising the start past the
 *     end pulls the end up to the start, and an end below the start clamps to
 *     the start.
 *
 * `checkPickerState` is the independent judge used for the UI's invalid state:
 * it re-validates any state (including one built by `rangeToPickerState` from
 * outside data) and finishes with `validateCanonicalRange`, so the picker and
 * the rest of the app cannot disagree about what a valid range is.
 */

import {
  chapterCountOf,
  findBook,
  toCanonTable,
  verseCountOf,
  type PassageCanon,
} from "@/lib/bible/passageCanon";
import { parseVerseKeyStrict, validateCanonicalRange } from "@/lib/bible/range";
import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";

export interface PassagePickerState {
  book: number | null;
  chapter: number | null;
  startVerse: number | null;
  /** Equals `chapter` unless the picker allows a cross-chapter range. */
  endChapter: number | null;
  endVerse: number | null;
}

export const EMPTY_PICKER_STATE: PassagePickerState = Object.freeze({
  book: null,
  chapter: null,
  startVerse: null,
  endChapter: null,
  endVerse: null,
});

export type PassagePickerAction =
  | { type: "book"; book: number | null }
  | { type: "chapter"; chapter: number | null }
  | { type: "startVerse"; verse: number | null }
  | { type: "endChapter"; chapter: number | null }
  | { type: "endVerse"; verse: number | null };

export interface PassagePickerOptions {
  /** Offer (and accept) an end chapter different from the start chapter. Default false. */
  allowCrossChapter?: boolean;
}

/** An integer or null; NaN, +-Infinity, fractions, and non-numbers are all "no usable number". */
function asInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/** Selecting chapter `chapter` = the whole chapter, start to real last verse. */
function wholeChapter(book: number, chapter: number, canon: PassageCanon): PassagePickerState {
  const last = verseCountOf(canon, book, chapter) ?? 1;
  return { book, chapter, startVerse: 1, endChapter: chapter, endVerse: last };
}

export function reducePassagePicker(
  state: PassagePickerState,
  action: PassagePickerAction,
  canon: PassageCanon,
  options: PassagePickerOptions = {},
): PassagePickerState {
  switch (action.type) {
    case "book": {
      const book = asInt(action.book);
      if (book === null || !findBook(canon, book)) return EMPTY_PICKER_STATE;
      if (book === state.book) return state;
      return { ...EMPTY_PICKER_STATE, book };
    }

    case "chapter": {
      if (state.book === null) return state;
      const requested = asInt(action.chapter);
      if (requested === null) {
        // Explicit "no chapter" (the placeholder option) clears everything below the book.
        return action.chapter === null ? { ...EMPTY_PICKER_STATE, book: state.book } : state;
      }
      const chapters = chapterCountOf(canon, state.book);
      if (chapters === undefined) return state;
      const chapter = clamp(requested, 1, chapters);
      if (chapter === state.chapter) return state;
      return wholeChapter(state.book, chapter, canon);
    }

    case "startVerse": {
      if (state.book === null || state.chapter === null) return state;
      const requested = asInt(action.verse);
      const verses = verseCountOf(canon, state.book, state.chapter);
      if (requested === null || verses === undefined) return state;
      const startVerse = clamp(requested, 1, verses);
      const endChapter = state.endChapter ?? state.chapter;
      const endVerse = state.endVerse ?? verses;
      return {
        ...state,
        startVerse,
        endChapter,
        // Same-chapter end may never sit before the start; a later end chapter is unaffected.
        endVerse: endChapter === state.chapter ? Math.max(endVerse, startVerse) : endVerse,
      };
    }

    case "endChapter": {
      if (!options.allowCrossChapter) return state;
      if (state.book === null || state.chapter === null) return state;
      const requested = asInt(action.chapter);
      const chapters = chapterCountOf(canon, state.book);
      if (requested === null || chapters === undefined) return state;
      const endChapter = clamp(requested, state.chapter, chapters);
      if (endChapter === state.endChapter) return state;
      // A new end chapter runs to its real last verse; the learner narrows from there.
      return { ...state, endChapter, endVerse: verseCountOf(canon, state.book, endChapter) ?? 1 };
    }

    case "endVerse": {
      if (state.book === null || state.chapter === null) return state;
      const requested = asInt(action.verse);
      const endChapter = state.endChapter ?? state.chapter;
      const verses = verseCountOf(canon, state.book, endChapter);
      if (requested === null || verses === undefined) return state;
      const startVerse = state.startVerse ?? 1;
      const lo = endChapter === state.chapter ? startVerse : 1;
      return { ...state, endChapter, endVerse: clamp(requested, lo, verses) };
    }
  }
}

// ---------------------------------------------------------------------------
// State <-> CanonicalRangeV1
// ---------------------------------------------------------------------------

export function rangeToPickerState(range: CanonicalRangeV1, canon: PassageCanon): PassagePickerState | null {
  const validation = validateCanonicalRange(range, toCanonTable(canon));
  if (!validation.ok) return null;
  const start = parseVerseKeyStrict(range.start);
  const end = parseVerseKeyStrict(range.end);
  if (!start || !end) return null;
  return {
    book: start.book,
    chapter: start.chapter,
    startVerse: start.verse,
    endChapter: end.chapter,
    endVerse: end.verse,
  };
}

// ---------------------------------------------------------------------------
// Independent validation of any state (drives aria-invalid in the view)
// ---------------------------------------------------------------------------

export type PickerField = "book" | "chapter" | "startVerse" | "endChapter" | "endVerse";

export type PickerCheck =
  | { status: "empty" }
  | { status: "incomplete"; message: string }
  | { status: "invalid"; field: PickerField; message: string }
  | { status: "valid"; range: CanonicalRangeV1 };

export function checkPickerState(
  state: PassagePickerState,
  canon: PassageCanon,
  options: PassagePickerOptions = {},
): PickerCheck {
  const { book, chapter, startVerse } = state;
  if (book === null) return { status: "empty" };
  if (!findBook(canon, book)) return { status: "invalid", field: "book", message: "That book is not in the canon." };
  if (chapter === null) return { status: "incomplete", message: "Choose a chapter." };

  const chapters = chapterCountOf(canon, book) ?? 0;
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > chapters) {
    return { status: "invalid", field: "chapter", message: `Chapter must be between 1 and ${chapters}.` };
  }
  if (startVerse === null || state.endVerse === null) {
    return { status: "incomplete", message: "Choose the verses." };
  }

  const endChapter = state.endChapter ?? chapter;
  const startVerses = verseCountOf(canon, book, chapter) ?? 0;
  if (!Number.isInteger(startVerse) || startVerse < 1 || startVerse > startVerses) {
    return { status: "invalid", field: "startVerse", message: `Start verse must be between 1 and ${startVerses}.` };
  }
  if (endChapter < chapter) {
    return { status: "invalid", field: "endChapter", message: "The end chapter cannot come before the start chapter." };
  }
  if (endChapter !== chapter && !options.allowCrossChapter) {
    return { status: "invalid", field: "endChapter", message: "This picker only accepts a passage within one chapter." };
  }
  if (endChapter > chapters) {
    return { status: "invalid", field: "endChapter", message: `End chapter must be between ${chapter} and ${chapters}.` };
  }
  const endVerses = verseCountOf(canon, book, endChapter) ?? 0;
  if (!Number.isInteger(state.endVerse) || state.endVerse < 1 || state.endVerse > endVerses) {
    return { status: "invalid", field: "endVerse", message: `End verse must be between 1 and ${endVerses}.` };
  }
  if (endChapter === chapter && state.endVerse < startVerse) {
    return { status: "invalid", field: "endVerse", message: "The end verse cannot come before the start verse." };
  }

  const range: CanonicalRangeV1 = {
    versificationId: CANONICAL_VERSIFICATION_ID,
    start: `${book}.${chapter}.${startVerse}`,
    end: `${book}.${endChapter}.${state.endVerse}`,
  };
  // Final gate: the app's own validator must agree.
  const validation = validateCanonicalRange(range, toCanonTable(canon));
  if (!validation.ok) return { status: "invalid", field: "endVerse", message: validation.detail };
  return { status: "valid", range };
}

/** The complete, valid range this state represents — or null (empty / incomplete / invalid). */
export function pickerStateToRange(
  state: PassagePickerState,
  canon: PassageCanon,
  options: PassagePickerOptions = {},
): CanonicalRangeV1 | null {
  const check = checkPickerState(state, canon, options);
  return check.status === "valid" ? check.range : null;
}

/** "Genesis 3:1–24 (whole chapter)", "Romans 5:12", "Genesis 1:1–2:3" — for the live status line. */
export function describePickerRange(range: CanonicalRangeV1, canon: PassageCanon): string | null {
  const start = parseVerseKeyStrict(range.start);
  const end = parseVerseKeyStrict(range.end);
  if (!start || !end) return null;
  const book = findBook(canon, start.book);
  if (!book) return null;
  const from = `${start.chapter}:${start.verse}`;
  if (start.chapter === end.chapter && start.verse === end.verse) return `${book.name} ${from}`;
  const wholeSpan =
    start.verse === 1 && end.verse === (verseCountOf(canon, end.book, end.chapter) ?? -1);
  const suffix = wholeSpan ? (start.chapter === end.chapter ? " (whole chapter)" : " (whole chapters)") : "";
  const to = start.chapter === end.chapter ? `${end.verse}` : `${end.chapter}:${end.verse}`;
  return `${book.name} ${from}–${to}${suffix}`;
}

// ---------------------------------------------------------------------------
// One user action -> next state + what (if anything) to emit
// ---------------------------------------------------------------------------

export interface PickerStep {
  state: PassagePickerState;
  /** True when the action changed the state at all (a no-op action must not re-render or emit). */
  changed: boolean;
  /** Set only when the EMITTED range changed: the new complete valid range, or null if it stopped being one. */
  emit?: { range: CanonicalRangeV1 | null };
}

function sameRange(a: CanonicalRangeV1 | null, b: CanonicalRangeV1 | null): boolean {
  return a === b || (a !== null && b !== null && a.start === b.start && a.end === b.end);
}

/** What the stateful wrapper does for each user action — pure so it is testable without a DOM. */
export function stepPassagePicker(
  state: PassagePickerState,
  action: PassagePickerAction,
  canon: PassageCanon,
  options: PassagePickerOptions = {},
): PickerStep {
  const next = reducePassagePicker(state, action, canon, options);
  if (next === state) return { state, changed: false };
  const before = pickerStateToRange(state, canon, options);
  const after = pickerStateToRange(next, canon, options);
  return sameRange(before, after)
    ? { state: next, changed: true }
    : { state: next, changed: true, emit: { range: after } };
}
