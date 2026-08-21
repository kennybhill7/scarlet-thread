/**
 * APPLYPANE-001 — the Apply / "Practice Bridge" section
 * (`components/workspace/ApplySection.tsx`), BUILD_PLAN §4 row 7.
 *
 * TEST-ENVIRONMENT NOTE (same discipline as tests/study-composer.test.ts,
 * tests/workspace-shell.test.ts, and tests/claim-panes.test.ts, all read as
 * precedent before writing this file): this repo's test script is
 * `tsx --test tests/*.test.ts` — plain Node, no jsdom. The same techniques
 * those files use are used here:
 *
 *   1. `nodeRequire` + `require.cache` seeding loads the real component
 *      file, stubbing the CSS Modules its module graph touches
 *      (`Button`/`Chip`/`Field` — imported directly — plus
 *      `claim-composer.module.css`, pulled in transitively because
 *      `ApplySection.tsx` reuses `ClaimComposer.tsx`'s own `optionsFrom`
 *      rather than re-implementing it), plus "fake-indexeddb/auto" so
 *      `lib/sync/store.ts`'s module-level `openDB(...)` call succeeds.
 *   2. Every readiness/record-builder/lookup function `ApplySection.tsx`
 *      exports is pure and hookless, so it is called directly to prove the
 *      real logic, never a parallel reimplementation.
 *   3. `react-dom/server`'s `renderToStaticMarkup` renders the real
 *      `ApplySection` (and the full `WorkspaceShell`) to actual HTML for
 *      structural/copy assertions.
 *   4. Section G below calls the REAL `saveLocalApplication` /
 *      `listLocalV2Entities` from `@/lib/sync/store` (not stubbed) to prove,
 *      not merely assert in a comment, the read-only vault schema's actual
 *      non-empty floor this file's own header describes.
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
  MODERN_DOMAINS,
  RESPONSE_TYPES,
  type Application,
  type ModernDomain,
  type ResponseType,
  type StudyClaim,
  type StudySession,
} from "@/lib/contracts/study-v2";
import { listLocalV2Entities, saveLocalApplication } from "@/lib/sync/store";

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

export interface ApplicationDraft {
  sourceClaimId: string | null;
  originalAudienceMeaning: string;
  enduringPrinciple: string;
  canonicalBridge: string;
  applicationClass: string;
  promiseScope: string;
  modernDomain: ModernDomain | null;
  situation: string;
  responseType: ResponseType | null;
  faithfulResponse: string;
  cautions: string;
}
interface ApplicationReadiness {
  ready: boolean;
  missing: string[];
}

const applySectionModule = nodeRequire("@/components/workspace/ApplySection.tsx") as {
  BLANK_APPLICATION_DRAFT: ApplicationDraft;
  patchApplicationDraft: (draft: ApplicationDraft, patch: Partial<ApplicationDraft>) => ApplicationDraft;
  theologyClaimsFor: (claims: StudyClaim[]) => StudyClaim[];
  theologyClaimLabel: (claim: StudyClaim) => string;
  draftSaveReadiness: (draft: ApplicationDraft) => ApplicationReadiness;
  finalizeReadiness: (draft: ApplicationDraft) => ApplicationReadiness;
  buildApplicationRecord: (params: {
    id: string;
    workspaceId: string;
    sessionId: string;
    draft: ApplicationDraft;
    status: "draft" | "finalized";
    revision: number;
    createdAt: string;
    now: string;
  }) => Application;
  sensitiveDomainNotice: (domain: ModernDomain | null) => string | null;
  ApplySection: (props: {
    workspaceId: string;
    session: StudySession;
    unlocked: boolean;
    claims: StudyClaim[];
    onSaved: (application: Application) => void;
  }) => unknown;
};

const {
  BLANK_APPLICATION_DRAFT,
  patchApplicationDraft,
  theologyClaimsFor,
  theologyClaimLabel,
  draftSaveReadiness,
  finalizeReadiness,
  buildApplicationRecord,
  sensitiveDomainNotice,
  ApplySection,
} = applySectionModule;

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
//
// (No tree-walking helper here, unlike tests/claim-panes.test.ts: that
// file's `PromoteFields` is deliberately hookless, so it can be called as a
// plain function and its returned element tree walked directly.
// `ApplySection` is a stateful component (`useState`), so it cannot be
// invoked outside a real render pass; string-based assertions on
// `renderToStaticMarkup`'s output, below, are this file's structural proof
// instead — the same technique `tests/workspace-shell.test.ts`'s own RENDER
// section already uses for the equally-stateful `WorkspaceShell`.)
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
    currentStep: "apply",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function theologyClaim(overrides: Partial<StudyClaim> = {}): StudyClaim {
  return {
    id: "claim-theology-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    kind: "theology",
    epistemicBasis: "text_explicit",
    body: "God is faithful to keep every promise he makes, even across generations.",
    passage: RANGE,
    confidence: "developing",
    provenance: "learner",
    doctrineStatus: "core",
    status: "draft",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

/** Every field filled — the finalize-ready fixture. */
function fullDraft(overrides: Partial<ApplicationDraft> = {}): ApplicationDraft {
  return {
    sourceClaimId: "claim-theology-1",
    originalAudienceMeaning: "The exiles heard this as a promise God had not forgotten them.",
    enduringPrinciple: "God keeps covenant promises across generations.",
    canonicalBridge: "The whole storyline, fulfilled in Christ, carries this promise forward to today.",
    applicationClass: "promise",
    promiseScope: "Applies to God's covenant people, conditioned on continued trust.",
    modernDomain: "work",
    situation: "I am waiting on something I have prayed about for years.",
    responseType: "rest",
    faithfulResponse: "I will keep trusting instead of forcing an outcome.",
    cautions: "I should not use this to excuse inaction where I do have a real responsibility to act.",
    ...overrides,
  };
}

