import assert from "node:assert/strict";
import test from "node:test";

import "fake-indexeddb/auto";

import type { SyncOp } from "@/lib/contracts";
import { batchSyncOps } from "@/lib/sync/client";

test("local writes atomically enqueue entry and thread operations", async () => {
  const store = await import("@/lib/sync/store");
  const now = new Date().toISOString();
  await store.saveLocalThread({
    slug: "seed",
    title: "Seed",
    definition: "",
    seeing: "",
    createdAt: now,
    updatedAt: now,
  });
  await store.saveLocalEntry({
    id: crypto.randomUUID(),
    kind: "observation",
    body: "A seed is promised.",
    chapter: "1.3",
    threads: ["seed"],
    createdAt: now,
    updatedAt: now,
  });

  const [threads, entries, pending] = await Promise.all([
    store.listLocalThreads(),
    store.listLocalEntries("1.3"),
    store.getPendingOps(),
  ]);
  assert.equal(threads.length, 1);
  assert.equal(entries.length, 1);
  assert.deepEqual(
    pending.map((op) => op.entity).sort(),
    ["entry", "thread"],
  );
  await store.removePendingOps(pending.map((op) => op.id));
});

test("large offline queues are split into bounded push batches", () => {
  const now = new Date().toISOString();
  const ops: SyncOp[] = Array.from({ length: 205 }, (_, index) => ({
    id: crypto.randomUUID(),
    entity: "thread",
    entityId: `thread-${index}`,
    op: "upsert",
    payload: {
      slug: `thread-${index}`,
      title: `Thread ${index}`,
      definition: "",
      seeing: "",
      createdAt: now,
      updatedAt: now,
    },
    updatedAt: now,
  }));
  const batches = batchSyncOps(ops);
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [100, 100, 5],
  );
  assert.deepEqual(batches.flat(), ops);
});

test("remote last-write-wins merge does not overwrite a newer local entry", async () => {
  const store = await import("@/lib/sync/store");
  const now = new Date().toISOString();
  const local = {
    id: crypto.randomUUID(),
    kind: "observation" as const,
    body: "Newer local copy",
    chapter: "1.4",
    threads: ["seed"],
    createdAt: now,
    updatedAt: now,
  };
  await store.saveLocalEntry(local);
  await store.mergeRemoteChanges(
    [
      {
        ...local,
        body: "Older remote copy",
        updatedAt: new Date(Date.parse(local.updatedAt) - 1_000).toISOString(),
      },
    ],
    [],
  );
  const [after] = await store.listLocalEntries("1.4");
  assert.equal(after.body, "Newer local copy");
  const pending = await store.getPendingOps();
  await store.removePendingOps(pending.map((op) => op.id));
});

test("server snapshot resolves equal-timestamp ties on every device", async () => {
  const store = await import("@/lib/sync/store");
  const now = new Date().toISOString();
  const local = {
    id: crypto.randomUUID(),
    kind: "observation" as const,
    body: "Local tie candidate",
    chapter: "1.4",
    threads: ["seed"],
    createdAt: now,
    updatedAt: now,
  };
  await store.saveLocalEntry(local);
  await store.mergeRemoteChanges(
    [{ ...local, body: "Server tie winner" }],
    [],
  );
  const [after] = await store.listLocalEntries("1.4");
  assert.equal(after.body, "Server tie winner");
  const pending = await store.getPendingOps();
  await store.removePendingOps(pending.map((op) => op.id));
});

test("local storage refuses new threadless writing", async () => {
  const store = await import("@/lib/sync/store");
  const now = new Date().toISOString();
  await assert.rejects(
    store.saveLocalEntry({
      id: crypto.randomUUID(),
      kind: "question",
      body: "What does this mean?",
      chapter: "1.3",
      threads: [],
      createdAt: now,
      updatedAt: now,
    }),
    /at least one thread/,
  );
});

test("successful push and pull drains only confirmed local operations", async () => {
  const store = await import("@/lib/sync/store");
  const { syncNow } = await import("@/lib/sync/client");
  const now = new Date().toISOString();
  await store.saveLocalThread({
    slug: "sync-success",
    title: "Sync success",
    definition: "",
    seeing: "",
    createdAt: now,
    updatedAt: now,
  });
  await store.saveLocalEntry({
    id: crypto.randomUUID(),
    kind: "observation",
    body: "This pair should sync.",
    chapter: "1.5",
    threads: ["sync-success"],
    createdAt: now,
    updatedAt: now,
  });
  const originalFetch = globalThis.fetch;
  const requests: { url: string; body?: unknown }[] = [];
  const response = (serverTime: string) =>
    new Response(
      JSON.stringify({
        entries: [],
        threads: [],
        progress: [],
        logs: [],
        people: [],
        rejected: [],
        serverTime,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    return response(
      requests.length === 1
        ? "2026-07-29T05:00:00.000Z"
        : "2026-07-29T05:00:01.000Z",
    );
  };

  try {
    const before = await store.getPendingOps();
    assert.equal(before.length, 2);
    const [result, duplicateResult] = await Promise.all([
      syncNow(),
      syncNow(),
    ]);
    assert.equal(result, duplicateResult);
    assert.equal(result.pushed, 2);
    assert.equal((await store.getPendingOps()).length, 0);
    assert.equal(requests[0].url, "/api/sync/push");
    assert.equal(requests[1].url, "/api/sync/pull?since=2026-07-29T05%3A00%3A00.000Z");
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("server-rejected operations remain queued for recovery", async () => {
  const store = await import("@/lib/sync/store");
  const { SyncRejectedError, syncNow } = await import("@/lib/sync/client");
  const now = new Date().toISOString();
  await store.saveLocalThread({
    slug: "recover-me",
    title: "Recover me",
    definition: "",
    seeing: "",
    createdAt: now,
    updatedAt: now,
  });
  const [pending] = await store.getPendingOps();
  assert.ok(pending);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        entries: [],
        threads: [],
        progress: [],
        logs: [],
        people: [],
        rejected: [{ id: pending.id, reason: "Injected rejection" }],
        serverTime: "2026-07-29T05:00:02.000Z",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );

  try {
    await assert.rejects(syncNow(), SyncRejectedError);
    assert.deepEqual(
      (await store.getPendingOps()).map((op) => op.id),
      [pending.id],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
