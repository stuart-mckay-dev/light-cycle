import { useEffect, useState } from 'react';
import { GAME_CONFIG } from '@/config/gameConfig';
import { tailLengthMeters } from '@/game/tail';
import { distanceToNearest } from '@/game/powerups';
import { graceRemainingSeconds, zoneStatus } from '@/game/geofence';
import type { Geofence, PositionFix, PowerUp, TailPoint } from '@shared/types';

interface HudProps {
  score: number;
  startedAt: number | null;
  tail: TailPoint[];
  powerUps: PowerUp[];
  position: PositionFix | null;
  powerUpsPlacing: boolean;
  powerUpError: string | null;
  geofence: Geofence | null;
  outsideZoneSince: number | null;
  wakeLockActive: boolean;
  wakeLockSupported: boolean;
  follow: boolean;
  onToggleFollow: () => void;
  onToggleDebug: () => void;
  onQuit: () => void;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

/** Reported accuracy, bucketed into something legible at a glance while riding. */
function accuracyBand(accuracy: number | undefined): { label: string; tone: string } {
  if (accuracy === undefined) return { label: 'no fix', tone: 'bad' };
  if (accuracy <= 8) return { label: `${Math.round(accuracy)} m`, tone: 'good' };
  if (accuracy <= GAME_CONFIG.gps.maxAccuracyMeters) {
    return { label: `${Math.round(accuracy)} m`, tone: 'ok' };
  }
  return { label: `${Math.round(accuracy)} m`, tone: 'bad' };
}

export function Hud({
  score,
  startedAt,
  tail,
  powerUps,
  position,
  powerUpsPlacing,
  powerUpError,
  geofence,
  outsideZoneSince,
  wakeLockActive,
  wakeLockSupported,
  follow,
  onToggleFollow,
  onToggleDebug,
  onQuit,
}: HudProps) {
  // Local clock so the timer ticks even when no new GPS fix has landed.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remaining = powerUps.filter((p) => !p.collected).length;
  const nearest = position ? distanceToNearest(powerUps, position) : null;
  const accuracy = accuracyBand(position?.accuracy);

  const zone = position ? zoneStatus(position, geofence) : null;
  // Counted against the latest fix, not the wall clock — the countdown only
  // advances on evidence that the rider is still outside.
  const graceLeft =
    outsideZoneSince !== null && position
      ? graceRemainingSeconds(outsideZoneSince, position.timestamp)
      : null;

  return (
    <>
      {zone && !zone.inside && (
        <div className="alarm" role="alert">
          <span className="alarm__title">Outside the play zone</span>
          <span className="alarm__count">
            {graceLeft !== null ? `${Math.ceil(graceLeft)}s` : ''}
          </span>
          <span className="alarm__sub">
            {Math.round(zone.distanceToEdgeMeters)} m out — turn back
          </span>
        </div>
      )}

      <div className="hud hud--top">
        <div className="stat">
          <span className="stat__value">{score}</span>
          <span className="stat__label">score</span>
        </div>
        <div className="stat">
          <span className="stat__value">{powerUpsPlacing ? '…' : remaining}</span>
          <span className="stat__label">nodes left</span>
        </div>
        <div className="stat">
          <span className="stat__value">{formatDuration(now - (startedAt ?? now))}</span>
          <span className="stat__label">elapsed</span>
        </div>
        <div className="stat">
          <span className="stat__value">{formatDistance(tailLengthMeters(tail))}</span>
          <span className="stat__label">trail</span>
        </div>
      </div>

      <div className="hud hud--pills">
        <span className={`pill pill--${accuracy.tone}`}>GPS {accuracy.label}</span>
        {powerUpsPlacing && <span className="pill">placing nodes on streets…</span>}
        {powerUpError && <span className="pill pill--bad">{powerUpError}</span>}
        {zone?.approaching && (
          <span className="pill pill--ok">
            zone edge {Math.round(zone.distanceToEdgeMeters)} m
          </span>
        )}
        {nearest !== null && <span className="pill">nearest node {formatDistance(nearest)}</span>}
        {wakeLockSupported ? (
          !wakeLockActive && <span className="pill pill--bad">screen lock not held</span>
        ) : (
          <span className="pill pill--bad">no wake lock</span>
        )}
      </div>

      <div className="hud hud--bottom">
        <button className="btn btn--ghost" onClick={onToggleFollow}>
          {follow ? 'Following' : 'Free look'}
        </button>
        <button className="btn btn--ghost" onClick={onToggleDebug}>
          Debug
        </button>
        <button className="btn btn--danger" onClick={onQuit}>
          End ride
        </button>
      </div>
    </>
  );
}
