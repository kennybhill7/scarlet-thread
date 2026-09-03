"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MountainStage } from "@/lib/vault/seed";
import { buildMountainGeometry, buildRibbonTicks, scrollProgressFor } from "@/lib/climb/mountainGeometry";
import { buildPlateGeometry } from "@/lib/climb/plateGeometry";
import {
  ISRAEL_STAGE_NUMBER,
  isIsraelWaypoint,
  resolveWaypointAction,
  type WaypointAction,
} from "@/lib/climb/waypointAction";
import { Sheet } from "@/components/ui/Sheet";
import { IsraelSubArcPrototype } from "@/components/prototype/IsraelSubArcPrototype";
import { MountainPlates } from "./MountainPlates";
import { MountainDesktop } from "./MountainDesktop";
import { MountainRibbon } from "./MountainRibbon";
import styles from "./Mountain.module.css";

interface MountainProps {
  stages: MountainStage[];
}

/**
 * ISRAELFILTER-001 / MOUNTAINDESKTOP-001 — stage 5 ("Israel," Genesis 12
 * through Malachi, 65% of the app's total reading content per
 * design/STORY_SPINE_DECISIONS.md decision 4) is the one stage of 11 broad
 * enough to get a filtered sub-arc view instead of jumping straight into the
 * chapter reader. Every other stage's waypoint is completely unaffected —
 * still `goTo(waypoint.href)`, still `stageHref()`'s own URL, untouched by
 * this task. `ISRAEL_STAGE_NUMBER`/`isIsraelWaypoint`/`resolveWaypointAction`
 * now live in lib/climb/waypointAction.ts (MOUNTAINDESKTOP-001 moved them out
 * so MountainDesktop.tsx's own waypoint click AND scene-takeover "read on"
 * CTA can reuse the exact same decision without importing this file — see
 * that module's header) and are re-exported here unchanged so
 * tests/israel-sub-arc.test.ts, which imports them from this module's own
 * path, keeps working without modification.
 */
export { ISRAEL_STAGE_NUMBER, isIsraelWaypoint, resolveWaypointAction };
export type { WaypointAction };

/**
 * MOUNTAINPLATES-001 — "The Switchback: real plates, drawn path"
 * (design/scarlet-thread-app/Scarlet Thread App.dc.html, section 15,
 * answering design/MOUNTAIN_IMPLEMENTATION_GAP.md). Replaces
 * MOUNTAINSWITCHBACK-001's fully-procedural SVG terrain (MountainScene.tsx,
 * now deleted — see plateGeometry.ts/MountainPlates.tsx's own headers) with
 * Claude Design's real spec: five stacked photographic plate images with a
 * rope + waypoints drawn on top. The data contract below it (`MountainStage[]`
 * in, click-to-navigate out) is unchanged, so app/(app)/page.tsx needed no
 * edit.
 *
 * The plate/rope/waypoint geometry lives in lib/climb/plateGeometry.ts as
 * pure, non-React functions (same discipline mountainGeometry.ts already
 * established, exactly so tests can exercise it directly under plain
 * `node:test` — no jsdom in this repo's test runner). This file still also
 * calls the ORIGINAL mountainGeometry.ts's `buildMountainGeometry` — kept
 * exactly as MOUNTAINSWITCHBACK-001 left it, untouched — purely to feed
 * MountainRibbon's always-visible mini-map strip, which wants a single 1-D
 * proportional-distance model of the whole 11-stage journey and has no
 * reason to know about the 5-plate structure. MountainPlates.tsx and
 * MountainRibbon.tsx are both hookless render components (props in, markup
 * out), following IsraelSubArcRidge.tsx's precedent. This file is the one
 * place with real hooks: routing, hover state, and the scroll-driven
 * parallax/rope-draw.
 *
 * MIRROR-PAIR VISUAL CHOICE (requirement 6): the pre-plates code drew a
 * short "altitude tick" per waypoint, equal-length by construction for a
 * mirror pair — never a line spanning the whole canvas between the two
 * distant nodes (the "network-diagram edge" look BUILD_PLAN.md's own
 * visual-grammar note warns against; design/reference/TravelingPath.dc.html
 * flags the same risk). Under the plates model that mechanism is replaced by
 * something stronger than a drawn tick: plateGeometry.ts puts both halves of
 * a mirror pair on the SAME plate image, at the SAME y-position (left = the
 * lower stage number/ascent side, right = the higher/descent side) — see
 * BAND_STAGE_NUMBERS there. "Matching altitude" stops being an assertion and
 * becomes a literal fact of the layout: the two waypoints sit on one
 * physical strip of terrain. The correspondence is ALSO stated in plain text
 * via each waypoint's aria-label ("mirrors <title>, the same altitude on the
 * far face"), so it survives for a screen-reader user too.
 *
 * MOTION (requirements 5 and 8): a single scroll-driven number,
 * `--mountain-progress` (0 at the top of the section, 1 once scrolled all
 * the way through it), is written directly onto the wrap element's inline
 * style from a rAF-throttled scroll listener — never through React state,
 * so scrolling never re-renders this component. MountainPlates.tsx's rope
 * reveal mask reads that one CSS variable via `calc()` (it does not
 * redeclare or re-listen for it — see that component's own header). Under
 * `prefers-reduced-motion: reduce` the listener is never attached (an
 * OS-level toggle mid-session is honored live via a matchMedia change
 * listener) AND Mountain.module.css independently pins the variable to 1
 * with `!important` — two independent guarantees of the same static, fully
 * -drawn resting state, not two different motion paths.
 */
