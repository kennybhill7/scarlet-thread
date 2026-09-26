/**
 * PICKERLIB-001 (contract C3) — components/ui/PassagePicker.tsx and
 * lib/bible/passagePickerState.ts.
 *
 * TEST-ENVIRONMENT NOTE (same discipline as tests/covenant-timeline-strip.test.ts):
 * plain Node, no jsdom, so the .module.css is neutralised in require.cache and
 * the hookless `PassagePickerView` is rendered with renderToStaticMarkup.
 * Event wiring is proven a second way without a DOM: `PassagePickerView` is a
 * plain function, so its returned element tree is walked and each <select>'s
 * real `onChange` prop is invoked. The state machine is tested directly.
 *
 * Two canons: a tiny synthetic one for exact boundary arithmetic, and the REAL
 * shipped BSB corpus for real verse counts and a randomised invariant run.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { BibleIndex, BookData } from "@/lib/contracts";
import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import { buildPassageCanon, toCanonTable, type PassageCanon } from "@/lib/bible/passageCanon";
import {
  EMPTY_PICKER_STATE,
  checkPickerState,
  describePickerRange,
  pickerStateToRange,
  rangeToPickerState,
  reducePassagePicker,
  stepPassagePicker,
  type PassagePickerAction,
  type PassagePickerState,
} from "@/lib/bible/passagePickerState";
import { validateCanonicalRange } from "@/lib/bible/range";

const nodeRequire = createRequire(__filename);

function seedModule(specifier: string, exports: Record<string, unknown>) {
  const resolved = nodeRequire.resolve(specifier);
  (nodeRequire.cache as Record<string, unknown>)[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    path: path.dirname(resolved),
    paths: [],
    children: [],
    exports: { __esModule: true, ...exports },
  };
}

const cssProxy = new Proxy({}, { get: (_target, key) => (typeof key === "string" ? key : undefined) });
seedModule("@/components/ui/PassagePicker.module.css", { default: cssProxy });

const pickerModule = nodeRequire("@/components/ui/PassagePicker.tsx") as typeof import(
  "@/components/ui/PassagePicker"
);
const { PassagePicker, PassagePickerView } = pickerModule;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Synthetic canon: Alpha has chapters of 3, 5, 2 verses; Beta has one chapter of 4. */
const TINY: PassageCanon = [
  { n: 1, name: "Alpha", abbr: "Al", testament: "OT", verseCounts: [3, 5, 2] },
  { n: 2, name: "Beta", abbr: "Be", testament: "NT", verseCounts: [4] },
];

const webPath = (p: string) => new URL(`../${p}`, import.meta.url);
const index: BibleIndex = JSON.parse(readFileSync(webPath("public/bible/index.json"), "utf8"));
const REAL: PassageCanon = buildPassageCanon(
  index.books,
  (n) => JSON.parse(readFileSync(webPath(`public/bible/BSB/${n}.json`), "utf8")) as BookData,
);
const realTable = toCanonTable(REAL);

function st(book: number | null, chapter: number | null, startVerse: number | null, endChapter: number | null, endVerse: number | null): PassagePickerState {
  return { book, chapter, startVerse, endChapter, endVerse };
}

function run(canon: PassageCanon, actions: PassagePickerAction[], allowCrossChapter = false, from: PassagePickerState = EMPTY_PICKER_STATE) {
  return actions.reduce((state, action) => reducePassagePicker(state, action, canon, { allowCrossChapter }), from);
}

const rng = (range: CanonicalRangeV1 | null) => (range ? `${range.start}..${range.end}` : null);

// ---------------------------------------------------------------------------
// Reducer: book
// ---------------------------------------------------------------------------

test("book: choosing a book selects only the book; changing it resets everything below", () => {
  const s1 = run(TINY, [{ type: "book", book: 1 }]);
  assert.deepEqual(s1, st(1, null, null, null, null));
  const s2 = run(TINY, [{ type: "book", book: 1 }, { type: "chapter", chapter: 2 }, { type: "book", book: 2 }]);
  assert.deepEqual(s2, st(2, null, null, null, null));
});

test("book: re-selecting the same book keeps the narrowed selection (same object back)", () => {
  const narrowed = run(TINY, [{ type: "book", book: 1 }, { type: "chapter", chapter: 2 }, { type: "startVerse", verse: 3 }]);
  assert.equal(reducePassagePicker(narrowed, { type: "book", book: 1 }, TINY), narrowed);
});

test("book: null, unknown, 0, NaN, fractional -> empty state", () => {
  for (const book of [null, 0, 3, 67, -1, Number.NaN, 1.5]) {
    const s = run(TINY, [{ type: "book", book: 1 }, { type: "chapter", chapter: 1 }, { type: "book", book }]);
    assert.deepEqual(s, EMPTY_PICKER_STATE, `book ${String(book)}`);
  }
});

