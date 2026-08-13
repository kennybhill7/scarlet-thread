"use client";

/**
 * Device-data safety — the module both trust-boundary flows share.
 *
 * Export copies the on-device vault OFF the device; clear-device destroys it
 * ON the device. Both must fail closed on the same pre-flight, so the whole
 * pre-flight, the destroy, and its verification live here rather than in the
 * components. That is deliberate: `tsx --test` cannot import a `.tsx` that
 * imports a `.module.css`, so a component is not testable in this repo, and
 * plain TypeScript is. The file is still named clear.ts because that is where
 * the destroy lives; the scope is wider than the name and that is on purpose.
 *
 * lib/sync/client.ts and lib/sync/store.ts are imported dynamically, never at
 * module scope: store.ts:58 calls openDB() as a side effect of being imported,
 * which throws "ReferenceError: indexedDB is not defined" the moment a server
 * renders anything that reaches it (verified — a static import here fails
 * `next build` while prerendering /settings). Deferring the import keeps this
 * module server-safe without touching a read-only file.
 *
 * This flow does not close CODEX_AUDIT A-015. A normal browsing session still
 * lets `public/sw.js` cache authenticated document and RSC responses in
 * `bible-brain-shell-*`; clearing the device deletes that cache, but the
 * caching policy itself is a separate task.
 */

import { deleteDB } from "idb";

// Type-only: erased at compile time, so it adds no runtime import of client.ts.
import type { SyncRejectedError } from "@/lib/sync/client";

export const LOCAL_DATABASE = "bible-brain";
export const LOCAL_KEY_PREFIX = "bible-brain:";
/** Mirrors lib/bible/lastRead.ts:12 (A-038). tests/protected-integrations guards the drift. */
export const LAST_READ_KEY = "bible-brain:last-read";
export const APP_CACHE_PREFIXES = [
  "bible-brain-scripture",
  "bible-brain-shell",
] as const;

const DEFAULT_DELETE_TIMEOUT_MS = 5_000;

/** The device is offline, so nothing that requires a synced server can run. */
export class DeviceOfflineError extends Error {
  constructor(message = "This device is offline") {
    super(message);
    this.name = "DeviceOfflineError";
  }
}

/** Sync reported success but local writes are still queued. */
export class UnsyncedWritesError extends Error {
  constructor(
    readonly pending: number,
    message = `${pending} local change(s) are still waiting to sync`,
  ) {
    super(message);
    this.name = "UnsyncedWritesError";
  }
}

/** Destruction ran but verification still found app data on the device. */
export class DeviceClearIncompleteError extends Error {
  constructor(
    readonly remaining: string[],
    message = `Device data still present after clearing: ${remaining.join(", ")}`,
  ) {
    super(message);
    this.name = "DeviceClearIncompleteError";
  }
}

/**
 * The clear-device flow failed. `signedOut` is the whole point of this type:
 * `false` guarantees nothing local was touched, `true` means the server
 * session is gone while local data may still be on a possibly shared device.
 */
export class DeviceClearFailure extends Error {
  constructor(
    readonly signedOut: boolean,
    readonly cause: unknown,
    message = "Clearing this device did not complete",
  ) {
    super(message);
    this.name = "DeviceClearFailure";
  }
}

/**
 * Read through `globalThis` so a stubbed navigator is honoured, and default to
 * online when navigator is absent so a node/SSR context never refuses falsely.
 */
export function isOnline(): boolean {
  return globalThis.navigator?.onLine !== false;
}

/**
 * Identify a rejected-sync failure without importing lib/sync/client at module
 * scope (see the header). The name is set in the class constructor and travels
 * with the instance, so this is as reliable as `instanceof` here.
 */
export function isSyncRejectedError(
  error: unknown,
): error is SyncRejectedError {
  return error instanceof Error && error.name === "SyncRejectedError";
}

/**
 * The shared pre-flight. Resolves only when the server has provably accepted
 * every local write.
 *
 * Awaiting `syncNow()` alone is NOT proof: it dedupes concurrent callers
 * through an `inFlight` promise (lib/sync/client.ts:139-148), so a run that
 * started before your write can be handed back to you. Re-reading the queue
 * afterwards is the only sound check, hence the read-retry-read shape.
 */
export async function flushPendingWrites(): Promise<void> {
  if (!isOnline()) {
    throw new DeviceOfflineError(
      "This device is offline, so local writing has not reached the server",
    );
  }

  const [{ syncNow }, { getPendingOps }] = await Promise.all([
    import("@/lib/sync/client"),
    import("@/lib/sync/store"),
  ]);

  // Not caught: SyncRejectedError and HTTP/network failures must reach the
  // caller verbatim so "rejected" and "failed" can be told apart in the UI.
  await syncNow();

  let pending = await getPendingOps();
  if (pending.length > 0) {
    // Exactly one retry — a write that landed mid-run gets its own round-trip,
    // and a queue that will not drain fails instead of looping.
    await syncNow();
    pending = await getPendingOps();
  }
  if (pending.length > 0) {
    throw new UnsyncedWritesError(pending.length);
  }
}

