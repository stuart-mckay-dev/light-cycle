# Light Cycle — Future Directions — Parking Lot

*Version 1.0 · February 2026 · Living Document*

**Status as of 10 August 2026: Goalpost 1 is built but not yet field tested.**

Items below whose trigger condition is Goalpost 1 stay parked for now. The code is written and verified in simulation, but the goalpost does not close until it has been ridden outdoors on real GPS, and several of these triggers (power-up effects, portrait versus landscape) depend on what that ride actually shows. Review this document again once the outdoor test is done.

## Purpose

This document is a living parking lot for ideas, features, and directions that have been discussed and recognized as valuable, but explicitly deferred because they are out of scope for the current development phase. Parking ideas here prevents them from being forgotten while keeping the MVP focused.

Items in this document are not rejected — they are saved. Each entry includes the condition under which it should be reconsidered and the reason it is deferred now. This document should be reviewed at the end of each major goalpost to assess whether any items have become relevant.

> *Add new items to this document as they arise in planning or testing. Do not act on items here without moving them to the active PRD or MVP Scope document first.*

## Game Rules and Modes

| Idea | Trigger Condition | Why Deferred |
|-------------------------------------------|--------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Territory Capture Mode**                | Post-Goalpost 3 traction       | Requires permanent (non-expiring) tails and a different win condition. Different enough from MVP snake mode that it should be a second ruleset, not a modification. Build after snake mode is validated.                                        |
| **Explicit Enclosure Elimination**        | Post-Goalpost 3 traction       | Detecting when a player's path forms an enclosure (Jordan curve on graph) that traps another player. Technically complex — requires graph traversal on loop detection. The length-limited tail handles this implicitly in MVP: a trapping loop is trimmed away as its owner keeps riding.   |
| **Open-Curve Inside/Outside Enforcement** | Post-MVP with enclosure demand | Enforcing that a player cannot cross into the 'inside' of another player's non-closed U or C-shaped path. Requires topological analysis of partial paths against the geofence boundary. Deferred pending validation of simpler collision model. |
| **Configurable Tail Length Per Game**     | Goalpost 3 complete            | Starting length and length-per-power-up are configurable at lobby creation. Surfacing them clearly in the host UI, and testing a cap or other power-up effects on balance, should happen post-Goalpost 3.                                                                                  |
| **Power-Up Effects Beyond Score**         | Goalpost 1 validation complete | Tail length extension, temporary invincibility, tail clearing, speed boost. Deferred until basic power-up proximity collection is proven in Goalpost 1.                                                                                         |
| **Time-Limited Match Format**             | Post-Goalpost 3                | Game ends after X minutes; player with most tail distance or power-ups wins. Adds a second win condition. Deferred until last-player-standing is proven.                                                                                        |
| **Shrinking Play Zone**                   | Post-Goalpost 3 traction       | Play zone boundary contracts over time, forcing players together. Common battle royale mechanic. Adds pressure in long games. Requires geofence update broadcast and enforcement at intervals.                                                  |
| **Spectator Mode**                        | Goalpost 3 complete            | Eliminated players currently transition to a passive view. Full spectator mode with a dedicated perspective and ability to join mid-game queue is a product feature, not MVP.                                                                   |

## Platform and Distribution

| Idea | Trigger Condition | Why Deferred |
|---------------------------|-----------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Native iOS App**        | Strong traction post-MVP, iOS GPS complaints from testers | Eliminates Safari PWA background location limitations. High distribution cost — App Store review, TestFlight for beta, ongoing maintenance. Only justified if PWA limitations demonstrably hurt the experience.                       |
| **Native Android App**    | Alongside native iOS decision                             | Same rationale as iOS. Android PWA behavior is better than iOS, making this lower priority than iOS native if native is pursued.                                                                                                      |
| **Multi-City Support**    | Post-MVP geographic expansion                             | Portland is chosen for OSM data quality and cycling culture. Expanding requires validating OSM coverage quality in target cities and potentially adjusting map matching confidence thresholds per area.                               |
| **Rural / Off-Grid Play** | Post-MVP with identified demand                           | Areas with sparse OSM data would require heavier reliance on off-graph GPS mode. Play zone definition in rural areas is also less intuitive without a street grid reference.                                                          |
| **App Store PWA Listing** | Post-Goalpost 3                                           | Progressive Web Apps can be submitted to Google Play via TWA (Trusted Web Activity) and to the App Store via a thin wrapper. Lower cost than full native but adds distribution discoverability. Deferred until the product is stable. |

