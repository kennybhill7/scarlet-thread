"use client";

import { useEffect, useRef, useState } from "react";

import type { Rotation } from "./geometry";
import {
  applyDrag,
  applyKeyboardStep,
  isSettled,
  stepInertia,
  type RotationVelocity,
} from "./rotation";

/**
 * PLACELENS-001 — the "use client" half of the drag/inertia reuse from
 * `components/opening/Globe.tsx` (see `rotation.ts`'s header for the pure
 * physics this wraps). Structurally mirrors `Globe`'s own
 * `onPointerDown`/`onPointerMove`/`onPointerUp`/`runInertia`/`onKeyDown` —
 * same `setPointerCapture`, same drag-ref-plus-rAF-loop shape, same
 * `prefers-reduced-motion` guard on every self-propelled frame (inertia only
 * — a direct drag is the user's own motion, so it is never itself gated the
 * way Globe.tsx's own inertia loop isn't gated on direct drag either).
 */
const DRAG_MOVE_THRESHOLD_PX = 8;

export interface UseGlobeRotationResult {
  rotation: Rotation;
  setRotation: (rotation: Rotation) => void;
  bind: {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  };
}

function reducedMotionActive(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useGlobeRotation(initial: Rotation): UseGlobeRotationResult {
  const [rotation, setRotationState] = useState<Rotation>(initial);
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;

  const dragRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    startX: number;
    startY: number;
    velocity: RotationVelocity;
    moved: boolean;
  } | null>(null);
  const frameRef = useRef(0);

  function setRotation(next: Rotation) {
    rotationRef.current = next;
    setRotationState(next);
  }

  function runInertia() {
    if (reducedMotionActive()) return;
    const drag = dragRef.current;
    if (!drag) return;
    frameRef.current = window.requestAnimationFrame(() => {
      const step = stepInertia(rotationRef.current, drag.velocity);
      drag.velocity = step.velocity;
      setRotation(step.rotation);
      if (!isSettled(step.velocity)) runInertia();
    });
  }

  function onPointerDown(event: React.PointerEvent<HTMLElement>) {
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    dragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      velocity: { lambda: 0, phi: 0 },
      moved: false,
    };
  }

  function onPointerMove(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (
      !drag.moved &&
      (Math.abs(event.clientX - drag.startX) > DRAG_MOVE_THRESHOLD_PX ||
        Math.abs(event.clientY - drag.startY) > DRAG_MOVE_THRESHOLD_PX)
    ) {
      drag.moved = true;
    }
    const step = applyDrag(rotationRef.current, dx, dy);
    drag.velocity = step.velocity;
    setRotation(step.rotation);
  }

  function onPointerUp(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) runInertia();
    dragRef.current = null;
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown"
    ) {
      return;
    }
    event.preventDefault();
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    setRotation(applyKeyboardStep(rotationRef.current, event.key));
  }

  useEffect(() => () => {
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
  }, []);

  return {
    rotation,
    setRotation,
    bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onKeyDown },
  };
}
