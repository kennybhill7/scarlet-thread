/**
 * ISRAELPROTO-001 → ISRAELFILTER-001 — the Israel sub-arc view
 * (`components/prototype/*`, `lib/prototype/israel-sub-arc.ts`,
 * `app/(app)/prototype/israel-sub-arc/page.tsx`) and its real entry point,
 * `components/climb/Mountain.tsx`'s stage-5 waypoint interception.
 *
 * ISRAELFILTER-001 replaced `lib/prototype/israel-sub-arc.ts`'s hand-typed
 * six-phase array with one derived from `web/lib/bible/storySpine.ts`'s real
 * `STORY_SPINE`/`stagesOf`/`phase` data (STORYSPINE-001) -- see that
 * module's own header for the full reconciliation (the real phase taxonomy
 * merges the prototype's separate Exile/Return into one "Exile & Return"
 * phase and adds a "Divided & Warned" phase the prototype never had). Every
 * assertion below that depended on the OLD hand-typed taxonomy (six
 * phases named through "Return", hand-typed ranges) is updated to the real
 * one, not silently dropped -- diffing this file against ISRAELPROTO-001's
 * original version shows exactly what changed and why.
 *
 * TEST-ENVIRONMENT NOTE (same discipline as `tests/teach-pane.test.ts` and
 * `tests/climb-setup-state.test.ts`, both read as precedent before writing
 * this file): this repo's test script is `tsx --test tests/*.test.ts` —
 * plain Node, no jsdom, no bundler, so no real `.css`/`.module.css` file can
 * be parsed, and no real click/DOM event can be simulated.
 *
 *   1. `IsraelSubArcRidge` and `IsraelSubArcDetail` are both HOOKLESS
 *      ("props in, markup out" — `TeachSection.tsx`'s `TeachOutlinePanel`
 *      precedent), so they render directly through `react-dom/server`'s
 *      `renderToStaticMarkup` with controlled props, no CSS Module stub
 *      needed (neither file imports one). `IsraelSubArcDetail` now also
 *      renders real `next/link` `Link`s -- tests/mountain-ribbon.test.ts's
 *      own precedent (section B there) already established that a real,
 *      unstubbed `next/link` renders a plain `<a>` fine under
 *      `renderToStaticMarkup`, so no stub is needed here either.
 *   2. `IsraelSubArcPrototype` (the stateful "use client" shell) imports
 *      `@/components/ui/Sheet`, which imports `./Sheet.module.css` — that
 *      one real CSS Module is neutralised in `require.cache` before the
 *      shell module loads, mirroring `tests/climb-setup-state.test.ts`'s
 *      treatment of `ClimbHero.module.css`. `useEffect` never fires under
 *      `renderToStaticMarkup` (no browser commit phase), so `Sheet`'s
 *      `showModal()` call never runs here — the rendered markup is always
 *      the CLOSED state (the `<dialog>` element and its full children tree
 *      still render, just without a native `open` attribute), which is
 *      enough to prove the heading, the ridge, and (now) the real per-phase
 *      chapter content all land on one page together.
 *   3. Section E (`Mountain.tsx`) mirrors `tests/mountain-ribbon.test.ts`
 *      section B and `tests/mountain-mirror-pairs.test.ts`: `nodeRequire` +
 *      `require.cache` seeding loads the REAL `Mountain.tsx`, stubbing only
 *      its own CSS Modules, `Sheet.module.css` (now reached transitively via
 *      the embedded `IsraelSubArcPrototype`), and `next/navigation`'s
 *      `useRouter` (a spy, so pushed hrefs are observable).
 *      `resolveWaypointAction` -- the pure decision both the plates and
 *      ribbon click handlers funnel through -- is exported specifically so
 *      the stage-5-only interception can be proven directly, without
 *      simulating a real click.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { STORY_SPINE, stagesOf } from "@/lib/bible/storySpine";
import {
  ISRAEL_SUB_ARC_PHASES,
  bookName,
  elevationOf,
  passageHref,
  passageLabel,
  phaseBySlug,
} from "@/lib/prototype/israel-sub-arc";
import { IsraelSubArcDetail } from "@/components/prototype/IsraelSubArcDetail";
import { IsraelSubArcRidge } from "@/components/prototype/IsraelSubArcRidge";
import type { MountainStage } from "@/lib/vault/seed";

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
seedModule("@/components/ui/Sheet.module.css", { default: cssProxy });

function noop() {}

/**
 * React's server renderer HTML-escapes text content, so "Divided & Warned"
 * (the one real phase name with an `&`) shows up in rendered markup as
 * "Divided &amp; Warned" -- this matches that escaping when a test builds
 * its own expected substring from `phase.name` rather than hard-coding one.
 */