export function Mountain({ stages }: MountainProps) {
  const router = useRouter();
  const [hovered, setHovered] = useState<string | null>(null);
  // ISRAELFILTER-001 — open when the stage-5 waypoint is selected, instead
  // of routing away. See isIsraelWaypoint/selectWaypoint below.
  const [israelOpen, setIsraelOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Kept purely to feed MountainRibbon's mini-map -- see this file's header.
  const geometry = useMemo(() => buildMountainGeometry(stages), [stages]);
  const ribbonTicks = useMemo(() => buildRibbonTicks(geometry), [geometry]);
  const plateGeometry = useMemo(() => buildPlateGeometry(stages), [stages]);

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
  }, [plateGeometry.totalHeight]);

  function goTo(href: string) {
    router.push(href);
  }

  // ISRAELFILTER-001 — the one branch point every waypoint click (plates AND
  // ribbon) now runs through. Stage 5 opens the sub-arc sheet; every other
  // stage still calls goTo(href) exactly as before this task -- the decision
  // itself is resolveWaypointAction above, kept pure and exported for tests.
  function selectWaypoint(stage: MountainStage, href: string) {
    const action = resolveWaypointAction(stage, href);
    if (action.kind === "open-israel-sub-arc") {
      setIsraelOpen(true);
      return;
    }
    goTo(action.href);
  }

  const activeWaypoint = hovered ? (plateGeometry.waypoints.find((w) => w.stage.slug === hovered) ?? null) : null;

  // MIRRORSPLIT-001 — the real, always-visible entry point into
  // /mirror/[stageSlug] (not the hover tip above: it unmounts the instant a
  // pointer leaves the waypoint, and never receives keyboard focus, so a
  // link placed inside it would be unreachable — same reasoning as the
  // pre-Switchback version this was ported from, unaffected by the plates
  // rewrite since it renders as a plain list, below the scene entirely).
  // One deduplicated row per pair (5 pairs from 10 of the 11 stages; stage 6,
  // the Gospels, has `mirror: null` and is correctly excluded). Reference-only
  // labels — structural naming, not app-supplied commentary on why the two
  // passages pair (docs/decisions/2026-08-18-teaching-not-theology.md).
  const bySlug = useMemo(() => new Map(stages.map((s) => [s.slug, s])), [stages]);
  const pairs = useMemo(() => {
    const seen = new Set<string>();
    const result: { key: string; a: MountainStage; b: MountainStage }[] = [];
    for (const stage of stages) {
      if (!stage.mirror) continue;
      const key = [stage.slug, stage.mirror].sort().join("~");
      if (seen.has(key)) continue;
      seen.add(key);
      const partner = bySlug.get(stage.mirror);
      if (partner) result.push({ key, a: stage, b: partner });
    }
    return result.sort((x, y) => x.a.stage - y.a.stage);
  }, [stages, bySlug]);

  return (
    <div className={styles.wrap} ref={wrapRef} data-testid="mountain">
      <div className={styles.sky} style={{ height: plateGeometry.totalHeight }} aria-hidden="true" />

      <div className={styles.scene}>
        {/* MOUNTAINDESKTOP-001 — both assemblies always mount; a pure CSS
            breakpoint (Mountain.module.css's `.mobileScene`/`.desktopScene`,
            `@media (min-width: 1100px)`) decides which one is visible,
            exactly the same convention this app's other responsive layouts
            already use (MirrorSplitView.module.css, ChapterReader.module.css
            — see those files' own `@media (min-width: ...)` rules). Always
            mounting both (rather than a JS matchMedia toggle deciding which
            component to render) means no client/server hydration mismatch
            and no first-paint "flash" of the wrong assembly while JS boots —
            the tradeoff is that the hidden assembly's images still load
            off-screen, acceptable for 5 small photographic plates. Below
            1100px this renders MountainPlates exactly as MOUNTAINPLATES-001
            shipped it — same props, same geometry, same onSelect wiring,
            untouched. */}
        <div className={styles.mobileScene}>
          <MountainPlates
            geometry={plateGeometry}
            hoveredSlug={hovered}
            onHoverChange={setHovered}
            onSelect={(waypoint) => selectWaypoint(waypoint.stage, waypoint.href)}
          />
        </div>
        <div className={styles.desktopScene}>
          <MountainDesktop stages={stages} onSelect={selectWaypoint} />
        </div>
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
            if (waypoint) selectWaypoint(waypoint.stage, waypoint.href);
          }}
        />
      </div>

      {pairs.length > 0 ? (
        <div className={styles.pairs}>
          <p className={styles.pairsHeading}>Mirror pairs</p>
          <ul className={styles.pairsList}>
            {pairs.map(({ key, a, b }) => (
              <li key={key}>
                <Link href={`/mirror/${a.slug}`} className={styles.pairLink}>
                  {a.reference} ↔ {b.reference}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ISRAELFILTER-001 — stage 5's real entry point. Same component the
          standalone `/prototype/israel-sub-arc` route renders directly on
          its own page (see that page's header); here it's the body of a
          Sheet opened by the stage-5 waypoint instead of navigating away. */}
      <Sheet open={israelOpen} onClose={() => setIsraelOpen(false)} title="Israel">
        <IsraelSubArcPrototype />
      </Sheet>
    </div>
  );
}
