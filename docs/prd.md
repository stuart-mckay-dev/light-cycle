# Light Cycle — Product Requirements Document

*MVP — Version 1.0 · February 2026*

**Status as of 10 August 2026: Goalpost 1 (single-player) is built and not yet field tested.**

This document describes the target MVP. Everything covering multiplayer, lobbies, invite codes, map matching, server-side collision arbitration, the geofenced play zone and the tiered accuracy model is specified but not implemented - Goalpost 1 is client-only. Two deliberate deviations are recorded in mvp-scope.md: self-collision adds a crossing-angle filter on top of proximity so that riding back along your own tail is not fatal, power-ups are snapped onto the rideable street graph rather than placed at fixed coordinates, and (6 October 2026) tails are limited by length rather than by time, with each power-up extending the length.

## 1. Product Overview

Light Cycle is a real-time multiplayer cycling game played on bicycles within a geofenced urban area. Inspired by the Tron light cycle game, players leave length-limited path tails behind them as they ride city streets; collecting power-ups makes a tail longer. A player is eliminated when they cross another player's active tail or their own at an intersection. The last rider surviving wins.

The MVP targets Portland, Oregon as the sole launch market, leveraging its dense cycling culture and well-mapped street infrastructure as an ideal testing environment.

## 2. Goals and Non-Goals

### 2.1 MVP Goals

- Deliver a playable, shareable multiplayer cycling game accessible via a web browser with zero install friction.

- Validate core gameplay loop with real players in a real urban environment.

- Establish a stable technical foundation that can be extended without significant rework.

- Keep onboarding friction as low as possible — join a game within 30 seconds of receiving an invite link.

### 2.2 Non-Goals for MVP

- Persistent player accounts, stats, or leaderboards.

- Native iOS or Android application.

- Support for cities other than Portland, Oregon.

- Explicit enclosed-area topology detection and instant enclosure elimination.

- Permanent tail territory capture game mode.

- Player count limits or stress testing.

## 3. Target Users

The primary user is a cyclist in Portland, Oregon who is socially organized enough to coordinate a group ride but needs minimal technical onboarding to participate. Users are expected to be on bicycles, outdoors, with a smartphone in hand or mounted.

Secondary consideration is the game organizer — the player who creates the lobby, sets the play zone, configures game rules, and shares the invite link. This user has slightly higher interaction with the product UI before the game begins.

## 4. Platform and Technical Constraints

### 4.1 Platform

| Type | Progressive Web App (PWA) |
|---------------------|--------------------------------------------------------------|
| **Distribution**    | Shareable invite link — no app store required                |
| **TLS Requirement** | HTTPS required for Geolocation API access                    |
| **iOS Constraint**  | App must remain in foreground with screen active during play |
| **Android**         | Background location and WebSocket behavior more permissive   |

### 4.2 Hosting — Development

| Infrastructure | Proxmox home server, Linux container |
|---------------------|------------------------------------------------------------|
| **TLS**             | Certbot — Let's Encrypt certificates                       |
| **Public Access**   | Cloudflare Tunnel — stable HTTPS URL without port exposure |
| **Deployment**      | Cron job autodeploy from GitHub main branch                |
| **Process Manager** | PM2 — Node process management and restart on failure       |

### 4.3 Hosting — Production Target

| Frontend | Vercel |
|--------------|---------------|
| **Backend**  | Railway       |
| **Database** | MongoDB Atlas |

## 5. Technology Stack

| Frontend | React + TypeScript |
|-------------------|--------------------------------|
| **Backend**       | Node.js + Express + TypeScript |
| **Database**      | MongoDB                        |
| **Real-time**     | Socket.io (WebSockets)         |
| **Map Rendering** | Mapbox GL JS                   |
| **Map Matching**  | Mapbox Map Matching API        |
| **Base Map Data** | OpenStreetMap via Mapbox tiles |

## 6. User Identity and Session Management

The MVP uses session-based identity only. No persistent accounts are created or required.

- On first visit, a UUID is generated client-side and stored in sessionStorage.

