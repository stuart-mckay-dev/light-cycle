import { PALETTE } from '@/utils/palette';
import { GAME_CONFIG } from '@/config/gameConfig';
import { hasMapboxToken, mapboxTokenProblem } from '@/services/mapbox';
import type { PlayerColor } from '@shared/types';

interface StartScreenProps {
  color: PlayerColor;
  onColorChange: (color: PlayerColor) => void;
  onStart: () => void;
  locating: boolean;
  wakeLockSupported: boolean;
  geoError: string | null;
}

export function StartScreen({
  color,
  onColorChange,
  onStart,
  locating,
  wakeLockSupported,
  geoError,
}: StartScreenProps) {
  const tokenProblem = mapboxTokenProblem();

  return (
    <div className="screen">
      <div className="screen__inner">
        <header className="brand">
          <h1 className="brand__title">
            LIGHT <span className="brand__accent">CYCLE</span>
          </h1>
          <p className="brand__tag">Goalpost 1 — solo ride</p>
        </header>

        <ol className="rules">
          <li>Ride. Your light trail follows you.</li>
          <li>
            Collect the yellow nodes. They're placed on real streets, paths and alleys — never
            anywhere you can't ride.
          </li>
          <li>
            Stay inside the play zone. You'll set its corners on the map once we have your
            position.
          </li>
          <li>
            Cross your own trail and you're out. Riding <em>alongside</em> it is fine — only
            crossings count.
          </li>
          <li>
            Your trail is {GAME_CONFIG.tail.startingLengthMeters} m long. Every node you collect
            adds {GAME_CONFIG.powerUps.lengthPerPickupMeters} m.
          </li>
        </ol>

        <div className="field">
          <span className="field__label">Trail colour</span>
          <div className="swatches" role="radiogroup" aria-label="Trail colour">
            {PALETTE.map((entry) => (
              <button
                key={entry.hex}
                type="button"
                role="radio"
                aria-checked={color === entry.hex}
                aria-label={entry.name}
                title={entry.note}
                className={`swatch${color === entry.hex ? ' swatch--on' : ''}`}
                style={{ '--swatch': entry.hex } as React.CSSProperties}
                onClick={() => onColorChange(entry.hex)}
              />
            ))}
          </div>
        </div>

        <button className="btn btn--primary" onClick={onStart} disabled={locating}>
          {locating ? 'Getting a GPS fix…' : 'Start ride'}
        </button>

        {locating && (
          <p className="note">
            Waiting for a fix better than {GAME_CONFIG.gps.maxAccuracyMeters} m. Outdoors with a
            clear view of the sky is fastest.
          </p>
        )}

        {geoError && <p className="note note--warn">{geoError}</p>}

        {!hasMapboxToken && <p className="note note--warn">{tokenProblem}</p>}

        {!wakeLockSupported && (
          <p className="note note--warn">
            This browser has no Screen Wake Lock. Set your screen timeout to never before you ride —
            if the screen sleeps, GPS stops and the ride ends.
          </p>
        )}

        <p className="note">
          Keep the app in the foreground with the screen on for the whole ride. Ride safely — glance,
          don't stare.
        </p>
      </div>
    </div>
  );
}
