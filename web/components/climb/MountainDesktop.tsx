"use client";

import { useMemo, useState } from "react";

import type { MountainStage } from "@/lib/vault/seed";
import {
  PLATE_SRC,
  ROPE_GRADIENT_STOPS,
  ROPE_HIGHLIGHT_COLOR,
  ROPE_SHADOW_COLOR,
  SCENE_SRC,
  buildDesktopPlateGeometry,
  type DesktopWaypoint,
} from "@/lib/climb/plateGeometry";
import { isReached } from "@/lib/climb/mountainGeometry";
import { isIsraelWaypoint } from "@/lib/climb/waypointAction";
import styles from "./MountainDesktop.module.css";

export interface MountainDesktopProps {
  stages: MountainStage[];
  /** Same signature Mountain.tsx's own `selectWaypoint` already has — pass
   * it straight through, so stage 5 ("Israel") opens the real sub-arc sheet
   * and every other stage navigates for real, with zero Israel-specific
   * logic duplicated in this file. Called from two places below: the
   * waypoint's own click (for stage 5 only — see handleWaypointClick) and
   * the scene takeover's "Read on" CTA (every stage, including 5). */
  onSelect: (stage: MountainStage, href: string) => void;
}

const ROPE_GRADIENT_ID = "mountainDesktopRopeGradient";

function sideLabel(side: MountainStage["side"]): string {
  if (side === "peak") return "The peak";
  return side === "ascent" ? "Ascent" : "Descent";
}

function displayTitleOf(stage: MountainStage): string {
  return stage.short || stage.title;
}

/** Mirrors the mockup's own card-clamp math (The Climb.dc.html's `card` —
 * `Math.min(Math.max(s.x, 11.4), 88.6)`) so the card never runs off either
 * edge of the panorama regardless of how close to the edge its waypoint is. */
function clampCardLeftPct(xPct: number): number {
  return Math.min(Math.max(xPct, 11.4), 88.6);
}

export type DesktopWaypointClickResult =
  | { kind: "open-israel-sub-arc" }
  | { kind: "open-takeover"; stageNumber: number };

/**
 * Pure decision a waypoint click funnels through — extracted (same reasoning
 * as lib/climb/waypointAction.ts's own resolveWaypointAction, which this
 * calls) so tests/mountain-desktop.test.ts can prove, for every one of the
 * 11 real stage numbers, that clicking stage 5's waypoint skips this
 * component's own scene takeover and opens the real sub-arc directly, while
 * every other stage opens the takeover, without simulating a real click
 * (this repo's test runner has no jsdom — see Mountain.tsx's own precedent
 * for `resolveWaypointAction`).
 */
export function resolveDesktopWaypointClick(stage: MountainStage): DesktopWaypointClickResult {
  return isIsraelWaypoint(stage) ? { kind: "open-israel-sub-arc" } : { kind: "open-takeover", stageNumber: stage.stage };
}

/**
 * MOUNTAINDESKTOP-001 — the desktop (>=1100px) assembly: "the plates compose
 * back into the landscape panorama... Same plate set, same waypoint
 * coordinates, different assembly. Do not author a second art set for
 * desktop" (design/scarlet-thread-app/Scarlet Thread App.dc.html, section
 * 15). The real interaction spec — waypoint positions, hover halo/card,
 * click-to-full-bleed-scene takeover, prev/next, the dot rail — comes from
 * The Climb.dc.html (the already-signed-off desktop mockup, predating
 * MOUNTAINPLATES-001's real plate/rope rendering, which replaces that
 * mockup's placeholder flat `climb-vista.png` image below).
 *
 * STATEFUL, unlike MountainPlates.tsx/MountainRibbon.tsx's hookless "props
 * in, markup out" discipline — this component owns two pieces of UI-only
 * state that never need to escape it: which waypoint is hovered (halo +
 * card) and which stage's scene takeover is open. Mountain.tsx still owns
 * the one piece of state that DOES cross assemblies (the Israel sub-arc
 * Sheet), reached via the `onSelect` prop exactly the way MountainPlates
 * already reaches it.
 *
 * TWO DIFFERENT CLICK TARGETS, BOTH REAL:
 *  - A waypoint click for any stage OTHER than 5 opens this component's own
 *    local scene takeover (`openStageNumber`) — it does NOT navigate. This
 *    matches the mockup's own `onPick`/`goScene`, which only ever sets
 *    internal state, never navigates.
 *  - A waypoint click for stage 5 skips the takeover entirely and calls
 *    `onSelect` directly, exactly like the mobile assembly's stage-5
 *    interception (Mountain.tsx's `selectWaypoint`) — "on both the waypoint
 *    click AND the scene-takeover's own 'read on' CTA... route into the real
 *    sub-arc" per this task's brief.
 *  - The scene takeover's own "Read on" CTA, for EVERY stage (including one
 *    a learner reaches by prev/next-ing onto stage 5 without ever clicking
 *    its waypoint), always calls `onSelect` — real navigation, or the Israel
 *    sub-arc when the open stage happens to be 5.
 *
 * REDUCED MOTION: this component adds no scroll listener, no rAF, no timer —
 * its only "motion" is a handful of plain CSS `transition`s (halo/card fade,
 * dot hover scale) triggered by ordinary React state changes, all disabled
 * under `@media (prefers-reduced-motion: reduce)` in
 * MountainDesktop.module.css, the exact same two-guarantee shape
 * MountainPlates.module.css already uses for its own waypoint-hover scale
 * (nothing here attaches a JS motion listener to gate in the first place,
 * and the CSS pins every transition to `none` independently).
 */
