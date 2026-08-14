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
  // The mount moved into ProtectedClientMounts (see that component's header:
  // the protected layout has to stay a Server Component to hold the auth
  // check, and `ssr: false` is only legal inside a Client Component).
  const mentions = [...walk("app"), ...walk("components")]
    .filter((file) => /\bSyncRegistration\b/.test(read(file)))
    .sort();
  assert.deepEqual(mentions, [
    "components/auth/DeviceSessionControls.tsx",
    "components/sync/SyncRegistration.tsx",
  ]);
  assert.equal(
    (read("components/auth/DeviceSessionControls.tsx").match(
      /<SyncRegistration\b/g,
    ) ?? []).length,
    1,
    "exactly one <SyncRegistration /> in the tree",
  );

  const hosts = [...walk("app"), ...walk("components")]
    .filter((file) => /\bProtectedClientMounts\b/.test(read(file)))
    .sort();
  assert.deepEqual(hosts, [
    "app/(app)/layout.tsx",
    "components/auth/DeviceSessionControls.tsx",
  ]);

  const layout = read("app/(app)/layout.tsx");
  assert.equal((layout.match(/<ProtectedClientMounts\b/g) ?? []).length, 1);

  const otherLayouts = walk("app").filter(
    (file) =>
      file.endsWith("/layout.tsx") && file !== "app/(app)/layout.tsx",
  );
  assert.ok(otherLayouts.includes("app/layout.tsx"));
  for (const file of otherLayouts) {
    assert.doesNotMatch(
      read(file),
      /SyncRegistration|ProtectedClientMounts/,
      file,
    );
  }
});

// --- A2. the protected layout is the auth boundary ---------------------------

