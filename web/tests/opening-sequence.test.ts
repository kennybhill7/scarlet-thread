/**
 * OPENING-001 — tests for the first-run opening sequence.
 *
 * Three groups, matching the task's own scope:
 *   A. Pure flag read/write logic (lib/opening/openingSequence.ts) — plain
 *      node:test, no DOM, same fakeStorage technique tests/theme.test.ts
 *      uses for lib/theme.ts's own storage helpers.
 *   B. The reduced-motion guarantee — one renderToStaticMarkup proof for the
 *      hookless GlobeSphere (same technique tests/mountain-plates.test.ts
 *      uses for MountainPlates: a CSS-module Proxy stub seeded into the
 *      require cache, since `tsx --test` cannot import a .tsx that imports a
 *      .module.css and there is no test renderer for hook-bearing
 *      components), plus source-text assertions on the two independent
 *      (JS + CSS) guarantees that mirror Mountain.tsx/Mountain.module.css's
 *      own rigor for --mountain-progress.
 *   C. That the new Settings section doesn't break the existing tested
 *      order (offline < export < clear), and sits after ThemePicker.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  EDEN_ORIGIN,
  EDEN_REGION,
  OPENING_REPLAY_PARAM,
  OPENING_REPLAY_VALUE,
  OPENING_SEEN_STORAGE_KEY,
  clearOpeningSeen,
  getOpeningBootstrapScript,
  hasSeenOpening,
  isReplayRequested,
  markOpeningSeen,
  replayHref,
  shouldShowOpening,
} from "@/lib/opening/openingSequence";

const root = process.cwd();
function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

// ---------------------------------------------------------------------------
// Test-only storage stub -- a plain Map behind the same subset of the
// Storage interface these functions accept, exactly like tests/theme.test.ts's
// fakeStorage. The whole point of these functions taking `Pick<Storage, ...>`
// is that they're callable from a bare node:test run with no DOM at all.
// ---------------------------------------------------------------------------

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

// --- A. Flag read/write logic ------------------------------------------------

test("hasSeenOpening defaults to false when nothing is stored", () => {
  assert.equal(hasSeenOpening(fakeStorage()), false);
});

test("markOpeningSeen then hasSeenOpening round-trips", () => {
  const storage = fakeStorage();
  assert.equal(hasSeenOpening(storage), false);
  markOpeningSeen(storage);
  assert.equal(hasSeenOpening(storage), true);
});

test("clearOpeningSeen retracts a previously-set flag", () => {
  const storage = fakeStorage();
  markOpeningSeen(storage);
  assert.equal(hasSeenOpening(storage), true);
  clearOpeningSeen(storage);
  assert.equal(hasSeenOpening(storage), false);
});

test("hasSeenOpening treats any non-'1' stored value as not-seen", () => {
  assert.equal(
    hasSeenOpening(fakeStorage({ [OPENING_SEEN_STORAGE_KEY]: "true" })),
    false,
  );
  assert.equal(
    hasSeenOpening(fakeStorage({ [OPENING_SEEN_STORAGE_KEY]: "" })),
    false,
  );
});

test("hasSeenOpening/markOpeningSeen/clearOpeningSeen are no-ops on undefined storage", () => {
  assert.equal(hasSeenOpening(undefined), false);
  assert.doesNotThrow(() => markOpeningSeen(undefined));
  assert.doesNotThrow(() => clearOpeningSeen(undefined));
});

test("hasSeenOpening falls back to false when storage throws (private-browsing edge case)", () => {
  const throwing = {
    getItem(): string {
      throw new Error("blocked");
    },
  };
  assert.equal(hasSeenOpening(throwing), false);
});

test("isReplayRequested reads the exact param/value pair, nothing looser", () => {
  assert.equal(isReplayRequested(`?${OPENING_REPLAY_PARAM}=${OPENING_REPLAY_VALUE}`), true);
  assert.equal(isReplayRequested(""), false);
  assert.equal(isReplayRequested("?opening=no"), false);
  assert.equal(isReplayRequested("?other=replay"), false);
  assert.equal(isReplayRequested("not a query string but shouldn't throw"), false);
});

test("replayHref matches the exact param/value isReplayRequested checks for", () => {
  const href = replayHref();
  const [, search] = href.split("?");
  assert.equal(isReplayRequested(`?${search}`), true, `replayHref() produced ${href}`);
});

// --- shouldShowOpening: the one decision every caller goes through ----------

test("shouldShowOpening: reduced motion wins over everything, even an explicit replay", () => {
  assert.equal(
    shouldShowOpening({ storage: fakeStorage(), search: "", reducedMotion: true }),
    false,
    "never seen, but reduced motion -- must not show",
  );
  assert.equal(
    shouldShowOpening({
      storage: fakeStorage({ [OPENING_SEEN_STORAGE_KEY]: "1" }),
      search: `?${OPENING_REPLAY_PARAM}=${OPENING_REPLAY_VALUE}`,
      reducedMotion: true,
    }),
    false,
    "explicit replay request, but reduced motion -- must still not show",
  );
});

test("shouldShowOpening: first run (not seen, no reduced motion) shows", () => {
  assert.equal(
    shouldShowOpening({ storage: fakeStorage(), search: "", reducedMotion: false }),
    true,
  );
});

test("shouldShowOpening: a returning visitor with no replay request does not see it again", () => {
  assert.equal(
    shouldShowOpening({
      storage: fakeStorage({ [OPENING_SEEN_STORAGE_KEY]: "1" }),
      search: "",
      reducedMotion: false,
    }),
    false,
  );
});

test("shouldShowOpening: an explicit replay shows it again even though already seen", () => {
  assert.equal(
    shouldShowOpening({
      storage: fakeStorage({ [OPENING_SEEN_STORAGE_KEY]: "1" }),
      search: `?${OPENING_REPLAY_PARAM}=${OPENING_REPLAY_VALUE}`,
      reducedMotion: false,
    }),
    true,
  );
});

// --- The bootstrap script itself ---------------------------------------------

test("getOpeningBootstrapScript embeds the real storage key and replay param/value, not hand-retyped copies", () => {
  const script = getOpeningBootstrapScript();
  assert.ok(script.includes(JSON.stringify(OPENING_SEEN_STORAGE_KEY)));
  assert.ok(script.includes(JSON.stringify(OPENING_REPLAY_PARAM)));
  assert.ok(script.includes(JSON.stringify(OPENING_REPLAY_VALUE)));
  assert.match(script, /prefers-reduced-motion: reduce/);
  assert.match(script, /data-opening-visible/);
  // Fails closed: the only setAttribute call sets "true"; there is no
  // explicit "false" branch, because the wrapper's own JSX default already
  // is "false" -- see lib/opening/openingSequence.ts's own header.
  assert.equal((script.match(/setAttribute\(/g) ?? []).length, 1);
  assert.match(script, /setAttribute\("data-opening-visible","true"\)/);
});

// --- Eden region constants ----------------------------------------------------

test("EDEN_REGION/EDEN_ORIGIN are sane percentages inside the lower-left quadrant", () => {
  for (const value of [EDEN_REGION.xPct, EDEN_REGION.yPct, EDEN_REGION.widthPct, EDEN_REGION.heightPct]) {
    assert.ok(value >= 0 && value <= 100, `expected a 0-100 percentage, got ${value}`);
  }
  assert.ok(EDEN_REGION.xPct + EDEN_REGION.widthPct <= 100);
  assert.ok(EDEN_REGION.yPct + EDEN_REGION.heightPct <= 100.01);
  // The real, verified location (see this module's own comment): the left
  // edge of the map, in the bottom half.
  assert.ok(EDEN_REGION.xPct < 25, "Eden is painted at the map's left edge");
  assert.ok(EDEN_REGION.yPct > 50, "Eden is painted in the map's bottom half");
  assert.ok(
    EDEN_ORIGIN.xPct >= EDEN_REGION.xPct && EDEN_ORIGIN.xPct <= EDEN_REGION.xPct + EDEN_REGION.widthPct,
    "the zoom's transform-origin sits inside its own region horizontally",
  );
  assert.ok(
    EDEN_ORIGIN.yPct >= EDEN_REGION.yPct && EDEN_ORIGIN.yPct <= EDEN_REGION.yPct + EDEN_REGION.heightPct,
    "the zoom's transform-origin sits inside its own region vertically",
  );
});

// --- B. RENDER: hookless GlobeSphere + the reduced-motion guarantee ---------

const nodeRequire = createRequire(__filename);
function seedModule(specifier: string, exports: Record<string, unknown>) {
  const resolved = nodeRequire.resolve(specifier);
  (nodeRequire.cache as Record<string, unknown>)[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    path: path.dirname(resolved),
    paths: [],
    children: [],
    exports: { __esModule: true, ...exports },
  };
  return resolved;
}
const cssProxy = new Proxy({}, { get: (_target, key) => (typeof key === "string" ? key : undefined) });
seedModule("@/components/opening/Globe.module.css", { default: cssProxy });

const { GlobeSphere } = nodeRequire("@/components/opening/Globe") as {
  GlobeSphere: typeof import("../components/opening/Globe").GlobeSphere;
};

test("RENDER GlobeSphere: hookless, applies the exact rotateX/rotateY props to the rotating group", () => {
  const html = renderToStaticMarkup(createElement(GlobeSphere, { rotateX: 12.5, rotateY: -40 }));
  assert.match(html, /data-testid="globe-sphere"/);
  assert.ok(html.includes("rotateX(12.5deg)"));
  assert.ok(html.includes("rotateY(-40deg)"));
});

test("RENDER GlobeSphere: one meridian per angle, one parallel per latitude, one landmass per blob -- all static data, not random", () => {
  const htmlA = renderToStaticMarkup(createElement(GlobeSphere, { rotateX: 0, rotateY: 0 }));
  const htmlB = renderToStaticMarkup(createElement(GlobeSphere, { rotateX: 0, rotateY: 0 }));
  assert.equal(htmlA, htmlB, "the resting frame is deterministic, not seeded by Math.random at render time");

  const meridians = (htmlA.match(/class="meridian"/g) ?? []).length;
  const parallels = (htmlA.match(/class="parallel"/g) ?? []).length;
  const landmasses = (htmlA.match(/class="landmass"/g) ?? []).length;
  assert.ok(meridians >= 3, `expected several meridian rings, got ${meridians}`);
  assert.ok(parallels >= 3, `expected several parallel rings, got ${parallels}`);
  assert.ok(landmasses >= 3, `expected several landmass blobs, got ${landmasses}`);
});

test("RENDER GlobeSphere: the non-rotating .base sits outside the preserve-3d .sphere group", () => {
  const html = renderToStaticMarkup(createElement(GlobeSphere, { rotateX: 0, rotateY: 0 }));
  const baseIdx = html.indexOf('class="base"');
  const sphereIdx = html.indexOf('data-testid="globe-sphere"');
  assert.ok(baseIdx !== -1 && sphereIdx !== -1);
  assert.ok(baseIdx < sphereIdx, "the solid body renders before (outside) the rotating group");
});

// --- The reduced-motion guarantee, source-text half ---------------------------
// Globe.tsx/OpeningSequence.tsx have real hooks (drag state, timers), so they
// cannot go through renderToStaticMarkup the way GlobeSphere above does --
// same limitation tests/protected-integrations.test.ts documents for
// hook-bearing components in this repo. These assertions pin the same
// two-guarantee shape Mountain.tsx/Mountain.module.css already establish for
// --mountain-progress: (1) JS never attaches a motion-only listener under
// reduced motion, AND (2) CSS independently pins the resting/hidden state
// regardless of whether (1) ran correctly.

test("MUTATION-GUARD: OpeningSequence never lets the sequence play under reduced motion (JS guarantee)", () => {
  const src = read("components/opening/OpeningSequence.tsx");
  assert.match(src, /prefers-reduced-motion: reduce/);
  const mountEffect = src.indexOf("Mount-time guard");
  const reducedCheck = src.indexOf("const reducedMotion =");
  const bail = src.indexOf("finishedRef.current = true;", reducedCheck);
  assert.ok(mountEffect > -1 && reducedCheck > mountEffect, "the mount effect checks reduced motion");
  assert.ok(bail > reducedCheck, "and sets finishedRef because of it, before any timer is scheduled");
  // finishedRef is what actually stops progress -- both the timer-scheduling
  // effect and Globe's onAdvance callback must check it.
  assert.match(src, /useEffect\(\(\) => \{\s*if \(finishedRef\.current\) return;/);
  assert.match(src, /if \(!finishedRef\.current\) setStage\("map-arrive"\);/);
  // The live OS-toggle guard: an existing session must also bail mid-flight.
  assert.match(src, /mql\.addEventListener\?\.\("change", onChange\)/);
  assert.match(src, /if \(mql\.matches\) finish\(\);/);
});

test("MUTATION-GUARD: Globe never attaches drag/inertia motion under reduced motion (JS guarantee)", () => {
  const src = read("components/opening/Globe.tsx");
  const pointerDown = src.indexOf("function onPointerDown");
  const pointerDownGuard = src.indexOf("if (reducedMotionActive()) return;", pointerDown);
  assert.ok(pointerDown > -1 && pointerDownGuard > pointerDown, "onPointerDown bails under reduced motion before capturing the pointer");
  const inertia = src.indexOf("function runInertia");
  const inertiaGuard = src.indexOf("if (reducedMotionActive()) return;", inertia);
  assert.ok(inertia > -1 && inertiaGuard > inertia, "runInertia bails under reduced motion before the first requestAnimationFrame");
});

test("MUTATION-GUARD: OpeningSequence.module.css independently pins overlay-hidden/content-visible under reduced motion, with !important (CSS guarantee)", () => {
  const css = read("components/opening/OpeningSequence.module.css");
  const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(block.length > 0, "expected a reduced-motion media block");
  assert.match(block, /\.overlay\s*\{[^}]*opacity:\s*0\s*!important/);
  assert.match(block, /\.overlay\s*\{[^}]*visibility:\s*hidden\s*!important/);
  assert.match(block, /\.overlay\s*\{[^}]*pointer-events:\s*none\s*!important/);
  assert.match(block, /\.content\s*\{[^}]*visibility:\s*visible\s*!important/);
});

// --- The pre-paint / no-flash mechanism itself --------------------------------

test("OpeningSequence's wrapper defaults to data-opening-visible=\"false\" in its own JSX (safe no-JS default)", () => {
  const src = read("components/opening/OpeningSequence.tsx");
  assert.match(src, /data-opening-visible="false"/);
  // And the bootstrap script is rendered as a real child of that same
  // element, server-side, so the browser executes it while parsing --
  // not inside a useEffect (which would run too late, after first paint).
  const rootDiv = src.indexOf('<div id={ROOT_ID}');
  const script = src.indexOf("dangerouslySetInnerHTML={{ __html: getOpeningBootstrapScript() }}");
  assert.ok(rootDiv > -1 && script > rootDiv);
  assert.doesNotMatch(
    src.slice(0, script),
    /useEffect\(\(\) => \{\s*document\.getElementById\(ROOT_ID\)\?\.setAttribute\("data-opening-visible"/,
    "the pre-paint decision must not be made from inside a useEffect",
  );
});

// --- C. Settings order --------------------------------------------------------

test("settings still renders downloads, then export, then clear device (unchanged by OPENING-001)", () => {
  const page = read("app/(app)/settings/page.tsx");
  const offline = page.indexOf("<OfflineDownloads");
  const exportButton = page.indexOf("<VaultExportButton");
  const clear = page.indexOf("<DeviceSessionControls");
  assert.ok(offline > -1 && exportButton > -1 && clear > -1);
  assert.ok(offline < exportButton, "offline downloads come first");
  assert.ok(exportButton < clear, "export comes before clearing the device");
});

test("ReplayJourney is appended after ThemePicker, not inserted among the three ordered sections", () => {
  const page = read("app/(app)/settings/page.tsx");
  const clear = page.indexOf("<DeviceSessionControls");
  const theme = page.indexOf("<ThemePicker");
  const replay = page.indexOf("<ReplayJourney");
  assert.ok(clear > -1 && theme > -1 && replay > -1, "all four sections are present");
  assert.ok(clear < theme, "theme still comes after clear device (THEMESYSTEM-001's own placement, untouched)");
  assert.ok(theme < replay, "replay journey is appended after theme, the prior last section");
});

test("ReplayJourney forces a real navigation (not router.push) so the pre-paint script actually runs again", () => {
  const src = read("components/settings/ReplayJourney.tsx");
  // No import of next/navigation's useRouter, and no real `.push(` call --
  // only the prose in this file's own header comment is allowed to say the
  // words "router.push" while explaining why it deliberately isn't used.
  assert.doesNotMatch(src, /from "next\/navigation"/);
  assert.doesNotMatch(src, /useRouter\(/);
  assert.doesNotMatch(src, /\.push\(/);
  assert.match(src, /<a className=\{styles\.button\} href=\{replayHref\(\)\}/);
});

test("ReplayJourney clears the stored flag using the same key openingSequence.ts owns", () => {
  const src = read("components/settings/ReplayJourney.tsx");
  assert.match(src, /clearOpeningSeen\(/);
  assert.match(src, /from "@\/lib\/opening\/openingSequence"/);
});
