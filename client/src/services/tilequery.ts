/**
 * Snapping arbitrary coordinates onto the rideable street graph.
 *
 * Power-ups are scattered geometrically, which on its own drops them in the
 * Willamette, on rooftops and in the middle of blocks. This module pulls each
 * candidate onto something a bike or a pedestrian can actually reach, using the
 * Mapbox Tilequery API against the same OSM-derived `mapbox-streets-v8` tileset
 * that renders the map.
 *
 * Tilequery is used rather than the Map Matching API because it works with the
 * **public** token we already ship. Map Matching needs the secret key, which
 * must never reach the browser — that integration belongs on the server at
 * Goalpost 3.
 *
 * For a LineString feature the API returns a Point at the position on that line
 * closest to the queried coordinate, which is precisely the snap we want.
 */

import { haversineMeters, type LatLngLike } from '@/utils/geo';
import { GAME_CONFIG } from '@/config/gameConfig';
import { MAPBOX_TOKEN, hasMapboxToken } from './mapbox';

const TILESET = 'mapbox.mapbox-streets-v8';
const ENDPOINT = `https://api.mapbox.com/v4/${TILESET}/tilequery`;

export interface SnappedPoint {
  lng: number;
  lat: number;
  /** `road` layer class the point landed on — street, path, service, … */
  roadClass: string;
  /** How far the candidate moved to reach the graph, in metres. */
  snapDistanceMeters: number;
}

interface TilequeryFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    class?: string;
    type?: string;
    structure?: string;
    tilequery?: { distance?: number };
  };
}

/**
 * Is this feature somewhere a rider could legitimately be?
 *
 * The allowlist covers ordinary streets, dedicated paths and trails, and
 * `service` roads — which is how OSM tags alley cut-throughs and parking-lot
 * aisles, both explicitly wanted. Motorways, trunk roads, rail, ferries and
 * aerialways are excluded by omission.
 */
function isRideable(feature: TilequeryFeature): boolean {
  const { class: roadClass, type, structure } = feature.properties;

  if (!roadClass) return false;
  if (!GAME_CONFIG.powerUps.rideableRoadClasses.includes(roadClass)) return false;

  // Stairs, private driveways and the like are on rideable-class roads but are
  // not somewhere to send a rider.
  if (type && GAME_CONFIG.powerUps.excludedRoadTypes.includes(type)) return false;

  // Tunnels are unreachable for GPS — a node in one could never be collected.
  if (structure === 'tunnel') return false;

  return true;
}

/**
 * Finds the nearest rideable point to `candidate`, or null if there is nothing
 * within `radiusMeters` (open water, industrial interiors, deep parkland).
 */
export async function snapToRideable(
  candidate: LatLngLike,
  radiusMeters: number,
  signal?: AbortSignal,
): Promise<SnappedPoint | null> {
  if (!hasMapboxToken) return null;

  const url =
    `${ENDPOINT}/${candidate.lng},${candidate.lat}.json` +
    `?radius=${Math.round(radiusMeters)}` +
    `&limit=50&dedupe=true&geometry=linestring&layers=road` +
    `&access_token=${MAPBOX_TOKEN}`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Tilequery failed: ${res.status}`);

  const body = (await res.json()) as { features?: TilequeryFeature[] };
  const features = (body.features ?? []).filter(isRideable);
  if (features.length === 0) return null;

  // The API sorts by distance, but filtering can leave the list out of order
  // relative to what we kept, so pick the minimum explicitly.
  let best: TilequeryFeature | null = null;
  let bestDistance = Infinity;

  for (const feature of features) {
    const distance = feature.properties.tilequery?.distance ?? Infinity;
    if (distance < bestDistance) {
      best = feature;
      bestDistance = distance;
    }
  }

  if (!best) return null;

  const [lng, lat] = best.geometry.coordinates;

  return {
    lng,
    lat,
    roadClass: best.properties.class ?? 'unknown',
    // Prefer our own measurement — the API's figure is computed in tile space.
    snapDistanceMeters: haversineMeters(candidate, { lng, lat }),
  };
}
