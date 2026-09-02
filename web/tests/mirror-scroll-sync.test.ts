/**
 * MIRRORSPLIT-001 — unit tests for lib/mirror/scrollSync.ts, the "matching-
 * index math" behind the Mirror Split reader's two-pane scroll sync
 * (components/mirror/MirrorSplitView.tsx). Pure functions, no DOM, no
 * stubbing required — see this task's report for the mutation-proof pass
 * over `mirroredScrollTop` and `ScrollSyncGuard.shouldIgnore`, the two
 * functions a bug here would most silently break (a wrong fraction, or a
 * guard that never releases and freezes one pane's sync forever).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  mirroredScrollTop,
  scrollFraction,
  ScrollSyncGuard,
  type ScrollMetrics,
} from "@/lib/mirror/scrollSync";

function metrics(scrollTop: number, scrollHeight: number, clientHeight: number): ScrollMetrics {
  return { scrollTop, scrollHeight, clientHeight };
}

// ---------------------------------------------------------------------------
// scrollFraction
// ---------------------------------------------------------------------------

test("scrollFraction: top of content is 0", () => {
  assert.equal(scrollFraction(metrics(0, 2000, 800)), 0);
});

test("scrollFraction: bottom of content is 1", () => {
  assert.equal(scrollFraction(metrics(1200, 2000, 800)), 1);
});

test("scrollFraction: midway is the exact proportion", () => {
  // max scrollable = 2000 - 800 = 1200; halfway = 600
  assert.equal(scrollFraction(metrics(600, 2000, 800)), 0.5);
});

test("scrollFraction: content that fits the viewport (no overflow) is 0, not NaN", () => {
  assert.equal(scrollFraction(metrics(0, 400, 800)), 0);
  assert.equal(scrollFraction(metrics(0, 800, 800)), 0);
});

test("scrollFraction: clamps an over-scrolled value (elastic/bounce overscroll) to 1", () => {
  assert.equal(scrollFraction(metrics(1500, 2000, 800)), 1);
});

test("scrollFraction: clamps a negative scrollTop (elastic overscroll at the top) to 0", () => {
  assert.equal(scrollFraction(metrics(-40, 2000, 800)), 0);
});

// ---------------------------------------------------------------------------
// mirroredScrollTop
// ---------------------------------------------------------------------------

test("mirroredScrollTop: same fraction lands at the target's own proportional position", () => {
  // source at 50% through a 1200px-scrollable pane
  const source = metrics(600, 2000, 800);
  // target is a much longer chapter: 5000 tall in a 800 viewport -> max 4200
  const target = { scrollHeight: 5000, clientHeight: 800 };
  assert.equal(mirroredScrollTop(source, target), 2100); // 50% of 4200
});

test("mirroredScrollTop: top stays top regardless of the two panes' relative lengths", () => {
  const source = metrics(0, 2000, 800);
  assert.equal(mirroredScrollTop(source, { scrollHeight: 9000, clientHeight: 800 }), 0);
});

test("mirroredScrollTop: bottom stays bottom regardless of the two panes' relative lengths", () => {
  const source = metrics(1200, 2000, 800); // 100%
  assert.equal(mirroredScrollTop(source, { scrollHeight: 9000, clientHeight: 800 }), 8200);
});

test("mirroredScrollTop: a target with no overflow of its own is always 0", () => {
  const source = metrics(600, 2000, 800); // 50%
  assert.equal(mirroredScrollTop(source, { scrollHeight: 500, clientHeight: 800 }), 0);
});

test("mirroredScrollTop: rounds to a whole pixel", () => {
  // source fraction = 1/3; target max = 1000 -> 333.33... -> 333
  const source = metrics(100, 400, 100); // max 300, fraction 1/3
  assert.equal(mirroredScrollTop(source, { scrollHeight: 1100, clientHeight: 100 }), 333);
});

// ---------------------------------------------------------------------------
// ScrollSyncGuard — the feedback-loop breaker
// ---------------------------------------------------------------------------

test("ScrollSyncGuard: an armed pane's next scroll event is ignored exactly once", () => {
  const guard = new ScrollSyncGuard();
  guard.arm("right");
  assert.equal(guard.shouldIgnore("right"), true);
  // Consumed -- the NEXT event on the same pane is a real one again.
  assert.equal(guard.shouldIgnore("right"), false);
});

test("ScrollSyncGuard: arming one pane never suppresses the other", () => {
  const guard = new ScrollSyncGuard();
  guard.arm("left");
  assert.equal(guard.shouldIgnore("right"), false);
  // The left arm is still live -- unaffected by checking the other pane.
  assert.equal(guard.shouldIgnore("left"), true);
});

test("ScrollSyncGuard: with nothing armed, no pane's scroll is ever ignored", () => {
  const guard = new ScrollSyncGuard();
  assert.equal(guard.shouldIgnore("left"), false);
  assert.equal(guard.shouldIgnore("right"), false);
});

test("ScrollSyncGuard: re-arming the same pane before it fires replaces the mark, not stacks it", () => {
  const guard = new ScrollSyncGuard();
  guard.arm("left");
  guard.arm("left");
  assert.equal(guard.shouldIgnore("left"), true);
  // Only one ignored event was ever queued, not two.
  assert.equal(guard.shouldIgnore("left"), false);
});

test("round trip: mirroring A->B and then B->A (post-guard) drifts by at most one rounded pixel IN B's SCALE", () => {
  // Rounding to a whole pixel happens once per conversion. A round trip
  // through a MUCH shorter target pane (B) is where that shows up most:
  // the forward conversion rounds to the nearest pixel of B's smaller
  // scale (max error 0.5px there), and the return conversion re-expresses
  // that same 0.5px error back in A's much larger scale, scaled by
  // maxA/maxB. This is not drift in ScrollSyncGuard's guard logic (which
  // only ever fires once per genuine scroll and never re-enters) — it is
  // this test proving the bound is exactly what the scale ratio predicts,
  // not unbounded.
  const a = { scrollHeight: 3000, clientHeight: 700 }; // maxA = 2300
  const b = { scrollHeight: 1200, clientHeight: 700 }; // maxB = 500
  const aScrollTop = 900;

  const bTop = mirroredScrollTop(metrics(aScrollTop, a.scrollHeight, a.clientHeight), b);
  const aTopBack = mirroredScrollTop(metrics(bTop, b.scrollHeight, b.clientHeight), a);

  const maxA = a.scrollHeight - a.clientHeight;
  const maxB = b.scrollHeight - b.clientHeight;
  const bound = Math.ceil(0.5 * (maxA / maxB)) + 1; // +1 for the return conversion's own rounding

  assert.ok(
    Math.abs(aTopBack - aScrollTop) <= bound,
    `round trip drifted ${Math.abs(aTopBack - aScrollTop)}px, more than the ${bound}px the scale ratio predicts: started at ${aScrollTop}, came back to ${aTopBack}`,
  );
});

test("round trip: mirroring between two similarly-sized panes drifts by at most one pixel", () => {
  const a = { scrollHeight: 2000, clientHeight: 800 };
  const b = { scrollHeight: 2200, clientHeight: 800 };
  const aScrollTop = 500;

  const bTop = mirroredScrollTop(metrics(aScrollTop, a.scrollHeight, a.clientHeight), b);
  const aTopBack = mirroredScrollTop(metrics(bTop, b.scrollHeight, b.clientHeight), a);

  assert.ok(
    Math.abs(aTopBack - aScrollTop) <= 1,
    `round trip drifted more than one pixel: started at ${aScrollTop}, came back to ${aTopBack}`,
  );
});
