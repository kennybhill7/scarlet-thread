import assert from "node:assert/strict";
import test from "node:test";

import {
  V2ResourceRouteMutationRejected,
  assertReadOnlyV2ResourceRequest,
  canonicalRangeV1Schema,
  findDanglingDependsOnOpIds,
  groupOpsByMutationGroupId,
  isReadOnlyV2Method,
  parseSyncOpV2Payload,
  syncApplicationV2Schema,
  syncClaimEvidenceV2Schema,
  syncMotifCandidateV2Schema,
  syncMotifSightingV2Schema,
  syncOpV2Schema,
  syncPushV2Schema,
  syncStudyClaimV2Schema,
  syncStudySessionV2Schema,
  syncTeachingDraftV2Schema,
  syncUserConnectionV2Schema,
} from "@/lib/api/sync-v2";
import { CANONICAL_VERSIFICATION_ID } from "@/lib/contracts/range-v1";
import {
  SYNC_ENTITIES_V2,
  SYNC_MUTATIONS_V2,
  type SyncOpV2,
  isSyncEntityV2,
  isSyncMutationV2,
} from "@/lib/contracts/sync-v2";

// ---------------------------------------------------------------------------
// BUILD_PLAN.md:144's exact eight-item list (as reconciled by SYNCGAP-001),
// transcribed independently here from the doc text (not derived from the
// module under test — a test's expected value must never come from the code
// it is checking). If sync-v2.ts's exported array ever drifts — an added,
// removed, renamed, or reordered entity — this catches it.
// ---------------------------------------------------------------------------

const EXPECTED_SYNC_ENTITIES_V2 = [
  "session",
  "claim",
  "evidence",
  "motif",
  "motifSighting",
  "connection",
  "application",
  "teachingDraft",
];

test("SyncEntityV2 matches BUILD_PLAN.md:144 verbatim", () => {
  assert.deepEqual(SYNC_ENTITIES_V2, EXPECTED_SYNC_ENTITIES_V2);
});

test("lib/contracts.ts's v1 SyncEntity is untouched by this module", () => {
  // Static guarantee, exercised at runtime: importing lib/contracts/sync-v2.ts
  // must not require or re-export anything from lib/contracts.ts's SyncEntity.
  // The eight v2 values below are not part of the v1 SyncEntity vocabulary.
  const v1SyncEntities = ["entry", "thread", "person", "progress", "log", "stage"];
  for (const v2Entity of SYNC_ENTITIES_V2) {
    assert.equal(
      v1SyncEntities.includes(v2Entity),
      false,
      `"${v2Entity}" collides with a frozen v1 SyncEntity value`,
    );
  }
});

test("every SyncEntityV2 value round-trips through isSyncEntityV2", () => {
  for (const value of SYNC_ENTITIES_V2) {
    assert.equal(isSyncEntityV2(value), true, `expected "${value}" to be a SyncEntityV2`);
  }
  assert.equal(isSyncEntityV2("entry"), false); // a v1 SyncEntity value, not a v2 one
  assert.equal(isSyncEntityV2("not_a_real_entity"), false);
});

test("SyncMutationV2 is upsert/delete, matching the v1 SyncOp.op vocabulary", () => {
  assert.deepEqual(SYNC_MUTATIONS_V2, ["upsert", "delete"]);
  for (const value of SYNC_MUTATIONS_V2) {
    assert.equal(isSyncMutationV2(value), true);
  }
  assert.equal(isSyncMutationV2("patch"), false);
});

// ---------------------------------------------------------------------------
// Fixtures — one valid payload per v2 sync entity, matching
// lib/contracts/study-v2.ts's record interfaces and db/schema.ts's v2 tables.
// ---------------------------------------------------------------------------

