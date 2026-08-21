/**
 * CONNECTPANE-001 — `components/workspace/ConnectSection.tsx` and its pure
 * helpers in `lib/workspace/renderState.ts` (`parseTypedRange`,
 * `selectConnectionType`, `evidenceLabelOptionsFor`, `selectEvidenceLabel`,
 * `connectionReadiness`, `buildUserConnectionDraft`,
 * `buildNoWarrantYetUpdate`).
 *
 * TEST-ENVIRONMENT NOTE (same discipline as tests/claim-panes.test.ts and
 * tests/study-composer.test.ts, both read as precedent before writing this
 * file): this repo's test script is `tsx --test tests/*.test.ts` — plain
 * Node, no jsdom. Four techniques, all against REAL production modules,
 * never a reimplementation:
 *
 *   1. `nodeRequire` + `require.cache` seeding loads the real component
 *      files, stubbing only the four CSS Modules `ConnectSection.tsx` needs
 *      transitively (via `components/ui/Button|Chip|Field.tsx` and
 *      `components/study/ClaimComposer.tsx`, whose `optionsFrom` it reuses),
 *      plus "fake-indexeddb/auto" so `lib/sync/store.ts`'s module-level
 *      `openDB(...)` call succeeds.
 *   2. `EvidenceLabelField` is hookless (`ConnectSection.tsx`'s own header
 *      comment), so it is called directly as a plain function to prove the
 *      CHECK-constraint render-side narrowing itself — the exact technique
 *      `tests/claim-panes.test.ts` uses for `PromoteFields`.
 *   3. `react-dom/server`'s `renderToStaticMarkup` renders the real
 *      `ConnectSection` (and the full `WorkspaceShell`) to actual HTML for
 *      structural/copy assertions. `useEffect` never fires under SSR, so
 *      `MotifRadarPanel`/`UserThreadsPanel`'s client fetches never run here —
 *      their own loading-state copy is what these tests observe, which is
 *      sufficient to prove both are actually mounted.
 *   4. PIPELINE tests call the real `saveLocalUserConnection` /
 *      `saveLocalStudySession` (via `nodeRequire("@/lib/sync/store.ts")`,
 *      loaded through the same `fake-indexeddb/auto` seam
 *      `tests/study-composer.test.ts` already established) to prove the
 *      CHECK-constraint guarantee's FOURTH, pre-existing layer (the schema's
 *      own `superRefine`) really does reject the one invalid combination,
 *      independent of anything this task built.
 */
import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import {
  CONNECTION_TYPES,
  EVIDENCE_LABELS,
  isPersonalResonanceEvidenceLabelValid,
  type Application,
  type ConnectionType,
  type EvidenceLabel,
  type StudyClaim,
  type StudySession,
  type UserConnection,
} from "@/lib/contracts/study-v2";
import type { GatingClaim } from "@/lib/workspace/gating";
import { computeStepGates } from "@/lib/workspace/gating";
import { computeWorkspaceSectionsFromSession } from "@/lib/workspace/renderState";

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

const cssProxy = new Proxy(
  {},
  { get: (_target, key) => (typeof key === "string" ? key : undefined) },
);

seedModule("@/components/study/claim-composer.module.css", { default: cssProxy });
seedModule("@/components/ui/Button.module.css", { default: cssProxy });
seedModule("@/components/ui/Chip.module.css", { default: cssProxy });
seedModule("@/components/ui/Field.module.css", { default: cssProxy });

// ---------------------------------------------------------------------------
// Load the real modules under test.
// ---------------------------------------------------------------------------

interface ConnectionSelectionDraft {
  type: ConnectionType | null;
  evidenceLabel: EvidenceLabel | null;
}
type RElement = { type: unknown; key: unknown; props: Record<string, unknown> };

