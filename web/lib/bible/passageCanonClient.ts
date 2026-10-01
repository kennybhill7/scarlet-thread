"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { BibleIndex } from "@/lib/contracts";
import { CANONICAL_VERSIFICATION_ID } from "@/lib/contracts/range-v1";
import { ScriptureUnavailableError, fetchWithCache, loadIndex } from "@/lib/bible/loader";
import { buildPassageCanonFromCounts, type PassageCanon } from "@/lib/bible/passageCanon";

/**
 * RANGEPICKER-002 / PICKERCANON-001 — the browser-side source of a
 * `PassageCanon` (what `components/ui/PassagePicker.tsx` needs) for screens
 * that cannot receive one from a server component.
 *
 * The canon is `public/bible/index.json` (names, abbreviations, chapter
 * counts) plus `public/bible/canon.json` (~4 KB: per-book, per-chapter verse
 * counts, generated from the shipped BSB files by `npm run bible:canon` and
 * pinned to them by tests/canon-counts-drift.test.ts). Two small fetches — it
 * used to be all 66 book files (~4 MB).
 *
 * `index.json` goes through `lib/bible/loader.ts`'s `loadIndex` (memo,
 * network-first, revision reconciliation of the `bible-brain-scripture-v1`
 * Cache API bucket). `canon.json` goes through that same loader's exported
 * `fetchWithCache` — the very path and bucket `versemap.json` uses — so it is
 * cached-forever within a corpus revision and works offline after first load.
 * The index is loaded FIRST and the two are not raced: a revision change is
 * detected (and the bucket wiped) by the index fetch, so a stale cached
 * canon.json can never be read after a corpus rebuild has been seen.
 *
 * Fail-closed: the fetched canon.json is validated at runtime (shape,
 * versification id, exactly the index's books, chapter counts equal to the
 * index's, every verse count a positive integer) and any disagreement puts the
 * store in `error` — a picker never offers chapters/verses the corpus cannot
 * show. Known limit: a canon.json that was cached corrupt stays corrupt until
 * the bucket is wiped by a revision change (the loader does not expose
 * eviction); this errors rather than serving wrong data.
 *
 * Loading is LAZY: nothing is fetched at import time. `usePassageCanon` starts
 * the load on first need (a component that actually renders a picker, and
 * only when `enabled`). Concurrent callers share one in-flight promise; a
 * failure is not memoised (the store returns to a retryable `error` state and
 * `retry()` runs the load again). The built canon is cached in module scope,
 * so it is built at most once per page lifetime (shared by every consumer).
 *
 * The state machine is `idle -> loading -> ready | error` (error -> loading on
 * retry). `createPassageCanonStore` is the injectable, framework-free core (so
 * tests can drive it with fake loaders); `usePassageCanon` is a thin
 * `useSyncExternalStore` binding over it.
 */

/** Shown when the corpus metadata cannot be loaded. Exported so UI and tests share one string. */
export const PASSAGE_CANON_ERROR_MESSAGE = "Couldn’t load the Bible index — check your connection";

export type PassageCanonState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; canon: PassageCanon }
  | { status: "error"; message: string; cause: unknown };

export const CANON_COUNTS_PATH = "/bible/canon.json";

/** Fetches canon.json through the loader's Cache API path; returns the parsed (still unvalidated) JSON. */
export async function loadCanonCounts(): Promise<unknown> {
  const response = await fetchWithCache(CANON_COUNTS_PATH);
  if (!response.ok) {
    throw new ScriptureUnavailableError(CANON_COUNTS_PATH, new Error(`HTTP ${response.status}`));
  }
  return (await response.json()) as unknown;
}

export interface PassageCanonDeps {
  loadIndex: () => Promise<BibleIndex>;
  /** Resolves the raw parsed canon.json. Validated by the store; never trusted. */
  loadCanonCounts: () => Promise<unknown>;
}

/**
 * Validates the raw canon.json against the shipped index and returns a
 * book-number lookup. Throws (=> error state) on anything unexpected.
 */
