/**
 * The single-player game state machine.
 *
 * States: idle → locating → configuring → active → eliminated → (restart) idle
 *
 * `configuring` exists because the settings that matter most — how many nodes,
 * and where the play zone sits — can only be chosen once the rider's position
 * is known. The map is live during this state and positions keep arriving, but
 * nothing is recorded and the clock has not started.
 *
 * All game logic funnels through one entry point, `onFix`, driven by the
 * Geolocation API. The tail is limited by length rather than time, so nothing
 * changes while the rider stands still and no clock-driven sweep is needed.
 * Keeping it to one makes the whole loop reproducible from a recorded ride log,
 * which is what makes threshold tuning possible without going outside for
 * every change.
 *
 * At Goalpost 2 the server owns tail state and collisions; `onFix` becomes an
 * emit and the results arrive over Socket.io. The state shape is chosen so that
 * swap touches this file and nothing downstream of it.
 */

import { create } from 'zustand';
import { GAME_CONFIG } from '@/config/gameConfig';
import { appendTailPoint, tailLengthMeters, trimTailToLength } from '@/game/tail';
import { detectSelfCollision, inferHeading } from '@/game/collision';
import { collectNearby, generatePowerUps } from '@/game/powerups';
import { defaultGeofence, zoneStatus } from '@/game/geofence';
import { hasMapboxToken } from '@/services/mapbox';
import { GpsSmoother, type RejectionReason } from '@/utils/smoothing';
import { logEvent, logFix, startEventLog } from '@/utils/eventLog';
import { DEFAULT_COLOR } from '@/utils/palette';
import type { CollisionHit } from '@/game/collision';
import type {
  EliminationReason,
  GameSettings,
  Geofence,
  PlayerColor,
  PositionFix,
  PowerUp,
  TailPoint,
} from '@shared/types';

export type GameStatus = 'idle' | 'locating' | 'configuring' | 'active' | 'eliminated';

/** One entry of the ride log, for post-ride threshold analysis. */
export interface RideLogEntry {
  t: number;
  raw: { lng: number; lat: number; accuracy: number };
  smoothed: { lng: number; lat: number } | null;
  rejected: RejectionReason | null;
}

const MAX_LOG_ENTRIES = 20_000;

/** Lives outside the store: it's a stateful filter, not rendered state. */
let smoother = new GpsSmoother();

/** Cancels in-flight power-up placement when a ride ends or restarts. */
let placementController: AbortController | null = null;

/** Timestamp of the last raw fix, so the log can record inter-fix intervals. */
let previousFixAt: number | null = null;

/** Records a state transition in both the store and the event log. */
function transition(from: GameStatus, to: GameStatus): void {
  logEvent({ type: 'status', from, to });
}

interface GameState {
  status: GameStatus;
  color: PlayerColor;

  startedAt: number | null;
  endedAt: number | null;

  /** Filtered position — what the game acts on. */
  position: PositionFix | null;
  /** Unfiltered fix — shown in the debug panel to expose how much filtering is happening. */
  rawPosition: PositionFix | null;
  heading: number | null;

  tail: TailPoint[];
  /** Longest the tail may be, in metres. Starts at the configured length; each pickup extends it. */
  tailMaxLengthMeters: number;
  powerUps: PowerUp[];
  /** Placement snaps nodes to the street graph over the network — it takes a moment. */
  powerUpsPlacing: boolean;
  powerUpError: string | null;
  score: number;

  eliminationReason: EliminationReason | null;
  collisionHit: CollisionHit | null;

  /** Chosen on the setup screen, frozen once the ride starts. */
  settings: GameSettings;
  /** When the rider left the zone, as a fix timestamp. Null while inside. */
  outsideZoneSince: number | null;

  geoError: string | null;
  lastRejection: RejectionReason | null;
  rideLog: RideLogEntry[];

  actions: {
    beginLocating: () => void;
    placePowerUps: (origin: { lng: number; lat: number }, sessionStart: number) => Promise<void>;
    onFix: (raw: PositionFix) => void;
    onGeoError: (message: string) => void;
    quit: () => void;
    reset: () => void;
    setColor: (color: PlayerColor) => void;
    setPowerUpCount: (count: number) => void;
    setGeofenceEnabled: (enabled: boolean) => void;
    setGeofence: (ring: Geofence) => void;
    resetGeofence: () => void;
    startRide: () => void;
  };
}

