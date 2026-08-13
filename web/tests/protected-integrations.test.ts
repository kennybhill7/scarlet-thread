import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

/**
 * Wiring and export-gate proofs for the protected shell.
 *
 * The component-level assertions here are source-text assertions, not renders.
 * `tsx --test` cannot import a `.tsx` that imports a `.module.css`, and there
 * is no test renderer in devDependencies, so "mounted exactly once" is proven
 * by exact file-set equality rather than by React. See the NOT-DONE list in
 * the task write-up.
 */

const root = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function walk(dir: string, ext = ".tsx"): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(path.join(root, dir), {
    withFileTypes: true,
  })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...walk(rel, ext));
    else if (entry.name.endsWith(ext)) found.push(rel);
  }
  return found;
}

const isoNow = () => new Date().toISOString();

function syncResponse() {
  return new Response(
    JSON.stringify({
      entries: [],
      threads: [],
      progress: [],
      logs: [],
      people: [],
      rejected: [],
      serverTime: isoNow(),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function setOnline(onLine: boolean) {
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine },
    configurable: true,
  });
}

async function drainQueue() {
  const store = await import("@/lib/sync/store");
  const pending = await store.getPendingOps();
  await store.removePendingOps(pending.map((op) => op.id));
}

// --- A. one sync mount, inside the protected tree only -----------------------

test("SyncRegistration is mounted exactly once, only in the protected layout", () => {
  const mentions = [...walk("app"), ...walk("components")]
    .filter((file) => /\bSyncRegistration\b/.test(read(file)))
    .sort();
  assert.deepEqual(mentions, [
    "app/(app)/layout.tsx",
    "components/sync/SyncRegistration.tsx",
  ]);

  const layout = read("app/(app)/layout.tsx");
  assert.equal((layout.match(/<SyncRegistration\b/g) ?? []).length, 1);

  const otherLayouts = walk("app").filter(
    (file) =>
      file.endsWith("/layout.tsx") && file !== "app/(app)/layout.tsx",
  );
  assert.ok(otherLayouts.includes("app/layout.tsx"));
  for (const file of otherLayouts) {
    assert.doesNotMatch(read(file), /SyncRegistration/, file);
  }
});

// --- B. settings order -------------------------------------------------------

test("settings renders downloads, then export, then clear device", () => {
  const page = read("app/(app)/settings/page.tsx");
  const offline = page.indexOf("<OfflineDownloads");
  const exportButton = page.indexOf("<VaultExportButton");
  const clear = page.indexOf("<DeviceSessionControls");
  assert.ok(offline > -1 && exportButton > -1 && clear > -1);
  assert.ok(offline < exportButton, "offline downloads come first");
  assert.ok(exportButton < clear, "export comes before clearing the device");
});

// --- C. no retain-data sign-out ---------------------------------------------

test("no sign-out that retains the unscoped local vault is offered", () => {
  const src = read("components/auth/DeviceSessionControls.tsx");
  assert.equal(
    (src.match(/<button/g) ?? []).length,
    1,
    "exactly one action button",
  );
  assert.equal(
    (src.match(/signOut\(/g) ?? []).length,
    1,
    "exactly one sign-out call site",
  );
  assert.match(src, /account\/workspace namespacing/);
  assert.doesNotMatch(src, />\s*Sign out\s*</);
});

// --- D. the duplicated last-read key cannot drift ---------------------------

test("the cleared last-read key still matches lib/bible/lastRead.ts", () => {
  assert.match(read("lib/bible/lastRead.ts"), /const KEY = "bible-brain:last-read"/);
  assert.match(
    read("lib/sync/clear.ts"),
    /LAST_READ_KEY = "bible-brain:last-read"/,
  );
});

// --- E. A-015 is not silently claimed closed --------------------------------

test("clear.ts states that the cache-policy finding stays open", () => {
  const src = read("lib/sync/clear.ts");
  assert.match(src, /A-015/);
  assert.match(src, /does not close/);
});

// --- F-J. the export pre-flight ---------------------------------------------

test("offline export never reaches /api/export", async () => {
  const { DeviceOfflineError, flushPendingWrites } = await import(
    "@/lib/sync/clear"
  );
  setOnline(false);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return syncResponse();
  };
  try {
    await assert.rejects(
      flushPendingWrites(),
      (error: unknown) => error instanceof DeviceOfflineError,
    );
    assert.equal(calls, 0, "nothing is fetched while offline");
  } finally {
    globalThis.fetch = originalFetch;
  }

  // The component half of the same guarantee. It cannot be rendered here, so
  // this asserts the shape that makes it true: the blocked pre-flight returns
  // before any code path reaches /api/export, and the response that does come
  // back is checked before it is saved as an archive.
  const src = read("components/export/VaultExportButton.tsx");
  const flushCall = src.indexOf("await flushPendingWrites()");
  const bail = src.indexOf("return;", flushCall);
  const exportFetch = src.indexOf('fetch("/api/export"');
  assert.ok(flushCall > -1 && bail > -1 && exportFetch > -1);
  assert.ok(bail < exportFetch, "a blocked pre-flight returns before /api/export");
  assert.match(src, /assertCurrentArchiveResponse\(response\)/);
});

test("a server-rejected write blocks the export and stays queued", async () => {
  const store = await import("@/lib/sync/store");
  const { SyncRejectedError } = await import("@/lib/sync/client");
  const { flushPendingWrites } = await import("@/lib/sync/clear");
  setOnline(true);
  await drainQueue();
  const now = isoNow();
  await store.saveLocalThread({
    slug: "rejected-export",
    title: "Rejected export",
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
        serverTime: isoNow(),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  try {
    await assert.rejects(flushPendingWrites(), SyncRejectedError);
    assert.deepEqual(
      (await store.getPendingOps()).map((op) => op.id),
      [pending.id],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a failed sync request blocks the export and drains nothing", async () => {
  const store = await import("@/lib/sync/store");
  const { flushPendingWrites } = await import("@/lib/sync/clear");
  setOnline(true);
  const before = (await store.getPendingOps()).map((op) => op.id);
  assert.equal(before.length, 1, "the rejected op is still queued");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("nope", { status: 500 });
  try {
    await assert.rejects(flushPendingWrites());
    assert.deepEqual(
      (await store.getPendingOps()).map((op) => op.id),
      before,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a write that lands mid-sync blocks the export", async () => {
  const store = await import("@/lib/sync/store");
  const { UnsyncedWritesError, flushPendingWrites } = await import(
    "@/lib/sync/clear"
  );
  setOnline(true);
  await drainQueue();

  const originalFetch = globalThis.fetch;
  let raced = 0;
  globalThis.fetch = async (input) => {
    if (String(input).startsWith("/api/sync/pull")) {
      raced += 1;
      const now = isoNow();
      await store.saveLocalThread({
        slug: `raced-${raced}`,
        title: `Raced ${raced}`,
        definition: "",
        seeing: "",
        createdAt: now,
        updatedAt: now,
      });
    }
    return syncResponse();
  };
  try {
    await assert.rejects(
      flushPendingWrites(),
      (error: unknown) => error instanceof UnsyncedWritesError,
    );
    assert.ok(raced >= 2, "the single retry ran");
  } finally {
    globalThis.fetch = originalFetch;
    await drainQueue();
  }
});

test("the single retry drains a write that landed mid-sync", async () => {
  const store = await import("@/lib/sync/store");
  const { flushPendingWrites } = await import("@/lib/sync/clear");
  setOnline(true);
  await drainQueue();

  const originalFetch = globalThis.fetch;
  let pulls = 0;
  globalThis.fetch = async (input) => {
    if (String(input).startsWith("/api/sync/pull")) {
      pulls += 1;
      if (pulls === 1) {
        const now = isoNow();
        await store.saveLocalThread({
          slug: "raced-once",
          title: "Raced once",
          definition: "",
          seeing: "",
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return syncResponse();
  };
  try {
    await flushPendingWrites();
    assert.equal((await store.getPendingOps()).length, 0);
    assert.equal(pulls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    await drainQueue();
  }
});

// --- K. the archive response itself -----------------------------------------

test("only an un-redirected zip counts as a current archive", async () => {
  const { assertCurrentArchiveResponse } = await import("@/lib/sync/clear");

  assert.throws(() =>
    assertCurrentArchiveResponse(
      new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    ),
  );

  assert.throws(() =>
    assertCurrentArchiveResponse(
      new Response("<html>sign in</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ),
  );

  const redirected = new Response(new Uint8Array([80, 75, 3, 4]), {
    status: 200,
    headers: { "content-type": "application/zip" },
  });
  Object.defineProperty(redirected, "redirected", { value: true });
  assert.throws(() => assertCurrentArchiveResponse(redirected));

  assert.doesNotThrow(() =>
    assertCurrentArchiveResponse(
      new Response(new Uint8Array([80, 75, 3, 4]), {
        status: 200,
        headers: { "content-type": "application/zip" },
      }),
    ),
  );
});
