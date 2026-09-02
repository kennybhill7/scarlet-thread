import type { PlateGeometry, PlateWaypoint } from "@/lib/climb/plateGeometry";
import { PLATE_SRC, ROPE_GRADIENT_STOPS, ROPE_HIGHLIGHT_COLOR, ROPE_SHADOW_COLOR, ROPE_STROKE_WIDTHS } from "@/lib/climb/plateGeometry";
import styles from "./MountainPlates.module.css";

export interface MountainPlatesProps {
  geometry: PlateGeometry;
  hoveredSlug: string | null;
  onHoverChange: (slug: string | null) => void;
  onSelect: (waypoint: PlateWaypoint) => void;
}

const ROPE_GRADIENT_ID = "mountainPlatesRopeGradient";
const ROPE_REVEAL_MASK_ID = "mountainPlatesRopeReveal";

/**
 * MOUNTAINPLATES-001 — "The Switchback: real plates, drawn path"
 * (design/scarlet-thread-app/Scarlet Thread App.dc.html, section 15).
 * Replaces MountainScene.tsx's fully-procedural SVG terrain with Claude
 * Design's real spec: five stacked photographic "plate" images
 * (lib/climb/plateGeometry.ts's PLATE_SRC, mirrored into
 * web/public/climb/plates/) with a rope + waypoints drawn on top.
 *
 * HOOKLESS ("props in, markup out") — same discipline as MountainScene.tsx,
 * so it renders straight through `react-dom/server`'s `renderToStaticMarkup`
 * in tests. The stateful parts (scroll-driven `--mountain-progress`, the
 * router) stay one level up in Mountain.tsx; this component only *reads*
 * that ambient CSS custom property (inherited from Mountain.module.css's
 * `.wrap`) via `var(--mountain-progress, 1)` in the reveal mask below — it
 * does not attach a listener or redeclare the variable itself, so
 * Mountain.module.css's existing two-guarantee reduced-motion pattern (the
 * JS scroll listener never attaches AND the CSS pins the var to 1
 * `!important`) already covers this component for free, by inheritance,
 * with no new code duplicating that pattern.
 *
 * LAYERS (design doc's own names):
 *  - Layer 1 (plates): five <img>s stacked in a column, one per
 *    `geometry.bands`, each sized to that band's real REFLOWED height
 *    (plateGeometry.ts sums mountainGeometry.ts's own segmentPx() across
 *    the band's member stages — more combined chapters -> a taller plate).
 *  - Layer 2 (the rope): one absolutely-positioned <svg> spanning the whole
 *    column, three stacked <path> elements (shadow / gradient face /
 *    highlight) in the exact order/spec the design doc's "Layer 2 · the
 *    rope" section gives, revealed by a stroke-dasharray/dashoffset mask
 *    keyed to `--mountain-progress` (same literal mechanism
 *    MountainScene.tsx's own `mountainRoadReveal` mask used).
 *  - Layer 3 (waypoints): plain HTML buttons (not SVG shapes), positioned
 *    by percentage so they always land exactly on the rope regardless of
 *    the container's actual rendered width — matches the design doc's own
 *    choice to draw waypoints as separate elements from the rope's SVG
 *    (its Layer 3 diagram keeps the rope SVG at low opacity underneath
 *    plain positioned markers, not SVG circles).
 *
 * `preserveAspectRatio="none"` on the rope's <svg>: the outer column's
 * pixel box (explicit heightPx set on the wrapper) and each waypoint
 * button's percentage-based (left/top) position both scale independently
 * per axis to fill the real rendered container exactly. For the rope to
 * stay registered against those same percentage-positioned waypoints, its
 * SVG must stretch identically (both axes independently) rather than
 * letterbox under the default "meet" behavior MountainScene.tsx relies on
 * -- the tradeoff is a small, generally imperceptible stroke-width skew
 * when the rendered column width differs from PLATE_COLUMN_WIDTH (320,
 * chosen to already be close to this app's real mobile-card width).
 */
export function MountainPlates({ geometry, hoveredSlug, onHoverChange, onSelect }: MountainPlatesProps) {
  const { columnWidth, totalHeight, bands, waypoints, ropePathD, ropeLength } = geometry;

  return (
    <div className={styles.column} style={{ height: totalHeight }} data-testid="mountain-plates">
      <div className={styles.plates} aria-hidden="true">
        {bands.map((band, index) => (
          <div key={band.name} className={styles.plate} style={{ height: band.heightPx }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- no next/image use anywhere in this repo; a plain <img> matches every other asset here. */}
            <img
              src={PLATE_SRC[band.name]}
              alt=""
              className={styles.plateImg}
              loading={index < 2 ? "eager" : "lazy"}
              decoding="async"
            />
          </div>
        ))}
      </div>

      <svg
        className={styles.rope}
        viewBox={`0 0 ${columnWidth} ${totalHeight}`}
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
          {/* Reveal mask: a white-stroked copy of the SAME rope path, using
              stroke-dasharray/dashoffset purely to grow a reveal region --
              identical technique to MountainScene.tsx's own
              `mountainRoadReveal` mask and its documented reasoning (a
              dasharray on this path can't conflict with the three visible
              strokes' own full, undashed strokes below). */}
          <mask id={ROPE_REVEAL_MASK_ID} maskUnits="userSpaceOnUse" x={0} y={0} width={columnWidth} height={totalHeight}>
            <path
              d={ropePathD}
              fill="none"
              stroke="#ffffff"
              strokeWidth={ROPE_STROKE_WIDTHS.shadow + 6}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                strokeDasharray: ropeLength,
                strokeDashoffset: `calc(${ropeLength} * (1 - var(--mountain-progress, 1)))`,
              }}
            />
          </mask>
        </defs>

        <g mask={`url(#${ROPE_REVEAL_MASK_ID})`}>
          <path
            d={ropePathD}
            fill="none"
            stroke={ROPE_SHADOW_COLOR}
            strokeWidth={ROPE_STROKE_WIDTHS.shadow}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.55}
            transform="translate(0,3)"
          />
          <path
            d={ropePathD}
            fill="none"
            stroke={`url(#${ROPE_GRADIENT_ID})`}
            strokeWidth={ROPE_STROKE_WIDTHS.face}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={ropePathD}
            fill="none"
            stroke={ROPE_HIGHLIGHT_COLOR}
            strokeWidth={ROPE_STROKE_WIDTHS.highlight}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.5}
            transform="translate(-1,-2)"
          />
        </g>
      </svg>

      <div className={styles.waypoints}>
        {waypoints.map((wp) => {
          const hovered = hoveredSlug === wp.stage.slug;
          return (
            <button
              key={wp.stage.slug}
              type="button"
              className={`${styles.waypoint} ${hovered ? styles.hovered : ""}`}
              style={{
                left: `${(wp.x / columnWidth) * 100}%`,
                top: `${(wp.y / totalHeight) * 100}%`,
              }}
              aria-label={wp.ariaLabel}
              aria-current={wp.status === "current" ? "step" : undefined}
              data-stage-slug={wp.stage.slug}
              data-status={wp.status}
              onMouseEnter={() => onHoverChange(wp.stage.slug)}
              onMouseLeave={() => onHoverChange(null)}
              onFocus={() => onHoverChange(wp.stage.slug)}
              onBlur={() => onHoverChange(null)}
              onClick={() => onSelect(wp)}
            >
              <span className={`${styles.dot} ${styles[wp.status]}`} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
