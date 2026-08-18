/**
 * VERSESEL-001 — Gate 0.7: verse selection end-to-end (CODEX_AUDIT A-018).
 *
 * ChapterReader used to render verses as plain, unselectable paragraphs and
 * pass only a chapter key to StudySession, so every captured entry was
 * chapter-level even though Entry.verse and NoteComposer's `verse` prop
 * already existed. This file proves the missing wiring: a verse can be
 * picked (mouse or keyboard), it survives as a canonical RefKey through the
 * local store, the queued sync payload, schema validation, and export, and
 * none of that bypasses the existing read-before-write gate.
 *
 * TEST-ENVIRONMENT NOTE (read before extending this file): this repo's test
 * script is `tsx --test tests/*.test.ts` -- plain Node, no jsdom, no
 * @testing-library, and package.json is outside this task's owned paths, so
 * one cannot be added from here. Three techniques stand in for a browser,
 * each exercising the REAL production code, not a reimplementation:
 *
 *   1. `nodeRequire` + `require.cache` seeding (exactly the pattern already
 *      established by tests/review-setup-state.test.ts) loads the real
 *      ChapterReader.tsx / StudySession.tsx modules, stubbing out only the
 *      CSS Modules and sibling UI this file does not exercise -- so the
 *      loader itself never needs a bundler.
 *   2. `VerseColumn` and `composerRenderState` have no hooks, so they are
 *      called directly as plain functions to get their real return value
 *      (an actual React element / an actual decision object) -- this is not
 *      mocking, it is exactly what React itself does when it renders them.
 *   3. `react-dom/server`'s `renderToStaticMarkup` renders that same real
 *      element to real HTML for the ARIA/structural assertions.
 *
 * RESIDUAL GAP (disclosed, not hidden): a real `<button>`'s Enter/Space
 * activation is a browser-engine guarantee this suite cannot literally fire
 * a KeyboardEvent to prove, because there is no DOM here. What IS proved:
 * the element rendered for every verse is genuinely a `<button>` (never a
 * div/role hand-roll that could omit it), and calling the exact `onClick`
 * that button carries -- the one thing both a mouse click and a native
 * button's keyboard activation invoke -- selects the right verse. Closing
 * this gap for real needs jsdom/@testing-library added to package.json,
 * which is outside VERSESEL-001's ownedPaths; see the final report.
 */
import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { strFromU8, unzipSync } from "fflate";
import { renderToStaticMarkup } from "react-dom/server";

import type { Entry, Thread } from "@/lib/contracts";
import { syncEntrySchema } from "@/lib/api/sync";
import { chapterKey, verseKey } from "@/lib/bible/reference";
import { buildVaultArchive } from "@/lib/export/vault";

const nodeRequire = createRequire(__filename);

/** Same require.cache-seeding technique as tests/review-setup-state.test.ts. */
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

// CSS Modules resolve every requested class to its own name, same as
// review-setup-state.test.ts's cssProxy, so class hooks stay recognisable.
const cssProxy = new Proxy(
  {},
  { get: (_target, key) => (typeof key === "string" ? key : undefined) },
);

// ---------------------------------------------------------------------------
// Load the real StudySession.tsx FIRST, seeding only its CSS Module and the
// writing-section children (each has its own deep, irrelevant dependency
// chain). Order matters: "@/components/notes/StudySession" (no extension,
// as ChapterReader.tsx imports it) and "@/components/notes/StudySession.tsx"
// (as required below) resolve to the SAME absolute path, so whichever is
// cached first wins. Loading the real module here, before ChapterReader.tsx
// needs it, means ChapterReader.tsx below pulls in this same real
// StudySession (with only ITS children stubbed) rather than a second stub.
// ---------------------------------------------------------------------------
seedModule("@/components/notes/study-session.module.css", { default: cssProxy });
seedModule("@/components/notes/DailyLoop", { DailyLoop: () => null });
seedModule("@/components/notes/EntryList", { EntryList: () => null });
seedModule("@/components/notes/NoteComposer", { NoteComposer: () => null });

const studySessionModule = nodeRequire("@/components/notes/StudySession.tsx") as {
  composerRenderState: (
    readComplete: boolean,
    chapter: string,
    selectedVerse: string | null | undefined,
  ) => { visible: false } | { visible: true; chapter: string; verse: string | undefined };
};
const { composerRenderState } = studySessionModule;

// ---------------------------------------------------------------------------
// Now load the real ChapterReader.tsx, seeding only its own CSS Module and
// the sibling UI (Sheet/Chip) this file has no reason to exercise. Its
// import of StudySession resolves to the real module already cached above.
// ---------------------------------------------------------------------------
seedModule("@/components/reader/ChapterReader.module.css", { default: cssProxy });
seedModule("@/components/ui/Sheet", { Sheet: () => null });
seedModule("@/components/ui/Chip", { Chip: () => null });

type VerseButtonElement = { type: string; key: string | null; props: Record<string, unknown> };
type FragmentElement = { props: { children: VerseButtonElement[] } };

