import {
  elevationOf,
  ISRAEL_SUB_ARC_PEAK_ORDER,
  type IsraelSubArcPhase,
} from "@/lib/prototype/israel-sub-arc";

const WIDTH = 620;
const HEIGHT = 220;
const LEFT = 50;
const TOP = 30;
const COL = 100;
const ROW = 42;

interface Point {
  x: number;
  y: number;
  phase: IsraelSubArcPhase;
}

export interface IsraelSubArcRidgeProps {
  phases: readonly IsraelSubArcPhase[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}

/**
 * A visual echo of Mountain.tsx's own ridge/point SVG — six points instead
 * of eleven, ascent to Kingdom (order 4, the sub-arc's own peak) then
 * descent to Return. Deliberately simpler than the real Mountain (no
 * mirror ties, no thread-weighted radius — this prototype carries no real
 * study data): the only question this component exists to help Ken answer
 * is whether tapping a point and getting a real place to land feels like
 * climbing or like a nested menu.
 *
 * HOOKLESS ("props in, markup out") on purpose — same discipline
 * `TeachSection.tsx`'s `TeachOutlinePanel` and `ConnectSection.tsx`'s
 * `EvidenceLabelField` follow, so `tests/israel-sub-arc.test.ts` can render
 * it directly with controlled props via `react-dom/server`'s
 * `renderToStaticMarkup`, with no client-only state to work around.
 */
export function IsraelSubArcRidge({ phases, selectedSlug, onSelect }: IsraelSubArcRidgeProps) {
  const points: Point[] = phases.map((phase) => {
    const level = elevationOf(phase.order, ISRAEL_SUB_ARC_PEAK_ORDER);
    const maxLevel = ISRAEL_SUB_ARC_PEAK_ORDER - 1;
    return {
      x: LEFT + (phase.order - 1) * COL,
      y: TOP + (maxLevel - level) * ROW,
      phase,
    };
  });

  const baseY = TOP + (points.length ? Math.max(...points.map((p) => p.y)) - TOP : 0);
  const ridge = points.map((p) => `${p.x},${p.y}`).join(" ");
  const fillPoints = points.length
    ? `${points[0].x},${baseY} ${ridge} ${points[points.length - 1].x},${baseY}`
    : "";

  function activate(slug: string) {
    onSelect(slug);
  }

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      height={HEIGHT}
      role="img"
      aria-label="The six phases of the Israel sub-arc, Patriarchs through Return, with Kingdom at the peak"
    >
      <style>
        {`.israel-sub-arc-phase:focus .israel-sub-arc-focus-ring { opacity: 1; }`}
      </style>
      <polygon points={fillPoints} fill="var(--gold)" fillOpacity={0.05} />
      <polyline points={ridge} fill="none" stroke="var(--shell-border-hi)" strokeWidth={2} />
      {points.map((point) => {
        const isPeak = point.phase.peak;
        const isSelected = point.phase.slug === selectedSlug;
        const radius = isPeak ? 14 : 9;
        return (
          <g
            key={point.phase.slug}
            className="israel-sub-arc-phase"
            role="button"
            tabIndex={0}
            focusable="true"
            aria-label={`${point.phase.name} — ${point.phase.range}${isPeak ? ", the sub-arc's peak" : ""}`}
            aria-pressed={isSelected}
            style={{ cursor: "pointer", outline: "none" }}
            onClick={() => activate(point.phase.slug)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activate(point.phase.slug);
              }
            }}
          >
            <circle
              className="israel-sub-arc-focus-ring"
              cx={point.x}
              cy={point.y}
              r={radius + 7}
              fill="none"
              stroke="var(--shell-crimson-text)"
              strokeWidth={2}
              opacity={0}
            />
            <circle
              cx={point.x}
              cy={point.y}
              r={isSelected ? radius + 2 : radius}
              fill={isPeak ? "var(--gold)" : "var(--shell-bg)"}
              stroke={isSelected ? "var(--gold)" : isPeak ? "var(--gold-deep)" : "var(--shell-border-hi)"}
              strokeWidth={2}
            />
            <text
              x={point.x}
              y={point.y + radius + 18}
              textAnchor="middle"
              fontFamily="var(--font-narrow)"
              fontWeight={600}
              fontSize={11}
              fill="var(--shell-text-2)"
            >
              {point.phase.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
