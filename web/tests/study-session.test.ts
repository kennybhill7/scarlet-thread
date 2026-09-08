/**
 * READCORRECT-001 / CODEX_AUDIT.md A-032 — the read-before-write gate must
 * refuse to unlock the composer when there is no actually loaded chapter
 * text to have read.
 *
 * Before this fix, `composerRenderState()` and the "I'm finished reading"
 * button gated purely on the local `readComplete` boolean that button's own
 * click set -- with zero awareness of whether `ChapterReader` actually
 * loaded any text. A reader who hit a load error (or an offline/empty
 * chapter) could still click the button and open the capture UI. The fix
 * threads a real `textAvailable` boolean from ChapterReader (see
 * tests/chapter-reader.test.ts's `hasLoadedText` coverage) into
 * StudySession, and both `composerRenderState()` and the new
 * `canFinishReading()` helper refuse while it is false.
 *
 * TEST-ENVIRONMENT NOTE (same discipline as tests/verse-selection.test.ts
 * and tests/study-composer.test.ts, read as precedent before writing this
 * file): `tsx --test tests/*.test.ts` is plain Node, no jsdom, no
 * @testing-library. Techniques used below, all against the REAL production
 * module, never a reimplementation:
 *
 *   1. `nodeRequire` + `require.cache` seeding loads the real
 *      StudySession.tsx, stubbing only its own CSS Module and its three
 *      writing-section children (DailyLoop/EntryList/NoteComposer, each with
 *      their own deep, irrelevant dependency chains -- and NoteComposer is a
 *      readOnlyPath for this task, not something to pull in for real here).
 *   2. `composerRenderState` and `canFinishReading` have no hooks, so they
 *      are called directly as plain functions to get their real return
 *      value.
 *   3. `react-dom/server`'s `renderToStaticMarkup`, via `createElement`
 *      (this file is `.test.ts`, not `.tsx`), renders the real
 *      `StudySession` at its initial mount (React's SSR hooks dispatcher
 *      makes `useState`'s initial values render correctly) for the
 *      disabled-button / hint-copy structural assertions.
 *
 * RESIDUAL GAP (disclosed, not hidden — same shape as tests/study-entry.test.ts
 * / tests/study-composer.test.ts's own "RESIDUAL GAP" sections): `finishReading`
 * lives inside a `useState` closure and only ever runs from a real click, so
 * it cannot be invoked directly here, and SSR only ever observes the
 * INITIAL (readComplete=false) render -- there is no way in this harness to
 * drive readComplete to true and observe the composer actually open. What IS
 * proved: `canFinishReading()` -- the exact boolean both the button's
 * `disabled` prop and finishReading()'s own guard read from (readable
 * directly in StudySession.tsx) -- refuses whenever textAvailable is false,
 * regardless of marking state; `composerRenderState()` -- the exact function
 * the render body calls for what the composer receives -- never returns
 * visible:true while textAvailable is false, even with readComplete forced
 * true; and the real rendered button is genuinely `disabled` (a browser
 * cannot fire its onClick at all) at initial mount whenever textAvailable is
 * false. Closing the remaining gap (actually clicking through to an open
 * composer) needs jsdom/@testing-library added to package.json, outside this
 * task's ownedPaths.
 */
import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
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

seedModule("@/components/notes/study-session.module.css", { default: cssProxy });
seedModule("@/components/notes/DailyLoop", { DailyLoop: () => null });
seedModule("@/components/notes/EntryList", { EntryList: () => null });
seedModule("@/components/notes/NoteComposer", { NoteComposer: () => null });

const studySessionModule = nodeRequire("@/components/notes/StudySession.tsx") as {
  composerRenderState: (
    readComplete: boolean,
    chapter: string,
    selectedVerse: string | null | undefined,
    textAvailable?: boolean,
  ) => { visible: false } | { visible: true; chapter: string; verse: string | undefined };
  canFinishReading: (marking: boolean, textAvailable: boolean) => boolean;
  StudySession: (props: {
    chapter: string;
    selectedVerse?: string | null;
    textAvailable: boolean;
    children?: unknown;
  }) => unknown;
};
const { composerRenderState, canFinishReading, StudySession } = studySessionModule;

// ===========================================================================
// 1. canFinishReading — the exact predicate the button's `disabled` prop and
//    finishReading()'s own guard both read from.
// ===========================================================================

test("canFinishReading: allowed when not marking and text is available", () => {
  assert.equal(canFinishReading(false, true), true);
});

