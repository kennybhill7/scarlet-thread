/**
 * RANGEPICKER-002 — `ConnectSection`'s "other passage" entry is now
 * `components/ui/PassagePicker.tsx`, not two raw "book.chapter.verse" text
 * inputs. These tests preserve what the old raw-input assertions protected
 * (a learner can name any passage, a bad one never reaches readiness, the
 * saved `UserConnection` has the same shape, the form clears after a save) and
 * add what is new (canon loading states, cross-chapter ranges, picker reset).
 *
 * Same environment discipline as tests/connect-pane.test.ts: plain Node, no
 * jsdom; CSS Modules stubbed in require.cache; `renderToStaticMarkup` for
 * markup; the hookless `ConnectRangeField` is CALLED as a plain function to
 * inspect its element tree (keys, props, handlers); the picker's state machine
 * is driven directly with `stepPassagePicker`, and the range it emits is fed
 * through the real `connectionReadiness` / `buildUserConnectionDraft` /
 * `saveLocalUserConnection`.
 */
import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { BibleIndex, BookData } from "@/lib/contracts";
import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import type { StudySession, UserConnection } from "@/lib/contracts/study-v2";
import { buildPassageCanon, type PassageCanon } from "@/lib/bible/passageCanon";
import { PASSAGE_CANON_ERROR_MESSAGE, type PassageCanonState } from "@/lib/bible/passageCanonClient";
import {
  EMPTY_PICKER_STATE,
  stepPassagePicker,
  type PassagePickerAction,
  type PassagePickerState,
} from "@/lib/bible/passagePickerState";
import {
  BLANK_CONNECTION_SELECTION,
  buildUserConnectionDraft,
  connectionReadiness,
  parseTypedRange,
  resetConnectionFormDraft,
} from "@/lib/workspace/renderState";

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
for (const css of [
  "@/components/study/claim-composer.module.css",
  "@/components/ui/Button.module.css",
  "@/components/ui/Chip.module.css",
  "@/components/ui/Field.module.css",
  "@/components/ui/PassagePicker.module.css",
]) {
  seedModule(css, { default: cssProxy });
}

const connectModule = nodeRequire("@/components/workspace/ConnectSection.tsx") as typeof import(
  "@/components/workspace/ConnectSection"
);
const { ConnectSection, ConnectRangeField } = connectModule;
const pickerModule = nodeRequire("@/components/ui/PassagePicker.tsx") as typeof import("@/components/ui/PassagePicker");
const store = nodeRequire("@/lib/sync/store.ts") as {
  saveLocalUserConnection: (connection: UserConnection) => Promise<void>;
  listLocalV2Entities: (entity: "connection") => Promise<unknown[]>;
};

// ---------------------------------------------------------------------------
// Fixtures: the REAL shipped BSB canon.
// ---------------------------------------------------------------------------

const webPath = (p: string) => new URL(`../${p}`, import.meta.url);
const index: BibleIndex = JSON.parse(readFileSync(webPath("public/bible/index.json"), "utf8"));
const REAL: PassageCanon = buildPassageCanon(
  index.books,
  (n) => JSON.parse(readFileSync(webPath(`public/bible/BSB/${n}.json`), "utf8")) as BookData,
);

const FROM: CanonicalRangeV1 = { versificationId: CANONICAL_VERSIFICATION_ID, start: "40.5.17", end: "40.5.17" };
const LONG_RATIONALE = "This phrase echoes the earlier promise almost word for word, which is my own reasoning.";

function sampleSession(): StudySession {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    range: FROM,
    mode: "encounter",
    workflowState: "active",
    connectionState: "unexamined",
    catalogReleaseId: null,
    readGateAt: "2026-01-01T00:00:00.000Z",
    currentStep: "connect",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}

