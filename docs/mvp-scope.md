# Light Cycle — MVP Scoping & Technical Validation Plan

*Version 1.0 · February 2026*

**Status as of 10 August 2026: Goalpost 1 is built and not yet field tested.**

Every Goalpost 1 deliverable except the outdoor ride is implemented and verified against a simulated ride injected into the browser: crossing your own trail eliminates, riding back along it does not, and power-up nodes land on the street graph. None of it has been validated against real GPS on a moving bicycle, which is the stated success condition for this goalpost. Goalposts 2 and 3 have not been started.

## Purpose

This document defines the three sequential technical validation goalposts for Light Cycle. Each goalpost proves out a discrete layer of the system before the next layer is built on top of it. The intent is to reduce risk, validate assumptions early, and avoid building complex multiplayer infrastructure before the foundational single-player mechanics are proven in a real mobile browser environment.

Goalposts are designed to be independently demonstrable. Each one should be playable and shareable with testers before work begins on the next.

## Goalpost Overview

| # | Name | Validates | Success Condition |
|--------|----------------------|--------------------------------------------------------------------------|------------------------------------------------------------------------------|
| **1**  | Single-Player Snake  | PWA, GPS pathing, tail rendering, collision detection, power-ups         | Playable solo game running in a mobile browser on a real device outdoors     |
| **2**  | Multiplayer Sync     | WebSocket position broadcast, multi-player tail rendering, lobby system  | Two or more players see each other's live position and tails in real time    |
| **3**  | Full Tron LightCycle | Intersection collision model, map matching, game rules, elimination flow | Complete game loop with correct collision detection on real Portland streets |

## Goalpost 1 — Single-Player Snake

### Objective

Prove that the core game primitives work in a real mobile PWA environment before any multiplayer complexity is introduced. A player on a bicycle should be able to open a URL on their phone, start a game, ride around a defined area, see their path tail rendered on a map, collect power-up points, and be eliminated when they cross their own tail.

This goalpost intentionally avoids all network multiplayer concerns. It validates the hardest environmental unknowns: GPS accuracy on a moving bicycle, PWA behavior in a mobile browser, screen wake lock reliability, and the basic feel of the game loop.

### Scope

### In Scope

- PWA shell — manifest.json, service worker, installability on iOS and Android

- Screen Wake Lock API integration to prevent screen sleep during gameplay

- Geolocation API integration — high accuracy mode, continuous position watch

- Path tail rendering on Mapbox GL JS map — polyline drawn from GPS coordinates

- Basic GPS smoothing — simple moving average or similar to reduce jitter noise

- Power-up points — fixed coordinates placed on the map that the player collects by proximity

- Self-collision detection — player eliminated when their current position is within threshold distance of their own tail

- Tail expiration — tail segments older than a configurable TTL are removed from the active collision surface

- Single-player game loop — start, active, eliminated, restart

- Minimal UI — start button, score/power-up counter, elimination screen

### Out of Scope for Goalpost 1

- Any multiplayer or networking — this is entirely offline/single-player

- Map matching against OSM street graph — raw GPS polyline only

- Intersection-aware collision detection — proximity threshold only

- Lobby system, invite codes, or session management

- Backend server — everything runs client-side

- MongoDB or any persistence layer

### Technical Validation Questions

Goalpost 1 exists to answer the following specific unknowns:

- How accurate is browser GPS on a moving bicycle, and is the raw position data usable without map matching?

- Does the Screen Wake Lock API reliably prevent screen sleep in Chrome and Safari on iOS and Android during an outdoor session?

- What GPS update frequency is achievable in high accuracy mode, and is it sufficient to render a smooth tail at cycling speed?

- How much GPS jitter occurs in practice, and what smoothing approach produces a clean-looking tail without introducing lag?

- Is proximity-based self-collision detection reliable enough to feel fair at cycling speed, or does jitter cause false positives?

- Does the PWA feel usable as a cycling game interface — map visibility in sunlight, touch targets, landscape vs portrait?

### Power-Up Design

Power-up points serve a dual purpose in Goalpost 1: they give the player a goal to ride toward (making the game feel purposeful), and they validate that proximity detection works correctly before it is used for the more consequential collision detection in Goalpost 3.

- Power-ups are placed at fixed real-world coordinates within a defined play area.

- Collection is triggered when the player's GPS position is within a configurable radius of the power-up point (e.g. 15 meters).

- Collected power-ups disappear from the map and increment the player's score.

- Power-up effects are intentionally simple for Goalpost 1 — score increment only. Effects like tail length extension, temporary invincibility, or tail clearing are deferred to post-MVP.