test("the protected layout is a server component that awaits auth() and redirects", () => {
  const layout = read("app/(app)/layout.tsx");
  assert.doesNotMatch(
    layout,
    /^\s*["']use client["']/m,
    "a Client Component cannot hold a server-side auth check",
  );
  assert.match(layout, /from "@\/auth"/);
  assert.match(layout, /await auth\(\)/);
  assert.match(layout, /redirect\("\/sign-in"\)/);

  // The condition itself, pinned. `!session` would satisfy every other
  // assertion in this test while readmitting a de-allowlisted account:
  // lib/auth/config.ts:43 blanks `session.user.id` when the email is no longer
  // on the allowlist and leaves the session object itself intact.
  assert.match(
    layout,
    /if \(!session\?\.user\?\.id\) \{/,
    "the boundary is a usable user id, not merely the presence of a session",
  );
  assert.match(
    read("lib/auth/config.ts"),
    /session\.user\.id = isAllowedEmail\(session\.user\.email\) \? user\.id : ""/,
    "and that is what makes the id condition the fail-closed one",
  );

  const guard = layout.indexOf("await auth()");
  const idGuard = layout.indexOf("if (!session?.user?.id) {");
  const redirected = layout.indexOf('redirect("/sign-in")');
  const mount = layout.indexOf("<ProtectedClientMounts");
  const children = layout.indexOf("{children}");
  assert.ok(guard > -1 && redirected > guard, "the redirect follows the check");
  assert.ok(
    idGuard > guard && redirected > idGuard,
    "the id condition sits between the session read and the redirect",
  );
  assert.ok(
    redirected < mount && mount < children,
    "no protected content or sync mount renders before the check",
  );
});

// --- B. settings order -------------------------------------------------------

test("settings is a reachable route inside the protected tree", () => {
  const route = "app/(app)/settings/page.tsx";
  assert.ok(
    fs.existsSync(path.join(root, route)),
    "the settings route file is where the URL /settings expects it",
  );
  // Fails if the page is moved or renamed: the device sections may be rendered
  // from that path and nowhere else.
  assert.deepEqual(
    walk("app").filter((file) => /<DeviceSessionControls/.test(read(file))),
    [route],
  );

  // Inside the protected group, so the layout's auth check covers it.
  const layout = read("app/(app)/layout.tsx");
  assert.match(layout, /await auth\(\)/);
  assert.match(layout, /redirect\("\/sign-in"\)/);

  // Its three sections are all present.
  const page = read(route);
  for (const section of [
    "<OfflineDownloads",
    "<VaultExportButton",
    "<DeviceSessionControls",
  ]) {
    assert.ok(page.includes(section), `settings renders ${section}`);
  }

  // And a user can get there: something in the app links to it (A-024).
  const linking = [...walk("app"), ...walk("components")].filter((file) =>
    read(file).includes('href="/settings"'),
  );
  assert.ok(linking.length > 0, "a link to /settings exists in the app");
});

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
    (src.match(/signOut\(/g) ?? []).length,
    1,
    "exactly one sign-out call site",
  );
  // Two buttons, and both are accounted for by name: the destructive flow, and
  // the re-check that gets a signed-out user out of the not-cleared state.
  // Neither is a sign-out that leaves the unscoped local vault behind.
  assert.equal((src.match(/<button/g) ?? []).length, 2, "two named buttons");
  assert.equal((src.match(/void clearAndSignOut\(\)/g) ?? []).length, 1);
  assert.equal((src.match(/void checkAgain\(\)/g) ?? []).length, 1);
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

// --- E. A-014 is not silently claimed closed --------------------------------

test("clear.ts states that the cache-policy finding stays open, by its real ID", () => {
  const src = read("lib/sync/clear.ts");
  assert.match(src, /does not close CODEX_AUDIT A-014/);
  // The ID is checked against the audit itself, so a wrong one cannot pass.
  const audit = fs.readFileSync(path.join(root, "..", "CODEX_AUDIT.md"), "utf8");
  assert.match(
    audit,
    /### A-014 - Authenticated page\/RSC caches persist after sign-out/,
  );
  assert.doesNotMatch(
    src,
    /does not close CODEX_AUDIT A-015/,
    "A-015 is the stale-docs finding, not the cache-policy one",
  );
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
  const archive = src.indexOf("fetchCurrentArchive()");
  assert.ok(flushCall > -1 && bail > -1 && archive > -1);
  assert.ok(bail < archive, "a blocked pre-flight returns before /api/export");

  // The request itself lives in clear.ts so it is testable. Its shape is the
  // rest of the guarantee: guard the response, read the body, THEN re-check
  // the queue, and only then hand the blob over.
  const lib = read("lib/sync/clear.ts");
  const requested = lib.indexOf('fetchImpl("/api/export"');
  const guarded = lib.indexOf("assertCurrentArchiveResponse(response)");
  const body = lib.indexOf("await response.blob()");
  const recheck = lib.indexOf("const late = await getPendingOps()");
  const handover = lib.indexOf("return blob;");
  assert.ok(requested > -1 && guarded > requested, "the response is guarded");
  assert.ok(body > guarded, "the body is read after the guard");
  assert.ok(recheck > body, "the queue is re-read after the body arrives");
  assert.ok(handover > recheck, "and before the archive is handed over");
});

test("a write that lands after the archive arrives cancels the export", async () => {
  const store = await import("@/lib/sync/store");
  const { ExportLateWriteError, exportBlockedMessage, fetchCurrentArchive } =
    await import("@/lib/sync/clear");
  setOnline(true);
  await drainQueue();

  const zip = () =>
    new Response(new Uint8Array([80, 75, 3, 4]), {
      status: 200,
      headers: { "content-type": "application/zip" },
    });

  // Control: an empty queue at hand-over time delivers the archive.
  const clean = await fetchCurrentArchive({ fetchImpl: async () => zip() });
  assert.equal(clean.size, 4, "the archive is returned when nothing is queued");

  // Now land a write strictly after the fetch promise has resolved — the
  // response object is already in hand and its body is being read. This is the
  // window flushPendingWrites cannot see.
  let landed = 0;
  const fetchImpl = async () => {
    const response = zip();
    const readBody = response.blob.bind(response);
    Object.defineProperty(response, "blob", {
      configurable: true,
      value: async () => {
        landed += 1;
        const now = isoNow();
        await store.saveLocalThread({
          slug: "late-write",
          title: "Late write",
          definition: "",
          seeing: "",
          createdAt: now,
          updatedAt: now,
        });
        return readBody();
      },
    });
    return response;
  };

  try {
    await assert.rejects(
      fetchCurrentArchive({ fetchImpl }),
      (error: unknown) =>
        error instanceof ExportLateWriteError && error.pending === 1,
    );
    assert.equal(landed, 1, "the write really did land inside the window");
    assert.equal(
      (await store.getPendingOps()).length,
      1,
      "and it is still queued, not silently dropped from the archive",
    );
    assert.equal(
      exportBlockedMessage(new ExportLateWriteError(1)),
      "Export cancelled to avoid an incomplete archive: 1 change(s) were saved while it was being built, so they are not in it. Nothing was downloaded — try again in a moment.",
    );
    // The component shows exactly that message for this error.
    const src = read("components/export/VaultExportButton.tsx");
    assert.match(src, /error instanceof ExportLateWriteError/);
    assert.match(src, /exportBlockedMessage\(error\)/);
  } finally {
    await drainQueue();
  }
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

// --- J2. the export success copy claims only what the recheck proves --------

/**
 * The recheck in fetchCurrentArchive() reads the LOCAL queue. That proves no
 * write from THIS device was left out of the archive; it proves nothing about a
 * write another device synced after the server finished building it, because
 * the response carries no build watermark to compare against.
 */
test("the export success copy claims device-scoped currency, not account-wide", async () => {
  const { EXPORT_DOWNLOADED_MESSAGE } = await import("@/lib/sync/clear");
  assert.equal(
    EXPORT_DOWNLOADED_MESSAGE,
    "Export downloaded — it includes everything this device had synced when the archive was built.",
  );
  assert.doesNotMatch(
    EXPORT_DOWNLOADED_MESSAGE,
    /everything synced a moment ago/,
    "the previous wording asserted currency no code here establishes",
  );
  assert.doesNotMatch(
    EXPORT_DOWNLOADED_MESSAGE,
    /all your devices|your account|up to date|complete copy/i,
    "and no other account-wide claim replaced it",
  );

  // The component shows exactly that constant, so the claim cannot drift from
  // the guard that backs it.
  const src = read("components/export/VaultExportButton.tsx");
  assert.match(src, /setMessage\(EXPORT_DOWNLOADED_MESSAGE\)/);
  assert.doesNotMatch(src, /everything synced a moment ago/);
  assert.equal(
    (src.match(/Export downloaded/g) ?? []).length,
    0,
    "the success wording lives in clear.ts only",
  );
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
