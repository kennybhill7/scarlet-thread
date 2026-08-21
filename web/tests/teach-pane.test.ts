/**
 * TEACHDRAFTPANE-001 — the Teach section of the Passage Workspace
 * (`components/workspace/TeachSection.tsx`), BUILD_PLAN §4 row 8.
 *
 * TEST-ENVIRONMENT NOTE (same discipline as tests/claim-panes.test.ts and
 * tests/workspace-shell.test.ts, both read as precedent before writing this
 * file): this repo's test script is `tsx --test tests/*.test.ts` — plain
 * Node, no jsdom.
 *
 *   1. `FORMAT_PRESETS` / `durationMinutesForPresetKey` / `teachDraftReadiness`
 *      / `buildTeachingDraftRecord` are plain, pure functions — called
 *      directly, no rendering needed at all.
 *   2. `TeachSection` itself is a stateful ("use client", `useState`)
 *      component, so — exactly like `ClaimComposer` — it can only be
 *      exercised through `react-dom/server`'s `renderToStaticMarkup` for
 *      structural/copy assertions (locked vs. unlocked, notice copy,
 *      assertion-line safety), not through simulated clicks; the pure
 *      builder/readiness functions above are what carry the actual save-flow
 *      logic and are what the mutation proof below targets.
 *   3. The same fixed CSS-Module stub list `tests/claim-panes.test.ts` and
 *      `tests/workspace-shell.test.ts` use (`claim-composer.module.css` plus
 *      `Button`/`Chip`/`Field`'s three — `TeachSection.tsx` itself imports no
 *      `.module.css` of its own, only `Button`/`Chip`/`Field`, so no NEW
 *      stub is needed), plus `fake-indexeddb/auto` for `lib/sync/store.ts`'s
 *      module-level `openDB(...)` call (reached transitively through
 *      `TeachSection`'s own `saveLocalTeachingDraft` import and, in the
 *      WorkspaceShell integration tests below, through `ClaimComposer` too).
 */
import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import type { Application, StudyClaim, StudySession } from "@/lib/contracts/study-v2";

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

