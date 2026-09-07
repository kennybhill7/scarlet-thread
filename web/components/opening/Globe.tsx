"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./Globe.module.css";

/**
 * OPENING-001, beat 1 — "like a kid's body playing with a globe"
 * (design/OPENING_SEQUENCE_VISION.md). An interactive stone/parchment-toned
 * sphere built from CSS 3D transforms (rotateX/rotateY, `perspective`,
 * `transform-style: preserve-3d`) — no WebGL, no three.js, no photoreal
 * Earth texture. This is genuinely greenfield in this codebase (no existing
 * rotateX/rotateY/perspective/preserve-3d usage anywhere), so the visual
 * treatment below is a creative call: a wireframe/graticule sphere (stacked
 * meridian/parallel rings) plus a few simple non-geographic "landmass"
 * blobs, all in the app's real `--shell-*` palette, rather than an attempt
 * at geographic accuracy — it needs to read as "a globe you can turn," not
 * pass a map quiz.
 *
 * Two pieces, same split Mountain.tsx uses between itself (hooks: routing,
 * drag/scroll state) and its hookless children (MountainPlates/MountainDesktop:
 * props in, markup out, renderToStaticMarkup-testable):
 *
 *   GlobeSphere — hookless. Pure props (rotateX/rotateY) to markup. This is
 *   the piece tests/opening-sequence.test.ts and the visual-check harness
 *   render directly.
 *
 *   Globe (default export) — "use client", owns the actual drag/inertia
 *   interaction and the auto-advance timing, renders <GlobeSphere>.
 */

// --- Hookless sphere markup --------------------------------------------------

const MERIDIAN_ANGLES = [0, 30, 60, 90, 120, 150] as const;
const PARALLEL_LATITUDES = [-60, -30, 0, 30, 60] as const;

/**
 * Fixed pixel diameter (matched by Globe.module.css's `.sphere` width/height
 * rule, kept in sync by hand — see that file). translateZ() below needs a
 * real length rather than a percentage, so the sphere's own size has to be
 * a real value both files agree on, not a responsive percentage.
 */
const SPHERE_DIAMETER_PX = 220;

/**
 * A handful of simple, non-geographic landmass blobs fixed to the sphere's
 * surface (so they turn WITH it) — just enough visual incident to read as
 * "a world," not an attempt at real continents. Static data, not computed
 * per render, so the resting frame is deterministic for the screenshot
 * harness and for tests.
 */
const LANDMASSES = [
  { rotateY: 10, rotateX: 12, width: 30, height: 22 },
  { rotateY: 70, rotateX: -18, width: 22, height: 26 },
  { rotateY: 140, rotateX: 8, width: 26, height: 18 },
  { rotateY: 200, rotateX: -10, width: 20, height: 20 },
  { rotateY: 260, rotateX: 20, width: 24, height: 16 },
  { rotateY: 320, rotateX: -6, width: 18, height: 22 },
] as const;

export interface GlobeSphereProps {
  rotateX: number;
  rotateY: number;
  className?: string;
}