/** Drives the picker's real state machine the way its onChange handlers do; returns the last emitted range. */
function drive(actions: PassagePickerAction[]): { state: PassagePickerState; emitted: CanonicalRangeV1 | null } {
  let state: PassagePickerState = EMPTY_PICKER_STATE;
  let emitted: CanonicalRangeV1 | null = null;
  for (const action of actions) {
    const step = stepPassagePicker(state, action, REAL, { allowCrossChapter: true });
    state = step.state;
    if (step.emit) emitted = step.emit.range;
  }
  return { state, emitted };
}

function findAll(node: unknown, predicate: (el: ReactElement<Record<string, unknown>>) => boolean, out: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(node)) node.forEach((child) => findAll(child, predicate, out));
  else if (isValidElement(node)) {
    const el = node as ReactElement<Record<string, unknown>>;
    if (predicate(el)) out.push(el);
    findAll(el.props.children as ReactNode, predicate, out);
  }
  return out;
}

const noop = () => {};
const READY: PassageCanonState = { status: "ready", canon: REAL };

function fieldProps(canonState: PassageCanonState, overrides: Partial<Parameters<typeof ConnectRangeField>[0]> = {}) {
  return { canonState, onRetry: noop, pickerKey: 0, disabled: false, onChange: noop, ...overrides };
}

// ---------------------------------------------------------------------------
// Markup: no raw key inputs; picker present in every canon state
// ---------------------------------------------------------------------------

test("RENDER ConnectSection (unlocked, canon not loaded yet): the raw book.chapter.verse inputs are gone and the shell-surface picker is shown disabled, with a loading line", () => {
  const html = renderToStaticMarkup(
    createElement(ConnectSection, { workspaceId: "ws-1", session: sampleSession(), unlocked: true, onSaved: noop }),
  );
  assert.ok(!html.includes('data-field="toRangeStart"'), "raw start input must be gone");
  assert.ok(!html.includes('data-field="toRangeEnd"'), "raw end input must be gone");
  assert.ok(!html.includes("book.chapter.verse"), "no copy may ask the learner to type keys");
  assert.ok(!html.includes("connect-range-invalid"), "the old typed-range notice is gone (the picker states its own errors)");
  assert.ok(html.includes('data-testid="passage-picker"'));
  assert.ok(html.includes('data-surface="shell"'), "the picker sits in the dark shell");
  assert.ok(html.includes("Other passage"), "picker legend");
  assert.ok(html.includes("To chapter"), "allowCrossChapter is on (Gen 1:1-2:3 must be reachable)");
  assert.ok(html.includes("Loading the Bible index"), "loading line");
  assert.match(html, /<fieldset[^>]*disabled=""[^>]*data-testid="passage-picker"/, "picker fieldset disabled until the canon is ready");
  // The section's other parts are unchanged.
  assert.ok(html.includes('data-testid="connect-form"'));
  assert.ok(html.includes('data-testid="no-warrant-yet-panel"'));
  assert.ok(html.includes('data-field="type"'), "type chips still render");
  assert.ok(html.includes('data-field="evidenceLabel"'), "evidence chips still render");
  assert.ok(html.includes('id="connect-rationale"'), "rationale field still renders");
});

test("RENDER ConnectSection (locked): the picker never mounts and the canon is never requested", () => {
  let loads = 0;
  const html = renderToStaticMarkup(
    createElement(ConnectSection, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: false,
      onSaved: noop,
      canonStore: {
        getSnapshot: () => ({ status: "idle" as const }),
        getServerSnapshot: () => ({ status: "idle" as const }),
        subscribe: () => noop,
        load: () => {
          loads += 1;
          return Promise.reject(new Error("must not load while locked"));
        },
      },
    }),
  );
  assert.ok(html.includes('data-testid="connect-locked"'));
  assert.ok(!html.includes("passage-picker"));
  assert.equal(loads, 0);
});