- Power-up placement for testing should be on open streets or paths where GPS accuracy is best, avoiding areas with tall buildings or tree canopy that degrade signal.

### Success Criteria

> ✓ A player can open the PWA URL on a mobile device and begin a game without installing anything from an app store.
>
> ✓ The screen remains active throughout a test ride without manual intervention.
>
> ✓ The player's path tail renders on the map in near real-time and visually tracks the route ridden.
>
> ✓ Power-up collection triggers reliably when the player passes within the defined radius.
>
> ✓ Self-collision detection triggers correctly when the player crosses their own tail, without significant false positives from GPS jitter.
>
> ✓ Tail expiration removes old segments from the collision surface after the configured TTL.
>
> ✓ The game loop completes — start, play, elimination, restart — without requiring a page reload.

### Implementation Notes (added after build)

Two things were built differently from the scope above. Both are deliberate and both are reversible from client/src/config/gameConfig.ts.

1\. Self-collision is proximity plus a crossing-angle filter, not proximity alone. Pure proximity eliminates a rider the moment they double back along a street they already rode, because they sit within a few metres of their own tail for its whole length. That contradicts the rule in prd.md 10.1 and makes the game unplayable. Proximity is still the trigger; the angle test requires the rider to be crossing the tail rather than travelling along it. Set collision.requireCrossing to false to compare both behaviours on a test ride.

2\. Power-ups are snapped to the rideable street graph rather than placed at fixed coordinates. A purely geometric scatter put nodes in the Willamette and inside city blocks. Candidates are now snapped onto the nearest street, path, trail, alley or parking aisle using the Mapbox Tilequery API, which works with the public token; Map Matching needs the secret key and stays server-side until Goalpost 3. A candidate with nothing rideable within the snap radius is dropped rather than relocated.

3\. The geofenced play zone was pulled forward from Goalpost 3 and is enforced on the client. Goalpost 1 was otherwise field-testing a game that cannot really be lost: with a three-minute tail TTL a rider escapes any developing situation by riding in a straight line and waiting it out, so nothing forces the doubling-back that creates the danger. The rider sets a four-cornered box with draggable corners before the ride; leaving it starts a grace countdown and then eliminates. Power-up nodes are constrained to the zone. It becomes server-authoritative at Goalpost 3 along with everything else, and the richer boundary tools - freehand drawing, arbitrary corner counts, interior exclusion zones, street-based boundaries - are parked in future-directions.md.

Toolchain note: the project now runs on Node 24 LTS, TypeScript 7 and Vite 8. ../RUNBOOK.md has been updated to match.

### Deliverable Checklist

| Deliverable | Status | Notes |
|--------------------------------------------------|-----------------|---------------------------------------------------------------------------------------------------------------------------------|
| PWA manifest and service worker                  | **Complete**    | Installable. Service worker is network-first on the shell, not offline-first. Icon set generated by scripts/generate-icons.mjs. |
| Screen Wake Lock integration                     | **Complete**    | Re-acquires on visibilitychange, which the OS forces on every hide. UI warns when the API is unavailable.                       |
| Geolocation watch with high accuracy mode        | **Complete**    | Always high accuracy. The tiered model in prd.md 8.1 remains deferred to Goalpost 3.                                          |
| GPS smoothing utility                            | **Complete**    | Accuracy and implausible-speed rejection, then an accuracy-weighted moving average with a deadband.                             |
| Mapbox GL JS map with player position marker     | **Complete**    | Dark style, camera follows the rider. Game still runs without a token on a grid backdrop.                                       |
| Tail polyline rendering from position history    | **Complete**    | Blurred glow pass under a gradient core, so the expiring end reads dim.                                                         |
| Tail TTL expiration                              | **Complete**    | Client-side for now; becomes the MongoDB TTL index on expiresAt at Goalpost 2.                                                  |
| Power-up markers and proximity collection        | **Complete**    | Placement changed from fixed coordinates - see Implementation Notes below.                                                      |
| Self-collision proximity detection               | **Complete**    | Proximity trigger plus a crossing-angle filter - see Implementation Notes below.                                                |
| Game state machine (start / active / eliminated) | **Complete**    | idle to locating to active to eliminated, restart without a page reload.                                                        |
| Minimal game UI                                  | **Complete**    | Plus a live diagnostics panel (fix rate, rejections, smoothing shift) and a ride-log JSON export for threshold tuning.          |
| Outdoor device testing on bicycle                | **Not Started** | THE REMAINING GATE. None of the deliverables above has been validated against real GPS on a moving bike.                        |

## Goalpost 2 — Multiplayer Sync

### Objective