function missingCautionsDraft(): ApplicationDraft {
  return fullDraft({ cautions: "" });
}

// ===========================================================================
// A. Pure draft state — patchApplicationDraft / theologyClaimsFor / theologyClaimLabel.
// ===========================================================================

test("BLANK_APPLICATION_DRAFT starts every field null/empty -- nothing pre-selected (assertion-line discipline)", () => {
  assert.deepEqual(BLANK_APPLICATION_DRAFT, {
    sourceClaimId: null,
    originalAudienceMeaning: "",
    enduringPrinciple: "",
    canonicalBridge: "",
    applicationClass: "",
    promiseScope: "",
    modernDomain: null,
    situation: "",
    responseType: null,
    faithfulResponse: "",
    cautions: "",
  });
});

test("patchApplicationDraft merges without mutating the original", () => {
  const patched = patchApplicationDraft(BLANK_APPLICATION_DRAFT, { situation: "new text" });
  assert.equal(patched.situation, "new text");
  assert.equal(BLANK_APPLICATION_DRAFT.situation, "", "original draft must not be mutated");
  assert.notEqual(patched, BLANK_APPLICATION_DRAFT, "must return a new object");
});

test("theologyClaimsFor keeps only non-deleted theology-kind claims", () => {
  const claims: StudyClaim[] = [
    theologyClaim({ id: "t1" }),
    theologyClaim({ id: "t2-deleted", deletedAt: "2026-01-02T00:00:00.000Z" }),
    { ...theologyClaim({ id: "obs" }), kind: "observation" },
  ];
  const result = theologyClaimsFor(claims);
  assert.deepEqual(
    result.map((c) => c.id),
    ["t1"],
  );
});

test("theologyClaimLabel returns the claim's own words, truncated past 64 chars", () => {
  const short = theologyClaim({ body: "Short claim." });
  assert.equal(theologyClaimLabel(short), "Short claim.");

  const longBody = "x".repeat(100);
  const long = theologyClaim({ body: longBody });
  const label = theologyClaimLabel(long);
  assert.equal(label.length, 65, "64 chars + ellipsis");
  assert.ok(label.endsWith("…"));
  assert.equal(label.slice(0, 64), longBody.slice(0, 64), "must be the claim's own words, not reworded");
});

// ===========================================================================
// B. Readiness — draftSaveReadiness / finalizeReadiness. The vault-schema
//    floor (everything but cautions) vs. the full BUILD_PLAN §3.3 bridge set
//    (everything, cautions included) — see ApplySection.tsx's own header.
// ===========================================================================

test("draftSaveReadiness: BLANK_APPLICATION_DRAFT is missing all ten reasons", () => {
  const readiness = draftSaveReadiness(BLANK_APPLICATION_DRAFT);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.missing.length, 10);
});

test("draftSaveReadiness: a fully filled draft MINUS cautions is still ready -- cautions is the one field the vault schema allows empty", () => {
  const readiness = draftSaveReadiness(missingCautionsDraft());
  assert.deepEqual(readiness, { ready: true, missing: [] });
});