const renderStateModule = nodeRequire("@/lib/workspace/renderState.ts") as {
  BLANK_CONNECTION_SELECTION: ConnectionSelectionDraft;
  CONNECTION_RATIONALE_MIN_LENGTH: number;
  evidenceLabelOptionsFor: (type: ConnectionType | null) => readonly EvidenceLabel[];
  selectConnectionType: (selection: ConnectionSelectionDraft, type: ConnectionType) => ConnectionSelectionDraft;
  selectEvidenceLabel: (
    selection: ConnectionSelectionDraft,
    evidenceLabel: EvidenceLabel,
  ) => ConnectionSelectionDraft;
  parseTypedRange: (start: string, end: string) => CanonicalRangeV1 | null;
  connectionReadiness: (params: {
    toRange: CanonicalRangeV1 | null;
    selection: ConnectionSelectionDraft;
    rationale: string;
  }) => { ready: boolean; missing: string[] };
  buildUserConnectionDraft: (params: {
    id: string;
    workspaceId: string;
    fromRange: CanonicalRangeV1;
    toRange: CanonicalRangeV1;
    selection: ConnectionSelectionDraft;
    rationale: string;
    threadSlug: string | null;
    now: string;
  }) => UserConnection;
  buildNoWarrantYetUpdate: (session: StudySession, now: string) => StudySession;
};

const {
  BLANK_CONNECTION_SELECTION,
  CONNECTION_RATIONALE_MIN_LENGTH,
  evidenceLabelOptionsFor,
  selectConnectionType,
  selectEvidenceLabel,
  parseTypedRange,
  connectionReadiness,
  buildUserConnectionDraft,
  buildNoWarrantYetUpdate,
} = renderStateModule;

const connectSectionModule = nodeRequire("@/components/workspace/ConnectSection.tsx") as {
  ConnectSection: (props: {
    workspaceId: string;
    session: StudySession;
    unlocked: boolean;
    onSaved: (result: unknown) => void;
  }) => unknown;
  EvidenceLabelField: (props: {
    selection: ConnectionSelectionDraft;
    disabled: boolean;
    onSelectionChange: (next: ConnectionSelectionDraft) => void;
  }) => RElement;
};
const { ConnectSection, EvidenceLabelField } = connectSectionModule;

const { WorkspaceShell } = nodeRequire("@/components/workspace/WorkspaceShell.tsx") as {
  WorkspaceShell: (props: {
    workspaceId: string;
    session: StudySession;
    claims?: StudyClaim[];
    applications?: Application[];
  }) => unknown;
};

const store = nodeRequire("@/lib/sync/store.ts") as {
  saveLocalUserConnection: (connection: UserConnection) => Promise<void>;
  saveLocalStudySession: (session: StudySession) => Promise<void>;
  listLocalV2Entities: (entity: "connection" | "session") => Promise<unknown[]>;
};

// ---------------------------------------------------------------------------
// Tree-walking helper (identical technique to tests/claim-panes.test.ts).
// ---------------------------------------------------------------------------

function isElement(node: unknown): node is RElement {
  return typeof node === "object" && node !== null && "props" in (node as object) && "type" in (node as object);
}