interface TeachDraftFields {
  title: string;
  bigIdea: string;
  audience: string;
  gospelConnection: string;
  presetKey: string | null;
}
interface FormatPreset {
  key: string;
  label: string;
  durationMinutes: number;
}
interface TeachDraftReadiness {
  ready: boolean;
  missing: string[];
}
interface TeachingDraft {
  id: string;
  workspaceId: string;
  sessionId: string;
  title: string;
  bigIdea: string;
  audience: string;
  durationMinutes: number;
  gospelConnection: string;
  status: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

const teachModule = nodeRequire("@/components/workspace/TeachSection.tsx") as {
  FORMAT_PRESETS: readonly FormatPreset[];
  BLANK_TEACH_FIELDS: TeachDraftFields;
  durationMinutesForPresetKey: (key: string | null) => number | null;
  teachDraftReadiness: (fields: TeachDraftFields) => TeachDraftReadiness;
  buildTeachingDraftRecord: (params: {
    id: string;
    workspaceId: string;
    sessionId: string;
    fields: TeachDraftFields;
    now: string;
  }) => TeachingDraft;
  TeachSection: (props: {
    workspaceId: string;
    session: StudySession;
    unlocked: boolean;
    onSaved?: (draft: TeachingDraft) => void;
  }) => unknown;
};

const {
  FORMAT_PRESETS,
  BLANK_TEACH_FIELDS,
  durationMinutesForPresetKey,
  teachDraftReadiness,
  buildTeachingDraftRecord,
  TeachSection,
} = teachModule;

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
    readGateAt: "2026-01-01T00:00:00.000Z",
    currentStep: "teach",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function filledFields(overrides: Partial<TeachDraftFields> = {}): TeachDraftFields {
  return {
    title: "Prodigal love",
    bigIdea: "God runs toward the ones who come home.",
    audience: "My small group",
    gospelConnection: "The father's run mirrors the gospel's initiative toward us.",
    presetKey: "15-minute",
    ...overrides,
  };
}

// ===========================================================================
// A. FORMAT_PRESETS / durationMinutesForPresetKey — MUTATION-TARGET
//    (acceptance criterion 9). This is the ONE place the preset -> minutes
//    mapping lives; see this task's commit message for the verbatim
//    before/after `npm test` output of breaking one value here.
// ===========================================================================

test("MUTATION-TARGET: durationMinutesForPresetKey maps each named format preset to its exact stated minute value", () => {
  assert.equal(durationMinutesForPresetKey("60-second"), 1, "60-second must be 1 minute, not 0");
  assert.equal(durationMinutesForPresetKey("5-minute"), 5);
  assert.equal(durationMinutesForPresetKey("15-minute"), 15);
  assert.equal(durationMinutesForPresetKey("30-minute"), 30);
});

test("durationMinutesForPresetKey returns null for an unknown key or null input, never a guessed fallback", () => {
  assert.equal(durationMinutesForPresetKey("2-hour"), null);
  assert.equal(durationMinutesForPresetKey(null), null);
  assert.equal(durationMinutesForPresetKey(""), null);
});

test("FORMAT_PRESETS names exactly the four BUILD_PLAN §4 row 8 formats, in order, each a positive integer minute count", () => {
  assert.deepEqual(
    FORMAT_PRESETS.map((preset) => preset.key),
    ["60-second", "5-minute", "15-minute", "30-minute"],
  );
  for (const preset of FORMAT_PRESETS) {
    assert.ok(Number.isInteger(preset.durationMinutes), `${preset.key} durationMinutes must be an integer`);
    assert.ok(preset.durationMinutes > 0, `${preset.key} durationMinutes must be positive (schema requires positive)`);
  }
});

// ===========================================================================
// B. teachDraftReadiness — pure gate for the save action.
// ===========================================================================

test("teachDraftReadiness: blank fields are not ready, and name every missing piece", () => {
  const readiness = teachDraftReadiness(BLANK_TEACH_FIELDS);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.missing.length, 5);
});

test("teachDraftReadiness: ready once title/bigIdea/audience/gospelConnection are all non-blank and a valid preset is chosen", () => {
  const readiness = teachDraftReadiness(filledFields());
  assert.deepEqual(readiness, { ready: true, missing: [] });
});

test("teachDraftReadiness: whitespace-only text does not count as filled", () => {
  const readiness = teachDraftReadiness(filledFields({ title: "   " }));
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.some((m) => /title/i.test(m)));
});

test("teachDraftReadiness: an unrecognized presetKey is treated the same as none chosen", () => {
  const readiness = teachDraftReadiness(filledFields({ presetKey: "not-a-real-preset" }));
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.some((m) => /long/i.test(m)));
});

// ===========================================================================
// C. buildTeachingDraftRecord — pure record builder.
// ===========================================================================

test("buildTeachingDraftRecord: assembles a full TeachingDraft from filled fields, trimming free text, status 'draft', revision 1", () => {
  const draft = buildTeachingDraftRecord({
    id: "draft-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    fields: filledFields({ title: "  Prodigal love  " }),
    now: "2026-08-21T12:00:00.000Z",
  });
  assert.equal(draft.id, "draft-1");
  assert.equal(draft.workspaceId, "workspace-1");
  assert.equal(draft.sessionId, "session-1");
  assert.equal(draft.title, "Prodigal love", "title must be trimmed");
  assert.equal(draft.durationMinutes, 15, "15-minute preset must set durationMinutes to 15");
  assert.equal(draft.status, "draft");
  assert.equal(draft.revision, 1);
  assert.equal(draft.createdAt, "2026-08-21T12:00:00.000Z");
  assert.equal(draft.updatedAt, "2026-08-21T12:00:00.000Z");
  assert.equal(draft.deletedAt, null);
});

test("buildTeachingDraftRecord: the 60-second preset writes durationMinutes 1, never 0", () => {
  const draft = buildTeachingDraftRecord({
    id: "draft-2",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    fields: filledFields({ presetKey: "60-second" }),
    now: "2026-08-21T12:00:00.000Z",
  });
  assert.equal(draft.durationMinutes, 1);
});

