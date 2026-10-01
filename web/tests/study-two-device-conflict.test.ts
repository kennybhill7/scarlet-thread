/**
 * STUDYOFFLINE-001 — acceptance criterion 4: a real two-device conflict test
 * that proves what this app's CURRENT sync protocol actually does when both
 * devices edit the same claim offline and both come back online, rather than
 * asserting something that isn't true.
 *
 * SETUP: ONE real local vault (`lib/sync/store.ts`, real `fake-indexeddb`,
 * exactly like every other suite in this repo) stands in for "device A".
 * "Device B" is modeled as a FAKE SERVER whose `/api/sync/v2/push` and
 * `/api/sync/v2/pull` behavior faithfully mirrors the REAL server's
 * documented contract (`lib/db/sync-v2.ts`'s `planWrite`: optimistic
 * concurrency via `baseRevision` vs. the stored row's `revision`, rejecting
 * a stale base with the real reason-string shape) and already holds device
 * B's accepted edit before device A's sync ever runs — exactly what "device
 * B pushed first while device A was still offline" looks like from the
 * server's point of view. This is the same technique
 * `tests/sync-flush.test.ts`'s own "two-device-style" test already uses
 * (that test drives `mergeRemoteChangesV2` directly; this one drives the
 * REAL push/pull round trip through `lib/sync/client.ts`'s `syncNowV2`, so
 * it proves the conflict end to end rather than only the merge step).
 *
 * WHAT THIS DOES NOT REPRODUCE (disclosed, not hidden — see this task's own
 * final report): `design/OPEN_QUESTIONS_AUDIT_2026-09-25.md`'s Q2(a) flags a
 * genuine check-then-write RACE in `lib/db/sync-v2.ts`'s `planWrite`/`write`
 * (the revision SELECT and the `INSERT ... ON CONFLICT DO UPDATE` are not one
 * atomic compare-and-swap) — two TRULY CONCURRENT pushes carrying the SAME
 * baseRevision could both pass the check and the second write could silently
 * clobber the first. Reproducing that needs real concurrent requests against
 * a real Postgres connection; `lib/db/sync-v2.ts`/`db/schema.ts` are outside
 * this task's owned paths to change, and this test harness has no real
 * database to race requests against. What IS reproduced below is the far
 * more common, SEQUENTIAL case (device B's push completes before device A's
 * push is even attempted) — and that case alone is enough to answer the
 * acceptance criterion's question honestly.
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

test("TWO-DEVICE CONFLICT: both devices edit the same claim offline; device B's edit (already synced) wins on the server, device A's own prose is preserved locally and never silently overwritten -- but also never reaches the server", async () => {
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

    // Drive two more syncs so the op crosses V2_OP_PARK_THRESHOLD (3) --
    // exactly SYNCFLUSH-001's own documented parking behavior, proving this
    // is not a permanent crash/wedge for the LEARNER even though the
    // conflict itself never resolves.
    await assert.rejects(client.syncNowV2(), client.SyncRejectedErrorV2);
    await client.syncNowV2(); // 3rd rejection crosses the threshold -- parks, does not throw this round

    const stillPending = (await store.getPendingV2Ops()).find((candidate) => candidate.opId === op.opId);
    assert.ok(stillPending, "device A's edit must still be queued -- never silently dropped");
    assert.equal(stillPending.parked, true);

    // CLAIM 2 -- after parking, further syncs (e.g. the background flush
    // controller's normal cadence) stop throwing, but STILL never silently
    // overwrite device A's local copy with B's pulled row (mergeRemoteChangesV2's
    // pending-op-skip rule applies to a parked op exactly like any other).
    await client.syncNowV2();
    const afterParked = (await store.listLocalV2Entities("claim")).find((row) => row.id === deviceAsEdit.id);
    assert.equal(afterParked?.body, "Device A's edit -- made offline, never saw B's");

    // CLAIM 3 -- the honest, disclosed gap this test exists to surface: the
    // SERVER's own canonical copy is permanently device B's edit. Device A's
    // op carries a FIXED baseRevision of 1; the server will never again be
    // at revision 1 for this id, so this op can never be accepted as-is.
    // There is no conflict-resolution UI in this app (out of this task's
    // scope) and no artifact_revisions writer
    // (design/OPEN_QUESTIONS_AUDIT_2026-09-25.md Q2(c) -- never implemented,
    // outside this task's owned paths) to reconcile the two. The real,
    // current behavior is: FIRST-ACCEPTED-WINS on the server, forever, for
    // this id; the LOSING device's edit survives ONLY locally, on that one
    // device, invisible to every other device and to the server, until a
    // human intervenes. This is not "last-write-wins by clock" (B is not
    // newer by any timestamp this test set -- B's updatedAt is EARLIER than
    // A's) -- it is first-accepted-wins, which is a materially different
    // (and, for a learner, more surprising) guarantee than BUILD_PLAN tenet
    // 4's prose would suggest on its own.
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
