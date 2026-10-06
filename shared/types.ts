/**
 * Types shared between client and server.
 *
 * Goalpost 1 is client-only, so only the geometry/player/game-state types below
 * are in use today. The lobby and socket contracts are declared up front because
 * they are already specified in docs/prd.md §12 and docs/schema.md — having them here
 * means Goalpost 2 wires up against a fixed contract rather than inventing one.
 */

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** [longitude, latitude] — GeoJSON order. Used everywhere that touches Mapbox. */
export type LngLat = [number, number];

export interface GeoJSONPoint {
  type: 'Point';
  coordinates: LngLat;
}

export interface GeoJSONPolygon {
  type: 'Polygon';
  coordinates: LngLat[][];
}

// ---------------------------------------------------------------------------
// Player identity
// ---------------------------------------------------------------------------

/** Hex values from the accessible palette in docs/schema.md. */
export type PlayerColor = '#00E5FF' | '#FFE600' | '#FF00FF' | '#FF6D00' | '#AEEA00' | '#FFFFFF';

export type PlayerStatus = 'active' | 'eliminated';

export interface Player {
  uuid: string;
  nickname: string;
  color: PlayerColor;
  status: PlayerStatus;
  eliminatedAt?: string;
}

// ---------------------------------------------------------------------------
// Positions and tails
// ---------------------------------------------------------------------------

/** A raw fix straight off the Geolocation API, normalised to our own shape. */
export interface PositionFix {
  lng: number;
  lat: number;
  /** Horizontal accuracy in metres, as reported by the device. */
  accuracy: number;
  /** Device-reported ground speed in m/s. Null when unavailable. */
  speed: number | null;
  /** Device-reported heading in degrees. Null when stationary or unavailable. */
  heading: number | null;
  /** Epoch milliseconds. */
  timestamp: number;
}

/** A single vertex of a rendered tail. Client-side representation. */
export interface TailPoint {
  lng: number;
  lat: number;
  /** Epoch milliseconds the point was recorded. Drives TTL expiry. */
  t: number;
}

export type TailEntryType = 'segment' | 'gps';

/** Server-side tail record — mirrors the `tail_entries` collection in docs/schema.md. */
export interface TailEntry {
  lobbyId: string;
  playerUUID: string;
  type: TailEntryType;
  segmentId: string | null;
  intersectionNodes: string[];
  gpsStart: GeoJSONPoint | null;
  gpsEnd: GeoJSONPoint | null;
  confidence?: number;
  timestamp: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export type LobbyStatus = 'waiting' | 'countdown' | 'active' | 'game_over';

export interface Lobby {
  id: string;
  inviteCode: string;
  hostUUID: string;
  status: LobbyStatus;
  playZone: GeoJSONPolygon;
  /** Starting trail length in metres; each power-up adds to it. */
  tailStartLengthMeters: number;
  tailLengthPerPickupMeters: number;
  players: Player[];
  createdAt: string;
  gameStartedAt?: string;
  gameEndedAt?: string;
}

export interface PowerUp {
  id: string;
  lng: number;
  lat: number;
  collected: boolean;
  collectedAt?: number;
  /**
   * OSM road class the node was snapped onto (street, path, service, …).
   * Kept so a placement that looks wrong on a ride can be diagnosed after it.
   */
  roadClass?: string;
}

/** Why a player was eliminated. `other_tail` arrives at Goalpost 3. */
export type EliminationReason = 'self_tail' | 'other_tail' | 'geofence' | 'quit';

/**
 * A play-zone boundary as a closed ring of corners, ordered around the
 * perimeter. Four corners today; the count is not baked in so that the
 * polygon and freehand tools in docs/future-directions.md drop straight in.
 *
 * Stored open (no repeated closing vertex) — the closing edge is implied.
 */
export type Geofence = LngLat[];

/** Everything the rider can set on the setup screen before a ride starts. */
export interface GameSettings {
  powerUpCount: number;
  geofenceEnabled: boolean;
  geofence: Geofence | null;
}

// ---------------------------------------------------------------------------
// Socket.io contract (docs/prd.md §12) — reserved for Goalpost 2
// ---------------------------------------------------------------------------

export interface ClientToServerEvents {
  'lobby:join': (payload: { inviteCode: string; uuid: string; nickname: string; color: PlayerColor }) => void;
  'lobby:leave': (payload: { uuid: string }) => void;
  'lobby:config_update': (payload: {
    playZone?: GeoJSONPolygon;
    tailStartLengthMeters?: number;
    tailLengthPerPickupMeters?: number;
  }) => void;
  'lobby:start_countdown': () => void;
  'game:position_update': (payload: PositionFix) => void;
}

export interface ServerToClientEvents {
  'lobby:player_list': (payload: { players: Player[] }) => void;
  'lobby:countdown': (payload: { secondsRemaining: number }) => void;
  'game:start': (payload: { startedAt: string }) => void;
  'game:tail_state': (payload: { tails: Record<string, TailPoint[]> }) => void;
  'game:player_positions': (payload: { positions: Record<string, PositionFix> }) => void;
  'game:collision': (payload: { playerUUID: string; timestamp: string }) => void;
  'game:player_eliminated': (payload: { playerUUID: string; reason: EliminationReason }) => void;
  'game:over': (payload: { winnerUUID: string | null; players: Player[] }) => void;
}
