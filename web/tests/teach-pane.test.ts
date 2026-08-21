/**
 * TEACHDRAFTPANE-001 (wave 17) / TEACHOUTLINE-001 (this task) — the Teach
 * section of the Passage Workspace (`components/workspace/TeachSection.tsx`),
 * BUILD_PLAN §4 row 8.
 *
 * TEST-ENVIRONMENT NOTE (same discipline as tests/claim-panes.test.ts and
 * tests/workspace-shell.test.ts, both read as precedent before writing this
 * file): this repo's test script is `tsx --test tests/*.test.ts` — plain
 * Node, no jsdom.
 *
 *   1. `FORMAT_PRESETS` / `durationMinutesForPresetKey` / `teachDraftReadiness`
 *      / `buildTeachingDraftRecord` / `pickCurrentDraft` /
 *      `sectionFieldsReadiness` / `nextSectionSortOrder` /
 *      `buildTeachingSectionRecord` / `activeSectionsForDraft` /
 *      `swapSectionOrder` / `buildRemovedSectionRecord` / `persistNewSection`
 *      / `persistSectionReorder` / `persistSectionRemoval` are plain
 *      functions (the last three async) — called directly, no rendering
 *      needed at all. This is where TEACHOUTLINE-001's add/reorder/remove
 *      logic and its real-vault mutation proofs live.
 *   2. `TeachSection` itself is a stateful ("use client", `useState`,
 *      `useEffect`) component, so — exactly like `ClaimComposer` — it can
 *      only be exercised through `react-dom/server`'s `renderToStaticMarkup`
 *      for structural/copy assertions (locked vs. unlocked, notice copy,
 *      assertion-line safety), not through simulated clicks or its own
 *      `useEffect` vault load (SSR has no browser commit phase, so that
 *      effect never fires here — the same reason `ConnectSection.tsx`'s own
 *      `UserThreadsPanel` fetch never fires in `tests/connect-pane.test.ts`).
 *      `TeachOutlinePanel` is the HOOKLESS half of the outline UI
 *      (`ConnectSection.tsx`'s `EvidenceLabelField` / `ClaimComposer.tsx`'s
 *      `PromoteFields` precedent) — rendered directly with controlled props
 *      below for the outline's own structural/copy/mutation coverage,
 *      without needing `TeachSection`'s effect to ever run.
 *   3. The same fixed CSS-Module stub list `tests/claim-panes.test.ts` and
 *      `tests/workspace-shell.test.ts` use (`claim-composer.module.css` plus
 *      `Button`/`Chip`/`Field`'s three — `TeachSection.tsx` itself imports no
 *      `.module.css` of its own, only `Button`/`Chip`/`Field`, so no NEW
 *      stub is needed), plus `fake-indexeddb/auto` for `lib/sync/store.ts`'s
 *      module-level `openDB(...)` call (reached transitively through
 *      `TeachSection`'s own imports and, in the WorkspaceShell integration
 *      tests below, through `ClaimComposer` too). The `persistNewSection` /
 *      `persistSectionReorder` / `persistSectionRemoval` real-vault-writer
 *      tests below use this SAME fake-indexeddb instance directly (via the
 *      real, unmocked `saveLocalTeachingSection`/`listLocalV2Entities`) to
 *      prove persistence actually happens, not merely that a pure function
 *      returns the right value — each test picks a fresh, unique id/draftId
 *      so it cannot collide with any other test's rows in that single
 *      shared fake database.
 */
import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import { TEACHING_SECTION_KINDS } from "@/lib/contracts/study-v2";
import type { Application, StudyClaim, StudySession } from "@/lib/contracts/study-v2";
import { listLocalV2Entities } from "@/lib/sync/store";

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
type TeachingSectionKind = (typeof TEACHING_SECTION_KINDS)[number];
interface TeachingSection {
  id: string;
  workspaceId: string;
  draftId: string;
  kind: TeachingSectionKind;
  sortOrder: number;
  body: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}