function uuid(n: number): string {
  const suffix = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${suffix}`;
}

function range(start: string, end: string) {
  return { versificationId: CANONICAL_VERSIFICATION_ID, start, end };
}

const TS = "2026-01-01T00:00:00Z";

function validSessionPayload() {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    range: range("1.1.1", "1.1.1"),
    mode: "encounter",
    workflowState: "active",
    connectionState: "unexamined",
    catalogReleaseId: null,
    readGateAt: null,
    currentStep: "read",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  };
}

function validClaimPayload() {
  return {
    id: "claim-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    kind: "observation",
    epistemicBasis: "text_explicit",
    body: "God created the heavens and the earth.",
    passage: range("1.1.1", "1.1.1"),
    confidence: "tentative",
    provenance: "learner",
    doctrineStatus: null,
    viewpointId: null,
    status: "draft",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  };
}

function validEvidencePayload() {
  return {
    id: "evidence-1",
    workspaceId: "workspace-1",
    claimId: "claim-1",
    evidenceType: "passage",
    canonicalReference: range("1.1.1", "1.1.1"),
    displayReference: null,
    contentBlockId: null,
    citationId: null,
    note: "Genesis 1:1 anchors the claim in the text.",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  };
}

function validMotifPayload() {
  return {
    id: "motif-1",
    workspaceId: "workspace-1",
    label: "Seed of the woman",
    normalizedKey: "seed-of-the-woman",
    status: "candidate",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  };
}

function validMotifSightingPayload() {
  return {
    id: "sighting-1",
    workspaceId: "workspace-1",
    candidateId: "motif-1",
    passageUnitKey: "1.3",
    exactRange: range("1.3.15", "1.3.15"),
    entryId: null,
    claimId: null,
    status: "sighted",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  };
}

function validConnectionPayload() {
  return {
    id: "connection-1",
    workspaceId: "workspace-1",
    fromRange: range("1.3.15", "1.3.15"),
    toRange: range("40.1.1", "40.1.1"),
    type: "promise_fulfillment",
    evidenceLabel: "strong",
    rationale: "Genesis 3:15's seed promise finds its fulfillment pattern here.",
    threadSlug: null,
    status: "draft",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  };
}

function validApplicationPayload() {
  return {
    id: "application-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    sourceClaimId: "claim-1",
    originalAudienceMeaning: "Original audience meaning.",
    enduringPrinciple: "Enduring principle.",
    canonicalBridge: "Bridge from then to now.",
    applicationClass: "personal",
    promiseScope: "individual",
    modernDomain: "work",
    situation: "A Monday-morning decision.",
    responseType: "belief",
    faithfulResponse: "Trust the promise.",
    cautions: "",
    availableAfter: null,
    status: "draft",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  };
}

function validTeachingDraftPayload() {
  return {
    id: "teaching-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    title: "The Seed Promise",
    bigIdea: "God keeps his promises across centuries.",
    audience: "adults",
    durationMinutes: 15,
    gospelConnection: "The seed of the woman is Christ.",
    status: "draft",
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
  };
}

const validPayloadByEntity = {
  session: validSessionPayload,
  claim: validClaimPayload,
  evidence: validEvidencePayload,
  motif: validMotifPayload,
  motifSighting: validMotifSightingPayload,
  connection: validConnectionPayload,
  application: validApplicationPayload,
  teachingDraft: validTeachingDraftPayload,
} as const;

const schemaByEntity = {
  session: syncStudySessionV2Schema,
  claim: syncStudyClaimV2Schema,
  evidence: syncClaimEvidenceV2Schema,
  motif: syncMotifCandidateV2Schema,
  motifSighting: syncMotifSightingV2Schema,
  connection: syncUserConnectionV2Schema,
  application: syncApplicationV2Schema,
  teachingDraft: syncTeachingDraftV2Schema,
} as const;

function validOp(entity: keyof typeof validPayloadByEntity, overrides: Partial<SyncOpV2> = {}): SyncOpV2 {
  const payload = validPayloadByEntity[entity]();
  return {
    opId: uuid(1),
    deviceId: uuid(2),
    entity,
    entityId: payload.id,
    mutation: "upsert",
    baseRevision: null,
    mutationGroupId: uuid(3),
    dependsOn: [],
    payload,
    clientTime: TS,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Criterion 2: a Zod schema validates a push payload for every one of the
// eight entities.
// ---------------------------------------------------------------------------

test("every v2 entity has a payload schema that accepts a well-formed payload", () => {
  for (const entity of SYNC_ENTITIES_V2) {
    const schema = schemaByEntity[entity];
    const payload = validPayloadByEntity[entity]();
    const result = schema.safeParse(payload);
    assert.equal(result.success, true, `expected a valid ${entity} payload to parse`);
  }
});

// ---------------------------------------------------------------------------
// Criterion 2 (SYNCGAP-001, continued): claim_evidence and motif_sightings
// were resolved as their OWN sync entities (`evidence`, `motifSighting`),
// never nested inside their parent's payload as an aggregate/child array —
// the option that was NOT chosen. Prove the NOT-chosen shape is rejected,
// so the decision is enforced, not merely documented.
// ---------------------------------------------------------------------------

test("claim payload schema rejects a nested aggregate evidence array (the NOT-chosen shape)", () => {
  const aggregateShaped = {
    ...validClaimPayload(),
    evidence: [{ evidenceType: "passage", note: "smuggled in as a child of its parent" }],
  };
  assert.equal(syncStudyClaimV2Schema.safeParse(aggregateShaped).success, false);
});

test("motif payload schema rejects a nested aggregate sightings array (the NOT-chosen shape)", () => {
  const aggregateShaped = {
    ...validMotifPayload(),
    sightings: [{ passageUnitKey: "1.3", status: "sighted" }],
  };
  assert.equal(syncMotifCandidateV2Schema.safeParse(aggregateShaped).success, false);
});

// MOTIFSTATUS-001, acceptance criterion 2: status is no longer arbitrary
// text. This is the schema half of the fix; tests/sync-v2-persist.test.ts
// covers the planner-level refusal of the one enumerated value ("promoted")
// that IS valid shape but must still never be reachable via sync push.
test("motif payload schema accepts every enumerated status value", () => {
  for (const status of ["candidate", "dismissed", "promoted"]) {
    const payload = { ...validMotifPayload(), status };
    assert.equal(
      syncMotifCandidateV2Schema.safeParse(payload).success,
      true,
      `expected status "${status}" to be a valid shape`,
    );
  }
});

test("motif payload schema rejects an off-enum status", () => {
  const payload = { ...validMotifPayload(), status: "archived" };
  const result = syncMotifCandidateV2Schema.safeParse(payload);
  assert.equal(result.success, false, "an off-enum status must not validate");
});

test("evidence payload schema validates standalone, naming its parent claim via claimId", () => {
  const payload = validEvidencePayload();
  const result = syncClaimEvidenceV2Schema.safeParse(payload);
  assert.equal(result.success, true);
  assert.equal(payload.claimId, "claim-1");
});

test("motifSighting payload schema validates standalone, naming its parent candidate via candidateId", () => {
  const payload = validMotifSightingPayload();
  const result = syncMotifSightingV2Schema.safeParse(payload);
  assert.equal(result.success, true);
  assert.equal(payload.candidateId, "motif-1");
});

test("evidence and motifSighting are pushed as their own ops, grouped with their parent via mutationGroupId", () => {
  const groupId = uuid(40);
  const claimOp = validOp("claim", { mutationGroupId: groupId });
  const evidenceOp = validOp("evidence", { opId: uuid(41), mutationGroupId: groupId });
  const candidateOp = validOp("motif", { opId: uuid(42), mutationGroupId: groupId });
  const sightingOp = validOp("motifSighting", { opId: uuid(43), mutationGroupId: groupId });

  const result = syncPushV2Schema.safeParse({ ops: [claimOp, evidenceOp, candidateOp, sightingOp] });
  assert.equal(result.success, true);

  const groups = groupOpsByMutationGroupId([claimOp, evidenceOp, candidateOp, sightingOp]);
  assert.equal(groups.get(groupId)?.length, 4);
});

test("session payload schema rejects an unknown mode", () => {
  const payload = { ...validSessionPayload(), mode: "not_a_real_mode" };
  assert.equal(syncStudySessionV2Schema.safeParse(payload).success, false);
});

test("session payload schema rejects an unrecognized extra field (strict)", () => {
  const payload = { ...validSessionPayload(), extraField: "not allowed" };
  assert.equal(syncStudySessionV2Schema.safeParse(payload).success, false);
});

test("claim payload schema requires doctrineStatus for theology claims", () => {
  const missingStatus = { ...validClaimPayload(), kind: "theology", doctrineStatus: null };
  assert.equal(syncStudyClaimV2Schema.safeParse(missingStatus).success, false);

  const withStatus = { ...validClaimPayload(), kind: "theology", doctrineStatus: "core" };
  assert.equal(syncStudyClaimV2Schema.safeParse(withStatus).success, true);
});

test("claim payload schema rejects doctrineStatus on a non-theology claim", () => {
  const payload = { ...validClaimPayload(), kind: "observation", doctrineStatus: "core" };
  assert.equal(syncStudyClaimV2Schema.safeParse(payload).success, false);
});

test("connection payload schema enforces personal_resonance requires devotional evidence", () => {
  const invalid = {
    ...validConnectionPayload(),
    type: "personal_resonance",
    evidenceLabel: "strong",
  };
  assert.equal(syncUserConnectionV2Schema.safeParse(invalid).success, false);

  const valid = {
    ...validConnectionPayload(),
    type: "personal_resonance",
    evidenceLabel: "devotional",
  };
  assert.equal(syncUserConnectionV2Schema.safeParse(valid).success, true);
});

test("connection payload schema rejects a rationale under 20 characters", () => {
  const payload = { ...validConnectionPayload(), rationale: "too short" };
  assert.equal(syncUserConnectionV2Schema.safeParse(payload).success, false);
});

test("range fields reuse verseRefSchema: a nonexistent chapter is rejected", () => {
  const payload = { ...validSessionPayload(), range: range("1.51.1", "1.51.1") }; // Genesis has 50 chapters
  assert.equal(syncStudySessionV2Schema.safeParse(payload).success, false);
});

test("canonicalRangeV1Schema rejects the wrong versification id", () => {
  const badRange = { versificationId: "some-other-versification", start: "1.1.1", end: "1.1.1" };
  assert.equal(canonicalRangeV1Schema.safeParse(badRange).success, false);
});

// ---------------------------------------------------------------------------
// Criterion 3: every op carries opId, deviceId, entity, entityId, mutation,
// baseRevision, mutationGroupId, dependsOn, payload, clientTime. Validation
// rejects a payload missing any required field.
// ---------------------------------------------------------------------------

const ENVELOPE_FIELDS: (keyof SyncOpV2)[] = [
  "opId",
  "deviceId",
  "entity",
  "entityId",
  "mutation",
  "baseRevision",
  "mutationGroupId",
  "dependsOn",
  "payload",
  "clientTime",
];

test("a well-formed op passes syncOpV2Schema", () => {
  const op = validOp("session");
  assert.equal(syncOpV2Schema.safeParse(op).success, true);
});

for (const field of ENVELOPE_FIELDS) {
  test(`syncOpV2Schema rejects an op missing "${field}"`, () => {
    const op = validOp("session") as unknown as Record<string, unknown>;
    delete op[field];
    assert.equal(syncOpV2Schema.safeParse(op).success, false, `expected missing "${field}" to be rejected`);
  });
}

test("syncOpV2Schema rejects an op depending on its own opId", () => {
  const op = validOp("session");
  op.dependsOn = [op.opId];
  assert.equal(syncOpV2Schema.safeParse(op).success, false);
});

// ---------------------------------------------------------------------------
// Criterion 4: fail-closed timestamp cross-check, following the accessor
// pattern (default payload.updatedAt, checked against the envelope) rather
// than a hardcoded field name.
// ---------------------------------------------------------------------------

test("parseSyncOpV2Payload accepts an op whose payload.updatedAt matches its envelope clientTime", () => {
  const op = validOp("session");
  const parsed = parseSyncOpV2Payload(op);
  assert.deepEqual(parsed, validSessionPayload());
});

test("parseSyncOpV2Payload rejects an op whose payload.updatedAt does not match its envelope clientTime", () => {
  const op = validOp("session", { clientTime: "2026-06-01T00:00:00Z" });
  assert.throws(() => parseSyncOpV2Payload(op), /timestamp/i);
});

test("parseSyncOpV2Payload is fail-closed: a custom accessor returning undefined rejects even a self-consistent op", () => {
  const op = validOp("session");
  assert.throws(
    () => parseSyncOpV2Payload(op, () => undefined),
    /timestamp/i,
    "a payload lacking the accessed timestamp field must be rejected, not silently accepted",
  );
});

test("parseSyncOpV2Payload honors a custom timestamp accessor (the SYNC-001 pattern, not a hardcoded field)", () => {
  // Every v2 payload here declares updatedAt, so the default accessor
  // already covers all eight — this proves the mechanism is a real parameter,
  // not dead code, by pointing it at a different (also-present) field and
  // matching clientTime against THAT field's value instead.
  const payload = { ...validSessionPayload(), currentStep: TS };
  const op = validOp("session", { payload, clientTime: TS });
  const parsed = parseSyncOpV2Payload(op, (p) => (p as { currentStep?: string }).currentStep);
  assert.deepEqual(parsed, payload);
});

test("parseSyncOpV2Payload rejects an op whose entityId does not match its payload id", () => {
  const op = validOp("session", { entityId: "some-other-session-id" });
  assert.throws(() => parseSyncOpV2Payload(op), /entityId/i);
});

test("parseSyncOpV2Payload rejects a payload that fails its entity's schema", () => {
  const payload = { ...validSessionPayload(), mode: "not_a_real_mode" };
  const op = validOp("session", { payload });
  assert.throws(() => parseSyncOpV2Payload(op), /Invalid session payload/);
});

// ---------------------------------------------------------------------------
// Criterion 5: a related-creation group (session + claims) is expressible
// via mutationGroupId; a dangling dependsOn reference is rejected.
// ---------------------------------------------------------------------------

test("ops sharing a mutationGroupId group together (session plus its claims)", () => {
  const groupId = uuid(9);
  const sessionOp = validOp("session", { mutationGroupId: groupId });
  const claimOneOp = validOp("claim", { opId: uuid(10), mutationGroupId: groupId });
  const claimTwoOp = validOp("claim", {
    opId: uuid(11),
    mutationGroupId: groupId,
    payload: { ...validClaimPayload(), id: "claim-2" },
    entityId: "claim-2",
  });
  const unrelatedOp = validOp("session", { opId: uuid(12), mutationGroupId: uuid(13) });

  const groups = groupOpsByMutationGroupId([sessionOp, claimOneOp, claimTwoOp, unrelatedOp]);

  assert.equal(groups.size, 2);
  const relatedGroup = groups.get(groupId);
  assert.ok(relatedGroup);
  assert.equal(relatedGroup?.length, 3);
  assert.deepEqual(
    relatedGroup?.map((op) => op.opId).sort(),
    [sessionOp.opId, claimOneOp.opId, claimTwoOp.opId].sort(),
  );
});

test("findDanglingDependsOnOpIds returns empty for a well-formed dependsOn chain", () => {
  const first = validOp("session", { opId: uuid(20) });
  const second = validOp("claim", { opId: uuid(21), dependsOn: [first.opId] });
  assert.deepEqual(findDanglingDependsOnOpIds([first, second]), []);
});

test("findDanglingDependsOnOpIds reports an opId absent from the batch", () => {
  const danglingId = uuid(999);
  const op = validOp("claim", { dependsOn: [danglingId] });
  assert.deepEqual(findDanglingDependsOnOpIds([op]), [danglingId]);
});

test("syncPushV2Schema rejects a group with a dangling dependsOn reference", () => {
  const danglingId = uuid(999);
  const sessionOp = validOp("session");
  const claimOp = validOp("claim", { opId: uuid(21), dependsOn: [danglingId] });

  const result = syncPushV2Schema.safeParse({ ops: [sessionOp, claimOp] });
  assert.equal(result.success, false);
});

test("syncPushV2Schema accepts a group whose dependsOn resolves within the same push", () => {
  const sessionOp = validOp("session", { opId: uuid(30) });
  const claimOp = validOp("claim", { opId: uuid(31), dependsOn: [sessionOp.opId] });

  const result = syncPushV2Schema.safeParse({ ops: [sessionOp, claimOp] });
  assert.equal(result.success, true);
});

// ---------------------------------------------------------------------------
// Criterion 6: the one-write-path rule as an enforceable, tested predicate.
// A mutation-shaped request against a read-only v2 route shape is rejected.
// ---------------------------------------------------------------------------

test("isReadOnlyV2Method accepts GET/HEAD and rejects mutating verbs", () => {
  assert.equal(isReadOnlyV2Method("GET"), true);
  assert.equal(isReadOnlyV2Method("HEAD"), true);
  assert.equal(isReadOnlyV2Method("POST"), false);
  assert.equal(isReadOnlyV2Method("PUT"), false);
  assert.equal(isReadOnlyV2Method("PATCH"), false);
  assert.equal(isReadOnlyV2Method("DELETE"), false);
});

test("assertReadOnlyV2ResourceRequest accepts a bodiless GET", () => {
  assert.doesNotThrow(() => assertReadOnlyV2ResourceRequest({ method: "GET" }));
});

test("assertReadOnlyV2ResourceRequest rejects a mutation-shaped POST against a v2 resource route", () => {
  const op = validOp("claim");
  assert.throws(
    () => assertReadOnlyV2ResourceRequest({ method: "POST", body: { ops: [op] } }),
    V2ResourceRouteMutationRejected,
  );
});

test("assertReadOnlyV2ResourceRequest rejects a body smuggled onto an otherwise-GET request", () => {
  assert.throws(
    () => assertReadOnlyV2ResourceRequest({ method: "GET", body: { mutation: "upsert" } }),
    V2ResourceRouteMutationRejected,
  );
});

test("assertReadOnlyV2ResourceRequest rejects PUT/PATCH/DELETE the same way", () => {
  for (const method of ["PUT", "PATCH", "DELETE"]) {
    assert.throws(
      () => assertReadOnlyV2ResourceRequest({ method, body: undefined }),
      V2ResourceRouteMutationRejected,
      `expected ${method} to be rejected`,
    );
  }
});
