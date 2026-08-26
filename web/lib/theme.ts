/**
 * The reading theme: a persisted, three-way user preference (System /
 * Midnight / Parchment) for the PAGE surface only — never the always-dark
 * app shell ("The Climb"). See app/globals.css's top-of-file comment for the
 * SHELL-vs-PAGE architecture this preference lives inside.
 *
 * Naming reconciliation (THEMESYSTEM-001): app/layout.tsx used to hardcode
 * data-reading="parchment" with no CSS target, while globals.css defined an
 * unreachable [data-reading="night"] block. The exact mapping now in force:
 *
 *   stored preference   data-reading actually set on <html>
 *   ------------------  -----------------------------------
 *   "parchment"         "parchment"  (the pre-existing :root default block)
 *   "midnight"          "midnight"   (was [data-reading="night"], renamed)
 *   "system"            resolved live from matchMedia — NEVER appears as
 *                        the attribute's own value; resolveReading() below
 *                        turns it into "midnight" or "parchment" before it
 *                        ever reaches the DOM.
 *
 * This module is pure logic + string generation only — no DOM access except
 * inside the small, explicitly-guarded helpers at the bottom that touch
 * `window`/`document`/`Storage`. The two functions the task's mutation-proof
 * requirement targets (resolveReading, contrastRatio) take plain arguments
 * and return plain values, so tests/theme.test.ts can call them with no DOM
 * at all.
 */

// --- Preference & resolution -------------------------------------------

/** What the learner picks, and what is persisted verbatim. */
export type ThemePreference = "system" | "midnight" | "parchment";

/**
 * What data-reading is actually set to on <html>. "system" never appears
 * here — see the mapping table above.
 */
export type ResolvedReading = "midnight" | "parchment";

export const THEME_PREFERENCES: readonly ThemePreference[] = [
  "system",
  "midnight",
  "parchment",
];

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === "string" &&
    (THEME_PREFERENCES as readonly string[]).includes(value)
  );
}

/**
 * Preference -> resolved data-reading value. The ONE function every caller
 * (the pre-paint bootstrap script, ThemePicker, and its OS-change listener)
 * goes through, so none of them can disagree about what "system" means.
 *
 *   "midnight"/"parchment" pass straight through (explicit user choice).
 *   "system" defers to the OS: prefersDark true -> "midnight", false -> "parchment".
 */
export function resolveReading(
  preference: ThemePreference,
  prefersDark: boolean,
): ResolvedReading {
  if (preference === "midnight") return "midnight";
  if (preference === "parchment") return "parchment";
  return prefersDark ? "midnight" : "parchment";
}

/** The matchMedia query string used everywhere "system" needs the OS's answer. */
export const PREFERS_DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

// --- Storage --------------------------------------------------------------

/**
 * Same key-naming convention as lib/bible/lastRead.ts's `bible-brain:*`
 * keys and lib/sync/clear.ts's LAST_READ_KEY constant.
 */
export const THEME_STORAGE_KEY = "bible-brain:theme";

/**
 * Storage is accepted as a parameter (rather than reached for via a bare
 * `window.localStorage` reference inside this function, the way
 * lib/bible/lastRead.ts does it) so this stays callable from a plain node:test
 * run with a minimal in-memory stub — no DOM/jsdom dependency. Real call
 * sites pass `window.localStorage`.
 */
export function readStoredThemePreference(
  storage: Pick<Storage, "getItem"> | undefined,
): ThemePreference {
  if (!storage) return "system";
  try {
    const raw = storage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : "system";
  } catch {
    // Storage can throw in private-browsing edge cases (same rationale as
    // lib/bible/lastRead.ts). Falling back to "system" is a safe default:
    // it still resolves to a real, accessible-contrast theme.
    return "system";
  }
}

export function writeThemePreference(
  storage: Pick<Storage, "setItem"> | undefined,
  preference: ThemePreference,
): void {
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Losing the persisted preference for this write is not worth surfacing
    // an error over — same tradeoff lib/bible/lastRead.ts makes.
  }
}

// --- Pre-paint bootstrap script --------------------------------------------

/**
 * Returns the source of a small, synchronous IIFE meant for a blocking
 * <script> in <head> (see app/layout.tsx), so data-reading is correct on
 * <html> BEFORE the browser paints — no flash of the wrong theme, and no
 * dependency on React state for that first paint.
 *
 * This has to be hand-written JS text: it runs before any bundle loads, so
 * it cannot literally import or call resolveReading(). What it CAN share
 * with the rest of this module — and does — is the storage key and the
 * media-query string, both interpolated from the same constants exercised
 * by tests/theme.test.ts, so the key/query cannot silently typo-drift
 * between the bootstrap script and the rest of this file. The three-branch
 * shape below (parchment / midnight / system-via-matchMedia) is the same
 * shape as resolveReading() and is asserted against literal reference
 * strings in the test file.
 *
 * Fails closed to "parchment" on any error (storage blocked, matchMedia
 * unavailable, etc.) — the same default app/layout.tsx already hardcoded
 * before this task.
 */
export function getThemeBootstrapScript(): string {
  const key = JSON.stringify(THEME_STORAGE_KEY);
  const query = JSON.stringify(PREFERS_DARK_MEDIA_QUERY);
  return (
    "(function(){try{" +
    `var k=${key};` +
    "var v=window.localStorage.getItem(k);" +
    'var pref=(v==="midnight"||v==="parchment"||v==="system")?v:"system";' +
    "var reading=pref;" +
    'if(pref==="system"){' +
    `reading=window.matchMedia(${query}).matches?"midnight":"parchment";` +
    "}" +
    'document.documentElement.setAttribute("data-reading",reading);' +
    "}catch(e){" +
    'document.documentElement.setAttribute("data-reading","parchment");' +
    "}})();"
  );
}

