/**
 * Wires the store, the browser APIs and the UI together.
 *
 * The map stays mounted across every state — it is expensive to create and
 * blanking it between rides looks broken. Start and elimination render as
 * overlays on top of it instead.
 */

import { useCallback, useState } from 'react';

import { MapView } from '@/components/MapView';
import { Hud } from '@/components/Hud';
import { StartScreen } from '@/components/StartScreen';
import { SetupScreen } from '@/components/SetupScreen';
import { EliminatedScreen } from '@/components/EliminatedScreen';
import { DebugPanel } from '@/components/DebugPanel';

import { useGeolocation } from '@/hooks/useGeolocation';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useGameTick } from '@/hooks/useGameTick';
import { useGameActions, useGameStore } from '@/store/gameStore';

export function Game() {
  const status = useGameStore((s) => s.status);
  const color = useGameStore((s) => s.color);
  const position = useGameStore((s) => s.position);
  const rawPosition = useGameStore((s) => s.rawPosition);
  const heading = useGameStore((s) => s.heading);
  const tail = useGameStore((s) => s.tail);
  const powerUps = useGameStore((s) => s.powerUps);
  const powerUpsPlacing = useGameStore((s) => s.powerUpsPlacing);
  const powerUpError = useGameStore((s) => s.powerUpError);
  const score = useGameStore((s) => s.score);
  const startedAt = useGameStore((s) => s.startedAt);
  const endedAt = useGameStore((s) => s.endedAt);
  const eliminationReason = useGameStore((s) => s.eliminationReason);
  const collisionHit = useGameStore((s) => s.collisionHit);
  const geoError = useGameStore((s) => s.geoError);
  const lastRejection = useGameStore((s) => s.lastRejection);
  const rideLog = useGameStore((s) => s.rideLog);
  const settings = useGameStore((s) => s.settings);
  const outsideZoneSince = useGameStore((s) => s.outsideZoneSince);

  const actions = useGameActions();

  const [follow, setFollow] = useState(true);
  const [showDebug, setShowDebug] = useState(false);

  const configuring = status === 'configuring';
  const tracking = status === 'locating' || configuring || status === 'active';

  // The zone is drawn whenever one is set, but only draggable during setup.
  const activeGeofence = settings.geofenceEnabled ? settings.geofence : null;

  // Stable identities so the geolocation watch is never torn down and restarted
  // by a re-render — reacquiring a fix costs seconds.
  const onFix = useCallback(actions.onFix, [actions]);
  const onError = useCallback(actions.onGeoError, [actions]);

  useGeolocation(tracking, { onFix, onError });
  const wakeLock = useWakeLock(tracking);
  useGameTick(status === 'active', actions.tick);

  const collected = powerUps.filter((p) => p.collected).length;

  return (
    <div className="app">
      <MapView
        position={position}
        tail={tail}
        powerUps={powerUps}
        color={color}
        // During setup the rider is dragging corners; a camera that keeps
        // recentring on them would fight every drag.
        follow={follow && !configuring}
        geofence={activeGeofence}
        geofenceEditable={configuring && settings.geofenceEnabled}
        onGeofenceChange={actions.setGeofence}
      />

      {status === 'active' && (
        <Hud
          score={score}
          startedAt={startedAt}
          tail={tail}
          powerUps={powerUps}
          position={position}
          powerUpsPlacing={powerUpsPlacing}
          powerUpError={powerUpError}
          geofence={activeGeofence}
          outsideZoneSince={outsideZoneSince}
          wakeLockActive={wakeLock.active}
          wakeLockSupported={wakeLock.supported}
          follow={follow}
          onToggleFollow={() => setFollow((v) => !v)}
          onToggleDebug={() => setShowDebug((v) => !v)}
          onQuit={actions.quit}
        />
      )}

      {showDebug && status !== 'idle' && (
        <DebugPanel
          position={position}
          rawPosition={rawPosition}
          heading={heading}
          tail={tail}
          lastRejection={lastRejection}
          onClose={() => setShowDebug(false)}
        />
      )}

      {(status === 'idle' || status === 'locating') && (
        <StartScreen
          color={color}
          onColorChange={actions.setColor}
          onStart={actions.beginLocating}
          locating={status === 'locating'}
          wakeLockSupported={wakeLock.supported}
          geoError={geoError}
        />
      )}

      {configuring && (
        <SetupScreen
          settings={settings}
          position={position}
          onPowerUpCount={actions.setPowerUpCount}
          onGeofenceEnabled={actions.setGeofenceEnabled}
          onResetZone={actions.resetGeofence}
          onStart={actions.startRide}
        />
      )}

      {status === 'eliminated' && (
        <EliminatedScreen
          reason={eliminationReason}
          hit={collisionHit}
          score={score}
          startedAt={startedAt}
          endedAt={endedAt}
          tail={tail}
          collectedCount={collected}
          totalCount={powerUps.length}
          rideLog={rideLog}
          onRestart={actions.reset}
        />
      )}
    </div>
  );
}
