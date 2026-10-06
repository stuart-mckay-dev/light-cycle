# Light Cycle — Data Schema Reference

*MVP — Version 1.0 · February 2026*

**Status as of 10 August 2026: none of this schema is implemented yet.**

Goalpost 1 is client-side only - there is no server and no database. **Changed 6 October 2026:** the tail is limited by length, not time. It starts at 500 m and each power-up adds 150 m; once longer than that budget it is trimmed from the oldest end (see mvp-scope.md, Implementation Note 4). The tail_entries model below has been updated to match: the server trims by length rather than relying on a TTL index to expire segments. The colour palette at the end of this document IS implemented, in client/src/utils/palette.ts.

## Overview

The MVP uses a single MongoDB database with three collections. All collections use MongoDB's native \_id field as the primary identifier. Tail length is enforced by the server, which trims each player's oldest entries when their tail exceeds their length budget. TTL indexes are used only for housekeeping (finished lobbies and stale sessions), not as a game mechanic.

Collections: lobbies, tail_entries, player_sessions

## Collection: lobbies

One document per active game lobby. Created when a host starts a new lobby. TTL-expired after game over.

| Field | Type | Required | Notes |
|----------------|-----------------|--------------|----------------------------------------------------------------------------|
| \_id           | ObjectId        | Auto         | MongoDB default primary key                                                |
| inviteCode     | String          | Yes          | Short alphanumeric code shared with players (e.g. XKZP4). Indexed unique.  |
| hostUUID       | String          | Yes          | UUID of the player who created the lobby                                   |
| status         | String          | Yes          | Enum: waiting \| countdown \| active \| game_over                          |
| playZone       | GeoJSON Polygon | Yes          | Geofenced boundary set by host before game start                           |
| tailStartLengthMeters | Number   | Yes          | Starting tail length budget in metres (default 500).                       |
| tailLengthPerPickupMeters | Number | Yes        | Metres added to a player's budget per power-up (default 150).              |
| players        | Array           | Yes          | Array of player session objects (see sub-schema below)                     |
| createdAt      | Date            | Auto         | Lobby creation timestamp. TTL index: expires document 1hr after game_over. |
| gameStartedAt  | Date            | No           | Set when status transitions to active                                      |
| gameEndedAt    | Date            | No           | Set when status transitions to game_over                                   |

## players\[\] sub-schema

| Field | Type | Required | Notes |
|--------------|----------|--------------|-------------------------------------------|
| uuid         | String   | Yes          | Client-generated UUID from sessionStorage |
| nickname     | String   | Yes          | Display name chosen at session creation   |
| color        | String   | Yes          | Hex color code from predefined palette    |
| status       | String   | Yes          | Enum: active \| eliminated                |
| eliminatedAt | Date     | No           | Timestamp of elimination event            |
| tailMaxLengthMeters | Number | Yes     | Current length budget. Starts at the lobby's tailStartLengthMeters; each pickup adds tailLengthPerPickupMeters. |

## Collection: tail_entries

One document per recorded path segment per player. High-volume collection — every GPS position update creates one or more entries.

Tail length is enforced on write: after inserting a player's new entries, the server sums lengthMeters for that player newest-first and deletes (or shortens) the oldest entries beyond the player's tailMaxLengthMeters. The lobbyId + playerUUID + timestamp index makes that a bounded, ordered scan. Entries for a finished lobby are deleted with the lobby.

| Field | Type | Required | Notes |
|-------------------|-----------------|--------------|---------------------------------------------------------------------------------------------------------------------|
| \_id              | ObjectId        | Auto         | MongoDB default primary key                                                                                         |
| lobbyId           | ObjectId        | Yes          | Reference to parent lobby. Indexed for query performance.                                                           |
| playerUUID        | String          | Yes          | Owner of this tail segment. Indexed.                                                                                |
| type              | String          | Yes          | Enum: segment (map-matched) \| gps (off-graph fallback)                                                             |
| segmentId         | String          | Conditional  | Mapbox OSM segment ID. Required when type = segment. Null for GPS entries.                                          |
| intersectionNodes | Array\[String\] | Conditional  | Array of intersection node IDs at each end of the segment. Used for collision lookup. Required when type = segment. |
| gpsStart          | GeoJSON Point   | Conditional  | Start coordinate. Required when type = gps. Null for segment entries.                                               |
| gpsEnd            | GeoJSON Point   | Conditional  | End coordinate. Required when type = gps. Null for segment entries.                                                 |
| confidence        | Number          | No           | Mapbox map matching confidence score (0–1). Stored for debugging and threshold tuning.                              |
| timestamp         | Date            | Yes          | Time segment was recorded.                                                                                          |
| lengthMeters      | Number          | Yes          | Ground length of this entry. Summed newest-first to enforce the player's length budget.                            |

## Collection: player_sessions

Lightweight ephemeral session record created when a player first connects. Enables reconnection within the same browser session if a page refresh occurs during an active game.

| Field | Type | Required | Notes |
|----------------|----------|--------------|--------------------------------------------------------------------|
| \_id           | ObjectId | Auto         | MongoDB default primary key                                        |
| uuid           | String   | Yes          | Matches UUID in sessionStorage on client. Indexed unique.          |
| nickname       | String   | Yes          | Player display name                                                |
| color          | String   | Yes          | Hex color from predefined palette                                  |
| currentLobbyId | ObjectId | No           | Reference to active lobby if player is in one. Null otherwise.     |
| createdAt      | Date     | Auto         | TTL index: expires document 24 hours after creation.               |
| lastSeenAt     | Date     | Auto         | Updated on each WebSocket connection. Used for reconnection logic. |

## Indexes

| Collection | Field | Type | Purpose |
|-----------------|----------------------|--------------|------------------------------------------------|
| lobbies         | inviteCode           | Unique       | Fast lookup by invite code on join             |
| lobbies         | createdAt            | TTL (3600s)  | Auto-expire lobby documents after game ends    |
| tail_entries    | lobbyId + playerUUID + timestamp | Compound | Per-player tail query, and newest-first scan for length trimming |
| tail_entries    | intersectionNodes    | Array        | Intersection-based collision lookup            |
| player_sessions | uuid                 | Unique       | Fast reconnection lookup                       |
| player_sessions | createdAt            | TTL (86400s) | Auto-expire session documents after 24h        |

## Color Palette

Colors are predefined to ensure high contrast on map backgrounds and basic colorblind accessibility. Each color is claimed by a player on lobby join and released on disconnect. Duplicate colors within a lobby are not permitted.

| Name | Hex | Accessibility Note |
|----------|----------|--------------------------------------------------------------------------------------|
| Cyan     | \#00E5FF | High contrast on dark map. Distinct for deuteranopia and protanopia.                 |
| Yellow   | \#FFE600 | High luminance. Visible to all common colorblind types.                              |
| Magenta  | \#FF00FF | Distinct from cyan and yellow. Avoid pairing with red for deuteranopes.              |
| Orange   | \#FF6D00 | Distinguishable from yellow by hue shift. High contrast on dark backgrounds.         |
| Lime     | \#AEEA00 | Distinct from cyan. May be confused with yellow by tritanopes — acceptable tradeoff. |
| White    | \#FFFFFF | Maximum contrast on dark map. Reserved as fallback/host indicator.                   |
