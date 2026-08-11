/**
 * Geodesic helpers.
 *
 * Everything the game does geometrically happens inside a few hundred metres,
 * so distances use the haversine formula and anything needing real 2D geometry
 * (point-to-segment distance, segment intersection) first projects to a local
 * east/north metre plane around a nearby origin. At city-block scale the
 * projection error is far below GPS noise, and it keeps the geometry code
 * ordinary cartesian maths instead of spherical trigonometry.
 */

import type { LngLat } from '@shared/types';

const EARTH_RADIUS_M = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;

export interface LatLngLike {
  lng: number;
  lat: number;
}

/** Great-circle distance between two points, in metres. */
export function haversineMeters(a: LatLngLike, b: LatLngLike): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, in degrees clockwise from north. */
export function bearingDegrees(a: LatLngLike, b: LatLngLike): number {
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) / DEG_TO_RAD + 360) % 360;
}

export interface XY {
  x: number;
  y: number;
}

/**
 * Projects a point to metres east/north of `origin` (equirectangular).
 * Accurate to well under a metre across a few kilometres — ample here.
 */
export function toLocalXY(origin: LatLngLike, p: LatLngLike): XY {
  const latScale = Math.cos(origin.lat * DEG_TO_RAD);
  return {
    x: (p.lng - origin.lng) * DEG_TO_RAD * EARTH_RADIUS_M * latScale,
    y: (p.lat - origin.lat) * DEG_TO_RAD * EARTH_RADIUS_M,
  };
}

/** Inverse of {@link toLocalXY}. */
export function fromLocalXY(origin: LatLngLike, p: XY): LatLngLike {
  const latScale = Math.cos(origin.lat * DEG_TO_RAD);
  return {
    lng: origin.lng + p.x / (DEG_TO_RAD * EARTH_RADIUS_M * latScale),
    lat: origin.lat + p.y / (DEG_TO_RAD * EARTH_RADIUS_M),
  };
}

/**
 * Shortest distance in metres from point `p` to the segment `a`–`b`.
 * This is the primitive behind proximity-based self-collision.
 */
export function pointToSegmentMeters(p: LatLngLike, a: LatLngLike, b: LatLngLike): number {
  const origin = a;
  const pp = toLocalXY(origin, p);
  const bb = toLocalXY(origin, b);

  const lenSq = bb.x * bb.x + bb.y * bb.y;
  if (lenSq === 0) return Math.hypot(pp.x, pp.y);

  const t = Math.max(0, Math.min(1, (pp.x * bb.x + pp.y * bb.y) / lenSq));
  return Math.hypot(pp.x - t * bb.x, pp.y - t * bb.y);
}

/**
 * True when segments `p1`–`p2` and `p3`–`p4` properly cross.
 *
 * Used for crossing-based collision. Collinear and touching-at-an-endpoint
 * cases return false: riding onto the exact line of an existing tail is
 * "same street", which the rules explicitly do not treat as a collision.
 */
export function segmentsIntersect(
  p1: LatLngLike,
  p2: LatLngLike,
  p3: LatLngLike,
  p4: LatLngLike,
): boolean {
  const origin = p1;
  const a = toLocalXY(origin, p1);
  const b = toLocalXY(origin, p2);
  const c = toLocalXY(origin, p3);
  const d = toLocalXY(origin, p4);

  const cross = (o: XY, p: XY, q: XY) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);

  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);

  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** Absolute difference between two bearings, normalised to 0–180°. */
export function bearingDeltaDegrees(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/** Converts to the [lng, lat] tuple Mapbox and GeoJSON expect. */
export function toLngLat(p: LatLngLike): LngLat {
  return [p.lng, p.lat];
}

// ---------------------------------------------------------------------------
// Polygons — play zones
// ---------------------------------------------------------------------------

/**
 * Ray-casting point-in-polygon over a closed ring given open (the closing edge
 * is implied).
 *
 * Deliberately generic over vertex count rather than a bounding-box test: the
 * corners are dragged independently, so the zone is an arbitrary quadrilateral
 * from the moment the rider touches it, and the polygon and freehand tools
 * planned later need exactly this.
 */
export function pointInPolygon(p: LatLngLike, ring: readonly LngLat[]): boolean {
  if (ring.length < 3) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;

    // Does the horizontal ray at p.lat cross this edge, and if so, to the right?
    const straddles = yi > p.lat !== yj > p.lat;
    if (straddles && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Shortest distance from a point to the polygon's perimeter, in metres. */
export function distanceToPolygonEdgeMeters(
  p: LatLngLike,
  ring: readonly LngLat[],
): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = { lng: ring[j]![0], lat: ring[j]![1] };
    const b = { lng: ring[i]![0], lat: ring[i]![1] };
    best = Math.min(best, pointToSegmentMeters(p, a, b));
  }
  return best;
}

/**
 * True when the ring crosses itself — a bow-tie.
 *
 * Dragging one corner past another produces this easily, and the result is a
 * zone whose inside is not what the rider thinks it is, so the setup screen
 * blocks starting until it is fixed.
 */
export function polygonSelfIntersects(ring: readonly LngLat[]): boolean {
  const n = ring.length;
  if (n < 4) return false;

  const pt = (i: number) => ({ lng: ring[i]![0], lat: ring[i]![1] });

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Skip edges that share a vertex — they always "touch".
      if (i === j || (i + 1) % n === j || (j + 1) % n === i) continue;
      if (segmentsIntersect(pt(i), pt((i + 1) % n), pt(j), pt((j + 1) % n))) {
        return true;
      }
    }
  }
  return false;
}

/** Axis-aligned bounds of a ring, as [minLng, minLat, maxLng, maxLat]. */
export function polygonBounds(ring: readonly LngLat[]): [number, number, number, number] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
}

/** Area enclosed by the ring, in square metres (shoelace on a local plane). */
export function polygonAreaSqMeters(ring: readonly LngLat[]): number {
  if (ring.length < 3) return 0;

  const origin = { lng: ring[0]![0], lat: ring[0]![1] };
  const pts = ring.map(([lng, lat]) => toLocalXY(origin, { lng, lat }));

  let sum = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    sum += pts[j]!.x * pts[i]!.y - pts[i]!.x * pts[j]!.y;
  }
  return Math.abs(sum) / 2;
}

/** Shortest side of the ring, in metres. Used to enforce a minimum zone size. */
export function shortestSideMeters(ring: readonly LngLat[]): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    best = Math.min(
      best,
      haversineMeters(
        { lng: ring[j]![0], lat: ring[j]![1] },
        { lng: ring[i]![0], lat: ring[i]![1] },
      ),
    );
  }
  return best;
}
