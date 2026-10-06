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
 * The last element is a *live head* that tracks the rider; everything before it
 * is a committed vertex. A head that is still closer than the spacing to the
 * vertex before it is live, and the next fix moves it rather than adding a
 * point, so a stationary rider does not accumulate thousands of vertices in one
 * spot (which would both bloat memory and create a dense self-collision hazard
 * right where they are standing). Once the head has moved the full spacing away
 * from the last committed vertex it is committed where it stands, and the
 * following fix starts a new live head.
 *
 * Spacing is measured from the last *committed* vertex, never from the live
 * head. Measuring from the head was a bug: each nudge moved the reference point
 * along with the rider, so when consecutive fixes were closer together than the
 * spacing — anyone below ~6 m/s at one fix per second — the head slid forward
 * forever and the tail never grew past a single point. See docs/mvp-scope.md,
 * "Known issues found in simulation".
 */
export function appendTailPoint(
  points: readonly TailPoint[],
  next: TailPoint,
): AppendResult {
  const { minPointSpacingMeters, maxPoints } = GAME_CONFIG.tail;

  if (points.length === 0) {
    return { points: [next], appended: true };
  }

  // A lone point is the start of the ride and always committed. Beyond that,
  // the head is live while it sits within the spacing of the vertex behind it.
  const head = points[points.length - 1]!;
  const prev = points.length >= 2 ? points[points.length - 2]! : null;
  const headIsLive = prev !== null && haversineMeters(prev, head) < minPointSpacingMeters;

  let result: TailPoint[];
  let appended: boolean;

  if (headIsLive && prev) {
    // Move the live head. If this fix carries it the full spacing from the last
    // committed vertex, it becomes committed in place.
    result = points.slice(0, -1);
    result.push(next);
    appended = haversineMeters(prev, next) >= minPointSpacingMeters;
  } else {
    // The head is committed; this fix starts the next segment. It is committed
    // immediately if it is already a full spacing away, live otherwise.
    result = points.slice();
    result.push(next);
    appended = haversineMeters(head, next) >= minPointSpacingMeters;
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
