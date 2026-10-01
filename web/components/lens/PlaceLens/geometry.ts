/**
 * PLACELENS-001 — pure projection/geometry math for the orthographic globe.
 * `d3-geo`'s `geoOrthographic`, no DOM, no React: every function here takes
 * plain data in and returns plain data (numbers, SVG path strings) out, so
 * it is directly `node:test`-able (same split `plateGeometry.ts` keeps
 * between geometry and the component that renders it).
 *
 * Rotation convention: `{ lambda, phi }` in DEGREES, `lambda` = spin around
 * the polar axis (east/west — "which meridian faces the viewer"), `phi` =
 * tilt (north/south). Passed to d3-geo as `.rotate([-lambda, -phi])` — d3-geo
 * rotates the SPHERE under a fixed viewer, which is the photographic negative
 * of "the viewer drags the globe": dragging right (increasing lambda) must
 * turn the globe so a point further west comes into view, i.e. the sphere
 * rotates by -lambda. Getting this sign wrong is the single easiest way to
 * build a globe that spins backwards from the pointer — projectPoint's own
 * test fixes known lon/lat pairs at known rotations to catch exactly that.
 */
import { geoOrthographic, geoPath, type GeoPath, type GeoProjection } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";

export interface Rotation {
  lambda: number;
  phi: number;
}

export interface ProjectionConfig {
  rotation: Rotation;
  /** Pixel radius of the globe. */
  scale: number;
  /** Pixel center of the globe. */
  translate: readonly [number, number];
}

/** Builds a d3-geo orthographic projection from the lens's own config shape. */
export function buildProjection(config: ProjectionConfig): GeoProjection {
  return geoOrthographic()
    .rotate([-config.rotation.lambda, -config.rotation.phi])
    .scale(config.scale)
    .translate([config.translate[0], config.translate[1]])
    .clipAngle(90);
}

export function buildPath(projection: GeoProjection): GeoPath {
  return geoPath(projection);
}

/**
 * Whether the point at (lon, lat) is on the near (visible) hemisphere for
 * `rotation` — the great-circle-distance-from-center test, independent of
 * d3-geo's own clipping (used by callers that need a boolean, e.g. "only
 * list places currently facing the viewer", without round-tripping through
 * an SVG path).
 */
export function isFrontFacing(rotation: Rotation, lon: number, lat: number): boolean {
  const toRad = Math.PI / 180;
  const lambda0 = rotation.lambda * toRad;
  const phi0 = rotation.phi * toRad;
  const lambda = lon * toRad;
  const phi = lat * toRad;
  // cos(angular distance) between the view center and the point, on the unit sphere.
  const cosDistance =
    Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lambda - lambda0);
  return cosDistance > 0;
}

/**
 * Projects (lon, lat) to pixel [x, y], or null when it is on the far
 * hemisphere (beyond `clipAngle`). Deliberately does NOT call
 * `projection([lon, lat])` directly — that bare call bypasses d3-geo's clip
 * pipeline entirely and returns a (wrong, "wrapped around the back")
 * coordinate for a point nowhere near the visible hemisphere; only
 * `geoPath`'s stream-based rendering actually consults `clipAngle` (verified
 * directly against d3-geo: `geoOrthographic().clipAngle(90)([170, 0])`
 * returns a real coordinate, not null, even though 170 degrees is obviously
 * on the far side — this function exists specifically so every OTHER
 * function in this module can call it and get a result that means what its
 * name says, instead of every caller needing to remember to pre-filter with
 * `isFrontFacing` the way `markers.ts` does today). Feeding one point
 * through `projection.stream()` (the same pipeline `geoPath` itself drives)
 * is the standard d3-geo technique for this.
 */