test("MUTATION-TARGET A-032: canFinishReading refuses when textAvailable is false, even though not marking", () => {
  assert.equal(canFinishReading(false, false), false);
});

test("canFinishReading: refuses while a mark is already in flight, even with text available", () => {
  assert.equal(canFinishReading(true, true), false);
});

test("canFinishReading: refuses when both marking and textAvailable are false", () => {
  assert.equal(canFinishReading(true, false), false);
});

// ===========================================================================
// 2. composerRenderState — the read-before-write gate, now textAvailable-aware.
// ===========================================================================

test("GATE (pre-existing, unweakened): reading not yet finished never opens the composer", () => {
  assert.deepEqual(composerRenderState(false, "1.3", "1.3.15", true), { visible: false });
});

test("GATE (pre-existing, unweakened): finishing reading with text available opens the composer, threading the selected verse", () => {
  assert.deepEqual(composerRenderState(true, "1.3", "1.3.15", true), {
    visible: true,
    chapter: "1.3",
    verse: "1.3.15",
  });
});

test("MUTATION-TARGET A-032: readComplete=true is NOT enough on its own — textAvailable=false must still refuse to open the composer", () => {
  assert.deepEqual(
    composerRenderState(true, "1.3", "1.3.15", false),
    { visible: false },
    "a reader who hit a load error must not be able to mark a chapter read and open capture with nothing actually read",
  );
});

test("composerRenderState: textAvailable=false refuses even chapter-level capture (no verse selected)", () => {
  assert.deepEqual(composerRenderState(true, "1.3", null, false), { visible: false });
});

test("BACK-COMPAT: composerRenderState called with only 3 arguments (tests/verse-selection.test.ts's own call shape, out of this task's owned paths) behaves exactly as it did before this fix", () => {
  assert.deepEqual(composerRenderState(true, "1.3", "1.3.15"), {
    visible: true,
    chapter: "1.3",
    verse: "1.3.15",
  });
  assert.deepEqual(composerRenderState(false, "1.3", "1.3.15"), { visible: false });
  const state = composerRenderState(true, "1.3", null);
  assert.equal(state.visible, true);
  assert.ok(state.visible && state.verse === undefined);
});

// ===========================================================================
// 3. RENDER — the real StudySession component, initial (readComplete=false)
//    mount, for both textAvailable values.
// ===========================================================================

function renderInitial(textAvailable: boolean) {
  return renderToStaticMarkup(
    createElement(
      StudySession as never,
      { chapter: "1.3", selectedVerse: null, textAvailable },
      createElement("p", null, "chapter body placeholder"),
    ),
  );
}

test("RENDER: the finish-reading button is a real, ENABLED <button> when text is available", () => {
  const html = renderInitial(true);
  const buttonMatch = /<button([^>]*)>\s*I.m finished reading\s*<\/button>/.exec(html);
  assert.ok(buttonMatch, `finish-reading button not found:\n${html}`);
  assert.doesNotMatch(buttonMatch![1], /disabled/, `button should not be disabled when textAvailable is true:\n${html}`);
});

test("MUTATION-TARGET A-032 RENDER: the finish-reading button is DISABLED at mount when textAvailable is false, before any click is possible", () => {
  const html = renderInitial(false);
  const buttonMatch = /<button([^>]*)>\s*I.m finished reading\s*<\/button>/.exec(html);
  assert.ok(buttonMatch, `finish-reading button not found:\n${html}`);
  assert.match(
    buttonMatch![1],
    /disabled/,
    `a browser cannot fire onClick on a disabled <button> -- this is the actual mechanism that blocks finishReading() from running:\n${html}`,
  );
});

test("RENDER: an honest hint explains WHY the button is disabled when textAvailable is false", () => {
  const html = renderInitial(false);
  assert.match(html, /hasn.t loaded yet/, `no explanatory hint rendered for the disabled state:\n${html}`);
});

test("RENDER: no disabled-state hint is shown once text is available", () => {
  const html = renderInitial(true);
  assert.doesNotMatch(html, /hasn.t loaded yet/);
});

test("RENDER: the writing/composer section is empty at initial mount regardless of textAvailable (readComplete starts false either way)", () => {
  for (const textAvailable of [true, false]) {
    const html = renderInitial(textAvailable);
    assert.doesNotMatch(
      html,
      /data-open="true"/,
      `composer section should not be open before any click, textAvailable=${textAvailable}:\n${html}`,
    );
  }
});