/** Hookless — props in, markup out. See this file's header. */
export function GlobeSphere({ rotateX, rotateY, className }: GlobeSphereProps) {
  return (
    <div className={[styles.stage, className].filter(Boolean).join(" ")}>
      {/* The solid globe "body" does NOT rotate -- it is a plain filled
          circle behind the wireframe, so the sphere always reads as a solid
          object no matter the angle (there is no real per-face texture to
          rotate). Only the graticule + landmasses below, inside the
          preserve-3d group, actually turn. */}
      <div className={styles.base} aria-hidden="true" />
      <div
        className={styles.sphere}
        style={{ transform: `rotateX(${rotateX}deg) rotateY(${rotateY}deg)` }}
        data-testid="globe-sphere"
      >
        {PARALLEL_LATITUDES.map((lat) => {
          // A latitude ring on a sphere is a small circle: radius shrinks by
          // cos(lat) and its center sits cos/sin(lat)*radius off the
          // equatorial plane. translateY moves it to that height (in the
          // sphere's own, not-yet-rotated frame); rotateX(90deg) then lays
          // that same ring flat so it reads as a horizontal parallel once
          // the whole .sphere group turns; scale(cos) is the shrink. Order
          // matters: each function transforms in the frame already set up
          // by the one before it, so translate-then-rotate-then-scale (all
          // still centered on the ring's own middle) is what keeps this a
          // real small circle instead of a flat equator repeated five times.
          const radians = (lat * Math.PI) / 180;
          const verticalOffsetPct = -Math.sin(radians) * 50;
          const radiusScale = Math.cos(radians);
          return (
            <div
              key={`parallel-${lat}`}
              className={styles.parallel}
              style={{
                transform: `translateY(${verticalOffsetPct}%) rotateX(90deg) scale(${radiusScale})`,
              }}
              aria-hidden="true"
            />
          );
        })}
        {MERIDIAN_ANGLES.map((angle) => (
          <div
            key={`meridian-${angle}`}
            className={styles.meridian}
            style={{ transform: `rotateY(${angle}deg)` }}
            aria-hidden="true"
          />
        ))}
        {LANDMASSES.map((blob, index) => (
          <div
            key={`land-${index}`}
            className={styles.landmass}
            style={{
              // translateZ needs a real length, not a percentage, so this
              // pins landmasses to the sphere's actual radius (SPHERE_DIAMETER_PX
              // below, half of it) — kept in sync with the fixed width/height
              // Globe.module.css gives .sphere, the same hand-kept-in-sync
              // discipline lib/theme.ts documents for its own duplicated
              // constants.
              transform: `rotateY(${blob.rotateY}deg) rotateX(${blob.rotateX}deg) translateZ(${SPHERE_DIAMETER_PX / 2}px)`,
              width: `${blob.width}%`,
              height: `${blob.height}%`,
            }}
            aria-hidden="true"
          />
        ))}
      </div>
      <div className={styles.highlight} aria-hidden="true" />
    </div>
  );
}

// --- Interactive wrapper ------------------------------------------------------

const ROTATE_X_MIN = -50;
const ROTATE_X_MAX = 50;
const DRAG_MOVE_THRESHOLD_PX = 8;
const INERTIA_DECAY = 0.94;
const INERTIA_STOP_VELOCITY = 0.02;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface GlobeProps {
  /** Called exactly once, whether the user drags, waits out the timeout, or
   *  presses Continue. */
  onAdvance: () => void;
  /** Auto-advances if the visitor never touches the globe — never a forced
   *  wait with no way out (a Continue button is always visible too). */
  autoAdvanceMs?: number;
  /** How long to hold on the settled globe after a genuine drag before
   *  advancing, so the interaction itself is felt rather than cut off. */
  interactedAdvanceMs?: number;
}

