/**
 * Self-collision detection.
 *
 * docs/mvp-scope.md scopes Goalpost 1 to proximity detection — no map matching, no
 * intersection nodes. But raw proximity alone fails the success criterion right
 * next to it ("without significant false positives from GPS jitter"), because
 * riding *back along* a street you already rode puts you within a few metres of
 * your own tail for its whole length, and the rules are explicit that this is
 * not a collision.
 *
 * So proximity is the trigger, and an angle test is the filter: the rider must
 * be moving across the tail segment, not along it. That is the same distinction
 * Goalpost 3 will make with real intersection nodes, approximated here with
 * bearings. Set `requireCrossing: false` in the config to fall back to pure
 * proximity — worth doing on a test ride to see how much the filter is actually
 * catching.
 */

import { bearingDegrees, haversineMeters, pointToSegmentMeters } from '@/utils/geo';
import { GAME_CONFIG } from '@/config/gameConfig';
import type { LatLngLike } from '@/utils/geo';
import type { TailPoint } from '@shared/types';

export interface CollisionHit {
  /** Index of the tail vertex starting the segment that was crossed. */
  segmentIndex: number;
  /** Distance from the rider to that segment, in metres. */
  distanceMeters: number;
  /** Angle between rider heading and the segment, 0–90°. */
  crossingAngleDegrees: number;
  /** How far back along the tail the hit was, in metres. */
  tailDistanceMeters: number;
}

/**
 * Checks the rider's current position against their own tail.
 *
 * @param position Current smoothed position.
 * @param heading  Rider's recent direction of travel in degrees, or null if
 *                 unknown (too slow to have a reliable heading). When null the
 *                 angle filter is skipped — a stationary rider can't be crossing
 *                 anything, so the proximity test stands alone.
 * @param points   The active tail, oldest first.
 */
export function detectSelfCollision(
  position: LatLngLike,
  heading: number | null,
  points: readonly TailPoint[],
): CollisionHit | null {
  const { selfProximityMeters, graceMeters, requireCrossing, minCrossingAngleDegrees } =
    GAME_CONFIG.collision;

  if (points.length < 2) return null;

  // Walk backwards from the head, accumulating distance travelled. Segments
  // within `graceMeters` of the rider are the tail they are actively laying
  // down and can never be lethal.
  let tailDistance = 0;

  for (let i = points.length - 1; i > 0; i--) {
    const b = points[i]!;
    const a = points[i - 1]!;
    const segmentLength = haversineMeters(a, b);

    const distanceAtSegmentStart = tailDistance;
    tailDistance += segmentLength;

    if (distanceAtSegmentStart < graceMeters) continue;

    const distance = pointToSegmentMeters(position, a, b);
    if (distance > selfProximityMeters) continue;

    // Degenerate segment — no meaningful bearing, treat proximity as decisive.
    const segmentBearing = segmentLength > 0.5 ? bearingDegrees(a, b) : null;

    let angle = 90;
    if (requireCrossing && heading !== null && segmentBearing !== null) {
      angle = lineAngleDegrees(heading, segmentBearing);
      if (angle < minCrossingAngleDegrees) continue;
    }

    return {
      segmentIndex: i - 1,
      distanceMeters: distance,
      crossingAngleDegrees: angle,
      tailDistanceMeters: tailDistance,
    };
  }

  return null;
}

/**
 * Angle between two *undirected* lines, 0–90°.
 *
 * Direction of travel is explicitly irrelevant to the rules, so bearings 180°
 * apart (head-on along the same street) must read as parallel, not as a
 * maximal crossing.
 */
export function lineAngleDegrees(a: number, b: number): number {
  const diff = Math.abs(a - b) % 180;
  return diff > 90 ? 180 - diff : diff;
}

/**
 * Rider heading from recent tail history, or null when they haven't moved far
 * enough for it to mean anything.
 *
 * Derived from the tail rather than the device's `heading` field because that
 * field is unreliable at low speed and absent entirely on many desktop and
 * simulated fixes.
 */
export function inferHeading(points: readonly TailPoint[], lookbackMeters = 20): number | null {
  if (points.length < 2) return null;

  const head = points[points.length - 1]!;
  let distance = 0;

  for (let i = points.length - 2; i >= 0; i--) {
    distance += haversineMeters(points[i]!, points[i + 1]!);
    if (distance >= lookbackMeters) {
      return bearingDegrees(points[i]!, head);
    }
  }

  // Not enough history yet — fall back to the full span if it's long enough.
  return distance >= 5 ? bearingDegrees(points[0]!, head) : null;
}