const initialState = {
  status: 'idle' as GameStatus,
  color: DEFAULT_COLOR,
  startedAt: null,
  endedAt: null,
  position: null,
  rawPosition: null,
  heading: null,
  tail: [] as TailPoint[],
  tailMaxLengthMeters: GAME_CONFIG.tail.startingLengthMeters as number,
  powerUps: [] as PowerUp[],
  powerUpsPlacing: false,
  powerUpError: null as string | null,
  score: 0,
  eliminationReason: null as EliminationReason | null,
  collisionHit: null as CollisionHit | null,
  settings: {
    powerUpCount: GAME_CONFIG.powerUps.defaultCount,
    geofenceEnabled: true,
    geofence: null,
  } as GameSettings,
  outsideZoneSince: null as number | null,
  geoError: null as string | null,
  lastRejection: null as RejectionReason | null,
  rideLog: [] as RideLogEntry[],
};

export const useGameStore = create<GameState>((set, get) => ({
  ...initialState,

  actions: {
    beginLocating: () => {
      smoother = new GpsSmoother();
      placementController?.abort();
      placementController = null;
      previousFixAt = null;
      startEventLog();
      transition(get().status, 'locating');
      // Settings survive a restart: re-riding the same course with one
      // threshold changed is the whole point of a field-test session.
      set({
        ...initialState,
        color: get().color,
        settings: get().settings,
        status: 'locating',
      });
    },

    /**
     * Places power-ups on the street graph.
     *
     * Runs detached from the first fix so the ride starts immediately — nodes
     * appear a moment later. `sessionStart` guards the result: if the rider has
     * restarted in the meantime, a late response is discarded rather than
     * dropping the previous ride's nodes into the new one.
     */
    placePowerUps: async (origin, sessionStart) => {
      placementController?.abort();
      const controller = new AbortController();
      placementController = controller;

      set({ powerUpsPlacing: true, powerUpError: null });

      if (!hasMapboxToken) {
        set({ powerUpsPlacing: false, powerUpError: 'Nodes need a Mapbox token to be placed on real streets.' });
        return;
      }

      const { powerUpCount, geofenceEnabled, geofence } = get().settings;
      const placementStartedAt = Date.now();

      if (powerUpCount === 0) {
        set({ powerUps: [], powerUpsPlacing: false, powerUpError: null });
        return;
      }

      try {
        const powerUps = await generatePowerUps(
          origin,
          Math.floor(sessionStart / 1000),
          { count: powerUpCount, geofence: geofenceEnabled ? geofence : null },
          controller.signal,
        );

        if (controller.signal.aborted || get().startedAt !== sessionStart) return;

        logEvent({
          type: 'powerups_placed',
          requested: powerUpCount,
          placed: powerUps.length,
          roadClasses: powerUps.map((p) => p.roadClass ?? 'unknown'),
          elapsedMs: Date.now() - placementStartedAt,
          error: powerUps.length < powerUpCount ? 'some candidates dropped' : null,
        });

        set({
          powerUps,
          powerUpsPlacing: false,
          powerUpError:
            powerUps.length === 0
              ? 'No rideable streets found for any node.'
              : powerUps.length < powerUpCount
                ? `Placed ${powerUps.length} of ${powerUpCount} nodes — the rest had no rideable street nearby.`
                : null,
        });
      } catch {
        if (controller.signal.aborted || get().startedAt !== sessionStart) return;
        set({
          powerUpsPlacing: false,
          powerUpError: 'Could not place nodes — no network.',
        });
      }
    },

    onFix: (raw) => {
      const state = get();
      if (
        state.status !== 'locating' &&
        state.status !== 'configuring' &&
        state.status !== 'active'
      ) {
        return;
      }

      const { fix, rejected } = smoother.push(raw);

      logFix(raw, fix, rejected, previousFixAt);
      previousFixAt = raw.timestamp;

      const logEntry: RideLogEntry = {
        t: raw.timestamp,
        raw: { lng: raw.lng, lat: raw.lat, accuracy: raw.accuracy },
        smoothed: fix ? { lng: fix.lng, lat: fix.lat } : null,
        rejected,
      };
      const rideLog =
        state.rideLog.length >= MAX_LOG_ENTRIES
          ? [...state.rideLog.slice(1), logEntry]
          : [...state.rideLog, logEntry];

      if (!fix) {
        set({ rawPosition: raw, lastRejection: rejected, rideLog });
        return;
      }

      // First good fix hands over to the setup screen. Nothing is recorded yet
      // and the clock has not started — the rider is still choosing a zone.
      if (state.status === 'locating') {
        // Reuse the previous zone when the rider is still standing in it, so a
        // repeat run over the same course keeps the same boundary. Otherwise
        // drop a fresh box here, because starting outside your own zone would
        // put you on the elimination countdown from the first second.
        const previous = state.settings.geofence;
        const reusable =
          previous && zoneStatus(fix, previous)?.inside ? previous : defaultGeofence(fix);

        transition('locating', 'configuring');

        set({
          status: 'configuring',
          position: fix,
          rawPosition: raw,
          settings: { ...state.settings, geofence: reusable },
          lastRejection: null,
          geoError: null,
          rideLog,
        });
        return;
      }

      // Setup screen: track the rider's position so the map and the zone stay
      // anchored to them, but record nothing.
      if (state.status === 'configuring') {
        set({ position: fix, rawPosition: raw, lastRejection: null, rideLog });
        return;
      }

      const now = fix.timestamp;
      const point: TailPoint = { lng: fix.lng, lat: fix.lat, t: now };

      const { points: grown, appended } = appendTailPoint(state.tail, point);

      // Pickups extend the trail budget before it is applied, so the metres a
      // node earns are never trimmed away on the fix that collected it.
      const { powerUps, collected } = collectNearby(state.powerUps, fix, now);
      const tailMaxLengthMeters =
        state.tailMaxLengthMeters + collected.length * GAME_CONFIG.powerUps.lengthPerPickupMeters;

      // Trim after appending so the grace window and collision checks see a tail
      // that is already within budget.
      const { points: tail, trimmed } = trimTailToLength(grown, tailMaxLengthMeters);

      if (appended) {
        logEvent({
          type: 'tail',
          points: tail.length,
          lengthMeters: Math.round(tailLengthMeters(tail)),
          maxLengthMeters: tailMaxLengthMeters,
          trimmed,
        });
      }

      const heading = inferHeading(tail);
      const score = state.score + collected.length * GAME_CONFIG.powerUps.scorePerPickup;

      for (const pickup of collected) {
        logEvent({
          type: 'powerup_collected',
          id: pickup.id,
          roadClass: pickup.roadClass,
          score,
          maxLengthMeters: tailMaxLengthMeters,
        });
      }

      // Collision is armed only after a short delay — the initial GPS scatter
      // while acquiring a lock would otherwise eliminate a stationary rider.
      const armed =
        state.startedAt !== null &&
        now - state.startedAt > GAME_CONFIG.collision.armingDelaySeconds * 1000;

      const hit = armed ? detectSelfCollision(fix, heading, tail) : null;

      // Play zone. Leaving is not instantly fatal — GPS near a boundary is
      // noisy, and a rider who overshoots a turn deserves a chance to come
      // back. The countdown is measured in fix timestamps, so a rider whose
      // signal drops entirely is not eliminated by a clock they cannot see.
      const { geofenceEnabled, geofence } = state.settings;
      let outsideZoneSince = state.outsideZoneSince;
      let leftZone = false;

      if (geofenceEnabled && geofence) {
        const zone = zoneStatus(fix, geofence);
        if (zone && !zone.inside) {
          const justLeft = outsideZoneSince === null;
          outsideZoneSince ??= now;
          leftZone = now - outsideZoneSince >= GAME_CONFIG.geofence.graceSeconds * 1000;

          if (justLeft) {
            logEvent({
              type: 'zone',
              state: 'exit',
              distanceToEdgeMeters: Math.round(zone.distanceToEdgeMeters),
              graceRemainingSeconds: GAME_CONFIG.geofence.graceSeconds,
            });
          }
        } else {
          if (outsideZoneSince !== null && zone) {
            logEvent({
              type: 'zone',
              state: 'reenter',
              distanceToEdgeMeters: Math.round(zone.distanceToEdgeMeters),
              graceRemainingSeconds: null,
            });
          }
          outsideZoneSince = null;
        }
      } else {
        outsideZoneSince = null;
      }

      if (hit || leftZone) {
        if (hit) {
          logEvent({
            type: 'collision',
            crossingAngleDegrees: Math.round(hit.crossingAngleDegrees),
            distanceMeters: Math.round(hit.distanceMeters),
            tailDistanceMeters: Math.round(hit.tailDistanceMeters),
          });
        }
        transition('active', 'eliminated');
        logEvent({
          type: 'eliminated',
          reason: hit ? 'self_tail' : 'geofence',
          elapsedSeconds: state.startedAt ? Math.round((now - state.startedAt) / 1000) : 0,
          score,
        });

        set({
          status: 'eliminated',
          endedAt: now,
          // A tail crossing is the more specific event, so it wins a tie.
          eliminationReason: hit ? 'self_tail' : 'geofence',
          collisionHit: hit,
          position: fix,
          rawPosition: raw,
          heading,
          tail,
          tailMaxLengthMeters,
          powerUps,
          score,
          outsideZoneSince,
          lastRejection: null,
          rideLog,
        });
        return;
      }

      set({
        position: fix,
        rawPosition: raw,
        heading,
        tail,
        tailMaxLengthMeters,
        powerUps,
        score,
        outsideZoneSince,
        lastRejection: null,
        rideLog,
      });
    },

    onGeoError: (message) => {
      logEvent({ type: 'geo_error', message });
      set({ geoError: message });
    },

    quit: () => {
      const state = get();
      const now = Date.now();
      transition(state.status, 'eliminated');
      logEvent({
        type: 'eliminated',
        reason: 'quit',
        elapsedSeconds: state.startedAt ? Math.round((now - state.startedAt) / 1000) : 0,
        score: state.score,
      });
      set({ status: 'eliminated', endedAt: now, eliminationReason: 'quit' });
    },

    reset: () => {
      smoother = new GpsSmoother();
      placementController?.abort();
      placementController = null;
      set({ ...initialState, color: get().color, settings: get().settings });
    },

    setColor: (color) => set({ color }),

    setPowerUpCount: (count) => {
      const { minCount, maxCount } = GAME_CONFIG.powerUps;
      set({
        settings: {
          ...get().settings,
          powerUpCount: Math.max(minCount, Math.min(maxCount, Math.round(count))),
        },
      });
    },

    setGeofenceEnabled: (enabled) => {
      const state = get();
      // Turning the zone on with no ring yet (or none usable here) drops a
      // fresh box around the rider rather than leaving nothing to drag.
      const geofence =
        state.settings.geofence ??
        (state.position ? defaultGeofence(state.position) : null);

      set({ settings: { ...state.settings, geofenceEnabled: enabled, geofence } });
    },

    setGeofence: (ring) => set({ settings: { ...get().settings, geofence: ring } }),

    resetGeofence: () => {
      const state = get();
      if (!state.position) return;
      set({ settings: { ...state.settings, geofence: defaultGeofence(state.position) } });
    },

    /**
     * Leaves the setup screen and starts recording.
     *
     * The clock, the tail and the arming delay all start here rather than at
     * the first fix, so time spent choosing a zone does not count against the
     * rider.
     */
    startRide: () => {
      const state = get();
      if (state.status !== 'configuring' || !state.position) return;

      const start = state.position.timestamp;
      transition('configuring', 'active');

      set({
        status: 'active',
        startedAt: start,
        position: state.position,
        tail: [{ lng: state.position.lng, lat: state.position.lat, t: start }],
        tailMaxLengthMeters: GAME_CONFIG.tail.startingLengthMeters,
        powerUps: [],
        powerUpsPlacing: state.settings.powerUpCount > 0,
        outsideZoneSince: null,
        rideLog: [],
      });

      // Detached: snapping nodes to the street graph is a network round trip,
      // and the rider should not be waiting on it to start moving.
      void get().actions.placePowerUps(
        { lng: state.position.lng, lat: state.position.lat },
        start,
      );
    },
  },
}));

/** Filter diagnostics. Read outside the store since the smoother isn't reactive. */
export const getSmootherStats = () => smoother.stats();

export const useGameActions = () => useGameStore((s) => s.actions);

// Dev-only handle for inspecting live game state from the browser console —
// the setup guide's DevTools-driven testing loop leans on this. Stripped from
// production builds.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__lightcycle = useGameStore;
}
