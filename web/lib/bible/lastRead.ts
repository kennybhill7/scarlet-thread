/**
 * Where you left off reading, and which version/mode you had open. Plain
 * localStorage, not the sync engine — this is a UI convenience ("open the
 * app, land on today's chapter"), not study content, so it doesn't need to
 * survive a device switch and has no business in lib/sync (Track B's file).
 * Cross-device "resume reading" can graduate into readingProgress later if
 * it turns out to matter.
 */

import type { VersionId } from "@/lib/contracts";

const KEY = "bible-brain:last-read";

interface LastRead {
  book: number;
  chapter: number;
  version: VersionId;
  parallel: boolean;
}

const DEFAULT: LastRead = { book: 1, chapter: 1, version: "BSB", parallel: false };

// --- Validation (A-038) -----------------------------------------------------
//
// getLastRead() used to spread `JSON.parse(raw)` straight over DEFAULT with
// no checks at all -- a corrupted or hand-edited localStorage value
// (book: 999, chapter: -5, version: "XYZ", parallel: "yes") passed straight
// through, which could drive an invalid /read/[book]/[chapter] route or an
// unknown version lookup downstream. sanitizeLastRead() below validates each
// field independently and falls back to DEFAULT for *that field only* --
// one bad field (e.g. a garbage version) no longer invalidates an otherwise
// good book/chapter, which the old all-or-nothing spread would not have
// preserved either (it accepted the whole bad object).

function isValidBook(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 66;
}

function isValidChapter(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * Exhaustive by construction against lib/contracts.ts's real VersionId
 * union: if a version is ever added/removed there, this object literal
 * fails to typecheck until updated, so this list cannot silently drift from
 * the one Track A actually ships (the task's own instruction: check
 * lib/contracts.ts for the real list, don't hardcode a guessed one).
 */
const KNOWN_VERSION_IDS: Record<VersionId, true> = {
  BSB: true,
  KJV: true,
  ASV: true,
  YLT: true,
  SBL: true,
};

function isValidVersion(value: unknown): value is VersionId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(KNOWN_VERSION_IDS, value);
}

function isValidParallel(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/**
 * Pure -- no localStorage/JSON.parse -- so tests/last-read.test.ts can feed
 * it every malformed shape directly (out-of-range book, negative chapter,
 * unknown version string, non-boolean parallel) with no DOM required.
 */
export function sanitizeLastRead(parsed: unknown): LastRead {
  const candidate = (
    parsed && typeof parsed === "object" ? parsed : {}
  ) as Partial<Record<keyof LastRead, unknown>>;
  return {
    book: isValidBook(candidate.book) ? candidate.book : DEFAULT.book,
    chapter: isValidChapter(candidate.chapter) ? candidate.chapter : DEFAULT.chapter,
    version: isValidVersion(candidate.version) ? candidate.version : DEFAULT.version,
    parallel: isValidParallel(candidate.parallel) ? candidate.parallel : DEFAULT.parallel,
  };
}

export function getLastRead(): LastRead {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    return sanitizeLastRead(JSON.parse(raw));
  } catch {
    return DEFAULT;
  }
}

const lastReadListeners = new Set<() => void>();

function notifyLastRead(): void {
  for (const listener of lastReadListeners) listener();
}

export function setLastRead(value: Partial<LastRead>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...getLastRead(), ...value }));
  } catch {
    // Storage can throw in private-browsing edge cases. Losing "resume here"
    // is not worth surfacing an error over.
  }
  notifyLastRead();
}

// --- Hydration-safe external store (A-038) ----------------------------------
//
// BookPicker.tsx used to call getLastRead() directly during render, which
// reads localStorage -- invisible to the server, so the server's pass and
// the client's first pass could disagree on the "Continue reading" target
// and React would warn about (and patch over) a hydration mismatch.
//
// This is not the pre-paint-critical case lib/theme.ts's inline bootstrap
// script solves: a link briefly pointing at the DEFAULT chapter until
// hydration completes, then correcting, is not the same user-visible cost
// as a full page flash of the wrong theme colors, so a blocking <head>
// script is more machinery than this needs. It IS the same shape
// DeviceSessionControls.tsx's `residue` pattern already solves for
// lib/sync/clear.ts's not-cleared flag -- another render-time,
// non-flash-critical localStorage read -- via useSyncExternalStore with a
// server snapshot that matches what the server actually rendered. Following
// that established pattern here rather than inventing a third one (or a
// bare useEffect+setState, which react-hooks/set-state-in-effect already
// flags elsewhere in this repo for the identical cascading-render reason
// lib/theme.ts's own comment on ThemePicker explains).

/** useSyncExternalStore's client getSnapshot. */
export function readLastReadSnapshot(): LastRead {
  return getLastRead();
}

/** useSyncExternalStore's getServerSnapshot -- matches what the server rendered (DEFAULT). */
export function readLastReadServerSnapshot(): LastRead {
  return DEFAULT;
}

/**
 * Named rather than inlined so useSyncExternalStore gets a stable reference
 * (same rationale as lib/sync/clear.ts's subscribeDeviceNotCleared). Covers
 * both this tab's own writes (setLastRead's notifyLastRead() call above --
 * the native `storage` event never fires in the tab that made the write)
 * and other tabs' writes (the `storage` event below).
 */
export function subscribeLastRead(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  lastReadListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    lastReadListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}
