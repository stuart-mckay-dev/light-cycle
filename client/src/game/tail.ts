/**
 * Tail recording and expiry.
 *
 * The tail is a chronological list of vertices. Two properties keep it cheap:
 * points are appended by *distance* travelled rather than by time, and because
 * timestamps only increase, TTL expiry is a prefix trim rather than a filter.
 *
 * At Goalpost 2 this becomes server-authoritative and expiry moves to a MongoDB
 * TTL index on `expiresAt`. The shape of the data is kept deliberately close to
 * the `tail_entries` schema so that migration is a transport change, not a
 * rewrite.
 */

import { haversineMeters } from '@/utils/geo';
import { GAME_CONFIG } from '@/config/gameConfig';
import type { TailPoint } from '@shared/types';

export interface AppendResult {
  points: TailPoint[];
  /** True when a new vertex was committed rather than the head being nudged. */
  appended: boolean;
}

/**
 * Adds a position to the tail, respecting minimum vertex spacing.
 *
 * Below the spacing threshold the newest point replaces the head instead of
 * extending it, so a stationary rider does not accumulate thousands of vertices
 * in one spot (which would both bloat memory and create a dense self-collision
 * hazard right where they are standing).
 */
export function appendTailPoint(
  points: readonly TailPoint[],
  next: TailPoint,
): AppendResult {
  const { minPointSpacingMeters, maxPoints } = GAME_CONFIG.tail;

  if (points.length === 0) {
    return { points: [next], appended: true };
  }

  const head = points[points.length - 1]!;
  const moved = haversineMeters(head, next);

  let result: TailPoint[];
  let appended: boolean;

  if (moved < minPointSpacingMeters) {
    // Replace the head — same vertex, updated position and time.
    result = points.slice(0, -1);
    result.push(next);
    appended = false;
  } else {
    result = points.slice();
    result.push(next);
    appended = true;
  }

  if (result.length > maxPoints) {
    result = result.slice(result.length - maxPoints);
  }

  return { points: result, appended };
}

/**
 * Drops vertices older than the TTL.
 *
 * Points are chronological, so this is a binary search for the cut index and a
 * slice — no per-point scan.
 */
export function expireTailPoints(
  points: readonly TailPoint[],
  now: number,
  ttlSeconds: number = GAME_CONFIG.tailTTLSeconds,
): TailPoint[] {
  const cutoff = now - ttlSeconds * 1000;

  if (points.length === 0 || points[0]!.t >= cutoff) return points as TailPoint[];

  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t < cutoff) lo = mid + 1;
    else hi = mid;
  }

  return points.slice(lo);
}

/** Total ground distance covered by the tail, in metres. */
export function tailLengthMeters(points: readonly TailPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1]!, points[i]!);
  }
  return total;
}

/** Age of the oldest surviving vertex, in seconds. Drives the TTL readout. */
export function oldestPointAgeSeconds(points: readonly TailPoint[], now: number): number {
  if (points.length === 0) return 0;
  return (now - points[0]!.t) / 1000;
}
