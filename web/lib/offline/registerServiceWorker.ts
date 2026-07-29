"use client";

/**
 * Registers /public/sw.js. Called once from the root layout so it's active
 * before the reader needs it, but registration itself is fire-and-forget --
 * a failure here (unsupported browser, blocked by a privacy setting) should
 * never prevent the app from working online.
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline-after-first-visit is a nice-to-have, not a requirement --
      // scripture caching in lib/bible/loader.ts works independently of this.
    });
  });
}
