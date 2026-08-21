import assert from "node:assert/strict";
import test from "node:test";

import { strFromU8, unzipSync } from "fflate";

import { buildVaultArchive } from "@/lib/export/vault";
import { SYNC_ENTITIES_V2, type SyncEntityV2 } from "@/lib/contracts/sync-v2";
import { CANONICAL_VERSIFICATION_ID } from "@/lib/contracts/range-v1";
import type {
  Application,
  ClaimEvidence,
  MotifCandidate,
  MotifSighting,
  StudyClaim,
  StudySession,
  TeachingDraft,
  TeachingSection,
  UserConnection,
} from "@/lib/contracts/study-v2";

// ---------------------------------------------------------------------------
// EXPORTV2-001 — export the v2 entities so the learner still owns their work.
//
// Every fixture embeds a UNIQUE, randomly-generated marker string in a free-
// text field. Assertions below parse the ARCHIVE OUTPUT (unzipped file
// bytes) and search for those markers — never the source fixture objects —
// so an exporter that silently drops a field or an entire entity actually
// fails these tests instead of trivially passing because "the function did
// not throw."
// ---------------------------------------------------------------------------

const WORKSPACE_A = "workspace-a";
const WORKSPACE_B = "workspace-b";

function range(start: string, end = start) {
  return { versificationId: CANONICAL_VERSIFICATION_ID, start, end };
}

function mark(label: string) {
  return `MARK-${label}-${crypto.randomUUID()}`;
}

function allFileText(archive: Uint8Array) {
  const files = unzipSync(archive);
  return {
    files,
    text: Object.values(files)
      .map((bytes) => strFromU8(bytes))
      .join("\n---FILE-BOUNDARY---\n"),
  };
}

