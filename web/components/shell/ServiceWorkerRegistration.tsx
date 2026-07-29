"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/offline/registerServiceWorker";

/** Mounted once in the root layout. Renders nothing. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    registerServiceWorker();
  }, []);
  return null;
}