test("draftSaveReadiness: any ONE of the nine required fields left blank blocks readiness, one at a time", () => {
  const requiredKeys: Array<keyof ApplicationDraft> = [
    "sourceClaimId",
    "originalAudienceMeaning",
    "enduringPrinciple",
    "canonicalBridge",
    "applicationClass",
    "promiseScope",
    "modernDomain",
    "situation",
    "responseType",
    "faithfulResponse",
  ];
  for (const key of requiredKeys) {
    const blankValue = typeof fullDraft()[key] === "string" ? "" : null;
    const draft = { ...fullDraft(), [key]: blankValue };
    const readiness = draftSaveReadiness(draft);
    assert.equal(readiness.ready, false, `blanking ${key} should block draftSaveReadiness`);
  }
});

test("draftSaveReadiness treats a whitespace-only value the same as blank (trim-based, not raw length)", () => {
  const readiness = draftSaveReadiness(fullDraft({ situation: "   " }));
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.some((m) => /situation/i.test(m)));
});

test("finalizeReadiness: the fully filled draft (cautions included) is ready", () => {
  assert.deepEqual(finalizeReadiness(fullDraft()), { ready: true, missing: [] });
});

test("finalizeReadiness: the SAME draft that satisfies draftSaveReadiness (cautions blank) is NOT finalize-ready", () => {
  const draft = missingCautionsDraft();
  assert.equal(draftSaveReadiness(draft).ready, true, "sanity: draft-ready");
  const finalize = finalizeReadiness(draft);
  assert.equal(finalize.ready, false);
  assert.deepEqual(finalize.missing, ["Name any cautions or guardrails you want to keep in mind as you respond."]);
});

// ===========================================================================
// C. buildApplicationRecord — the pure record builder.
// ===========================================================================

test("buildApplicationRecord builds a full Application, trimming every text field", () => {
  const record = buildApplicationRecord({
    id: "app-1",
    workspaceId: "ws-1",
    sessionId: "session-1",
    draft: fullDraft({ situation: "  padded on both sides  " }),
    status: "draft",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(record.situation, "padded on both sides");
  assert.equal(record.status, "draft");
  assert.equal(record.sourceClaimId, "claim-theology-1");
  assert.equal(record.modernDomain, "work");
  assert.equal(record.responseType, "rest");
  assert.equal(record.availableAfter, null);
  assert.equal(record.revision, 1);
});

test("buildApplicationRecord throws when sourceClaimId/modernDomain/responseType are missing -- callers must gate on readiness first", () => {
  assert.throws(() =>
    buildApplicationRecord({
      id: "app-1",
      workspaceId: "ws-1",
      sessionId: "session-1",
      draft: { ...fullDraft(), sourceClaimId: null },
      status: "draft",
      revision: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      now: "2026-01-01T00:00:00.000Z",
    }),
  );
  assert.throws(() =>
    buildApplicationRecord({
      id: "app-1",
      workspaceId: "ws-1",
      sessionId: "session-1",
      draft: { ...fullDraft(), modernDomain: null },
      status: "draft",
      revision: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      now: "2026-01-01T00:00:00.000Z",
    }),
  );
  assert.throws(() =>
    buildApplicationRecord({
      id: "app-1",
      workspaceId: "ws-1",
      sessionId: "session-1",
      draft: { ...fullDraft(), responseType: null },
      status: "draft",
      revision: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      now: "2026-01-01T00:00:00.000Z",
    }),
  );
});

// ===========================================================================
// D. Sensitive modernDomain referral copy (SAFETY-CRITICAL).
// ===========================================================================

test("sensitiveDomainNotice: grief, anxiety, and money each get a static referral notice", () => {
  for (const domain of ["grief", "anxiety", "money"] as ModernDomain[]) {
    const notice = sensitiveDomainNotice(domain);
    assert.ok(notice, `${domain} should carry a referral notice`);
    assert.match(notice!, /consider talking with|does not give (financial )?advice/i);
  }
});

test("sensitiveDomainNotice: the seven remaining domains render NOTHING -- not fully confident, so nothing is guessed", () => {
  const uncoveredDomains = MODERN_DOMAINS.filter((d) => !["grief", "anxiety", "money"].includes(d));
  assert.equal(uncoveredDomains.length, 7, "sanity: exactly seven of the ten domains are uncovered");
  for (const domain of uncoveredDomains) {
    assert.equal(sensitiveDomainNotice(domain), null, `${domain} should render no sensitive-domain notice`);
  }
});

test("sensitiveDomainNotice(null) is null -- no domain chosen yet renders nothing", () => {
  assert.equal(sensitiveDomainNotice(null), null);
});

test("SAFETY: no sensitive-domain notice tells the learner what to actually DO -- referral language only, never actionable advice", () => {
  for (const domain of ["grief", "anxiety", "money"] as ModernDomain[]) {
    const notice = sensitiveDomainNotice(domain)!;
    // Forbidden shapes: a prescriptive imperative telling the learner what
    // to do about their money/grief/anxiety itself (medical/financial/legal
    // advice), as opposed to a pointer toward a professional/pastor.
    assert.doesNotMatch(
      notice,
      /you should (invest|sell|buy|take|stop taking|file|sue)|the (correct|right) (amount|dose|treatment)/i,
      `${domain} notice must stay referral-only: "${notice}"`,
    );
  }
});

// ===========================================================================
// E. RENDER — the real ApplySection component.
// ===========================================================================

test("RENDER ApplySection: locked shows LockedNotice only -- no form, no field labels", () => {
  const html = renderToStaticMarkup(
    createElement(ApplySection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: false,
      claims: [theologyClaim()],
      onSaved: () => {},
    }),
  );
  assert.ok(html.includes('data-testid="apply-locked"'));
  assert.ok(!html.includes('data-testid="apply-form"'));
  assert.ok(!html.includes("What did this passage mean to its original audience"));
});

test("RENDER ApplySection: unlocked mounts the real form, with the theology claim offered as a chip", () => {
  const html = renderToStaticMarkup(
    createElement(ApplySection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: true,
      claims: [theologyClaim()],
      onSaved: () => {},
    }),
  );
  assert.ok(!html.includes('data-testid="apply-locked"'));
  assert.ok(html.includes('data-testid="apply-form"'));
  assert.ok(html.includes('data-field="sourceClaimId"'));
  assert.ok(html.includes('data-value="claim-theology-1"'));
  assert.ok(html.includes(theologyClaim().body.slice(0, 40)), "the claim's own words must appear as its chip label");
});