function isAppCacheKey(key: string): boolean {
  return APP_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Destroy this app's local data, then verify it is actually gone.
 *
 * Deletion is attempted for every surface even after one fails, so a partial
 * clear removes as much as it can; the failure is reported afterwards. An
 * IndexedDB delete blocked by another tab hangs forever, so it is raced
 * against a timeout rather than left to stall the UI on "Clearing…".
 */
export async function clearLocalStudyData(
  options: { deleteTimeoutMs?: number } = {},
): Promise<void> {
  const deleteTimeoutMs = options.deleteTimeoutMs ?? DEFAULT_DELETE_TIMEOUT_MS;
  const remaining: string[] = [];
  const record = (surface: string) => {
    if (!remaining.includes(surface)) remaining.push(surface);
  };

  const { closeLocalDatabase } = await import("@/lib/sync/store");
  await closeLocalDatabase();

  let blockedByOtherTab = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = await Promise.race([
      deleteDB(LOCAL_DATABASE, {
        blocked: () => {
          blockedByOtherTab = true;
        },
      }).then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), deleteTimeoutMs);
      }),
    ]);
    if (timedOut || blockedByOtherTab) record("indexeddb");
  } catch {
    record("indexeddb");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  const cacheStorage = globalThis.caches;
  if (typeof cacheStorage !== "undefined") {
    try {
      const keys = await cacheStorage.keys();
      await Promise.all(
        keys.filter(isAppCacheKey).map((key) => cacheStorage.delete(key)),
      );
    } catch {
      record("caches");
    }
  }

  const storage = globalThis.localStorage;
  if (typeof storage !== "undefined") {
    try {
      // Index-based and backwards: a stubbed Storage need not support
      // Object.keys, and removal reindexes the remaining keys.
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (key?.startsWith(LOCAL_KEY_PREFIX)) storage.removeItem(key);
      }
    } catch {
      // Private-browsing quota states throw on write.
      record("localstorage");
    }
  }

  // Verification. `caches.delete()` resolving false is not an error, so
  // "tried" and "cleared" can only be told apart by looking again.
  if (typeof indexedDB !== "undefined") {
    try {
      // Absent on old Safari; there step 2 resolving is the only signal.
      const databases = await indexedDB.databases?.();
      if (databases?.some((info) => info.name === LOCAL_DATABASE)) {
        record("indexeddb");
      }
    } catch {
      record("indexeddb");
    }
  }

  if (typeof cacheStorage !== "undefined") {
    try {
      if ((await cacheStorage.keys()).some(isAppCacheKey)) record("caches");
    } catch {
      record("caches");
    }
  }

  if (typeof storage !== "undefined") {
    try {
      if (storage.getItem(LAST_READ_KEY) !== null) record("localstorage");
    } catch {
      record("localstorage");
    }
  }

  if (remaining.length > 0) {
    throw new DeviceClearIncompleteError(remaining);
  }
}

/**
 * Clear-device orchestration.
 *
 * `signOut` is injected so this path is testable without next-auth, `window`,
 * or a CSRF round-trip. `flush` is injected for the same reason and defaults
 * to the real pre-flight — the store's IndexedDB handle is a module singleton
 * that a successful clear closes for the rest of the process, so a test that
 * asserts scoped deletion after another test has already cleared cannot use
 * the real one. Production callers pass neither.
 *
 * Nothing destructive runs before `signOut()`, which is what makes
 * `DeviceClearFailure.signedOut === false` a hard "nothing was destroyed".
 */
export async function runDeviceClear(deps: {
  signOut: () => Promise<{ url?: string | null } | void>;
  deleteTimeoutMs?: number;
  flush?: () => Promise<void>;
}): Promise<{ redirectTo: string }> {
  const flush = deps.flush ?? flushPendingWrites;
  let signedOut = false;
  try {
    await flush();
    const result = await deps.signOut();
    signedOut = true;
    await clearLocalStudyData({ deleteTimeoutMs: deps.deleteTimeoutMs });
    return { redirectTo: result?.url || "/sign-in" };
  } catch (error) {
    throw new DeviceClearFailure(signedOut, error);
  }
}

/**
 * Guard the export payload itself. `response.ok` alone is not enough: a
 * redirect to a sign-in or captive-portal page also reports ok, and saving
 * that HTML as a .zip hands the user a corrupt archive they believe is their
 * vault.
 */
export function assertCurrentArchiveResponse(response: Response): void {
  if (!response.ok) {
    throw new Error(`Export failed with status ${response.status}`);
  }
  if (response.redirected) {
    throw new Error("Export was redirected, so the response is not an archive");
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("application/zip")) {
    throw new Error(`Export returned ${contentType || "no content type"}`);
  }
}
