/**
 * READCORRECT-001 / CODEX_AUDIT.md A-028 and A-032.
 *
 * A-028: a verse whose text is a declared omission (the corpus builder's own
 * convention -- proved by tests/corpus.test.ts's `empty` fixture -- an
 * empty/whitespace-only string for a verse NUMBER that exists but has no
 * text in a given translation, e.g. Matthew 17:21, Acts 8:37, or the
 * relocated Romans 16:25-27 doxology's blank Spanish 16:25 slot) used to
 * render as a bare superscript verse number with silently nothing after it
 * in VerseColumn, and the parallel/Spanish pane conflated it with "still
 * loading" via a single `if (!text) return null`. This file proves the real
 * exported `isOmittedVerseText` / `OMITTED_VERSE_TEXT` / `VerseColumn`, not a
 * reimplementation, render an honest marker instead.
 *
 * A-032: `hasLoadedText` is the exact predicate ChapterReader's
 * `textAvailable` (threaded into StudySession -- see
 * tests/study-session.test.ts) is built from.
 *
 * TEST-ENVIRONMENT NOTE (same discipline as tests/verse-selection.test.ts,
 * read as precedent before writing this file): `tsx --test tests/*.test.ts`
 * is plain Node, no jsdom, no @testing-library. `VerseColumn` and
 * `hasLoadedText`/`isOmittedVerseText` have no hooks, so they are called
 * directly as plain functions to get their real return value (an actual
 * React element tree / a real boolean) -- not mocking, exactly what React
 * itself does when it renders them -- and `react-dom/server`'s
 * `renderToStaticMarkup` renders that same real element tree to real HTML
 * for the structural/copy assertions.
 *
 * RESIDUAL GAP (disclosed, not hidden — same shape as
 * tests/verse-selection.test.ts's own "RESIDUAL GAP"): the full
 * `ChapterReader` component calls `useRouter()` unconditionally, which
 * THROWS outside a real Next.js App Router context (no jsdom + router
 * provider here), so it cannot be rendered end-to-end in this suite --
 * exactly the same limitation tests/study-entry.test.ts documents for
 * `StudyEntryControl`. What IS proved: every exported helper `ChapterReader`
 * uses to build the primary column, the parallel pane, and the
 * `textAvailable` value it hands to `StudySession` -- `VerseColumn`,
 * `isOmittedVerseText`, `OMITTED_VERSE_TEXT`, `hasLoadedText` -- against
 * their real, exported implementations, for every case this task's
 * acceptance criteria describes. The two-line wiring itself
 * (`textAvailable = hasLoadedText(primaryVerses)`, then
 * `<StudySession ... textAvailable={textAvailable}>`) is directly readable
 * in ChapterReader.tsx and cited in this task's report.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

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
  return resolved;
}

const cssProxy = new Proxy({}, { get: (_target, key) => (typeof key === "string" ? key : undefined) });

// Same stub set as tests/verse-selection.test.ts's ChapterReader.tsx section:
// only CSS Modules (unparseable outside a bundler) and StudySession (its own
// enormous, separately-tested dependency graph -- see
// tests/study-session.test.ts) are stubbed. VerseColumn/isOmittedVerseText/
// OMITTED_VERSE_TEXT/hasLoadedText are plain, hookless functions with no
// other dependency, so this is the real production module.
seedModule("@/components/reader/ChapterReader.module.css", { default: cssProxy });
seedModule("@/components/reader/CovenantTimelineStrip.module.css", { default: cssProxy });
seedModule("@/components/notes/StudySession", { StudySession: () => null });
seedModule("@/components/ui/Sheet", { Sheet: () => null });
seedModule("@/components/ui/Chip", { Chip: () => null });

type VerseButtonElement = { type: string; key: string | null; props: Record<string, unknown> };
type FragmentElement = { props: { children: VerseButtonElement[] } };

type Loaded<T> = { key: string; ok: true; value: T } | { key: string; ok: false; message: string };

const chapterReaderModule = nodeRequire("@/components/reader/ChapterReader.tsx") as {
  isOmittedVerseText: (text: string) => boolean;
  OMITTED_VERSE_TEXT: string;
  hasLoadedText: (verses: string[] | null) => boolean;
  resolveSpanishVerse: (
    spanishChapters: Record<string, Loaded<string[]>>,
    toKey: string | null,
  ) => { text: string | null; error: string | null };
  VerseColumn: (props: {
    book: number;
    chapter: number;
    rows: { verse: number; text: string }[];
    selectedVerse: string | null;
    onSelectVerse: (next: string | null) => void;
  }) => FragmentElement;
};
const { isOmittedVerseText, OMITTED_VERSE_TEXT, hasLoadedText, resolveSpanishVerse, VerseColumn } =
  chapterReaderModule;

// ===========================================================================
// 1. isOmittedVerseText — matches the corpus builder's own convention
//    (tests/corpus.test.ts: `!text.trim()`), independently transcribed here.
// ===========================================================================

test("isOmittedVerseText: an empty string is a declared omission", () => {
  assert.equal(isOmittedVerseText(""), true);
});

test("isOmittedVerseText: a whitespace-only string is a declared omission", () => {
  assert.equal(isOmittedVerseText("   "), true);
  assert.equal(isOmittedVerseText("\n\t"), true);
});

test("isOmittedVerseText: real verse text is never treated as an omission", () => {
  assert.equal(isOmittedVerseText("In the beginning God created the heavens and the earth."), false);
});

test("isOmittedVerseText: text that is only whitespace around real words is NOT an omission", () => {
  assert.equal(isOmittedVerseText("  Jesus wept.  "), false);
});

// ===========================================================================
// 2. hasLoadedText — CODEX_AUDIT.md A-032's textAvailable predicate.
// ===========================================================================

test("hasLoadedText: null (still loading, or a load failure -- see the Loaded<T> union) is not available", () => {
  assert.equal(hasLoadedText(null), false);
});

test("MUTATION-TARGET A-032: hasLoadedText: a genuinely empty array is not available", () => {
  assert.equal(hasLoadedText([]), false);
});

test("hasLoadedText: a real loaded chapter (at least one verse) is available", () => {
  assert.equal(hasLoadedText(["In the beginning..."]), true);
});

test("hasLoadedText: a chapter whose only verse is itself a declared omission is still 'available' -- the text genuinely loaded, individual-verse omission is a separate, honestly-rendered concern (see VerseColumn below)", () => {
  assert.equal(hasLoadedText([""]), true);
});

// ===========================================================================
// 3. resolveSpanishVerse — CODEX_AUDIT.md A-028's other half: the parallel
//    pane must distinguish "still loading" (null) from "loaded, and this
//    edition declares no text for this verse" (""), not conflate both into
//    the same `if (!text) return null`.
// ===========================================================================

test("resolveSpanishVerse: no target key at all -> null text, no error", () => {
  assert.deepEqual(resolveSpanishVerse({}, null), { text: null, error: null });
});

test("MUTATION-TARGET A-028: resolveSpanishVerse: the target chapter has not arrived yet -> null text (still loading), distinct from a declared gap", () => {
  const result = resolveSpanishVerse({}, "45.16.25");
  assert.deepEqual(result, { text: null, error: null });
  assert.notEqual(result.text, "", "a still-loading row must never be confused with a loaded-but-empty declared gap");
});

test("resolveSpanishVerse: the target chapter failed to load -> the error message, not text", () => {
  const spanishChapters: Record<string, Loaded<string[]>> = {
    "45.16": { key: "45.16", ok: false, message: "Spanish text unavailable offline." },
  };
  assert.deepEqual(resolveSpanishVerse(spanishChapters, "45.16.25"), {
    text: null,
    error: "Spanish text unavailable offline.",
  });
});

test("MUTATION-TARGET A-028: resolveSpanishVerse: a loaded chapter whose verse is a declared omission returns text: \"\" (empty string), never null", () => {
  const spanishChapters: Record<string, Loaded<string[]>> = {
    // Index 24 = verse 25 -- the blank Spanish 16:25 slot (see tests/corpus.test.ts's SBL "empty" fixture, "45.16.25").
    "45.16": {
      key: "45.16",
      ok: true,
      value: [...Array.from({ length: 24 }, (_, i) => `verse ${i + 1} text`), ""],
    },
  };
  const result = resolveSpanishVerse(spanishChapters, "45.16.25");
  assert.equal(result.error, null);
  assert.equal(result.text, "", "a declared-omission verse in a LOADED chapter must return '', not null");
  assert.notEqual(result.text, null, "'' must be distinguishable from the still-loading null case above");
});

test("resolveSpanishVerse: a loaded chapter with real text returns that text", () => {
  const spanishChapters: Record<string, Loaded<string[]>> = {
    "45.16": { key: "45.16", ok: true, value: ["primera", "segunda"] },
  };
  assert.deepEqual(resolveSpanishVerse(spanishChapters, "45.16.2"), { text: "segunda", error: null });
});

// ===========================================================================
// 4. VerseColumn — CODEX_AUDIT.md A-028: a declared-omission row renders the
//    honest marker, never a bare verse number with silently nothing after it.
// ===========================================================================

const mixedRows = [
  { verse: 1, text: "Now the serpent was more subtil than any beast of the field." },
  { verse: 21, text: "" }, // declared omission, e.g. Matthew 17:21 in BSB/ASV
  { verse: 22, text: "   " }, // declared omission, whitespace-only variant
  { verse: 23, text: "And he begat sons and daughters." },
];

test("RENDER: a declared-omission row renders OMITTED_VERSE_TEXT, not a blank", () => {
  const element = VerseColumn({
    book: 40,
    chapter: 17,
    rows: mixedRows,
    selectedVerse: null,
    onSelectVerse: () => {},
  });
  const html = renderToStaticMarkup(element as never);

  assert.match(
    html,
    new RegExp(OMITTED_VERSE_TEXT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `omission marker not rendered:\n${html}`,
  );
});

test("MUTATION-TARGET A-028: the omitted verse's <button> is never left with a bare superscript and nothing else", () => {
  const element = VerseColumn({
    book: 40,
    chapter: 17,
    rows: mixedRows,
    selectedVerse: null,
    onSelectVerse: () => {},
  });
  const html = renderToStaticMarkup(element as never);

  const verse21Match = /<button[^>]*data-verse-key="40\.17\.21"[^>]*>([\s\S]*?)<\/button>/.exec(html);
  assert.ok(verse21Match, `verse 21's button not found:\n${html}`);
  // Must contain the marker text, not just the bare <sup>21</sup> the old
  // code produced (`{row.text}` with an empty string renders nothing).
  assert.match(
    verse21Match![1],
    /Not present in this translation/,
    `verse 21 rendered with no visible explanation of the omission:\n${verse21Match![1]}`,
  );
});

test("RENDER: real verse text renders normally, unaffected by the omission marker", () => {
  const element = VerseColumn({
    book: 40,
    chapter: 17,
    rows: mixedRows,
    selectedVerse: null,
    onSelectVerse: () => {},
  });
  const html = renderToStaticMarkup(element as never);

  assert.match(html, /Now the serpent was more subtil/, `real verse 1 text missing:\n${html}`);
  assert.match(html, /And he begat sons and daughters\./, `real verse 23 text missing:\n${html}`);
});

test("RENDER: a chapter with no omissions never shows the marker", () => {
  const element = VerseColumn({
    book: 1,
    chapter: 1,
    rows: [
      { verse: 1, text: "In the beginning God created the heavens and the earth." },
      { verse: 2, text: "And the earth was without form, and void." },
    ],
    selectedVerse: null,
    onSelectVerse: () => {},
  });
  const html = renderToStaticMarkup(element as never);
  assert.doesNotMatch(html, /Not present in this translation/);
});

test("RENDER: a whitespace-only declared omission (not just a totally empty string) also gets the marker", () => {
  const element = VerseColumn({
    book: 40,
    chapter: 17,
    rows: mixedRows,
    selectedVerse: null,
    onSelectVerse: () => {},
  });
  const html = renderToStaticMarkup(element as never);
  const verse22Match = /<button[^>]*data-verse-key="40\.17\.22"[^>]*>([\s\S]*?)<\/button>/.exec(html);
  assert.ok(verse22Match, `verse 22's button not found:\n${html}`);
  assert.match(verse22Match![1], /Not present in this translation/);
});