function findAll(node: unknown, predicate: (el: RElement) => boolean, out: RElement[] = []): RElement[] {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out);
    return out;
  }
  if (isElement(node)) {
    if (predicate(node)) out.push(node);
    const children = node.props?.children;
    if (children !== undefined) findAll(children, predicate, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RANGE: CanonicalRangeV1 = { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.1", end: "1.3.6" };
const OTHER_RANGE: CanonicalRangeV1 = { versificationId: CANONICAL_VERSIFICATION_ID, start: "40.5.17", end: "40.5.17" };

function sampleSession(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    range: RANGE,
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
    ...overrides,
  };
}

function claim(kind: string, overrides: Partial<GatingClaim> = {}): GatingClaim {
  return { kind: kind as GatingClaim["kind"], deletedAt: null, ...overrides };
}

const LONG_RATIONALE = "This phrase echoes the earlier promise almost word for word, which is my own reasoning.";

function fullSelection(overrides: Partial<ConnectionSelectionDraft> = {}): ConnectionSelectionDraft {
  return { type: "quotation", evidenceLabel: "explicit", ...overrides };
}

// ===========================================================================
// A. parseTypedRange — pure, hand-computed expectations.
// ===========================================================================

test("parseTypedRange: a well-formed same-book start<=end pair parses", () => {
  assert.deepEqual(parseTypedRange("40.5.17", "40.5.17"), {
    versificationId: CANONICAL_VERSIFICATION_ID,
    start: "40.5.17",
    end: "40.5.17",
  });
  assert.deepEqual(parseTypedRange("1.3.1", "1.3.6"), {
    versificationId: CANONICAL_VERSIFICATION_ID,
    start: "1.3.1",
    end: "1.3.6",
  });
});

test("parseTypedRange: trims surrounding whitespace", () => {
  assert.deepEqual(parseTypedRange("  40.5.17 ", " 40.5.17  "), {
    versificationId: CANONICAL_VERSIFICATION_ID,
    start: "40.5.17",
    end: "40.5.17",
  });
});

test("parseTypedRange: rejects malformed keys", () => {
  assert.equal(parseTypedRange("not-a-key", "40.5.17"), null);
  assert.equal(parseTypedRange("40.5.17", ""), null);
  assert.equal(parseTypedRange("", ""), null);
  assert.equal(parseTypedRange("01.5.17", "40.5.17"), null, "leading zero must reject, matching parseVerseKeyStrict");
});

test("parseTypedRange: rejects cross-book pairs", () => {
  assert.equal(parseTypedRange("1.1.1", "2.1.1"), null);
});

test("parseTypedRange: rejects end before start (chapter, then verse)", () => {
  assert.equal(parseTypedRange("1.5.1", "1.3.1"), null, "end chapter before start chapter");
  assert.equal(parseTypedRange("1.3.10", "1.3.1"), null, "same chapter, end verse before start verse");
});

test("parseTypedRange: same start and end chapter/verse is valid (single verse)", () => {
  assert.deepEqual(parseTypedRange("1.3.5", "1.3.5"), { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.5", end: "1.3.5" });
});

// ===========================================================================
// B. THE CHECK-CONSTRAINT GUARANTEE — three independent layers, each proved
//    separately (acceptance criterion 2).
// ===========================================================================

test("evidenceLabelOptionsFor: personal_resonance offers ONLY devotional; every other type offers the full EVIDENCE_LABELS array", () => {
  assert.deepEqual(evidenceLabelOptionsFor("personal_resonance"), ["devotional"]);
  for (const type of CONNECTION_TYPES) {
    if (type === "personal_resonance") continue;
    assert.deepEqual(evidenceLabelOptionsFor(type), EVIDENCE_LABELS, `${type} should offer the full label set`);
  }
  assert.deepEqual(evidenceLabelOptionsFor(null), EVIDENCE_LABELS);
});

test("selectConnectionType: choosing personal_resonance force-sets evidenceLabel to devotional in the SAME update", () => {
  const withOtherLabel = fullSelection({ type: "motif", evidenceLabel: "plausible" });
  const next = selectConnectionType(withOtherLabel, "personal_resonance");
  assert.deepEqual(next, { type: "personal_resonance", evidenceLabel: "devotional" });
});

test("selectConnectionType: choosing a non-personal_resonance type leaves an existing evidenceLabel alone (no reset for unconstrained types)", () => {
  const selection = fullSelection({ type: "motif", evidenceLabel: "strong" });
  const next = selectConnectionType(selection, "allusion");
  assert.deepEqual(next, { type: "allusion", evidenceLabel: "strong" });
});

test("MUTATION-TARGET (criterion 2, layer 2 -- belt-and-suspenders guard): selectEvidenceLabel refuses a non-devotional label while type is personal_resonance, for EVERY other label", () => {
  const locked = fullSelection({ type: "personal_resonance", evidenceLabel: "devotional" });
  for (const label of EVIDENCE_LABELS) {
    if (label === "devotional") continue;
    const attempted = selectEvidenceLabel(locked, label);
    assert.deepEqual(attempted, locked, `selecting "${label}" while personal_resonance must be a no-op`);
  }
});

test("selectEvidenceLabel: devotional is always accepted while type is personal_resonance (the one valid combination is not itself blocked)", () => {
  const locked = fullSelection({ type: "personal_resonance", evidenceLabel: "devotional" });
  assert.deepEqual(selectEvidenceLabel(locked, "devotional"), locked);
});

test("selectEvidenceLabel: every label is accepted for every non-personal_resonance type", () => {
  for (const type of CONNECTION_TYPES) {
    if (type === "personal_resonance") continue;
    for (const label of EVIDENCE_LABELS) {
      const selection = fullSelection({ type, evidenceLabel: null });
      assert.deepEqual(selectEvidenceLabel(selection, label), { type, evidenceLabel: label });
    }
  }
});

test("EXHAUSTIVE: every (type, attempted evidenceLabel) pair reachable through selectConnectionType + selectEvidenceLabel satisfies isPersonalResonanceEvidenceLabelValid", () => {
  for (const type of CONNECTION_TYPES) {
    let selection = selectConnectionType(BLANK_CONNECTION_SELECTION, type);
    for (const attemptedLabel of EVIDENCE_LABELS) {
      selection = selectEvidenceLabel(selection, attemptedLabel);
      if (selection.type && selection.evidenceLabel) {
        assert.ok(
          isPersonalResonanceEvidenceLabelValid({ type: selection.type, evidenceLabel: selection.evidenceLabel }),
          `reached an invalid combination: ${JSON.stringify(selection)}`,
        );
      }
    }
  }
});

test("MUTATION-TARGET (criterion 2, layer 1 -- render-side narrowing): EvidenceLabelField renders EXACTLY ONE chip, 'devotional', already active, when type is personal_resonance", () => {
  const tree = EvidenceLabelField({
    selection: { type: "personal_resonance", evidenceLabel: "devotional" },
    disabled: false,
    onSelectionChange: () => {},
  });
  const chips = findAll(tree, (el) => el.props["data-field"] === "evidenceLabel");
  assert.equal(chips.length, 1, "exactly one evidenceLabel chip must render for personal_resonance");
  assert.equal(chips[0].props["data-value"], "devotional");
  assert.equal(chips[0].props["aria-pressed"], true, "the sole option is already the active selection");
});

test("EvidenceLabelField: renders all four chips for a non-personal_resonance type, none pre-active until chosen", () => {
  const tree = EvidenceLabelField({
    selection: { type: "motif", evidenceLabel: null },
    disabled: false,
    onSelectionChange: () => {},
  });
  const chips = findAll(tree, (el) => el.props["data-field"] === "evidenceLabel");
  assert.equal(chips.length, EVIDENCE_LABELS.length);
  for (const chip of chips) assert.equal(chip.props["aria-pressed"], false);
});

test("EvidenceLabelField: shows the visible lock notice only for personal_resonance, never otherwise", () => {
  const locked = renderToStaticMarkup(
    createElement(EvidenceLabelField as never, {
      selection: { type: "personal_resonance", evidenceLabel: "devotional" },
      disabled: false,
      onSelectionChange: () => {},
    }),
  );
  assert.ok(locked.includes('data-testid="personal-resonance-devotional-lock"'));

  const unlocked = renderToStaticMarkup(
    createElement(EvidenceLabelField as never, {
      selection: { type: "motif", evidenceLabel: null },
      disabled: false,
      onSelectionChange: () => {},
    }),
  );
  assert.ok(!unlocked.includes('data-testid="personal-resonance-devotional-lock"'));
});

test("ACTIVATE: clicking the sole 'devotional' chip while locked still calls the real selectEvidenceLabel, not a duplicate", () => {
  const calls: ConnectionSelectionDraft[] = [];
  const selection: ConnectionSelectionDraft = { type: "personal_resonance", evidenceLabel: "devotional" };
  const tree = EvidenceLabelField({ selection, disabled: false, onSelectionChange: (next) => calls.push(next) });
  const chip = findAll(tree, (el) => el.props["data-field"] === "evidenceLabel")[0];
  (chip.props.onClick as () => void)();
  assert.deepEqual(calls, [selectEvidenceLabel(selection, "devotional")]);
});

test("MUTATION-TARGET (criterion 2, layer 3 -- builder-side throw): buildUserConnectionDraft throws for the one invalid combination, even if a caller bypasses layers 1/2", () => {
  assert.throws(
    () =>
      buildUserConnectionDraft({
        id: "c1",
        workspaceId: "ws-1",
        fromRange: RANGE,
        toRange: OTHER_RANGE,
        selection: { type: "personal_resonance", evidenceLabel: "explicit" },
        rationale: LONG_RATIONALE,
        threadSlug: null,
        now: "2026-01-01T00:00:00.000Z",
      }),
    /devotional/,
  );
});

test("buildUserConnectionDraft: the one valid personal_resonance combination builds successfully", () => {
  const connection = buildUserConnectionDraft({
    id: "c1",
    workspaceId: "ws-1",
    fromRange: RANGE,
    toRange: OTHER_RANGE,
    selection: { type: "personal_resonance", evidenceLabel: "devotional" },
    rationale: LONG_RATIONALE,
    threadSlug: null,
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(connection.type, "personal_resonance");
  assert.equal(connection.evidenceLabel, "devotional");
});

// ===========================================================================
// C. buildUserConnectionDraft / connectionReadiness — required-field throws
//    and the rationale minimum, confirmed against the REAL enforced value
//    (lib/api/sync-v2.ts's syncUserConnectionV2Schema.min(20)), not guessed.
// ===========================================================================

test("CONNECTION_RATIONALE_MIN_LENGTH matches the real enforced minimum (20)", () => {
  assert.equal(CONNECTION_RATIONALE_MIN_LENGTH, 20);
});

test("buildUserConnectionDraft throws without a chosen type", () => {
  assert.throws(() =>
    buildUserConnectionDraft({
      id: "c1",
      workspaceId: "ws-1",
      fromRange: RANGE,
      toRange: OTHER_RANGE,
      selection: { type: null, evidenceLabel: "explicit" },
      rationale: LONG_RATIONALE,
      threadSlug: null,
      now: "2026-01-01T00:00:00.000Z",
    }),
  );
});

test("buildUserConnectionDraft throws without a chosen evidenceLabel", () => {
  assert.throws(() =>
    buildUserConnectionDraft({
      id: "c1",
      workspaceId: "ws-1",
      fromRange: RANGE,
      toRange: OTHER_RANGE,
      selection: { type: "motif", evidenceLabel: null },
      rationale: LONG_RATIONALE,
      threadSlug: null,
      now: "2026-01-01T00:00:00.000Z",
    }),
  );
});

test("buildUserConnectionDraft throws for a rationale under 20 characters (19 exactly)", () => {
  const nineteen = "a".repeat(19);
  assert.throws(() =>
    buildUserConnectionDraft({
      id: "c1",
      workspaceId: "ws-1",
      fromRange: RANGE,
      toRange: OTHER_RANGE,
      selection: fullSelection(),
      rationale: nineteen,
      threadSlug: null,
      now: "2026-01-01T00:00:00.000Z",
    }),
  );
});

test("buildUserConnectionDraft succeeds at exactly 20 characters", () => {
  const twenty = "a".repeat(20);
  const connection = buildUserConnectionDraft({
    id: "c1",
    workspaceId: "ws-1",
    fromRange: RANGE,
    toRange: OTHER_RANGE,
    selection: fullSelection(),
    rationale: twenty,
    threadSlug: null,
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(connection.rationale.length, 20);
});

test("buildUserConnectionDraft: status starts 'draft', revision 1, threadSlug null when omitted", () => {
  const connection = buildUserConnectionDraft({
    id: "c1",
    workspaceId: "ws-1",
    fromRange: RANGE,
    toRange: OTHER_RANGE,
    selection: fullSelection(),
    rationale: LONG_RATIONALE,
    threadSlug: null,
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(connection.status, "draft");
  assert.equal(connection.revision, 1);
  assert.equal(connection.threadSlug, null);
});

test("buildUserConnectionDraft: threadSlug passes through when provided", () => {
  const connection = buildUserConnectionDraft({
    id: "c1",
    workspaceId: "ws-1",
    fromRange: RANGE,
    toRange: OTHER_RANGE,
    selection: fullSelection(),
    rationale: LONG_RATIONALE,
    threadSlug: "seed-of-the-woman",
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(connection.threadSlug, "seed-of-the-woman");
});

test("connectionReadiness: reports every missing field with a distinct, stable reason", () => {
  const readiness = connectionReadiness({ toRange: null, selection: BLANK_CONNECTION_SELECTION, rationale: "" });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.missing.length, 4, `expected 4 missing reasons, got: ${JSON.stringify(readiness.missing)}`);
});

test("connectionReadiness: ready true once toRange/type/evidenceLabel/rationale(>=20) are all present", () => {
  const readiness = connectionReadiness({ toRange: OTHER_RANGE, selection: fullSelection(), rationale: LONG_RATIONALE });
  assert.deepEqual(readiness, { ready: true, missing: [] });
});

test("connectionReadiness: a rationale of only whitespace does not satisfy the minimum", () => {
  const readiness = connectionReadiness({
    toRange: OTHER_RANGE,
    selection: fullSelection(),
    rationale: " ".repeat(30),
  });
  assert.equal(readiness.ready, false);
});

// ===========================================================================
// D. NO_WARRANT_YET (acceptance criterion 3).
// ===========================================================================

test("buildNoWarrantYetUpdate: sets connectionState to 'no_warrant_yet', bumps revision, updates updatedAt", () => {
  const session = sampleSession({ connectionState: "unexamined", revision: 1 });
  const updated = buildNoWarrantYetUpdate(session, "2026-02-01T00:00:00.000Z");
  assert.equal(updated.connectionState, "no_warrant_yet");
  assert.equal(updated.revision, 2);
  assert.equal(updated.updatedAt, "2026-02-01T00:00:00.000Z");
});

test("buildNoWarrantYetUpdate: does not touch any other session field", () => {
  const session = sampleSession({ connectionState: "unexamined", revision: 3, currentStep: "connect" });
  const updated = buildNoWarrantYetUpdate(session, "2026-02-01T00:00:00.000Z");
  assert.equal(updated.id, session.id);
  assert.equal(updated.currentStep, "connect");
  assert.deepEqual(updated.range, session.range);
  assert.equal(updated.readGateAt, session.readGateAt);
});

// ===========================================================================
// E. RENDER ConnectSection — locked / unlocked / assertion-line.
// ===========================================================================

test("RENDER ConnectSection: locked shows LockedNotice only -- no form, no motif panel, no threads panel", () => {
  const html = renderToStaticMarkup(
    createElement(ConnectSection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: false,
      onSaved: () => {},
    }),
  );
  assert.ok(html.includes('data-testid="connect-locked"'));
  assert.ok(!html.includes('data-testid="connect-form"'));
  assert.ok(!html.includes('data-testid="connect-no-curated-notice"'));
  assert.ok(!html.includes('data-testid="no-warrant-yet-panel"'));
});

test("RENDER ConnectSection: unlocked mounts the real form, the honest no-curated-connections notice, the motif panel, the threads panel, and the no_warrant_yet panel", () => {
  const html = renderToStaticMarkup(
    createElement(ConnectSection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: true,
      onSaved: () => {},
    }),
  );
  assert.ok(!html.includes('data-testid="connect-locked"'));
  assert.ok(html.includes('data-testid="connect-form"'));
  assert.ok(html.includes('data-testid="connect-no-curated-notice"'));
  assert.match(html, /no curated connections yet/i);
  assert.ok(html.includes('data-testid="connect-user-threads"'), "user threads panel must mount");
  assert.ok(html.includes('data-testid="no-warrant-yet-panel"'));
  assert.ok(html.includes(">1.3.1-1.3.6<"), "this session's own range must reach the form");
});

test("RENDER ConnectSection: every ConnectionType chip and every EVIDENCE_LABELS chip is offered when no type is chosen yet", () => {
  const html = renderToStaticMarkup(
    createElement(ConnectSection as never, { workspaceId: "ws-1", session: sampleSession(), unlocked: true, onSaved: () => {} }),
  );
  for (const type of CONNECTION_TYPES) {
    assert.ok(html.includes(`data-value="${type}"`), `missing connection type chip: ${type}`);
  }
});

test("RENDER ConnectSection: already-recorded no_warrant_yet shows the acknowledgement without a fresh click", () => {
  const html = renderToStaticMarkup(
    createElement(ConnectSection as never, {
      workspaceId: "ws-1",
      session: sampleSession({ connectionState: "no_warrant_yet" }),
      unlocked: true,
      onSaved: () => {},
    }),
  );
  assert.match(html, /already recorded/i);
});

test("ASSERTION-LINE: ConnectSection's copy never asserts a connection MEANS anything or that one exists -- only asks type/evidence/rationale", () => {
  const html = renderToStaticMarkup(
    createElement(ConnectSection as never, { workspaceId: "ws-1", session: sampleSession(), unlocked: true, onSaved: () => {} }),
  );
  assert.doesNotMatch(html, /this passage means|the correct (view|interpretation)|this proves|teaches that/i);
  assert.doesNotMatch(
    html,
    /this (is|connection is) a (real |genuine |true )?connection|there (is|exists) a connection between|proves? (a|the) connection/i,
  );
});

test("ASSERTION-LINE: the no_warrant_yet copy frames declining as honest, never as failure", () => {
  const html = renderToStaticMarkup(
    createElement(ConnectSection as never, { workspaceId: "ws-1", session: sampleSession(), unlocked: true, onSaved: () => {} }),
  );
  assert.match(html, /honest/i);
  assert.doesNotMatch(html, /you (failed|did not (do|complete))/i);
});

// ===========================================================================
// F. Full WorkspaceShell integration — connect's own gate.
// ===========================================================================

function renderShell(props: { session: StudySession; claims?: StudyClaim[]; applications?: Application[] }): string {
  const element = createElement(WorkspaceShell as never, { workspaceId: "workspace-1", ...props } as never);
  return renderToStaticMarkup(element as never);
}

test("SHELL: Connect's real form does NOT mount with only a bare observation claim", () => {
  const html = renderShell({
    session: sampleSession(),
    claims: [claim("observation") as unknown as StudyClaim],
    applications: [],
  });
  assert.ok(html.includes('data-testid="connect-locked"'));
  assert.ok(!html.includes('data-testid="connect-form"'));
});

test("SHELL: Connect's real form MOUNTS once a context or interpretation claim exists", () => {
  const withContext = renderShell({
    session: sampleSession(),
    claims: [claim("context") as unknown as StudyClaim],
    applications: [],
  });
  assert.ok(!withContext.includes('data-testid="connect-locked"'));
  assert.ok(withContext.includes('data-testid="connect-form"'));

  const withInterpretation = renderShell({
    session: sampleSession(),
    claims: [claim("interpretation") as unknown as StudyClaim],
    applications: [],
  });
  assert.ok(withInterpretation.includes('data-testid="connect-form"'));
});

test("SHELL: zero claims -- Connect stays locked, matching computeWorkspaceSectionsFromSession's own contentMode", () => {
  const gatingInput = { session: { readGateAt: null }, claims: [], applications: [] };
  const sections = computeWorkspaceSectionsFromSession({ currentStep: "connect" }, gatingInput);
  const connectSection = sections.find((s) => s.step === "connect")!;
  assert.equal(connectSection.contentMode, "connect");
  assert.equal(connectSection.unlocked, false);

  const html = renderShell({ session: sampleSession({ currentStep: "connect" }), claims: [], applications: [] });
  assert.ok(html.includes('data-testid="connect-locked"'));
});

test("computeStepGates sanity: connect gate matches hasAttemptedComparison exactly for a mixed fixture", () => {
  const gates = computeStepGates({
    session: { readGateAt: null },
    claims: [claim("observation"), claim("conviction")],
    applications: [],
  });
  assert.equal(gates.find((g) => g.step === "connect")!.unlocked, false);
});

// ===========================================================================
// G. PIPELINE — the real builder feeding the real V2VAULT-001 vault writer
//    (lib/sync/store.ts), then reading it back. Proves acceptance criterion
//    1 (no new write path) AND the FOURTH, pre-existing CHECK-constraint
//    defense layer (the schema's own superRefine) independently of anything
//    this task built.
// ===========================================================================

test("PIPELINE: a valid connection round-trips through the real saveLocalUserConnection writer", async () => {
  const workspaceId = `ws-connect-pipeline-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const connection = buildUserConnectionDraft({
    id: crypto.randomUUID(),
    workspaceId,
    fromRange: RANGE,
    toRange: OTHER_RANGE,
    selection: fullSelection(),
    rationale: LONG_RATIONALE,
    threadSlug: null,
    now,
  });
  await store.saveLocalUserConnection(connection);

  const connections = (await store.listLocalV2Entities("connection")) as UserConnection[];
  const saved = connections.find((c) => c.id === connection.id);
  assert.ok(saved, "connection was not persisted");
  assert.equal(saved!.workspaceId, workspaceId);
  assert.equal(saved!.type, "quotation");
  assert.equal(saved!.evidenceLabel, "explicit");
});

test("PIPELINE MUTATION PROOF (layer 4, pre-existing schema defense): saveLocalUserConnection REJECTS a personal_resonance/non-devotional payload constructed by BYPASSING every UI layer directly", async () => {
  const workspaceId = `ws-connect-pipeline-bad-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  // Hand-assembled, deliberately bypassing buildUserConnectionDraft's own
  // throw (layer 3) -- this is the payload a caller would have to construct
  // by skipping every layer this task built, to prove the vault writer's OWN
  // pre-existing schema validation (lib/api/sync-v2.ts's
  // syncUserConnectionV2Schema superRefine, which saveLocalUserConnection
  // runs on every local write via lib/sync/store.ts's v2PayloadSchemas) is
  // the real backstop, independent of this task's own three layers.
  const badConnection: UserConnection = {
    id: crypto.randomUUID(),
    workspaceId,
    fromRange: RANGE,
    toRange: OTHER_RANGE,
    type: "personal_resonance",
    evidenceLabel: "explicit",
    rationale: LONG_RATIONALE,
    threadSlug: null,
    status: "draft",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await assert.rejects(() => store.saveLocalUserConnection(badConnection));

  const connections = (await store.listLocalV2Entities("connection")) as UserConnection[];
  assert.ok(!connections.some((c) => c.id === badConnection.id), "the rejected connection must not have been persisted");
});

test("PIPELINE: buildNoWarrantYetUpdate's session round-trips through the real saveLocalStudySession writer", async () => {
  const workspaceId = `ws-connect-pipeline-warrant-${crypto.randomUUID()}`;
  const session = sampleSession({ id: crypto.randomUUID(), workspaceId, connectionState: "unexamined" });
  const updated = buildNoWarrantYetUpdate(session, new Date().toISOString());
  await store.saveLocalStudySession(updated);

  const sessions = (await store.listLocalV2Entities("session")) as StudySession[];
  const saved = sessions.find((s) => s.id === session.id);
  assert.ok(saved, "session was not persisted");
  assert.equal(saved!.connectionState, "no_warrant_yet");
});

// ===========================================================================
// MUTATION PROOFS — documented in prose here too; see this task's final
// report for the verbatim before/after `npm test` output the mutations
// actually produced.
//
//   1. Render-side narrowing removed (lib/workspace/renderState.ts,
//      `evidenceLabelOptionsFor`): mutated to `return EVIDENCE_LABELS;`
//      unconditionally (ignoring `type`). Named test that fails:
//      "MUTATION-TARGET (criterion 2, layer 1 -- render-side narrowing):
//      EvidenceLabelField renders EXACTLY ONE chip, 'devotional', already
//      active, when type is personal_resonance" (also fails the EXHAUSTIVE
//      test above, since selectEvidenceLabel's own guard is layer 2, tested
//      independently).
//   2. Belt-and-suspenders guard removed (lib/workspace/renderState.ts,
//      `selectEvidenceLabel`): mutated to always `return { ...selection,
//      evidenceLabel };` (guard deleted). Named test that fails:
//      "MUTATION-TARGET (criterion 2, layer 2 -- belt-and-suspenders guard):
//      selectEvidenceLabel refuses a non-devotional label while type is
//      personal_resonance, for EVERY other label".
//   3. Builder-side throw removed (lib/workspace/renderState.ts,
//      `buildUserConnectionDraft`): the `isPersonalResonanceEvidenceLabelValid`
//      check deleted. Named test that fails: "MUTATION-TARGET (criterion 2,
//      layer 3 -- builder-side throw): buildUserConnectionDraft throws for
//      the one invalid combination, even if a caller bypasses layers 1/2".
//   4. Connect gate re-run against THIS task's wiring
//      (lib/workspace/gating.ts, `computeStepGates`'s
//      `connect: hasAttemptedComparison(claims)` line): mutated to
//      `connect: hasAnyClaim(claims)` (too permissive). Named tests that
//      fail: this file's "SHELL: Connect's real form does NOT mount with
//      only a bare observation claim" AND
//      tests/workspace-shell.test.ts's own "GATE: Connect stays locked on a
//      bare observation claim, unlocks on a context claim" (the original
//      pure-gate proof, re-run unmodified against this task's changes).
//
// Each mutation was applied directly to its real production file (all
// ownedPaths here), `npm test` was run and the named test(s) above were
// confirmed FAILING (and no other unrelated test), the file was restored
// from a backup copy made before the mutation, `diff` confirmed the restored
// file byte-identical to the pre-mutation original, and `npm test` was
// re-run and confirmed green again.
// ===========================================================================
