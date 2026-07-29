"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { MountainStage } from "@/lib/vault/seed";
import styles from "./Mountain.module.css";

interface MountainProps {
  stages: MountainStage[];
}

interface Point {
  x: number;
  y: number;
  stage: MountainStage;
}

const WIDTH = 820;
const HEIGHT = 360;
const LEFT = 60;
const TOP = 34;
const COL = 70;
const ROW = 46;

/**
 * Elevation geometry, isolated on purpose. Built from the vault's frontmatter
 * (stage 1 = ascent, climbing to the peak at stage 6, descending to stage 11)
 * per BUILD_PLAN.md's open item: the note prose for Genesis 1-2 reads as
 * "top of the left side," which conflicts with its own frontmatter
 * (stage 1, side ascent). This function encodes the frontmatter reading.
 * If Ken means it the other way -- Creation high, the incarnation low --
 * this is the only thing that needs to change.
 */
function elevationOf(stage: number, peak: number): number {
  return peak - 1 - Math.abs(stage - peak);
}

export function Mountain({ stages }: MountainProps) {
  const router = useRouter();
  const [hovered, setHovered] = useState<string | null>(null);

  const points = useMemo<Point[]>(() => {
    const peakStage = Math.floor((stages.at(-1)?.stage ?? 11) / 2) + 1;
    return stages.map((stage) => {
      const level = elevationOf(stage.stage, peakStage);
      const maxLevel = peakStage - 1;
      return {
        x: LEFT + (stage.stage - 1) * COL,
        y: TOP + (maxLevel - level) * ROW,
        stage,
      };
    });
  }, [stages]);

  const byySlug = useMemo(() => new Map(points.map((p) => [p.stage.slug, p])), [points]);
  const baseY = TOP + (points.length ? Math.max(...points.map((p) => p.y)) - TOP : 0);

  const ridge = points.map((p) => `${p.x},${p.y}`).join(" ");
  const fillPoints = points.length
    ? `${points[0].x},${baseY} ${ridge} ${points[points.length - 1].x},${baseY}`
    : "";

  const ties: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];
  const drawn = new Set<string>();
  for (const point of points) {
    const partner = point.stage.mirror ? byySlug.get(point.stage.mirror) : undefined;
    if (!partner) continue;
    const key = [point.stage.slug, partner.stage.slug].sort().join("~");
    if (drawn.has(key)) continue;
    drawn.add(key);
    ties.push({ x1: point.x, y1: point.y, x2: partner.x, y2: point.y, key });
  }

  const maxInbound = Math.max(1, ...points.map((p) => p.stage.threadCount));
  const active = hovered ? points.find((p) => p.stage.slug === hovered) : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.scroll}>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          width="100%"
          height={HEIGHT}
          role="img"
          aria-label="The eleven stages of the mountain, with mirror pairs"
        >
          <polygon className={styles.ridgeFill} points={fillPoints} />
          {ties.map((tie) => (
            <line key={tie.key} className={styles.tie} x1={tie.x1} y1={tie.y1} x2={tie.x2} y2={tie.y2} />
          ))}
          <polyline className={styles.ridge} points={ridge} />
          {points.map((point) => {
            const weight = point.stage.threadCount / maxInbound;
            const radius = 8 + weight * 8;
            const filled = point.stage.observationCount > 0;
            const [book, chapter] = (point.stage.firstChapter ?? "1.1").split(".");
            return (
              <g
                key={point.stage.slug}
                className={styles.node}
                role="link"
                tabIndex={0}
                aria-label={`${point.stage.title} — go to ${point.stage.reference}`}
                onMouseEnter={() => setHovered(point.stage.slug)}
                onMouseLeave={() => setHovered((h) => (h === point.stage.slug ? null : h))}
                onFocus={() => setHovered(point.stage.slug)}
                onBlur={() => setHovered((h) => (h === point.stage.slug ? null : h))}
                onClick={() => router.push(`/read/${book}/${chapter}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    router.push(`/read/${book}/${chapter}`);
                  }
                }}
              >
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={radius}
                  className={filled ? styles.nodeFilled : styles.nodeHollow}
                />
                <text x={point.x} y={point.y + radius + 15} textAnchor="middle" className={styles.label}>
                  {point.stage.reference}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {active ? (
        <div className={styles.tip}>
          <p className={styles.tipTitle}>{active.stage.title}</p>
          <p className={styles.tipBody}>
            {active.stage.observationCount} observations · {active.stage.questionCount} open questions ·{" "}
            {active.stage.threadCount} thread{active.stage.threadCount === 1 ? "" : "s"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