export function MountainDesktop({ stages, onSelect }: MountainDesktopProps) {
  const [hoveredStageNumber, setHoveredStageNumber] = useState<number | null>(null);
  const [openStageNumber, setOpenStageNumber] = useState<number | null>(null);

  const geometry = useMemo(() => buildDesktopPlateGeometry(stages), [stages]);
  const sortedStages = useMemo(() => [...stages].sort((a, b) => a.stage - b.stage), [stages]);

  const hoveredWaypoint = openStageNumber
    ? null // halo/card hide while the takeover is open, matching the mockup's own `shown = open ? null : active`.
    : (geometry.waypoints.find((w) => w.stage.stage === hoveredStageNumber) ?? null);
  const openWaypoint = openStageNumber ? (geometry.waypoints.find((w) => w.stage.stage === openStageNumber) ?? null) : null;

  function handleWaypointClick(waypoint: DesktopWaypoint) {
    const result = resolveDesktopWaypointClick(waypoint.stage);
    if (result.kind === "open-israel-sub-arc") {
      onSelect(waypoint.stage, waypoint.href);
      return;
    }
    setOpenStageNumber(result.stageNumber);
  }

  function goScene(n: number) {
    if (n < 1 || n > 11) return;
    setOpenStageNumber(n);
  }

  function closeScene() {
    setOpenStageNumber(null);
  }

  return (
    <div className={styles.wrap} data-testid="mountain-desktop">
      <div
        className={styles.panorama}
        style={{ aspectRatio: `${geometry.panoramaWidth} / ${geometry.panoramaHeight}` }}
      >
        <div className={styles.plates} aria-hidden="true">
          {geometry.bands.map((band) => (
            <div
              key={band.name}
              className={styles.plate}
              style={{ top: `${band.topPct}%`, height: `${band.heightPct}%` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- no next/image use anywhere in this repo (see MountainPlates.tsx's own precedent). */}
              <img src={PLATE_SRC[band.name]} alt="" className={styles.plateImg} loading="eager" decoding="async" />
            </div>
          ))}
        </div>

        <svg
          className={styles.rope}
          viewBox={`0 0 ${geometry.panoramaWidth} ${geometry.panoramaHeight}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="The scarlet thread's path across the mountain, Genesis to Revelation"
        >
          <defs>
            <linearGradient id={ROPE_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
              {ROPE_GRADIENT_STOPS.map((stop) => (
                <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
              ))}
            </linearGradient>
          </defs>
          <path
            d={geometry.ropePathD}
            fill="none"
            stroke={ROPE_SHADOW_COLOR}
            strokeWidth={geometry.ropeStrokeWidths.shadow}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.55}
            transform="translate(0,3)"
          />
          <path
            d={geometry.ropePathD}
            fill="none"
            stroke={`url(#${ROPE_GRADIENT_ID})`}
            strokeWidth={geometry.ropeStrokeWidths.face}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={geometry.ropePathD}
            fill="none"
            stroke={ROPE_HIGHLIGHT_COLOR}
            strokeWidth={geometry.ropeStrokeWidths.highlight}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.5}
            transform="translate(-1,-2)"
          />
        </svg>

        <div className={styles.waypoints}>
          {geometry.waypoints.map((wp) => {
            const isPeak = wp.stage.side === "peak";
            return (
              <button
                key={wp.stage.slug}
                type="button"
                className={`${styles.waypoint} ${isPeak ? styles.waypointPeak : ""}`}
                style={{ left: `${wp.xPct}%`, top: `${wp.yPct}%` }}
                aria-label={wp.ariaLabel}
                aria-current={wp.status === "current" ? "step" : undefined}
                data-stage-slug={wp.stage.slug}
                data-waypoint-status={wp.status}
                onMouseEnter={() => setHoveredStageNumber(wp.stage.stage)}
                onMouseLeave={() => setHoveredStageNumber((n) => (n === wp.stage.stage ? null : n))}
                onFocus={() => setHoveredStageNumber(wp.stage.stage)}
                onBlur={() => setHoveredStageNumber((n) => (n === wp.stage.stage ? null : n))}
                onClick={() => handleWaypointClick(wp)}
              >
                <span className={`${styles.dot} ${styles[wp.status]}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>

        {hoveredWaypoint ? (
          <span
            className={styles.halo}
            style={{ left: `${hoveredWaypoint.xPct}%`, top: `${hoveredWaypoint.yPct}%` }}
            aria-hidden="true"
          />
        ) : null}

        {hoveredWaypoint ? <StageCard waypoint={hoveredWaypoint} /> : null}

        {openWaypoint ? (
          <SceneTakeover
            waypoint={openWaypoint}
            onClose={closeScene}
            onPrev={() => goScene(openWaypoint.stage.stage - 1)}
            onNext={() => goScene(openWaypoint.stage.stage + 1)}
            onJump={goScene}
            onReadOn={() => onSelect(openWaypoint.stage, openWaypoint.href)}
          />
        ) : null}
      </div>

      <ProgressRail stages={sortedStages} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The hover card — The Climb.dc.html lines 554-580.
// ---------------------------------------------------------------------------

/** Exported (additive) purely so tests/mountain-desktop.test.ts can render
 * this sub-piece directly with controlled data, the same
 * renderToStaticMarkup + hand-built-props technique tests/mountain-plates
 * .test.ts already uses — MountainDesktop itself is unaffected either way. */
export function StageCard({ waypoint }: { waypoint: DesktopWaypoint }) {
  const { stage, mirror } = waypoint;
  const begun = isReached(stage);
  const leftPct = clampCardLeftPct(waypoint.xPct);
  const flipUp = waypoint.yPct >= 42;

  return (
    <div
      className={`${styles.card} ${flipUp ? styles.cardFlipUp : styles.cardFlipDown}`}
      style={{ left: `${leftPct}%`, top: `${waypoint.yPct}%` }}
    >
      <div className={styles.cardTop}>
        <span className={styles.cardEyebrow}>
          Stage {String(stage.stage).padStart(2, "0")} · {sideLabel(stage.side)}
        </span>
        <span className={`${styles.cardBadge} ${begun ? styles.cardBadgeBegun : styles.cardBadgeNotYet}`}>
          {begun ? "BEGUN" : "NOT YET"}
        </span>
      </div>
      <p className={styles.cardTitle}>{displayTitleOf(stage)}</p>
      <p className={styles.cardRef}>{stage.reference}</p>
      <p className={styles.cardCounts}>
        {begun
          ? `${stage.observationCount} observation${stage.observationCount === 1 ? "" : "s"} · ${stage.questionCount} open question${stage.questionCount === 1 ? "" : "s"} · ${stage.threadCount} thread${stage.threadCount === 1 ? "" : "s"}`
          : "Nothing written here yet."}
      </p>
      {mirror ? (
        <div className={styles.cardMirror}>
          <span className={styles.cardLabel}>Mirrors</span>
          <span className={styles.cardMirrorValue}>
            {mirror.reference} · {displayTitleOf(mirror)}
          </span>
        </div>
      ) : (
        <div className={styles.cardMirror}>
          <span className={styles.cardLabel}>The summit · no mirror</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The scene takeover — The Climb.dc.html lines 76-405 (one shared layout
// driven by real data instead of 11 hand-copied blocks) + sceneNav (500-530).
// ---------------------------------------------------------------------------

/** Exported (additive) for direct testing — see StageCard's own comment. */
export function SceneTakeover({
  waypoint,
  onClose,
  onPrev,
  onNext,
  onJump,
  onReadOn,
}: {
  waypoint: DesktopWaypoint;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onJump: (n: number) => void;
  onReadOn: () => void;
}) {
  const { stage, mirror } = waypoint;
  const src = SCENE_SRC.get(stage.stage);
  const begun = isReached(stage);
  const atFirst = stage.stage <= 1;
  const atLast = stage.stage >= 11;

  return (
    <div className={styles.takeover}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- no next/image use anywhere in this repo.
        <img src={src} alt="" className={styles.takeoverImg} />
      ) : null}
      <div className={styles.takeoverScrim} aria-hidden="true" />

      <div className={styles.takeoverBody}>
        <span className={styles.takeoverEyebrow}>
          Stage {String(stage.stage).padStart(2, "0")} · {sideLabel(stage.side)}
        </span>
        <h2 className={styles.takeoverTitle}>{displayTitleOf(stage)}</h2>
        <p className={styles.takeoverRef}>{stage.reference}</p>
        {stage.summary ? (
          <div className={styles.takeoverSummary}>
            <span className={styles.cardLabel}>What the text puts in front of you</span>
            <p className={styles.takeoverSummaryBody}>{stage.summary}</p>
          </div>
        ) : null}
        <div className={styles.takeoverMeta}>
          <div className={styles.takeoverMetaCol}>
            <span className={styles.cardLabel}>Your writing here</span>
            <span className={styles.takeoverMetaValue}>
              {begun
                ? `${stage.observationCount} observation${stage.observationCount === 1 ? "" : "s"} · ${stage.questionCount} open question${stage.questionCount === 1 ? "" : "s"} · ${stage.threadCount} thread${stage.threadCount === 1 ? "" : "s"}`
                : "Nothing written here yet."}
            </span>
          </div>
          {mirror ? (
            <div className={styles.takeoverMetaCol}>
              <span className={styles.cardLabel}>Mirrors</span>
              <span className={styles.takeoverMetaValueMirror}>
                {mirror.reference} · {displayTitleOf(mirror)}
              </span>
            </div>
          ) : null}
        </div>
        <div className={styles.takeoverActions}>
          <button type="button" className={styles.readOnButton} onClick={onReadOn}>
            Read {stage.reference} →
          </button>
        </div>
      </div>

      <button type="button" className={styles.closeButton} aria-label="Back to the mountain" onClick={onClose}>
        ×
      </button>
      <button
        type="button"
        className={styles.prevButton}
        aria-label="Previous stage"
        onClick={onPrev}
        disabled={atFirst}
      >
        ‹
      </button>
      <button type="button" className={styles.nextButton} aria-label="Next stage" onClick={onNext} disabled={atLast}>
        ›
      </button>

      <div className={styles.sceneNavRail}>
        {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className={`${styles.sceneNavDot} ${n === stage.stage ? styles.sceneNavDotActive : ""}`}
            aria-label={`Jump to stage ${n}`}
            aria-current={n === stage.stage ? "true" : undefined}
            onClick={() => onJump(n)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The bottom progress rail — The Climb.dc.html lines 408-427, "Genesis" to
// "Revelation" with 11 dots. Real reached/not-reached, not the mockup's
// static 3-gold/8-bronze placeholder.
// ---------------------------------------------------------------------------

/** Exported (additive) for direct testing — see StageCard's own comment. */
export function ProgressRail({ stages }: { stages: MountainStage[] }) {
  return (
    <div className={styles.progressRail} role="group" aria-label="Your progress across all eleven stages, Genesis to Revelation">
      <span className={styles.progressEnd}>Genesis</span>
      <div className={styles.progressTrack}>
        <span className={styles.progressLine} aria-hidden="true" />
        <div className={styles.progressDots}>
          {stages.map((stage) => (
            <span
              key={stage.slug}
              className={`${styles.progressDot} ${isReached(stage) ? styles.progressDotReached : styles.progressDotUnreached}`}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
      <span className={styles.progressEnd}>Revelation</span>
    </div>
  );
}
