/**
 * Tail recording and trimming.
 *
 * The tail is a chronological list of vertices. Points are appended by
 * *distance* travelled rather than by time, and the tail is limited by total
 * length: once it is longer than the rider's budget, the oldest end is trimmed
 * back to exactly that length. Standing still therefore never shortens it.
 *
 * At Goalpost 2 this becomes server-authoritative. Vertices keep their
 * timestamps, so the shape stays close to the `tail_entries` schema, but the
 * server trims by length rather than relying on a MongoDB TTL index.
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

export interface TrimResult {
  points: TailPoint[];
  /** Whole vertices removed from the oldest end. */
  trimmed: number;
}

/**
 * Trims the oldest end of the tail so its total length does not exceed
 * `maxLengthMeters`.
 *
 * The cut lands part-way along a segment rather than on a vertex, so the tail
 * is exactly the budget long instead of losing up to a whole segment at a time.
 * The new first point is interpolated in position and time.
 */
export function trimTailToLength(
  points: readonly TailPoint[],
  maxLengthMeters: number,
): TrimResult {
  if (points.length < 2) return { points: points as TailPoint[], trimmed: 0 };

  // Walk back from the head until the budget runs out.
  let remaining = Math.max(0, maxLengthMeters);
  for (let i = points.length - 1; i > 0; i--) {
    const b = points[i]!;
    const a = points[i - 1]!;
    const segment = haversineMeters(a, b);

    if (segment < remaining || segment === 0) {
      remaining -= segment;
      continue;
    }

    // The budget ends inside segment a→b: cut it `remaining` metres back from b.
    const f = remaining / segment;
    const cut: TailPoint = {
      lng: b.lng + (a.lng - b.lng) * f,
      lat: b.lat + (a.lat - b.lat) * f,
      t: Math.round(b.t + (a.t - b.t) * f),
    };
    return { points: [cut, ...points.slice(i)], trimmed: i - 1 };
  }

  return { points: points as TailPoint[], trimmed: 0 };
}

/** Total ground distance covered by the tail, in metres. */
export function tailLengthMeters(points: readonly TailPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1]!, points[i]!);
  }
  return total;
}
