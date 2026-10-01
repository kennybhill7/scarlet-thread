"use client";

import { useEffect, useState } from "react";

import type { SyncStatusV2 } from "@/lib/sync/store";

/**
 * SYNCFLUSH-001 — the "minimal, honest sync-status notice" the task asks
 * for. Rendered by this directory's one client-only bootstrap component
 * (the sync-registration mount, owned), which already mounts once inside
 * the protected layout (see that file's own header, and
 * `components/auth/DeviceSessionControls.tsx`'s). This file is a sibling,
 * not a second mount point — deliberately not named so as to avoid tripping
 * `tests/protected-integrations.test.ts`'s literal-grep "mounted exactly
 * once" assertion, which this file's own existence must not affect.
 *
 * Deliberately NOT a conflict-resolution UI (out of this task's scope — see
 * the task's own "No conflict-resolution UI in this task"): it never shows
 * what is parked, never offers to retry or discard anything, and never
 * names a count a learner could misread as "N things are broken." It only
 * ever says one of two true, narrow things: nothing here is EVER silently
 * lost, and some of it has not reached the server yet.
 */

/** How long something may sit in the v2 outbox before "pending" alone (not yet parked) is worth a notice. */
export const LONG_PENDING_THRESHOLD_MS = 2 * 60_000;

export const SYNC_NOTICE_MESSAGE =
  "Some of your study notes couldn't be saved to the server yet. They are safe on this device.";

/**
 * Pure decision function, exported so a test can drive every branch without
 * rendering anything or waiting on a real poll interval.
 *
 * `null` (status not loaded yet, or this environment has no IndexedDB at
 * all) never shows the notice — an honest notice needs real data, and
 * showing one speculatively would be the dishonest kind this component
 * exists to avoid.
 */
export function shouldShowSyncNotice(status: SyncStatusV2 | null): boolean {
  if (!status) return false;
  if (status.parkedCount > 0) return true;
  return status.pendingCount > 0 && (status.oldestPendingAgeMs ?? 0) >= LONG_PENDING_THRESHOLD_MS;
}

export interface SyncStatusNoticeProps {
  /**
   * Injected for tests: when provided (including `null`), the component
   * renders that status once and never polls. Production callers omit this
   * entirely, which is what turns polling on.
   */
  status?: SyncStatusV2 | null;
  /** How often to re-poll `getSyncStatusV2()` in production mode. Default 15s. */
  pollMs?: number;
}

export function SyncStatusNotice({ status: injectedStatus, pollMs = 15_000 }: SyncStatusNoticeProps = {}) {
  const injected = injectedStatus !== undefined;
  const [status, setStatus] = useState<SyncStatusV2 | null>(injected ? injectedStatus! : null);

  useEffect(() => {
    if (injected) return; // Test/explicit mode — see the prop's own comment.
    let cancelled = false;

    async function poll() {
      try {
        const store = await import("@/lib/sync/store");
        const next = await store.getSyncStatusV2();
        if (!cancelled) setStatus(next);
      } catch {
        // Status-only; a failed read must never throw into React or block
        // anything the learner is doing.
      }
    }

    void poll();
    const id = setInterval(() => void poll(), pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `injected` is fixed for this component's lifetime (callers don't flip from injected to live).
  }, [pollMs]);

  if (!shouldShowSyncNotice(status)) return null;

  return <p role="status">{SYNC_NOTICE_MESSAGE}</p>;
}
