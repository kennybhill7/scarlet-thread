"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { BibleIndex, BookData, VersionId } from "@/lib/contracts";
import { loadBook, loadIndex } from "@/lib/bible/loader";
import { buildPassageCanon, type PassageCanon } from "@/lib/bible/passageCanon";

/**
 * RANGEPICKER-002 — the browser-side source of a `PassageCanon` (what
 * `components/ui/PassagePicker.tsx` needs) for screens that cannot receive one
 * from a server component.
 *
 * `PassageCanon` is derived from the real shipped corpus: `public/bible/
 * index.json` plus each of the 66 book files (`public/bible/BSB/{n}.json`,
 * ~4 MB in total — the verse counts live only inside the book files). This
 * module never fetches those itself: it goes through `lib/bible/loader.ts`
 * (`loadIndex`, `loadBook`), so it inherits, unchanged, that file's in-memory
 * memo, the `bible-brain-scripture-v1` Cache API bucket (a book the reader
 * already opened, or "make available offline" already warmed, costs no network
 * here), the network-first / revision-reconciling `index.json` path, and its
 * typed `ScriptureUnavailableError`. On top of that, this file adds ONE more
 * layer: the built canon itself is cached in module scope, so the 66-book
 * pass runs at most once per page lifetime (and is shared by every consumer).
 *
 * Loading is LAZY: nothing is fetched at import time. `usePassageCanon` starts
 * the load on first need (a component that actually renders a picker, and
 * only when `enabled`). Concurrent callers share one in-flight promise; a
 * failure is not memoised (the store returns to a retryable `error` state and
 * `retry()` runs the whole pass again — books that did load are already in the
 * loader's memo/cache, so a retry only re-fetches what is missing).
 *
 * The state machine is `idle -> loading -> ready | error` (error -> loading on
 * retry). `createPassageCanonStore` is the injectable, framework-free core (so
 * tests can drive it with fake `loadIndex`/`loadBook`); `usePassageCanon` is a
 * thin `useSyncExternalStore` binding over it.
 */

/** Shown when the corpus metadata cannot be loaded. Exported so UI and tests share one string. */
export const PASSAGE_CANON_ERROR_MESSAGE = "Couldn’t load the Bible index — check your connection";

export type PassageCanonState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; canon: PassageCanon }
  | { status: "error"; message: string; cause: unknown };

export interface PassageCanonDeps {
  loadIndex: () => Promise<BibleIndex>;
  loadBook: (version: VersionId, book: number) => Promise<BookData>;
  /** Which translation's files supply the verse counts. Versification is shared; default "BSB" (the shipped default). */
  version?: VersionId;
  /** Max book files in flight at once. Default 6 (browsers cap per-origin connections anyway). */
  concurrency?: number;
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

export const DEFAULT_CANON_VERSION: VersionId = "BSB";
const DEFAULT_CONCURRENCY = 6;

/** Runs `worker` over `items` with at most `limit` in flight; stops scheduling after the first failure. */
async function mapLimited<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  async function run(): Promise<void> {
    while (!failed && next < items.length) {
      const i = next;
      next += 1;
      try {
        results[i] = await worker(items[i]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => run());
  await Promise.all(lanes);
  return results;
}

export function createPassageCanonStore(deps: PassageCanonDeps): PassageCanonStore {
  const version = deps.version ?? DEFAULT_CANON_VERSION;
  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;
  let state: PassageCanonState = IDLE;
  let inflight: Promise<PassageCanon> | null = null;
  const listeners = new Set<() => void>();

  function set(next: PassageCanonState): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  async function build(): Promise<PassageCanon> {
    const index = await deps.loadIndex();
    const data = new Map<number, BookData>();
    await mapLimited(index.books, concurrency, async (meta) => {
      data.set(meta.n, await deps.loadBook(version, meta.n));
    });
    // Fails closed on any missing book / chapter-count disagreement (see passageCanon.ts).
    return buildPassageCanon(index.books, (n) => data.get(n));
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
  defaultStore ??= createPassageCanonStore({ loadIndex, loadBook });
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
