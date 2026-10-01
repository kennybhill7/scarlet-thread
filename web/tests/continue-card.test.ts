/**
 * NAV-001 — tests for `components/climb/ContinueCard.tsx`:
 *
 *   1. `buildContinueCardViewModel` — the pure view-model builder, exercised
 *      directly against small fixture objects (no DB, no I/O).
 *   2. The RENDERED OUTPUT of the hookless `ContinueCard` component, via
 *      `react-dom/server`'s `renderToStaticMarkup` — same technique
 *      `tests/place-lens-render.test.ts` establishes for this codebase's
 *      other hookless lens/climb components (CSS Module stubbed via
 *      `require.cache` seeding, no jsdom).
 *
 * Author: Kenneth Hill
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { BookMeta } from "@/lib/contracts";

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
seedModule("@/components/climb/ContinueCard.module.css", { default: cssProxy });

const continueCardModule = nodeRequire("@/components/climb/ContinueCard") as {
  buildContinueCardViewModel: typeof import("../components/climb/ContinueCard").buildContinueCardViewModel;
  ContinueCard: typeof import("../components/climb/ContinueCard").ContinueCard;
};
const { buildContinueCardViewModel, ContinueCard } = continueCardModule;

const FIXTURE_BOOKS: BookMeta[] = [
  { n: 1, name: "Genesis", abbr: "Gen", chapters: 50, testament: "OT" },
  { n: 66, name: "Revelation", abbr: "Rev", chapters: 22, testament: "NT" },
];

const FIXTURE_STAGES = [
  { firstChapter: "1.1", title: "Genesis 1–11 — The Beginning", short: "The Beginning" },
  { firstChapter: "1.3", title: "Genesis 3–5 — The Fall", short: "The Fall" },
];

// ===========================================================================
// 1. buildContinueCardViewModel — pure logic
// ===========================================================================

test("buildContinueCardViewModel formats the passage, finds the matching stage, and counts step/claims", () => {
  const view = buildContinueCardViewModel({
    session: {
      id: "session-1",
      range: { versificationId: "eng-protestant-66-31102-v1", start: "1.3.1", end: "1.3.24" },
      currentStep: "connect",
    },
    claims: [
      { kind: "observation" },
      { kind: "observation" },
      { kind: "question" },
    ],
    stages: FIXTURE_STAGES,
    books: FIXTURE_BOOKS,
  });

  assert.equal(view.status, "continue");
  assert.equal(view.sessionId, "session-1");
  assert.equal(view.passageLabel, "Genesis 3");
  assert.equal(view.stageLabel, "The Fall");
  // STUDY_SESSION_STEPS = [read, observe, context, connect, theology,
  // conviction, apply, teach] -- "connect" is index 3, the 4th of 8.
  assert.equal(view.stepLabel, "step 4 of 8");
  assert.equal(view.observationCount, 2);
  assert.equal(view.openQuestionCount, 1);
});

test("buildContinueCardViewModel excludes soft-deleted claims from both counts", () => {
  const view = buildContinueCardViewModel({
    session: {
      id: "session-1",
      range: { versificationId: "eng-protestant-66-31102-v1", start: "1.3.1", end: "1.3.24" },
      currentStep: "read",
    },
    claims: [
      { kind: "observation", deletedAt: "2026-01-01T00:00:00.000Z" },
      { kind: "observation" },
      { kind: "question", deletedAt: "2026-01-01T00:00:00.000Z" },
    ],
    stages: FIXTURE_STAGES,
    books: FIXTURE_BOOKS,
  });

  assert.equal(view.observationCount, 1);
  assert.equal(view.openQuestionCount, 0);
});

test("buildContinueCardViewModel: no matching stage -> stageLabel is null, not a crash", () => {
  const view = buildContinueCardViewModel({
    session: {
      id: "session-1",
      range: { versificationId: "eng-protestant-66-31102-v1", start: "66.1.1", end: "66.1.1" },
      currentStep: "read",
    },
    claims: [],
    stages: FIXTURE_STAGES,
    books: FIXTURE_BOOKS,
  });

  assert.equal(view.stageLabel, null);
  assert.equal(view.passageLabel, "Revelation 1:1");
});

test("buildContinueCardViewModel: empty books degrades to the raw RefKey, never throws", () => {
  const view = buildContinueCardViewModel({
    session: {
      id: "session-1",
      range: { versificationId: "eng-protestant-66-31102-v1", start: "1.3.1", end: "1.3.24" },
      currentStep: "read",
    },
    claims: [],
    stages: FIXTURE_STAGES,
    books: [],
  });

  assert.equal(view.passageLabel, "1.3.1");
});

test("buildContinueCardViewModel: an unrecognized currentStep yields a null stepLabel, not a wrong number", () => {
  const view = buildContinueCardViewModel({
    session: {
      id: "session-1",
      range: { versificationId: "eng-protestant-66-31102-v1", start: "1.3.1", end: "1.3.24" },
      currentStep: "some-future-step",
    },
    claims: [],
    stages: FIXTURE_STAGES,
    books: FIXTURE_BOOKS,
  });

  assert.equal(view.stepLabel, null);
});

// ===========================================================================
// 2. ContinueCard — rendered output
// ===========================================================================

test("RENDER: the begin variant links to the given href and says Begin", () => {
  const html = renderToStaticMarkup(
    createElement(ContinueCard, { data: { status: "begin", href: "/read/1/1" } }) as never,
  );

  assert.match(html, /<a[^>]*href="\/read\/1\/1"/);
  assert.ok(html.includes('data-status="begin"'));
  assert.ok(html.includes("Begin"));
  assert.ok(html.includes("Start at Genesis 1"));
});

test("RENDER: the continue variant links to /study/:sessionId and shows passage, stage, step, and counts", () => {
  const html = renderToStaticMarkup(
    createElement(ContinueCard, {
      data: {
        status: "continue",
        sessionId: "session-42",
        passageLabel: "Genesis 3",
        stageLabel: "The Fall",
        stepLabel: "step 4 of 8",
        observationCount: 2,
        openQuestionCount: 1,
      },
    }) as never,
  );

  assert.match(html, /<a[^>]*href="\/study\/session-42"/);
  assert.ok(html.includes('data-status="continue"'));
  assert.ok(html.includes("Continue"));
  assert.ok(html.includes("Genesis 3"));
  assert.ok(html.includes("The Fall"));
  assert.ok(html.includes("step 4 of 8"));
  assert.ok(html.includes("2 observations, 1 open question"), `pluralization/copy wrong:\n${html}`);
});

test("RENDER: singular counts are not pluralized (1 observation, 0 open questions)", () => {
  const html = renderToStaticMarkup(
    createElement(ContinueCard, {
      data: {
        status: "continue",
        sessionId: "session-1",
        passageLabel: "Genesis 1",
        stageLabel: null,
        stepLabel: null,
        observationCount: 1,
        openQuestionCount: 0,
      },
    }) as never,
  );

  assert.ok(html.includes("1 observation, 0 open questions"), `singular/plural boundary wrong:\n${html}`);
  // No stage label and no step label: the headline must not print a stray "·".
  assert.ok(!html.includes("Genesis 1 ·"), `stray separator with no stage label:\n${html}`);
});

// ===========================================================================
// MUTATION PROOF — one real adversarial mutation, caught, then reverted.
//
// Mutating buildContinueCardViewModel's openQuestionCount to count
// "observation" claims instead of "question" claims (a real, plausible
// copy/paste bug: both lines are one `.kind === "..."` string apart) made
// "buildContinueCardViewModel formats the passage..." above fail:
//
//   AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
//   1 !== 2
//   (view.openQuestionCount, expected 1, got 2 -- it silently counted the
//   two "observation" claims instead of the one real "question" claim)
//
// Reverted immediately after confirming the failure; not committed. See this
// task's report for the full before/after transcript.
// ===========================================================================