test("RENDER ApplySection: modernDomain/responseType render as CHIPS (real enum pickers), applicationClass/promiseScope render as free-text FIELDS, never chips", () => {
  const html = renderToStaticMarkup(
    createElement(ApplySection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: true,
      claims: [theologyClaim()],
      onSaved: () => {},
    }),
  );
  for (const domain of MODERN_DOMAINS) {
    assert.ok(html.includes(`data-value="${domain}"`), `modernDomain chip missing for ${domain}`);
  }
  for (const responseType of RESPONSE_TYPES) {
    assert.ok(html.includes(`data-value="${responseType}"`), `responseType chip missing for ${responseType}`);
  }
  assert.ok(
    !html.includes('data-field="applicationClass"'),
    "applicationClass must never render as a chip picker -- BUILD_PLAN §3.3 forbids inventing its enum",
  );
  assert.ok(
    !html.includes('data-field="promiseScope"'),
    "promiseScope must never render as a chip picker -- BUILD_PLAN §3.3 forbids inventing its enum",
  );
  assert.match(html, /does not supply a fixed list/i, "the free-text hint for applicationClass/promiseScope must be present");
});

test("RENDER ApplySection: the sensitive-domain notice does NOT appear before a sensitive domain is chosen (nothing pre-selected)", () => {
  const html = renderToStaticMarkup(
    createElement(ApplySection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: true,
      claims: [theologyClaim()],
      onSaved: () => {},
    }),
  );
  assert.ok(!html.includes('data-testid="apply-sensitive-notice"'));
});

test("ASSERTION-LINE: no field label or static notice in ApplySection asserts what the passage MEANS -- every prompt asks what the learner thinks/would do/classifies this as", () => {
  const html = renderToStaticMarkup(
    createElement(ApplySection as never, {
      workspaceId: "ws-1",
      session: sampleSession(),
      unlocked: true,
      claims: [theologyClaim()],
      onSaved: () => {},
    }),
  );
  assert.doesNotMatch(html, /this passage means|the correct (view|interpretation)|this proves|teaches that/i);
});

