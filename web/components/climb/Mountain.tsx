"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MountainStage } from "@/lib/vault/seed";
import { buildMountainGeometry, buildRibbonTicks, scrollProgressFor } from "@/lib/climb/mountainGeometry";
import { MountainScene } from "./MountainScene";
import { MountainRibbon } from "./MountainRibbon";
import styles from "./Mountain.module.css";

interface MountainProps {
  stages: MountainStage[];
}

/**
 * MOUNTAINSWITCHBACK-001 — "The Switchback" (camera direction 1a, ratified by
 * Ken over 1b/1c 2026-09-01, see design/MOUNTAIN_JOURNEY_BRIEF.md). Replaces
 * the old abstract line-chart rendering; the data contract below it
 * (`MountainStage[]` in, click-to-navigate out) is unchanged, so
 * app/(app)/page.tsx needed no edit beyond the additive `chapterCount` field
 * both of its stage builders now attach.
 *
 * All the actual geometry — proportional spacing from real chapterCount,
 * the sine-wound switchback path, elevation bands, mirror-pair altitude
 * matching, ridge silhouettes — lives in lib/climb/mountainGeometry.ts as
 * pure, non-React functions, exactly so tests/mountain-geometry.test.ts can
 * exercise it directly under plain `node:test` (no jsdom in this repo's test
 * runner). MountainScene.tsx and MountainRibbon.tsx are hookless render
 * components (props in, markup out) for the same reason, following
 * IsraelSubArcRidge.tsx's precedent. This file is the one place with real
 * hooks: routing, hover state, and the scroll-driven parallax/road-draw.
 *
 * MIRROR-PAIR VISUAL CHOICE (requirement 6): the old code drew a thin dashed
 * `<line>` straight across the canvas connecting each mirror pair — exactly
 * the "network-diagram edge" look BUILD_PLAN.md's own visual-grammar note
 * warns against (search that file for the phrase; design/reference/
 * TravelingPath.dc.html flags the same risk). That line is gone. In its
 * place: each waypoint gets a short "altitude tick" whose length is a pure
 * function of its elevation band (mountainGeometry.ts's `elevationLevelOf`),
 * so a mirror pair's two ticks are drawn identically by construction — a
 * real terrain feature (reads like a topographic contour flag) rather than
 * a connector spanning the whole canvas between two distant nodes. The
 * correspondence is ALSO stated in plain text via each waypoint's
 * aria-label ("mirrors <title>, the same elevation on the far face"), so the
 * relationship survives for a screen-reader user even though nothing is
 * drawn between the two points.
 *
 * MOTION (requirements 5 and 8): a single scroll-driven number,
 * `--mountain-progress` (0 at the top of the section, 1 once scrolled all
 * the way through it), is written directly onto the wrap element's inline
 * style from a rAF-throttled scroll listener — never through React state,
 * so scrolling never re-renders this component. Every parallax layer and
 * the road's stroke-dashoffset read that one CSS variable via `calc()`.
 * Under `prefers-reduced-motion: reduce` the listener is never attached (an
 * OS-level toggle mid-session is honored live via a matchMedia change
 * listener) AND Mountain.module.css independently pins the variable to 1
 * with `!important` — two independent guarantees of the same static, fully
 * -drawn resting state, not two different motion paths.
 */
export function Mountain({ stages }: MountainProps) {
  const router = useRouter();
  const [hovered, setHovered] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const geometry = useMemo(() => buildMountainGeometry(stages), [stages]);
  const ribbonTicks = useMemo(() => buildRibbonTicks(geometry), [geometry]);

  useEffect(() => {
    const wrapEl = wrapRef.current;
    if (!wrapEl || typeof window === "undefined") return;

    const mediaQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;

    let frame = 0;
    let listening = false;

    function setProgress(value: number) {
      wrapEl!.style.setProperty("--mountain-progress", String(value));
    }

    function onScroll() {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const rect = wrapEl!.getBoundingClientRect();
        setProgress(scrollProgressFor(rect.top, rect.height, window.innerHeight || 0));
      });
    }

    function start() {
      if (listening) return;
      listening = true;
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll);
      onScroll();
    }

    function stop() {
      listening = false;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      setProgress(1);
    }

    function sync() {
      if (mediaQuery?.matches) stop();
      else start();
    }

    sync();
    mediaQuery?.addEventListener?.("change", sync);
    return () => {
      stop();
      mediaQuery?.removeEventListener?.("change", sync);
    };
  }, [geometry.totalHeight]);

  function goTo(href: string) {
    router.push(href);
  }

  const activeWaypoint = hovered ? (geometry.waypoints.find((w) => w.stage.slug === hovered) ?? null) : null;

  return (
    <div className={styles.wrap} ref={wrapRef} data-testid="mountain">
      <div className={styles.sky} style={{ height: geometry.totalHeight }} aria-hidden="true" />

      <div className={styles.scene}>
        <MountainScene
          geometry={geometry}
          hoveredSlug={hovered}
          onHoverChange={setHovered}
          onSelect={(waypoint) => goTo(waypoint.href)}
        />
      </div>

      {activeWaypoint ? (
        <div className={styles.tip}>
          <p className={styles.tipTitle}>{activeWaypoint.stage.title}</p>
          <p className={styles.tipBody}>
            {activeWaypoint.stage.observationCount} observations · {activeWaypoint.stage.questionCount} open
            questions · {activeWaypoint.stage.threadCount} thread
            {activeWaypoint.stage.threadCount === 1 ? "" : "s"}
          </p>
        </div>
      ) : null}

      <div className={styles.ribbonWrap}>
        <MountainRibbon
          ticks={ribbonTicks}
          onSelect={(slug) => {
            const waypoint = geometry.waypoints.find((w) => w.stage.slug === slug);
            if (waypoint) goTo(waypoint.href);
          }}
        />
      </div>
    </div>
  );
}
