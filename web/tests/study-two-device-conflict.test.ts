/**
 * Real vault + real sync client against a fake server implementing the actual
 * baseRevision rejection contract. Device B's push has completed before A
 * reconnects. Originally this proved the permanently stale-op limitation;
 * now it pins down preservation before review and explicit recovery below.
 * This harness does not reproduce concurrent PostgreSQL check/write races.
 */
import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";

import { CANONICAL_VERSIFICATION_ID, type CanonicalRangeV1 } from "@/lib/contracts/range-v1";
import type { StudyClaim } from "@/lib/contracts/study-v2";

function range(): CanonicalRangeV1 {
  return { versificationId: CANONICAL_VERSIFICATION_ID, start: "19.23.1", end: "19.23.6" };
}

function baseClaim(overrides: Partial<StudyClaim> = {}): StudyClaim {
  return {
    id: "claim-two-device-conflict",
    workspaceId: "workspace-two-device",
    sessionId: "session-two-device",
    kind: "interpretation",
    epistemicBasis: "text_explicit",
    body: "original, already-synced prose",
    passage: range(),
    confidence: "developing",
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function requestUrl(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return "";
}

function v2PullResponse(overrides: Record<string, unknown> = {}) {
  return {
    serverTime: new Date().toISOString(),
    session: [],
    claim: [],
    evidence: [],
    motif: [],
    motifSighting: [],
    connection: [],
    application: [],
    teachingDraft: [],
    rejected: [],
    ...overrides,
  };
}

/**
 * A faithful (not a reimplementation of the UI contract — just the one
 * invariant that matters here) mirror of `lib/db/sync-v2.ts`'s `planWrite`:
 * a push whose `baseRevision` does not match the row's current stored
 * `revision` is rejected with the real reason-string SHAPE that file emits;
 * a matching `baseRevision` is accepted and the row (and its revision) is
 * updated. Starts pre-loaded with "device B"'s already-accepted edit at
 * revision 2 — i.e. device B pushed successfully BEFORE this test's own
 * (device A's) sync ever runs.
 */
function createFakeServer(initialClaim: StudyClaim) {
  const claims = new Map<string, StudyClaim>([[initialClaim.id, initialClaim]]);

  return {
    claims,
    fetchImpl: async (input: unknown, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      if (url.endsWith("/api/sync/v2/push")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          ops: { opId: string; entity: string; entityId: string; baseRevision: number | null; payload: StudyClaim }[];
        };
        const rejected: { opId: string; reason: string }[] = [];
        for (const op of body.ops) {
          if (op.entity !== "claim") continue; // this test only exercises the claim entity
          const current = claims.get(op.entityId);
          if (current) {
            if (op.baseRevision !== current.revision) {
              rejected.push({
                opId: op.opId,
                reason: `Revision conflict: stored revision is ${current.revision}, op carried baseRevision ${op.baseRevision}`,
              });
              continue;
            }
          } else if (op.baseRevision !== null) {
            rejected.push({
              opId: op.opId,
              reason: `Revision conflict: op carried baseRevision ${op.baseRevision} for an entity that does not exist yet`,
            });
            continue;
          }
          claims.set(op.entityId, op.payload);
        }
        return jsonResponse(v2PullResponse({ rejected }));
      }
      if (url.endsWith("/api/sync/v2/pull")) {
        return jsonResponse(v2PullResponse({ claim: [...claims.values()] }));
      }
      throw new Error(`unexpected fetch in this test: ${url}`);
    },
  };
}

test("TWO-DEVICE CONFLICT: both devices edit the same claim offline; device B's edit (already synced) wins on the server, device A's own prose is preserved locally and never silently overwritten -- awaiting explicit learner reconciliation", async () => {
  const store = await import("@/lib/sync/store");
  const client = await import("@/lib/sync/client");

  // Both devices started from the SAME synced baseline: revision 1 (this is
  // implicit in both deviceAsEdit/deviceBsAcceptedEdit below both deriving
  // from baseClaim()'s revision-1 defaults before being bumped to 2).

  // Device B went offline, edited, came back online FIRST, and its push was
  // accepted -- the server now holds B's edit at revision 2. (We never run
  // device B's own vault in this process; what matters for this test is
  // only what the server ends up holding, which this fake server models
  // directly.)
  const deviceBsAcceptedEdit = baseClaim({
    revision: 2,
    body: "Device B's edit -- accepted first",
    updatedAt: "2026-01-02T08:00:00.000Z",
  });
  const server = createFakeServer(deviceBsAcceptedEdit);

  // Device A (THIS device's real local vault): went offline from the SAME
  // revision-1 baseline, independently edited the SAME claim.
  const deviceAsEdit = baseClaim({
    revision: 2,
    body: "Device A's edit -- made offline, never saw B's",
    updatedAt: "2026-01-02T09:00:00.000Z",
  });
  await store.saveLocalStudyClaim(deviceAsEdit);
  const [op] = (await store.getPendingV2Ops()).filter((candidate) => candidate.entityId === deviceAsEdit.id);
  assert.ok(op, "device A's edit must have queued a real outbox op");
  assert.equal(op.baseRevision, 1, "device A's op must carry the shared revision-1 baseline, not B's revision-2");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = server.fetchImpl as typeof fetch;

  try {
    // Device A comes back online and syncs. Its push is rejected -- it
    // carries baseRevision 1, but the server (per device B's already-
    // accepted edit) is now at revision 2. This is NOT a bug: it is
    // lib/db/sync-v2.ts's planWrite doing exactly its documented job
    // (BUILD_PLAN tenet 4 -- never silently overwrite).
    await assert.rejects(client.syncNowV2(), (error: unknown) => {
      assert.ok(error instanceof client.SyncRejectedErrorV2);
      assert.match(
        (error as InstanceType<typeof client.SyncRejectedErrorV2>).rejected[0]?.reason ?? "",
        /Revision conflict/,
      );
      return true;
    });

    // CLAIM 1 -- prose is NOT silently lost or overwritten: device A's local
    // copy is still device A's own edit, verbatim, not B's.
    const afterFirstSync = (await store.listLocalV2Entities("claim")).find((row) => row.id === deviceAsEdit.id);
    assert.equal(
      afterFirstSync?.body,
      "Device A's edit -- made offline, never saw B's",
      "device A's own unsynced prose must survive a rejected push, byte for byte",
    );
    assert.equal(afterFirstSync?.revision, 2, "device A's local revision must not be clobbered by the pull's revision-2 row from B either");

    // A durable comparison now holds this entity out of background pushes.
    // Unrelated writes still sync; this edit stays pending and protected.
    await client.syncNowV2();
    await client.syncNowV2();
    const stillPending = (await store.getPendingV2Ops()).find(candidate => candidate.opId === op.opId);
    assert.ok(stillPending);
    assert.equal(stillPending.baseRevision, 1);
    assert.ok((await store.listStudyConflictsV2()).some(conflict => conflict.entityId === deviceAsEdit.id));

    // Further syncs (e.g. the background flush
    // controller's normal cadence) stop throwing, but STILL never silently
    // overwrite device A's local copy with B's pulled row (mergeRemoteChangesV2's
    // pending-op-skip rule still applies to the held conflict).
    await client.syncNowV2();
    const afterParked = (await store.listLocalV2Entities("claim")).find((row) => row.id === deviceAsEdit.id);
    assert.equal(afterParked?.body, "Device A's edit -- made offline, never saw B's");

    // Without learner reconciliation, background sync must not choose either
    // version. B remains canonical even though A has the later clock.
    assert.equal(server.claims.get(deviceAsEdit.id)?.body, "Device B's edit -- accepted first");
    assert.ok(
      Date.parse(deviceBsAcceptedEdit.updatedAt) < Date.parse(deviceAsEdit.updatedAt),
      "sanity check on this test's own fixture: B's accepted edit is actually the OLDER one by clock, proving the server's rule is not last-write-wins",
    );
  } finally {
    globalThis.fetch = originalFetch;
    const pending = await store.getPendingV2Ops();
    await store.removePendingV2Ops(pending.filter((candidate) => candidate.entityId === deviceAsEdit.id).map((candidate) => candidate.opId));
  }
});


test("two-device recovery: review both durable versions, reconcile offline, sync with a fresh revision; another edit conflicts again", async () => {
  const store = await import("@/lib/sync/store");
  const client = await import("@/lib/sync/client");
  const id = "claim-recovery";
  const mine = baseClaim({ id, revision: 2, body: "My offline interpretation", updatedAt: "2026-01-02T09:00:00.000Z" });
  const theirs = baseClaim({ id, revision: 2, body: "Other device interpretation", updatedAt: "2026-01-02T08:00:00.000Z" });
  const server = createFakeServer(theirs);
  const originalFetch = globalThis.fetch;
  await store.saveLocalStudyClaim(mine);
  globalThis.fetch = server.fetchImpl as typeof fetch;
  try {
    await assert.rejects(client.syncNowV2(), client.SyncRejectedErrorV2);
    const review = (await store.listStudyConflictsV2()).find(c => c.entityId === id)!;
    assert.ok(review);
    assert.equal(review.local.body, mine.body);
    assert.equal(review.remote.body, theirs.body);
    // Reloading reads durable review data without the network.
    assert.deepEqual((await store.listStudyConflictsV2()).find(c => c.entityId === id), review);
    globalThis.fetch = async () => { throw new Error("offline"); };
    await store.resolveStudyConflictV2(review, { ...review.local, body: "Both interpretations reconciled" });
    const queued = (await store.getPendingV2Ops()).filter(op => op.entityId === id);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].baseRevision, 2);
    assert.ok(!review.opIds.includes(queued[0].opId));
    assert.equal((queued[0].payload as StudyClaim).revision, 3);
    await assert.rejects(client.syncNowV2(), /offline/);
    await store.mergeRemoteChangesV2({ claim: [theirs] });
    assert.equal((await store.listLocalV2Entities("claim")).find(c => c.id === id)?.body, "Both interpretations reconciled");
    globalThis.fetch = server.fetchImpl as typeof fetch;
    // A third edit arrives before the resolution push. No overwrite.
    const third = { ...theirs, revision: 3, body: "Another edit during review" };
    server.claims.set(id, third);
    await assert.rejects(client.syncNowV2(), client.SyncRejectedErrorV2);
    assert.equal(server.claims.get(id)?.body, third.body);
    const again = (await store.listStudyConflictsV2()).find(c => c.entityId === id)!;
    assert.equal(again.local.body, "Both interpretations reconciled");
    assert.equal(again.remote.body, third.body);
    await store.resolveStudyConflictV2(again, { ...again.local, body: "All three reconciled" });
    await client.syncNowV2();
    assert.equal(server.claims.get(id)?.body, "All three reconciled");
    assert.equal(server.claims.get(id)?.revision, 4);
    assert.equal((await store.getPendingV2Ops()).filter(op => op.entityId === id).length, 0);
    assert.equal((await store.listStudyConflictsV2()).filter(c => c.entityId === id).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await store.removePendingV2Ops((await store.getPendingV2Ops()).filter(op => op.entityId === id).map(op => op.opId));
  }
});