interface NewSectionFields {
  kind: TeachingSectionKind | null;
  body: string;
}
interface SectionFieldsReadiness {
  ready: boolean;
  missing: string[];
}
interface ReorderResult {
  updated: [TeachingSection, TeachingSection];
}
type SaveSection = (section: TeachingSection) => Promise<void>;

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
  pickCurrentDraft: (drafts: readonly TeachingDraft[], sessionId: string) => TeachingDraft | null;
  BLANK_SECTION_FIELDS: NewSectionFields;
  sectionFieldsReadiness: (fields: NewSectionFields) => SectionFieldsReadiness;
  nextSectionSortOrder: (sections: readonly TeachingSection[], draftId: string) => number;
  buildTeachingSectionRecord: (params: {
    id: string;
    workspaceId: string;
    draftId: string;
    fields: NewSectionFields;
    sortOrder: number;
    now: string;
  }) => TeachingSection;
  activeSectionsForDraft: (sections: readonly TeachingSection[], draftId: string) => TeachingSection[];
  swapSectionOrder: (
    ordered: readonly TeachingSection[],
    sectionId: string,
    direction: "up" | "down",
    now: string,
  ) => ReorderResult | null;
  buildRemovedSectionRecord: (section: TeachingSection, now: string) => TeachingSection;
  persistNewSection: (params: {
    id: string;
    workspaceId: string;
    draftId: string;
    fields: NewSectionFields;
    existingSections: readonly TeachingSection[];
    now: string;
    save?: SaveSection;
  }) => Promise<TeachingSection>;
  persistSectionReorder: (
    ordered: readonly TeachingSection[],
    sectionId: string,
    direction: "up" | "down",
    now: string,
    save?: SaveSection,
  ) => Promise<ReorderResult | null>;
  persistSectionRemoval: (section: TeachingSection, now: string, save?: SaveSection) => Promise<TeachingSection>;
  TeachOutlinePanel: (props: {
    sections: readonly TeachingSection[];
    disabled: boolean;
    newSectionFields: NewSectionFields;
    sectionReadiness: SectionFieldsReadiness;
    onFieldsChange: (fields: NewSectionFields) => void;
    onAddSection: (event: unknown) => void;
    onMove: (sectionId: string, direction: "up" | "down") => void;
    onRemove: (sectionId: string) => void;
    addStatus: "idle" | "saving" | "saved" | "error";
    addMessage: string;
  }) => unknown;
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
  pickCurrentDraft,
  BLANK_SECTION_FIELDS,
  sectionFieldsReadiness,
  nextSectionSortOrder,
  buildTeachingSectionRecord,
  activeSectionsForDraft,
  swapSectionOrder,
  buildRemovedSectionRecord,
  persistNewSection,
  persistSectionReorder,
  persistSectionRemoval,
  TeachOutlinePanel,
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