test("RENDER ConnectRangeField ready: the REAL 66-book canon is selectable, cross-chapter, enabled, no loading line", () => {
  const html = renderToStaticMarkup(createElement(ConnectRangeField, fieldProps(READY)));
  assert.ok(html.includes('data-canon-state="ready"'));
  assert.doesNotMatch(html, /<fieldset[^>]*disabled/);
  assert.equal((html.match(/<option value="\d+">/g) ?? []).length, 66, "every book of the real canon is offered");
  assert.ok(html.includes(">Genesis<") && html.includes(">Revelation<"));
  assert.ok(html.includes("To chapter"));
  assert.ok(!html.includes("Loading the Bible index"));
  assert.ok(!html.includes(PASSAGE_CANON_ERROR_MESSAGE));
});

test("RENDER ConnectRangeField error: honest message, alert role, retry button, picker stays (disabled) so nothing shifts", () => {
  const html = renderToStaticMarkup(
    createElement(ConnectRangeField, fieldProps({ status: "error", message: PASSAGE_CANON_ERROR_MESSAGE, cause: new Error("x") })),
  );
  assert.ok(html.includes('data-canon-state="error"'));
  assert.ok(html.includes("Couldn’t load the Bible index — check your connection"));
  assert.match(html, /role="alert"[^>]*>Couldn’t load/);
  assert.ok(html.includes('data-testid="connect-range-retry"'));
  assert.ok(html.includes('data-testid="passage-picker"'), "same picker box while erroring");
  assert.match(html, /<fieldset[^>]*disabled=""/);
});

test("ConnectRangeField: the retry button's real onClick calls onRetry", () => {
  let retries = 0;
  const tree = ConnectRangeField(fieldProps({ status: "error", message: PASSAGE_CANON_ERROR_MESSAGE, cause: null }, { onRetry: () => (retries += 1) }));
  const [retry] = findAll(tree, (el) => el.props["data-testid"] === "connect-range-retry");
  assert.ok(retry, "retry button missing");
  (retry.props.onClick as () => void)();
  assert.equal(retries, 1);
});

// ---------------------------------------------------------------------------
// Wiring: what the picker is given, and reset-after-save
// ---------------------------------------------------------------------------

test("ConnectRangeField ready: mounts the real PassagePicker with allowCrossChapter, the shell surface, the real canon and the caller's onChange; disabled follows `disabled`", () => {
  const onChange = () => {};
  const tree = ConnectRangeField(fieldProps(READY, { onChange, disabled: true }));
  const [picker] = findAll(tree, (el) => el.type === pickerModule.PassagePicker);
  assert.ok(picker, "PassagePicker missing");
  assert.equal(picker.props.allowCrossChapter, true);
  assert.equal(picker.props.surface, "shell");
  assert.equal(picker.props.canon, REAL);
  assert.equal(picker.props.onChange, onChange);
  assert.equal(picker.props.disabled, true);
});

test("RESET: the uncontrolled picker's React key follows pickerKey, so a save (which bumps it) remounts it blank", () => {
  const keyAt = (pickerKey: number) => {
    const [picker] = findAll(ConnectRangeField(fieldProps(READY, { pickerKey })), (el) => el.type === pickerModule.PassagePicker);
    return picker.key;
  };
  assert.equal(keyAt(0), "0");
  assert.equal(keyAt(1), "1");
  assert.notEqual(keyAt(0), keyAt(1), "a different key is what makes React discard the picker's internal selection");
});

test("RESET: resetConnectionFormDraft clears every field, advances the picker key by exactly one, and never reuses the old draft", () => {
  const blank = resetConnectionFormDraft(4);
  assert.deepEqual(blank, { selection: BLANK_CONNECTION_SELECTION, toRange: null, rationale: "", threadSlug: null, pickerKey: 5 });
  assert.equal(resetConnectionFormDraft(blank.pickerKey).pickerKey, 6);
  assert.deepEqual(BLANK_CONNECTION_SELECTION, { type: null, evidenceLabel: null }, "the shared blank selection was not mutated");
  // After a reset the form is NOT ready again until a passage is chosen anew.
  const readiness = connectionReadiness({ toRange: blank.toRange, selection: blank.selection, rationale: blank.rationale });
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.includes("Choose the other passage: its book, chapter, and the verses it covers."));
});

