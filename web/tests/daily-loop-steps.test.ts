/**
 * SCARLETTHREAD-001 -- `components/notes/DailyLoop.tsx`'s step row, rebuilt
 * from a 5-up grid of circles into a vertical "rope of knots" (see
 * `design/scarlet-thread-app/Scarlet Thread App.dc.html`'s "Tap the knots"
 * prototype). The rebuild is layout/CSS only -- toggleStep, aria-pressed,
 * data-complete and disabled are all unchanged (verified by reading the
 * component, not re-tested here; there is no pre-existing test for them to
 * regress). The one genuinely new piece of logic the rebuild introduces is
 * choosing which knot gets the scarlet OUTLINE ring (the next actionable
 * step) versus a plain gray outline or a filled scarlet knot -- that logic
 * is `nextIncompleteStepKey`, exported specifically so it is testable here.
 *
 * TEST-ENVIRONMENT NOTE (same discipline as tests/thread-detail.test.ts,
 * whose header comment this follows): this repo's test script is
 * `tsx --test tests/*.test.ts` -- plain Node, no jsdom, no CSS Modules
 * loader. `DailyLoop.tsx` transitively imports `lib/sync/store.ts`, which
 * calls `openDB(...)` at module load, so "fake-indexeddb/auto" is imported
 * first (thread-detail.test.ts's own precedent). Its `.module.css` import is
 * stubbed with a proxy before the real component is required, so requiring
 * it never touches an actual CSS-Modules loader. `nextIncompleteStepKey` is
 * then called directly as a plain function -- it touches no React state and
 * needs no rendering at all.
 */
import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import type { DailyLog } from "@/lib/contracts";

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

const cssProxy = new Proxy(
  {},
  { get: (_target, key) => (typeof key === "string" ? key : undefined) },
);

seedModule("@/components/notes/daily-loop.module.css", { default: cssProxy });

const dailyLoopModule = nodeRequire("@/components/notes/DailyLoop.tsx") as {
  nextIncompleteStepKey: (steps: DailyLog["steps"]) => keyof DailyLog["steps"] | undefined;
};
const { nextIncompleteStepKey } = dailyLoopModule;

function steps(overrides: Partial<DailyLog["steps"]> = {}): DailyLog["steps"] {
  return {
    read: false,
    observe: false,
    link: false,
    ask: false,
    pray: false,
    ...overrides,
  };
}

// MUTATION-PROOF TARGET: which knot gets the scarlet outline ring. Breaking
// the fixed read/observe/link/ask/pray order, or the "first not-done wins"
// rule, must fail one of the named tests below.

test("nextIncompleteStepKey: a brand-new day's next step is Read, the first in order", () => {
  assert.equal(nextIncompleteStepKey(steps()), "read");
});

test("nextIncompleteStepKey: returns the first NOT-done step, not the first step outright", () => {
  assert.equal(nextIncompleteStepKey(steps({ read: true })), "observe");
  assert.equal(nextIncompleteStepKey(steps({ read: true, observe: true })), "link");
});

test("nextIncompleteStepKey: an earlier completed step does not shadow a later incomplete one", () => {
  // link (step 3) done, ask/pray not -- observe (step 2) is still the
  // reported "next", proving the search is a left-to-right scan in the
  // fixed order, not "highest completed index + 1".
  assert.equal(nextIncompleteStepKey(steps({ read: true, link: true })), "observe");
});

test("nextIncompleteStepKey: the last remaining step is Pray when everything else is done", () => {
  assert.equal(
    nextIncompleteStepKey(steps({ read: true, observe: true, link: true, ask: true })),
    "pray",
  );
});

test("nextIncompleteStepKey: undefined once every step is done -- nothing is 'next' on a finished day", () => {
  assert.equal(
    nextIncompleteStepKey(steps({ read: true, observe: true, link: true, ask: true, pray: true })),
    undefined,
  );
});