function sampleDraft(overrides: Partial<TeachingDraft> = {}): TeachingDraft {
  return {
    id: "draft-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    title: "Prodigal love",
    bigIdea: "God runs toward the ones who come home.",
    audience: "My small group",
    durationMinutes: 15,
    gospelConnection: "The father's run mirrors the gospel's initiative toward us.",
    status: "draft",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function sampleSectionFields(overrides: Partial<NewSectionFields> = {}): NewSectionFields {
  return { kind: "outline", body: "First, I'll set the scene.", ...overrides };
}

function sampleSection(overrides: Partial<TeachingSection> = {}): TeachingSection {
  return {
    id: "section-1",
    workspaceId: "workspace-1",
    draftId: "draft-1",
    kind: "outline",
    sortOrder: 0,
    body: "First, I'll set the scene.",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

/** Independently written (NOT imported from ClaimComposer.tsx's humanizeToken) so the expected label is not derived from the code under test. */
function expectedKindLabel(kind: string): string {
  const words = kind.split("_");
  return [words[0].charAt(0).toUpperCase() + words[0].slice(1), ...words.slice(1)].join(" ");
}

// ===========================================================================
// A. FORMAT_PRESETS / durationMinutesForPresetKey — MUTATION-TARGET
//    (acceptance criterion 9, TEACHDRAFTPANE-001). This is the ONE place the
//    preset -> minutes mapping lives; see this task's commit message for the
//    verbatim before/after `npm test` output of breaking one value here.
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

test("RENDER TeachSection: locked shows LockedNotice only -- no form, no outline area", () => {
  const html = renderToStaticMarkup(
    createElement(TeachSection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: false,
    }),
  );
  assert.ok(html.includes('data-testid="teach-locked"'));
  assert.ok(!html.includes("What will you call this teaching?"));
  assert.ok(!html.includes('data-testid="teach-outline-panel"'));
});

test("RENDER TeachSection: unlocked mounts the real draft form -- and the outline area honestly reports it is checking this device (SSR never runs the vault-load effect, so no drafts are known yet)", () => {
  const html = renderToStaticMarkup(
    createElement(TeachSection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: true,
    }),
  );
  assert.ok(!html.includes('data-testid="teach-locked"'));
  assert.ok(html.includes("What will you call this teaching?"));
  assert.ok(html.includes("What is the big idea you want to teach?"));
  assert.ok(html.includes("Who will you teach this to?"));
  assert.ok(html.includes("How does this connect to the gospel?"));
  for (const preset of FORMAT_PRESETS) {
    assert.ok(html.includes(`data-preset="${preset.key}"`), `${preset.key} chip missing`);
    assert.ok(html.includes(preset.label), `${preset.key} label missing`);
  }
  // The outline area exists but honestly shows "checking" state, never a
  // fabricated draft or a silently blank area.
  assert.ok(html.includes('data-testid="teach-outline-checking"'));
  assert.ok(!html.includes('data-testid="teach-outline-panel"'), "the outline panel must not render before a draft is known to exist");
  assert.ok(!html.includes('data-testid="teach-outline-awaiting-draft"'));
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
// E. ASSERTION-LINE (acceptance criterion 5, TEACHDRAFTPANE-001) -- every
//    free-text prompt asks what the LEARNER will teach, never what the app
//    asserts the passage means. Same forbidden-phrase check as
//    tests/claim-panes.test.ts and tests/workspace-shell.test.ts, run
//    against Teach's own copy (draft form + outline area intro/loading
//    copy).
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
// G. pickCurrentDraft (acceptance criterion 1, TEACHOUTLINE-001) -- "most
//    recently created, non-deleted draft for this session" default.
// ===========================================================================

test("pickCurrentDraft: returns null when there are no drafts at all", () => {
  assert.equal(pickCurrentDraft([], "session-1"), null);
});

test("pickCurrentDraft: returns null when the only draft for this session is soft-deleted", () => {
  const drafts = [sampleDraft({ id: "d1", sessionId: "session-1", deletedAt: "2026-02-01T00:00:00.000Z" })];
  assert.equal(pickCurrentDraft(drafts, "session-1"), null);
});

test("pickCurrentDraft: ignores drafts belonging to other sessions", () => {
  const drafts = [sampleDraft({ id: "d1", sessionId: "other-session" })];
  assert.equal(pickCurrentDraft(drafts, "session-1"), null);
});

test("pickCurrentDraft: returns the most-recently-created active draft for this session", () => {
  const drafts = [
    sampleDraft({ id: "d1", sessionId: "session-1", createdAt: "2026-01-01T00:00:00.000Z" }),
    sampleDraft({ id: "d2", sessionId: "session-1", createdAt: "2026-03-01T00:00:00.000Z" }),
    sampleDraft({ id: "d3", sessionId: "session-1", createdAt: "2026-02-01T00:00:00.000Z" }),
    sampleDraft({ id: "d4", sessionId: "other-session", createdAt: "2026-06-01T00:00:00.000Z" }),
  ];
  const picked = pickCurrentDraft(drafts, "session-1");
  assert.equal(picked?.id, "d2");
});

test("pickCurrentDraft: a soft-deleted, later draft does not shadow an earlier active one", () => {
  const drafts = [
    sampleDraft({ id: "d1", sessionId: "session-1", createdAt: "2026-01-01T00:00:00.000Z" }),
    sampleDraft({ id: "d2", sessionId: "session-1", createdAt: "2026-03-01T00:00:00.000Z", deletedAt: "2026-04-01T00:00:00.000Z" }),
  ];
  const picked = pickCurrentDraft(drafts, "session-1");
  assert.equal(picked?.id, "d1");
});

// ===========================================================================
// H. sectionFieldsReadiness -- pure gate for the "add outline point" action.
// ===========================================================================

test("sectionFieldsReadiness: blank fields are not ready and name both missing pieces", () => {
  const readiness = sectionFieldsReadiness(BLANK_SECTION_FIELDS);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.missing.length, 2);
});

test("sectionFieldsReadiness: ready once a kind is chosen and body is non-blank", () => {
  const readiness = sectionFieldsReadiness(sampleSectionFields());
  assert.deepEqual(readiness, { ready: true, missing: [] });
});

test("sectionFieldsReadiness: whitespace-only body does not count as filled", () => {
  const readiness = sectionFieldsReadiness(sampleSectionFields({ body: "   " }));
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.some((m) => /outline/i.test(m)));
});

// ===========================================================================
// I. nextSectionSortOrder -- MUTATION-TARGET (acceptance criterion 10a).
// ===========================================================================

test("MUTATION-TARGET: nextSectionSortOrder returns 0 when no sections exist yet for that draft", () => {
  assert.equal(nextSectionSortOrder([], "draft-1"), 0);
  assert.equal(nextSectionSortOrder([sampleSection({ draftId: "other-draft", sortOrder: 5 })], "draft-1"), 0);
});

test("MUTATION-TARGET: nextSectionSortOrder returns one past the current max sortOrder among ONLY that draft's non-deleted sections", () => {
  const sections = [
    sampleSection({ id: "s1", draftId: "draft-1", sortOrder: 0 }),
    sampleSection({ id: "s2", draftId: "draft-1", sortOrder: 1 }),
    sampleSection({ id: "s3", draftId: "draft-1", sortOrder: 9, deletedAt: "2026-02-01T00:00:00.000Z" }), // deleted -- must be ignored
    sampleSection({ id: "s4", draftId: "other-draft", sortOrder: 40 }), // different draft -- must be ignored
  ];
  assert.equal(
    nextSectionSortOrder(sections, "draft-1"),
    2,
    "must be one past the max ACTIVE sortOrder for THIS draft (1 + 1 = 2), not influenced by the deleted sortOrder 9 row or the other draft's sortOrder 40 row",
  );
});

// ===========================================================================
// J. buildTeachingSectionRecord -- pure record builder.
// ===========================================================================

test("buildTeachingSectionRecord: assembles a full TeachingSection, trimming the body", () => {
  const section = buildTeachingSectionRecord({
    id: "section-9",
    workspaceId: "workspace-1",
    draftId: "draft-1",
    fields: sampleSectionFields({ kind: "context", body: "  Some context.  " }),
    sortOrder: 3,
    now: "2026-08-21T12:00:00.000Z",
  });
  assert.equal(section.id, "section-9");
  assert.equal(section.draftId, "draft-1");
  assert.equal(section.kind, "context");
  assert.equal(section.sortOrder, 3);
  assert.equal(section.body, "Some context.");
  assert.equal(section.revision, 1);
  assert.equal(section.createdAt, "2026-08-21T12:00:00.000Z");
  assert.equal(section.updatedAt, "2026-08-21T12:00:00.000Z");
  assert.equal(section.deletedAt, null);
});

test("buildTeachingSectionRecord throws rather than silently building an incomplete record", () => {
  assert.throws(() =>
    buildTeachingSectionRecord({
      id: "section-10",
      workspaceId: "workspace-1",
      draftId: "draft-1",
      fields: sampleSectionFields({ kind: null }),
      sortOrder: 0,
      now: "2026-08-21T12:00:00.000Z",
    }),
  );
  assert.throws(() =>
    buildTeachingSectionRecord({
      id: "section-11",
      workspaceId: "workspace-1",
      draftId: "draft-1",
      fields: sampleSectionFields({ body: "   " }),
      sortOrder: 0,
      now: "2026-08-21T12:00:00.000Z",
    }),
  );
});

// ===========================================================================
// K. activeSectionsForDraft -- filter + sort, the display-order source.
// ===========================================================================

test("activeSectionsForDraft: filters to one draft, excludes soft-deleted rows, sorts by sortOrder", () => {
  const sections = [
    sampleSection({ id: "s3", draftId: "draft-1", sortOrder: 2 }),
    sampleSection({ id: "s1", draftId: "draft-1", sortOrder: 0 }),
    sampleSection({ id: "deleted", draftId: "draft-1", sortOrder: 1, deletedAt: "2026-02-01T00:00:00.000Z" }),
    sampleSection({ id: "s2", draftId: "draft-1", sortOrder: 1 }),
    sampleSection({ id: "other", draftId: "other-draft", sortOrder: 0 }),
  ];
  const ordered = activeSectionsForDraft(sections, "draft-1");
  assert.deepEqual(ordered.map((s) => s.id), ["s1", "s2", "s3"]);
});

// ===========================================================================
// L. swapSectionOrder -- pure reorder step.
// ===========================================================================

test("swapSectionOrder: swaps two adjacent sections' sortOrder values and bumps revision/updatedAt on both", () => {
  const a = sampleSection({ id: "a", sortOrder: 0, revision: 1 });
  const b = sampleSection({ id: "b", sortOrder: 1, revision: 4 });
  const result = swapSectionOrder([a, b], "b", "up", "2026-08-21T13:00:00.000Z");
  assert.ok(result);
  // Looked up by id rather than assumed tuple order -- swapSectionOrder's
  // own contract (this file's header) only promises BOTH records come back
  // updated, not which position in the tuple each occupies.
  const updatedA = result!.updated.find((s) => s.id === "a")!;
  const updatedB = result!.updated.find((s) => s.id === "b")!;
  assert.ok(updatedA);
  assert.ok(updatedB);
  assert.equal(updatedA.sortOrder, 1, "a takes b's old sortOrder");
  assert.equal(updatedA.revision, 2);
  assert.equal(updatedA.updatedAt, "2026-08-21T13:00:00.000Z");
  assert.equal(updatedB.sortOrder, 0, "b takes a's old sortOrder");
  assert.equal(updatedB.revision, 5);
  assert.equal(updatedB.updatedAt, "2026-08-21T13:00:00.000Z");
});

test("swapSectionOrder: moving the first section up returns null (boundary, no-op)", () => {
  const a = sampleSection({ id: "a", sortOrder: 0 });
  const b = sampleSection({ id: "b", sortOrder: 1 });
  assert.equal(swapSectionOrder([a, b], "a", "up", "2026-08-21T13:00:00.000Z"), null);
});

test("swapSectionOrder: moving the last section down returns null (boundary, no-op)", () => {
  const a = sampleSection({ id: "a", sortOrder: 0 });
  const b = sampleSection({ id: "b", sortOrder: 1 });
  assert.equal(swapSectionOrder([a, b], "b", "down", "2026-08-21T13:00:00.000Z"), null);
});

test("swapSectionOrder: an unknown sectionId returns null rather than throwing", () => {
  const a = sampleSection({ id: "a", sortOrder: 0 });
  assert.equal(swapSectionOrder([a], "does-not-exist", "up", "2026-08-21T13:00:00.000Z"), null);
});

// ===========================================================================
// M. buildRemovedSectionRecord -- soft delete (acceptance criterion 6).
// ===========================================================================

test("buildRemovedSectionRecord: sets deletedAt and bumps revision/updatedAt -- every other field untouched", () => {
  const section = sampleSection({ revision: 2 });
  const removed = buildRemovedSectionRecord(section, "2026-08-21T14:00:00.000Z");
  assert.equal(removed.deletedAt, "2026-08-21T14:00:00.000Z");
  assert.equal(removed.revision, 3);
  assert.equal(removed.updatedAt, "2026-08-21T14:00:00.000Z");
  assert.equal(removed.id, section.id);
  assert.equal(removed.body, section.body);
  assert.equal(removed.kind, section.kind);
  assert.equal(removed.sortOrder, section.sortOrder);
});

// ===========================================================================
// N. persistNewSection / persistSectionReorder / persistSectionRemoval --
//    where pure logic meets the real vault writer. First with an injected
//    fake `save` (isolates exactly what got written), then against the
//    REAL fake-indexeddb-backed vault (`saveLocalTeachingSection` /
//    `listLocalV2Entities`, unmocked) to prove actual persistence, per
//    acceptance criterion 4's own wording: "a page reload must show the new
//    order."
// ===========================================================================

test("persistNewSection: computes sortOrder from existingSections and persists exactly one record through the given save function", async () => {
  const saved: TeachingSection[] = [];
  const record = await persistNewSection({
    id: "section-fake-1",
    workspaceId: "workspace-1",
    draftId: "draft-1",
    fields: sampleSectionFields({ kind: "context", body: "  Some context.  " }),
    existingSections: [sampleSection({ id: "existing", draftId: "draft-1", sortOrder: 0 })],
    now: "2026-08-21T12:00:00.000Z",
    save: async (s) => {
      saved.push(s);
    },
  });
  assert.equal(record.sortOrder, 1);
  assert.equal(record.body, "Some context.");
  assert.deepEqual(saved, [record]);
});

test("persistNewSection with the REAL vault writer: a fresh listLocalV2Entities read shows the new section", async () => {
  const id = "section-real-new-1";
  const record = await persistNewSection({
    id,
    workspaceId: "workspace-1",
    draftId: "draft-real-new-1",
    fields: sampleSectionFields(),
    existingSections: [],
    now: "2026-08-21T12:00:00.000Z",
  });
  const reloaded = (await listLocalV2Entities("teachingSection")).find((s) => s.id === id);
  assert.ok(reloaded, "section not found after a real vault write");
  assert.deepEqual(reloaded, record);
});

test("persistSectionReorder: computes the swap and persists BOTH updated sections through the given save function", async () => {
  const saved: TeachingSection[] = [];
  const a = sampleSection({ id: "a", sortOrder: 0 });
  const b = sampleSection({ id: "b", sortOrder: 1 });
  const result = await persistSectionReorder([a, b], "b", "up", "2026-08-21T13:00:00.000Z", async (s) => {
    saved.push(s);
  });
  assert.ok(result);
  assert.equal(saved.length, 2, "both swapped sections must be persisted, not just one");
  assert.ok(saved.some((s) => s.id === "a" && s.sortOrder === 1));
  assert.ok(saved.some((s) => s.id === "b" && s.sortOrder === 0));
});

test("persistSectionReorder: a boundary move (nothing to swap) persists nothing and returns null", async () => {
  const saved: TeachingSection[] = [];
  const a = sampleSection({ id: "a", sortOrder: 0 });
  const b = sampleSection({ id: "b", sortOrder: 1 });
  const result = await persistSectionReorder([a, b], "a", "up", "2026-08-21T13:00:00.000Z", async (s) => {
    saved.push(s);
  });
  assert.equal(result, null);
  assert.equal(saved.length, 0);
});

test("MUTATION-TARGET: persistSectionReorder actually persists BOTH swapped sections through the REAL vault writer -- a fresh read afterward shows the new order, not just in-memory state", async () => {
  const draftId = "draft-real-reorder-1";
  const t0 = "2026-08-21T12:00:00.000Z";
  const first = await persistNewSection({
    id: "reorder-a-1",
    workspaceId: "workspace-1",
    draftId,
    fields: sampleSectionFields({ kind: "outline", body: "First point" }),
    existingSections: [],
    now: t0,
  });
  const second = await persistNewSection({
    id: "reorder-b-1",
    workspaceId: "workspace-1",
    draftId,
    fields: sampleSectionFields({ kind: "context", body: "Second point" }),
    existingSections: [first],
    now: t0,
  });
  assert.equal(first.sortOrder, 0);
  assert.equal(second.sortOrder, 1);

  const ordered = activeSectionsForDraft([first, second], draftId);
  const result = await persistSectionReorder(ordered, second.id, "up", "2026-08-21T12:05:00.000Z");
  assert.ok(result, "adjacent, non-boundary move must produce a swap");

  const reloaded = activeSectionsForDraft(
    (await listLocalV2Entities("teachingSection")).filter((s) => s.draftId === draftId),
    draftId,
  );
  assert.deepEqual(
    reloaded.map((s) => s.id),
    [second.id, first.id],
    "a reload (fresh listLocalV2Entities read) must show the new order, not just the in-memory ReorderResult",
  );
});

test("persistSectionRemoval: soft-deletes (sets deletedAt) and persists exactly one record through the given save function -- not a hard delete", async () => {
  const saved: TeachingSection[] = [];
  const target = sampleSection({ id: "to-remove-fake-1" });
  const updated = await persistSectionRemoval(target, "2026-08-21T14:00:00.000Z", async (s) => {
    saved.push(s);
  });
  assert.equal(updated.deletedAt, "2026-08-21T14:00:00.000Z");
  assert.equal(updated.revision, target.revision + 1);
  assert.deepEqual(saved, [updated]);
});

test("persistSectionRemoval with the REAL vault writer: a fresh read shows the row STILL EXISTS with deletedAt set, and activeSectionsForDraft excludes it -- proving this is a soft delete, not a hard delete", async () => {
  const draftId = "draft-real-remove-1";
  const created = await persistNewSection({
    id: "remove-real-1",
    workspaceId: "workspace-1",
    draftId,
    fields: sampleSectionFields(),
    existingSections: [],
    now: "2026-08-21T12:00:00.000Z",
  });
  await persistSectionRemoval(created, "2026-08-21T12:10:00.000Z");
  const all = await listLocalV2Entities("teachingSection");
  const reloaded = all.find((s) => s.id === created.id);
  assert.ok(reloaded, "row must still exist in the vault after remove -- a hard delete would make it disappear entirely");
  assert.ok(reloaded!.deletedAt, "deletedAt must be set");
  assert.deepEqual(
    activeSectionsForDraft(all, draftId),
    [],
    "a soft-deleted section must not appear in the active/display list even though its row still exists",
  );
});

// ===========================================================================
// O. RENDER TeachOutlinePanel (hookless) -- structural/copy coverage without
//    waiting on TeachSection's own useEffect vault load.
// ===========================================================================

function outlinePanelProps(
  overrides: Partial<{
    sections: TeachingSection[];
    disabled: boolean;
    newSectionFields: NewSectionFields;
    addStatus: "idle" | "saving" | "saved" | "error";
    addMessage: string;
  }> = {},
) {
  const newSectionFields = overrides.newSectionFields ?? BLANK_SECTION_FIELDS;
  return {
    sections: overrides.sections ?? [],
    disabled: overrides.disabled ?? false,
    newSectionFields,
    sectionReadiness: sectionFieldsReadiness(newSectionFields),
    onFieldsChange: () => {},
    onAddSection: () => {},
    onMove: () => {},
    onRemove: () => {},
    addStatus: overrides.addStatus ?? "idle",
    addMessage: overrides.addMessage ?? "",
  };
}

test("RENDER TeachOutlinePanel: zero sections shows the honest, clearly-labeled empty state -- never a silently blank area", () => {
  const html = renderToStaticMarkup(createElement(TeachOutlinePanel as never, outlinePanelProps()));
  assert.ok(html.includes('data-testid="teach-outline-empty"'));
  assert.match(html, /No outline points yet/);
  assert.ok(!html.includes('data-testid="teach-outline-list"'));
});

test("RENDER TeachOutlinePanel: the kind picker offers exactly TEACHING_SECTION_KINDS, one chip per kind, derived from the live array", () => {
  const html = renderToStaticMarkup(createElement(TeachOutlinePanel as never, outlinePanelProps()));
  for (const kind of TEACHING_SECTION_KINDS) {
    assert.ok(html.includes(`data-value="${kind}"`), `${kind} chip missing`);
  }
});

test("NOTHING DEFAULTS (acceptance criterion 7): with BLANK_SECTION_FIELDS, no outline-kind chip starts pressed", () => {
  const html = renderToStaticMarkup(
    createElement(TeachOutlinePanel as never, outlinePanelProps({ newSectionFields: BLANK_SECTION_FIELDS })),
  );
  assert.doesNotMatch(html, /aria-pressed="true"/, `a kind was pre-selected with nothing chosen:\n${html}`);
});

test("RENDER TeachOutlinePanel: with sections, each renders its own kind and its own body text, in the given order", () => {
  const sections = [
    sampleSection({ id: "s1", kind: "outline", sortOrder: 0, body: "Open with the parable itself." }),
    sampleSection({ id: "s2", kind: "not_justified", sortOrder: 1, body: "This detail alone is not enough for me yet." }),
  ];
  const html = renderToStaticMarkup(createElement(TeachOutlinePanel as never, outlinePanelProps({ sections })));
  assert.ok(html.includes('data-testid="teach-outline-list"'));
  assert.ok(!html.includes('data-testid="teach-outline-empty"'));
  assert.match(html, />Outline</);
  assert.match(html, />Not justified</);
  assert.ok(html.includes("Open with the parable itself."));
  assert.ok(html.includes("This detail alone is not enough for me yet."));
});

function outlineItemsHtml(html: string): string[] {
  const marker = '<li data-testid="teach-outline-item">';
  return html
    .split(marker)
    .slice(1)
    .map((part) => part.split("</li>")[0]);
}

function buttonHtml(segment: string, label: string): string {
  const match = segment.match(new RegExp(`<button[^>]*>${label}</button>`));
  assert.ok(match, `button "${label}" not found in segment:\n${segment}`);
  return match![0];
}

test("RENDER TeachOutlinePanel: the first item's Move up is disabled, the last item's Move down is disabled -- middle items are fully enabled", () => {
  const sections = [
    sampleSection({ id: "s1", sortOrder: 0 }),
    sampleSection({ id: "s2", sortOrder: 1 }),
    sampleSection({ id: "s3", sortOrder: 2 }),
  ];
  const html = renderToStaticMarkup(createElement(TeachOutlinePanel as never, outlinePanelProps({ sections })));
  const items = outlineItemsHtml(html);
  assert.equal(items.length, 3);
  assert.ok(buttonHtml(items[0], "Move up").includes("disabled"), "first item's Move up must be disabled");
  assert.ok(!buttonHtml(items[0], "Move down").includes("disabled"), "first item's Move down must be enabled");
  assert.ok(!buttonHtml(items[1], "Move up").includes("disabled"), "middle item's Move up must be enabled");
  assert.ok(!buttonHtml(items[1], "Move down").includes("disabled"), "middle item's Move down must be enabled");
  assert.ok(!buttonHtml(items[2], "Move up").includes("disabled"), "last item's Move up must be enabled");
  assert.ok(buttonHtml(items[2], "Move down").includes("disabled"), "last item's Move down must be disabled");
});

test("RENDER TeachOutlinePanel: disabled=true (an outline mutation in flight) disables every Move/Remove control, regardless of position", () => {
  const sections = [sampleSection({ id: "s1", sortOrder: 0 }), sampleSection({ id: "s2", sortOrder: 1 })];
  const html = renderToStaticMarkup(
    createElement(TeachOutlinePanel as never, outlinePanelProps({ sections, disabled: true })),
  );
  const items = outlineItemsHtml(html);
  for (const item of items) {
    assert.ok(buttonHtml(item, "Move up").includes("disabled"));
    assert.ok(buttonHtml(item, "Move down").includes("disabled"));
    assert.ok(buttonHtml(item, "Remove").includes("disabled"));
  }
});

// ===========================================================================
// P. ASSERTION-LINE for the outline builder (acceptance criterion 6) --
//    covering EVERY kind's UI copy, not just the free-text body field. The
//    "not_justified" and "objection" kinds are named explicitly because they
//    sit closest to the assertion line.
// ===========================================================================

test("ASSERTION-LINE: every TEACHING_SECTION_KINDS chip label is a plain humanized token -- no per-kind description, hint, or example exists anywhere, for any kind", () => {
  const html = renderToStaticMarkup(createElement(TeachOutlinePanel as never, outlinePanelProps()));
  for (const kind of TEACHING_SECTION_KINDS) {
    assert.ok(
      html.includes(`>${expectedKindLabel(kind)}<`),
      `${kind} chip missing its expected plain label "${expectedKindLabel(kind)}" -- an added description would break this exact match`,
    );
  }
});

test("ASSERTION-LINE: TeachOutlinePanel's own intro/empty-state/loading copy never asserts what the passage means, across locked-adjacent states", () => {
  const emptyHtml = renderToStaticMarkup(createElement(TeachOutlinePanel as never, outlinePanelProps()));
  assert.doesNotMatch(
    emptyHtml,
    /this passage means|the correct (view|interpretation)|this proves|teaches that/i,
    "verdict-language leak in the outline builder's own copy",
  );
});

test("ASSERTION-LINE: rendering one section per TEACHING_SECTION_KINDS kind (including 'objection' and 'not_justified') leaks no app-supplied verdict language anywhere in the outline list", () => {
  const sections = TEACHING_SECTION_KINDS.map((kind, index) =>
    sampleSection({
      id: `assertion-${kind}`,
      kind,
      sortOrder: index,
      body: `My own reasoning for the ${kind} part, in my own words.`,
    }),
  );
  const html = renderToStaticMarkup(createElement(TeachOutlinePanel as never, outlinePanelProps({ sections })));
  for (const kind of TEACHING_SECTION_KINDS) {
    assert.ok(html.includes(`>${expectedKindLabel(kind)}<`), `${kind} label missing from the rendered list`);
  }
  assert.doesNotMatch(
    html,
    /this passage means|the correct (view|interpretation)|this proves|teaches that|the objection is (?:that|valid|invalid)|this does(?:n't| not) justify anything by itself|the app (?:concludes|determines|decides)/i,
    "verdict-language or app-supplied reasoning leak in the outline builder, specifically checked against objection/not_justified alongside every other kind",
  );
});

test("TeachOutlinePanel's add-outline-point field asks the learner what THEY will say, in their own words -- not a passage assertion", () => {
  const html = renderToStaticMarkup(createElement(TeachOutlinePanel as never, outlinePanelProps()));
  assert.match(html, /what will you say|your own reasoning|your own words/i);
});

// ===========================================================================
// MUTATION PROOFS — see this task's commit message for the verbatim
// before/after `npm test` output these mutations actually produced.
//
//   (a) FORMAT_PRESETS mapping (TeachSection.tsx, TEACHDRAFTPANE-001,
//       re-proof carried forward unchanged): the "15-minute" entry's
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
//   (c) sortOrder auto-assignment (TEACHOUTLINE-001, acceptance criterion
//       10a): `nextSectionSortOrder`'s `Math.max(...active.map(...)) + 1`
//       mutated to drop the `+ 1` (returning the current max itself, which
//       COLLIDES with an existing section's sortOrder). Named test that
//       fails: "MUTATION-TARGET: nextSectionSortOrder returns one past the
//       current max sortOrder among ONLY that draft's non-deleted sections".
//   (d) reorder persistence (TEACHOUTLINE-001, acceptance criterion 10b):
//       `persistSectionReorder`'s second `await save(result.updated[1])`
//       call deleted (only the first swapped section is persisted). Named
//       test that fails: "MUTATION-TARGET: persistSectionReorder actually
//       persists BOTH swapped sections through the REAL vault writer -- a
//       fresh read afterward shows the new order, not just in-memory
//       state" (and, as a second, independent catch, "persistSectionReorder:
//       computes the swap and persists BOTH updated sections through the
//       given save function", whose `saved.length, 2` assertion also fails).
//
// Mutations (c) and (d) were applied directly to this task's own new code in
// the real production file (`components/workspace/TeachSection.tsx`), via a
// pre-mutation backup copy (`TeachSection.tsx.bak`, made with `cp` before
// editing) rather than relying on `git checkout` to restore (which could
// discard uncommitted work); `npm test` was run and confirmed the named
// tests above FAILING (and no other unrelated test newly failing); the file
// was restored from that backup; `diff` confirmed the restored file
// byte-identical to the pre-mutation backup; `npm test` was re-run and
// confirmed green again. Verbatim command output for both mutations is
// pasted in this task's own commit message / final report.
// ===========================================================================
