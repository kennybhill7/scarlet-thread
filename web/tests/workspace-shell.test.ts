/**
 * WORKSPACESHELL-001 — the Passage Workspace shell
 * (`components/workspace/WorkspaceShell.tsx`) and its gating machine
 * (`lib/workspace/gating.ts`, `lib/workspace/renderState.ts`).
 *
 * TEST-ENVIRONMENT NOTE (same discipline as tests/study-composer.test.ts and
 * tests/study-page.test.ts, both read as precedent before writing this
 * file): this repo's test script is `tsx --test tests/*.test.ts` — plain
 * Node, no jsdom. Three layers are tested, deliberately:
 *
 *   1. `lib/workspace/gating.ts`'s pure predicates and `computeStepGates` —
 *      plain function calls, no stubbing needed at all.
 *   2. `lib/workspace/renderState.ts`'s pure `computeWorkspaceSections` /
 *      `buildReadGateUpdate` / `readLinkParams` — same, plain function
 *      calls.
 *   3. The real, rendered `WorkspaceShell` component via
 *      `react-dom/server`'s `renderToStaticMarkup`, loaded through
 *      `nodeRequire` + `require.cache` seeding exactly like
 *      tests/study-composer.test.ts and tests/study-page.test.ts — stubbing
 *      only `ClaimComposer`'s four CSS Modules (`WorkspaceShell.tsx` itself
 *      imports no `.module.css` — see its own header comment for why) and
 *      `fake-indexeddb/auto` for `lib/sync/store.ts`'s module-level
 *      `openDB(...)` call, reached transitively through the real
 *      `ClaimComposer`.
 *
 * The "nothing ever starts pre-selected" ClaimComposer invariant is NOT
 * re-tested here — `tests/study-composer.test.ts` (read-only for this task)
 * already owns it, and this task's job is to prove that invariant SURVIVES
 * mounting inside this shell by running that file unmodified and green (see
 * this task's final report for the verbatim command output), not to
 * re-derive the property with a parallel test.
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
  STUDY_SESSION_STEPS,
  type Application,
  type ClaimKind,
  type StudyClaim,
  type StudySession,
  type StudySessionStep,
} from "@/lib/contracts/study-v2";
import {
  computeStepGates,
  hasAnyClaim,
  hasAttemptedComparison,
  hasClaimOfKind,
  hasFinalizedApplication,
  isApplicationFinalized,
  isStepUnlocked,
  type GatingApplication,
  type GatingClaim,
  type WorkspaceGatingInput,
} from "@/lib/workspace/gating";
import {
  STEP_LABELS,
  STEP_PRODUCT_NAMES,
  buildReadGateUpdate,
  computeWorkspaceSections,
  computeWorkspaceSectionsFromSession,
  isPassageMarkedRead,
  readLinkParams,
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

const { WorkspaceShell } = nodeRequire("@/components/workspace/WorkspaceShell.tsx") as {
  WorkspaceShell: (props: {
    workspaceId: string;
    session: StudySession;
    claims?: StudyClaim[];
    applications?: Application[];
  }) => unknown;
};

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
    readGateAt: null,
    currentStep: "observe",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function claim(kind: ClaimKind, overrides: Partial<GatingClaim> = {}): GatingClaim {
  return { kind, deletedAt: null, ...overrides };
}

function application(status: string, overrides: Partial<GatingApplication> = {}): GatingApplication {
  return { status, deletedAt: null, ...overrides };
}

// ===========================================================================
// GATING — lib/workspace/gating.ts. Each of the eight gates independently.
// ===========================================================================

test("GATE: Read is always unlocked, even with nothing else true", () => {
  const input: WorkspaceGatingInput = { session: { readGateAt: null }, claims: [], applications: [] };
  assert.equal(isStepUnlocked(input, "read"), true);
});

test("GATE: Observe is locked until readGateAt is set, then unlocked", () => {
  const locked: WorkspaceGatingInput = { session: { readGateAt: null }, claims: [], applications: [] };
  const unlocked: WorkspaceGatingInput = {
    session: { readGateAt: "2026-01-01T00:00:00.000Z" },
    claims: [],
    applications: [],
  };
  assert.equal(isStepUnlocked(locked, "observe"), false);
  assert.equal(isStepUnlocked(unlocked, "observe"), true);
});

test("GATE: Context is locked with zero claims and unlocks on the first claim of ANY kind", () => {
  const zero: WorkspaceGatingInput = { session: { readGateAt: null }, claims: [], applications: [] };
  const one: WorkspaceGatingInput = {
    session: { readGateAt: null },
    claims: [claim("observation")],
    applications: [],
  };
  assert.equal(isStepUnlocked(zero, "context"), false);
  assert.equal(isStepUnlocked(one, "context"), true);
});

test("GATE: Context ignores a soft-deleted claim (deletedAt set does not count)", () => {
  const input: WorkspaceGatingInput = {
    session: { readGateAt: null },
    claims: [claim("observation", { deletedAt: "2026-01-02T00:00:00.000Z" })],
    applications: [],
  };
  assert.equal(isStepUnlocked(input, "context"), false);
});

test("GATE: Connect stays locked on a bare observation claim, unlocks on a context claim", () => {
  const observationOnly: WorkspaceGatingInput = {
    session: { readGateAt: null },
    claims: [claim("observation")],
    applications: [],
  };
  const withContext: WorkspaceGatingInput = {
    session: { readGateAt: null },
    claims: [claim("observation"), claim("context")],
    applications: [],
  };
  assert.equal(isStepUnlocked(observationOnly, "connect"), false);
  assert.equal(isStepUnlocked(withContext, "connect"), true);
});

test("GATE: Connect also unlocks on an interpretation claim (the other half of 'attempted comparison')", () => {
  const withInterpretation: WorkspaceGatingInput = {
    session: { readGateAt: null },
    claims: [claim("interpretation")],
    applications: [],
  };
  assert.equal(isStepUnlocked(withInterpretation, "connect"), true);
});

test("GATE: Theology unlocks with a bare observation and ZERO connections — 'Theology does not require a Connection first'", () => {
  const input: WorkspaceGatingInput = {
    session: { readGateAt: null },
    claims: [claim("observation")],
    applications: [],
  };
  assert.equal(isStepUnlocked(input, "connect"), false, "sanity: Connect itself must still be locked here");
  assert.equal(isStepUnlocked(input, "theology"), true, "Theology must not depend on Connect being unlocked");
});

test("GATE: Conviction is never locked, in the emptiest possible session", () => {
  const input: WorkspaceGatingInput = { session: { readGateAt: null }, claims: [], applications: [] };
  assert.equal(isStepUnlocked(input, "conviction"), true);
});

test("GATE: Apply is locked on a non-theology claim, unlocks only on a theology-kind claim", () => {
  const nonTheology: WorkspaceGatingInput = {
    session: { readGateAt: null },
    claims: [claim("observation"), claim("context"), claim("conviction")],
    applications: [],
  };
  const withTheology: WorkspaceGatingInput = {
    session: { readGateAt: null },
    claims: [claim("theology")],
    applications: [],
  };
  assert.equal(isStepUnlocked(nonTheology, "apply"), false);
  assert.equal(isStepUnlocked(withTheology, "apply"), true);
});

test("GATE: Teach is locked on a draft application, unlocks on a non-draft, non-empty status", () => {
  const draftOnly: WorkspaceGatingInput = {
    session: { readGateAt: null },
    claims: [],
    applications: [application("draft")],
  };
  const finalized: WorkspaceGatingInput = {
    session: { readGateAt: null },
    claims: [],
    applications: [application("finalized")],
  };
  assert.equal(isStepUnlocked(draftOnly, "teach"), false);
  assert.equal(isStepUnlocked(finalized, "teach"), true);
});

test("GATE: Teach ignores a soft-deleted finalized application", () => {
  const input: WorkspaceGatingInput = {
    session: { readGateAt: null },
    claims: [],
    applications: [application("finalized", { deletedAt: "2026-01-02T00:00:00.000Z" })],
  };
  assert.equal(isStepUnlocked(input, "teach"), false);
});

test("computeStepGates returns all eight steps, in BUILD_PLAN §4 table order, each with a non-empty explanation", () => {
  const gates = computeStepGates({ session: { readGateAt: null }, claims: [], applications: [] });
  assert.deepEqual(
    gates.map((g) => g.step),
    STUDY_SESSION_STEPS as unknown as StudySessionStep[],
  );
  for (const gate of gates) {
    assert.ok(gate.explanation.length > 0, `${gate.step} has no explanation`);
  }
});

test("predicate helpers match computeStepGates for a mixed fixture (no drift between the two)", () => {
  const claims = [claim("observation"), claim("theology"), claim("interpretation")];
  const applications = [application("draft"), application("finalized")];
  assert.equal(hasAnyClaim(claims), true);
  assert.equal(hasClaimOfKind(claims, "theology"), true);
  assert.equal(hasClaimOfKind(claims, "application"), false);
  assert.equal(hasAttemptedComparison(claims), true);
  assert.equal(isApplicationFinalized(application("finalized")), true);
  assert.equal(isApplicationFinalized(application("draft")), false);
  assert.equal(hasFinalizedApplication(applications), true);
});

test("HONEST STATUS TEXT: application status is compared case/whitespace-insensitively, not literal-equal", () => {
  assert.equal(isApplicationFinalized(application("  Draft  ")), false);
  assert.equal(isApplicationFinalized(application("")), false);
});

// ===========================================================================
// RENDER STATE — lib/workspace/renderState.ts
// ===========================================================================

test("computeWorkspaceSections marks exactly the currentStep section expanded, everything else collapsed", () => {
  const gates = computeStepGates({ session: { readGateAt: null }, claims: [], applications: [] });
  const sections = computeWorkspaceSections("theology", gates);
  const expanded = sections.filter((s) => s.expanded).map((s) => s.step);
  assert.deepEqual(expanded, ["theology"]);
});

test("computeWorkspaceSections gives every step its own BUILD_PLAN product name and plain label", () => {
  const gates = computeStepGates({ session: { readGateAt: null }, claims: [], applications: [] });
  const sections = computeWorkspaceSections("read", gates);
  for (const section of sections) {
    assert.equal(section.productName, STEP_PRODUCT_NAMES[section.step]);
    assert.equal(section.label, STEP_LABELS[section.step]);
    assert.ok(section.productName.length > 0);
  }
});

test("computeWorkspaceSections: lockExplanation is present iff the step is locked, absent iff unlocked", () => {
  const gates = computeStepGates({ session: { readGateAt: null }, claims: [], applications: [] });
  const sections = computeWorkspaceSections("observe", gates);
  for (const section of sections) {
    if (section.unlocked) assert.equal(section.lockExplanation, null, `${section.step} unlocked but has a notice`);
    else assert.ok(section.lockExplanation && section.lockExplanation.length > 0, `${section.step} locked but no notice`);
  }
});

test("computeWorkspaceSections: contentMode never depends on unlocked — Observe is always 'observe', locked or not", () => {
  const lockedInput: WorkspaceGatingInput = { session: { readGateAt: null }, claims: [], applications: [] };
  const unlockedInput: WorkspaceGatingInput = {
    session: { readGateAt: "2026-01-01T00:00:00.000Z" },
    claims: [],
    applications: [],
  };
  const lockedSections = computeWorkspaceSections("observe", computeStepGates(lockedInput));
  const unlockedSections = computeWorkspaceSections("observe", computeStepGates(unlockedInput));
  const observeLocked = lockedSections.find((s) => s.step === "observe")!;
  const observeUnlocked = unlockedSections.find((s) => s.step === "observe")!;
  assert.equal(observeLocked.unlocked, false);
  assert.equal(observeUnlocked.unlocked, true);
  assert.equal(observeLocked.contentMode, "observe");
  assert.equal(observeUnlocked.contentMode, "observe");
});

test("computeWorkspaceSections: the six unbuilt sections are always contentMode 'placeholder', regardless of gate state", () => {
  const claims = [claim("observation"), claim("context"), claim("interpretation"), claim("theology")];
  const applications = [application("finalized")];
  const sections = computeWorkspaceSections(
    "teach",
    computeStepGates({ session: { readGateAt: "2026-01-01T00:00:00.000Z" }, claims, applications }),
  );
  const placeholderSteps: StudySessionStep[] = ["context", "connect", "theology", "conviction", "apply", "teach"];
  for (const step of placeholderSteps) {
    const section = sections.find((s) => s.step === step)!;
    assert.equal(section.contentMode, "placeholder", `${step} should still be a placeholder`);
  }
});

test("computeWorkspaceSectionsFromSession matches computeWorkspaceSections(computeStepGates(...)) — no parallel logic", () => {
  const session = sampleSession({ currentStep: "context" });
  const claims = [claim("observation")];
  const applications: GatingApplication[] = [];
  const viaHelper = computeWorkspaceSectionsFromSession(session, { session, claims, applications });
  const viaDirect = computeWorkspaceSections("context", computeStepGates({ session, claims, applications }));
  assert.deepEqual(viaHelper, viaDirect);
});

test("readLinkParams parses book/chapter from the session range's canonical start key", () => {
  assert.deepEqual(readLinkParams(RANGE), { book: 1, chapter: 3 });
});

test("readLinkParams returns null for a malformed start key rather than throwing", () => {
  assert.equal(readLinkParams({ versificationId: CANONICAL_VERSIFICATION_ID, start: "not-a-key", end: "not-a-key" }), null);
});

test("isPassageMarkedRead is false for null/undefined readGateAt, true once set", () => {
  assert.equal(isPassageMarkedRead({ readGateAt: null }), false);
  assert.equal(isPassageMarkedRead({ readGateAt: undefined }), false);
  assert.equal(isPassageMarkedRead({ readGateAt: "2026-01-01T00:00:00.000Z" }), true);
});

test("buildReadGateUpdate sets readGateAt, bumps revision, updates updatedAt, and leaves an already-advanced currentStep untouched", () => {
  const session = sampleSession({ readGateAt: null, revision: 1, currentStep: "observe" });
  const updated = buildReadGateUpdate(session, "2026-02-01T00:00:00.000Z");
  assert.equal(updated.readGateAt, "2026-02-01T00:00:00.000Z");
  assert.equal(updated.revision, 2);
  assert.equal(updated.updatedAt, "2026-02-01T00:00:00.000Z");
  assert.equal(
    updated.currentStep,
    "observe",
    "a session already past the read step must not be moved by marking read again",
  );
});

// READGATE-001 acceptance criterion 3 — marking read also advances
// currentStep from "read" to "observe" in the SAME write, scoped to ONLY
// that one transition.
test("buildReadGateUpdate: a session sitting on 'read' advances to 'observe' in the same write that sets readGateAt", () => {
  const session = sampleSession({ readGateAt: null, revision: 1, currentStep: "read" });
  const updated = buildReadGateUpdate(session, "2026-02-01T00:00:00.000Z");
  assert.equal(updated.readGateAt, "2026-02-01T00:00:00.000Z");
  assert.equal(updated.currentStep, "observe", "marking read must advance a fresh session off the Read step");
});

test("buildReadGateUpdate: currentStep values other than 'read' are never touched by this transition (scoped to read->observe only)", () => {
  for (const currentStep of ["context", "connect", "theology", "conviction", "apply", "teach"] as const) {
    const session = sampleSession({ readGateAt: null, revision: 1, currentStep });
    const updated = buildReadGateUpdate(session, "2026-02-01T00:00:00.000Z");
    assert.equal(updated.currentStep, currentStep, `currentStep "${currentStep}" must not be reassigned`);
  }
});

test("buildReadGateUpdate is idempotent: a second call keeps the ORIGINAL readGateAt, still bumps revision", () => {
  const first = buildReadGateUpdate(sampleSession({ readGateAt: null, revision: 1, currentStep: "read" }), "2026-02-01T00:00:00.000Z");
  const second = buildReadGateUpdate(first, "2026-02-02T00:00:00.000Z");
  assert.equal(second.readGateAt, "2026-02-01T00:00:00.000Z", "readGateAt must not be overwritten by a later mark-as-read");
  assert.equal(second.revision, 3);
  assert.equal(second.currentStep, "observe", "the first call's read->observe advance must not be reverted by the second call");
});

// ===========================================================================
// RENDER — the real WorkspaceShell component, via renderToStaticMarkup.
// ===========================================================================

function render(props: { session: StudySession; claims?: StudyClaim[]; applications?: Application[] }): string {
  const element = createElement(WorkspaceShell as never, { workspaceId: "workspace-1", ...props } as never);
  return renderToStaticMarkup(element as never);
}

test("RENDER: all eight sections appear, each naming both its plain label and its BUILD_PLAN product name", () => {
  const html = render({ session: sampleSession() });
  for (const step of STUDY_SESSION_STEPS) {
    assert.ok(html.includes(STEP_LABELS[step]), `missing label for ${step}`);
    assert.ok(html.includes(STEP_PRODUCT_NAMES[step]), `missing product name for ${step}`);
  }
});

test("RENDER: the real ClaimComposer mounts unmodified in Observe once the passage is marked read, headline and range both present", () => {
  const html = render({
    session: sampleSession({ currentStep: "observe", readGateAt: "2026-01-01T06:00:00.000Z" }),
  });
  assert.ok(html.includes("What did you notice in the text?"), "ClaimComposer headline missing");
  assert.ok(html.includes("1.3.1"), "range did not reach the composer");
});

// READGATE-001, acceptance criteria 2 and 4 — the actual regression this
// task exists to fix, at the component level (see tests/study-page.test.ts's
// own "READGATE" section for the same proof through the full page
// pipeline). This DELIBERATELY REVERSES what this exact test used to assert
// before this task (Observe's ClaimComposer mounting regardless of the read
// gate) — see this file's own header and lib/workspace/renderState.ts's for
// why that reversal is safe now that StudyEntry.tsx/ClaimComposer.tsx no
// longer mint fresh sessions already sitting on Observe.
test("RENDER: Observe's ClaimComposer does NOT mount while the read gate is NOT set -- the honest why-locked notice shows instead", () => {
  const html = render({ session: sampleSession({ currentStep: "read", readGateAt: null }) });
  assert.ok(
    !html.includes("What did you notice in the text?"),
    "the real composer must not render before the passage is marked read",
  );
  assert.ok(html.includes(">Locked<"), "the locked badge should still show for a gated Observe section");
  assert.ok(
    html.includes('data-testid="observe-locked"'),
    "Observe should show its own why-locked notice, not a bare disabled control with no explanation",
  );
});

test("RENDER: Observe's why-locked notice disappears and the real composer appears in the SAME render once readGateAt is set", () => {
  const locked = render({ session: sampleSession({ currentStep: "read", readGateAt: null }) });
  const unlocked = render({
    session: sampleSession({ currentStep: "observe", readGateAt: "2026-01-01T06:00:00.000Z" }),
  });
  assert.ok(locked.includes('data-testid="observe-locked"'));
  assert.ok(!locked.includes("What did you notice in the text?"));
  assert.ok(!unlocked.includes('data-testid="observe-locked"'));
  assert.ok(unlocked.includes("What did you notice in the text?"));
});

test("RENDER: a locked section shows its own named 'why locked' explanation text", () => {
  const html = render({ session: sampleSession({ currentStep: "read", readGateAt: null }) });
  assert.ok(html.includes("Unlocks after your first claim in this session."), "Context's lock explanation missing");
  assert.ok(html.includes("Unlocks after you attempt a comparison"), "Connect's lock explanation missing");
});

test("RENDER: an unlocked section shows no lock notice", () => {
  const html = render({
    session: sampleSession({ currentStep: "read", readGateAt: "2026-01-01T00:00:00.000Z" }),
  });
  // Observe unlocked -> its own explanation text must not appear.
  assert.ok(!html.includes("Unlocks once this passage is marked read."));
});

test("RENDER: the six unbuilt sections each render an honest 'not built yet' placeholder, never fabricated content", () => {
  const html = render({ session: sampleSession() });
  const placeholderSteps: StudySessionStep[] = ["context", "connect", "theology", "conviction", "apply", "teach"];
  for (const step of placeholderSteps) {
    assert.ok(html.includes(`data-testid="placeholder-${step}"`), `${step} placeholder missing`);
  }
  assert.ok(html.includes("Not built yet."));
});

test("RENDER: Read shows a mark-as-read control before the gate is set, and a confirmation after", () => {
  const unread = render({ session: sampleSession({ readGateAt: null }) });
  assert.ok(unread.includes('data-testid="mark-read-button"'));
  assert.ok(!unread.includes('data-testid="read-gate-set"'));

  const read = render({ session: sampleSession({ readGateAt: "2026-01-05T00:00:00.000Z" }) });
  assert.ok(read.includes('data-testid="read-gate-set"'));
  assert.ok(!read.includes('data-testid="mark-read-button"'));
});

test("RENDER: Read links into the existing reader for this session's own range", () => {
  const html = render({ session: sampleSession() });
  assert.ok(html.includes('href="/read/1/3"'), "reader link missing or wrong book/chapter");
});

test("RENDER: no assertion-line violation — no section's text claims a passage MEANS anything (teaching-not-theology)", () => {
  const html = render({ session: sampleSession() });
  // The six placeholders and the lock notices are the only NEW copy this
  // task introduces; none of it may assert doctrine (see
  // docs/decisions/2026-08-18-teaching-not-theology.md). Spot-check for the
  // forbidden verdict shape "this passage means" / "the correct interpretation".
  assert.ok(!/this passage means/i.test(html));
  assert.ok(!/correct interpretation/i.test(html));
});

// ===========================================================================
// MUTATION PROOFS (acceptance criterion 9) — documented in prose here too;
// see this task's final report for the verbatim before/after `npm test`
// output the mutations actually produced.
//
//   1. Theology-unlocked-without-Connect (`lib/workspace/gating.ts`,
//      `computeStepGates`'s `theology: hasAnyClaim(claims)` line): mutated to
//      `theology: hasAnyClaim(claims) && hasAttemptedComparison(claims)` (the
//      exact bug BUILD_PLAN.md:162 warns against — coupling Theology to
//      Connect). Named test that fails:
//      "GATE: Theology unlocks with a bare observation and ZERO
//      connections — 'Theology does not require a Connection first'".
//   2. Apply-requires-theology-kind (`lib/workspace/gating.ts`,
//      `computeStepGates`'s `apply: hasClaimOfKind(claims, "theology")`
//      line): mutated to `apply: hasAnyClaim(claims)` (too permissive — any
//      claim, not specifically a theology one). Named test that fails:
//      "GATE: Apply is locked on a non-theology claim, unlocks only on a
//      theology-kind claim".
//
// Both mutations were applied directly to `lib/workspace/gating.ts` (an
// ownedPath here, so no compile-hook indirection was needed), `npm test`
// was run and the named test above was confirmed FAILING (and no other
// unrelated test), the file was restored from a backup copy made before the
// mutation, `diff` confirmed the restored file byte-identical to the
// pre-mutation original, and `npm test` was re-run and confirmed green
// again.
// ===========================================================================
