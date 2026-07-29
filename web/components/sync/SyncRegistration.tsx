"use client";

import { useEffect } from "react";

import { installOnlineSync, syncNow } from "@/lib/sync/client";

export function SyncRegistration() {
  useEffect(() => {
    if (navigator.onLine) {
      void syncNow().catch(() => {
        // Pending local operations remain queued. Feature surfaces show their
        // own actionable state when a user-initiated sync cannot complete.
      });
    }
    return installOnlineSync(() => {
      // The next online event or user write retries the preserved queue.
    });
  }, []);

  return null;
}