test("stale review cannot erase a newer local edit or a newer server snapshot", async () => {
  const store = await import("@/lib/sync/store");
  const id = "claim-stale-review";
  await store.saveLocalStudyClaim(baseClaim({ id, revision: 2, body: "First local edit" }));
  const ops = (await store.getPendingV2Ops()).filter(op => op.entityId === id);
  await store.recordV2Rejections(ops.map(op => ({ opId: op.opId, reason: "Revision conflict: test" })));
  await store.captureStudyConflictsV2({ claim: [baseClaim({ id, revision: 2, body: "Remote edit" })] });
  const review = (await store.listStudyConflictsV2()).find(c => c.entityId === id)!;
  await store.saveLocalStudyClaim(baseClaim({ id, revision: 3, body: "Newer local edit" }));
  const before = (await store.getPendingV2Ops()).filter(op => op.entityId === id);
  await assert.rejects(store.resolveStudyConflictV2(review, review.local), /changed while/);
  assert.deepEqual((await store.getPendingV2Ops()).filter(op => op.entityId === id), before);
  assert.equal((await store.listLocalV2Entities("claim")).find(c => c.id === id)?.body, "Newer local edit");
  await store.captureStudyConflictsV2({ claim: [baseClaim({ id, revision: 3, body: "Newer remote edit" })] });
  await assert.rejects(store.resolveStudyConflictV2(review, review.local), /changed while/);
  await store.removePendingV2Ops(before.map(op => op.opId));
});

