import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
  AA_LARGE_TEXT_MIN_RATIO,
  AA_NORMAL_TEXT_MIN_RATIO,
  MIDNIGHT_BODY_TOKENS,
  PARCHMENT_BODY_TOKENS,
  PREFERS_DARK_MEDIA_QUERY,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  applyThemePreference,
  commitThemePreference,
  contrastRatio,
  getThemeBootstrapScript,
  hexToRgb,
  isThemePreference,
  meetsAA,
  readStoredThemePreference,
  readThemePreferenceServerSnapshot,
  readThemePreferenceSnapshot,
  resolveReading,
  subscribeThemePreferenceChange,
  writeThemePreference,
} from "@/lib/theme";

// ---------------------------------------------------------------------------
// Test-only storage stub. Not a DOM/jsdom localStorage — a plain Map behind
// the same three-method surface lib/theme.ts's storage helpers accept, which
// is the whole point of taking `Pick<Storage, ...>` there: these functions
// are callable from a bare node:test run with no DOM at all.
// ---------------------------------------------------------------------------

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

// --- Preference type guard & storage round-trip -----------------------------

test("isThemePreference accepts exactly the three real values", () => {
  assert.equal(isThemePreference("system"), true);
  assert.equal(isThemePreference("midnight"), true);
  assert.equal(isThemePreference("parchment"), true);
  assert.equal(isThemePreference("night"), false, "the old, now-dead CSS name is not a valid preference");
  assert.equal(isThemePreference("dark"), false);
  assert.equal(isThemePreference(""), false);
  assert.equal(isThemePreference(null), false);
  assert.equal(isThemePreference(undefined), false);
  assert.equal(isThemePreference(42), false);
});

test("readStoredThemePreference defaults to system when nothing is stored", () => {
  assert.equal(readStoredThemePreference(fakeStorage()), "system");
});

test("readStoredThemePreference defaults to system for a corrupted stored value", () => {
  assert.equal(
    readStoredThemePreference(fakeStorage({ [THEME_STORAGE_KEY]: "gibberish" })),
    "system",
  );
});

test("readStoredThemePreference defaults to system when storage itself is unavailable", () => {
  assert.equal(readStoredThemePreference(undefined), "system");
});

test("readStoredThemePreference falls back to system when storage throws (private-browsing edge case)", () => {
  const throwing = {
    getItem(): string {
      throw new Error("blocked");
    },
  };
  assert.equal(readStoredThemePreference(throwing), "system");
});

test("write then read round-trips each real preference value", () => {
  for (const pref of THEME_PREFERENCES) {
    const storage = fakeStorage();
    writeThemePreference(storage, pref);
    assert.equal(readStoredThemePreference(storage), pref);
  }
});

test("writeThemePreference is a safe no-op when storage is unavailable", () => {
  assert.doesNotThrow(() => writeThemePreference(undefined, "midnight"));
});

// --- resolveReading: the shared preference-resolution logic ----------------
// This is the pure logic every caller (bootstrap script semantics,
// ThemePicker, its OS-change listener) is built on top of.

test("resolveReading: midnight and parchment pass through regardless of OS preference", () => {
  assert.equal(resolveReading("midnight", true), "midnight");
  assert.equal(resolveReading("midnight", false), "midnight");
  assert.equal(resolveReading("parchment", true), "parchment");
  assert.equal(resolveReading("parchment", false), "parchment");
});

// MUTATION-PROOF TARGET (System-preference resolution): breaking
// resolveReading so "system" stops following the OS value must fail this
// named test. See the mutation-proof run in the commit message.
test("resolveReading: system follows the live OS prefers-color-scheme value", () => {
  assert.equal(resolveReading("system", true), "midnight");
  assert.equal(resolveReading("system", false), "parchment");
});

// --- Contrast math (WCAG 2.x) ------------------------------------------------

// MUTATION-PROOF TARGET (contrast-ratio formula): an off-by-one in the WCAG
// formula (wrong 0.05 offset, missing gamma correction, swapped luminance
// coefficients, etc.) must fail this named test against the textbook
// reference pair. See the mutation-proof run in the commit message.
test("contrastRatio: black on white is exactly 21 (WCAG reference value)", () => {
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.equal(contrastRatio("#ffffff", "#000000"), 21, "order-independent");
});

test("contrastRatio: identical colors have a ratio of exactly 1", () => {
  assert.equal(contrastRatio("#336699", "#336699"), 1);
});

test("hexToRgb rejects malformed input", () => {
  assert.throws(() => hexToRgb("not-a-color"));
  assert.throws(() => hexToRgb("#fff"), "3-digit shorthand is not a token format this codebase uses");
  assert.throws(() => hexToRgb("#gggggg"));
});