export function projectPoint(projection: GeoProjection, lon: number, lat: number): [number, number] | null {
  let result: [number, number] | null = null;
  const sink: Parameters<GeoProjection["stream"]>[0] = {
    point: (x, y) => {
      result = [x, y];
    },
    lineStart: () => {},
    lineEnd: () => {},
    polygonStart: () => {},
    polygonEnd: () => {},
    sphere: () => {},
  };
  projection.stream(sink).point(lon, lat);
  return result;
}

/** The outer circle of the globe (the sphere's own silhouette), as an SVG path `d`. */
export function sphereOutlinePath(projection: GeoProjection): string {
  const path = buildPath(projection);
  return path({ type: "Sphere" }) ?? "";
}

/**
 * The lon/lat grid (graticule), as an SVG path `d`. Meridians and parallels
 * are built as geographic LineStrings (sampled every 5° along each line, so
 * the great-circle curvature the projection applies is visible, not a
 * straight chord) and projected through the same `geoPath` every other
 * geometry in this module uses.
 */
export function graticulePath(projection: GeoProjection, step = 10): string {
  const path = buildPath(projection);
  const meridians = [];
  for (let lon = -180; lon < 180; lon += step) {
    const coords: [number, number][] = [];
    for (let lat = -80; lat <= 80; lat += 5) coords.push([lon, lat]);
    meridians.push({ type: "LineString" as const, coordinates: coords });
  }
  const parallels = [];
  for (let lat = -80; lat <= 80; lat += step) {
    const coords: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += 5) coords.push([lon, lat]);
    parallels.push({ type: "LineString" as const, coordinates: coords });
  }
  const d = [...meridians, ...parallels]
    .map((geometry) => path(geometry))
    .filter((segment): segment is string => segment !== null)
    .join("");
  return d;
}

/** Converts the Natural Earth `land` TopoJSON object to a path `d` for the current projection. */
export function landPath(projection: GeoProjection, topology: Topology): string {
  const object = topology.objects.land;
  if (!object) return "";
  const geojson = feature(topology, object);
  const path = buildPath(projection);
  return path(geojson) ?? "";
}

/**
 * A great-circle arc between two located places, sampled into a `d`
 * polyline (d3-geo's own path generator already great-circle-interpolates a
 * LineString geometry — this just builds that geometry). `segments` controls
 * smoothness; d3-geo's clipping means a dateline/far-hemisphere crossing
 * degrades to a partial or empty path, not a straight line across the globe.
 */
export function greatCircleArcPath(
  projection: GeoProjection,
  from: readonly [number, number],
  to: readonly [number, number],
): string {
  const path = buildPath(projection);
  return (
    path({
      type: "LineString",
      coordinates: [
        [from[0], from[1]],
        [to[0], to[1]],
      ],
    }) ?? ""
  );
}

/** Clamps `value` into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The biblical-world bounding box the plan names (§C.6.2): ~24°E-52°E,
 * 24°N-42°N. Its center, for "zoom to region".
 */
export const BIBLICAL_WORLD_BBOX = { west: 24, east: 52, south: 24, north: 42 } as const;

export const BIBLICAL_WORLD_CENTER: Rotation = {
  lambda: (BIBLICAL_WORLD_BBOX.west + BIBLICAL_WORLD_BBOX.east) / 2,
  phi: (BIBLICAL_WORLD_BBOX.south + BIBLICAL_WORLD_BBOX.north) / 2,
};

/** Standard cubic ease, used for the world <-> region zoom transition (and nowhere else). */
export function easeInOutCubic(t: number): number {
  const c = clamp(t, 0, 1);
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Interpolates rotation the SHORT way around the lambda (longitude) axis —
 * naive linear interpolation between e.g. 170 and -170 would spin the
 * "wrong" way around almost the whole globe instead of the short 20° hop.
 */
export function lerpRotation(a: Rotation, b: Rotation, t: number): Rotation {
  const deltaLambda = ((b.lambda - a.lambda + 540) % 360) - 180;
  return {
    lambda: a.lambda + deltaLambda * t,
    phi: lerp(a.phi, b.phi, t),
  };
}
