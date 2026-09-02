import type { MountainGeometry, MountainWaypoint } from "@/lib/climb/mountainGeometry";

export interface MountainSceneProps {
  geometry: MountainGeometry;
  hoveredSlug: string | null;
  onHoverChange: (slug: string | null) => void;
  onSelect: (waypoint: MountainWaypoint) => void;
}

/**
 * HOOKLESS ("props in, markup out") — same discipline as
 * IsraelSubArcRidge.tsx, so it renders directly through
 * `react-dom/server`'s `renderToStaticMarkup` in tests with no CSS Module
 * stub needed (it imports none; the hover/focus states below are a `<style>`
 * tag inside the SVG, exactly like IsraelSubArcRidge's focus-ring). The
 * stateful parts (scroll-driven `--mountain-progress`, the router) live one
 * level up in Mountain.tsx.
 *
 * Requirement coverage (see MOUNTAINSWITCHBACK-001's task spec):
 *  1. Terrain: `geometry.ridgeLayers`, 3 depths x 2 sides, atmospheric via
 *     per-depth opacity against the shell's own stone tokens.
 *  2. The switchback road: `geometry.roadPath`, a real sine-wound path, not
 *     a straight line — three overlaid strokes (shadow/body/centerline) so
 *     it reads as a physical road, not a chart line.
 *  3. Proportional spacing: baked into `geometry` by mountainGeometry.ts,
 *     driven by real `chapterCount`.
 *  4. Waypoint treatment: radius from threadCount, gold fill from
 *     observationCount, label only when `waypoint.labeled`; every waypoint
 *     always carries the full aria-label regardless.
 *  5. The road self-draws via stroke-dasharray/dashoffset keyed to the
 *     `--mountain-progress` CSS var Mountain.tsx maintains.
 *  6. Mirror pairs: matching-altitude ticks (`waypoint.tickLength`, equal
 *     for a mirror pair by construction) plus the aria-label's own
 *     "mirrors X, the same elevation" text — no drawn edge between the two
 *     distant nodes, which BUILD_PLAN.md and design/reference/
 *     TravelingPath.dc.html both flag as the exact "network-diagram edge"
 *     look to avoid. See Mountain.tsx's header for the full reasoning.
 */
