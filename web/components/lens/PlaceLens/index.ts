"use client";

import dynamic from "next/dynamic";

/**
 * PLACELENS-001 — the lazy-loaded entry point a host page imports
 * (plan §C.4: "`PlaceLens` is a `next/dynamic` client chunk loaded on first
 * open"). `ssr: false` because the real `PlaceLens` component calls
 * `useGlobeRotation`'s pointer/keyboard handlers and `dataLoader.ts`'s
 * `caches.open` at module-interaction time — same reasoning
 * `DeviceSessionControls.tsx` gives for its own `ssr: false` dynamic import
 * (a browser-only API reached from a Server Component's render would throw
 * during prerendering).
 *
 * A host page that already is a Client Component may instead import
 * `{ PlaceLens }` from `./PlaceLens` directly and wrap it in its own
 * `next/dynamic` call if it wants different loading UI — this default export
 * is the minimal, no-setup path.
 */
const PlaceLens = dynamic(() => import("./PlaceLens").then((mod) => mod.PlaceLens), {
  ssr: false,
  loading: () => null,
});

export default PlaceLens;
export type { PlaceLensProps } from "./PlaceLens";