// ===========================================================================
// F. MUTATION-TARGET (acceptance criterion 9) — the draft-vs-finalize
//    completeness check. See this task's commit message for the verbatim
//    mutation-proof run (break -> named test fails -> restore -> green).
// ===========================================================================

test("MUTATION-TARGET criterion 9: finalizeReadiness must be STRICTLY MORE demanding than draftSaveReadiness -- a finalize that accepts a cautions-less record is exactly the bug this proves absent", () => {
  const draft = missingCautionsDraft();
  const draftReady = draftSaveReadiness(draft);
  const finalReady = finalizeReadiness(draft);
  assert.equal(draftReady.ready, true, "sanity: this draft passes the lower (draft) bar");
  assert.equal(
    finalReady.ready,
    false,
    "BUG IF THIS FAILS: finalize accepted an Application with no cautions -- BUILD_PLAN §3.3's full ten-field bridge set requires it",
  );
});

// ===========================================================================
// G. VAULT INTEGRATION — the real `saveLocalApplication`/`listLocalV2Entities`
//    (not stubbed), proving this file's own header claim about the read-only
//    schema's floor is TRUE, not merely asserted in a comment.
// ===========================================================================

test("VAULT: a finalize-ready record saves successfully through the real saveLocalApplication and reads back byte-identical", async () => {
  const record = buildApplicationRecord({
    id: "app-vault-1",
    workspaceId: "workspace-vault-1",
    sessionId: "session-vault-1",
    draft: fullDraft(),
    status: "draft",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    now: "2026-01-01T00:00:00.000Z",
  });
  await saveLocalApplication(record);
  const rows = (await listLocalV2Entities("application")) as Application[];
  const saved = rows.find((r) => r.id === "app-vault-1");
  assert.ok(saved, "the record must actually be persisted");
  assert.deepEqual(saved, record);
});

test("VAULT: re-saving the SAME id with status flipped to 'finalized' updates in place, not a second row", async () => {
  const draftRecord = buildApplicationRecord({
    id: "app-vault-2",
    workspaceId: "workspace-vault-1",
    sessionId: "session-vault-1",
    draft: fullDraft(),
    status: "draft",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    now: "2026-01-01T00:00:00.000Z",
  });
  await saveLocalApplication(draftRecord);
  const finalizedRecord = buildApplicationRecord({
    id: "app-vault-2",
    workspaceId: "workspace-vault-1",
    sessionId: "session-vault-1",
    draft: fullDraft(),
    status: "finalized",
    revision: 2,
    createdAt: draftRecord.createdAt,
    now: "2026-01-02T00:00:00.000Z",
  });
  await saveLocalApplication(finalizedRecord);
  const rows = (await listLocalV2Entities("application")) as Application[];
  const matches = rows.filter((r) => r.id === "app-vault-2");
  assert.equal(matches.length, 1, "must update the same row, not append a second one");
  assert.equal(matches[0].status, "finalized");
  assert.equal(matches[0].revision, 2);
});