function makeSession(
  workspaceId: string,
  id: string,
  marker: string,
  now: string,
  extra: Partial<StudySession> = {},
): StudySession {
  return {
    id,
    workspaceId,
    range: range("1.1.1", "1.1.5"),
    mode: "encounter",
    workflowState: "active",
    connectionState: "unexamined",
    currentStep: marker,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

function makeClaim(
  workspaceId: string,
  id: string,
  bodyMarker: string,
  sessionId: string,
  now: string,
  extra: Partial<StudyClaim> = {},
): StudyClaim {
  return {
    id,
    workspaceId,
    sessionId,
    kind: "observation",
    epistemicBasis: "text_explicit",
    body: bodyMarker,
    passage: range("1.1.1"),
    confidence: "developing",
    provenance: "learner",
    doctrineStatus: null,
    status: "draft",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

function makeEvidence(
  workspaceId: string,
  id: string,
  noteMarker: string,
  claimId: string,
  now: string,
): ClaimEvidence {
  return {
    id,
    workspaceId,
    claimId,
    evidenceType: "passage",
    canonicalReference: range("1.1.1"),
    note: noteMarker,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function makeMotif(
  workspaceId: string,
  id: string,
  labelMarker: string,
  now: string,
): MotifCandidate {
  return {
    id,
    workspaceId,
    label: labelMarker,
    normalizedKey: labelMarker.toLowerCase(),
    status: "candidate",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function makeSighting(
  workspaceId: string,
  id: string,
  unitMarker: string,
  candidateId: string,
  now: string,
): MotifSighting {
  return {
    id,
    workspaceId,
    candidateId,
    passageUnitKey: unitMarker,
    exactRange: range("1.1.1"),
    status: "candidate",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function makeConnection(
  workspaceId: string,
  id: string,
  rationaleMarker: string,
  now: string,
): UserConnection {
  return {
    id,
    workspaceId,
    fromRange: range("1.1.1"),
    toRange: range("40.1.1"),
    type: "quotation",
    evidenceLabel: "strong",
    rationale: `${rationaleMarker} — twenty-plus characters of rationale text.`,
    status: "draft",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function makeApplication(
  workspaceId: string,
  id: string,
  situationMarker: string,
  sessionId: string,
  sourceClaimId: string,
  now: string,
): Application {
  return {
    id,
    workspaceId,
    sessionId,
    sourceClaimId,
    originalAudienceMeaning: "meaning",
    enduringPrinciple: "principle",
    canonicalBridge: "bridge",
    applicationClass: "class",
    promiseScope: "scope",
    modernDomain: "work",
    situation: situationMarker,
    responseType: "action",
    faithfulResponse: "response",
    cautions: "none",
    status: "draft",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function makeTeachingDraft(
  workspaceId: string,
  id: string,
  titleMarker: string,
  sessionId: string,
  now: string,
): TeachingDraft {
  return {
    id,
    workspaceId,
    sessionId,
    title: titleMarker,
    bigIdea: "idea",
    audience: "adults",
    durationMinutes: 30,
    gospelConnection: "connection",
    status: "draft",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function makeTeachingSection(
  workspaceId: string,
  id: string,
  bodyMarker: string,
  draftId: string,
  now: string,
): TeachingSection {
  return {
    id,
    workspaceId,
    draftId,
    kind: "outline",
    sortOrder: 0,
    body: bodyMarker,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Coverage: all nine SYNC_ENTITIES_V2 entities, driven off the runtime
// contract array (never a hand-retyped list of the entity names).
// ---------------------------------------------------------------------------

test("vault export renders every SYNC_ENTITIES_V2 entity's content in the archive output (runtime-driven coverage, not a hand-written list)", () => {
  const now = new Date().toISOString();
  const sessionId = "sess-cov";
  const claimId = "claim-cov";
  const motifId = "motif-cov";

  // MARKERS is built by mapping over SYNC_ENTITIES_V2 itself, not by typing
  // out the eight entity names a second time.
  const MARKERS = Object.fromEntries(
    SYNC_ENTITIES_V2.map((entity) => [entity, mark(entity)]),
  ) as Record<SyncEntityV2, string>;

  const archive = buildVaultArchive({
    entries: [
      {
        id: crypto.randomUUID(),
        kind: "note",
        body: "v1 entry stays unaffected by v2 export.",
        chapter: "1.1",
        threads: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    threads: [],
    people: [],
    logs: [],
    workspaceId: WORKSPACE_A,
    session: [makeSession(WORKSPACE_A, sessionId, MARKERS.session, now)],
    claim: [makeClaim(WORKSPACE_A, claimId, MARKERS.claim, sessionId, now)],
    evidence: [
      makeEvidence(WORKSPACE_A, "ev-cov", MARKERS.evidence, claimId, now),
    ],
    motif: [makeMotif(WORKSPACE_A, motifId, MARKERS.motif, now)],
    motifSighting: [
      makeSighting(WORKSPACE_A, "sight-cov", MARKERS.motifSighting, motifId, now),
    ],
    connection: [
      makeConnection(WORKSPACE_A, "conn-cov", MARKERS.connection, now),
    ],
    application: [
      makeApplication(
        WORKSPACE_A,
        "app-cov",
        MARKERS.application,
        sessionId,
        claimId,
        now,
      ),
    ],
    teachingDraft: [
      makeTeachingDraft(
        WORKSPACE_A,
        "teach-cov",
        MARKERS.teachingDraft,
        sessionId,
        now,
      ),
    ],
    teachingSection: [
      makeTeachingSection(
        WORKSPACE_A,
        "section-cov",
        MARKERS.teachingSection,
        "teach-cov",
        now,
      ),
    ],
  });

  const { files, text } = allFileText(archive);

  // Sanity pin on the contract's actual entity count — not derived from
  // vault.ts, just from lib/contracts/sync-v2.ts this test is proving
  // coverage against. Updated to nine by TEACHSECTIONSYNC-001/wave-18
  // integration; BUILD_PLAN's own prose ("eight new entities") is now
  // stale by the same one and is a documentation follow-up, not a code bug.
  assert.equal(SYNC_ENTITIES_V2.length, 9);

  for (const entity of SYNC_ENTITIES_V2) {
    assert.ok(
      text.includes(MARKERS[entity]),
      `expected the archive output to contain entity "${entity}"'s marker (${MARKERS[entity]}), but it did not — this entity was silently dropped from export`,
    );
  }

  // v1 export is untouched by the v2 addition.
  assert.match(
    strFromU8(files["Bible Brain/01 Passages/1.1.md"]),
    /v1 entry stays unaffected by v2 export\./,
  );
});

// ---------------------------------------------------------------------------
// BUILD_PLAN 3.4: "a claim exports as Markdown with its evidence list" — not
// a bare row. Exact rendered shape (see this test + the commit message for
// the literal Markdown).
// ---------------------------------------------------------------------------

test("a claim exports as Markdown WITH its evidence list attached (BUILD_PLAN 3.4), not as a bare row", () => {
  const now = new Date().toISOString();
  const archive = buildVaultArchive({
    entries: [],
    threads: [],
    people: [],
    logs: [],
    workspaceId: WORKSPACE_A,
    claim: [
      makeClaim(
        WORKSPACE_A,
        "claim-shape",
        "The land promise narrows to one line.",
        "sess-shape",
        now,
      ),
    ],
    evidence: [
      makeEvidence(
        WORKSPACE_A,
        "ev-shape-1",
        "Genesis 12:7 — the LORD appeared to Abram.",
        "claim-shape",
        now,
      ),
      makeEvidence(
        WORKSPACE_A,
        "ev-shape-2",
        "Cross-referenced against Genesis 15:18.",
        "claim-shape",
        now,
      ),
    ],
  });

  const { files } = allFileText(archive);
  const claimMd = strFromU8(files["Bible Brain/06 Study/Claims/claim-shape.md"]);

  assert.match(claimMd, /^# Claim — observation$/m);
  assert.match(claimMd, /The land promise narrows to one line\./);
  assert.match(claimMd, /^## Evidence$/m);
  assert.match(claimMd, /Genesis 12:7 — the LORD appeared to Abram\./);
  assert.match(claimMd, /Cross-referenced against Genesis 15:18\./);

  // Both evidence rows render as their own list item under the claim — a
  // list, not a single bare summary row.
  const evidenceListLines = claimMd
    .split("\n")
    .filter((line) => line.startsWith("- (type: passage"));
  assert.equal(evidenceListLines.length, 2);
});

test("a claim with no evidence renders an explicit 'None yet', not a silently empty section", () => {
  const now = new Date().toISOString();
  const archive = buildVaultArchive({
    entries: [],
    threads: [],
    people: [],
    logs: [],
    workspaceId: WORKSPACE_A,
    claim: [
      makeClaim(WORKSPACE_A, "claim-bare", "No evidence recorded yet.", "sess-bare", now),
    ],
  });
  const { files } = allFileText(archive);
  const claimMd = strFromU8(files["Bible Brain/06 Study/Claims/claim-bare.md"]);
  assert.match(claimMd, /## Evidence\n\n- None yet/);
});

// ---------------------------------------------------------------------------
// Tenant isolation — hostile: the exporter itself refuses to leak, even when
// handed mixed-workspace rows (never trust the caller already scoped it).
// ---------------------------------------------------------------------------

test("hostile: workspace A's export contains nothing belonging to workspace B, even with mixed-workspace input", () => {
  const now = new Date().toISOString();
  const claimA = makeClaim(
    WORKSPACE_A,
    "claim-a",
    "Belongs to workspace A only.",
    "sess-a",
    now,
  );
  const claimB = makeClaim(
    WORKSPACE_B,
    "claim-b",
    "Belongs to workspace B only — must never appear in A's export.",
    "sess-b",
    now,
  );
  // Hostile: an evidence row correctly tagged workspace A, but pointing its
  // claimId at workspace B's claim (a forged/mismatched op). It must not
  // leak claim B's content — the orphan-evidence path should hold it,
  // never a join into claim B's file (which does not exist in this export).
  const hostileEvidence = makeEvidence(
    WORKSPACE_A,
    "ev-hostile",
    "Hostile cross-tenant evidence payload.",
    "claim-b",
    now,
  );

  const archive = buildVaultArchive({
    entries: [],
    threads: [],
    people: [],
    logs: [],
    workspaceId: WORKSPACE_A,
    claim: [claimA, claimB],
    evidence: [hostileEvidence],
  });

  const { files, text } = allFileText(archive);

  assert.match(text, /Belongs to workspace A only\./);
  assert.doesNotMatch(text, /Belongs to workspace B only/);
  assert.equal(files["Bible Brain/06 Study/Claims/claim-b.md"], undefined);
  assert.ok(files["Bible Brain/06 Study/Claims/claim-a.md"]);
  // The hostile evidence row (itself workspace A's own data) is preserved,
  // not silently dropped, just correctly un-joined from B's claim.
  assert.match(text, /Hostile cross-tenant evidence payload\./);
});

test("hostile: a session belonging only to workspace B never appears when exporting workspace A", () => {
  const now = new Date().toISOString();
  const sessionA = makeSession(WORKSPACE_A, "sess-only-a", "workspace A session", now);
  const sessionB = makeSession(WORKSPACE_B, "sess-only-b", "workspace B session", now);

  const archive = buildVaultArchive({
    entries: [],
    threads: [],
    people: [],
    logs: [],
    workspaceId: WORKSPACE_A,
    session: [sessionA, sessionB],
  });

  const { files } = allFileText(archive);
  assert.ok(files["Bible Brain/06 Study/Sessions/sess-only-a.md"]);
  assert.equal(files["Bible Brain/06 Study/Sessions/sess-only-b.md"], undefined);
});

test("buildVaultArchive throws when v2 entity data is provided without a workspaceId (fail loudly, never export unscoped)", () => {
  const now = new Date().toISOString();
  assert.throws(() => {
    buildVaultArchive({
      entries: [],
      threads: [],
      people: [],
      logs: [],
      claim: [makeClaim(WORKSPACE_A, "claim-noworkspace", "x", "sess-x", now)],
    });
  }, /workspaceId is required/);
});

// ---------------------------------------------------------------------------
// Soft-deleted v2 rows — deliberate choice (see EXPORTV2-001 commit):
// INCLUDED, annotated, unlike v1 which omits them (export.test.ts "vault
// export omits soft-deleted writing" stays the v1 authority, unchanged).
// ---------------------------------------------------------------------------

test("soft-deleted v2 rows are INCLUDED in export, clearly annotated as deleted (opposite of v1's omission, by design)", () => {
  const now = new Date().toISOString();
  const deletedAt = new Date(Date.now() - 60_000).toISOString();
  const archive = buildVaultArchive({
    entries: [],
    threads: [],
    people: [],
    logs: [],
    workspaceId: WORKSPACE_A,
    claim: [
      makeClaim(
        WORKSPACE_A,
        "claim-deleted",
        "Tombstoned but not purged.",
        "sess-deleted",
        now,
        { deletedAt },
      ),
    ],
  });
  const { files } = allFileText(archive);
  const claimMd = strFromU8(files["Bible Brain/06 Study/Claims/claim-deleted.md"]);
  assert.match(claimMd, /Tombstoned but not purged\./);
  assert.ok(
    claimMd.includes(`[deleted ${deletedAt}]`),
    "expected the deleted claim's heading to carry a visible [deleted <timestamp>] annotation",
  );
});
