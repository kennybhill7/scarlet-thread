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

/**
 * The object store lib/sync/store.ts:47-51 queues unsynced writes in. Named
 * here as a literal rather than imported because the read below deliberately
 * does not go through that module — see countPendingWrites().
 */
const SYNC_QUEUE_STORE = "syncQueue";

/**
 * Where the "this device was NOT cleared" warning survives a reload.
 *
 * The value is one of three fixed reason words and never anything the user
 * wrote, so persisting it leaks nothing even on a shared device — it is a flag
 * saying the vault may still be resident, not any part of the vault. It sits
 * under LOCAL_KEY_PREFIX on purpose: the sweep in clearLocalStudyData() then
 * removes it as part of any clear that actually succeeds, so a stale warning
 * cannot outlive the condition it describes.
 */
export const DEVICE_NOT_CLEARED_KEY = "bible-brain:device-not-cleared";

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

/**
 * Local writing is queued (or the queue could not be read) at the moment
 * destruction was about to start, so nothing was destroyed.
 *
 * This is NOT UnsyncedWritesError. That one is the pre-flight refusing to
 * start; this one is the destroy refusing to run after the pre-flight already
 * passed and the session has since been given up, which is a different fact
 * about the device and calls for different copy.
 */
export class DeviceClearUnsyncedError extends Error {
  constructor(
    /** Queued write count, or null when the queue could not be read at all. */
    readonly pending: number | null,
    message = pending === null
      ? "This device's unsynced-writing queue could not be read, so nothing was deleted"
      : `${pending} local change(s) are still waiting to sync, so nothing was deleted`,
  ) {
    super(message);
    this.name = "DeviceClearUnsyncedError";
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
 * This browser has no Web Locks API, so there is no way to hold the writers
 * in lib/sync/store.ts off while a delete is in flight — exactly the gap that
 * let a write committed in another tab get destroyed by a delete that outlived
 * the wait for it (round 2 of P0UI-001). Refusing here is the fail-closed
 * side of that fix: better an automated clear that cannot run than one that
 * runs uncoordinated.
 */
export class DeviceClearCoordinationUnsupportedError extends Error {
  constructor(
    message = "This browser cannot coordinate clearing with other open tabs, so this device was not cleared",
  ) {
    super(message);
    this.name = "DeviceClearCoordinationUnsupportedError";
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

/** Open the app database as another tab would: at whatever version it is on. */
function openRawDatabase(): Promise<{
  db: IDBDatabase;
  created: boolean;
} | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(LOCAL_DATABASE);
    } catch {
      resolve(null);
      return;
    }
    let created = false;
    // Fires only when the database did not exist, because no version was asked
    // for. That is how a look becomes a create, and how we know to undo it.
    request.onupgradeneeded = () => {
      created = true;
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
    request.onsuccess = () => resolve({ db: request.result, created });
  });
}

function countStoreRecords(db: IDBDatabase): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const request = db
        .transaction(SYNC_QUEUE_STORE, "readonly")
        .objectStore(SYNC_QUEUE_STORE)
        .count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * How many writes are still queued on this device — or `null` when the queue
 * could not be read at all, which callers must treat as "unknown", not "none".
 *
 * This deliberately does NOT call lib/sync/store's getPendingOps(). That module
 * holds one IndexedDB connection in a module-level promise (store.ts:58), and
 * closeLocalDatabase() closes it for the rest of the page's life
 * (store.ts:320-323) — which is exactly what a first clear attempt does. Every
 * later call then throws InvalidStateError, and the re-verify path runs in
 * precisely that state, so this guard has to be able to read the queue with the
 * module's handle already dead.
 *
 * `indexedDB.databases()` is consulted first so a device with no app database
 * is answered without opening — and therefore creating — one. Where that API is
 * missing (old Safari) the versionless open can create an empty database; that
 * is detected through `upgradeneeded` and undone before returning.
 */
export async function countPendingWrites(): Promise<number | null> {
  // No IndexedDB at all means nothing was ever stored here, so nothing can be
  // lost. Answering "unknown" would make such a context impossible to clear.
  if (typeof indexedDB === "undefined") return 0;

  let present: boolean | null;
  try {
    const databases = await indexedDB.databases?.();
    present = databases
      ? databases.some((info) => info.name === LOCAL_DATABASE)
      : null;
  } catch {
    present = null;
  }
  if (present === false) return 0;

  const opened = await openRawDatabase();
  if (opened === null) return null;
  const { db, created } = opened;
  try {
    // A database we just created holds nothing, and a schema without the queue
    // store predates it — both are a definite zero, not an unknown.
    if (created || !db.objectStoreNames.contains(SYNC_QUEUE_STORE)) return 0;
    return await countStoreRecords(db);
  } finally {
    db.close();
    if (created) {
      // We only meant to look. Leaving the empty database behind would make
      // the verification pass below report this device as un-cleared.
      try {
        await deleteDB(LOCAL_DATABASE);
      } catch {
        // The destroy that follows deletes it anyway.
      }
    }
  }
}

/** What runClearUnderLock() has to tell clearLocalStudyData() to hand the caller. */
type ClearOutcome = { ok: true } | { ok: false; error: Error };

/**
 * Destroy this app's local data, then verify it is actually gone.
 *
 * Runs the whole sequence — pending-queue check, own-connection close,
 * deleteDB, and verification, all in runClearUnderLock() below — while
 * holding lib/sync/store.ts's WRITE_LOCK_NAME in EXCLUSIVE mode. Every writer
 * there takes the same lock in SHARED mode around its own transaction (see
 * store.ts), so none of them can begin a new write for as long as this holds
 * it: a write already in flight when this is requested finishes first, which
 * is why it shows up in the pending-queue check below and correctly refuses
 * the clear instead of racing it; a write attempted after this is granted
 * simply waits its turn.
 *
 * Without navigator.locks there is no way to hold those writers off at all,
 * so this refuses outright rather than deleting uncoordinated — see
 * DeviceClearCoordinationUnsupportedError. That is the fail-closed mirror of
 * the exclusion above: an automated clear that cannot run beats one that runs
 * unable to prove nothing else is writing underneath it.
 *
 * Every call re-runs both the destruction and the verification, so calling
 * this again after an unknown or incomplete outcome re-reads the device rather
 * than assuming anything about the previous attempt.
 */
export async function clearLocalStudyData(
  options: { deleteTimeoutMs?: number } = {},
): Promise<void> {
  const locks = globalThis.navigator?.locks;
  if (!locks) {
    throw new DeviceClearCoordinationUnsupportedError();
  }

  const { WRITE_LOCK_NAME } = await import("@/lib/sync/store");
  const deleteTimeoutMs = options.deleteTimeoutMs ?? DEFAULT_DELETE_TIMEOUT_MS;

  let reportOutcome!: (outcome: ClearOutcome) => void;
  const reported = new Promise<ClearOutcome>((resolve) => {
    reportOutcome = resolve;
  });

  const held = locks.request(WRITE_LOCK_NAME, { mode: "exclusive" }, () =>
    runClearUnderLock(deleteTimeoutMs, reportOutcome),
  );
  // runClearUnderLock() reports every outcome through reportOutcome() rather
  // than throwing, so `held` never actually rejects in practice — this
  // handler is defensive only, the same reasoning as deletion.catch() below:
  // nothing else observes `held` once `reported` has already settled.
  held.catch(() => {});

  const outcome = await reported;
  if (!outcome.ok) throw outcome.error;
}

/**
 * The destroy-and-verify sequence, run as the body of the exclusive
 * WRITE_LOCK_NAME hold clearLocalStudyData() takes.
 *
 * `reportOutcome` fires as soon as this has an answer for the CALLER — at the
 * same deleteTimeoutMs-bounded point the pre-lock version of this function
 * used to return or throw. Deletion is attempted for every surface even after
 * one fails, so a partial clear removes as much as it can; the failure is
 * reported afterwards. An IndexedDB delete blocked by another tab hangs
 * forever, so the CALLER is only kept waiting up to deleteTimeoutMs for it —
 * "unknown" is reported instead of stalling the UI on "Clearing…" indefinitely.
 *
 * But an "unknown" outcome does NOT make this function return right away: it
 * goes on to actually await the real deleteDB() settling before returning,
 * because returning is what ends the exclusive hold. Reporting "unknown" and
 * releasing the lock together would reopen the exact gap this task closes —
 * a writer freed the instant this stops watching could still land in the
 * browser-level window a still-outstanding delete request leaves open, and be
 * destroyed the moment that delete finally runs, unseen by anything that
 * could have refused it.
 *
 * Losing the deleteTimeoutMs race reports DeviceClearUnknownError, never
 * DeviceClearIncompleteError: the timeout only bounds the caller's wait, it
 * does not abort the browser's delete request. Being blocked is NOT recorded
 * on its own for the mirror-image reason: a delete that was blocked and then
 * unblocked really did succeed, and the verification pass below is what
 * decides.
 *
 * Nothing is destroyed while local writing is still queued. That check is the
 * first statement here, not a caller's responsibility, because both entry
 * points need it: runDeviceClear() reaches here across a sign-out network
 * round-trip, and the re-verify path reaches here with no session at all.
 */
async function runClearUnderLock(
  deleteTimeoutMs: number,
  reportOutcome: (outcome: ClearOutcome) => void,
): Promise<void> {
  // Re-read, do not remember — the mirror of the export close in
  // fetchCurrentArchive(). flushPendingWrites() only proved the queue was empty
  // when it ran; runDeviceClear() then awaits signOut(), and lib/sync/store.ts
  // writes into the same shared `bible-brain` database from every tab on this
  // origin, so a note saved in another tab during that window is queued,
  // unsyncable (the session is gone by now) and one deleteDB away from being
  // destroyed with no trace and a `{redirectTo}` success returned over it.
  //
  // Failing closed here also closes the blocked-then-closed ending: because no
  // deleteDB is ever issued while the queue is non-empty, there is no delete
  // request left queued in the browser to complete — and destroy that writing —
  // when the user closes the blocking tab. And because the re-verify path calls
  // straight into this function, a device holding unsynced writing can never be
  // certified "clear" either.
  const pending = await countPendingWrites();
  if (pending === null || pending > 0) {
    reportOutcome({ ok: false, error: new DeviceClearUnsyncedError(pending) });
    return;
  }

  const remaining: string[] = [];
  const record = (surface: string) => {
    if (!remaining.includes(surface)) remaining.push(surface);
  };

  const { closeLocalDatabase } = await import("@/lib/sync/store");
  await closeLocalDatabase();

  let blockedByOtherTab = false;
  let deleteOutcomeUnknown = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deletion = deleteDB(LOCAL_DATABASE, {
    blocked: () => {
      blockedByOtherTab = true;
    },
  }).then(() => false);
  // Promise.race attaches a rejection handler to every input, so a delete
  // that rejects after the timeout has already won is handled as the code
  // stands. This explicit no-op keeps that true if the race is ever
  // restructured: an unhandled rejection from a flow whose entire job is
  // telling the user exactly what happened would be the worst kind of noise.
  deletion.catch(() => {});

  try {
    const timedOut = await Promise.race([
      deletion,
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), deleteTimeoutMs);
      }),
    ]);
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
    // The sweep just removed DEVICE_NOT_CLEARED_KEY along with everything else
    // under the prefix, and a same-window removal raises no `storage` event, so
    // any mounted warning has to be told. Doing it here rather than only on the
    // success path means a partial clear that still managed the sweep does not
    // leave a warning on screen that its own key no longer backs.
    notifyDeviceNotCleared();
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
    reportOutcome({
      ok: false,
      error: new DeviceClearUnknownError(
        "indexeddb",
        remaining.filter((surface) => surface !== "indexeddb"),
        blockedByOtherTab
          ? "Another tab is holding this app's database open, so the delete did not finish in time"
          : "The database delete did not finish in time",
      ),
    });
    // The caller has its answer; this function's own exclusive lock does not
    // release until the line below actually settles — see this function's
    // header for why that gap matters.
    await deletion;
    return;
  }

  if (remaining.length > 0) {
    reportOutcome({ ok: false, error: new DeviceClearIncompleteError(remaining) });
    return;
  }

  reportOutcome({ ok: true });
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
  "If anything is still unsynced when step 3 begins, nothing is deleted.",
].join("\n");