function htmlAmp(text: string): string {
  return text.replace(/&/g, "&amp;");
}

// ---------------------------------------------------------------------------
// A. The data itself — now derived from STORY_SPINE, not hand-typed.
// ---------------------------------------------------------------------------

test("ISRAEL_SUB_ARC_PHASES: exactly six real phases, in order, Patriarchs through Exile & Return", () => {
  assert.equal(ISRAEL_SUB_ARC_PHASES.length, 6);
  assert.deepEqual(
    ISRAEL_SUB_ARC_PHASES.map((p) => p.slug),
    ["patriarchs", "exodus", "conquest", "kingdom", "divided-and-warned", "exile-and-return"],
  );
  assert.deepEqual(
    ISRAEL_SUB_ARC_PHASES.map((p) => p.name),
    ["Patriarchs", "Exodus", "Conquest", "Kingdom", "Divided & Warned", "Exile & Return"],
  );
  assert.deepEqual(
    ISRAEL_SUB_ARC_PHASES.map((p) => p.order),
    [1, 2, 3, 4, 5, 6],
  );
});

test("ISRAEL_SUB_ARC_PHASES: each phase's range is computed from its real first/last passage, not hand-typed", () => {
  assert.equal(phaseBySlug("patriarchs")?.range, "Genesis 12–50");
  assert.equal(phaseBySlug("exodus")?.range, "Exodus 1–Deuteronomy 34");
  assert.equal(phaseBySlug("conquest")?.range, "Joshua 1–Ruth 4");
  assert.equal(phaseBySlug("kingdom")?.range, "1 Samuel 1–Proverbs 21");
  assert.equal(phaseBySlug("divided-and-warned")?.range, "1 Kings 12–Isaiah 53");
  assert.equal(phaseBySlug("exile-and-return")?.range, "2 Kings 21–Malachi 4");
});

test("ISRAEL_SUB_ARC_PHASES: Kingdom is the only peak", () => {
  const peaks = ISRAEL_SUB_ARC_PHASES.filter((p) => p.peak);
  assert.deepEqual(peaks.map((p) => p.slug), ["kingdom"]);
});

test("elevationOf: ascends to the peak then descends -- Kingdom (order 4) is strictly higher than every neighbor", () => {
  const peakOrder = 4;
  const levels = ISRAEL_SUB_ARC_PHASES.map((p) => elevationOf(p.order, peakOrder));
  assert.deepEqual(levels, [0, 1, 2, 3, 2, 1]);
  const kingdomLevel = levels[3];
  assert.ok(levels.every((level, i) => i === 3 || level < kingdomLevel));
});

test("ISRAEL_SUB_ARC_PHASES: every real STORY_SPINE stage-5 chapter is grouped into exactly one phase -- none dropped, none duplicated", () => {
  const expectedIds = STORY_SPINE.filter((entry) => stagesOf(entry).includes(5)).map((entry) => entry.id);
  const actualIds = ISRAEL_SUB_ARC_PHASES.flatMap((phase) => phase.chapters.map((chapter) => chapter.id));
  assert.deepEqual([...actualIds].sort(), [...expectedIds].sort());
  assert.equal(new Set(actualIds).size, actualIds.length, "a chapter must not appear under two phases");
});

test("ISRAEL_SUB_ARC_PHASES: every chapter is filed under the phase its own `phase` field names", () => {
  for (const phase of ISRAEL_SUB_ARC_PHASES) {
    for (const chapter of phase.chapters) {
      assert.equal(chapter.phase, phase.name, `${chapter.id} filed under ${phase.name} but chapter.phase is ${chapter.phase}`);
    }
  }
});

test("ISRAEL_SUB_ARC_PHASES: real chapter counts per phase (STORYSPINE-001's story-2 through story-21)", () => {
  assert.deepEqual(
    ISRAEL_SUB_ARC_PHASES.map((p) => [p.slug, p.chapters.length]),
    [
      ["patriarchs", 2],
      ["exodus", 3],
      ["conquest", 3],
      ["kingdom", 4],
      ["divided-and-warned", 3],
      ["exile-and-return", 5],
    ],
  );
});