// ---------------------------------------------------------------------------
// Reducer: chapter
// ---------------------------------------------------------------------------

test("chapter: selecting a chapter selects the WHOLE chapter with its real last verse", () => {
  const s = run(TINY, [{ type: "book", book: 1 }, { type: "chapter", chapter: 2 }]);
  assert.deepEqual(s, st(1, 2, 1, 2, 5));
  assert.equal(rng(pickerStateToRange(s, TINY)), "1.2.1..1.2.5");
});

test("chapter: ignored before a book is chosen", () => {
  assert.equal(reducePassagePicker(EMPTY_PICKER_STATE, { type: "chapter", chapter: 1 }, TINY), EMPTY_PICKER_STATE);
});

test("chapter: boundary clamps — 0, negative -> 1; past the end -> last chapter", () => {
  const base = run(TINY, [{ type: "book", book: 1 }]);
  assert.equal(run(TINY, [{ type: "chapter", chapter: 0 }], false, base).chapter, 1);
  assert.equal(run(TINY, [{ type: "chapter", chapter: -7 }], false, base).chapter, 1);
  assert.equal(run(TINY, [{ type: "chapter", chapter: 3 }], false, base).chapter, 3);
  assert.equal(run(TINY, [{ type: "chapter", chapter: 4 }], false, base).chapter, 3);
  assert.equal(run(TINY, [{ type: "chapter", chapter: 999 }], false, base).endVerse, 2);
});

test("chapter: null clears the chapter (keeps the book); NaN / fractional are ignored", () => {
  const s = run(TINY, [{ type: "book", book: 1 }, { type: "chapter", chapter: 2 }]);
  assert.deepEqual(reducePassagePicker(s, { type: "chapter", chapter: null }, TINY), st(1, null, null, null, null));
  assert.equal(reducePassagePicker(s, { type: "chapter", chapter: Number.NaN }, TINY), s);
  assert.equal(reducePassagePicker(s, { type: "chapter", chapter: 2.5 }, TINY), s);
});

test("chapter: re-selecting the same chapter keeps narrowed verses; a different chapter resets to whole-chapter", () => {
  const narrowed = run(TINY, [{ type: "book", book: 1 }, { type: "chapter", chapter: 2 }, { type: "startVerse", verse: 2 }, { type: "endVerse", verse: 4 }]);
  assert.deepEqual(narrowed, st(1, 2, 2, 2, 4));
  assert.equal(reducePassagePicker(narrowed, { type: "chapter", chapter: 2 }, TINY), narrowed);
  assert.deepEqual(reducePassagePicker(narrowed, { type: "chapter", chapter: 3 }, TINY), st(1, 3, 1, 3, 2));
});

// ---------------------------------------------------------------------------
// Reducer: verses (clamps + ordering)
// ---------------------------------------------------------------------------

const CH2 = st(1, 2, 1, 2, 5); // Alpha 2:1-5

test("startVerse: clamps 0 / negative -> 1 and past-the-end -> last verse", () => {
  assert.equal(reducePassagePicker(CH2, { type: "startVerse", verse: 0 }, TINY).startVerse, 1);
  assert.equal(reducePassagePicker(CH2, { type: "startVerse", verse: -3 }, TINY).startVerse, 1);
  assert.equal(reducePassagePicker(CH2, { type: "startVerse", verse: 5 }, TINY).startVerse, 5);
  assert.equal(reducePassagePicker(CH2, { type: "startVerse", verse: 6 }, TINY).startVerse, 5);
  assert.equal(reducePassagePicker(CH2, { type: "startVerse", verse: 10_000 }, TINY).startVerse, 5);
});

test("startVerse: raising the start past the end pulls the end up to the start; lowering leaves the end", () => {
  const narrowed = run(TINY, [{ type: "startVerse", verse: 2 }, { type: "endVerse", verse: 3 }], false, CH2);
  assert.deepEqual(narrowed, st(1, 2, 2, 2, 3));
  assert.deepEqual(reducePassagePicker(narrowed, { type: "startVerse", verse: 4 }, TINY), st(1, 2, 4, 2, 4));
  assert.deepEqual(reducePassagePicker(narrowed, { type: "startVerse", verse: 1 }, TINY), st(1, 2, 1, 2, 3));
  assert.deepEqual(reducePassagePicker(narrowed, { type: "startVerse", verse: 3 }, TINY), st(1, 2, 3, 2, 3)); // equal is legal
});

test("endVerse: end below start clamps UP to the start; past the end clamps to the last verse", () => {
  const s = run(TINY, [{ type: "startVerse", verse: 3 }], false, CH2);
  assert.equal(reducePassagePicker(s, { type: "endVerse", verse: 1 }, TINY).endVerse, 3);
  assert.equal(reducePassagePicker(s, { type: "endVerse", verse: 0 }, TINY).endVerse, 3);
  assert.equal(reducePassagePicker(s, { type: "endVerse", verse: -9 }, TINY).endVerse, 3);
  assert.equal(reducePassagePicker(s, { type: "endVerse", verse: 3 }, TINY).endVerse, 3);
  assert.equal(reducePassagePicker(s, { type: "endVerse", verse: 5 }, TINY).endVerse, 5);
  assert.equal(reducePassagePicker(s, { type: "endVerse", verse: 6 }, TINY).endVerse, 5);
  assert.equal(reducePassagePicker(s, { type: "endVerse", verse: 1e9 }, TINY).endVerse, 5);
});

