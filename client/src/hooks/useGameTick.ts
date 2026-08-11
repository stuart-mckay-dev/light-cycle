/**
 * Drives the 1 Hz game tick.
 *
 * GPS fixes are the main clock, but tail expiry has to keep running when the
 * rider is stopped and fixes are being deadbanded away — otherwise a tail that
 * should have expired at a red light stays lethal until they move again.
 */

import { useEffect } from 'react';
import { GAME_CONFIG } from '@/config/gameConfig';

export function useGameTick(enabled: boolean, tick: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(tick, GAME_CONFIG.tickIntervalMs);
    return () => window.clearInterval(id);
  }, [enabled, tick]);
}
