/**
 * Application event log.
 *
 * The ride-log export only ever held GPS fixes, which answers "where was I"
 * but not "what did the game decide, and why". This records the whole loop —
 * state transitions, tail growth, placement results, collection, zone
 * transitions, collisions, wake lock, errors — so a ride can be audited after
 * the fact rather than reconstructed from memory.
 *
 * Two properties matter more than completeness:
 *
 *   1. It survives a reload. A phone under memory pressure, an accidental
 *      pull-to-refresh, or iOS reclaiming a backgrounded PWA all used to take
 *      the entire log with them. Events are mirrored into localStorage and the
 *      previous session is recoverable on next load.
 *   2. It is exportable mid-ride, not only from the elimination screen. A ride
 *      that ends by quitting, crashing or running out of battery is exactly the
 *      ride whose log you want.
 *
 * Kept deliberately free of React so the game modules can log without a
 * component in scope.
 */

import { GAME_CONFIG } from '@/config/gameConfig';
import type { EliminationReason, PositionFix } from '@shared/types';
import type { RejectionReason } from './smoothing';

export type GameEvent =
  | { type: 'session'; ua: string; screen: string; config: unknown }
  | { type: 'status'; from: string; to: string }
  | {
      type: 'fix';
      raw: { lng: number; lat: number; accuracy: number };
      smoothed: { lng: number; lat: number } | null;
      rejected: RejectionReason | null;
      speed: number | null;
      heading: number | null;
      /** Milliseconds since the previous fix, as reported by the device. */
      dt: number | null;
    }
  | { type: 'tail'; points: number; lengthMeters: number; maxLengthMeters: number; trimmed: number }
  | {
      type: 'powerups_placed';
      requested: number;
      placed: number;
      roadClasses: string[];
      elapsedMs: number;
      error: string | null;
    }
  | { type: 'powerup_collected'; id: string; roadClass?: string; score: number; maxLengthMeters: number }
  | {
      type: 'zone';
      state: 'exit' | 'reenter';
      distanceToEdgeMeters: number;
      graceRemainingSeconds: number | null;
    }
  | {
      type: 'collision';
      crossingAngleDegrees: number;
      distanceMeters: number;
      tailDistanceMeters: number;
    }
  | { type: 'wakelock'; state: 'acquired' | 'released' | 'failed' | 'unsupported'; message?: string }
  | { type: 'geo_error'; message: string }
  | { type: 'eliminated'; reason: EliminationReason; elapsedSeconds: number; score: number };

export interface LoggedEvent {
  /** Monotonic sequence number — survives clock changes, unlike `t`. */
  seq: number;
  /** Epoch milliseconds. */
  t: number;
  event: GameEvent;
}

/**
 * At roughly 1 Hz plus incidental events, a two-hour ride is well under this.
 * The cap exists so a pathological loop cannot exhaust memory mid-ride.
 */
const MAX_EVENTS = 50_000;

const STORAGE_KEY = 'light-cycle:eventlog';
const PREVIOUS_KEY = 'light-cycle:eventlog:previous';
const FLUSH_INTERVAL_MS = 15_000;

let events: LoggedEvent[] = [];
let seq = 0;
let dirty = false;
let flushTimer: number | null = null;

function persist(): void {
  if (!dirty) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    dirty = false;
  } catch {
    // Quota exceeded, or storage disabled (Safari private browsing). The
    // in-memory log is still intact and exportable; only reload-survival is
    // lost, which is not worth interrupting a ride over.
  }
}

/** Starts a log for a new session, archiving whatever the last one left behind. */
export function startEventLog(): void {
  try {
    const carried = localStorage.getItem(STORAGE_KEY);
    if (carried) localStorage.setItem(PREVIOUS_KEY, carried);
  } catch {
    /* storage unavailable */
  }

  events = [];
  seq = 0;
  dirty = true;

  logEvent({
    type: 'session',
    ua: navigator.userAgent,
    screen: `${window.screen.width}x${window.screen.height} @${window.devicePixelRatio}x`,
    config: GAME_CONFIG,
  });

  if (flushTimer === null) {
    flushTimer = window.setInterval(persist, FLUSH_INTERVAL_MS);

    // The moments most likely to lose a log are exactly the ones that fire
    // these: the app being backgrounded, or the tab going away.
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') persist();
    });
  }
}

export function logEvent(event: GameEvent): void {
  events.push({ seq: seq++, t: Date.now(), event });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  dirty = true;
}

/** Convenience wrapper — the fix shape is logged from two places. */
export function logFix(
  raw: PositionFix,
  smoothed: PositionFix | null,
  rejected: RejectionReason | null,
  previousTimestamp: number | null,
): void {
  logEvent({
    type: 'fix',
    raw: { lng: raw.lng, lat: raw.lat, accuracy: raw.accuracy },
    smoothed: smoothed ? { lng: smoothed.lng, lat: smoothed.lat } : null,
    rejected,
    speed: raw.speed,
    heading: raw.heading,
    dt: previousTimestamp === null ? null : raw.timestamp - previousTimestamp,
  });
}

export function getEvents(): readonly LoggedEvent[] {
  return events;
}

export function eventCount(): number {
  return events.length;
}

/** Counts by event type — the summary the debug panel shows. */
export function eventSummary(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.event.type] = (counts[e.event.type] ?? 0) + 1;
  return counts;
}

/** The log from the session before this one, if a reload interrupted it. */
export function getPreviousSession(): LoggedEvent[] | null {
  try {
    const raw = localStorage.getItem(PREVIOUS_KEY);
    return raw ? (JSON.parse(raw) as LoggedEvent[]) : null;
  } catch {
    return null;
  }
}

export function buildExport(which: 'current' | 'previous' = 'current') {
  const rows = which === 'previous' ? (getPreviousSession() ?? []) : events;
  return {
    exportedAt: new Date().toISOString(),
    session: which,
    appVersion: import.meta.env.MODE,
    eventCount: rows.length,
    summary: which === 'current' ? eventSummary() : undefined,
    events: rows,
  };
}

/** Downloads the log as JSON, falling back to a new tab where that is blocked. */
export function downloadEventLog(which: 'current' | 'previous' = 'current'): void {
  const json = JSON.stringify(buildExport(which), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const name = `light-cycle-${which}-${Date.now()}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();

  // iOS Safari, and standalone PWAs in particular, sometimes ignore `download`
  // on a blob. Revoking late leaves the URL usable if the click did nothing and
  // the rider falls back to copying instead.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Copies the log to the clipboard.
 *
 * The escape hatch for iOS, where a blob download can silently do nothing and
 * there is no obvious way to get a file off the phone mid-ride.
 */
export async function copyEventLog(which: 'current' | 'previous' = 'current'): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(buildExport(which)));
    return true;
  } catch {
    return false;
  }
}