function parseCanonCounts(raw: unknown, index: BibleIndex): (book: number) => readonly number[] | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("canon.json: not an object");
  const file = raw as Record<string, unknown>;
  if (file.versificationId !== CANONICAL_VERSIFICATION_ID) {
    throw new Error(`canon.json: versificationId ${String(file.versificationId)} is not ${CANONICAL_VERSIFICATION_ID}`);
  }
  const books = file.books;
  if (typeof books !== "object" || books === null || Array.isArray(books)) throw new Error("canon.json: books is not an object");
  const table = books as Record<string, unknown>;
  const expected = new Set(index.books.map((meta) => String(meta.n)));
  for (const key of Object.keys(table)) {
    if (!expected.has(key)) throw new Error(`canon.json: unexpected book ${key}`);
  }
  return (n) => {
    const counts = table[String(n)];
    if (counts === undefined) return undefined;
    if (!Array.isArray(counts)) throw new Error(`canon.json: book ${n} is not an array`);
    return counts as unknown[] as readonly number[]; // integer/positive checks: buildPassageCanonFromCounts
  };
}

export interface PassageCanonStore {
  getSnapshot: () => PassageCanonState;
  /** Always `idle`: the server never loads the canon, and a hydrating client must agree with it. */
  getServerSnapshot: () => PassageCanonState;
  subscribe: (listener: () => void) => () => void;
  /** Starts the load if idle/error (no-op when loading/ready). Resolves with the canon; rejects if the load failed. */
  load: () => Promise<PassageCanon>;
}

const IDLE: PassageCanonState = { status: "idle" };
const LOADING: PassageCanonState = { status: "loading" };

export function createPassageCanonStore(deps: PassageCanonDeps): PassageCanonStore {
  let state: PassageCanonState = IDLE;
  let inflight: Promise<PassageCanon> | null = null;
  const listeners = new Set<() => void>();

  function set(next: PassageCanonState): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  async function build(): Promise<PassageCanon> {
    // Sequential on purpose: loadIndex() reconciles the cache bucket against the corpus revision.
    const index = await deps.loadIndex();
    const counts = parseCanonCounts(await deps.loadCanonCounts(), index);
    // Fails closed on any missing book / chapter-count disagreement / non-positive-integer count.
    return buildPassageCanonFromCounts(index.books, counts);
  }

  function load(): Promise<PassageCanon> {
    if (state.status === "ready") return Promise.resolve(state.canon);
    if (inflight) return inflight;
    set(LOADING);
    const attempt = build().then(
      (canon) => {
        inflight = null;
        set({ status: "ready", canon });
        return canon;
      },
      (cause: unknown) => {
        inflight = null;
        set({ status: "error", message: PASSAGE_CANON_ERROR_MESSAGE, cause });
        throw cause;
      },
    );
    inflight = attempt;
    return attempt;
  }

  return {
    getSnapshot: () => state,
    getServerSnapshot: () => IDLE,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
  };
}

/** The app-wide store, backed by the real loader (memo + Cache API). Not touched until something calls `load()`. */
let defaultStore: PassageCanonStore | null = null;

export function getDefaultPassageCanonStore(): PassageCanonStore {
  defaultStore ??= createPassageCanonStore({ loadIndex, loadCanonCounts });
  return defaultStore;
}

/** @internal test-only: drops the module-scope canon so the next hook/`load()` starts from idle. */
export function __resetDefaultPassageCanonStoreForTests(): void {
  defaultStore = null;
}

export interface UsePassageCanonOptions {
  /** Start loading only when true (e.g. the section is unlocked). Default true. */
  enabled?: boolean;
  /** Test seam: inject a store. Omitted, the app-wide store is used. */
  store?: PassageCanonStore;
}

export type UsePassageCanonResult = PassageCanonState & { retry: () => void };

const noop = () => {};

/** Lazily loads (once per page lifetime) and returns the canon's state. */
export function usePassageCanon(options: UsePassageCanonOptions = {}): UsePassageCanonResult {
  const { enabled = true } = options;
  const store = options.store ?? getDefaultPassageCanonStore();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  useEffect(() => {
    if (enabled && store.getSnapshot().status === "idle") {
      store.load().catch(noop); // failure is surfaced through the `error` state
    }
  }, [enabled, store]);

  return { ...state, retry: () => void store.load().catch(noop) };
}