const chapterReaderModule = nodeRequire("@/components/reader/ChapterReader.tsx") as {
  nextVerseSelection: (current: string | null, candidate: string) => string | null;
  VerseColumn: (props: {
    book: number;
    chapter: number;
    rows: { verse: number; text: string }[];
    selectedVerse: string | null;
    onSelectVerse: (next: string | null) => void;
  }) => FragmentElement;
};
const { nextVerseSelection, VerseColumn } = chapterReaderModule;

// ===========================================================================
// 1. Toggle logic -- the exact function VerseColumn's onClick calls.
// ===========================================================================

test("nextVerseSelection: selecting an unselected verse selects it", () => {
  assert.equal(nextVerseSelection(null, "1.3.15"), "1.3.15");
});

test("nextVerseSelection: selecting the already-selected verse again deselects it", () => {
  assert.equal(nextVerseSelection("1.3.15", "1.3.15"), null);
});

test("nextVerseSelection: selecting a different verse switches selection rather than combining", () => {
  assert.equal(nextVerseSelection("1.3.14", "1.3.15"), "1.3.15");
});

// ===========================================================================
// 2. VerseColumn -- real element tree + real rendered markup.
// ===========================================================================

const genesisThreeRows = [
  { verse: 1, text: "Now the serpent was more subtil" },
  { verse: 14, text: "And the LORD God said unto the serpent" },
  { verse: 15, text: "And I will put enmity between thee and the woman" },
];

test("RENDER: every verse is a real <button>, keyed to its canonical book.chapter.verse RefKey", () => {
  const element = VerseColumn({
    book: 1,
    chapter: 3,
    rows: genesisThreeRows,
    selectedVerse: null,
    onSelectVerse: () => {},
  });
  const html = renderToStaticMarkup(element as never);

  assert.match(html, /<button[^>]*data-verse-key="1\.3\.1"/, `verse 1 not rendered as a button with its RefKey:\n${html}`);
  assert.match(html, /<button[^>]*data-verse-key="1\.3\.14"/, `verse 14 not rendered as a button with its RefKey:\n${html}`);
  assert.match(html, /<button[^>]*data-verse-key="1\.3\.15"/, `verse 15 not rendered as a button with its RefKey:\n${html}`);
  // Keyed off book/chapter/verse, not array position: verse 14 is index 1 in
  // the array yet must carry key "1.3.14", never "1.3.2".
  assert.doesNotMatch(html, /data-verse-key="1\.3\.2"/, `verse 14 (array index 1) leaked a loop-index-derived key:\n${html}`);
});

test("RENDER: no verse is aria-pressed when nothing is selected", () => {
  const element = VerseColumn({
    book: 1,
    chapter: 3,
    rows: genesisThreeRows,
    selectedVerse: null,
    onSelectVerse: () => {},
  });
  const html = renderToStaticMarkup(element as never);

  assert.doesNotMatch(html, /aria-pressed="true"/, `a verse was pre-selected with nothing chosen:\n${html}`);
});

test("RENDER: the selected verse (and only that one) is aria-pressed=true, with a visible-state hook", () => {
  const element = VerseColumn({
    book: 1,
    chapter: 3,
    rows: genesisThreeRows,
    selectedVerse: "1.3.15",
    onSelectVerse: () => {},
  });
  const html = renderToStaticMarkup(element as never);

  assert.match(
    html,
    /data-verse-key="1\.3\.15"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-verse-key="1\.3\.15"/,
    `verse 15 was selected but its button is not aria-pressed=true:\n${html}`,
  );
  const trueCount = (html.match(/aria-pressed="true"/g) ?? []).length;
  assert.equal(trueCount, 1, `exactly one verse should be aria-pressed=true, found ${trueCount}:\n${html}`);
});

test("ACTIVATE: invoking the rendered button's onClick -- what a mouse click OR a native <button>'s Enter/Space fires -- selects that verse", () => {
  const selections: (string | null)[] = [];
  const element = VerseColumn({
    book: 1,
    chapter: 3,
    rows: genesisThreeRows,
    selectedVerse: null,
    onSelectVerse: (next) => selections.push(next),
  });
  const verse15Button = element.props.children.find(
    (button) => button.props["data-verse-key"] === "1.3.15",
  );
  assert.ok(verse15Button, "verse 15's button element was not found in VerseColumn's output");
  (verse15Button!.props.onClick as () => void)();

  assert.deepEqual(selections, ["1.3.15"], "activating verse 15's button did not select 1.3.15");
});

test("ACTIVATE: activating the same verse twice toggles it back off", () => {
  let selected: string | null = null;
  const onSelectVerse = (next: string | null) => {
    selected = next;
  };

  const first = VerseColumn({
    book: 1,
    chapter: 3,
    rows: genesisThreeRows,
    selectedVerse: null,
    onSelectVerse,
  });
  const firstButton = first.props.children.find((b) => b.props["data-verse-key"] === "1.3.15")!;
  (firstButton.props.onClick as () => void)();
  assert.equal(selected, "1.3.15");

  const second = VerseColumn({
    book: 1,
    chapter: 3,
    rows: genesisThreeRows,
    selectedVerse: selected,
    onSelectVerse,
  });
  const secondButton = second.props.children.find((b) => b.props["data-verse-key"] === "1.3.15")!;
  (secondButton.props.onClick as () => void)();
  assert.equal(selected, null, "activating an already-selected verse again should deselect it");
});

