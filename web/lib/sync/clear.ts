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
 * This flow does not close CODEX_AUDIT A-014 ("Authenticated page/RSC caches
 * persist after sign-out"). A normal browsing session still lets
 * `public/sw.js` cache authenticated document and RSC responses in
 * `bible-brain-shell-*`; clearing the device deletes that cache, but the
 * caching policy itself is a separate task. (A-015 is a docs finding and has
 * nothing to do with this module — an earlier revision of this header cited it
 * by mistake.)
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

/** A write was saved after the export archive was built, so it is not in it. */
export class ExportLateWriteError extends Error {
  constructor(
    readonly pending: number,
    message = `${pending} local change(s) were saved while the archive was being built`,
  ) {
    super(message);
    this.name = "ExportLateWriteError";
  }
}

/**
 * Destruction did not finish in the time allowed, so the outcome is UNKNOWN —
 * not failed.
 *
 * An IndexedDB delete blocked by another tab is not cancelled by our timeout:
 * the request stays queued in the browser and can complete seconds or minutes
 * later, once the blocking connection closes. Reporting that as a clean
 * failure would be a lie in both directions (it may already be gone; it may
 * still be there), so it gets its own type and its own copy. The only honest
 * instruction is "treat this device as NOT cleared until it has been checked".
 */
export class DeviceClearUnknownError extends Error {
  constructor(
    readonly surface: string,
    /** Surfaces that separately failed verification during the same attempt. */
    readonly alsoRemaining: string[] = [],
    message = `Clearing ${surface} did not finish in time, so this device's state is unknown`,
  ) {
    super(message);
    this.name = "DeviceClearUnknownError";
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
 *
 * Losing that race raises DeviceClearUnknownError, never
 * DeviceClearIncompleteError. The timeout only stops us waiting; it does not
 * abort the browser's delete request, which may still complete afterwards.
 * Being blocked is NOT recorded on its own for the mirror-image reason: a
 * delete that was blocked and then unblocked really did succeed, and the
 * verification pass below is what decides.
 *
 * Every call re-runs both the destruction and the verification, so calling
 * this again after an unknown or incomplete outcome re-reads the device rather
 * than assuming anything about the previous attempt.
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
  let deleteOutcomeUnknown = false;
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
    // Unknown, not failed: the delete request outlives this race.
    // Unknown, not failed: the delete request outlives this race.
    if (timedOut) deleteOutcomeUnknown = true;
  } catch {
    // A rejected delete is a real, finished failure.
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

  // Unknown outranks incomplete. When the delete is still outstanding, the
  // "indexeddb" that verification just found may be deleted a moment from now,
  // so reporting a settled failure would overstate what we know.
  if (deleteOutcomeUnknown) {
    throw new DeviceClearUnknownError(
      "indexeddb",
      remaining.filter((surface) => surface !== "indexeddb"),
      blockedByOtherTab
        ? "Another tab is holding this app's database open, so the delete did not finish in time"
        : "The database delete did not finish in time",
    );
  }

  if (remaining.length > 0) {
    throw new DeviceClearIncompleteError(remaining);
  }
}

/**
 * The clear-device sequence in the exact order runDeviceClear() performs it.
 *
 * It lives beside the code that performs it, and both the confirm dialog and
 * the on-screen list are built from this one array, so user-facing copy cannot
 * describe an order the code does not run. tests/device-clear.test.ts asserts
 * the array against the call order in runDeviceClear() and against the
 * component that renders it.
 */
export const CLEAR_DEVICE_STEPS = [
  "Sync your writing to the server",
  "Sign out of this account",
  "Delete this app's notes and offline Bible data from this browser",
  "Check that they are really gone, and say so if anything is left",
] as const;

/** The confirm text, generated from the steps so it cannot drift from them. */
export const CLEAR_DEVICE_CONFIRM = [
  "Clear this device? This runs in order:",
  "",
  ...CLEAR_DEVICE_STEPS.map((step, index) => `${index + 1}. ${step}.`),
  "",
  "Your writing stays in your account — it is removed only from this browser.",
].join("\n");

/**
 * Copy for the outcome where the server session is gone and local data may
 * still be on the device. Exported so the component and its tests share one
 * wording.
 */
export const DEVICE_NOT_CLEARED_MESSAGE =
  "Your notes and offline Bible data are still stored in this browser. If anyone else uses this device, clear this site's data in your browser settings now.";

/** Copy for the unknown outcome. It must never say the device is clear. */
export const DEVICE_CLEAR_UNKNOWN_MESSAGE =
  "Clearing did not finish in time, and it may still be completing in the background. Treat this device as NOT cleared until it has been checked — usually another tab or window with this app open is holding it up. Close them, then check again.";

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
 *
 * The order below is CLEAR_DEVICE_STEPS: sync flush, server sign-out, local
 * destruction, verification (the last two are both inside
 * clearLocalStudyData, which verifies after it destroys).
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

/** Why nothing was cleared, for a failure raised before sign-out. */
export function messageForPreSignOut(cause: unknown): string {
  if (cause instanceof DeviceOfflineError) {
    return "Nothing was cleared. You went offline before your writing could sync.";
  }
  if (cause instanceof UnsyncedWritesError) {
    return `Nothing was cleared. ${cause.pending} change(s) are still waiting to sync — try again in a moment.`;
  }
  if (isSyncRejectedError(cause)) {
    return "Nothing was cleared. The server rejected some of your writing, so it only exists on this device.";
  }
  return "Nothing was cleared because sync and sign-out could not be confirmed. Please try again.";
}

/**
 * What the UI should show, and whether the user can act again.
 *
 * `canRetry` is always true and typed as such deliberately: no clear-device
 * failure is a dead end. Before sign-out the whole flow can simply be run
 * again; after sign-out the session is gone, so the remaining action is to
 * re-attempt the local destruction and re-verify it. A state the user cannot
 * leave would be the worst outcome of all, because the device is unclean and
 * they have no control that admits it.
 */
export type ClearFailureView = {
  /** "error" keeps the normal action row; "not-cleared" is a standing alert. */
  state: "error" | "not-cleared";
  /** True when the device's state could not be determined at all. */
  unknown: boolean;
  canRetry: true;
  message: string;
};

export function describeClearFailure(
  failure: DeviceClearFailure,
): ClearFailureView {
  if (!failure.signedOut) {
    return {
      state: "error",
      unknown: false,
      canRetry: true,
      message: messageForPreSignOut(failure.cause),
    };
  }
  if (failure.cause instanceof DeviceClearUnknownError) {
    return {
      state: "not-cleared",
      unknown: true,
      canRetry: true,
      message: DEVICE_CLEAR_UNKNOWN_MESSAGE,
    };
  }
  return {
    state: "not-cleared",
    unknown: false,
    canRetry: true,
    message: DEVICE_NOT_CLEARED_MESSAGE,
  };
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

/**
 * Fetch the archive and prove it is still current at the moment it is handed
 * over.
 *
 * flushPendingWrites() only proves the queue was empty *before* /api/export was
 * requested. The server builds the archive from synced rows, so a write saved
 * while the request was in flight — or after the response arrived but before
 * the download starts — is missing from an archive the user will file away
 * believing it is complete. That is the whole failure mode this export gate
 * exists to prevent, so the queue is re-read after the body has fully arrived
 * and immediately before the blob is returned. Anything pending cancels the
 * export; a stale archive is worse than no archive, because no archive is
 * obvious and a stale one is not.
 *
 * `fetchImpl` is injected only so tests can land a write inside that window.
 */
export async function fetchCurrentArchive(
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<Blob> {
  const fetchImpl =
    deps.fetchImpl ??
    ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));

  const response = await fetchImpl("/api/export", {
    cache: "no-store",
    credentials: "same-origin",
  });
  assertCurrentArchiveResponse(response);
  const blob = await response.blob();

  // The close of the TOCTOU window. Re-read, do not remember.
  const { getPendingOps } = await import("@/lib/sync/store");
  const late = await getPendingOps();
  if (late.length > 0) {
    throw new ExportLateWriteError(late.length);
  }

  return blob;
}

/**
 * Export copy. Every blocked path names the incomplete archive as the reason
 * rather than reporting a generic failure, because "export failed" and "your
 * export would have been missing your last three notes" call for different
 * actions from the user.
 */
export function exportBlockedMessage(error: unknown): string {
  if (error instanceof DeviceOfflineError) {
    return "Export cancelled to avoid an incomplete archive: you are offline, so this device's latest writing has not reached the server. Reconnect and try again.";
  }
  if (isSyncRejectedError(error)) {
    return `Export cancelled to avoid an incomplete archive: the server rejected ${error.rejected.length} change(s), so they would be missing from it.`;
  }
  if (error instanceof UnsyncedWritesError) {
    return `Export cancelled to avoid an incomplete archive: ${error.pending} change(s) are still waiting to sync. Try again in a moment.`;
  }
  if (error instanceof ExportLateWriteError) {
    return `Export cancelled to avoid an incomplete archive: ${error.pending} change(s) were saved while it was being built, so they are not in it. Nothing was downloaded — try again in a moment.`;
  }
  return "Export cancelled to avoid an incomplete archive: your writing could not be synced. Try again when the connection is stable.";
}
