/**
 * Play-zone boundary and its enforcement.
 *
 * Without a boundary the game has no pressure. Tails expire after a few
 * minutes, so a rider who sees a situation developing can ride away in a
 * straight line and wait it out — nothing forces the doubling-back that
 * creates the danger in the first place. A bounded zone is what turns a long
 * ride into a shrinking space.
 *
 * docs/mvp-scope.md puts the geofence in Goalpost 3 and makes it server-enforced.
 * It is here early, client-side, because Goalpost 1's field test is otherwise
 * measuring a game that cannot really be lost. The rule it implements is the
 * one from docs/prd.md section 13: warn on exit, eliminate after a grace period.
 */

import {
  distanceToPolygonEdgeMeters,
  fromLocalXY,
  pointInPolygon,
  polygonSelfIntersects,
  shortestSideMeters,
  type LatLngLike,
} from '@/utils/geo';
import { GAME_CONFIG } from '@/config/gameConfig';
import type { Geofence, LngLat } from '@shared/types';

/**
 * A square zone centred on the rider, corners ordered clockwise from
 * north-west. Big enough that the rider is not immediately boxed in, small
 * enough that riding to a boundary is a real decision.
 */
export function defaultGeofence(centre: LatLngLike): Geofence {
  const half = GAME_CONFIG.geofence.defaultSizeMeters / 2;

  const corners: Array<[number, number]> = [
    [-half, half], // NW
    [half, half], // NE
    [half, -half], // SE
    [-half, -half], // SW
  ];

  return corners.map(([x, y]) => {
    const { lng, lat } = fromLocalXY(centre, { x, y });
    return [lng, lat] as LngLat;
  });
}

export interface GeofenceProblem {
  kind: 'self_intersecting' | 'too_small';
  message: string;
}

/** Why this zone cannot be used, or null when it is fine. */
export function validateGeofence(ring: Geofence): GeofenceProblem | null {
  if (ring.length < 3) {
    return { kind: 'too_small', message: 'A zone needs at least three corners.' };
  }

  if (polygonSelfIntersects(ring)) {
    return {
      kind: 'self_intersecting',
      message: 'The zone crosses itself. Drag the corners so the edges do not overlap.',
    };
  }

  const shortest = shortestSideMeters(ring);
  if (shortest < GAME_CONFIG.geofence.minSideMeters) {
    return {
      kind: 'too_small',
      message: `Zone is too small — the shortest side is ${Math.round(shortest)} m, minimum is ${GAME_CONFIG.geofence.minSideMeters} m.`,
    };
  }

  return null;
}

export interface ZoneStatus {
  inside: boolean;
  /** Distance to the nearest boundary edge, in metres. */
  distanceToEdgeMeters: number;
  /** Inside, but close enough to the edge that the rider should be told. */
  approaching: boolean;
}

export function zoneStatus(position: LatLngLike, ring: Geofence | null): ZoneStatus | null {
  if (!ring || ring.length < 3) return null;

  const inside = pointInPolygon(position, ring);
  const distance = distanceToPolygonEdgeMeters(position, ring);

  return {
    inside,
    distanceToEdgeMeters: distance,
    approaching: inside && distance <= GAME_CONFIG.geofence.warnWithinMeters,
  };
}

/** Seconds left before a rider outside the zone is eliminated. */
export function graceRemainingSeconds(outsideSince: number, now: number): number {
  const elapsed = (now - outsideSince) / 1000;
  return Math.max(0, GAME_CONFIG.geofence.graceSeconds - elapsed);
}