## Accounts, Social, and Progression

| Idea | Trigger Condition | Why Deferred |
|------------------------------------------|---------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Persistent Player Accounts**           | Post-MVP traction               | UUID session identity is intentionally ephemeral for MVP. Persistent accounts require auth flow, email verification or OAuth, and a users collection. Only justified when stats and leaderboards have value to retain.    |
| **Player Statistics and History**        | Persistent accounts implemented | Games played, wins, total distance ridden, power-ups collected, eliminations. Requires persistent accounts and a stats collection. No value without retention.                                                            |
| **Leaderboards**                         | Active player base established  | Global or city-level leaderboards. Requires persistent accounts, sufficient active players to make rankings meaningful, and anti-cheat considerations.                                                                    |
| **Player Profiles and Customization**    | Persistent accounts implemented | Avatar, custom tail patterns, nickname history, achievement badges. Social layer on top of identity. Deferred well past MVP.                                                                                              |
| **Push Notifications for Lobby Invites** | Post-Goalpost 2                 | Sending an invite that notifies the recipient even if they don't have the app open. Requires notification permissions, a push service, and account identity to associate the notification with. MVP uses shared URL only. |
| **In-Game Friend List**                  | Persistent accounts implemented | Knowing which friends are online or recently played. Social graph feature requiring accounts and identity persistence.                                                                                                    |

## Technical Architecture

| Idea | Trigger Condition | Why Deferred |
|-------------------------------------------------|-----------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Native WebSocket Instead of Socket.io**       | Performance bottleneck identified       | Socket.io adds overhead and abstractions. For MVP it provides useful fallbacks and room management. If benchmarking shows meaningful latency improvements from raw WebSockets at scale, worth revisiting.                            |
| **Self-Hosted OSM Tile Server**                 | Mapbox cost becomes significant         | Running an OSM tile server (e.g. via OpenMapTiles) eliminates Mapbox tile costs at scale. High operational complexity. Only worth pursuing if Mapbox costs become meaningful, which requires substantial traffic.                    |
| **Self-Hosted Map Matching (OSRM or Valhalla)** | Mapbox map matching rate limits or cost | OSRM and Valhalla can run locally with OSM data. Eliminates API dependency and latency. Significant DevOps overhead. Deferred until Mapbox limits are a real constraint.                                                             |
| **Multi-Instance Backend with Sticky Sessions** | Scale beyond single server              | Socket.io requires sticky sessions when running multiple server instances. Single-instance is sufficient for MVP. Required before horizontal scaling.                                                                                |
| **CI/CD Pipeline (GitHub Actions)**             | Post-MVP, second collaborator           | Current cron-based autodeploy is sufficient for solo development. A proper CI pipeline with test runs, build checks, and staged deployment becomes valuable when the codebase has more contributors or critical test coverage.       |
| **End-to-End Testing Suite**                    | Post-Goalpost 3                         | Automated testing of the full game loop including WebSocket events is complex. Unit tests for collision detection logic and map matching utilities are more immediately valuable and should come first.                              |
| **Redis for Session State**                     | Multi-instance scaling                  | If the backend scales to multiple instances, session state (lobby memberships, player positions) needs to move out of in-process memory and into a shared store. Redis is the standard solution. Not needed for single-instance MVP. |
| **Replay System**                               | Post-MVP with user demand               | Recording and replaying game sessions. Useful for reviewing close calls, sharing highlights, debugging collision edge cases. Requires storing full position/event history per game — significant storage cost.                       |

## UX and Interface