Extend the Goalpost 1 client with a Node/Express + Socket.io backend and prove that two or more players can see each other's live position and path tails in real time. This goalpost validates the network communication layer — the most technically uncertain part of the stack outside of GPS — before the full game rules are implemented on top of it.

Collision detection between players is not the focus of Goalpost 2. The goal is reliable, low-latency position and tail state synchronization. If players can see each other moving on the map with tails that feel live, Goalpost 2 is complete.

### Scope

### In Scope

- Node/Express server with TypeScript — basic HTTP and WebSocket setup

- Socket.io server — lobby room management, player join/leave events

- Lobby creation and invite code generation

- Player join via invite code — UUID, nickname, color selection

- Real-time position broadcast — clients emit GPS, server broadcasts to lobby

- Other players rendered as moving markers on the local map

- Other players' path tails rendered as colored polylines

- Tail state management on the server — authoritative tail queue per player

- MongoDB — lobby documents and tail_entries collection with TTL index

- Proxmox dev server deployment via Cloudflare Tunnel for real-device testing

- Basic lobby UI — create lobby, join via code, player list, host start button

### Carried Forward from Goalpost 1

- All single-player mechanics — GPS, tail rendering, screen wake lock, power-ups

- Self-collision detection

- Tail TTL expiration (now server-authoritative)

### Out of Scope for Goalpost 2

- Player-to-player collision detection — tails are visible but not yet lethal to other players

- Map matching against OSM street graph

- Intersection-aware collision model

- Geofenced play zone enforcement

- Tiered GPS accuracy mode based on proximity

### Technical Validation Questions

- What is the end-to-end latency from GPS emission on one device to tail render on another device in a real outdoor test?

- Does Socket.io room management remain stable as players join, leave, and reconnect during a session?

- What is the practical payload size per position update, and is the update frequency sustainable for 3-5 concurrent players without visible lag?

- Does the server-authoritative tail state remain consistent with what each client renders, or do sync issues emerge at scale?

- Does the reconnection flow (page refresh during active game) correctly restore a player's tail state from MongoDB?

- Is the Cloudflare Tunnel stable enough for a 30+ minute outdoor test session with multiple mobile clients?

### Network Event Focus

The primary engineering effort of Goalpost 2 is the Socket.io event flow. The events that must be reliable:

- lobby:join / lobby:leave — player list stays accurate on all connected clients

- game:position_update (client → server) — raw GPS emitted frequently without overwhelming the server

- game:tail_state (server → all) — authoritative tail broadcast after each processed update

- game:player_positions (server → all) — live position of all active players

### Success Criteria

> ✓ Two players on separate physical devices can join the same lobby via invite code.
>
> ✓ Each player sees the other's live position marker updating on their map in near real-time.
>
> ✓ Each player sees the other's path tail rendered correctly and updating as they ride.
>
> ✓ Tail expiration works correctly for all players across the network — expired segments disappear from all clients simultaneously.
>
> ✓ A player who refreshes their browser rejoins the lobby with their tail state intact.
>
> ✓ The session remains stable for a 20-minute outdoor test ride with no server crashes or client desync.

### Deliverable Checklist

| Deliverable | Status | Notes |
|---------------------------------------------------------|-----------------|-----------|
| Node/Express + Socket.io server scaffold                | **Not Started** |           |
| Lobby create and invite code API                        | **Not Started** |           |
| Socket.io room management (join/leave)                  | **Not Started** |           |
| Player UUID/nickname/color session flow                 | **Not Started** |           |
| Server-side tail queue (MongoDB tail_entries)           | **Not Started** |           |
| Position broadcast — client emit → server → all clients | **Not Started** |           |
| Other-player position markers on map                    | **Not Started** |           |
| Other-player tail polyline rendering                    | **Not Started** |           |
| Reconnection flow with tail state restore               | **Not Started** |           |
| Proxmox dev server + Cloudflare Tunnel deployment       | **Not Started** |           |
| Lobby UI (create, join, player list, start)             | **Not Started** |           |
| Outdoor multi-device test session                       | **Not Started** |           |

## Goalpost 3 — Full Tron LightCycle Game

### Objective

Layer the full game rules on top of the proven multiplayer infrastructure from Goalpost 2. This goalpost introduces map matching against the OSM street graph, intersection-aware collision detection, geofenced play zones, tiered GPS accuracy, and the complete game loop with player elimination and a winner.

By the time Goalpost 3 begins, the risky unknowns have been resolved. GPS behavior, network latency, and tail synchronization are understood quantities. Goalpost 3 is primarily a product and rules layer built on a stable foundation.

### Scope

### In Scope

- Mapbox Map Matching API integration — server-side GPS-to-segment snapping

- Off-graph GPS fallback when map matching confidence is below threshold