// --- Live client-side application ------------------------------------------

/**
 * Sets data-reading on <html> for the given preference, resolving "system"
 * against the live OS value. Used by ThemePicker on every choice and on
 * every OS prefers-color-scheme change while "system" is selected. Guarded
 * so it is a no-op outside a browser (defensive; ThemePicker is
 * client-only, but this keeps the function safe to import anywhere).
 */
export function applyThemePreference(preference: ThemePreference): void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }
  const prefersDark = window.matchMedia(PREFERS_DARK_MEDIA_QUERY).matches;
  document.documentElement.setAttribute(
    "data-reading",
    resolveReading(preference, prefersDark),
  );
}

// --- ThemePicker's external store (useSyncExternalStore) -------------------
//
// ThemePicker.tsx renders the SAME value on the server pass and the first
// client pass (getServerSnapshot below), then useSyncExternalStore corrects
// it to the real stored value immediately — no setState-in-an-effect, which
// is both a lint error in this repo (react-hooks/set-state-in-effect) and
// the same hydration-mismatch hazard DeviceSessionControls.tsx's `residue`
// documents solving the same way for its own localStorage read.
//
// The native `storage` event only fires in OTHER tabs, never the tab that
// made the write, so a plain writeThemePreference() alone would leave this
// tab's own radio selection stale after a click. commitThemePreference
// below is the one write path ThemePicker uses; it notifies same-tab
// subscribers synchronously in addition to persisting.

type ThemeChangeListener = () => void;
const themeChangeListeners = new Set<ThemeChangeListener>();

export function subscribeThemePreferenceChange(
  listener: ThemeChangeListener,
): () => void {
  if (typeof window === "undefined") return () => {};
  themeChangeListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    themeChangeListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** useSyncExternalStore's client getSnapshot. */
export function readThemePreferenceSnapshot(): ThemePreference {
  return readStoredThemePreference(
    typeof window === "undefined" ? undefined : window.localStorage,
  );
}

/** useSyncExternalStore's getServerSnapshot — matches the pre-paint default. */
export function readThemePreferenceServerSnapshot(): ThemePreference {
  return "system";
}

/**
 * Persists a preference AND notifies same-tab useSyncExternalStore
 * subscribers synchronously (see above). This is the write path
 * ThemePicker.tsx calls, not writeThemePreference directly.
 */
export function commitThemePreference(
  storage: Pick<Storage, "setItem"> | undefined,
  preference: ThemePreference,
): void {
  writeThemePreference(storage, preference);
  themeChangeListeners.forEach((listener) => listener());
}

// --- Contrast math (WCAG 2.x) -----------------------------------------------

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parses a 6-digit "#rrggbb" (leading "#" optional) into 0-255 channels. */
export function hexToRgb(hex: string): Rgb {
  const clean = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    throw new Error(`hexToRgb: expected a 6-digit hex color, got "${hex}"`);
  }
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

/** WCAG 2.x sRGB channel linearization, https://www.w3.org/TR/WCAG21/#dfn-relative-luminance */
function linearizeSrgbChannel(channel8bit: number): number {
  const c = channel8bit / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance of a hex color, in [0, 1]. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * linearizeSrgbChannel(r) +
    0.7152 * linearizeSrgbChannel(g) +
    0.0722 * linearizeSrgbChannel(b)
  );
}

/**
 * WCAG 2.x contrast ratio between two hex colors, order-independent. Range
 * is [1, 21] — 1 for identical colors, 21 for pure black against pure
 * white. https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

export const AA_NORMAL_TEXT_MIN_RATIO = 4.5;
export const AA_LARGE_TEXT_MIN_RATIO = 3.0;

/** WCAG AA pass/fail for a given ratio. Normal text needs 4.5:1, large text/UI needs 3:1. */
export function meetsAA(ratio: number, isLargeText = false): boolean {
  return ratio >= (isLargeText ? AA_LARGE_TEXT_MIN_RATIO : AA_NORMAL_TEXT_MIN_RATIO);
}

// --- Token snapshot for the contrast proof ---------------------------------

/**
 * Hand-transcribed from app/globals.css. These are NOT parsed out of the
 * CSS file at test time — there is no CSS parser in this project's
 * dependencies — so they are a snapshot that must be kept byte-identical to
 * globals.css by hand. tests/theme.test.ts pins each value against the CSS
 * file's own text (a substring match) specifically so this snapshot cannot
 * silently drift out of sync with the real stylesheet.
 *
 * --page-muted's parchment value below is #686e69, NOT the #8a938c that
 * shipped before this task: #8a938c only reached a 2.78:1 ratio against
 * --page-bg (#f3f0e8), which fails WCAG AA (needs 4.5:1 — --page-muted is
 * used at 10.5-11.5px, i.e. normal-size text, in Field.module.css and
 * claim-composer.module.css) and even fails the relaxed 3:1 large-text/UI
 * floor. Fixed in globals.css as part of this task; see the commit message.
 */
export const PARCHMENT_BODY_TOKENS = {
  pageBg: "#f3f0e8",
  pageInk: "#233029",
  pageMuted: "#686e69",
} as const;

export const MIDNIGHT_BODY_TOKENS = {
  pageBg: "#10161d",
  pageInk: "#e4e2da",
  pageMuted: "#7d8892",
} as const;
