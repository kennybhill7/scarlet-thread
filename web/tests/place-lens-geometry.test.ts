/**
 * PLACELENS-001 — pure projection math (`components/lens/PlaceLens/
 * geometry.ts`) and drag/inertia physics (`rotation.ts`). No DOM, no React:
 * `node:test` straight against the exported functions, same discipline
 * `tests/plate-geometry.test.ts` uses for `lib/climb/plateGeometry.ts`.
 *
 * Author: Kenneth Hill
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  BIBLICAL_WORLD_CENTER,
  buildProjection,
  clamp,
  easeInOutCubic,
  graticulePath,
  isFrontFacing,
  lerp,
  lerpRotation,
  projectPoint,
  sphereOutlinePath,
} from "@/components/lens/PlaceLens/geometry";
import {
  applyDrag,
  applyKeyboardStep,
  clampPhi,
  isSettled,
  PHI_MAX,
  PHI_MIN,
  stepInertia,
} from "@/components/lens/PlaceLens/rotation";

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

test("a point at the rotation center projects to the globe's own translate (dead center)", () => {
  const config = { rotation: { lambda: 35, phi: 31 }, scale: 150, translate: [180, 180] as const };
  const projection = buildProjection(config);
  const point = projectPoint(projection, 35, 31);
  assert.ok(point);
  assert.ok(Math.abs(point![0] - 180) < 0.01);
  assert.ok(Math.abs(point![1] - 180) < 0.01);
});

test("a point well into the far hemisphere does not project (clipAngle(90) drops it)", () => {
  const config = { rotation: { lambda: 0, phi: 0 }, scale: 150, translate: [180, 180] as const };
  const projection = buildProjection(config);
  // 170 degrees away, well clear of the exact-90-degree clip boundary (the
  // mathematical antipode itself, 180 degrees away, is a known degenerate
  // case for an orthographic projection: cos(lambda)=sin(180deg)=0 means the
  // RAW formula maps it to the exact center before clipping even applies,
  // and float trig noise right at cosDistance==0 can tip d3-geo's own clip
  // test either way — not a bug in this module, just not a stable thing to
  // assert at the exact boundary).
  assert.equal(projectPoint(projection, 170, 0), null);
});

test("isFrontFacing agrees with projectPoint returning non-null, for a grid of points clear of the clip boundary", () => {
  const rotation = { lambda: 40, phi: -15 };
  const config = { rotation, scale: 150, translate: [180, 180] as const };
  const projection = buildProjection(config);
  const toRad = Math.PI / 180;
  let checked = 0;
  for (let lon = -180; lon < 180; lon += 20) {
    for (let lat = -80; lat <= 80; lat += 20) {
      // Same formula isFrontFacing uses internally — skip points within ~1
      // degree of the exact 90-degree clip boundary, where projectPoint
      // (d3-geo's own clip) and this cosine test can legitimately disagree
      // by floating-point noise, independent of this module's own logic.
      const cosDistance =
        Math.sin(rotation.phi * toRad) * Math.sin(lat * toRad) +
        Math.cos(rotation.phi * toRad) * Math.cos(lat * toRad) * Math.cos((lon - rotation.lambda) * toRad);
      if (Math.abs(cosDistance) < 0.02) continue;
      checked += 1;
      const front = isFrontFacing(rotation, lon, lat);
      const projected = projectPoint(projection, lon, lat) !== null;
      assert.equal(front, projected, `lon=${lon} lat=${lat}`);
    }
  }
  assert.ok(checked > 100, `expected most of the grid to be checked, got ${checked}`);
});

test("rotating lambda by 180 degrees flips which hemisphere faces the viewer", () => {
  assert.equal(isFrontFacing({ lambda: 0, phi: 0 }, 0, 0), true);
  assert.equal(isFrontFacing({ lambda: 180, phi: 0 }, 0, 0), false);
});

test("sphereOutlinePath and graticulePath return non-empty SVG path data", () => {
  const config = { rotation: { lambda: 0, phi: 0 }, scale: 150, translate: [180, 180] as const };
  const projection = buildProjection(config);
  assert.ok(sphereOutlinePath(projection).startsWith("M"));
  assert.ok(graticulePath(projection).length > 0);
});

test("the biblical-world bbox center is inside the bbox the plan names (24-52E, 24-42N)", () => {
  assert.equal(BIBLICAL_WORLD_CENTER.lambda, 38);
  assert.equal(BIBLICAL_WORLD_CENTER.phi, 33);
});

// ---------------------------------------------------------------------------
// clamp / lerp / easing
// ---------------------------------------------------------------------------

test("clamp keeps a value inside [min, max]", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
});

test("easeInOutCubic is 0 at t=0, 1 at t=1, and monotonic in between", () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  let prev = -1;
  for (let t = 0; t <= 1; t += 0.1) {
    const value = easeInOutCubic(t);
    assert.ok(value >= prev);
    prev = value;
  }
});

test("lerp interpolates linearly", () => {
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(lerp(100, 200, 0), 100);
  assert.equal(lerp(100, 200, 1), 200);
});

test("lerpRotation takes the short way around the dateline (170 -> -170 is a 20deg hop, not 340deg)", () => {
  const a = { lambda: 170, phi: 0 };
  const b = { lambda: -170, phi: 0 };
  const half = lerpRotation(a, b, 0.5);
  // The short way's midpoint is 180 (or -180), not 0.
  assert.ok(Math.abs(Math.abs(half.lambda) - 180) < 0.01, `expected ~180, got ${half.lambda}`);
});

// ---------------------------------------------------------------------------
// rotation.ts — drag/inertia physics (Globe.tsx's reused math)
// ---------------------------------------------------------------------------

test("applyDrag moves lambda/phi proportionally to the pointer delta (0.5 factor, matching Globe.tsx)", () => {
  const start = { lambda: 0, phi: 0 };
  const { rotation, velocity } = applyDrag(start, 20, 10);
  assert.equal(rotation.lambda, 10); // dx * 0.5
  assert.equal(rotation.phi, -5); // -dy * 0.5
  assert.equal(velocity.lambda, 10);
  assert.equal(velocity.phi, -5);
});

test("applyDrag clamps phi at the pole, every step (not just at drag-end)", () => {
  const start = { lambda: 0, phi: PHI_MAX - 1 };
  const { rotation } = applyDrag(start, 0, -100); // large upward drag would overshoot
  assert.equal(rotation.phi, PHI_MAX);
});

test("clampPhi never exceeds [PHI_MIN, PHI_MAX]", () => {
  assert.equal(clampPhi(1000), PHI_MAX);
  assert.equal(clampPhi(-1000), PHI_MIN);
  assert.equal(clampPhi(10), 10);
});

test("stepInertia decays velocity by INERTIA_DECAY and eventually settles", () => {
  let rotation = { lambda: 0, phi: 0 };
  let velocity = { lambda: 5, phi: 0 };
  let frames = 0;
  while (!isSettled(velocity) && frames < 1000) {
    const step = stepInertia(rotation, velocity);
    rotation = step.rotation;
    velocity = step.velocity;
    frames += 1;
  }
  assert.ok(frames > 0 && frames < 1000, `expected inertia to settle, took ${frames} frames`);
  assert.ok(isSettled(velocity));
});

test("applyKeyboardStep moves lambda left/right and phi up/down by the fixed step, clamped", () => {
  const start = { lambda: 0, phi: 0 };
  assert.equal(applyKeyboardStep(start, "ArrowRight").lambda, 12);
  assert.equal(applyKeyboardStep(start, "ArrowLeft").lambda, -12);
  assert.equal(applyKeyboardStep(start, "ArrowUp").phi, 12);
  assert.equal(applyKeyboardStep(start, "ArrowDown").phi, -12);
  assert.equal(applyKeyboardStep({ lambda: 0, phi: PHI_MAX }, "ArrowUp").phi, PHI_MAX);
});