test("hexToRgb accepts a leading # or none, case-insensitively", () => {
  assert.deepEqual(hexToRgb("#FFFFFF"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(hexToRgb("ffffff"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(hexToRgb("#000000"), { r: 0, g: 0, b: 0 });
});

test("meetsAA applies the 4.5:1 normal-text floor by default, and 3:1 for large text/UI", () => {
  assert.equal(AA_NORMAL_TEXT_MIN_RATIO, 4.5);
  assert.equal(AA_LARGE_TEXT_MIN_RATIO, 3.0);
  assert.equal(meetsAA(4.5), true);
  assert.equal(meetsAA(4.49), false);
  assert.equal(meetsAA(3.0, true), true);
  assert.equal(meetsAA(2.99, true), false);
});

// --- AA compliance proof for the real theme tokens --------------------------
// Acceptance criterion: page-ink-on-page-bg and page-muted-on-page-bg meet
// WCAG AA for BOTH real variants. Both tokens render as normal-size text
// (Field.module.css: 10.5-11.5px; note-composer/claim-composer bodies), so
// the 4.5:1 normal-text floor applies, not the relaxed 3:1 large-text one.

test("Parchment: page-ink on page-bg meets WCAG AA normal text", () => {
  const ratio = contrastRatio(PARCHMENT_BODY_TOKENS.pageInk, PARCHMENT_BODY_TOKENS.pageBg);
  assert.ok(meetsAA(ratio), `expected >= 4.5:1, got ${ratio.toFixed(3)}:1`);
});

test("Parchment: page-muted on page-bg meets WCAG AA normal text", () => {
  const ratio = contrastRatio(PARCHMENT_BODY_TOKENS.pageMuted, PARCHMENT_BODY_TOKENS.pageBg);
  assert.ok(meetsAA(ratio), `expected >= 4.5:1, got ${ratio.toFixed(3)}:1`);
});

test("Midnight: page-ink on page-bg meets WCAG AA normal text", () => {
  const ratio = contrastRatio(MIDNIGHT_BODY_TOKENS.pageInk, MIDNIGHT_BODY_TOKENS.pageBg);
  assert.ok(meetsAA(ratio), `expected >= 4.5:1, got ${ratio.toFixed(3)}:1`);
});

test("Midnight: page-muted on page-bg meets WCAG AA normal text", () => {
  const ratio = contrastRatio(MIDNIGHT_BODY_TOKENS.pageMuted, MIDNIGHT_BODY_TOKENS.pageBg);
  assert.ok(meetsAA(ratio), `expected >= 4.5:1, got ${ratio.toFixed(3)}:1`);
});

// --- Token snapshot pinned against the real stylesheet -----------------------
// lib/theme.ts's *_BODY_TOKENS are hand-transcribed (no CSS parser in this
// project's dependencies) — these tests pin them against app/globals.css's
// own text so the snapshot cannot silently drift out of sync with the real
// tokens the app actually renders with.

test("PARCHMENT_BODY_TOKENS and MIDNIGHT_BODY_TOKENS are byte-identical to app/globals.css", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const midnightStart = css.indexOf('[data-reading="midnight"]');
  assert.ok(midnightStart > -1, "the renamed midnight block must exist");
  const rootBlock = css.slice(css.indexOf(":root {"), midnightStart);
  const midnightBlock = css.slice(midnightStart);

  assert.match(rootBlock, /--page-bg:\s*#f3f0e8;/);
  assert.match(rootBlock, /--page-ink:\s*#233029;/);
  assert.match(rootBlock, /--page-muted:\s*#686e69;/);
  assert.equal(PARCHMENT_BODY_TOKENS.pageBg, "#f3f0e8");
  assert.equal(PARCHMENT_BODY_TOKENS.pageInk, "#233029");
  assert.equal(PARCHMENT_BODY_TOKENS.pageMuted, "#686e69");

  assert.match(midnightBlock, /--page-bg:\s*#10161d;/);
  assert.match(midnightBlock, /--page-ink:\s*#e4e2da;/);
  assert.match(midnightBlock, /--page-muted:\s*#7d8892;/);
  assert.equal(MIDNIGHT_BODY_TOKENS.pageBg, "#10161d");
  assert.equal(MIDNIGHT_BODY_TOKENS.pageInk, "#e4e2da");
  assert.equal(MIDNIGHT_BODY_TOKENS.pageMuted, "#7d8892");
});

test('the old [data-reading="night"] selector is gone; only midnight/parchment remain', async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  // Match the SELECTOR specifically (":root[data-reading=\"night\"] {"), not
  // prose mentioning the old name — the top-of-file comment and the renamed
  // block's own comment both legitimately reference "night" as history, and
  // "midnight" itself contains the substring "night".
  assert.doesNotMatch(css, /:root\[data-reading="night"\]\s*\{/);
  assert.match(css, /:root\[data-reading="midnight"\]\s*\{/);
});

test("--crimson is defined for both real variants (token only — not yet applied to UI)", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const midnightStart = css.indexOf('[data-reading="midnight"]');
  const rootBlock = css.slice(css.indexOf(":root {"), midnightStart);
  const midnightBlock = css.slice(midnightStart);
  assert.match(rootBlock, /--crimson:\s*#[0-9a-fA-F]{6};/);
  assert.match(midnightBlock, /--crimson:\s*#[0-9a-fA-F]{6};/);
});

test("app/layout.tsx no longer hardcodes a data-reading value with no CSS target", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  // "parchment" is now a real, CSS-targeted default (see globals.css :root),
  // unlike the old no-op. Assert the bootstrap script is wired in too.
  assert.match(layout, /data-reading="parchment"/);
  assert.match(layout, /getThemeBootstrapScript/);
});

// --- Pre-paint bootstrap script: executed for real, not just string-matched -
// vm.runInContext actually runs the generated script against a minimal fake
// window/document, so these tests prove the script's real behavior rather
// than trusting its source text looks right.

function runBootstrapScript(opts: {
  stored: string | null;
  prefersDark: boolean;
  throwOnGetItem?: boolean;
}): string {
  const calls: Array<[string, string]> = [];
  const sandbox: Record<string, unknown> = {
    window: {
      localStorage: {
        getItem: (key: string) => {
          if (opts.throwOnGetItem) throw new Error("blocked");
          assert.equal(key, THEME_STORAGE_KEY, "script must read the real storage key");
          return opts.stored;
        },
      },
      matchMedia: (query: string) => {
        assert.equal(query, PREFERS_DARK_MEDIA_QUERY, "script must query the real media query");
        return { matches: opts.prefersDark };
      },
    },
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => {
          calls.push([name, value]);
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(getThemeBootstrapScript(), sandbox);
  assert.equal(calls.length, 1, "the script must set data-reading exactly once");
  const [name, value] = calls[0];
  assert.equal(name, "data-reading");
  return value;
}

test("bootstrap script: stored 'midnight' sets data-reading=midnight regardless of OS", () => {
  assert.equal(runBootstrapScript({ stored: "midnight", prefersDark: false }), "midnight");
});

test("bootstrap script: stored 'parchment' sets data-reading=parchment regardless of OS", () => {
  assert.equal(runBootstrapScript({ stored: "parchment", prefersDark: true }), "parchment");
});

test("bootstrap script: stored 'system' + OS dark resolves to midnight", () => {
  assert.equal(runBootstrapScript({ stored: "system", prefersDark: true }), "midnight");
});

test("bootstrap script: stored 'system' + OS light resolves to parchment", () => {
  assert.equal(runBootstrapScript({ stored: "system", prefersDark: false }), "parchment");
});

test("bootstrap script: nothing stored behaves like system (OS-driven)", () => {
  assert.equal(runBootstrapScript({ stored: null, prefersDark: true }), "midnight");
  assert.equal(runBootstrapScript({ stored: null, prefersDark: false }), "parchment");
});

test("bootstrap script: a garbage stored value ('night', the old dead name) behaves like system", () => {
  assert.equal(runBootstrapScript({ stored: "night", prefersDark: true }), "midnight");
});

test("bootstrap script: fails closed to parchment when localStorage throws", () => {
  assert.equal(
    runBootstrapScript({ stored: null, prefersDark: true, throwOnGetItem: true }),
    "parchment",
  );
});

test("bootstrap script interpolates the real storage key and media query", () => {
  const src = getThemeBootstrapScript();
  assert.ok(src.includes(JSON.stringify(THEME_STORAGE_KEY)));
  assert.ok(src.includes(JSON.stringify(PREFERS_DARK_MEDIA_QUERY)));
});

// --- applyThemePreference: DOM-touching helper, safe outside a browser ------

test("applyThemePreference does not throw where document/window are unavailable", () => {
  assert.equal(typeof document, "undefined", "sanity: this test run has no DOM");
  assert.doesNotThrow(() => applyThemePreference("midnight"));
});

// --- ThemePicker's external store: safe no-DOM behavior ---------------------
// The real subscribe/notify round trip needs a browser `window`/`storage`
// event, which this test run intentionally has none of (see the sanity
// assertion above). What IS provable here without a DOM is that every piece
// of the store degrades safely rather than throwing when window is absent —
// readThemePreferenceSnapshot's "system" default, exercised via the store
// pair, matches readThemePreferenceServerSnapshot exactly (no
// hydration-mismatch surface), and commit/subscribe are no-ops rather than
// crashes outside a browser.

test("readThemePreferenceSnapshot and readThemePreferenceServerSnapshot agree outside a browser", () => {
  assert.equal(readThemePreferenceSnapshot(), "system");
  assert.equal(readThemePreferenceServerSnapshot(), "system");
  assert.equal(readThemePreferenceSnapshot(), readThemePreferenceServerSnapshot());
});

test("subscribeThemePreferenceChange returns a working no-op unsubscribe outside a browser", () => {
  const unsubscribe = subscribeThemePreferenceChange(() => {
    throw new Error("must never be called without a window");
  });
  assert.doesNotThrow(unsubscribe);
});

test("commitThemePreference does not throw when storage/window are unavailable", () => {
  assert.doesNotThrow(() => commitThemePreference(undefined, "midnight"));
});