test("captured conflict holds later edits out of pushes while unrelated work syncs; parked ops can recover", async () => {
  const store = await import("@/lib/sync/store");
  const client = await import("@/lib/sync/client");
  const id = "claim-parked-recovery";
  await store.saveLocalStudyClaim(baseClaim({ id, revision: 2, body: "Mine" }));
  const pending = (await store.getPendingV2Ops()).filter(op => op.entityId === id);
  for (let i = 0; i < store.V2_OP_PARK_THRESHOLD; i++) {
    await store.recordV2Rejections(pending.map(op => ({ opId: op.opId, reason: "Revision conflict: stale" })));
  }
  const server = createFakeServer(baseClaim({ id, revision: 2, body: "Theirs" }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = server.fetchImpl as typeof fetch;
  try {
    await client.syncNowV2();
    await store.saveLocalStudyClaim(baseClaim({ id, revision: 3, body: "Later local edit must not bypass review" }));
    const otherId = "unrelated-claim-recovery";
    await store.saveLocalStudyClaim(baseClaim({ id: otherId, revision: 1 }));
    await client.syncNowV2();
    assert.equal(server.claims.get(id)?.body, "Theirs");
    assert.ok(server.claims.has(otherId));
    const review = (await store.listStudyConflictsV2()).find(c => c.entityId === id)!;
    assert.equal(review.local.body, "Later local edit must not bypass review");
    await store.resolveStudyConflictV2(review, { ...review.local, body: "Explicit combined result" });
    await client.syncNowV2();
    assert.equal(server.claims.get(id)?.body, "Explicit combined result");
  } finally {
    globalThis.fetch = originalFetch;
    await store.removePendingV2Ops((await store.getPendingV2Ops()).filter(op => op.entityId === id).map(op => op.opId));
  }
});

test("resolution abort rolls back the entity, stale ops, comparison and archive together", async () => {
  const store = await import("@/lib/sync/store");
  const id = "claim-atomic-recovery";
  await store.saveLocalStudyClaim(baseClaim({ id, revision: 2, body: "Unsynced original" }));
  const pending = (await store.getPendingV2Ops()).filter(op => op.entityId === id);
  await store.recordV2Rejections(pending.map(op => ({ opId: op.opId, reason: "Revision conflict: stale" })));
  await store.captureStudyConflictsV2({ claim: [baseClaim({ id, revision: 2, body: "Remote original" })] });
  const review = (await store.listStudyConflictsV2()).find(c => c.entityId === id)!;
  const before = (await store.getPendingV2Ops()).filter(op => op.entityId === id);
  const originalPut = IDBObjectStore.prototype.put;
  let intercepted = false;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof originalPut>) {
    const request = originalPut.apply(this, args);
    if (this.name === "syncQueueV2") { intercepted = true; this.transaction.abort(); }
    return request;
  };
  try {
    await assert.rejects(store.resolveStudyConflictV2(review, { ...review.local, body: "Merged" }));
  } finally { IDBObjectStore.prototype.put = originalPut; }
  assert.ok(intercepted);
  assert.deepEqual((await store.getPendingV2Ops()).filter(op => op.entityId === id), before);
  assert.deepEqual((await store.listStudyConflictsV2()).find(c => c.entityId === id), review);
  assert.equal((await store.listLocalV2Entities("claim")).find(c => c.id === id)?.body, "Unsynced original");
  await store.removePendingV2Ops(before.map(op => op.opId));
});