test("bookName: canonical 1-66 numbers map to real book names", () => {
  assert.equal(bookName(1), "Genesis");
  assert.equal(bookName(39), "Malachi");
  assert.equal(bookName(20), "Proverbs");
  assert.equal(bookName(66), "Revelation");
});

test("passageLabel: a single chapter renders without a dash; a span renders 'from–to'", () => {
  assert.equal(passageLabel({ book: 1, from: 35, to: 35 }), "Genesis 35");
  assert.equal(passageLabel({ book: 1, from: 12, to: 13 }), "Genesis 12–13");
});

test("passageHref: same /read/[book]/[chapter] URL shape stageHref() (mountainGeometry.ts) builds -- numeric book, first chapter of the span", () => {
  assert.equal(passageHref({ book: 2, from: 1, to: 7 }), "/read/2/1");
  assert.equal(passageHref({ book: 39, from: 1, to: 4 }), "/read/39/1");
});

// ---------------------------------------------------------------------------
// B. IsraelSubArcRidge -- hookless, props in / markup out. Unchanged
//    rendering logic (ISRAELFILTER-001 explicitly keeps this component's
//    own visual design) -- only the underlying data (names/ranges) changed.
// ---------------------------------------------------------------------------

test("RENDER IsraelSubArcRidge: all six phases render, in the given order, each with its own name and real chapter range in its accessible label", () => {
  const html = renderToStaticMarkup(
    createElement(IsraelSubArcRidge, { phases: ISRAEL_SUB_ARC_PHASES, selectedSlug: null, onSelect: noop }),
  );
  let cursor = -1;
  for (const phase of ISRAEL_SUB_ARC_PHASES) {
    const label = `${htmlAmp(phase.name)} — ${phase.range}`;
    assert.ok(html.includes(label), `missing accessible label for ${phase.slug}: ${label}`);
    const index = html.indexOf(label);
    assert.ok(index > cursor, `${phase.slug} rendered out of order`);
    cursor = index;
  }
});

test("RENDER IsraelSubArcRidge: Kingdom's accessible label calls out the peak; no other phase's does", () => {
  const html = renderToStaticMarkup(
    createElement(IsraelSubArcRidge, { phases: ISRAEL_SUB_ARC_PHASES, selectedSlug: null, onSelect: noop }),
  );
  assert.ok(html.includes("Kingdom — 1 Samuel 1–Proverbs 21, the sub-arc&#x27;s peak"));
  for (const phase of ISRAEL_SUB_ARC_PHASES.filter((p) => !p.peak)) {
    assert.ok(!html.includes(`${htmlAmp(phase.name)} — ${phase.range}, the sub-arc&#x27;s peak`));
  }
});

test("RENDER IsraelSubArcRidge: Kingdom's point renders a larger, filled circle than the other five (the 'peak' visual treatment)", () => {
  const html = renderToStaticMarkup(
    createElement(IsraelSubArcRidge, { phases: ISRAEL_SUB_ARC_PHASES, selectedSlug: null, onSelect: noop }),
  );
  assert.ok(/r="14"[^>]*fill="var\(--gold\)"/.test(html), "expected Kingdom's r=14 gold-filled circle");
  const hollowMatches = html.match(/r="9"[^>]*fill="var\(--shell-bg\)"/g) ?? [];
  assert.equal(hollowMatches.length, 5, "expected exactly five hollow r=9 circles");
});

test("RENDER IsraelSubArcRidge: every point is a focusable, labeled button -- keyboard reachable, not mouse-only", () => {
  const html = renderToStaticMarkup(
    createElement(IsraelSubArcRidge, { phases: ISRAEL_SUB_ARC_PHASES, selectedSlug: null, onSelect: noop }),
  );
  const roleButtonCount = (html.match(/role="button"/g) ?? []).length;
  const tabIndexCount = (html.match(/tabindex="0"/g) ?? []).length;
  const focusableCount = (html.match(/focusable="true"/g) ?? []).length;
  assert.equal(roleButtonCount, 6);
  assert.equal(tabIndexCount, 6);
  assert.equal(focusableCount, 6);
});