/**
 * Copy for the outcome where the server session is gone and local data may
 * still be on the device. Exported so the component and its tests share one
 * wording.
 */
export const DEVICE_NOT_CLEARED_MESSAGE =
  "Your notes and offline Bible data are still stored in this browser. If anyone else uses this device, clear this site's data in your browser settings now.";

/**
 * Copy for the unknown outcome. It must never say the device is clear.
 *
 * "Close them" used to be the whole instruction here — and closing the
 * blocking tab was exactly the action that let a write saved in it be
 * destroyed by a delete request the app had already issued and given up
 * waiting on (round 2 of P0UI-001). It is safe to say again now: every write
 * in lib/sync/store.ts takes WRITE_LOCK_NAME in shared mode, and this clear
 * holds it exclusively for as long as the real delete is outstanding — not
 * just until this message is shown — so nothing can be saved into the gap
 * closing that tab used to open.
 */
export const DEVICE_CLEAR_UNKNOWN_MESSAGE =
  "Clearing did not finish in time, and it may still be completing in the background. Treat this device as NOT cleared until it has been checked — usually another tab or window with this app open is holding it up. Closing other tabs will not lose any writing already saved to this browser; do that, then check again.";

/**
 * Copy for the outcome where the destroy refused to run because local writing
 * is still queued. It has to say two separate things the other two messages do
 * not: nothing was deleted, and the writing that stopped it cannot be synced
 * from here because the session is already gone.
 */
