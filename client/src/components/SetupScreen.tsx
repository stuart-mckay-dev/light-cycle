/**
 * Pre-ride setup, shown once a position is known.
 *
 * Deliberately a bottom sheet rather than a full screen: the whole point is
 * dragging zone corners on the map, so the map has to stay visible and
 * touchable above it.
 */

import { useRef, useState } from 'react';
import { GAME_CONFIG } from '@/config/gameConfig';
import { validateGeofence } from '@/game/geofence';
import { polygonAreaSqMeters, shortestSideMeters } from '@/utils/geo';
import type { GameSettings, PositionFix } from '@shared/types';

/** Drag distance, in px, that commits to collapsing or expanding. */
const SWIPE_THRESHOLD = 44;

/** Movement above this is a drag, not a tap — used to suppress the click. */
const TAP_SLOP = 8;

/** How far the sheet is allowed to follow the finger past the commit point. */
const RUBBER_BAND = 140;

interface SetupScreenProps {
  settings: GameSettings;
  position: PositionFix | null;
  onPowerUpCount: (count: number) => void;
  onGeofenceEnabled: (enabled: boolean) => void;
  onResetZone: () => void;
  onStart: () => void;
}

export function SetupScreen({
  settings,
  position,
  onPowerUpCount,
  onGeofenceEnabled,
  onResetZone,
  onStart,
}: SetupScreenProps) {
  const { minCount, maxCount } = GAME_CONFIG.powerUps;
  const { powerUpCount, geofenceEnabled, geofence } = settings;

  const problem = geofenceEnabled && geofence ? validateGeofence(geofence) : null;
  const areaKm2 = geofence ? polygonAreaSqMeters(geofence) / 1_000_000 : 0;
  const shortest = geofence ? shortestSideMeters(geofence) : 0;

  // Collapsing gets the panel out of the way so corners near the bottom of the
  // zone can be dragged.
  const [collapsed, setCollapsed] = useState(false);

  /**
   * Swipe-to-collapse.
   *
   * The grip and the title row are one drag surface, because that whole strip
   * is what a thumb reaches for. `touch-action: none` on it is the load-bearing
   * part: without it iOS claims the downward drag as a page scroll and fires
   * pull-to-refresh, reloading the app mid-setup instead of closing the sheet.
   *
   * Pointer events rather than touch events so a mouse drag works the same on
   * a laptop, and pointer capture so the gesture survives the finger sliding
   * off the strip.
   */
  const dragStartRef = useRef<number | null>(null);
  const movedRef = useRef(0);
  const [dragY, setDragY] = useState(0);

  const beginDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStartRef.current = e.clientY;
    movedRef.current = 0;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is an enhancement — it keeps the gesture alive when the finger
      // slides off the strip. If the browser refuses, the drag still works.
    }
  };

  const continueDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (start === null) return;

    const dy = e.clientY - start;
    movedRef.current = Math.max(movedRef.current, Math.abs(dy));

    // Only follow the finger in the direction that would actually do
    // something; pulling the other way should feel like a wall, not a bug.
    setDragY(
      collapsed
        ? Math.min(0, Math.max(dy, -RUBBER_BAND))
        : Math.max(0, Math.min(dy, RUBBER_BAND)),
    );
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    setDragY(0);
    if (start === null) return;

    const dy = e.clientY - start;
    if (!collapsed && dy > SWIPE_THRESHOLD) setCollapsed(true);
    else if (collapsed && dy < -SWIPE_THRESHOLD) setCollapsed(false);
  };

  // A drag ends with a click too; ignore it unless the finger barely moved, or
  // swiping would immediately toggle back.
  const handleGripClick = () => {
    if (movedRef.current > TAP_SLOP) return;
    setCollapsed((v) => !v);
  };

  return (
    <div
      className={`sheet${collapsed ? ' sheet--collapsed' : ''}${dragY ? ' sheet--dragging' : ''}`}
      style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
    >
      <div
        className="sheet__handle"
        onPointerDown={beginDrag}
        onPointerMove={continueDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <button
          type="button"
          className="sheet__grip"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Show settings' : 'Hide settings to reach the map'}
          onClick={handleGripClick}
        />

        <header className="sheet__head">
          <h2 className="sheet__title">Set up the ride</h2>
          {position && (
            <span className="sheet__sub">GPS ±{Math.round(position.accuracy)} m</span>
          )}
        </header>
      </div>

      <div className="setting">
        <div className="setting__row">
          <label className="setting__label" htmlFor="pu-count">
            Power-up nodes
          </label>
          <div className="stepper">
            <button
              type="button"
              className="stepper__btn"
              onClick={() => onPowerUpCount(powerUpCount - 1)}
              disabled={powerUpCount <= minCount}
              aria-label="Fewer nodes"
            >
              −
            </button>
            <span className="stepper__value">{powerUpCount}</span>
            <button
              type="button"
              className="stepper__btn"
              onClick={() => onPowerUpCount(powerUpCount + 1)}
              disabled={powerUpCount >= maxCount}
              aria-label="More nodes"
            >
              +
            </button>
          </div>
        </div>
        <input
          id="pu-count"
          className="slider"
          type="range"
          min={minCount}
          max={maxCount}
          value={powerUpCount}
          onChange={(e) => onPowerUpCount(Number(e.target.value))}
        />
        <p className="setting__hint">
          {powerUpCount === 0
            ? 'No nodes — just you and your trail.'
            : 'Placed on real streets, paths and alleys inside the zone.'}
        </p>
      </div>

      <div className="setting">
        <div className="setting__row">
          <label className="setting__label" htmlFor="fence">
            Play zone
          </label>
          <button
            id="fence"
            type="button"
            role="switch"
            aria-checked={geofenceEnabled}
            className={`toggle${geofenceEnabled ? ' toggle--on' : ''}`}
            onClick={() => onGeofenceEnabled(!geofenceEnabled)}
          >
            <span className="toggle__knob" />
          </button>
        </div>

        {geofenceEnabled ? (
          <>
            <p className="setting__hint">
              Drag the four corners on the map. Leave the zone and you have{' '}
              {GAME_CONFIG.geofence.graceSeconds} s to get back in.
            </p>
            <div className="zone-stats">
              <span>{areaKm2 < 1 ? `${Math.round(areaKm2 * 100)} ha` : `${areaKm2.toFixed(2)} km²`}</span>
              <span>shortest side {Math.round(shortest)} m</span>
              <button type="button" className="linkbtn" onClick={onResetZone}>
                Reset zone
              </button>
            </div>
          </>
        ) : (
          <p className="setting__hint setting__hint--warn">
            Without a boundary you can ride away from your own trail in a straight line and
            wait out the {Math.round(GAME_CONFIG.tailTTLSeconds / 60)}-minute expiry. Nothing
            can catch you.
          </p>
        )}
      </div>

      {problem && <p className="note note--warn">{problem.message}</p>}

      <button className="btn btn--primary" onClick={onStart} disabled={problem !== null}>
        Start ride
      </button>
    </div>
  );
}