export function MountainScene({ geometry, hoveredSlug, onHoverChange, onSelect }: MountainSceneProps) {
  const { width, totalHeight, waypoints, ridgeLayers, roadPath, roadLength } = geometry;

  return (
    <svg
      viewBox={`0 0 ${width} ${totalHeight}`}
      width="100%"
      height={totalHeight}
      role="img"
      aria-label="The eleven stages of the mountain, Genesis to Revelation, as a switchback road up and over the peak"
      className="mountainScene"
    >
      <style>
        {`
        .mountain-waypoint { cursor: pointer; outline: none; }
        .mountain-waypoint circle.mountain-cairn { transition: r 0.12s ease, stroke 0.12s ease; }
        .mountain-waypoint:hover circle.mountain-cairn,
        .mountain-waypoint:focus-visible circle.mountain-cairn {
          stroke: var(--gold);
        }
        .mountain-waypoint:focus-visible circle.mountain-focus-ring { opacity: 1; }
        `}
      </style>

      <defs>
        <filter id="mountainCairnShadow" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.4" floodColor="#000000" floodOpacity="0.45" />
        </filter>
        {/*
          The road's reveal (requirement 5) lives here, not as a
          stroke-dasharray on the visible road paths directly: the
          centerline layer below carries its OWN small decorative dash
          pattern (the "woven rope" texture), and stroke-dasharray does not
          compose across two different patterns on the same property --
          setting a big reveal dasharray on a parent and a small texture
          dasharray on a child makes the child's own attribute win outright
          (SVG presentation attributes are part of the cascade, so they are
          not "unset" and never fall back to the inherited value), so the
          texture dashes rendered fully drawn regardless of scroll progress
          while the solid layers correctly stopped short -- caught by
          screenshotting the real component during this task's own build.
          A mask sidesteps the conflict entirely: this white-stroked path is
          a completely separate element with the SAME roadPath geometry,
          using stroke-dasharray/stroke-dashoffset (still the literal
          mechanism requirement 5 asks for) purely to grow a reveal mask,
          independent of whatever each visible road layer draws inside it.
        */}
        <mask id="mountainRoadReveal" maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={totalHeight}>
          <path
            d={roadPath}
            fill="none"
            stroke="#ffffff"
            strokeWidth={26}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              strokeDasharray: roadLength,
              strokeDashoffset: `calc(${roadLength} * (1 - var(--mountain-progress, 1)))`,
            }}
          />
        </mask>
      </defs>

      {/* Terrain — atmospheric ridge layers, farthest first so nearer layers paint over them.
          Nearest = darkest/most detailed (most contrast against the sky), farthest = lightest,
          blending toward haze -- real atmospheric perspective, not just a dimmer copy. */}
      <g aria-hidden="true">
        {[...ridgeLayers]
          .sort((a, b) => b.depth - a.depth)
          .map((layer) => {
            const travelPx = (3 - layer.depth) * 60;
            const fill =
              layer.depth === 0 ? "var(--shell-surface-hi)" : layer.depth === 1 ? "var(--shell-border)" : "var(--shell-border-hi)";
            return (
              <path
                key={`${layer.side}-${layer.depth}`}
                d={layer.path}
                fill={fill}
                stroke="var(--shell-border-hi)"
                strokeWidth={layer.depth === 0 ? 1.5 : 0}
                opacity={layer.opacity}
                style={{
                  transform: `translate3d(0, calc((var(--mountain-progress, 1) - 1) * ${travelPx}px), 0)`,
                }}
              />
            );
          })}
      </g>

      {/* Elevation contours — the mirror-pair "matching altitude" read, terrain-native rather than a connecting edge. */}
      <g aria-hidden="true" className="mountain-contours">
        {waypoints.map((wp) => {
          const dir = wp.x < width / 2 ? -1 : 1;
          const x2 = wp.x + dir * (wp.radius + 10 + wp.tickLength);
          return (
            <line
              key={`tick-${wp.stage.slug}`}
              x1={wp.x + dir * (wp.radius + 6)}
              y1={wp.y}
              x2={x2}
              y2={wp.y}
              stroke="var(--shell-border-hi)"
              strokeWidth={1.5}
              strokeDasharray="1 5"
              opacity={0.55}
            />
          );
        })}
      </g>

      {/* The scarlet thread, as a road: shadow, body, woven centerline -- all
          three always fully drawn, revealed together by the mask above. */}
      <g mask="url(#mountainRoadReveal)">
        <path d={roadPath} fill="none" stroke="#000000" strokeOpacity={0.35} strokeWidth={20} strokeLinecap="round" strokeLinejoin="round" />
        <path d={roadPath} fill="none" stroke="var(--shell-crimson)" strokeWidth={15} strokeLinecap="round" strokeLinejoin="round" />
        <path
          d={roadPath}
          fill="none"
          stroke="var(--shell-crimson-text)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray="10 9"
          opacity={0.8}
        />
      </g>

      {/* Waypoints — cairns on the road. */}
      {waypoints.map((wp) => {
        const hovered = hoveredSlug === wp.stage.slug;
        return (
          <g
            key={wp.stage.slug}
            className="mountain-waypoint"
            role="link"
            tabIndex={0}
            aria-label={wp.ariaLabel}
            data-stage-slug={wp.stage.slug}
            data-labeled={wp.labeled}
            data-reached={wp.reached}
            onMouseEnter={() => onHoverChange(wp.stage.slug)}
            onMouseLeave={() => onHoverChange(null)}
            onFocus={() => onHoverChange(wp.stage.slug)}
            onBlur={() => onHoverChange(null)}
            onClick={() => onSelect(wp)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(wp);
              }
            }}
          >
            <circle
              className="mountain-focus-ring"
              cx={wp.x}
              cy={wp.y}
              r={wp.radius + 7}
              fill="none"
              stroke="var(--shell-crimson-text)"
              strokeWidth={2}
              opacity={0}
            />
            <circle
              className="mountain-cairn"
              cx={wp.x}
              cy={wp.y}
              r={hovered ? wp.radius + 2 : wp.radius}
              fill={wp.filled ? "var(--gold)" : "var(--shell-bg)"}
              stroke={wp.filled ? "var(--gold-deep)" : "var(--shell-border-hi)"}
              strokeWidth={2}
              filter="url(#mountainCairnShadow)"
            />
            {wp.stage.stage === geometry.peakStage ? (
              <circle cx={wp.x} cy={wp.y} r={wp.radius + 5} fill="none" stroke="var(--gold)" strokeWidth={1} opacity={0.6} />
            ) : null}
            {wp.labeled ? (
              <text
                x={wp.x + (wp.x < width / 2 ? -(wp.radius + 12) : wp.radius + 12)}
                y={wp.y + 4}
                textAnchor={wp.x < width / 2 ? "end" : "start"}
                fontFamily="var(--font-narrow)"
                fontWeight={600}
                fontSize={11}
                fill="var(--shell-text-2)"
              >
                {wp.stage.reference}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