export const DEVICE_UNSYNCED_NOT_CLEARED_MESSAGE =
  "Nothing was deleted. Writing saved on this device — most likely in another tab — has not reached the server, and you are already signed out, so it cannot be synced from here. Sign in again, let it sync, then clear this device.";

/**
 * The same refusal for the other reason it can happen: the queue could not be
 * read at all, so we do not know whether anything is unsynced and fail closed.
 *
 * It needs its own copy because the instruction differs. "Sign in again and let
 * it sync" is not actionable when the browser will not let the app read the
 * queue in the first place — that user's only route to a clean device is the
 * browser's own site-data control, so the message says so.
 */
export const DEVICE_QUEUE_UNREADABLE_MESSAGE =
  "Nothing was deleted. This browser would not let the app read its own list of unsynced writing, so clearing could have destroyed writing that never reached the server. If you need this device clean now, clear this site's data in your browser settings.";

/**
 * Copy for the outcome where this browser has no Web Locks API at all, so
 * clearing refused to start rather than delete without any way to hold other
 * tabs' writers off — see DeviceClearCoordinationUnsupportedError.
 */
export const DEVICE_COORDINATION_UNSUPPORTED_MESSAGE =
  "Nothing was deleted. This browser cannot coordinate with other tabs that might have this app open, so an automated clear here is not safe. Close every other tab and window with this app open, then clear this site's data in your browser settings.";

