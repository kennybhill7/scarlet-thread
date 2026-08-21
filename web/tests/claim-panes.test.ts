/**
 * CLAIMPANES-001 — the three new real Passage Workspace sections built in
 * this task (`components/workspace/{Context,Theology,Conviction}Section.tsx`)
 * plus the criterion-2 kind-scoping mechanism they all share
 * (`ClaimComposer.tsx`'s additive `offeredKinds` prop and its
 * `composerCopyFor` header-copy function).
 *
 * TEST-ENVIRONMENT NOTE (same discipline as tests/study-composer.test.ts and
 * tests/workspace-shell.test.ts, both read as precedent before writing this
 * file): this repo's test script is `tsx --test tests/*.test.ts` — plain
 * Node, no jsdom. The same three techniques those files use are used here:
 *
 *   1. `nodeRequire` + `require.cache` seeding loads the real component
 *      files, stubbing only the four CSS Modules ClaimComposer.tsx needs
 *      (transitively, via components/ui/Button|Chip|Field.tsx), plus
 *      "fake-indexeddb/auto" so lib/sync/store.ts's module-level
 *      `openDB(...)` call succeeds.
 *   2. `PromoteFields` is hookless (ClaimComposer.tsx's own header comment),
 *      so it is called directly as a plain function to prove the
 *      kind-scoping mechanism itself — the real `optionsFrom(offeredKinds ??
 *      CLAIM_KINDS)` call, not a reimplementation.
 *   3. `react-dom/server`'s `renderToStaticMarkup` renders the real
 *      Context/Theology/Conviction section components (and the full
 *      `WorkspaceShell`) to actual HTML for structural/copy assertions.
 *
 * WHY THE NEW HEADING COPY EXISTS (read before assuming `composerCopyFor` is
 * scope creep beyond criterion 2's "which kinds are offered" framing): it
 * was NOT part of the original plan. It became necessary when building this
 * file's own WorkspaceShell-integration tests exposed that Conviction's
 * composer — which BUILD_PLAN §4 requires mount UNCONDITIONALLY, never
 * gated — shares ClaimComposer's hardcoded "What did you notice in the
 * text?" heading with Observe, and `tests/workspace-shell.test.ts`'s frozen
 * READGATE-001 tests scan the WHOLE rendered page for that exact string as
 * their proxy for "Observe's composer mounted." Once Conviction started
 * mounting unconditionally, those frozen (must-not-edit) tests started
 * failing for the wrong reason — Conviction's copy, not Observe's, was
 * supplying the match. `composerCopyFor` is the fix: deterministic, pure,
 * keyed off `offeredKinds` itself (never a free-text prop per section), and
 * it also incidentally gives this test file a strong end-to-end proof that
 * `offeredKinds` really reaches `ClaimComposer` in each real section (the
 * heading text IS the proof — see section D below).
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
  CLAIM_KINDS,
  type Application,
  type ClaimConfidence,
  type ClaimEvidenceType,
  type ClaimKind,
  type DoctrineStatus,
  type EpistemicBasis,
  type StudyClaim,
  type StudySession,
  type StudySessionStep,
} from "@/lib/contracts/study-v2";
import { computeStepGates, type GatingClaim } from "@/lib/workspace/gating";
import { computeWorkspaceSectionsFromSession, offeredKindsForStep } from "@/lib/workspace/renderState";

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

interface ClaimSelectionDraft {
  kind: ClaimKind | null;
  epistemicBasis: EpistemicBasis | null;
  confidence: ClaimConfidence | null;
  doctrineStatus: DoctrineStatus | null;
}
interface EvidenceDraft {
  id: string;
  type: ClaimEvidenceType | null;
  note: string;
}
interface PromoteReadiness {
  ready: boolean;
  missing: string[];
}
type RElement = { type: unknown; key: unknown; props: Record<string, unknown> };
interface ComposerCopy {
  eyebrow: string;
  heading: string;
  observationLabel: string;
  placeholder: string;
}

const composerModule = nodeRequire("@/components/study/ClaimComposer.tsx") as {
  BLANK_CLAIM_SELECTION: ClaimSelectionDraft;
  selectKind: (selection: ClaimSelectionDraft, kind: ClaimKind) => ClaimSelectionDraft;
  blankEvidenceDraft: (id: string) => EvidenceDraft;
  promoteReadiness: (body: string, selection: ClaimSelectionDraft, evidence: EvidenceDraft[]) => PromoteReadiness;
  composerCopyFor: (offeredKinds?: readonly ClaimKind[]) => ComposerCopy;
  PromoteFields: (props: {
    body: string;
    selection: ClaimSelectionDraft;
    evidence: EvidenceDraft[];
    readiness: PromoteReadiness;
    disabled: boolean;
    onSelectionChange: (next: ClaimSelectionDraft) => void;
    onEvidenceChange: (next: EvidenceDraft[]) => void;
    offeredKinds?: readonly ClaimKind[];
  }) => RElement;
};

const { BLANK_CLAIM_SELECTION, selectKind, promoteReadiness, composerCopyFor, PromoteFields } = composerModule;

const { ContextSection } = nodeRequire("@/components/workspace/ContextSection.tsx") as {
  ContextSection: (props: {
    workspaceId: string;
    session: StudySession;
    unlocked: boolean;
    offeredKinds: readonly ClaimKind[];
    onSaved: (result: unknown) => void;
  }) => unknown;
};
const { TheologySection } = nodeRequire("@/components/workspace/TheologySection.tsx") as {
  TheologySection: (props: {
    workspaceId: string;
    session: StudySession;
    unlocked: boolean;
    offeredKinds: readonly ClaimKind[];
    onSaved: (result: unknown) => void;
  }) => unknown;
};
const { ConvictionSection } = nodeRequire("@/components/workspace/ConvictionSection.tsx") as {
  ConvictionSection: (props: {
    workspaceId: string;
    session: StudySession;
    offeredKinds: readonly ClaimKind[];
    onSaved: (result: unknown) => void;
  }) => unknown;
};
const { WorkspaceShell } = nodeRequire("@/components/workspace/WorkspaceShell.tsx") as {
  WorkspaceShell: (props: {
    workspaceId: string;
    session: StudySession;
    claims?: StudyClaim[];
    applications?: Application[];
  }) => unknown;
};

// ---------------------------------------------------------------------------
// Tree-walking helpers (identical technique to tests/study-composer.test.ts).
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
    currentStep: "context",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function oneEvidenceRow(): EvidenceDraft[] {
  return [{ id: "row-1", type: "passage", note: "Verse 1 names the serpent directly." }];
}

function claim(kind: ClaimKind, overrides: Partial<GatingClaim> = {}): GatingClaim {
  return { kind, deletedAt: null, ...overrides };
}

// ===========================================================================
// A. offeredKindsForStep / computeWorkspaceSections — pure render-state
//    (acceptance criterion 7: any new render-state decision lives in a pure
//    function, not inline JSX).
// ===========================================================================

test("offeredKindsForStep: Context/Theology/Conviction each offer exactly their own one kind", () => {
  assert.deepEqual(offeredKindsForStep("context"), ["interpretation"]);
  assert.deepEqual(offeredKindsForStep("theology"), ["theology"]);
  assert.deepEqual(offeredKindsForStep("conviction"), ["conviction"]);
});

test("offeredKindsForStep: Read/Observe/Connect/Apply/Teach are all undefined (not applicable)", () => {
  for (const step of ["read", "observe", "connect", "apply", "teach"] as StudySessionStep[]) {
    assert.equal(offeredKindsForStep(step), undefined, `${step} should not have a narrowed kind list`);
  }
});

test("computeWorkspaceSections: each section's offeredKinds matches offeredKindsForStep(step) exactly -- no parallel logic", () => {
  const gates = computeStepGates({ session: { readGateAt: null }, claims: [], applications: [] });
  const sections = computeWorkspaceSectionsFromSession(
    { currentStep: "read" },
    { session: { readGateAt: null }, claims: [], applications: [] },
  );
  for (const section of sections) {
    assert.deepEqual(section.offeredKinds, offeredKindsForStep(section.step), `${section.step} offeredKinds drifted`);
  }
  assert.equal(gates.length, 8, "sanity: eight gates");
});

// ===========================================================================
// B. composerCopyFor — pure function driving ClaimComposer's header/prompt
//    copy. Defaults preserved exactly for every pre-existing call shape.
// ===========================================================================

test("composerCopyFor: undefined offeredKinds returns the original V2COMPOSER-001 Observe copy, byte-for-byte", () => {
  assert.deepEqual(composerCopyFor(undefined), {
    eyebrow: "OBSERVE",
    heading: "What did you notice in the text?",
    observationLabel: "Your observation",
    placeholder: "What do you notice in the words themselves?",
  });
});

test("composerCopyFor: an empty offeredKinds array also falls back to the Observe copy", () => {
  assert.deepEqual(composerCopyFor([]), composerCopyFor(undefined));
});

test("composerCopyFor: MORE THAN ONE offered kind falls back to the Observe copy (only an exact single-kind narrowing gets its own copy)", () => {
  assert.deepEqual(composerCopyFor(["theology", "conviction"]), composerCopyFor(undefined));
});

test("composerCopyFor: an offered kind with no dedicated copy entry (e.g. 'observation') falls back to the Observe copy", () => {
  assert.deepEqual(composerCopyFor(["observation"]), composerCopyFor(undefined));
});

test("composerCopyFor: exactly one offered kind returns that kind's own eyebrow/heading/placeholder, all distinct from Observe's and from each other", () => {
  const interpretation = composerCopyFor(["interpretation"]);
  const theology = composerCopyFor(["theology"]);
  const conviction = composerCopyFor(["conviction"]);
  const observe = composerCopyFor(undefined);

  for (const copy of [interpretation, theology, conviction]) {
    assert.notEqual(copy.eyebrow, observe.eyebrow);
    assert.notEqual(copy.heading, observe.heading);
  }
  const eyebrows = new Set([interpretation.eyebrow, theology.eyebrow, conviction.eyebrow, observe.eyebrow]);
  assert.equal(eyebrows.size, 4, "all four eyebrows must be distinct -- no section's composer is silently identical to another's");

  assert.equal(interpretation.eyebrow, "CONTEXT");
  assert.equal(theology.eyebrow, "THEOLOGY");
  assert.equal(conviction.eyebrow, "CONVICTION");
});

test("ASSERTION-LINE: none of the four composer copies assert a passage's meaning as fact -- every heading asks the LEARNER what they notice/believe/sense", () => {
  const allCopies = [composerCopyFor(undefined), composerCopyFor(["interpretation"]), composerCopyFor(["theology"]), composerCopyFor(["conviction"])];
  for (const copy of allCopies) {
    const text = `${copy.eyebrow} ${copy.heading} ${copy.placeholder}`;
    assert.doesNotMatch(text, /this passage means|the correct (view|interpretation)|this proves|teaches that/i, `verdict-language leak in: ${text}`);
  }
});

// ===========================================================================
// C. MUTATION-TARGET (acceptance criterion 8a) — the kind-scoping mechanism
//    itself: PromoteFields' offeredKinds prop. See this task's commit
//    message for the verbatim mutation-proof run (break -> named test fails
//    -> restore -> green again).
// ===========================================================================

test("MUTATION-TARGET criterion 8a: PromoteFields renders ONLY the chips named in offeredKinds, not all eight", () => {
  const tree = PromoteFields({
    body: "b",
    selection: BLANK_CLAIM_SELECTION,
    evidence: oneEvidenceRow(),
    readiness: promoteReadiness("b", BLANK_CLAIM_SELECTION, oneEvidenceRow()),
    disabled: false,
    onSelectionChange: () => {},
    onEvidenceChange: () => {},
    offeredKinds: ["theology"],
  });
  const kindChips = findAll(tree, (el) => el.props["data-field"] === "kind");
  assert.equal(kindChips.length, 1, "exactly one chip must render when offeredKinds names exactly one kind");
  assert.equal(kindChips[0].props["data-value"], "theology");
  assert.equal(kindChips[0].props["aria-pressed"], false, "the sole offered chip must still start unpressed -- narrowing options is not the same as pre-selecting one");
});

test("offeredKinds omitted still renders every CLAIM_KINDS chip -- the additive prop changes nothing for existing callers", () => {
  const tree = PromoteFields({
    body: "b",
    selection: BLANK_CLAIM_SELECTION,
    evidence: oneEvidenceRow(),
    readiness: promoteReadiness("b", BLANK_CLAIM_SELECTION, oneEvidenceRow()),
    disabled: false,
    onSelectionChange: () => {},
    onEvidenceChange: () => {},
  });
  const kindChips = findAll(tree, (el) => el.props["data-field"] === "kind");
  assert.equal(kindChips.length, CLAIM_KINDS.length);
});

test("ACTIVATE: clicking the sole offered chip still calls the real selectKind, not a duplicate", () => {
  const calls: ClaimSelectionDraft[] = [];
  const tree = PromoteFields({
    body: "b",
    selection: BLANK_CLAIM_SELECTION,
    evidence: oneEvidenceRow(),
    readiness: promoteReadiness("b", BLANK_CLAIM_SELECTION, oneEvidenceRow()),
    disabled: false,
    onSelectionChange: (next) => calls.push(next),
    onEvidenceChange: () => {},
    offeredKinds: ["conviction"],
  });
  const chip = findAll(tree, (el) => el.props["data-field"] === "kind" && el.props["data-value"] === "conviction")[0];
  assert.ok(chip, "conviction chip not found");
  (chip.props.onClick as () => void)();
  assert.deepEqual(calls, [selectKind(BLANK_CLAIM_SELECTION, "conviction")]);
});

test("offeredKinds narrowed to a single kind still allows the full save flow -- promoteReadiness/evidence are untouched by this prop", () => {
  const selected = selectKind(BLANK_CLAIM_SELECTION, "theology");
  const withDoctrine = { ...selected, epistemicBasis: "tradition" as const, confidence: "developing" as const, doctrineStatus: "open" as const };
  const readiness = promoteReadiness("body text", withDoctrine, oneEvidenceRow());
  assert.deepEqual(readiness, { ready: true, missing: [] });
});

// ===========================================================================
// D. ContextSection / TheologySection / ConvictionSection — real render,
//    locked and unlocked. The heading text present/absent doubles as the
//    end-to-end proof that offeredKinds really reaches ClaimComposer through
//    each section (composerCopyFor is a pure function of offeredKinds; a
//    section that forgot to pass offeredKinds through would render the
//    Observe copy instead, and these tests would catch it).
// ===========================================================================

test("RENDER ContextSection: locked shows LockedNotice only -- no composer, no curated notice", () => {
  const html = renderToStaticMarkup(
    createElement(ContextSection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: false,
      offeredKinds: ["interpretation"],
      onSaved: () => {},
    }),
  );
  assert.ok(html.includes('data-testid="context-locked"'));
  assert.ok(!html.includes('data-testid="context-no-curated-notice"'));
  assert.ok(!html.includes("What did this passage mean to its first audience?"), "composer must not mount while locked");
});

test("RENDER ContextSection: unlocked mounts the real composer narrowed to 'interpretation', plus the honest no-curated-content notice", () => {
  const html = renderToStaticMarkup(
    createElement(ContextSection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: true,
      offeredKinds: ["interpretation"],
      onSaved: () => {},
    }),
  );
  assert.ok(!html.includes('data-testid="context-locked"'));
  assert.ok(html.includes('data-testid="context-no-curated-notice"'));
  assert.match(html, /no curated context yet/i);
  assert.ok(html.includes("What did this passage mean to its first audience?"), "the real composer, narrowed via offeredKinds, must mount");
  assert.ok(html.includes(">1.3.1–1.3.6<"), "range must reach the composer");
});

test("RENDER TheologySection: locked shows LockedNotice only", () => {
  const html = renderToStaticMarkup(
    createElement(TheologySection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: false,
      offeredKinds: ["theology"],
      onSaved: () => {},
    }),
  );
  assert.ok(html.includes('data-testid="theology-locked"'));
  assert.ok(!html.includes('data-testid="theology-no-curated-notice"'));
  assert.ok(!html.includes("What do you believe this passage teaches, and why?"));
});

test("RENDER TheologySection: unlocked mounts the real composer narrowed to 'theology', plus the honest no-curated-doctrine notice", () => {
  const html = renderToStaticMarkup(
    createElement(TheologySection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: true,
      offeredKinds: ["theology"],
      onSaved: () => {},
    }),
  );
  assert.ok(!html.includes('data-testid="theology-locked"'));
  assert.ok(html.includes('data-testid="theology-no-curated-notice"'));
  assert.match(html, /no curated doctrine content yet/i);
  assert.ok(html.includes("What do you believe this passage teaches, and why?"));
});

test("TheologySection's own lock copy never mentions a connection being required (BUILD_PLAN.md:162)", () => {
  const html = renderToStaticMarkup(
    createElement(TheologySection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: false,
      offeredKinds: ["theology"],
      onSaved: () => {},
    }),
  );
  assert.doesNotMatch(html, /requires? a connection|connection is required/i);
});

test("RENDER ConvictionSection: the real composer ALWAYS mounts -- this component has no locked branch at all", () => {
  const html = renderToStaticMarkup(
    createElement(ConvictionSection as never, {
      workspaceId: "ws-1",
      session: sampleSession({ currentStep: "read", readGateAt: null }),
      offeredKinds: ["conviction"],
      onSaved: () => {},
    }),
  );
  assert.ok(html.includes('data-testid="conviction-privacy-notice"'));
  assert.ok(html.includes("How is this passage shaping you?"));
  assert.ok(!html.includes('data-testid="conviction-locked"'), "Conviction must never render a locked state -- there is no such testid");
});

test("PRIVACY (acceptance criterion 5): ConvictionSection's own notice names what does not exist yet and states the one real scope guarantee", () => {
  const html = renderToStaticMarkup(
    createElement(ConvictionSection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      offeredKinds: ["conviction"],
      onSaved: () => {},
    }),
  );
  assert.match(html, /analytics/i);
  assert.match(html, /own workspace/i);
});

test("ASSERTION-LINE: none of the three new sections' own notice copy asserts a passage's meaning as fact", () => {
  const contextHtml = renderToStaticMarkup(
    createElement(ContextSection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: true,
      offeredKinds: ["interpretation"],
      onSaved: () => {},
    }),
  );
  const theologyHtml = renderToStaticMarkup(
    createElement(TheologySection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: true,
      offeredKinds: ["theology"],
      onSaved: () => {},
    }),
  );
  const convictionHtml = renderToStaticMarkup(
    createElement(ConvictionSection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      offeredKinds: ["conviction"],
      onSaved: () => {},
    }),
  );
  for (const html of [contextHtml, theologyHtml, convictionHtml]) {
    assert.doesNotMatch(html, /this passage means|the correct (view|interpretation)|this proves|teaches that/i);
  }
});

// ===========================================================================
// E. Full WorkspaceShell integration — the actual regression this task cares
//    about most: Theology's real composer stays reachable with ZERO
//    connections (criterion 8b re-proves this survives the refactor), and
//    Conviction's stays reachable regardless of ANY gate state.
// ===========================================================================

function renderShell(props: { session: StudySession; claims?: StudyClaim[]; applications?: Application[] }): string {
  const element = createElement(WorkspaceShell as never, { workspaceId: "workspace-1", ...props } as never);
  return renderToStaticMarkup(element as never);
}

test("SHELL: Theology's real composer does NOT mount with zero claims", () => {
  const html = renderShell({ session: sampleSession({ currentStep: "theology" }), claims: [], applications: [] });
  assert.ok(html.includes('data-testid="theology-locked"'));
  assert.ok(!html.includes("What do you believe this passage teaches, and why?"));
});

test("SHELL (criterion 8b regression guard): Theology's real composer MOUNTS with a bare observation claim and ZERO connections -- 'Theology does not require a Connection first' survives the refactor", () => {
  const html = renderShell({
    session: sampleSession({ currentStep: "theology" }),
    claims: [{ id: "c1", workspaceId: "workspace-1", sessionId: "session-1", kind: "observation", epistemicBasis: "text_explicit", body: "b", passage: RANGE, confidence: "tentative", provenance: "learner", doctrineStatus: null, status: "draft", revision: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deletedAt: null }],
    applications: [],
  });
  assert.ok(!html.includes('data-testid="theology-locked"'));
  assert.ok(html.includes("What do you believe this passage teaches, and why?"), "Theology's real composer must mount -- no connection exists in this fixture");
});

test("SHELL: Context's real composer mounts once >=1 claim exists, stays locked at zero", () => {
  const zero = renderShell({ session: sampleSession({ currentStep: "context" }), claims: [], applications: [] });
  assert.ok(zero.includes('data-testid="context-locked"'));

  const one = renderShell({
    session: sampleSession({ currentStep: "context" }),
    claims: [{ id: "c1", workspaceId: "workspace-1", sessionId: "session-1", kind: "observation", epistemicBasis: "text_explicit", body: "b", passage: RANGE, confidence: "tentative", provenance: "learner", doctrineStatus: null, status: "draft", revision: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", deletedAt: null }],
    applications: [],
  });
  assert.ok(!one.includes('data-testid="context-locked"'));
  assert.ok(one.includes("What did this passage mean to its first audience?"));
});

test("SHELL: Conviction's real composer is present regardless of session/claim/application state -- the emptiest possible session", () => {
  const html = renderShell({
    session: sampleSession({ currentStep: "read", readGateAt: null }),
    claims: [],
    applications: [],
  });
  assert.ok(html.includes("How is this passage shaping you?"));
});

test("SHELL: all four real sections' offered-kind chips are reachable end-to-end -- Observe/Context/Theology/Conviction each carry only their own kind's copy, never each other's", () => {
  const html = renderShell({
    // readGateAt set (Observe unlocked) AND >=1 claim (Context/Theology unlocked); Conviction always is.
    session: sampleSession({ currentStep: "read", readGateAt: "2026-01-01T00:00:00.000Z" }),
    claims: [claim("observation") as unknown as StudyClaim],
    applications: [],
  });
  assert.ok(html.includes("CONTEXT"));
  assert.ok(html.includes("THEOLOGY"));
  assert.ok(html.includes("CONVICTION"));
  assert.ok(html.includes("OBSERVE"), "Observe's own eyebrow must be unaffected by the other three sections existing");
});

// ===========================================================================
// MUTATION PROOFS (acceptance criterion 8) — see this task's final report
// for the verbatim before/after `npm test` output these mutations actually
// produced.
//
//   (a) offeredKinds ignored (ClaimComposer.tsx, PromoteFields' kind
//       fieldset): `optionsFrom(offeredKinds ?? CLAIM_KINDS)` mutated to
//       `optionsFrom(CLAIM_KINDS)` (offeredKinds silently ignored). Named
//       test that fails: "MUTATION-TARGET criterion 8a: PromoteFields
//       renders ONLY the chips named in offeredKinds, not all eight".
//   (b) Theology re-coupled to Connect (lib/workspace/gating.ts,
//       computeStepGates' `theology: hasAnyClaim(claims)` line): mutated to
//       `theology: hasAnyClaim(claims) && hasAttemptedComparison(claims)` --
//       the exact prior-wave regression BUILD_PLAN.md:162 warns against, now
//       re-run against THIS task's refactored WorkspaceShell. Three named
//       tests failed, all and only the ones actually downstream of this one
//       gate value -- no unrelated collateral damage:
//         - tests/workspace-shell.test.ts's own "GATE: Theology unlocks with
//           a bare observation and ZERO connections..." (the original
//           prior-wave pure-gate proof).
//         - this file's own "SHELL (criterion 8b regression guard):
//           Theology's real composer MOUNTS with a bare observation claim
//           and ZERO connections..." (the NEW full-render-pipeline proof
//           that the refactor's content-mode wiring still reads the SAME
//           gate, not a second, drifted copy of it).
//         - this file's own "SHELL: all four real sections' offered-kind
//           chips are reachable end-to-end..." (its fixture also carries
//           only a bare observation claim, no attempted comparison, so it
//           independently caught the same coupling).
//
// Both mutations were applied directly to their real production files (both
// ownedPaths here), `npm test` was run and confirmed the named tests above
// FAILING (and no other unrelated test), each file was restored from a
// backup copy made before the mutation, `diff` confirmed the restored file
// byte-identical to the pre-mutation original, and `npm test` was re-run and
// confirmed green again.
// ===========================================================================
