/**
 * V2COMPOSER-001 — the first v2 authoring flow: ClaimComposer
 * (components/study/ClaimComposer.tsx).
 *
 * TEST-ENVIRONMENT NOTE (read before extending this file, same discipline as
 * tests/verse-selection.test.ts / tests/review-setup-state.test.ts): this
 * repo's test script is `tsx --test tests/*.test.ts` — plain Node, no jsdom,
 * no @testing-library. Three techniques stand in for a browser, all against
 * the REAL production module, never a reimplementation:
 *
 *   1. `nodeRequire` + `require.cache` seeding loads the real
 *      ClaimComposer.tsx, stubbing only the four CSS Modules it (transitively,
 *      via components/ui/Button|Chip|Field.tsx) needs, plus "fake-indexeddb/
 *      auto" so its module-level `openDB(...)` call in lib/sync/store.ts
 *      succeeds.
 *   2. `PromoteFields` has no hooks (see its own header comment in
 *      ClaimComposer.tsx), so it is called directly as a plain function to
 *      get its real returned element tree — the exact technique
 *      tests/verse-selection.test.ts uses for the hookless `VerseColumn`.
 *      `findAll`/`findOne` below walk that tree (a plain object graph of
 *      `{type, props}`, exactly what JSX compiles to before rendering) to
 *      locate a specific rendered Chip/Button and invoke the literal onClick
 *      prop it carries — proving a click really calls `selectKind` (etc.),
 *      not a hand-copied duplicate of it.
 *   3. `react-dom/server`'s `renderToStaticMarkup`, via `createElement` (this
 *      file is `.test.ts`, not `.tsx` — no JSX), renders the real
 *      `ClaimComposer` (hook-based; SSR sets up React's hooks dispatcher, so
 *      `useState`'s initial values render correctly) and the real
 *      `PromoteFields` to actual HTML for structural/copy assertions.
 *
 * RESIDUAL GAP (disclosed, not hidden — same shape as verse-selection.test.ts
 * §"RESIDUAL GAP"): `ClaimComposer`'s own `submit` handler lives inside a
 * closure over `useState`, so it cannot be invoked directly the way
 * `PromoteFields`'s callbacks can. What IS proved: `submit` calls
 * `buildStudySessionDraft` / `buildStudyClaimDraft` / `buildClaimEvidenceDraft`
 * (readable in ClaimComposer.tsx's own source) and then the real
 * `saveLocalStudySession` / `saveLocalStudyClaim` / `saveLocalClaimEvidence`
 * (never a second write path) — the PIPELINE section below builds records
 * with those exact exported builders and round-trips them through the exact
 * exported vault writers and readers, the same "construct what the real
 * handler would construct, then call the real store function" pattern
 * tests/verse-selection.test.ts's own PIPELINE tests use for NoteComposer's
 * unreachable submit handler.
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
  CLAIM_CONFIDENCES,
  CLAIM_EVIDENCE_TYPES,
  CLAIM_KINDS,
  DOCTRINE_STATUSES,
  EPISTEMIC_BASES,
  type ClaimConfidence,
  type ClaimEvidence,
  type ClaimEvidenceType,
  type ClaimKind,
  type DoctrineStatus,
  type EpistemicBasis,
  type StudyClaim,
  type StudySession,
} from "@/lib/contracts/study-v2";

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

// CSS Modules resolve every requested class to its own name, same convention
// as every other file in this suite that loads a real component.
const cssProxy = new Proxy(
  {},
  { get: (_target, key) => (typeof key === "string" ? key : undefined) },
);

seedModule("@/components/study/claim-composer.module.css", { default: cssProxy });
seedModule("@/components/ui/Button.module.css", { default: cssProxy });
seedModule("@/components/ui/Chip.module.css", { default: cssProxy });
seedModule("@/components/ui/Field.module.css", { default: cssProxy });

// ---------------------------------------------------------------------------
// Load the real module. Every function/component below is imported from THIS
// object — never redeclared — so every test in this file exercises the exact
// code the app ships.
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

const composerModule = nodeRequire("@/components/study/ClaimComposer.tsx") as {
  humanizeToken: (value: string) => string;
  optionsFrom: <T extends string>(values: readonly T[]) => { value: T; label: string }[];
  BLANK_CLAIM_SELECTION: ClaimSelectionDraft;
  selectKind: (selection: ClaimSelectionDraft, kind: ClaimKind) => ClaimSelectionDraft;
  selectEpistemicBasis: (selection: ClaimSelectionDraft, epistemicBasis: EpistemicBasis) => ClaimSelectionDraft;
  selectConfidence: (selection: ClaimSelectionDraft, confidence: ClaimConfidence) => ClaimSelectionDraft;
  selectDoctrineStatus: (selection: ClaimSelectionDraft, doctrineStatus: DoctrineStatus) => ClaimSelectionDraft;
  blankEvidenceDraft: (id: string) => EvidenceDraft;
  validEvidenceDrafts: (evidence: EvidenceDraft[]) => EvidenceDraft[];
  updateEvidenceRow: (
    evidence: EvidenceDraft[],
    id: string,
    patch: Partial<Pick<EvidenceDraft, "type" | "note">>,
  ) => EvidenceDraft[];
  addEvidenceRow: (evidence: EvidenceDraft[], id: string) => EvidenceDraft[];
  removeEvidenceRow: (evidence: EvidenceDraft[], id: string) => EvidenceDraft[];
  promoteReadiness: (body: string, selection: ClaimSelectionDraft, evidence: EvidenceDraft[]) => PromoteReadiness;
  buildStudySessionDraft: (params: {
    id: string;
    workspaceId: string;
    range: CanonicalRangeV1;
    now: string;
  }) => StudySession;
  buildStudyClaimDraft: (params: {
    id: string;
    workspaceId: string;
    sessionId: string;
    range: CanonicalRangeV1;
    body: string;
    selection: ClaimSelectionDraft;
    now: string;
  }) => StudyClaim;
  buildClaimEvidenceDraft: (params: {
    id: string;
    workspaceId: string;
    claimId: string;
    range: CanonicalRangeV1;
    draft: EvidenceDraft;
    now: string;
  }) => ClaimEvidence;
  PromoteFields: (props: {
    body: string;
    selection: ClaimSelectionDraft;
    evidence: EvidenceDraft[];
    readiness: PromoteReadiness;
    disabled: boolean;
    onSelectionChange: (next: ClaimSelectionDraft) => void;
    onEvidenceChange: (next: EvidenceDraft[]) => void;
  }) => RElement;
  ClaimComposer: (props: {
    workspaceId: string;
    range: CanonicalRangeV1;
    session?: StudySession;
    onSaved?: (result: { session: StudySession; claim: StudyClaim; evidence: ClaimEvidence[] }) => void;
  }) => unknown;
};

const {
  humanizeToken,
  optionsFrom,
  BLANK_CLAIM_SELECTION,
  selectKind,
  selectEpistemicBasis,
  selectConfidence,
  selectDoctrineStatus,
  blankEvidenceDraft,
  validEvidenceDrafts,
  updateEvidenceRow,
  addEvidenceRow,
  removeEvidenceRow,
  promoteReadiness,
  buildStudySessionDraft,
  buildStudyClaimDraft,
  buildClaimEvidenceDraft,
  PromoteFields,
  ClaimComposer,
} = composerModule;

const store = nodeRequire("@/lib/sync/store.ts") as {
  saveLocalStudySession: (session: StudySession) => Promise<void>;
  saveLocalStudyClaim: (claim: StudyClaim) => Promise<void>;
  saveLocalClaimEvidence: (evidence: ClaimEvidence) => Promise<void>;
  listLocalV2Entities: (entity: "session" | "claim" | "evidence") => Promise<unknown[]>;
};

// ---------------------------------------------------------------------------
// Tree-walking helpers for the raw (pre-render) element graph PromoteFields
// returns when called directly.
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

function findChip(tree: RElement, field: string, value: string): RElement {
  const matches = findAll(
    tree,
    (el) => el.props["data-field"] === field && el.props["data-value"] === value,
  );
  assert.equal(matches.length, 1, `expected exactly one chip for ${field}="${value}", found ${matches.length}`);
  return matches[0];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function sampleRange(): CanonicalRangeV1 {
  return { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.1", end: "1.3.6" };
}

function fullSelection(overrides: Partial<ClaimSelectionDraft> = {}): ClaimSelectionDraft {
  return {
    kind: "interpretation",
    epistemicBasis: "text_explicit",
    confidence: "developing",
    doctrineStatus: null,
    ...overrides,
  };
}

function oneEvidenceRow(overrides: Partial<EvidenceDraft> = {}): EvidenceDraft[] {
  return [{ id: "row-1", type: "passage", note: "Verse 1 names the serpent directly.", ...overrides }];
}

// ===========================================================================
// 1. humanizeToken / optionsFrom — pure formatting, independently transcribed
//    expected values (never derived from the code under test).
// ===========================================================================

test("humanizeToken: snake_case -> Title Case first word only", () => {
  assert.equal(humanizeToken("text_explicit"), "Text explicit");
  assert.equal(humanizeToken("well_supported"), "Well supported");
  assert.equal(humanizeToken("core"), "Core");
  assert.equal(humanizeToken("a_b_c"), "A b c");
  assert.equal(humanizeToken(""), "");
});

const EXPECTED_CLAIM_KIND_LABELS = [
  ["observation", "Observation"],
  ["question", "Question"],
  ["context", "Context"],
  ["interpretation", "Interpretation"],
  ["theology", "Theology"],
  ["conviction", "Conviction"],
  ["application", "Application"],
  ["teaching_seed", "Teaching seed"],
];

const EXPECTED_EPISTEMIC_BASIS_LABELS = [
  ["text_explicit", "Text explicit"],
  ["historical_context", "Historical context"],
  ["inference", "Inference"],
  ["canonical_synthesis", "Canonical synthesis"],
  ["tradition", "Tradition"],
  ["prudential_judgment", "Prudential judgment"],
  ["personal_reflection", "Personal reflection"],
];

const EXPECTED_CONFIDENCE_LABELS = [
  ["tentative", "Tentative"],
  ["developing", "Developing"],
  ["well_supported", "Well supported"],
];

const EXPECTED_DOCTRINE_STATUS_LABELS = [
  ["core", "Core"],
  ["conviction", "Conviction"],
  ["open", "Open"],
  ["disputed", "Disputed"],
  ["wisdom", "Wisdom"],
];

const EXPECTED_EVIDENCE_TYPE_LABELS = [
  ["passage", "Passage"],
  ["context", "Context"],
  ["connection", "Connection"],
  ["source", "Source"],
];

test("optionsFrom(CLAIM_KINDS): exact values and labels, matching the contract array's own current length (8)", () => {
  assert.equal(CLAIM_KINDS.length, 8, "study-v2.ts's CLAIM_KINDS no longer has 8 entries — update this test's expectations");
  assert.deepEqual(
    optionsFrom(CLAIM_KINDS).map((o) => [o.value, o.label]),
    EXPECTED_CLAIM_KIND_LABELS,
  );
});

test("optionsFrom(EPISTEMIC_BASES): exact values and labels", () => {
  assert.equal(EPISTEMIC_BASES.length, 7);
  assert.deepEqual(
    optionsFrom(EPISTEMIC_BASES).map((o) => [o.value, o.label]),
    EXPECTED_EPISTEMIC_BASIS_LABELS,
  );
});

test("optionsFrom(CLAIM_CONFIDENCES): exact values and labels", () => {
  assert.equal(CLAIM_CONFIDENCES.length, 3);
  assert.deepEqual(
    optionsFrom(CLAIM_CONFIDENCES).map((o) => [o.value, o.label]),
    EXPECTED_CONFIDENCE_LABELS,
  );
});

test("optionsFrom(DOCTRINE_STATUSES): exact values and labels", () => {
  assert.equal(DOCTRINE_STATUSES.length, 5);
  assert.deepEqual(
    optionsFrom(DOCTRINE_STATUSES).map((o) => [o.value, o.label]),
    EXPECTED_DOCTRINE_STATUS_LABELS,
  );
});

test("optionsFrom(CLAIM_EVIDENCE_TYPES): exact values and labels", () => {
  assert.equal(CLAIM_EVIDENCE_TYPES.length, 4);
  assert.deepEqual(
    optionsFrom(CLAIM_EVIDENCE_TYPES).map((o) => [o.value, o.label]),
    EXPECTED_EVIDENCE_TYPE_LABELS,
  );
});

test("CONTRACT-DERIVATION criterion 3: optionsFrom's values are the live contract array itself, not a separate hardcoded list — a value added to any of the five vocabularies appears here with zero edits to this file", () => {
  assert.deepEqual(optionsFrom(CLAIM_KINDS).map((o) => o.value), [...CLAIM_KINDS]);
  assert.deepEqual(optionsFrom(EPISTEMIC_BASES).map((o) => o.value), [...EPISTEMIC_BASES]);
  assert.deepEqual(optionsFrom(CLAIM_CONFIDENCES).map((o) => o.value), [...CLAIM_CONFIDENCES]);
  assert.deepEqual(optionsFrom(DOCTRINE_STATUSES).map((o) => o.value), [...DOCTRINE_STATUSES]);
  assert.deepEqual(optionsFrom(CLAIM_EVIDENCE_TYPES).map((o) => o.value), [...CLAIM_EVIDENCE_TYPES]);
});

// ===========================================================================
// 2. BLANK_CLAIM_SELECTION — acceptance criterion 6's mutation-proof anchor.
// ===========================================================================

test("MUTATION-TARGET criterion 6: BLANK_CLAIM_SELECTION starts every field null — no claim kind, epistemic basis, confidence, or doctrine status is ever auto-typed", () => {
  assert.deepEqual(BLANK_CLAIM_SELECTION, {
    kind: null,
    epistemicBasis: null,
    confidence: null,
    doctrineStatus: null,
  });
});

// ===========================================================================
// 3. selectKind / selectEpistemicBasis / selectConfidence / selectDoctrineStatus
// ===========================================================================

test("selectKind: sets kind, leaves doctrineStatus null when the new kind is not theology", () => {
  const next = selectKind(BLANK_CLAIM_SELECTION, "interpretation");
  assert.deepEqual(next, { kind: "interpretation", epistemicBasis: null, confidence: null, doctrineStatus: null });
  // Immutability: the input is untouched.
  assert.deepEqual(BLANK_CLAIM_SELECTION, { kind: null, epistemicBasis: null, confidence: null, doctrineStatus: null });
});

test("selectKind: moving AWAY from theology clears a previously chosen doctrineStatus", () => {
  const withDoctrine: ClaimSelectionDraft = { ...BLANK_CLAIM_SELECTION, kind: "theology", doctrineStatus: "open" };
  const next = selectKind(withDoctrine, "conviction");
  assert.equal(next.kind, "conviction");
  assert.equal(next.doctrineStatus, null, "a stale doctrineStatus must not survive a move away from theology");
});

test("selectKind: re-selecting theology keeps an existing doctrineStatus", () => {
  const withDoctrine: ClaimSelectionDraft = { ...BLANK_CLAIM_SELECTION, kind: "theology", doctrineStatus: "disputed" };
  const next = selectKind(withDoctrine, "theology");
  assert.equal(next.doctrineStatus, "disputed");
});

test("selectEpistemicBasis / selectConfidence / selectDoctrineStatus set exactly their own field", () => {
  assert.deepEqual(selectEpistemicBasis(BLANK_CLAIM_SELECTION, "inference"), {
    ...BLANK_CLAIM_SELECTION,
    epistemicBasis: "inference",
  });
  assert.deepEqual(selectConfidence(BLANK_CLAIM_SELECTION, "tentative"), {
    ...BLANK_CLAIM_SELECTION,
    confidence: "tentative",
  });
  assert.deepEqual(selectDoctrineStatus(BLANK_CLAIM_SELECTION, "core"), {
    ...BLANK_CLAIM_SELECTION,
    doctrineStatus: "core",
  });
});

// ===========================================================================
// 4. Evidence draft helpers
// ===========================================================================

test("blankEvidenceDraft: carries the given id, null type, empty note", () => {
  assert.deepEqual(blankEvidenceDraft("abc"), { id: "abc", type: null, note: "" });
});

test("validEvidenceDrafts: only rows with BOTH a type and a non-empty (trimmed) note count", () => {
  const rows: EvidenceDraft[] = [
    { id: "a", type: null, note: "has a note but no type" },
    { id: "b", type: "passage", note: "   " },
    { id: "c", type: "passage", note: "" },
    { id: "d", type: "source", note: "a real citation note" },
    { id: "e", type: "context", note: "  padded but real  " },
  ];
  assert.deepEqual(
    validEvidenceDrafts(rows).map((r) => r.id),
    ["d", "e"],
  );
});

test("updateEvidenceRow: patches only the row with the matching id, leaves others untouched, returns a new array", () => {
  const rows = oneEvidenceRow().concat(blankEvidenceDraft("row-2"));
  const next = updateEvidenceRow(rows, "row-2", { type: "source", note: "a citation" });
  assert.notEqual(next, rows, "must return a new array, not mutate in place");
  assert.deepEqual(next[0], rows[0]);
  assert.deepEqual(next[1], { id: "row-2", type: "source", note: "a citation" });
});

test("addEvidenceRow: appends a blank row with the given id", () => {
  const rows = oneEvidenceRow();
  const next = addEvidenceRow(rows, "row-2");
  assert.equal(next.length, 2);
  assert.deepEqual(next[1], { id: "row-2", type: null, note: "" });
});

test("removeEvidenceRow: removes only the matching row", () => {
  const rows = oneEvidenceRow().concat(blankEvidenceDraft("row-2"));
  const next = removeEvidenceRow(rows, "row-1");
  assert.deepEqual(
    next.map((r) => r.id),
    ["row-2"],
  );
});

// ===========================================================================
// 5. promoteReadiness — the save gate. Acceptance criterion 5's mutation-proof
//    target (the evidence-required refusal).
// ===========================================================================

test("promoteReadiness: everything missing on a totally blank composer", () => {
  const result = promoteReadiness("", BLANK_CLAIM_SELECTION, []);
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, [
    "Write what you observed.",
    "Choose a claim kind.",
    "Choose an epistemic basis.",
    "Choose a confidence level.",
    "Add at least one piece of evidence — a claim with no basis can’t be saved.",
  ]);
});

test("promoteReadiness: ready once body, kind, basis, confidence, and at least one valid evidence row are all present", () => {
  const result = promoteReadiness("The serpent speaks first.", fullSelection(), oneEvidenceRow());
  assert.deepEqual(result, { ready: true, missing: [] });
});

test("MUTATION-TARGET criterion 5: promoteReadiness refuses when every other field is filled but no evidence row is valid", () => {
  const emptyEvidence = promoteReadiness("body text", fullSelection(), []);
  assert.equal(emptyEvidence.ready, false);
  assert.ok(emptyEvidence.missing.includes("Add at least one piece of evidence — a claim with no basis can’t be saved."));

  const halfFilledEvidenceRow = promoteReadiness("body text", fullSelection(), [
    { id: "x", type: "passage", note: "" },
  ]);
  assert.equal(halfFilledEvidenceRow.ready, false, "a row with a type but an empty note must not count as evidence");

  const noTypeEvidenceRow = promoteReadiness("body text", fullSelection(), [
    { id: "x", type: null, note: "a note with no chosen type" },
  ]);
  assert.equal(noTypeEvidenceRow.ready, false, "a row with a note but no chosen type must not count as evidence");
});

test("promoteReadiness: theology claims additionally require a chosen doctrineStatus", () => {
  const withoutDoctrine = promoteReadiness(
    "body",
    fullSelection({ kind: "theology", doctrineStatus: null }),
    oneEvidenceRow(),
  );
  assert.equal(withoutDoctrine.ready, false);
  assert.ok(withoutDoctrine.missing.includes("Choose how widely held this is (theology claims only)."));

  const withDoctrine = promoteReadiness(
    "body",
    fullSelection({ kind: "theology", doctrineStatus: "open" }),
    oneEvidenceRow(),
  );
  assert.deepEqual(withDoctrine, { ready: true, missing: [] });
});

test("promoteReadiness: a non-theology claim is never blocked by doctrineStatus", () => {
  const result = promoteReadiness("body", fullSelection({ kind: "observation" }), oneEvidenceRow());
  assert.equal(result.ready, true);
});

// ===========================================================================
// 6. Record builders
// ===========================================================================

test("buildStudySessionDraft: structural defaults, exact shape (READGATE-001: currentStep is now 'read', not 'observe')", () => {
  const range = sampleRange();
  const session = buildStudySessionDraft({ id: "session-1", workspaceId: "ws-1", range, now: "2026-08-20T00:00:00.000Z" });
  assert.deepEqual(session, {
    id: "session-1",
    workspaceId: "ws-1",
    range,
    mode: "encounter",
    workflowState: "active",
    connectionState: "unexamined",
    catalogReleaseId: null,
    readGateAt: null,
    currentStep: "read",
    revision: 1,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    deletedAt: null,
  });
});

test("buildStudyClaimDraft: full non-theology claim, exact shape, body trimmed", () => {
  const range = sampleRange();
  const claim = buildStudyClaimDraft({
    id: "claim-1",
    workspaceId: "ws-1",
    sessionId: "session-1",
    range,
    body: "  The serpent speaks first.  ",
    selection: fullSelection(),
    now: "2026-08-20T00:00:00.000Z",
  });
  assert.deepEqual(claim, {
    id: "claim-1",
    workspaceId: "ws-1",
    sessionId: "session-1",
    kind: "interpretation",
    epistemicBasis: "text_explicit",
    body: "The serpent speaks first.",
    passage: range,
    confidence: "developing",
    provenance: "learner",
    doctrineStatus: null,
    status: "draft",
    revision: 1,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    deletedAt: null,
  });
});

test("buildStudyClaimDraft: a theology claim carries its chosen doctrineStatus", () => {
  const claim = buildStudyClaimDraft({
    id: "claim-1",
    workspaceId: "ws-1",
    sessionId: "session-1",
    range: sampleRange(),
    body: "body",
    selection: fullSelection({ kind: "theology", doctrineStatus: "open" }),
    now: "2026-08-20T00:00:00.000Z",
  });
  assert.equal(claim.kind, "theology");
  assert.equal(claim.doctrineStatus, "open");
});

test("buildStudyClaimDraft: a stale doctrineStatus on a non-theology selection is dropped, never carried through", () => {
  const claim = buildStudyClaimDraft({
    id: "claim-1",
    workspaceId: "ws-1",
    sessionId: "session-1",
    range: sampleRange(),
    body: "body",
    selection: fullSelection({ kind: "interpretation", doctrineStatus: "open" }),
    now: "2026-08-20T00:00:00.000Z",
  });
  assert.equal(claim.doctrineStatus, null, "syncStudyClaimV2Schema rejects a non-theology claim carrying a doctrineStatus");
});

test("buildStudyClaimDraft: throws (never silently defaults) when kind, epistemicBasis, or confidence is missing", () => {
  const base = { id: "c", workspaceId: "ws", sessionId: "s", range: sampleRange(), body: "b", now: "2026-08-20T00:00:00.000Z" };
  assert.throws(() => buildStudyClaimDraft({ ...base, selection: fullSelection({ kind: null }) }));
  assert.throws(() => buildStudyClaimDraft({ ...base, selection: fullSelection({ epistemicBasis: null }) }));
  assert.throws(() => buildStudyClaimDraft({ ...base, selection: fullSelection({ confidence: null }) }));
  assert.throws(() =>
    buildStudyClaimDraft({ ...base, selection: fullSelection({ kind: "theology", doctrineStatus: null }) }),
  );
});

test("buildClaimEvidenceDraft: evidenceType 'passage' carries canonicalReference = the session's range", () => {
  const range = sampleRange();
  const evidence = buildClaimEvidenceDraft({
    id: "ev-1",
    workspaceId: "ws-1",
    claimId: "claim-1",
    range,
    draft: { id: "row-1", type: "passage", note: "  quotes verse 1  " },
    now: "2026-08-20T00:00:00.000Z",
  });
  assert.deepEqual(evidence, {
    id: "ev-1",
    workspaceId: "ws-1",
    claimId: "claim-1",
    evidenceType: "passage",
    canonicalReference: range,
    note: "quotes verse 1",
    revision: 1,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    deletedAt: null,
  });
});

test("buildClaimEvidenceDraft: evidenceType 'source'/'context'/'connection' omit canonicalReference entirely (not just undefined)", () => {
  for (const type of ["source", "context", "connection"] as const) {
    const evidence = buildClaimEvidenceDraft({
      id: "ev-1",
      workspaceId: "ws-1",
      claimId: "claim-1",
      range: sampleRange(),
      draft: { id: "row-1", type, note: "a note" },
      now: "2026-08-20T00:00:00.000Z",
    });
    assert.equal(
      Object.prototype.hasOwnProperty.call(evidence, "canonicalReference"),
      false,
      `evidenceType "${type}" must not carry a canonicalReference key at all`,
    );
  }
});

test("buildClaimEvidenceDraft: throws when type is missing or note is empty/whitespace-only", () => {
  const base = { id: "ev", workspaceId: "ws", claimId: "c", range: sampleRange(), now: "2026-08-20T00:00:00.000Z" };
  assert.throws(() => buildClaimEvidenceDraft({ ...base, draft: { id: "r", type: null, note: "a note" } }));
  assert.throws(() => buildClaimEvidenceDraft({ ...base, draft: { id: "r", type: "passage", note: "" } }));
  assert.throws(() => buildClaimEvidenceDraft({ ...base, draft: { id: "r", type: "passage", note: "   " } }));
});

// ===========================================================================
// 7. PromoteFields — real element tree (hookless, called directly) +
//    real rendered HTML.
// ===========================================================================

test("RENDER PromoteFields: renders exactly CLAIM_KINDS.length kind chips, none pressed on a blank selection", () => {
  const tree = PromoteFields({
    body: "an observation",
    selection: BLANK_CLAIM_SELECTION,
    evidence: oneEvidenceRow(),
    readiness: promoteReadiness("an observation", BLANK_CLAIM_SELECTION, oneEvidenceRow()),
    disabled: false,
    onSelectionChange: () => {},
    onEvidenceChange: () => {},
  });
  const kindChips = findAll(tree, (el) => el.props["data-field"] === "kind");
  assert.equal(kindChips.length, CLAIM_KINDS.length);
  assert.equal(
    kindChips.filter((c) => c.props["aria-pressed"] === true).length,
    0,
    "no kind chip should be pre-pressed",
  );
});

test("RENDER PromoteFields: the doctrineStatus fieldset only appears when kind is 'theology'", () => {
  const withoutTheology = PromoteFields({
    body: "b",
    selection: BLANK_CLAIM_SELECTION,
    evidence: oneEvidenceRow(),
    readiness: promoteReadiness("b", BLANK_CLAIM_SELECTION, oneEvidenceRow()),
    disabled: false,
    onSelectionChange: () => {},
    onEvidenceChange: () => {},
  });
  assert.equal(findAll(withoutTheology, (el) => el.props["data-field"] === "doctrineStatus").length, 0);

  const withTheology = PromoteFields({
    body: "b",
    selection: fullSelection({ kind: "theology", doctrineStatus: null }),
    evidence: oneEvidenceRow(),
    readiness: promoteReadiness("b", fullSelection({ kind: "theology", doctrineStatus: null }), oneEvidenceRow()),
    disabled: false,
    onSelectionChange: () => {},
    onEvidenceChange: () => {},
  });
  assert.equal(findAll(withTheology, (el) => el.props["data-field"] === "doctrineStatus").length, DOCTRINE_STATUSES.length);
});

test("ACTIVATE PromoteFields: clicking the rendered 'theology' kind chip calls onSelectionChange with exactly selectKind(selection, 'theology')", () => {
  const calls: ClaimSelectionDraft[] = [];
  const selection = BLANK_CLAIM_SELECTION;
  const tree = PromoteFields({
    body: "b",
    selection,
    evidence: oneEvidenceRow(),
    readiness: promoteReadiness("b", selection, oneEvidenceRow()),
    disabled: false,
    onSelectionChange: (next) => calls.push(next),
    onEvidenceChange: () => {},
  });
  const theologyChip = findChip(tree, "kind", "theology");
  (theologyChip.props.onClick as () => void)();

  assert.deepEqual(calls, [selectKind(selection, "theology")]);
});

test("ACTIVATE PromoteFields: the theology chip is disabled (no interaction possible) when disabled=true", () => {
  const tree = PromoteFields({
    body: "b",
    selection: BLANK_CLAIM_SELECTION,
    evidence: oneEvidenceRow(),
    readiness: promoteReadiness("b", BLANK_CLAIM_SELECTION, oneEvidenceRow()),
    disabled: true,
    onSelectionChange: () => {},
    onEvidenceChange: () => {},
  });
  const theologyChip = findChip(tree, "kind", "theology");
  assert.equal(theologyChip.props.disabled, true);
});

test("ACTIVATE PromoteFields: adding an evidence row calls onEvidenceChange with exactly addEvidenceRow's shape (a longer array, new row blank)", () => {
  const calls: EvidenceDraft[][] = [];
  const evidence = oneEvidenceRow();
  const tree = PromoteFields({
    body: "b",
    selection: BLANK_CLAIM_SELECTION,
    evidence,
    readiness: promoteReadiness("b", BLANK_CLAIM_SELECTION, evidence),
    disabled: false,
    onSelectionChange: () => {},
    onEvidenceChange: (next) => calls.push(next),
  });
  const addButton = findAll(tree, (el) => el.props["data-action"] === "add-evidence")[0];
  assert.ok(addButton, "the add-evidence button was not found");
  (addButton.props.onClick as () => void)();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 2, "adding a row must grow the array by one");
  assert.deepEqual(calls[0][0], evidence[0], "the original row must be untouched");
  assert.equal(calls[0][1].type, null);
  assert.equal(calls[0][1].note, "");
});

test("RENDER PromoteFields: a 'Remove' button only appears when there is more than one evidence row", () => {
  const single = PromoteFields({
    body: "b",
    selection: BLANK_CLAIM_SELECTION,
    evidence: oneEvidenceRow(),
    readiness: promoteReadiness("b", BLANK_CLAIM_SELECTION, oneEvidenceRow()),
    disabled: false,
    onSelectionChange: () => {},
    onEvidenceChange: () => {},
  });
  assert.equal(findAll(single, (el) => el.props["data-action"] === "remove-evidence").length, 0);

  const two = oneEvidenceRow().concat(blankEvidenceDraft("row-2"));
  const multi = PromoteFields({
    body: "b",
    selection: BLANK_CLAIM_SELECTION,
    evidence: two,
    readiness: promoteReadiness("b", BLANK_CLAIM_SELECTION, two),
    disabled: false,
    onSelectionChange: () => {},
    onEvidenceChange: () => {},
  });
  assert.equal(findAll(multi, (el) => el.props["data-action"] === "remove-evidence").length, 2);
});

test("RENDER HTML PromoteFields: missing-reasons list renders every current reason, and none when ready", () => {
  const readiness = promoteReadiness("", BLANK_CLAIM_SELECTION, []);
  const html = renderToStaticMarkup(
    createElement(PromoteFields as never, {
      body: "",
      selection: BLANK_CLAIM_SELECTION,
      evidence: [blankEvidenceDraft("row-1")],
      readiness,
      disabled: false,
      onSelectionChange: () => {},
      onEvidenceChange: () => {},
    }),
  );
  for (const reason of readiness.missing) {
    assert.ok(html.includes(reason), `missing reason not rendered: ${reason}`);
  }

  const readyHtml = renderToStaticMarkup(
    createElement(PromoteFields as never, {
      body: "text",
      selection: fullSelection(),
      evidence: oneEvidenceRow(),
      readiness: promoteReadiness("text", fullSelection(), oneEvidenceRow()),
      disabled: false,
      onSelectionChange: () => {},
      onEvidenceChange: () => {},
    }),
  );
  assert.doesNotMatch(readyHtml, /Add at least one piece of evidence/);
});

test("RENDER HTML PromoteFields: doctrineStatus legend frames it as standing, never correctness (assertion-line copy check)", () => {
  const html = renderToStaticMarkup(
    createElement(PromoteFields as never, {
      body: "b",
      selection: fullSelection({ kind: "theology", doctrineStatus: null }),
      evidence: oneEvidenceRow(),
      readiness: promoteReadiness("b", fullSelection({ kind: "theology", doctrineStatus: null }), oneEvidenceRow()),
      disabled: false,
      onSelectionChange: () => {},
      onEvidenceChange: () => {},
    }),
  );
  assert.match(html, /describes standing, not correctness/);
});

// ===========================================================================
// 8. ClaimComposer — real SSR render of the stateful shell at its initial
//    (blank) mount.
// ===========================================================================

function renderComposerInitial(range: CanonicalRangeV1) {
  return renderToStaticMarkup(createElement(ClaimComposer as never, { workspaceId: "ws-1", range }));
}

test("RENDER HTML ClaimComposer: initial mount shows the observe textarea and a formatted passage reference, no promote section yet", () => {
  const html = renderComposerInitial(sampleRange());
  assert.match(html, /What do you notice in the words themselves\?/, "method-only placeholder missing");
  assert.match(html, />1\.3\.1–1\.3\.6</, "formatted passage reference missing");
  assert.doesNotMatch(html, /Turn this into a typed claim/, "promote section must not render before any text is written");
});

test("ASSERTION-LINE: the initial render never asserts a fact or example about the passage's content", () => {
  const html = renderComposerInitial(sampleRange());
  // NoteComposer.tsx's own placeholder ("The serpent changes God's wording…")
  // was deliberately not reused here — see ClaimComposer.tsx's header.
  assert.doesNotMatch(html, /serpent/i);
  assert.doesNotMatch(html, /teaches that|the correct view|this proves|this means/i);
});

test("RENDER HTML ClaimComposer: a single-verse range renders without an en dash (start === end)", () => {
  const html = renderComposerInitial({ versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.15", end: "1.3.15" });
  assert.match(html, />1\.3\.15</);
  assert.doesNotMatch(html, /1\.3\.15–/);
});

test("RENDER HTML ClaimComposer: the submit button is disabled before any observation is written", () => {
  const html = renderComposerInitial(sampleRange());
  const submitMatch = /<button[^>]*type="submit"[^>]*>/.exec(html);
  assert.ok(submitMatch, "no submit button found");
  assert.match(submitMatch![0], /disabled/, "submit button should start disabled");
});

// ===========================================================================
// 9. PIPELINE — the real builders feeding the real V2VAULT-001 vault writers
//    (lib/sync/store.ts), then reading them back. Proves acceptance
//    criterion 1: written through the existing offline vault writers, no new
//    write path. See this file's header for why this is the strongest
//    available proxy for ClaimComposer's own (hooks-inaccessible) submit().
// ===========================================================================

test("PIPELINE: a promoted claim with one piece of evidence round-trips through the real V2VAULT-001 writers", async () => {
  const workspaceId = `ws-pipeline-${crypto.randomUUID()}`;
  const range = sampleRange();
  const now = new Date().toISOString();

  const session = buildStudySessionDraft({ id: crypto.randomUUID(), workspaceId, range, now });
  await store.saveLocalStudySession(session);

  const claim = buildStudyClaimDraft({
    id: crypto.randomUUID(),
    workspaceId,
    sessionId: session.id,
    range,
    body: "The serpent is more crafty than any other beast.",
    selection: fullSelection({ kind: "observation", epistemicBasis: "text_explicit" }),
    now,
  });
  await store.saveLocalStudyClaim(claim);

  const evidence = buildClaimEvidenceDraft({
    id: crypto.randomUUID(),
    workspaceId,
    claimId: claim.id,
    range,
    draft: { id: "row-1", type: "passage", note: "Verse 1 names the serpent as more crafty." },
    now,
  });
  await store.saveLocalClaimEvidence(evidence);

  const [sessions, claims, evidenceRows] = await Promise.all([
    store.listLocalV2Entities("session"),
    store.listLocalV2Entities("claim"),
    store.listLocalV2Entities("evidence"),
  ]);

  assert.ok((sessions as StudySession[]).some((s) => s.id === session.id), "session was not persisted");
  const savedClaim = (claims as StudyClaim[]).find((c) => c.id === claim.id);
  assert.ok(savedClaim, "claim was not persisted");
  assert.equal(savedClaim!.kind, "observation");
  assert.equal(savedClaim!.workspaceId, workspaceId);
  const savedEvidence = (evidenceRows as ClaimEvidence[]).find((e) => e.id === evidence.id);
  assert.ok(savedEvidence, "evidence was not persisted");
  assert.equal(savedEvidence!.claimId, claim.id);
  assert.equal(savedEvidence!.note, "Verse 1 names the serpent as more crafty.");
});

test("PIPELINE: an existing session is reused (no second session id introduced) when building a second claim for it", async () => {
  const workspaceId = `ws-pipeline-reuse-${crypto.randomUUID()}`;
  const range = sampleRange();
  const now = new Date().toISOString();
  const session = buildStudySessionDraft({ id: crypto.randomUUID(), workspaceId, range, now });
  await store.saveLocalStudySession(session);

  const claimA = buildStudyClaimDraft({
    id: crypto.randomUUID(),
    workspaceId,
    sessionId: session.id,
    range,
    body: "first claim",
    selection: fullSelection(),
    now,
  });
  const claimB = buildStudyClaimDraft({
    id: crypto.randomUUID(),
    workspaceId,
    sessionId: session.id,
    range,
    body: "second claim",
    selection: fullSelection({ kind: "theology", doctrineStatus: "open" }),
    now,
  });
  await store.saveLocalStudyClaim(claimA);
  await store.saveLocalStudyClaim(claimB);

  const claims = (await store.listLocalV2Entities("claim")) as StudyClaim[];
  const ours = claims.filter((c) => c.workspaceId === workspaceId);
  assert.equal(ours.length, 2);
  assert.ok(ours.every((c) => c.sessionId === session.id), "both claims must share the one existing session");
});