- The player selects a nickname (required) and a path tail color from a predefined palette.

- The UUID persists through page refreshes within the same browser tab, allowing reconnection to an active lobby.

- Closing the browser tab clears the session. Returning generates a new UUID and the player is treated as a new participant.

- The color palette is predefined for high contrast and colorblind accessibility. Colors are claimed on join and released on leave, preventing duplicate colors within a lobby.

Persistent accounts, player history, and statistics are deferred to a future iteration contingent on MVP traction.

## 7. Lobby System

### 7.1 Lobby Lifecycle

| State | Description |
|---------------|-------------------------------------------------------------------------------------------------------------|
| **Waiting**   | Host configures play zone, tail length settings, and reviews player list. Players join via invite code. |
| **Countdown** | Host triggers game start. Synchronized countdown broadcast to all players.                                  |
| **Active**    | Game in progress. Position sync, tail recording, and collision detection are live.                          |
| **Game Over** | One player remains or all players eliminated. Results displayed. Lobby document TTL expires in MongoDB.     |

### 7.2 Configurable Game Parameters

- Geofenced play zone — host draws or selects a boundary on the map before game start.

- Tail length — the starting length budget in metres (default 500) and the metres each power-up adds (default 150). A tail longer than its budget is trimmed from the oldest end, so standing still never shortens it. This replaced a time-based TTL, which let a stuck rider wait for their whole tail to expire.

## 8. Geolocation and Position Sync

### 8.1 Tiered Accuracy Model

Position polling frequency and accuracy are adjusted dynamically based on game context to balance responsiveness with battery consumption.

| Mode | Trigger | Behavior |
|---------------|-------------------------------------------------------------------|---------------------------------------------------------------------|
| Low accuracy  | No players or tails nearby                                        | Standard accuracy, longer poll interval                             |
| High accuracy | Approaching intersection with active tail, or near another player | enableHighAccuracy: true, tighter maximumAge, shorter poll interval |

### 8.2 Client-Server Responsibilities

- Clients emit raw GPS coordinates only. No collision logic runs on the client.

- The server performs all map matching, segment recording, tail state management, and collision detection.

- Authoritative tail state is broadcast from the server to all players in the lobby after each position update.

- The screen must remain on and the app in the foreground during active gameplay. This is a stated requirement for players and sidesteps iOS PWA background location limitations.

## 9. Map Matching and Tail Recording

### 9.1 Street Graph Mode

For positions on or near mapped roads, player coordinates are snapped to the nearest OSM street segment via the Mapbox Map Matching API. The tail is stored as a timestamped queue of street segment IDs in MongoDB.

- Each tail entry contains: player UUID, segment ID, timestamp.

- Tail length is enforced by the server: after recording a player's new entries it trims their oldest entries beyond the player's current length budget. Each entry stores its ground length so the trim is a newest-first sum.

- Permanent tails (for a future territory game mode) are an unbounded length budget - a configuration change rather than an architectural change.

### 9.2 Off-Graph Mode

When map matching confidence falls below a defined threshold, the system falls back to storing raw GPS polyline segments. This covers alleys, park paths, parking lots, and any route not present in OSM.

- Off-graph segments are stored as timestamped GPS coordinate pairs alongside the segment queue.

- Off-graph tails participate in collision detection via geometric line intersection rather than segment ID comparison.

- The same length budget applies to both segment and GPS entries.

### 9.3 Tail Data Model (MongoDB)

Collection: tail_entries

| Field | Type | Notes |
|--------------------|-----------------------|------------------------------------------------|
| **playerUUID**     | String                | Identifies which player owns this segment      |
| **lobbyId**        | String                | Scopes entries to a specific game lobby        |
| **segmentId**      | String \| null        | Mapbox segment ID — null for off-graph entries |
| **gpsCoordsStart** | GeoJSON Point \| null | For off-graph entries only                     |
| **gpsCoordsEnd**   | GeoJSON Point \| null | For off-graph entries only                     |
| **timestamp**      | Date                  | Orders entries for length trimming             |
| **lengthMeters**   | Number                | Summed newest-first to enforce the budget      |