test("verses: null / NaN / fractional / Infinity input is ignored (same object back)", () => {
  for (const type of ["startVerse", "endVerse"] as const) {
    for (const verse of [null, Number.NaN, 2.5, Number.POSITIVE_INFINITY]) {
      assert.equal(reducePassagePicker(CH2, { type, verse }, TINY), CH2, `${type} ${String(verse)}`);
    }
  }
});

test("verses: ignored until a chapter is chosen", () => {
  const bookOnly = st(1, null, null, null, null);
  assert.equal(reducePassagePicker(bookOnly, { type: "startVerse", verse: 1 }, TINY), bookOnly);
  assert.equal(reducePassagePicker(bookOnly, { type: "endVerse", verse: 1 }, TINY), bookOnly);
  assert.equal(reducePassagePicker(EMPTY_PICKER_STATE, { type: "startVerse", verse: 1 }, TINY), EMPTY_PICKER_STATE);
});

test("single verse: start == end is valid and emits start === end", () => {
  const s = run(TINY, [{ type: "startVerse", verse: 3 }, { type: "endVerse", verse: 3 }], false, CH2);
  assert.equal(rng(pickerStateToRange(s, TINY)), "1.2.3..1.2.3");
});

// ---------------------------------------------------------------------------
// Reducer: cross-chapter
// ---------------------------------------------------------------------------

test("endChapter: ignored unless allowCrossChapter", () => {
  assert.equal(reducePassagePicker(CH2, { type: "endChapter", chapter: 3 }, TINY), CH2);
  assert.equal(reducePassagePicker(CH2, { type: "endChapter", chapter: 3 }, TINY, { allowCrossChapter: false }), CH2);
});

test("endChapter (allowed): moves the end to that chapter's real last verse; clamps between start chapter and last chapter", () => {
  const s = run(TINY, [{ type: "endChapter", chapter: 3 }], true, CH2);
  assert.deepEqual(s, st(1, 2, 1, 3, 2));
  assert.equal(run(TINY, [{ type: "endChapter", chapter: 99 }], true, CH2).endChapter, 3);
  assert.equal(run(TINY, [{ type: "endChapter", chapter: 1 }], true, CH2).endChapter, 2, "cannot precede the start chapter");
  assert.equal(run(TINY, [{ type: "endChapter", chapter: 0 }], true, CH2).endChapter, 2);
  assert.equal(run(TINY, [{ type: "endChapter", chapter: -4 }], true, CH2).endChapter, 2);
  assert.equal(run(TINY, [{ type: "endChapter", chapter: Number.NaN }], true, CH2), CH2);
});

test("cross-chapter: end verse floor is 1 in a later chapter, but the start verse in the same chapter", () => {
  const cross = run(TINY, [{ type: "startVerse", verse: 4 }, { type: "endChapter", chapter: 3 }, { type: "endVerse", verse: 1 }], true, CH2);
  assert.deepEqual(cross, st(1, 2, 4, 3, 1), "Alpha 2:4-3:1 is legal");
  assert.equal(rng(pickerStateToRange(cross, TINY, { allowCrossChapter: true })), "1.2.4..1.3.1");
  // Back to the same chapter: end returns to that chapter's last verse, >= start.
  const back = run(TINY, [{ type: "endChapter", chapter: 2 }], true, cross);
  assert.deepEqual(back, st(1, 2, 4, 2, 5));
});

test("cross-chapter: raising the start verse does not disturb an end in a later chapter", () => {
  const cross = st(1, 1, 1, 2, 3);
  assert.deepEqual(reducePassagePicker(cross, { type: "startVerse", verse: 3 }, TINY, { allowCrossChapter: true }), st(1, 1, 3, 2, 3));
});

test("cross-chapter: changing the start chapter resets to that whole chapter", () => {
  const cross = st(1, 1, 2, 3, 1);
  assert.deepEqual(reducePassagePicker(cross, { type: "chapter", chapter: 2 }, TINY, { allowCrossChapter: true }), st(1, 2, 1, 2, 5));
});

// ---------------------------------------------------------------------------
// checkPickerState — independent validation
// ---------------------------------------------------------------------------