/**
 * Copy for a warning recovered from a previous visit. The user is signed in
 * again by the time they read it, so it neither claims they are signed out nor
 * claims to know the device's current state: an unknown-outcome delete really
 * may have completed in the background after the page was closed.
 */
export const DEVICE_RESIDUE_MESSAGE =
  "An earlier attempt to clear this device did not finish, so this browser may still hold notes and offline Bible data from that session. It may also have finished in the background afterwards — this warning cannot tell which. Clearing this device again settles it, and so does clearing this site's data in your browser settings.";

/** Which not-cleared outcome a device was left in. Never any user content. */
export type DeviceNotClearedReason =
  | "unknown"
  | "incomplete"
  | "unsynced"
  | "unsupported";

/**
 * The reason to persist for a failure, or null when nothing local was touched
 * and there is therefore nothing to warn about later.
 *
 * Separate from describeClearFailure() rather than a field on ClearFailureView
 * because that view is the render contract and is asserted whole by tests; the
 * warning that outlives the page is a different concern with a different
 * lifetime.
 */
export function notClearedReasonFor(
  failure: DeviceClearFailure,
): DeviceNotClearedReason | null {
  if (!failure.signedOut) return null;
  if (failure.cause instanceof DeviceClearCoordinationUnsupportedError)
    return "unsupported";
  if (failure.cause instanceof DeviceClearUnsyncedError) return "unsynced";
  if (failure.cause instanceof DeviceClearUnknownError) return "unknown";
  return "incomplete";
}

export function messageForNotClearedReason(
  reason: DeviceNotClearedReason,
): string {
  if (reason === "unknown") return DEVICE_CLEAR_UNKNOWN_MESSAGE;
  if (reason === "unsynced") return DEVICE_UNSYNCED_NOT_CLEARED_MESSAGE;
  if (reason === "unsupported") return DEVICE_COORDINATION_UNSUPPORTED_MESSAGE;
  return DEVICE_NOT_CLEARED_MESSAGE;
}