test("buildTeachingDraftRecord throws rather than silently building an incomplete record when a required field is missing", () => {
  assert.throws(() =>
    buildTeachingDraftRecord({
      id: "draft-3",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      fields: filledFields({ title: "" }),
      now: "2026-08-21T12:00:00.000Z",
    }),
  );
  assert.throws(() =>
    buildTeachingDraftRecord({
      id: "draft-4",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      fields: filledFields({ presetKey: null }),
      now: "2026-08-21T12:00:00.000Z",
    }),
  );
});

// ===========================================================================
// D. RENDER TeachSection — locked and unlocked.
// ===========================================================================

test("RENDER TeachSection: locked shows LockedNotice only -- no form, no outline notice", () => {
  const html = renderToStaticMarkup(
    createElement(TeachSection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: false,
    }),
  );
  assert.ok(html.includes('data-testid="teach-locked"'));
  assert.ok(!html.includes('data-testid="teach-outline-not-available-notice"'));
  assert.ok(!html.includes("What will you call this teaching?"));
});

test("RENDER TeachSection: unlocked mounts the real form plus the honest outline-not-available notice naming what IS saved", () => {
  const html = renderToStaticMarkup(
    createElement(TeachSection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: true,
    }),
  );
  assert.ok(!html.includes('data-testid="teach-locked"'));
  assert.ok(html.includes('data-testid="teach-outline-not-available-notice"'));
  assert.match(html, /section by section isn.t available yet/i);
  assert.match(html, /title, big idea, audience, length, and gospel connection/i);
  assert.ok(html.includes("What will you call this teaching?"));
  assert.ok(html.includes("What is the big idea you want to teach?"));
  assert.ok(html.includes("Who will you teach this to?"));
  assert.ok(html.includes("How does this connect to the gospel?"));
  for (const preset of FORMAT_PRESETS) {
    assert.ok(html.includes(`data-preset="${preset.key}"`), `${preset.key} chip missing`);
    assert.ok(html.includes(preset.label), `${preset.key} label missing`);
  }
});

test("TeachSection's own lock copy names the real gate -- finalizing an application", () => {
  const html = renderToStaticMarkup(
    createElement(TeachSection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: false,
    }),
  );
  assert.match(html, /finalize an application/i);
});

// ===========================================================================
// E. ASSERTION-LINE (acceptance criterion 5) -- every free-text prompt asks
//    what the LEARNER will teach, never what the app asserts the passage
//    means. Same forbidden-phrase check as tests/claim-panes.test.ts and
//    tests/workspace-shell.test.ts, run against Teach's own copy.
// ===========================================================================

test("ASSERTION-LINE: TeachSection's unlocked copy never asserts what the passage means -- every prompt asks the learner what THEY will teach", () => {
  const html = renderToStaticMarkup(
    createElement(TeachSection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: true,
    }),
  );
  assert.doesNotMatch(
    html,
    /this passage means|the correct (view|interpretation)|this proves|teaches that/i,
    "verdict-language leak in TeachSection's unlocked copy",
  );
  // Positive check, not just absence: the four prompts are phrased as
  // questions addressed to the learner ("you"/"your own"), not declarative
  // statements about the text.
  assert.match(html, /you (will )?teach|your own words|you want to teach/i);
});

test("ASSERTION-LINE: TeachSection's locked copy also never asserts what the passage means", () => {
  const html = renderToStaticMarkup(
    createElement(TeachSection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: false,
    }),
  );
  assert.doesNotMatch(html, /this passage means|the correct (view|interpretation)|this proves|teaches that/i);
});

// ===========================================================================
// F. Full WorkspaceShell integration -- Teach reachable only once >=1
//    finalized Application exists, exactly the existing gate.
// ===========================================================================

function renderShell(props: { session: StudySession; claims?: StudyClaim[]; applications?: Application[] }): string {
  const element = createElement(WorkspaceShell as never, { workspaceId: "workspace-1", ...props } as never);
  return renderToStaticMarkup(element as never);
}