test("check: empty / incomplete / valid", () => {
  assert.deepEqual(checkPickerState(EMPTY_PICKER_STATE, TINY), { status: "empty" });
  assert.equal(checkPickerState(st(1, null, null, null, null), TINY).status, "incomplete");
  assert.equal(checkPickerState(st(1, 2, null, 2, null), TINY).status, "incomplete");
  const ok = checkPickerState(CH2, TINY);
  assert.equal(ok.status, "valid");
  assert.equal(ok.status === "valid" ? rng(ok.range) : null, "1.2.1..1.2.5");
});

const INVALID_CASES: ReadonlyArray<readonly [string, PassagePickerState, string, boolean?]> = [
  ["unknown book", st(9, 1, 1, 1, 1), "book"],
  ["chapter 0", st(1, 0, 1, 0, 1), "chapter"],
  ["chapter past the end", st(1, 4, 1, 4, 1), "chapter"],
  ["fractional chapter", st(1, 1.5, 1, 1.5, 1), "chapter"],
  ["start verse 0", st(1, 2, 0, 2, 3), "startVerse"],
  ["start verse past the end", st(1, 2, 6, 2, 6), "startVerse"],
  ["end verse 0", st(1, 2, 1, 2, 0), "endVerse"],
  ["end verse past the end", st(1, 2, 1, 2, 6), "endVerse"],
  ["REVERSED same chapter", st(1, 2, 4, 2, 2), "endVerse"],
  ["end chapter before start chapter", st(1, 2, 1, 1, 1), "endChapter", true],
  ["end chapter past the end", st(1, 2, 1, 4, 1), "endChapter", true],
  ["cross-chapter when not allowed", st(1, 1, 1, 2, 1), "endChapter", false],
];
for (const [name, state, field, allow] of INVALID_CASES) {
  test(`check: invalid — ${name}`, () => {
    const result = checkPickerState(state, TINY, { allowCrossChapter: allow ?? false });
    assert.equal(result.status, "invalid");
    assert.equal(result.status === "invalid" ? result.field : null, field);
    assert.equal(pickerStateToRange(state, TINY, { allowCrossChapter: allow ?? false }), null);
  });
}

test("check: cross-chapter is valid when allowed", () => {
  assert.equal(rng(pickerStateToRange(st(1, 1, 2, 2, 3), TINY, { allowCrossChapter: true })), "1.1.2..1.2.3");
});

// ---------------------------------------------------------------------------
// Range <-> state, and real-corpus behaviour
// ---------------------------------------------------------------------------

test("REAL corpus: Genesis 3 is the whole chapter 1.3.1..1.3.24 and validates against range.ts", () => {
  const s = run(REAL, [{ type: "book", book: 1 }, { type: "chapter", chapter: 3 }]);
  const range = pickerStateToRange(s, REAL);
  assert.equal(rng(range), "1.3.1..1.3.24");
  assert.deepEqual(validateCanonicalRange(range!, realTable), { ok: true });
  assert.equal(range!.versificationId, CANONICAL_VERSIFICATION_ID);
});

test("REAL corpus: Psalm 119 (176 verses) and a past-the-end clamp", () => {
  const s = run(REAL, [{ type: "book", book: 19 }, { type: "chapter", chapter: 119 }, { type: "startVerse", verse: 500 }]);
  assert.deepEqual(s, st(19, 119, 176, 119, 176));
  assert.equal(run(REAL, [{ type: "book", book: 19 }, { type: "chapter", chapter: 5000 }]).chapter, 150);
});

test("REAL corpus: 3 John chapter 1 ends at verse 14 (BSB), never 15", () => {
  const s = run(REAL, [{ type: "book", book: 64 }, { type: "chapter", chapter: 1 }]);
  assert.equal(s.endVerse, 14);
  assert.equal(reducePassagePicker(s, { type: "endVerse", verse: 15 }, REAL).endVerse, 14);
});

test("rangeToPickerState: round-trips single, whole-chapter, and cross-chapter ranges; rejects invalid ones", () => {
  for (const [start, end] of [["1.3.15", "1.3.15"], ["1.3.1", "1.3.24"], ["1.1.1", "1.2.3"], ["66.22.21", "66.22.21"]]) {
    const range: CanonicalRangeV1 = { versificationId: CANONICAL_VERSIFICATION_ID, start, end };
    const state = rangeToPickerState(range, REAL);
    assert.ok(state, `${start}-${end}`);
    assert.deepEqual(pickerStateToRange(state, REAL, { allowCrossChapter: true }), range);
  }
  const bad = (start: string, end: string): CanonicalRangeV1 => ({ versificationId: CANONICAL_VERSIFICATION_ID, start, end });
  assert.equal(rangeToPickerState(bad("1.3.24", "1.3.1"), REAL), null, "reversed");
  assert.equal(rangeToPickerState(bad("1.3.1", "2.1.1"), REAL), null, "cross-book");
  assert.equal(rangeToPickerState(bad("1.3.1", "1.3.25"), REAL), null, "past the end");
  assert.equal(rangeToPickerState(bad("3.1.1", "1.1.1x"), REAL), null, "malformed");
});