test("VAULT PROOF OF THIS FILE'S OWN HEADER CLAIM: a record missing one of the nine schema-required bridge fields is REJECTED by the real saveLocalApplication -- confirming the vault floor described above is real, not merely asserted", async () => {
  const incomplete: Application = {
    id: "app-vault-incomplete",
    workspaceId: "workspace-vault-1",
    sessionId: "session-vault-1",
    sourceClaimId: "claim-theology-1",
    originalAudienceMeaning: "", // blank -- the vault schema's own min(1) must reject this
    enduringPrinciple: "e",
    canonicalBridge: "c",
    applicationClass: "class",
    promiseScope: "scope",
    modernDomain: "work",
    situation: "s",
    responseType: "rest",
    faithfulResponse: "f",
    cautions: "",
    availableAfter: null,
    status: "draft",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
  await assert.rejects(() => saveLocalApplication(incomplete));
});

test("VAULT PROOF: cautions IS the one field the real schema allows blank -- an otherwise-complete draft with empty cautions saves successfully", async () => {
  const record = buildApplicationRecord({
    id: "app-vault-cautions-blank",
    workspaceId: "workspace-vault-1",
    sessionId: "session-vault-1",
    draft: missingCautionsDraft(),
    status: "draft",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    now: "2026-01-01T00:00:00.000Z",
  });
  await saveLocalApplication(record);
  const rows = (await listLocalV2Entities("application")) as Application[];
  assert.ok(rows.some((r) => r.id === "app-vault-cautions-blank"));
});

// ===========================================================================
// H. WorkspaceShell integration — the actual regression this task cares
//    about: Apply locked with zero theology claims, real with one.
// ===========================================================================

function renderShell(props: { session: StudySession; claims?: StudyClaim[]; applications?: Application[] }): string {
  const element = createElement(WorkspaceShell as never, { workspaceId: "workspace-1", ...props } as never);
  return renderToStaticMarkup(element as never);
}

test("SHELL: Apply's real form does NOT mount with zero theology claims (a non-theology claim is not enough)", () => {
  const html = renderShell({
    session: sampleSession({ currentStep: "apply" }),
    claims: [{ ...theologyClaim({ id: "obs" }), kind: "observation" }],
    applications: [],
  });
  assert.ok(html.includes('data-testid="apply-locked"'));
  assert.ok(!html.includes('data-testid="apply-form"'));
});

test("SHELL: Apply's real form mounts once >=1 theology claim exists", () => {
  const html = renderShell({
    session: sampleSession({ currentStep: "apply" }),
    claims: [theologyClaim()],
    applications: [],
  });
  assert.ok(!html.includes('data-testid="apply-locked"'));
  assert.ok(html.includes('data-testid="apply-form"'));
  assert.ok(html.includes('data-value="claim-theology-1"'), "the session's own theology claim must be offered");
});

// REGRESSION GUARD (re-running the CLAIMPANES-001-established proof once
// more against THIS task's own WorkspaceShell wiring, per acceptance
// criterion 9's explicit instruction) -- Theology must still not require a
// Connection first, unaffected by Apply's new dispatch branch existing
// alongside it.
test("SHELL (regression guard): Theology's real composer still mounts with a bare observation claim and ZERO connections, unaffected by Apply's own new wiring", () => {
  const html = renderShell({
    session: sampleSession({ currentStep: "theology" }),
    claims: [{ ...theologyClaim({ id: "obs" }), kind: "observation" }],
    applications: [],
  });
  assert.ok(!html.includes('data-testid="theology-locked"'));
  assert.ok(html.includes("What do you believe this passage teaches, and why?"));
});

test("SHELL: no assertion-line violation anywhere in a fully-populated shell render (Read..Apply all real)", () => {
  const html = renderShell({
    session: sampleSession({ currentStep: "apply" }),
    claims: [theologyClaim()],
    applications: [],
  });
  assert.doesNotMatch(html, /this passage means|correct interpretation/i);
});

// ===========================================================================
// MUTATION PROOFS (acceptance criterion 9) — documented in prose here too;
// see this task's final report for the verbatim before/after `npm test`
// output the mutations actually produced.
//
//   1. finalize-accepts-incomplete (`components/workspace/ApplySection.tsx`,
//      `finalizeReadiness`'s `isBlank(draft.cautions) ? [...base.missing,
//      CAUTIONS_REASON] : [...base.missing]` line): mutated to
//      `return base;` (finalize silently drops the cautions check, becoming
//      identical to draftSaveReadiness). Named test that fails: "MUTATION-
//      TARGET criterion 9: finalizeReadiness must be STRICTLY MORE demanding
//      than draftSaveReadiness -- a finalize that accepts a cautions-less
//      record is exactly the bug this proves absent" (this file), and this
//      file's own "finalizeReadiness: the SAME draft that satisfies
//      draftSaveReadiness (cautions blank) is NOT finalize-ready".
//   2. Theology-unlocked-without-Connect (`lib/workspace/gating.ts`,
//      `computeStepGates`'s `theology: hasAnyClaim(claims)` line): mutated to
//      `theology: hasAnyClaim(claims) && hasAttemptedComparison(claims)` --
//      re-run once more against this task's own changes to WorkspaceShell.tsx
//      (the Apply dispatch branch). Named tests that failed:
//      tests/workspace-shell.test.ts's own "GATE: Theology unlocks with a
//      bare observation and ZERO connections...", tests/claim-panes.test.ts's
//      own SHELL regression guard, and this file's own "SHELL (regression
//      guard): Theology's real composer still mounts...".
//
// Both mutations were applied directly to their real production files (both
// ownedPaths here), `npm test` was run and confirmed the named tests above
// FAILING (and no other unrelated test), each file was restored from a
// backup copy made before the mutation, `diff` confirmed the restored file
// byte-identical to the pre-mutation original, and `npm test` was re-run and
// confirmed green again.
// ===========================================================================
