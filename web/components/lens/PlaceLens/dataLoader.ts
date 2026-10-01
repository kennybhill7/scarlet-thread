/**
 * PLACELENS-001 — offline-capable fetch for `public/map/*`, reusing the SAME
 * Cache API pattern `lib/bible/loader.ts`'s `fetchWithCache` / `warmVersion`
 * and `lib/bible/passageCanonClient.ts` establish for the Bible corpus and
 * `canon.json` (read as precedent per the task brief), in this module's own
 * bucket rather than by importing `fetchWithCache` directly:
 *
 *   - Map assets (`land-110m.json`, `places.json`) have no `index.json`-style
 *     revision marker the way the Bible corpus does (CODEX_AUDIT A-020) —
 *     regenerating `places.json` (re-running the generator script by hand) is
 *     a rare, manual, offline-irrelevant event, not a thing a running app
 *     ever needs to detect mid-session. So this intentionally keeps the
 *     SIMPLER half of `loader.ts`'s pattern (cache-first, best-effort
 *     `cache.put`, a typed "offline and not cached" error, nothing ever
 *     throws from a failed cache write) and leaves out the revision
 *     reconciliation machinery that exists only to serve the Bible's actual
 *     revision scheme.
 *   - A separate cache bucket (`place-lens-v1`) keeps this lens's two small
 *     files out of `bible-brain-scripture-v1`, whose exact contents and name
 *     `tests/versemap-offline.test.ts`/`tests/offline-nav.test.ts` and
 *     `public/sw.js`'s own hardcoded literal already assert byte-for-byte
 *     (see `loader.ts`'s own header) — paths outside this task's ownership
 *     that must not need touching just because this lens shipped.
 *
 * Both entry points are memoised in-module (one fetch per page lifetime,
 * same discipline as `loader.ts`'s `indexMemo`/`bookMemo`), and both are
 * "use client"-safe: `hasCacheApi()` guards every `caches.*` call so this
 * degrades to a plain `fetch()` in any environment without Cache Storage
 * (a dev server-side render, or a browser with it disabled) instead of
 * throwing.
 */
import type { PlaceLensDataset } from "./types";

export const PLACE_LENS_CACHE_NAME = "place-lens-v1";
export const PLACES_JSON_PATH = "/map/places.json";
export const LAND_TOPOLOGY_PATH = "/map/land-110m.json";

export class MapAssetUnavailableError extends Error {
  constructor(
    public readonly path: string,
    cause: unknown,
  ) {
    super(`Could not load ${path} — offline and not yet cached.`);
    this.name = "MapAssetUnavailableError";
    this.cause = cause;
  }
}

function hasCacheApi(): boolean {
  return typeof caches !== "undefined";
}

/** Exported for `warmPlaceLensAssets` (Settings "Download maps for offline") and tests. */
export async function fetchMapAssetWithCache(path: string): Promise<Response> {
  if (hasCacheApi()) {
    const cache = await caches.open(PLACE_LENS_CACHE_NAME);
    const cached = await cache.match(path);
    if (cached) return cached;

    let response: Response;
    try {
      response = await fetch(path);
    } catch (error) {
      throw new MapAssetUnavailableError(path, error);
    }
    if (response.ok) {
      // Best-effort: a quota-exceeded/private-browsing write must not make an
      // otherwise-successful network read fail (same A-002 discipline as
      // loader.ts's fetchWithCache).
      cache.put(path, response.clone()).catch(() => {});
    }
    return response;
  }

  try {
    return await fetch(path);
  } catch (error) {
    throw new MapAssetUnavailableError(path, error);
  }
}

async function loadJsonWithCache<T>(path: string): Promise<T> {
  const response = await fetchMapAssetWithCache(path);
  if (!response.ok) {
    throw new MapAssetUnavailableError(path, new Error(`HTTP ${response.status}`));
  }
  return (await response.json()) as T;
}

let placesMemo: Promise<PlaceLensDataset> | null = null;

/** The compiled place dataset (`public/map/places.json`). Fetched once per page lifetime. */
export function loadPlaceLensDataset(): Promise<PlaceLensDataset> {
  placesMemo ??= loadJsonWithCache<PlaceLensDataset>(PLACES_JSON_PATH).catch((error: unknown) => {
    placesMemo = null; // don't memoise a failure — a retry should actually retry
    throw error;
  });
  return placesMemo;
}

let landMemo: Promise<unknown> | null = null;

/** The Natural Earth 110m land TopoJSON (`public/map/land-110m.json`). Fetched once per page lifetime. */
export function loadLandTopology(): Promise<unknown> {
  landMemo ??= loadJsonWithCache<unknown>(LAND_TOPOLOGY_PATH).catch((error: unknown) => {
    landMemo = null;
    throw error;
  });
  return landMemo;
}

/** @internal test-only: clears both memos so a test's fresh "session" re-fetches. */
export function __resetPlaceLensMemosForTests(): void {
  placesMemo = null;
  landMemo = null;
}

/**
 * Pre-fetches both map assets into the cache ahead of time — the Settings
 * "Download maps for offline" affordance (`OfflineDownloads.tsx`'s sibling
 * for the place layer). Resolves `{ ok: true }` on success or
 * `{ ok: false, message }` on failure, same discriminated-result shape
 * `OfflineDownloads.tsx`'s `runDownload` uses, for the same reason (CODEX_AUDIT
 * A-021: a caller must never be left with a stuck "downloading" status and no
 * way to show an error).
 */
export async function warmPlaceLensAssets(): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await Promise.all([loadPlaceLensDataset(), loadLandTopology()]);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "Download failed.";
    return { ok: false, message };
  }
}

/** True once both map assets are present in the cache (this session, or cached from a prior one). */
export async function isPlaceLensCached(): Promise<boolean> {
  if (!hasCacheApi()) return placesMemo !== null && landMemo !== null;
  const cache = await caches.open(PLACE_LENS_CACHE_NAME);
  const [places, land] = await Promise.all([cache.match(PLACES_JSON_PATH), cache.match(LAND_TOPOLOGY_PATH)]);
  return places !== undefined && land !== undefined;
}
