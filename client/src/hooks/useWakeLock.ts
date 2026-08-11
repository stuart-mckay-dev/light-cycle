/**
 * Screen Wake Lock.
 *
 * A phone that sleeps mid-ride stops reporting geolocation, which ends the game
 * silently — this is the single most important non-game API in Goalpost 1.
 *
 * Two behaviours matter and are easy to miss:
 *   - The lock is released automatically whenever the page is hidden (screen
 *     lock, tab switch, app switch), so it must be re-acquired on visibility
 *     change rather than requested once at startup.
 *   - iOS only shipped this in Safari 16.4, and it does nothing at all if the
 *     app is backgrounded. `supported` is surfaced to the UI so the rider is
 *     told to keep the screen on manually rather than silently losing their game.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { logEvent } from '@/utils/eventLog';

export interface WakeLockState {
  supported: boolean;
  active: boolean;
  error: string | null;
}

export function useWakeLock(enabled: boolean): WakeLockState {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  const acquire = useCallback(async () => {
    if (!supported) {
      logEvent({ type: 'wakelock', state: 'unsupported' });
      return;
    }
    if (document.visibilityState !== 'visible') return;

    try {
      const sentinel = await navigator.wakeLock.request('screen');
      sentinelRef.current = sentinel;
      setActive(true);
      setError(null);
      logEvent({ type: 'wakelock', state: 'acquired' });

      // Every release is logged, because a lock dropping mid-ride is the most
      // likely cause of a ride ending for no visible reason.
      sentinel.addEventListener('release', () => {
        setActive(false);
        sentinelRef.current = null;
        logEvent({ type: 'wakelock', state: 'released' });
      });
    } catch (err) {
      // Typically NotAllowedError — low battery mode, or no user gesture yet.
      const message = err instanceof Error ? err.message : 'Wake lock request failed';
      setActive(false);
      setError(message);
      logEvent({ type: 'wakelock', state: 'failed', message });
    }
  }, [supported]);

  useEffect(() => {
    if (!enabled) {
      sentinelRef.current?.release().catch(() => undefined);
      sentinelRef.current = null;
      setActive(false);
      return;
    }

    void acquire();

    // Re-acquire when the rider returns to the app — the OS drops the lock on
    // every hide, and without this the second half of a ride runs unprotected.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !sentinelRef.current) void acquire();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      sentinelRef.current?.release().catch(() => undefined);
      sentinelRef.current = null;
    };
  }, [enabled, acquire]);

  return { supported, active, error };
}
