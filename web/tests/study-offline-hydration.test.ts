/**
 * STUDYOFFLINE-001 — pure-logic tests for
 * `app/(app)/study/[sessionId]/offlineHydration.ts`: the reconciliation rule
 * behind `StudyPageClient.tsx`'s client-side hydration (acceptance criterion
 * 1). No IndexedDB, no React, no `fake-indexeddb` — every input here is a
 * plain object literal, per this file's own module header ("everything here
 * is a plain function over plain data").
 */
import assert from "node:assert/strict";
import test from "node:test";

import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import type { Application, StudyClaim, StudySession } from "@/lib/contracts/study-v2";
import {
  mergeEntitiesById,
  pendingEntityIdsFromOps,
  reconcileStudyWorkspace,
  type PendingEntityIds,
} from "../app/(app)/study/[sessionId]/offlineHydration";

function range(overrides: Partial<CanonicalRangeV1> = {}): CanonicalRangeV1 {
  return { versificationId: CANONICAL_VERSIFICATION_ID, start: "1.3.1", end: "1.3.6", ...overrides };
}

function session(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    range: range(),
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

function claim(overrides: Partial<StudyClaim> = {}): StudyClaim {
  return {
    id: "claim-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    kind: "observation",
    epistemicBasis: "text_explicit",
    body: "server body",
    passage: range(),
    confidence: "tentative",
    provenance: "learner",
    doctrineStatus: null,
    viewpointId: null,
    status: "draft",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: "app-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    sourceClaimId: "claim-1",
    originalAudienceMeaning: "x",
    enduringPrinciple: "x",
    canonicalBridge: "x",
    applicationClass: "x",
    promiseScope: "x",
    modernDomain: "work",
    situation: "x",
    responseType: "prayer",
    faithfulResponse: "x",
    cautions: "x",
    availableAfter: null,
    status: "draft",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

const NO_PENDING: PendingEntityIds = { session: new Set(), claim: new Set(), application: new Set() };

// ===========================================================================
// mergeEntitiesById — the generic the claims/applications merge reuses.
// ===========================================================================

test("mergeEntitiesById: a row on only one side is always included", () => {
  const serverOnly = claim({ id: "server-only" });
  const localOnly = claim({ id: "local-only" });
  const merged = mergeEntitiesById([serverOnly], [localOnly], new Set());
  assert.deepEqual(
    merged.map((row) => row.id).sort(),
    ["local-only", "server-only"],
  );
});

test("mergeEntitiesById: same id, no pending op -- higher revision wins regardless of side", () => {
  const server = claim({ id: "c1", revision: 3, body: "server, newer" });
  const local = claim({ id: "c1", revision: 1, body: "local, stale" });
  const merged = mergeEntitiesById([server], [local], new Set());
  assert.equal(merged.length, 1);
  assert.equal(merged[0].body, "server, newer");
});

test("mergeEntitiesById: same id, local has the higher revision -- local wins", () => {
  const server = claim({ id: "c1", revision: 1, body: "server, stale" });
  const local = claim({ id: "c1", revision: 2, body: "local, newer" });
  const merged = mergeEntitiesById([server], [local], new Set());
  assert.equal(merged[0].body, "local, newer");
});

test("mergeEntitiesById: same id, EXACT revision tie -- server wins (never a coin flip)", () => {
  const server = claim({ id: "c1", revision: 2, body: "server copy" });
  const local = claim({ id: "c1", revision: 2, body: "local copy" });
  const merged = mergeEntitiesById([server], [local], new Set());
  assert.equal(merged[0].body, "server copy");
});

test("mergeEntitiesById: a pending op for this id makes local win EVEN AT A LOWER revision -- the BUILD_PLAN tenet 4 rule, mirrored from mergeRemoteChangesV2", () => {
  const server = claim({ id: "c1", revision: 5, body: "server, somehow ahead" });
  const local = claim({ id: "c1", revision: 1, body: "local, unsynced edit" });
  const merged = mergeEntitiesById([server], [local], new Set(["c1"]));
  assert.equal(merged[0].body, "local, unsynced edit", "a pending op must win regardless of revision -- never a clock/number comparison overriding unsynced prose");
});

// ===========================================================================
// pendingEntityIdsFromOps
// ===========================================================================

test("pendingEntityIdsFromOps: buckets by entity, ignores anything else", () => {
  const ids = pendingEntityIdsFromOps([
    { entity: "session", entityId: "s1" },
    { entity: "claim", entityId: "c1" },
    { entity: "claim", entityId: "c2" },
    { entity: "application", entityId: "a1" },
    { entity: "teachingDraft", entityId: "t1" },
  ]);
  assert.deepEqual([...ids.session], ["s1"]);
  assert.deepEqual([...ids.claim].sort(), ["c1", "c2"]);
  assert.deepEqual([...ids.application], ["a1"]);
});

// ===========================================================================
// reconcileStudyWorkspace — the end-to-end function StudyPageClient calls.
// ===========================================================================

test("reconcileStudyWorkspace: server session + no local vault at all -- server wins, sessionSource 'server'", () => {
  const serverSession = session();
  const result = reconcileStudyWorkspace(
    "session-1",
    { session: serverSession, claims: [claim()], applications: [application()] },
    { session: null, claims: [], applications: [] },
    NO_PENDING,
  );
  assert.equal(result.session, serverSession);
  assert.equal(result.sessionSource, "server");
  assert.equal(result.claims.length, 1);
  assert.equal(result.applications.length, 1);
});

test("reconcileStudyWorkspace: local has a pending, unsynced session edit -- local wins, sessionSource 'local'", () => {
  const serverSession = session({ currentStep: "observe", revision: 1 });
  const localSession = session({ currentStep: "connect", revision: 2 });
  const pending: PendingEntityIds = { session: new Set(["session-1"]), claim: new Set(), application: new Set() };
  const result = reconcileStudyWorkspace(
    "session-1",
    { session: serverSession, claims: [], applications: [] },
    { session: localSession, claims: [], applications: [] },
    pending,
  );
  assert.equal(result.session?.currentStep, "connect");
  assert.equal(result.sessionSource, "local");
});

test("reconcileStudyWorkspace: local-only session (never reached the server yet) -- local wins, sessionSource 'local'", () => {
  const localSession = session({ id: "local-only-session" });
  const result = reconcileStudyWorkspace(
    "local-only-session",
    { session: null, claims: [], applications: [] },
    { session: localSession, claims: [claim({ sessionId: "local-only-session" })], applications: [] },
    NO_PENDING,
  );
  assert.equal(result.session, localSession);
  assert.equal(result.sessionSource, "local");
  assert.equal(result.claims.length, 1);
});

test("reconcileStudyWorkspace: neither side has the session -- sessionSource 'none', empty claims/applications", () => {
  const result = reconcileStudyWorkspace(
    "nowhere",
    { session: null, claims: [], applications: [] },
    { session: null, claims: [], applications: [] },
    NO_PENDING,
  );
  assert.equal(result.session, null);
  assert.equal(result.sessionSource, "none");
  assert.deepEqual(result.claims, []);
  assert.deepEqual(result.applications, []);
});

test("reconcileStudyWorkspace: a local claim/application from a DIFFERENT session id never leaks into this session's merge", () => {
  const serverSession = session();
  const result = reconcileStudyWorkspace(
    "session-1",
    { session: serverSession, claims: [], applications: [] },
    {
      session: null,
      claims: [claim({ id: "stray-claim", sessionId: "some-other-session" })],
      applications: [application({ id: "stray-app", sessionId: "some-other-session" })],
    },
    NO_PENDING,
  );
  assert.deepEqual(result.claims, []);
  assert.deepEqual(result.applications, [], "an unrelated session's local rows must never appear here");
});

test("reconcileStudyWorkspace: a brand-new local-only claim (not yet known to the server at all) is included via the union, not dropped", () => {
  const serverSession = session();
  const newLocalClaim = claim({ id: "brand-new-claim", sessionId: "session-1" });
  const pending: PendingEntityIds = {
    session: new Set(),
    claim: new Set(["brand-new-claim"]),
    application: new Set(),
  };
  const result = reconcileStudyWorkspace(
    "session-1",
    { session: serverSession, claims: [], applications: [] },
    { session: null, claims: [newLocalClaim], applications: [] },
    pending,
  );
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0].id, "brand-new-claim");
});