## 10. Collision Detection

### 10.1 Rule

A collision occurs when a player crosses another player's active tail — or their own — at an intersection. Direction of travel is not a factor. Two players on the same street segment traveling in parallel or opposing directions is not a collision. A collision requires that two non-parallel paths meet at an intersection node.

### 10.2 Street Graph Collision

- When a player traverses an intersection node, the server checks the live tail queue for any entries whose segment approaches the same intersection node from a perpendicular street.

- If a perpendicular active tail entry exists for that intersection, a collision is triggered for the arriving player.

- Two players on the same segment — regardless of direction — do not trigger a collision.

### 10.3 Off-Graph Collision

- For GPS polyline segments, collision detection uses standard 2D line segment intersection geometry.

- Direction is not considered. Intersection of any two non-parallel line segments triggers a collision.

### 10.4 Arbitration

- All collision detection is server-side.

- In simultaneous crossing events where two clients might disagree, the server result is authoritative.

- A short server-side buffer window handles near-simultaneous events to ensure fair outcomes.

## 11. Game Rules — MVP Ruleset (Multiplayer Snake)

- All players are active simultaneously within a geofenced play zone.

- Each player leaves a path tail behind them as they ride.

- Tails are limited by length: a starting budget set by the host, extended by each power-up collected. The oldest end is trimmed as the rider moves.

- A player is eliminated when they cross any active tail — their own or another player's — at an intersection.

- Players who become geometrically enclosed by another player's tail are not explicitly detected. They are naturally constrained by the geometry and eliminated when they attempt to cross a tail segment while navigating the shrinking available space.

- The last surviving player wins.

Alternative rulesets (explicit enclosure elimination, permanent territory tails) are deferred to post-MVP.

## 12. WebSocket Event Reference

### 12.1 Lobby Events

| Event | Direction | Description |
|---------------------------|-----------------|-----------------------------------------------|
| **lobby:join**            | Client → Server | Player joins lobby with UUID, nickname, color |
| **lobby:leave**           | Client → Server | Player disconnects or leaves lobby            |
| **lobby:player_list**     | Server → All    | Broadcast updated player list on join/leave   |
| **lobby:config_update**   | Host → Server   | Host updates play zone or tail length settings |
| **lobby:start_countdown** | Host → Server   | Host triggers game start sequence             |
| **lobby:countdown**       | Server → All    | Synchronized countdown broadcast              |
| **game:start**            | Server → All    | Game state transitions to Active              |

### 12.2 Game Events

| Event | Direction | Description |
|----------------------------|-----------------|------------------------------------------------------|
| **game:position_update**   | Client → Server | Raw GPS coordinate emission from player              |
| **game:tail_state**        | Server → All    | Authoritative tail state broadcast after each update |
| **game:player_positions**  | Server → All    | All active player positions broadcast                |
| **game:collision**         | Server → All    | Collision event for a specific player UUID           |
| **game:player_eliminated** | Server → All    | Player removal and tail cleanup                      |
| **game:over**              | Server → All    | Final result broadcast                               |

## 13. Recommended Build Order

Each phase should be independently testable before proceeding to the next.

1.  Lobby and invite system — UUID session, nickname/color selection, invite code generation and join flow, WebSocket room management.

2.  Map rendering — Mapbox integration, geofence display, player position markers.

3.  Real-time position sync — Socket.io position emission, server broadcast, live player markers on map.

4.  Map matching and tail recording — Mapbox Map Matching API integration, segment storage, length-based tail trimming, off-graph GPS fallback, tail rendering.

5.  Collision detection and game state — intersection crossing logic, elimination events, game over condition.

## 14. Deferred to Post-MVP

- Explicit enclosed-area topology detection and instant enclosure elimination ruleset.

- Permanent tail territory capture game mode.

- Persistent player accounts, authentication, statistics, and leaderboards.

- Player count limits and load/stress testing.

- Native iOS and Android applications.

- Multi-city deployment and rural area support.

- Push notifications for lobby invites.

- Spectator mode.
