/**
 * GPS smoothing and rejection.
 *
 * Raw browser geolocation on a moving bike is noisy in two distinct ways, and
 * they need different treatment:
 *
 *   1. Outliers — a single fix teleports a block away, usually with a terrible
 *      accuracy figure attached. Averaging these in drags the tail sideways, so
 *      they are rejected before they reach the filter.
 *   2. Jitter — every fix wobbles a few metres around the truth. This is what
 *      the moving average is for.
 *
 * The filter is an accuracy-weighted moving average over a short window: a fix
 * the device is confident about pulls harder than a vague one. That gets most of
 * the benefit of a Kalman filter for a fraction of the complexity, which matters
 * because this code has to be debuggable at the roadside.
 */

import { haversineMeters } from './geo';
import { GAME_CONFIG } from '@/config/gameConfig';
import type { PositionFix } from '@shared/types';

export type RejectionReason = 'accuracy' | 'speed' | 'stale';

export interface SmoothingResult {
  /** The filtered position, or null when the fix was rejected. */
  fix: PositionFix | null;
  rejected: RejectionReason | null;
}

export interface SmootherStats {
  accepted: number;
  rejected: Record<RejectionReason, number>;
  /** Mean metres between the raw fix and the smoothed output. */
  meanCorrectionMeters: number;
  /** Mean seconds between accepted fixes — the real-world update rate. */
  meanIntervalSeconds: number;
}

export class GpsSmoother {
  private window: PositionFix[] = [];
  /** Last smoothed output — the reference for the deadband. */
  private last: PositionFix | null = null;
  /**
   * Last *raw* fix that was accepted — the reference for the speed and
   * ordering checks. It must be raw, not smoothed: the smoothed position lags
   * the rider by about half the window, so measuring a new raw fix against it
   * overstates speed (~2.5x at a window of 4 and one fix per second) and
   * rejected ordinary fast riding as a GPS jump.
   */
  private lastRaw: PositionFix | null = null;
  private correctionTotal = 0;
  private intervalTotal = 0;
  private acceptedCount = 0;
  private rejectedCounts: Record<RejectionReason, number> = { accuracy: 0, speed: 0, stale: 0 };

  /** Feeds in a raw fix and returns the smoothed position, or a rejection. */
  push(raw: PositionFix): SmoothingResult {
    const { maxAccuracyMeters, maxPlausibleSpeedMps, smoothingWindow, deadbandMeters } =
      GAME_CONFIG.gps;

    if (!Number.isFinite(raw.accuracy) || raw.accuracy > maxAccuracyMeters) {
      this.rejectedCounts.accuracy++;
      return { fix: null, rejected: 'accuracy' };
    }

    if (this.lastRaw) {
      const dt = (raw.timestamp - this.lastRaw.timestamp) / 1000;

      // A fix older than one already accepted is out of order — drop it.
      if (dt <= 0) {
        this.rejectedCounts.stale++;
        return { fix: null, rejected: 'stale' };
      }

      const impliedSpeed = haversineMeters(this.lastRaw, raw) / dt;
      if (impliedSpeed > maxPlausibleSpeedMps) {
        this.rejectedCounts.speed++;
        return { fix: null, rejected: 'speed' };
      }

      this.intervalTotal += dt;
    }

    this.window.push(raw);
    if (this.window.length > smoothingWindow) this.window.shift();

    // Weight by inverse accuracy: a 5 m fix counts four times a 20 m fix.
    let weightSum = 0;
    let lng = 0;
    let lat = 0;
    for (const f of this.window) {
      const w = 1 / Math.max(1, f.accuracy);
      weightSum += w;
      lng += f.lng * w;
      lat += f.lat * w;
    }

    const smoothed: PositionFix = {
      ...raw,
      lng: lng / weightSum,
      lat: lat / weightSum,
    };

    // Deadband: hold position when the change is smaller than the noise floor.
    if (this.last && haversineMeters(this.last, smoothed) < deadbandMeters) {
      smoothed.lng = this.last.lng;
      smoothed.lat = this.last.lat;
    }

    this.correctionTotal += haversineMeters(raw, smoothed);
    this.acceptedCount++;
    this.last = smoothed;
    this.lastRaw = raw;

    return { fix: smoothed, rejected: null };
  }

  stats(): SmootherStats {
    return {
      accepted: this.acceptedCount,
      rejected: { ...this.rejectedCounts },
      meanCorrectionMeters: this.acceptedCount ? this.correctionTotal / this.acceptedCount : 0,
      meanIntervalSeconds: this.acceptedCount > 1 ? this.intervalTotal / (this.acceptedCount - 1) : 0,
    };
  }

  reset(): void {
    this.window = [];
    this.last = null;
    this.lastRaw = null;
    this.correctionTotal = 0;
    this.intervalTotal = 0;
    this.acceptedCount = 0;
    this.rejectedCounts = { accuracy: 0, speed: 0, stale: 0 };
  }
}
