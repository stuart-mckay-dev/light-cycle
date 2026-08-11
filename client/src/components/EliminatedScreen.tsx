import { tailLengthMeters } from '@/game/tail';
import { GAME_CONFIG } from '@/config/gameConfig';
import type { CollisionHit } from '@/game/collision';
import type { EliminationReason, TailPoint } from '@shared/types';
import type { RideLogEntry } from '@/store/gameStore';

interface EliminatedScreenProps {
  reason: EliminationReason | null;
  hit: CollisionHit | null;
  score: number;
  startedAt: number | null;
  endedAt: number | null;
  tail: TailPoint[];
  collectedCount: number;
  totalCount: number;
  rideLog: RideLogEntry[];
  onRestart: () => void;
}

const HEADLINES: Record<EliminationReason, string> = {
  self_tail: 'You crossed your own trail',
  other_tail: 'You crossed a rival trail',
  geofence: 'You left the play zone',
  quit: 'Ride ended',
};

/**
 * Downloads the ride as JSON.
 *
 * This is a Goalpost 1 instrument, not a game feature: every raw fix, its
 * smoothed counterpart and any rejection, so a threshold that felt wrong on the
 * road can be re-examined at a desk instead of re-ridden.
 */
function downloadLog(rideLog: RideLogEntry[], startedAt: number | null) {
  const payload = {
    exportedAt: new Date().toISOString(),
    startedAt: startedAt ? new Date(startedAt).toISOString() : null,
    config: GAME_CONFIG,
    fixes: rideLog,
  };

  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `light-cycle-ride-${startedAt ?? Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function EliminatedScreen({
  reason,
  hit,
  score,
  startedAt,
  endedAt,
  tail,
  collectedCount,
  totalCount,
  rideLog,
  onRestart,
}: EliminatedScreenProps) {
  const duration = startedAt && endedAt ? Math.round((endedAt - startedAt) / 1000) : 0;
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  const distance = tailLengthMeters(tail);

  const rejected = rideLog.filter((e) => e.rejected).length;

  return (
    <div className="screen screen--overlay">
      <div className="screen__inner">
        <h2 className="outcome">{reason ? HEADLINES[reason] : 'Ride over'}</h2>

        {hit && (
          <p className="note">
            Crossed at {hit.crossingAngleDegrees.toFixed(0)}° from{' '}
            {Math.round(hit.distanceMeters)} m away, {Math.round(hit.tailDistanceMeters)} m back
            along your trail.
          </p>
        )}

        <dl className="results">
          <div>
            <dt>Score</dt>
            <dd>{score}</dd>
          </div>
          <div>
            <dt>Nodes</dt>
            <dd>
              {collectedCount} / {totalCount}
            </dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>
              {minutes}:{seconds.toString().padStart(2, '0')}
            </dd>
          </div>
          <div>
            <dt>Trail at end</dt>
            <dd>{distance >= 1000 ? `${(distance / 1000).toFixed(2)} km` : `${Math.round(distance)} m`}</dd>
          </div>
        </dl>

        <button className="btn btn--primary" onClick={onRestart}>
          Ride again
        </button>

        {rideLog.length > 0 && (
          <>
            <button className="btn btn--ghost" onClick={() => downloadLog(rideLog, startedAt)}>
              Download ride log ({rideLog.length} fixes)
            </button>
            <p className="note">
              {rejected} of {rideLog.length} fixes were rejected by the filter. Use the log to tune
              the thresholds in <code>gameConfig.ts</code>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