/**
 * Persist the shared-device warning.
 *
 * React state was the only record of it, so a reload, a crash, or a mobile tab
 * discard threw away the one signal that an unscoped vault is still resident —
 * and the reload sends the user to /sign-in, where they are told nothing.
 *
 * ORDERING: call this only AFTER a destroy attempt has already run its
 * localStorage sweep. The key sits under LOCAL_KEY_PREFIX, so a clear that
 * succeeds removes it, and a clear that fails re-writes it here afterwards.
 */
export function rememberDeviceNotCleared(reason: DeviceNotClearedReason): void {
  try {
    globalThis.localStorage?.setItem(DEVICE_NOT_CLEARED_KEY, reason);
  } catch {
    // Private-browsing quota states throw on write. A warning we cannot store
    // is not worth failing a flow over.
  }
  notifyDeviceNotCleared();
}

export function readDeviceNotCleared(): DeviceNotClearedReason | null {
  try {
    const value = globalThis.localStorage?.getItem(DEVICE_NOT_CLEARED_KEY);
    return value === "unknown" ||
      value === "incomplete" ||
      value === "unsynced" ||
      value === "unsupported"
      ? value
      : null;
  } catch {
    return null;
  }
}

export function forgetDeviceNotCleared(): void {
  try {
    globalThis.localStorage?.removeItem(DEVICE_NOT_CLEARED_KEY);
  } catch {
    // Same as above.
  }
  notifyDeviceNotCleared();
}

/**
 * There is no localStorage on the server, so the flag is always absent there.
 * Named rather than inlined so useSyncExternalStore gets a stable reference.
 */
export function readDeviceNotClearedOnServer(): DeviceNotClearedReason | null {
  return null;
}

const notClearedListeners = new Set<() => void>();

function notifyDeviceNotCleared(): void {
  for (const listener of notClearedListeners) listener();
}

/**
 * Subscription half of the useSyncExternalStore contract.
 *
 * The flag is external state (localStorage), not React state — which was the
 * whole defect: reading it once into `useState` inside an effect is both a
 * cascading-render smell and blind to the two ways it changes underneath a
 * mounted page. Both are covered here: `storage` fires when ANOTHER tab's clear
 * attempt fails or succeeds, and notifyDeviceNotCleared() covers this tab's own
 * writes, which never raise `storage` events for their own window.
 */
export function subscribeDeviceNotCleared(onChange: () => void): () => void {
  notClearedListeners.add(onChange);
  const onStorage = (event: Event) => {
    const key = (event as StorageEvent).key;
    // A null key is the whole store being cleared, which includes this flag.
    if (key === null || key === DEVICE_NOT_CLEARED_KEY) onChange();
  };
  globalThis.addEventListener?.("storage", onStorage);
  return () => {
    notClearedListeners.delete(onChange);
    globalThis.removeEventListener?.("storage", onStorage);
  };
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
  // Checked before the unknown branch because it is a stronger statement: the
  // destroy never started, so this outcome is settled, not indeterminate.
  if (failure.cause instanceof DeviceClearCoordinationUnsupportedError) {
    return {
      state: "not-cleared",
      unknown: false,
      canRetry: true,
      message: DEVICE_COORDINATION_UNSUPPORTED_MESSAGE,
    };
  }
  if (failure.cause instanceof DeviceClearUnsyncedError) {
    return {
      state: "not-cleared",
      unknown: false,
      canRetry: true,
      // Two different facts refuse the destroy, and they call for two different
      // next moves. `unknown` stays false for both: the destroy provably never
      // started, which is settled knowledge even when the queue is not.
      message:
        failure.cause.pending === null
          ? DEVICE_QUEUE_UNREADABLE_MESSAGE
          : DEVICE_UNSYNCED_NOT_CLEARED_MESSAGE,
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
 * Export success copy — and the exact limit of what this flow can prove.
 *
 * fetchCurrentArchive() re-reads THIS device's queue, so it can prove no local
 * write was left out of the archive. It cannot prove the archive is current
 * against the account: a write another device saved and synced AFTER the server
 * finished building it is absent while the local queue is legitimately empty,
 * and nothing in the response carries the watermark the server built from. The
 * earlier wording ("everything synced a moment ago") asserted exactly that
 * account-wide currency, which no code here establishes.
 *
 * A real claim needs /api/export to return its build watermark and this client
 * to compare it — a server change outside this task's owned paths. Until then
 * the copy is narrowed to the device-scoped fact the recheck does establish.
 */
export const EXPORT_DOWNLOADED_MESSAGE =
  "Export downloaded — it includes everything this device had synced when the archive was built.";

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