test("describePickerRange: single verse, span, whole chapter, cross-chapter", () => {
  const d = (start: string, end: string) => describePickerRange({ versificationId: CANONICAL_VERSIFICATION_ID, start, end }, REAL);
  assert.equal(d("45.5.12", "45.5.12"), "Romans 5:12");
  assert.equal(d("45.5.12", "45.5.21"), "Romans 5:12–21");
  assert.equal(d("1.3.1", "1.3.24"), "Genesis 3:1–24 (whole chapter)");
  assert.equal(d("1.1.1", "1.2.3"), "Genesis 1:1–2:3");
  assert.equal(d("99.1.1", "99.1.1"), null);
});

test("INVARIANT (real corpus, 20000 seeded random actions incl. hostile numbers): the reducer never yields an invalid state", () => {
  let seed = 0x9e3779b9;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const hostile = [0, -1, -1000, 1, 2, 3, 24, 25, 31, 32, 50, 66, 67, 119, 150, 176, 177, 1e9, Number.NaN, 2.5, null];
  const pick = () => {
    const r = next();
    return r < 0.5 ? hostile[Math.floor(next() * hostile.length)] : Math.floor(next() * 200) - 10;
  };
  const types = ["book", "chapter", "startVerse", "endChapter", "endVerse"] as const;
  for (const allowCrossChapter of [false, true]) {
    let state = EMPTY_PICKER_STATE;
    for (let i = 0; i < 10_000; i += 1) {
      const type = types[Math.floor(next() * types.length)];
      const value = pick() as number | null;
      const action: PassagePickerAction =
        type === "book" ? { type, book: value } : type === "chapter" || type === "endChapter" ? { type, chapter: value } : { type, verse: value };
      state = reducePassagePicker(state, action, REAL, { allowCrossChapter });
      const check = checkPickerState(state, REAL, { allowCrossChapter });
      assert.notEqual(check.status, "invalid", `${JSON.stringify(action)} -> ${JSON.stringify(state)}: ${JSON.stringify(check)}`);
      if (check.status === "valid") {
        assert.deepEqual(validateCanonicalRange(check.range, realTable), { ok: true });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// stepPassagePicker — what the stateful wrapper does per action
// ---------------------------------------------------------------------------

test("step: emits the new range only when the emitted range actually changes", () => {
  let step = stepPassagePicker(EMPTY_PICKER_STATE, { type: "book", book: 1 }, TINY);
  assert.equal(step.changed, true);
  assert.equal(step.emit, undefined, "book alone is not a range and was not one before");

  step = stepPassagePicker(step.state, { type: "chapter", chapter: 2 }, TINY);
  assert.equal(rng(step.emit!.range), "1.2.1..1.2.5");

  const same = stepPassagePicker(step.state, { type: "chapter", chapter: 2 }, TINY);
  assert.equal(same.changed, false);
  assert.equal(same.emit, undefined);

  const narrowed = stepPassagePicker(step.state, { type: "endVerse", verse: 3 }, TINY);
  assert.equal(rng(narrowed.emit!.range), "1.2.1..1.2.3");

  const cleared = stepPassagePicker(narrowed.state, { type: "chapter", chapter: null }, TINY);
  assert.deepEqual(cleared.emit, { range: null }, "a previously valid range that stops being one emits null");

  const noop = stepPassagePicker(narrowed.state, { type: "startVerse", verse: Number.NaN }, TINY);
  assert.equal(noop.changed, false);
});

// ---------------------------------------------------------------------------
// View: markup
// ---------------------------------------------------------------------------

const ID = "pp";
const html = (props: Partial<Parameters<typeof PassagePickerView>[0]> = {}) =>
  renderToStaticMarkup(createElement(PassagePickerView, { idPrefix: ID, canon: REAL, state: EMPTY_PICKER_STATE, ...props }));

function selectOf(markup: string, id: string): { attrs: string; body: string } {
  const match = new RegExp(`<select\\b([^>]*\\bid="${id}"[^>]*)>([\\s\\S]*?)</select>`).exec(markup);
  assert.ok(match, `select #${id} missing in:\n${markup}`);
  return { attrs: match[1], body: match[2] };
}
const optionValues = (body: string) => [...body.matchAll(/<option[^>]*value="([^"]*)"/g)].map((m) => m[1]);

test("VIEW: every control has a real <label for> that matches a native <select id>, inside a fieldset with a legend", () => {
  const markup = html({ allowCrossChapter: true });
  assert.match(markup, /^<fieldset\b/);
  assert.match(markup, /<legend[^>]*>Passage<\/legend>/);
  const controls: Array<[string, string]> = [
    ["pp-book", "Book"],
    ["pp-chapter", "Chapter"],
    ["pp-start-verse", "From verse"],
    ["pp-end-chapter", "To chapter"],
    ["pp-end-verse", "To verse"],
  ];
  for (const [id, text] of controls) {
    assert.match(markup, new RegExp(`<label[^>]*\\bfor="${id}"[^>]*>${text}</label>`), `label for ${id}`);
    selectOf(markup, id);
  }
  assert.equal((markup.match(/<select\b/g) ?? []).length, 5);
  assert.equal((markup.match(/<label\b/g) ?? []).length, 5);
  assert.doesNotMatch(markup, /<input\b/, "no free-text inputs");
});

test("VIEW: the end-chapter select exists only when cross-chapter is allowed; custom legend", () => {
  assert.doesNotMatch(html(), /pp-end-chapter/);
  assert.match(html({ allowCrossChapter: true }), /pp-end-chapter/);
  assert.match(html({ label: "Other passage" }), /<legend[^>]*>Other passage<\/legend>/);
});

test("VIEW: empty state — book enabled; chapter, verses disabled; status hint; no alert, no aria-invalid", () => {
  const markup = html({ allowCrossChapter: true });
  assert.doesNotMatch(selectOf(markup, "pp-book").attrs, /disabled/);
  for (const id of ["pp-chapter", "pp-start-verse", "pp-end-chapter", "pp-end-verse"]) {
    assert.match(selectOf(markup, id).attrs, /disabled=""/, id);
  }
  assert.match(markup, /<p id="pp-status" role="status" aria-live="polite"[^>]*>Choose a book, then a chapter, then the verses\.<\/p>/);
  assert.doesNotMatch(markup, /role="alert"/);
  assert.doesNotMatch(markup, /aria-invalid/);
});

test("VIEW: book select lists all 66 books under OT/NT groups, in canonical order, plus a placeholder", () => {
  const { body } = selectOf(html(), "pp-book");
  assert.deepEqual(optionValues(body), ["", ...Array.from({ length: 66 }, (_, i) => String(i + 1))]);
  assert.match(body, /<optgroup label="Old Testament">/);
  assert.match(body, /<optgroup label="New Testament">/);
  assert.match(body, /<option value="1">Genesis<\/option>/);
  assert.match(body, /<option value="66">Revelation<\/option>/);
});

test("VIEW: Genesis 3 selected — real option counts (50 chapters, 24 verses), whole chapter selected, live summary", () => {
  const state = run(REAL, [{ type: "book", book: 1 }, { type: "chapter", chapter: 3 }]);
  const markup = html({ state });
  assert.match(selectOf(markup, "pp-book").body, /<option value="1" selected="">Genesis<\/option>/);
  const chapter = selectOf(markup, "pp-chapter");
  assert.doesNotMatch(chapter.attrs, /disabled/);
  assert.equal(optionValues(chapter.body).length, 1 + 50);
  assert.match(chapter.body, /<option value="3" selected="">3<\/option>/);
  const start = selectOf(markup, "pp-start-verse");
  assert.deepEqual(optionValues(start.body), Array.from({ length: 24 }, (_, i) => String(i + 1)));
  assert.match(start.body, /<option value="1" selected="">1<\/option>/);
  const end = selectOf(markup, "pp-end-verse");
  assert.equal(optionValues(end.body).length, 24);
  assert.match(end.body, /<option value="24" selected="">24<\/option>/);
  assert.match(markup, /role="status"[^>]*>Genesis 3:1–24 \(whole chapter\)<\/p>/);
  assert.doesNotMatch(markup, /aria-invalid|role="alert"/);
});

test("VIEW: end-verse options never offer a value before the start (same chapter); cross-chapter offers all", () => {
  const same = run(REAL, [{ type: "book", book: 1 }, { type: "chapter", chapter: 3 }, { type: "startVerse", verse: 10 }]);
  assert.deepEqual(
    optionValues(selectOf(html({ state: same }), "pp-end-verse").body),
    Array.from({ length: 15 }, (_, i) => String(i + 10)),
  );
  const cross = run(REAL, [{ type: "book", book: 1 }, { type: "chapter", chapter: 1 }, { type: "startVerse", verse: 10 }, { type: "endChapter", chapter: 2 }], true);
  const markup = html({ state: cross, allowCrossChapter: true });
  assert.equal(optionValues(selectOf(markup, "pp-end-verse").body).length, 25, "Genesis 2 has 25 verses, all offered");
  assert.deepEqual(optionValues(selectOf(markup, "pp-end-chapter").body).slice(0, 3), ["1", "2", "3"]);
  assert.equal(optionValues(selectOf(markup, "pp-end-chapter").body).length, 50);
  assert.match(markup, /Genesis 1:10–2:25/);
});

test("VIEW: incomplete (book only) — chapter enabled, verses disabled, hint says choose a chapter, not invalid", () => {
  const markup = html({ state: st(1, null, null, null, null) });
  assert.doesNotMatch(selectOf(markup, "pp-chapter").attrs, /disabled/);
  assert.match(selectOf(markup, "pp-start-verse").attrs, /disabled=""/);
  assert.match(markup, /role="status"[^>]*>Choose a chapter\.<\/p>/);
  assert.doesNotMatch(markup, /aria-invalid|role="alert"/);
});

test("VIEW: invalid (reversed range) — aria-invalid on the failing select only, describedby -> the alert, alert text present", () => {
  const markup = html({ state: st(1, 3, 20, 3, 5) });
  const end = selectOf(markup, "pp-end-verse");
  assert.match(end.attrs, /aria-invalid="true"/);
  assert.match(end.attrs, /aria-describedby="pp-error pp-status"/);
  for (const id of ["pp-book", "pp-chapter", "pp-start-verse"]) {
    const { attrs } = selectOf(markup, id);
    assert.doesNotMatch(attrs, /aria-invalid/, id);
    assert.match(attrs, /aria-describedby="pp-status"/, id);
  }
  assert.match(markup, /<p id="pp-error" role="alert"[^>]*>The end verse cannot come before the start verse\.<\/p>/);
  // The out-of-order value is still displayed (never silently swapped for a valid-looking one).
  assert.match(end.body, /<option value="5" selected="">5<\/option>/);
});

test("VIEW: invalid out-of-canon verse — 99 shown as the (invalid) selection, alert names the real limit", () => {
  const markup = html({ state: st(1, 3, 1, 3, 99) });
  assert.match(selectOf(markup, "pp-end-verse").attrs, /aria-invalid="true"/);
  assert.match(selectOf(markup, "pp-end-verse").body, /<option value="99" selected="">99<\/option>/);
  assert.match(markup, /End verse must be between 1 and 24\./);
});

test("VIEW: each invalid field maps to its own control", () => {
  const cases: Array<[PassagePickerState, string, boolean]> = [
    [st(1, 51, 1, 51, 1), "pp-chapter", false],
    [st(1, 3, 25, 3, 25), "pp-start-verse", false],
    [st(1, 3, 1, 2, 1), "pp-end-chapter", true],
    [st(1, 1, 1, 2, 1), "pp-end-chapter", false], // not allowed -> flagged, but select absent...
  ];
  for (const [state, id, allow] of cases.slice(0, 3)) {
    const markup = html({ state, allowCrossChapter: allow });
    assert.match(selectOf(markup, id).attrs, /aria-invalid="true"/, id);
    assert.equal((markup.match(/aria-invalid/g) ?? []).length, 1, `exactly one control is invalid for ${id}`);
  }
  // When cross-chapter isn't offered the alert still names the problem (no select to mark).
  const noSelect = html({ state: cases[3][0], allowCrossChapter: false });
  assert.match(noSelect, /role="alert"[^>]*>This picker only accepts a passage within one chapter\./);
});

test("VIEW: parent-supplied error is announced and marks the first control that needs attention", () => {
  const empty = html({ error: "Choose a passage." });
  assert.match(selectOf(empty, "pp-book").attrs, /aria-invalid="true"/);
  assert.match(empty, /role="alert"[^>]*>Choose a passage\.<\/p>/);
  const bookOnly = html({ error: "Choose a passage.", state: st(1, null, null, null, null) });
  assert.match(selectOf(bookOnly, "pp-chapter").attrs, /aria-invalid="true"/);
  assert.doesNotMatch(selectOf(bookOnly, "pp-book").attrs, /aria-invalid/);
});

test("VIEW: disabled disables the fieldset and every select", () => {
  const state = run(REAL, [{ type: "book", book: 1 }, { type: "chapter", chapter: 3 }]);
  const markup = html({ state, disabled: true, allowCrossChapter: true });
  assert.match(markup, /^<fieldset[^>]*\bdisabled=""/);
  for (const id of ["pp-book", "pp-chapter", "pp-start-verse", "pp-end-chapter", "pp-end-verse"]) {
    assert.match(selectOf(markup, id).attrs, /disabled=""/, id);
  }
});

test("VIEW: control ids are all derived from idPrefix, unique, and every aria-describedby id exists", () => {
  const markup = html({ idPrefix: "x1", state: st(1, 3, 20, 3, 5), allowCrossChapter: true });
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "ids unique");
  assert.ok(ids.every((id) => id.startsWith("x1-")));
  for (const m of markup.matchAll(/aria-describedby="([^"]+)"/g)) {
    for (const ref of m[1].split(" ")) assert.ok(ids.includes(ref), `describedby target ${ref} exists`);
  }
  // Two pickers on one page don't collide.
  const other = html({ idPrefix: "x2" });
  assert.equal(ids.filter((id) => other.includes(`id="${id}"`)).length, 0);
});

test("VIEW: only design tokens / class names — no inline colours, and 44px touch target + focus + invalid styles exist in the CSS", () => {
  const markup = html({ state: st(1, 3, 1, 3, 99) });
  assert.doesNotMatch(markup, /style=/);
  const css = readFileSync(webPath("components/ui/PassagePicker.module.css"), "utf8");
  assert.match(css, /\.select\s*{[^}]*min-height:\s*44px/);
  assert.match(css, /\.select:focus-visible\s*{[^}]*outline:\s*2px solid var\(--gold\)/);
  assert.match(css, /\.select\[aria-invalid="true"\]/);
  assert.match(css, /\.select:disabled/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-fA-F]{3,8}\b/, "no hardcoded hex colours — tokens only");
  const globals = readFileSync(webPath("app/globals.css"), "utf8");
  for (const token of ["--gold", "--crimson", "--shell-crimson-text", "--page-card-alt", "--shell-surface", "--r-md"]) {
    assert.ok(globals.includes(`${token}:`), `${token} defined in globals.css`);
  }
});

// ---------------------------------------------------------------------------
// View: event wiring (walk the element tree, invoke the real onChange props)
// ---------------------------------------------------------------------------

function findSelects(node: ReactNode, out: Map<string, ReactElement<Record<string, unknown>>> = new Map()) {
  if (Array.isArray(node)) node.forEach((child) => findSelects(child, out));
  else if (isValidElement(node)) {
    const props = node.props as Record<string, unknown>;
    if (node.type === "select" && typeof props.id === "string") out.set(props.id, node as ReactElement<Record<string, unknown>>);
    findSelects(props.children as ReactNode, out);
  }
  return out;
}

test("VIEW wiring: each select's onChange dispatches the right action with a parsed number (or null for the placeholder)", () => {
  const actions: PassagePickerAction[] = [];
  const tree = PassagePickerView({
    idPrefix: ID,
    canon: REAL,
    state: run(REAL, [{ type: "book", book: 1 }, { type: "chapter", chapter: 3 }]),
    allowCrossChapter: true,
    onAction: (a) => actions.push(a),
  });
  const selects = findSelects(tree);
  assert.deepEqual([...selects.keys()].sort(), ["pp-book", "pp-chapter", "pp-end-chapter", "pp-end-verse", "pp-start-verse"]);
  const fire = (id: string, value: string) =>
    (selects.get(id)!.props.onChange as (e: { currentTarget: { value: string } }) => void)({ currentTarget: { value } });
  fire("pp-book", "43");
  fire("pp-book", "");
  fire("pp-chapter", "7");
  fire("pp-chapter", "");
  fire("pp-start-verse", "12");
  fire("pp-end-chapter", "4");
  fire("pp-end-verse", "20");
  assert.deepEqual(actions, [
    { type: "book", book: 43 },
    { type: "book", book: null },
    { type: "chapter", chapter: 7 },
    { type: "chapter", chapter: null },
    { type: "startVerse", verse: 12 },
    { type: "endChapter", chapter: 4 },
    { type: "endVerse", verse: 20 },
  ]);
});

test("VIEW wiring: with no onAction the picker renders and events are harmless", () => {
  const tree = PassagePickerView({ idPrefix: ID, canon: TINY, state: EMPTY_PICKER_STATE });
  const selects = findSelects(tree);
  assert.doesNotThrow(() => (selects.get("pp-book")!.props.onChange as (e: unknown) => void)({ currentTarget: { value: "1" } }));
});

// ---------------------------------------------------------------------------
// Stateful wrapper: seeding
// ---------------------------------------------------------------------------

test("WRAPPER: value seeds the initial selection (Genesis 1:1-2:3 with cross-chapter on)", () => {
  const value: CanonicalRangeV1 = { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.1.1", end: "1.2.3" };
  const markup = renderToStaticMarkup(createElement(PassagePicker, { canon: REAL, value, allowCrossChapter: true, idPrefix: "w" }));
  assert.match(markup, /Genesis 1:1–2:3/);
  assert.match(selectOf(markup, "w-end-chapter").body, /<option value="2" selected="">2<\/option>/);
  assert.match(selectOf(markup, "w-end-verse").body, /<option value="3" selected="">3<\/option>/);
});

test("WRAPPER: an invalid or out-of-canon seed starts empty rather than rendering a bogus selection", () => {
  const bad: CanonicalRangeV1 = { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.24", end: "1.3.1" };
  const markup = renderToStaticMarkup(createElement(PassagePicker, { canon: REAL, value: bad, idPrefix: "w" }));
  assert.match(markup, /Choose a book, then a chapter/);
  assert.doesNotMatch(markup, /aria-invalid/);
});

test("WRAPPER: without an explicit idPrefix it generates a unique, stable-per-instance prefix", () => {
  const a = renderToStaticMarkup(createElement(PassagePicker, { canon: TINY }));
  const bookId = /<select\b[^>]*\bid="([^"]*-book)"/.exec(a)?.[1];
  assert.ok(bookId && bookId.startsWith("passage-picker-"), bookId);
  assert.match(a, new RegExp(`<label[^>]*for="${bookId.replace(/[:]/g, "\\:")}"`));
});
