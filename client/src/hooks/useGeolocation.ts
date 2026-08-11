/**
 * Geolocation watch.
 *
 * Wraps `watchPosition` and hands raw fixes straight to the store — no
 * filtering happens here, so that the smoothing logic stays testable against a
 * recorded log rather than against a live browser API.
 *
 * The tiered accuracy model from docs/prd.md §8.1 lands at Goalpost 3; this always
 * runs in high-accuracy mode, which is also the honest way to measure the
 * battery cost that tiering is meant to solve.
 */

import { useEffect, useRef } from 'react';
import { GAME_CONFIG } from '@/config/gameConfig';
import type { PositionFix } from '@shared/types';

export interface GeolocationHandlers {
  onFix: (fix: PositionFix) => void;
  onError: (message: string) => void;
}

function describeError(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Location permission denied. Enable it in your browser settings and reload.';
    case err.POSITION_UNAVAILABLE:
      return 'No GPS signal. Move somewhere with a clearer view of the sky.';
    case err.TIMEOUT:
      return 'Timed out waiting for a GPS fix. Still trying…';
    default:
      return err.message || 'Unknown geolocation error.';
  }
}

export function useGeolocation(enabled: boolean, handlers: GeolocationHandlers): void {
  // Held in a ref so a re-render with new callbacks doesn't tear down the watch
  // and restart the receiver — that costs several seconds of reacquisition.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;

    if (!('geolocation' in navigator)) {
      handlersRef.current.onError('This browser has no Geolocation API.');
      return;
    }

    if (!window.isSecureContext) {
      handlersRef.current.onError(
        'Geolocation needs HTTPS. Use localhost, or the Cloudflare Tunnel URL on a phone.',
      );
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { coords, timestamp } = position;
        handlersRef.current.onFix({
          lng: coords.longitude,
          lat: coords.latitude,
          accuracy: coords.accuracy,
          speed: coords.speed,
          heading: coords.heading,
          timestamp,
        });
      },
      (err) => handlersRef.current.onError(describeError(err)),
      GAME_CONFIG.gps.watchOptions,
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled]);
}
