/**
 * Power-up placement and collection.
 *
 * Per docs/mvp-scope.md these serve two purposes: they give a solo rider somewhere
 * to ride *to* (without a goal the game is just a map with a line on it), and
 * they exercise proximity detection in a harmless setting before the same
 * primitive is trusted with elimination.
 *
 * Placement is a three-stage pipeline, and each stage exists because the
 * previous one produced something unrideable:
 *
 *   1. Scatter candidates across angular sectors around the rider, so nodes
 *      surround them instead of clumping on one side.
 *   2. Constrain to the play zone when one is set — a node outside the
 *      boundary is worse than no node, since collecting it means elimination.
 *   3. Snap onto the rideable street graph, because a geometric scatter alone
 *      drops nodes in the river and inside blocks.
 *
 * Placement is seeded from the session start so a ride is reproducible — you
 * can re-run the same course to compare threshold changes between rides.
 */

import {
  fromLocalXY,
  haversineMeters,
  pointInPolygon,
  polygonBounds,
} from '@/utils/geo';
import { GAME_CONFIG } from '@/config/gameConfig';
import { snapToRideable } from '@/services/tilequery';
import type { LatLngLike } from '@/utils/geo';
import type { Geofence, PowerUp } from '@shared/types';

/** Small deterministic PRNG — same seed, same course. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PlacementOptions {
  count: number;
  /** Constrain nodes to this zone. Null places them in a ring around the rider. */
  geofence: Geofence | null;
}

/** How far out to scatter when a zone is set — far enough to reach its corners. */
function reachWithinZone(origin: LatLngLike, ring: Geofence): number {
  let max = 0;
  for (const [lng, lat] of ring) {
    max = Math.max(max, haversineMeters(origin, { lng, lat }));
  }
  return max;
}

/**
 * Scatters candidate positions, grouped by angular sector.
 *
 * These are only *candidates*: they are snapped onto the street graph before
 * they become real nodes.
 */
function generateCandidates(
  origin: LatLngLike,
  seed: number,
  options: PlacementOptions,
): LatLngLike[][] {
  const { candidatesPerNode, minRadiusMeters, maxRadiusMeters, minDistanceFromStartMeters } =
    GAME_CONFIG.powerUps;
  const { count, geofence } = options;

  const random = mulberry32(seed);
  const sector = (Math.PI * 2) / Math.max(1, count);

  const minRadius = Math.max(minRadiusMeters, minDistanceFromStartMeters);
  const maxRadius = geofence ? reachWithinZone(origin, geofence) : maxRadiusMeters;

  const inZone = (p: LatLngLike) => !geofence || pointInPolygon(p, geofence);

  const sample = (sectorIndex: number): LatLngLike | null => {
    // A zone can sit entirely off to one side, so a sector may have nothing
    // valid in it. Try a bounded number of times, then give up on that sector
    // rather than dragging the node somewhere it does not belong.
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = sectorIndex * sector + random() * sector;
      // sqrt keeps the scatter area-uniform rather than crowding the inner ring.
      const radius = Math.sqrt(
        minRadius ** 2 + random() * (Math.max(maxRadius, minRadius + 1) ** 2 - minRadius ** 2),
      );
      const p = fromLocalXY(origin, {
        x: Math.sin(angle) * radius,
        y: Math.cos(angle) * radius,
      });
      if (inZone(p) && haversineMeters(origin, p) >= minDistanceFromStartMeters) return p;
    }
    return null;
  };

  // Fallback for sectors the zone does not reach: sample the zone's bounding
  // box directly so the node count still gets close to what was asked for.
  const sampleAnywhereInZone = (): LatLngLike | null => {
    if (!geofence) return null;
    const [minLng, minLat, maxLng, maxLat] = polygonBounds(geofence);
    for (let attempt = 0; attempt < 60; attempt++) {
      const p = {
        lng: minLng + random() * (maxLng - minLng),
        lat: minLat + random() * (maxLat - minLat),
      };
      if (pointInPolygon(p, geofence) && haversineMeters(origin, p) >= minDistanceFromStartMeters) {
        return p;
      }
    }
    return null;
  };

  return Array.from({ length: count }, (_, i) =>
    Array.from({ length: candidatesPerNode }, () => sample(i) ?? sampleAnywhereInZone()).filter(
      (p): p is LatLngLike => p !== null,
    ),
  );
}

/**
 * Places power-ups on roads, paths, trails, alleys and parking aisles.
 *
 * Candidates with nothing rideable within the snap radius are dropped rather
 * than moved somewhere arbitrary, as are snapped results that land outside the
 * play zone or too close to a node already placed — snapping tends to collapse
 * neighbouring candidates onto the same arterial.
 *
 * Placement therefore needs the network, and resolves to fewer nodes (possibly
 * none) rather than falling back to the raw scatter: an unreachable node is
 * worse than a missing one.
 */
export async function generatePowerUps(
  origin: LatLngLike,
  seed: number,
  options: PlacementOptions,
  signal?: AbortSignal,
): Promise<PowerUp[]> {
  const { snapRadiusMeters, minSeparationMeters } = GAME_CONFIG.powerUps;
  if (options.count <= 0) return [];

  const sectors = generateCandidates(origin, seed, options);

  const snapped = await Promise.all(
    sectors.map((candidates) =>
      Promise.all(
        candidates.map((candidate) =>
          snapToRideable(candidate, snapRadiusMeters, signal).catch(() => null),
        ),
      ),
    ),
  );

  const placed: PowerUp[] = [];

  sectors.forEach((_, sectorIndex) => {
    for (const option of snapped[sectorIndex] ?? []) {
      if (!option) continue;

      // Snapping moves the point, so zone membership has to be re-checked
      // against where it actually ended up.
      if (options.geofence && !pointInPolygon(option, options.geofence)) continue;

      const tooClose = placed.some(
        (existing) => haversineMeters(existing, option) < minSeparationMeters,
      );
      if (tooClose) continue;

      placed.push({
        id: `pu-${seed}-${sectorIndex}`,
        lng: option.lng,
        lat: option.lat,
        collected: false,
        roadClass: option.roadClass,
      });
      return;
    }
  });

  return placed;
}

export interface CollectionResult {
  powerUps: PowerUp[];
  /** Power-ups collected by this position update. Usually zero or one. */
  collected: PowerUp[];
}

/** Marks any power-up within the collection radius of `position` as collected. */
export function collectNearby(
  powerUps: readonly PowerUp[],
  position: LatLngLike,
  now: number,
): CollectionResult {
  const { collectRadiusMeters } = GAME_CONFIG.powerUps;
  const collected: PowerUp[] = [];

  const next = powerUps.map((pu) => {
    if (pu.collected) return pu;
    if (haversineMeters(pu, position) > collectRadiusMeters) return pu;

    const updated: PowerUp = { ...pu, collected: true, collectedAt: now };
    collected.push(updated);
    return updated;
  });

  return { powerUps: collected.length ? next : (powerUps as PowerUp[]), collected };
}

/** Straight-line distance to the closest uncollected power-up, in metres. */
export function distanceToNearest(
  powerUps: readonly PowerUp[],
  position: LatLngLike,
): number | null {
  let best: number | null = null;
  for (const pu of powerUps) {
    if (pu.collected) continue;
    const d = haversineMeters(pu, position);
    if (best === null || d < best) best = d;
  }
  return best;
}