test("RENDER IsraelSubArcRidge: keyboard focus has a visible ring, not only a hidden outline", () => {
  const html = renderToStaticMarkup(
    createElement(IsraelSubArcRidge, { phases: ISRAEL_SUB_ARC_PHASES, selectedSlug: null, onSelect: noop }),
  );
  assert.ok(html.includes(".israel-sub-arc-phase:focus .israel-sub-arc-focus-ring"));
  assert.equal((html.match(/class="israel-sub-arc-focus-ring"/g) ?? []).length, 6);
  assert.equal((html.match(/stroke="var\(--shell-crimson-text\)"/g) ?? []).length, 6);
});

test("RENDER IsraelSubArcRidge: the selected phase (and only it) renders aria-pressed=true", () => {
  const html = renderToStaticMarkup(
    createElement(IsraelSubArcRidge, { phases: ISRAEL_SUB_ARC_PHASES, selectedSlug: "kingdom", onSelect: noop }),
  );
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 5);
});

// ---------------------------------------------------------------------------
// C. IsraelSubArcDetail -- hookless, props in / markup out. Now shows real
//    chapters and real, working links instead of a placeholder note.
// ---------------------------------------------------------------------------

test("RENDER IsraelSubArcDetail: phase=null renders nothing", () => {
  const html = renderToStaticMarkup(createElement(IsraelSubArcDetail, { phase: null, onBack: noop }));
  assert.equal(html, "");
});

test("RENDER IsraelSubArcDetail: a selected phase shows its name, its real chapter range, and every real chapter's title -- never a placeholder", () => {
  const exodus = phaseBySlug("exodus")!;
  const html = renderToStaticMarkup(createElement(IsraelSubArcDetail, { phase: exodus, onBack: noop }));
  assert.ok(html.includes("Exodus"));
  assert.ok(html.includes("Exodus 1–Deuteronomy 34"));
  assert.ok(html.includes("The Exodus from Egypt"));
  assert.ok(html.includes("The Law and the Tabernacle at Sinai"));
  assert.ok(html.includes("Forty Years in the Wilderness"));
  assert.ok(!html.includes("would live here"), "the old placeholder note must be gone");
});