test("SHELL: Teach's real form does NOT mount with zero applications", () => {
  const html = renderShell({ session: sampleSession({ currentStep: "teach" }), claims: [], applications: [] });
  assert.ok(html.includes('data-testid="teach-locked"'));
  assert.ok(!html.includes("What will you call this teaching?"));
});

test("SHELL: Teach's real form does NOT mount with a draft (non-finalized) application", () => {
  const html = renderShell({
    session: sampleSession({ currentStep: "teach" }),
    claims: [],
    applications: [
      {
        id: "app-1",
        workspaceId: "workspace-1",
        sessionId: "session-1",
        sourceClaimId: "claim-1",
        originalAudienceMeaning: "m",
        enduringPrinciple: "p",
        canonicalBridge: "b",
        applicationClass: "c",
        promiseScope: "s",
        modernDomain: "relationships",
        situation: "sit",
        responseType: "action",
        faithfulResponse: "r",
        cautions: "",
        availableAfter: null,
        status: "draft",
        revision: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
      },
    ],
  });
  assert.ok(html.includes('data-testid="teach-locked"'));
});

test("SHELL (mutation-proof precedent, criterion 9): Teach's real form MOUNTS once an application is finalized (any non-draft, non-empty status)", () => {
  const html = renderShell({
    session: sampleSession({ currentStep: "teach" }),
    claims: [],
    applications: [
      {
        id: "app-1",
        workspaceId: "workspace-1",
        sessionId: "session-1",
        sourceClaimId: "claim-1",
        originalAudienceMeaning: "m",
        enduringPrinciple: "p",
        canonicalBridge: "b",
        applicationClass: "c",
        promiseScope: "s",
        modernDomain: "relationships",
        situation: "sit",
        responseType: "action",
        faithfulResponse: "r",
        cautions: "",
        availableAfter: null,
        status: "finalized",
        revision: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
      },
    ],
  });
  assert.ok(!html.includes('data-testid="teach-locked"'));
  assert.ok(html.includes("What will you call this teaching?"));
});

// ===========================================================================
// MUTATION PROOFS — see this task's commit message for the verbatim
// before/after `npm test` output these mutations actually produced.
//
//   (a) FORMAT_PRESETS mapping (TeachSection.tsx): the "15-minute" entry's
//       `durationMinutes: 15` mutated to `durationMinutes: 16`. Named test
//       that fails: "MUTATION-TARGET: durationMinutesForPresetKey maps each
//       named format preset to its exact stated minute value" (and, as a
//       second, independent catch, "buildTeachingDraftRecord: assembles a
//       full TeachingDraft from filled fields..." — its own assertion
//       `draft.durationMinutes, 15` also fails against the mutated value).
//   (b) Theology-without-Connect re-proof (lib/workspace/gating.ts,
//       `computeStepGates`'s `theology: hasAnyClaim(claims)` line, RE-RUN
//       against this task's own changes to confirm the prior-wave regression
//       guard still holds): mutated to
//       `theology: hasAnyClaim(claims) && hasAttemptedComparison(claims)`.
//       Named tests that fail: tests/workspace-shell.test.ts's own "GATE:
//       Theology unlocks with a bare observation and ZERO connections --
//       'Theology does not require a Connection first'", plus
//       tests/claim-panes.test.ts's "SHELL (criterion 8b regression guard):
//       Theology's real composer MOUNTS with a bare observation claim and
//       ZERO connections..." and "SHELL: all four real sections' offered-kind
//       chips are reachable end-to-end...".
//
// Both mutations were applied directly to their real production files
// (`components/workspace/TeachSection.tsx` and `lib/workspace/gating.ts`,
// both read via a backup copy made before mutating), `npm test` was run and
// confirmed the named tests above FAILING (and no other unrelated test), each
// file was restored from its own pre-mutation backup, `diff` confirmed the
// restored file byte-identical to the original, and `npm test` was re-run
// and confirmed green again.
// ===========================================================================
