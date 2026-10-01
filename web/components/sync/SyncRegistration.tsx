"use client";

import { useEffect } from "react";

import { installBackgroundSyncV2, installOnlineSync, syncNow } from "@/lib/sync/client";
import { StudyConflictNotice } from "@/components/sync/StudyConflictNotice";
import { SyncStatusNotice } from "@/components/sync/SyncStatusNotice";

/**
 * SYNCFLUSH-001 — this is the one place `installBackgroundSyncV2` is
 * mounted (New risk #1 in design/OPEN_QUESTIONS_AUDIT_2026-09-25.md: before
 * this task, nothing ever called `installOnlineSyncV2`/`syncNowV2` outside
 * `StudyEntry.tsx`'s "Start a study" tap, so claims/applications/
 * connections/teaching drafts written anywhere else in the workspace sat in
 * `syncQueueV2` indefinitely). It runs alongside the pre-existing v1
 * registration below, unchanged, and renders `SyncStatusNotice` — null
 * unless something is actually parked or has been pending a long time (see
 * that component).
 */
export function SyncRegistration() {
  useEffect(() => {
    if (navigator.onLine) {
      void syncNow().catch(() => {
        // Pending local operations remain queued. Feature surfaces show their
        // own actionable state when a user-initiated sync cannot complete.
      });
    }
    const stopV1 = installOnlineSync(() => {
      // The next online event or user write retries the preserved queue.
    });

    const backgroundV2 = installBackgroundSyncV2(() => {
      // Network failures retry in the background. Revision conflicts are
      // preserved for explicit learner review in StudyConflictNotice.
    });

    return () => {
      stopV1();
      backgroundV2.stop();
    };
  }, []);

  return <><SyncStatusNotice /><StudyConflictNotice /></>;
}