test("RENDER IsraelSubArcDetail: one real, working reader link per passage, not one per chapter", () => {
  const patriarchs = phaseBySlug("patriarchs")!;
  const totalPassages = patriarchs.chapters.reduce((sum, chapter) => sum + chapter.passages.length, 0);
  const html = renderToStaticMarkup(createElement(IsraelSubArcDetail, { phase: patriarchs, onBack: noop }));
  const readerLinkCount = (html.match(/href="\/read\//g) ?? []).length;
  assert.equal(readerLinkCount, totalPassages, `expected ${totalPassages} links (one per real passage)`);
});

test("RENDER IsraelSubArcDetail: passage links use the real book/from fields straight off STORY_SPINE, not invented ones", () => {
  const patriarchs = phaseBySlug("patriarchs")!;
  const firstChapter = patriarchs.chapters[0];
  const firstPassage = firstChapter.passages[0];
  const html = renderToStaticMarkup(createElement(IsraelSubArcDetail, { phase: patriarchs, onBack: noop }));
  assert.ok(
    html.includes(`href="/read/${firstPassage.book}/${firstPassage.from}"`),
    `expected a link to /read/${firstPassage.book}/${firstPassage.from}`,
  );
  // A representative NT cross-reference passage this same chapter carries
  // (Genesis 12's chapter also cites Romans 4 and Hebrews 11) -- proves this
  // isn't silently dropping passages outside the "obvious" book.
  assert.ok(html.includes('href="/read/45/4"'), "expected the Romans 4 cross-reference link");
  assert.ok(html.includes('href="/read/58/11"'), "expected the Hebrews 11 cross-reference link");
});

test("RENDER IsraelSubArcDetail: Kingdom is labeled 'Peak of the sub-arc'; a non-peak phase is labeled with its position instead", () => {
  const kingdom = phaseBySlug("kingdom")!;
  const kingdomHtml = renderToStaticMarkup(createElement(IsraelSubArcDetail, { phase: kingdom, onBack: noop }));
  assert.ok(kingdomHtml.includes("Peak of the sub-arc"));

  const patriarchs = phaseBySlug("patriarchs")!;
  const patriarchsHtml = renderToStaticMarkup(
    createElement(IsraelSubArcDetail, { phase: patriarchs, onBack: noop }),
  );
  assert.ok(patriarchsHtml.includes("Phase 1 of 6"));
  assert.ok(!patriarchsHtml.includes("Peak of the sub-arc"));
});

test("RENDER IsraelSubArcDetail: an obvious, labeled way back out is always present alongside the content", () => {
  const kingdom = phaseBySlug("kingdom")!;
  const html = renderToStaticMarkup(createElement(IsraelSubArcDetail, { phase: kingdom, onBack: noop }));
  assert.ok(html.includes('aria-label="Back to the arc"'));
  assert.ok(html.includes("Back to the arc"));
});

// ---------------------------------------------------------------------------
// D. IsraelSubArcPrototype -- the composed shell (heading + ridge + detail
//    sheet). ISRAELFILTER-001 dropped the ISRAELPROTO-001 "testing
//    navigation feel only, not wired into your real study data" banner --
//    it IS wired now -- so this section proves the banner is gone, not that
//    it's present.
// ---------------------------------------------------------------------------

test("RENDER IsraelSubArcPrototype: the honest heading is present and the old 'not wired to real data' banner is gone", async () => {
  const { IsraelSubArcPrototype } = await import("@/components/prototype/IsraelSubArcPrototype");
  const html = renderToStaticMarkup(createElement(IsraelSubArcPrototype));
  assert.ok(html.includes("Israel — six phases"));
  assert.ok(!html.includes('data-testid="israel-sub-arc-banner"'));
  assert.ok(!html.includes("not wired into your real study data"));
});

test("RENDER IsraelSubArcPrototype: the ridge (all six real phases) renders on the same page as the heading", async () => {
  const { IsraelSubArcPrototype } = await import("@/components/prototype/IsraelSubArcPrototype");
  const html = renderToStaticMarkup(createElement(IsraelSubArcPrototype));
  for (const phase of ISRAEL_SUB_ARC_PHASES) {
    assert.ok(html.includes(htmlAmp(phase.name)), `missing ${phase.name} on the composed page`);
  }
});

// ---------------------------------------------------------------------------
// E. Mountain.tsx -- the real entry point. Stage 5 ("Israel") opens the
//    sub-arc sheet instead of navigating; every other stage is unaffected.
// ---------------------------------------------------------------------------

seedModule("@/components/climb/Mountain.module.css", { default: cssProxy });
seedModule("@/components/climb/MountainPlates.module.css", { default: cssProxy });
// MOUNTAINDESKTOP-001 — Mountain.tsx now also renders MountainDesktop.tsx
// (the >=1100px assembly, always mounted -- see Mountain.module.css's
// `.mobileScene`/`.desktopScene` breakpoint), which imports its own CSS
// Module; stub it the same proxy way so tsx never tries to `require()` a
// real .css file as JS.
seedModule("@/components/climb/MountainDesktop.module.css", { default: cssProxy });

const pushed: string[] = [];
seedModule("next/navigation", {
  useRouter: () => ({
    push: (href: string) => {
      pushed.push(href);
    },
  }),
});

const {
  Mountain,
  ISRAEL_STAGE_NUMBER,
  isIsraelWaypoint,
  resolveWaypointAction,
} = nodeRequire("@/components/climb/Mountain") as {
  Mountain: typeof import("../components/climb/Mountain").Mountain;
  ISRAEL_STAGE_NUMBER: typeof import("../components/climb/Mountain").ISRAEL_STAGE_NUMBER;
  isIsraelWaypoint: typeof import("../components/climb/Mountain").isIsraelWaypoint;
  resolveWaypointAction: typeof import("../components/climb/Mountain").resolveWaypointAction;
};

function mkStage(overrides: Partial<MountainStage> & Pick<MountainStage, "slug" | "stage" | "side">): MountainStage {
  return {
    title: `Stage ${overrides.stage}`,
    reference: `Ref ${overrides.stage}`,
    short: "",
    mirror: null,
    firstChapter: "1.1",
    chapterCount: 10,
    threadCount: 0,
    observationCount: 0,
    questionCount: 0,
    studied: false,
    ...overrides,
  };
}

const ELEVEN_STAGES: MountainStage[] = [
  mkStage({ slug: "creation", stage: 1, side: "ascent", firstChapter: "1.1" }),
  mkStage({ slug: "sin-enters", stage: 2, side: "ascent", firstChapter: "1.3" }),
  mkStage({ slug: "the-flood", stage: 3, side: "ascent", firstChapter: "1.6" }),
  mkStage({ slug: "babel", stage: 4, side: "ascent", firstChapter: "1.10" }),
  mkStage({ slug: "israel", stage: 5, side: "ascent", firstChapter: "1.12" }),
  mkStage({ slug: "jesus-christ", stage: 6, side: "peak", firstChapter: "40.1" }),
  mkStage({ slug: "the-church", stage: 7, side: "descent", firstChapter: "44.1" }),
  mkStage({ slug: "babylon", stage: 8, side: "descent", firstChapter: "66.12" }),
  mkStage({ slug: "world-judged", stage: 9, side: "descent", firstChapter: "66.6" }),
  mkStage({ slug: "satan-cast-out", stage: 10, side: "descent", firstChapter: "66.19" }),
  mkStage({ slug: "paradise-restored", stage: 11, side: "descent", firstChapter: "66.21" }),
];

test("ISRAEL_STAGE_NUMBER: is stage 5, matching design/STORY_SPINE_DECISIONS.md decision 4's Israel stage", () => {
  assert.equal(ISRAEL_STAGE_NUMBER, 5);
});

test("isIsraelWaypoint: true only for stage 5, false for every other of the 11 real stages", () => {
  for (const stage of ELEVEN_STAGES) {
    assert.equal(isIsraelWaypoint(stage), stage.stage === 5, `stage ${stage.stage} (${stage.slug})`);
  }
});

test("resolveWaypointAction: stage 5 opens the sub-arc; every other stage navigates with its href completely unchanged", () => {
  for (const stage of ELEVEN_STAGES) {
    const href = `/read/fake/${stage.stage}`;
    const action = resolveWaypointAction(stage, href);
    if (stage.stage === 5) {
      assert.deepEqual(action, { kind: "open-israel-sub-arc" }, "stage 5 must not carry the href through");
    } else {
      assert.deepEqual(action, { kind: "navigate", href }, `stage ${stage.stage} must navigate with its own href, untouched`);
    }
  }
});

// ===========================================================================
// MUTATION-GUARD — if the stage-5 check were accidentally inverted (`!==`)
// or hard-coded to the wrong number, every stage but 5 would open the
// sub-arc and stage 5 alone would navigate -- the opposite of the spec.
// This test fails loudly under that mutation (verified by hand: flipping
// `stage.stage === ISRAEL_STAGE_NUMBER` to `!==` in Mountain.tsx turns this
// red, exactly as expected -- reverted before shipping).
// ===========================================================================
test("MUTATION-GUARD: exactly one of the 11 real stages (5) opens the sub-arc, the other ten navigate", () => {
  const opened = ELEVEN_STAGES.filter((stage) => resolveWaypointAction(stage, "/x").kind === "open-israel-sub-arc");
  assert.deepEqual(opened.map((s) => s.slug), ["israel"]);
  const navigated = ELEVEN_STAGES.filter((stage) => resolveWaypointAction(stage, "/x").kind === "navigate");
  assert.equal(navigated.length, 10);
});

test("RENDER Mountain: the Israel sub-arc's ridge (heading + all six real phase names) is embedded in the tree, ready to open on stage 5", () => {
  pushed.length = 0;
  const html = renderToStaticMarkup(createElement(Mountain, { stages: ELEVEN_STAGES }));
  assert.ok(html.includes("Israel — six phases"), "expected the sub-arc heading somewhere in Mountain's render tree");
  for (const phase of ISRAEL_SUB_ARC_PHASES) {
    assert.ok(html.includes(htmlAmp(phase.name)), `expected phase ${phase.name} embedded in Mountain's render tree`);
  }
});

test("RENDER Mountain: still renders one waypoint button per stage and one ribbon tick per stage -- structurally unaffected by the sub-arc addition", () => {
  const html = renderToStaticMarkup(createElement(Mountain, { stages: ELEVEN_STAGES }));
  assert.equal((html.match(/data-status="/g) ?? []).length, 11, "11 plate waypoints, including stage 5's");
});

test("RENDER Mountain: stage 5's own waypoint still renders a real, focusable waypoint button, same as every other stage", () => {
  const html = renderToStaticMarkup(createElement(Mountain, { stages: ELEVEN_STAGES }));
  assert.ok(html.includes('data-stage-slug="israel"'), "stage 5's waypoint must still render -- only its click behavior changed");
});