- Intersection-aware collision detection — perpendicular path crossing at intersection nodes

- Off-graph line intersection geometry for park/parking lot paths

- Server-side collision arbitration with buffer window for simultaneous events

- Geofenced play zone — host draws boundary, server enforces, players outside zone are warned/eliminated

- Tiered GPS accuracy — low frequency standard accuracy when no threats nearby, high accuracy when approaching a tail or player

- Player-to-player tail collision (own tail collision carried forward from Goalpost 1)

- Player elimination flow — eliminated player's tail remains visible until TTL expiry, player transitions to spectator view

- Game over condition — last player standing wins, results screen

- Host game configuration — play zone selection, tail TTL duration

- Predefined color palette with colorblind-accessible colors and per-lobby claim/release

### Carried Forward from Goalpost 2

- All multiplayer networking — Socket.io events, lobby system, tail sync

- MongoDB schema — lobbies, tail_entries, player_sessions

- PWA shell, screen wake lock, all Goalpost 1 mechanics

### Out of Scope for Goalpost 3

- Explicit enclosed-area topology detection

- Power-up effects beyond basic score (deferred from Goalpost 1)

- Persistent accounts, leaderboards, or statistics

- Alternative game modes (territory capture, etc.)

### Technical Validation Questions

- Does map matching via the Mapbox cycling profile produce correct segment assignments for Portland streets at cycling speed?

- Is the map matching API response latency acceptable for real-time use, or does it require a buffer/queue approach?

- Does the intersection collision model correctly distinguish perpendicular crossings from parallel riding in real outdoor conditions?

- How often does GPS jitter cause the map matching confidence to drop below threshold, triggering the off-graph fallback unnecessarily?

- Does the tiered accuracy model produce a noticeable improvement in collision detection accuracy near tails, relative to Goalpost 1 proximity detection?

- Is the geofence boundary enforcement lag-tolerant enough to feel fair on a moving bicycle?

### Success Criteria

> ✓ Map matching correctly snaps player paths to OSM street segments for the majority of rides on Portland streets.
>
> ✓ Intersection collision detection correctly triggers elimination when a player crosses a perpendicular tail at an intersection.
>
> ✓ Two players riding the same street in any direction are not incorrectly eliminated.
>
> ✓ The geofence boundary is enforced — players who exit the zone are notified and eliminated after a grace period.
>
> ✓ A complete game session runs from lobby creation through player eliminations to a declared winner.
>
> ✓ The eliminated player transitions to a spectator view showing remaining players and tails.
>
> ✓ Results are displayed to all players at game over.

### Deliverable Checklist

| Deliverable | Status | Notes |
|-----------------------------------------------|-----------------|-----------|
| Mapbox Map Matching API service (server-side) | **Not Started** |           |
| Off-graph GPS fallback logic                  | **Not Started** |           |
| Intersection node collision detection         | **Not Started** |           |
| Off-graph line intersection geometry          | **Not Started** |           |
| Collision arbitration buffer window           | **Not Started** |           |
| Tiered GPS accuracy mode switcher             | **Not Started** |           |
| Geofenced play zone enforcement               | **Not Started** |           |
| Player elimination and spectator transition   | **Not Started** |           |
| Game over / winner declaration flow           | **Not Started** |           |
| Host lobby configuration UI (zone, TTL)       | **Not Started** |           |
| Color palette claim/release system            | **Not Started** |           |
| Full outdoor group test (3+ players)          | **Not Started** |           |

## Risk Register

| Risk | Phase | Mitigation | Fallback |
|--------------------------------------------------------------|-----------|------------------------------------------------------------------|-------------------------------------------------------------------|
| GPS jitter causes false self-collision positives             | 1         | Tune proximity threshold; apply moving average smoothing         | Increase threshold; accept occasional misses over false positives |
| iOS Safari suspends geolocation when screen dims             | 1         | Screen Wake Lock API; instruct players to keep app in foreground | Document as known limitation; native app deferred to post-MVP     |
| Map matching API latency too high for real-time use          | 3         | Queue position updates; batch match; cache segment lookups       | Widen the matching window; fall back to proximity for collision   |
| GPS drops below map matching confidence threshold frequently | 3         | Tune confidence threshold in testing; log all drops for analysis | Expand off-graph GPS fallback; revisit threshold per neighborhood |
| Socket.io desync under real outdoor conditions               | 2         | Server-authoritative state; client reconciles on reconnect       | Implement delta-state resync on reconnection                      |
| Mapbox free tier rate limits hit during testing              | 2-3       | Monitor usage dashboard; cache tile requests                     | Upgrade plan; self-host OSM tiles if needed                       |
