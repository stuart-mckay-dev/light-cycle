/**
 * Live instrumentation.
 *
 * Goalpost 1 is a measurement exercise as much as a game — docs/mvp-scope.md asks
 * how accurate bike GPS is, what update rate is achievable, and how much jitter
 * there is in practice. This panel answers all three while the ride is
 * happening, so a threshold can be judged on the road rather than guessed at.
 */

import { useState } from 'react';
import { haversineMeters } from '@/utils/geo';
import { GAME_CONFIG } from '@/config/gameConfig';
import { getSmootherStats } from '@/store/gameStore';
import {
  copyEventLog,
  downloadEventLog,
  eventCount,
  getPreviousSession,
} from '@/utils/eventLog';
import type { PositionFix, TailPoint } from '@shared/types';

interface DebugPanelProps {
  position: PositionFix | null;
  rawPosition: PositionFix | null;
  heading: number | null;
  tail: TailPoint[];
  lastRejection: string | null;
  onClose: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="debug__row">
      <span>{label}</span>
      <span className="debug__value">{value}</span>
    </div>
  );
}

export function DebugPanel({
  position,
  rawPosition,
  heading,
  tail,
  lastRejection,
  onClose,
}: DebugPanelProps) {
  const stats = getSmootherStats();
  const [copied, setCopied] = useState(false);
  const previous = getPreviousSession();
  const drift = position && rawPosition ? haversineMeters(position, rawPosition) : null;
  const rate = stats.meanIntervalSeconds > 0 ? 1 / stats.meanIntervalSeconds : 0;

  const totalRejected = stats.rejected.accuracy + stats.rejected.speed + stats.rejected.stale;

  return (
    <div className="debug">
      <div className="debug__head">
        <strong>Diagnostics</strong>
        <button className="debug__close" onClick={onClose} aria-label="Close diagnostics">
          ×
        </button>
      </div>

      <Row label="Fix rate" value={rate ? `${rate.toFixed(2)} Hz` : '—'} />
      <Row label="Accepted fixes" value={String(stats.accepted)} />
      <Row
        label="Rejected"
        value={`${totalRejected} (acc ${stats.rejected.accuracy} / spd ${stats.rejected.speed} / stale ${stats.rejected.stale})`}
      />
      <Row label="Last rejection" value={lastRejection ?? 'none'} />
      <Row label="Raw accuracy" value={rawPosition ? `${rawPosition.accuracy.toFixed(1)} m` : '—'} />
      <Row label="Smoothing shift" value={drift !== null ? `${drift.toFixed(1)} m` : '—'} />
      <Row label="Mean shift" value={`${stats.meanCorrectionMeters.toFixed(1)} m`} />
      <Row
        label="Device speed"
        value={position?.speed != null ? `${(position.speed * 3.6).toFixed(1)} km/h` : '—'}
      />
      <Row label="Inferred heading" value={heading !== null ? `${heading.toFixed(0)}°` : '—'} />
      <Row label="Tail points" value={String(tail.length)} />
      <Row
        label="Collision mode"
        value={
          GAME_CONFIG.collision.requireCrossing
            ? `crossing ≥${GAME_CONFIG.collision.minCrossingAngleDegrees}°`
            : 'proximity only'
        }
      />
      <Row
        label="Thresholds"
        value={`hit ${GAME_CONFIG.collision.selfProximityMeters} m / grace ${GAME_CONFIG.collision.graceMeters} m`}
      />
      <Row
        label="Position"
        value={position ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` : '—'}
      />
      <Row label="Logged events" value={String(eventCount())} />

      {/*
        Export lives here rather than only on the elimination screen: a ride
        that ends by quitting, crashing or running the battery flat is exactly
        the ride whose log matters. Copy is the iOS escape hatch, where a blob
        download can silently do nothing.
      */}
      <div className="debug__actions">
        <button className="btn btn--ghost" onClick={() => downloadEventLog('current')}>
          Download log
        </button>
        <button
          className="btn btn--ghost"
          onClick={async () => {
            setCopied(await copyEventLog('current'));
            window.setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? 'Copied ✓' : 'Copy log'}
        </button>
      </div>

      {previous && (
        <button className="btn btn--ghost" onClick={() => downloadEventLog('previous')}>
          Download previous session ({previous.length} events)
        </button>
      )}
    </div>
  );
}