export function Globe({
  onAdvance,
  autoAdvanceMs = 7000,
  interactedAdvanceMs = 900,
}: GlobeProps) {
  const [rotation, setRotation] = useState({ x: -8, y: 0 });
  const advancedRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    startX: number;
    startY: number;
    velocityX: number;
    velocityY: number;
    moved: boolean;
  } | null>(null);
  const frameRef = useRef(0);
  const timersRef = useRef<number[]>([]);

  function advanceOnce() {
    if (advancedRef.current) return;
    advancedRef.current = true;
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    onAdvance();
  }

  // Auto-advance timeout — the "shouldn't feel like a forced wait" half of
  // requirement 1: a visitor who never touches the globe still moves on.
  // Reduced-motion visitors never mount this component at all (see
  // OpeningSequence.tsx), so no reduced-motion guard is needed here for the
  // timer itself; the requestAnimationFrame inertia loop below still checks
  // matchMedia directly as a second, independent guarantee (belt and
  // suspenders, same rigor Mountain.tsx applies to its own motion source).
  useEffect(() => {
    const id = window.setTimeout(advanceOnce, autoAdvanceMs);
    timersRef.current.push(id);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAdvanceMs]);

  function reducedMotionActive(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function runInertia() {
    if (reducedMotionActive()) return;
    const drag = dragRef.current;
    frameRef.current = window.requestAnimationFrame(() => {
      setRotation((prev) => {
        const vx = (dragRef.current?.velocityX ?? 0) * INERTIA_DECAY;
        const vy = (dragRef.current?.velocityY ?? 0) * INERTIA_DECAY;
        if (dragRef.current) {
          dragRef.current.velocityX = vx;
          dragRef.current.velocityY = vy;
        }
        return {
          x: clamp(prev.x + vy, ROTATE_X_MIN, ROTATE_X_MAX),
          y: prev.y + vx,
        };
      });
      const vx = dragRef.current?.velocityX ?? 0;
      const vy = dragRef.current?.velocityY ?? 0;
      if (Math.abs(vx) > INERTIA_STOP_VELOCITY || Math.abs(vy) > INERTIA_STOP_VELOCITY) {
        runInertia();
      } else if (drag?.moved) {
        const id = window.setTimeout(advanceOnce, interactedAdvanceMs);
        timersRef.current.push(id);
      }
    });
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (reducedMotionActive()) return;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    dragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      velocityX: 0,
      velocityY: 0,
      moved: false,
    };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.velocityX = dx * 0.5;
    drag.velocityY = dy * 0.5;
    if (
      !drag.moved &&
      (Math.abs(event.clientX - drag.startX) > DRAG_MOVE_THRESHOLD_PX ||
        Math.abs(event.clientY - drag.startY) > DRAG_MOVE_THRESHOLD_PX)
    ) {
      drag.moved = true;
    }
    setRotation((prev) => ({
      x: clamp(prev.x + dy * 0.5, ROTATE_X_MIN, ROTATE_X_MAX),
      y: prev.y + dx * 0.5,
    }));
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      runInertia();
    }
    dragRef.current = drag.moved ? drag : null;
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (reducedMotionActive()) return;
    const step = 12;
    if (event.key === "ArrowLeft") {
      setRotation((prev) => ({ ...prev, y: prev.y - step }));
      dragRef.current = { ...(dragRef.current ?? blankDrag()), moved: true };
    } else if (event.key === "ArrowRight") {
      setRotation((prev) => ({ ...prev, y: prev.y + step }));
      dragRef.current = { ...(dragRef.current ?? blankDrag()), moved: true };
    } else if (event.key === "ArrowUp") {
      setRotation((prev) => ({ ...prev, x: clamp(prev.x - step, ROTATE_X_MIN, ROTATE_X_MAX) }));
      dragRef.current = { ...(dragRef.current ?? blankDrag()), moved: true };
    } else if (event.key === "ArrowDown") {
      setRotation((prev) => ({ ...prev, x: clamp(prev.x + step, ROTATE_X_MIN, ROTATE_X_MAX) }));
      dragRef.current = { ...(dragRef.current ?? blankDrag()), moved: true };
    } else if (event.key === "Enter" || event.key === " ") {
      advanceOnce();
    }
  }

  function blankDrag() {
    return {
      pointerId: -1,
      lastX: 0,
      lastY: 0,
      startX: 0,
      startY: 0,
      velocityX: 0,
      velocityY: 0,
      moved: false,
    };
  }

  useEffect(
    () => () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return (
    <div className={styles.wrap}>
      <p className={styles.caption}>Turn the globe</p>
      <div
        className={styles.dragSurface}
        role="img"
        aria-label="An interactive globe. Drag or use the arrow keys to turn it, or press Continue."
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <GlobeSphere rotateX={rotation.x} rotateY={rotation.y} />
      </div>
      <button type="button" className={styles.continue} onClick={advanceOnce}>
        Continue
      </button>
    </div>
  );
}