// ===========================================================================
// 3. The read-before-write gate -- selection must not open capture early,
//    and chapter-level capture (no verse) must still work.
// ===========================================================================

test("GATE: a verse selected before reading is finished does not open the composer", () => {
  assert.deepEqual(composerRenderState(false, "1.3", "1.3.15"), { visible: false });
});

test("GATE: finishing reading opens the composer and threads the selected verse through as its RefKey", () => {
  assert.deepEqual(composerRenderState(true, "1.3", "1.3.15"), {
    visible: true,
    chapter: "1.3",
    verse: "1.3.15",
  });
});

test("GATE: finishing reading with no verse selected still opens chapter-level capture", () => {
  const state = composerRenderState(true, "1.3", null);
  assert.equal(state.visible, true);
  assert.ok(state.visible && state.verse === undefined, "chapter-level capture should carry no verse prop");
});

// ===========================================================================
// 4. Full pipeline, using the REAL local store, sync schema, and export --
//    "verified end-to-end rather than asserted."
// ===========================================================================

test("PIPELINE: a verse-anchored capture survives local store -> queued sync payload -> schema -> export", async () => {
  const store = await import("@/lib/sync/store");
  const now = new Date().toISOString();
  const chapter = chapterKey(1, 3); // "1.3"
  const verse = verseKey(1, 3, 15); // "1.3.15" -- Genesis 3:15, the verse a reader would actually pick here
  const entry: Entry = {
    id: crypto.randomUUID(),
    kind: "observation",
    body: "The first gospel promise, spoken to the serpent.",
    chapter,
    verse,
    threads: ["seed-of-the-woman"],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  await store.saveLocalEntry(entry);

  // (a) Local store: the saved copy carries the verse, not just the chapter.
  const savedEntries = await store.listLocalEntries(chapter);
  const saved = savedEntries.find((candidate) => candidate.id === entry.id);
  assert.equal(saved?.verse, verse, "the verse did not survive the local IndexedDB round trip");

  // (b) Queued sync payload: the literal bytes a push would send also carry it.
  const pending = await store.getPendingOps();
  const op = pending.find((candidate) => candidate.entityId === entry.id);
  assert.ok(op, "no sync op was queued for the captured entry");
  assert.equal((op?.payload as Entry).verse, verse, "the queued sync payload dropped the verse");
  await store.removePendingOps(pending.map((p) => p.id));

  // (c) Wire contract: what a real push validates the payload against.
  const parsed = syncEntrySchema.safeParse(entry);
  assert.equal(
    parsed.success,
    true,
    `sync schema rejected a valid verse-anchored entry: ${
      parsed.success ? "" : JSON.stringify(parsed.error.issues)
    }`,
  );

  // (d) Export: the passage markdown carries the verse anchor, not just the chapter file.
  const threads: Thread[] = [
    {
      slug: "seed-of-the-woman",
      title: "Seed of the Woman",
      definition: "The promised offspring who crushes the serpent.",
      seeing: "",
      createdAt: now,
      updatedAt: now,
    },
  ];
  const archive = buildVaultArchive({ entries: [entry], threads, people: [], logs: [] });
  const files = unzipSync(archive);
  const passage = strFromU8(files[`Bible Brain/01 Passages/${chapter}.md`]);
  assert.match(
    passage,
    new RegExp(`— ${verse.replace(/\./g, "\\.")}`),
    `exported passage markdown lost the verse anchor:\n${passage}`,
  );
});

test("PIPELINE: chapter-level capture with no verse selected still survives store -> export unchanged", async () => {
  const store = await import("@/lib/sync/store");
  const now = new Date().toISOString();
  const chapter = chapterKey(1, 4); // "1.4"
  const entry: Entry = {
    id: crypto.randomUUID(),
    kind: "note",
    body: "Cain's line runs one direction; Seth's runs another.",
    chapter,
    threads: ["genealogy"],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  await store.saveLocalEntry(entry);

  const savedEntries = await store.listLocalEntries(chapter);
  const saved = savedEntries.find((candidate) => candidate.id === entry.id);
  assert.equal(saved?.verse, undefined, "an entry captured with no verse selected should carry no verse");

  const pending = await store.getPendingOps();
  await store.removePendingOps(pending.map((p) => p.id));

  const threads: Thread[] = [
    {
      slug: "genealogy",
      title: "Genealogy",
      definition: "",
      seeing: "",
      createdAt: now,
      updatedAt: now,
    },
  ];
  const archive = buildVaultArchive({ entries: [entry], threads, people: [], logs: [] });
  const files = unzipSync(archive);
  const passage = strFromU8(files[`Bible Brain/01 Passages/${chapter}.md`]);
  assert.match(passage, /^## Note$/m, `a chapter-level entry's heading should carry no verse suffix:\n${passage}`);
});
