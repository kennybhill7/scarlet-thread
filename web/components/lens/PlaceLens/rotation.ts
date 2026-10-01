/**
 * PLACELENS-001 — drag + inertia physics, reused almost verbatim from
 * `components/opening/Globe.tsx` (the CSS 3D globe from the opening
 * sequence; see PRODUCT_EXPERIENCE_PLAN §C.6.1: "the existing Globe.tsx
 * drag/inertia code is reusable almost verbatim"). Same constants
 * (`INERTIA_DECAY`, `INERTIA_STOP_VELOCITY`, the 0.5 drag-to-velocity
 * factor), same two-phase shape (drag updates position directly; release
 * hands off to a decaying-velocity loop) — pulled out here as plain,
 * hookless functions operating on `{ lambda, phi }` (geographic degrees)
 * instead of Globe.tsx's `{ x, y }` (CSS rotateX/rotateY degrees), so the
 * physics is `node:test`-able with no DOM and no `requestAnimationFrame`.
 * `useGlobeRotation.ts` is the "use client" hook that drives this with real
 * pointer events, the way `Globe`'s `onPointerMove`/`runInertia` do.
 *
 * One deliberate difference from Globe.tsx: `phi` (tilt) is clamped to keep
 * the pole out of reach (`PHI_MIN`/`PHI_MAX`), exactly as Globe.tsx clamps
 * its `x` to [-50, 50] — same reason, a sphere that can flip past its own
 * pole reads as broken, not as "a globe you can turn". `lambda` (spin) is
 * never clamped, same as Globe.tsx's `y`.
 */
import type { Rotation } from "./geometry";

export const INERTIA_DECAY = 0.94;
export const INERTIA_STOP_VELOCITY = 0.02;
export const DRAG_TO_VELOCITY = 0.5;
export const PHI_MIN = -85;
export const PHI_MAX = 85;

export function clampPhi(phi: number): number {
  return Math.min(PHI_MAX, Math.max(PHI_MIN, phi));
}

export interface RotationVelocity {
  lambda: number;
  phi: number;
}

/**
 * One pointer-move step: `dx`/`dy` are the raw pixel delta since the last
 * move event. Returns the next rotation (phi clamped) and the velocity a
 * release should hand off to `stepInertia`. Mirrors Globe.tsx's
 * `onPointerMove` body exactly (same 0.5 factor, same clamp-on-every-step
 * discipline — a clamp applied only at drag-end would let phi overshoot
 * mid-drag and snap back, which reads as the globe fighting the pointer).
 */
export function applyDrag(
  rotation: Rotation,
  dx: number,
  dy: number,
): { rotation: Rotation; velocity: RotationVelocity } {
  const velocity: RotationVelocity = { lambda: dx * DRAG_TO_VELOCITY, phi: -dy * DRAG_TO_VELOCITY };
  return {
    rotation: {
      lambda: rotation.lambda + velocity.lambda,
      phi: clampPhi(rotation.phi + velocity.phi),
    },
    velocity,
  };
}

/**
 * One inertia animation-frame step: decays `velocity` and applies it to
 * `rotation`. Mirrors Globe.tsx's `runInertia` callback body. The caller
 * stops scheduling frames once `isSettled(next.velocity)` is true — same
 * `INERTIA_STOP_VELOCITY` threshold Globe.tsx checks on both axes.
 */
export function stepInertia(
  rotation: Rotation,
  velocity: RotationVelocity,
): { rotation: Rotation; velocity: RotationVelocity } {
  const nextVelocity: RotationVelocity = {
    lambda: velocity.lambda * INERTIA_DECAY,
    phi: velocity.phi * INERTIA_DECAY,
  };
  return {
    rotation: {
      lambda: rotation.lambda + nextVelocity.lambda,
      phi: clampPhi(rotation.phi + nextVelocity.phi),
    },
    velocity: nextVelocity,
  };
}

export function isSettled(velocity: RotationVelocity): boolean {
  return Math.abs(velocity.lambda) <= INERTIA_STOP_VELOCITY && Math.abs(velocity.phi) <= INERTIA_STOP_VELOCITY;
}

/** Keyboard step (arrow keys), same 12° step Globe.tsx uses. */
export const KEYBOARD_STEP_DEG = 12;

export function applyKeyboardStep(
  rotation: Rotation,
  key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
): Rotation {
  switch (key) {
    case "ArrowLeft":
      return { ...rotation, lambda: rotation.lambda - KEYBOARD_STEP_DEG };
    case "ArrowRight":
      return { ...rotation, lambda: rotation.lambda + KEYBOARD_STEP_DEG };
    case "ArrowUp":
      return { ...rotation, phi: clampPhi(rotation.phi + KEYBOARD_STEP_DEG) };
    case "ArrowDown":
      return { ...rotation, phi: clampPhi(rotation.phi - KEYBOARD_STEP_DEG) };
  }
}