// ---------------------------------------------------------------------------
// Picker -> readiness -> saved UserConnection (the real chain)
// ---------------------------------------------------------------------------

test("CHAIN: a cross-chapter pick (Gen 1:1-2:3) becomes a ready form and a saved UserConnection whose toRange keeps BOTH ends", async () => {
  const { emitted } = drive([
    { type: "book", book: 1 },
    { type: "chapter", chapter: 1 },
    { type: "endChapter", chapter: 2 },
    { type: "endVerse", verse: 3 },
  ]);
  assert.deepEqual(emitted, { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.1.1", end: "1.2.3" });

  const selection = { type: "quotation" as const, evidenceLabel: "explicit" as const };
  assert.equal(connectionReadiness({ toRange: emitted, selection, rationale: LONG_RATIONALE }).ready, true);

  const workspaceId = `ws-range-picker-${crypto.randomUUID()}`;
  const connection = buildUserConnectionDraft({
    id: crypto.randomUUID(),
    workspaceId,
    fromRange: FROM,
    toRange: emitted!,
    selection,
    rationale: LONG_RATIONALE,
    threadSlug: null,
    now: new Date().toISOString(),
  });
  await store.saveLocalUserConnection(connection);
  const saved = ((await store.listLocalV2Entities("connection")) as UserConnection[]).find((c) => c.id === connection.id);
  assert.ok(saved, "not persisted");
  assert.equal(saved!.toRange.start, "1.1.1");
  assert.equal(saved!.toRange.end, "1.2.3", "the end verse the learner picked must survive to the saved record");
});

test("CHAIN: for a same-chapter pick the picker's range is IDENTICAL to what the old typed-key path produced, and the drafts have the same shape", () => {
  const { emitted } = drive([
    { type: "book", book: 45 },
    { type: "chapter", chapter: 5 },
    { type: "startVerse", verse: 12 },
    { type: "endVerse", verse: 19 },
  ]);
  const typed = parseTypedRange("45.5.12", "45.5.19");
  assert.deepEqual(emitted, typed);

  const args = {
    id: "fixed-id",
    workspaceId: "ws",
    fromRange: FROM,
    selection: { type: "quotation" as const, evidenceLabel: "explicit" as const },
    rationale: LONG_RATIONALE,
    threadSlug: null,
    now: "2026-01-01T00:00:00.000Z",
  };
  assert.deepEqual(
    buildUserConnectionDraft({ ...args, toRange: emitted! }),
    buildUserConnectionDraft({ ...args, toRange: typed! }),
  );
});

test("CHAIN: a single verse and a whole chapter both emit; an unfinished pick emits null and the form says what is missing", () => {
  assert.deepEqual(
    drive([
      { type: "book", book: 43 },
      { type: "chapter", chapter: 3 },
      { type: "startVerse", verse: 16 },
      { type: "endVerse", verse: 16 },
    ]).emitted,
    { versificationId: CANONICAL_VERSIFICATION_ID, start: "43.3.16", end: "43.3.16" },
  );
  const whole = drive([
    { type: "book", book: 1 },
    { type: "chapter", chapter: 3 },
  ]).emitted;
  assert.deepEqual(whole, { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.1", end: "1.3.24" }, "Genesis 3 really has 24 verses");

  const bookOnly = drive([{ type: "book", book: 1 }]);
  assert.equal(bookOnly.emitted, null);
  const readiness = connectionReadiness({
    toRange: bookOnly.emitted,
    selection: { type: "quotation", evidenceLabel: "explicit" },
    rationale: LONG_RATIONALE,
  });
  assert.equal(readiness.ready, false, "no passage -> no Save");
  assert.equal(readiness.missing.length, 1);
});