| Idea | Trigger Condition | Why Deferred |
|-------------------------------------------|-------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Landscape-Optimized Game UI**           | Goalpost 1 usability testing  | Portrait vs landscape trade-offs for a cycling map interface are unknown until real outdoor testing. If landscape is clearly better, a dedicated landscape layout may be needed. Deferred until Goalpost 1 feedback.                               |
| **Sound and Haptic Feedback**             | Goalpost 1 complete           | Audio cues for power-up collection, nearby tail proximity, near-miss events. Haptics for collision warning. Adds game feel but requires careful design for an outdoor cycling context where audio is often inaudible.                              |
| **Onboarding Tutorial**                   | First external testers        | A first-run experience explaining game rules, how to read the map, and what the tails mean. Not needed for developer self-testing but important before sharing with non-technical players.                                                         |
| **Accessibility — Screen Reader Support** | Post-MVP with identified need | Map-based cycling games have inherent accessibility constraints. Screen reader support is not meaningful for this type of gameplay. Color blindness is addressed in the palette. Other accessibility concerns should be evaluated with real users. |
| **Dark Mode Map Theme**                   | Post-Goalpost 1               | A dark Mapbox style would make colored tails more visible in sunlight. Mapbox offers several dark styles. Low-effort improvement once the map rendering is stable.                                                                                 |
| **Minimap / Overview Panel**              | Goalpost 3 complete           | A small inset map showing the full play zone with all player positions. Useful in large play zones where players are spread out. Adds UI complexity. Deferred until play zone scale is understood from testing.                                    |

## Community and Organized Play

| Idea | Trigger Condition | Why Deferred |
|---------------------------------------------|-------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Scheduled Public Games / Events**         | Active player community             | Open lobby events that any registered player can join at a set time. Requires accounts, a public lobby discovery mechanism, and moderation. Deferred until there's a community to organize. |
| **Tournament Mode**                         | Established competitive player base | Bracket-style elimination tournaments with persistent results. Significant product work. Requires accounts, matchmaking, and a player base large enough to fill brackets.                   |
| **Sponsored Play Zones (Local Businesses)** | Revenue exploration post-traction   | Partnering with local bike shops, coffee shops, or cycling events to host sponsored play zones. Product-market fit and a local user base required first.                                    |
| **Portland Cycling Community Integration**  | Post-Goalpost 3 traction            | Outreach to Portland cycling groups, Bicycle Transportation Alliance, or local cycling events. Timing matters — premature outreach before the product is stable wastes goodwill.            |

## Play Zone and Boundary Tools

The play zone shipped early, during Goalpost 1, because without a boundary the game has no pressure: with a tail that falls away behind them a rider can escape any developing situation by riding in a straight line and waiting it out. What shipped is the simplest thing that restores that pressure - a four-cornered box with draggable corners. The items below are the richer boundary tools that box defers.

### Freehand play-zone drawing

Trigger: Field testing shows the box is too blunt for real neighbourhoods

A drawing tool to trace an arbitrary outline on the map rather than dragging four corners. The zone is already stored as an ordered ring of corners with no fixed count, and containment is a general point-in-polygon test, so the data model does not change - this is a map-interaction feature.

### Custom polygon corner count

Trigger: Same as above; a smaller step than freehand drawing

Add and remove corners on the existing zone, so a rider can cut a five- or six-sided area to match a neighbourhood without freehand precision. Intermediate between the box and full drawing, and probably the cheapest of these to build.

### Exclusion zones inside the play area

Trigger: A test area has a genuinely unsafe pocket inside otherwise good riding

Holes in the play area - an industrial estate, a busy arterial, a construction site - where everything around them is fair game. GeoJSON polygons already support interior rings, and containment becomes outer ring AND NOT any inner ring. The interesting work is in the interface and in how the boundary is communicated to a moving rider.

### Street and intersection boundaries

Trigger: Goalpost 3, once map matching is available server-side

Boundaries expressed the way riders actually describe them - south of one street, west of another, or a corner pinned to a named intersection - where the streets themselves are not straight. This needs the OSM street graph rather than raw geometry, so it belongs after Map Matching lands. It is the most natural to use and by far the most work to build.
