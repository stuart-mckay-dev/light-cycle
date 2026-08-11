/**
 * Mapbox setup and GeoJSON marshalling.
 *
 * The token is read once here so that a missing or malformed one produces a
 * single clear message in the UI, rather than an opaque 401 from deep inside
 * mapbox-gl on first tile request.
 */

import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import type { LngLat, PowerUp, TailPoint } from '@shared/types';

const RAW_TOKEN = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN as string | undefined;

export const MAPBOX_TOKEN = RAW_TOKEN?.trim() ?? '';

/**
 * A usable token is present. Anything starting `sk.` is a secret key and is
 * rejected outright — that key carries Map Matching access and must never reach
 * a browser bundle.
 */
export const hasMapboxToken =
  MAPBOX_TOKEN.length > 0 && MAPBOX_TOKEN.startsWith('pk.');

export function mapboxTokenProblem(): string | null {
  if (!MAPBOX_TOKEN) {
    return 'No Mapbox token. Copy client/.env.example to client/.env and set VITE_MAPBOX_PUBLIC_TOKEN.';
  }
  if (MAPBOX_TOKEN.startsWith('sk.')) {
    return 'That is a Mapbox SECRET key. Use a public token (pk.…) in the client — the sk key belongs on the server only.';
  }
  if (!MAPBOX_TOKEN.startsWith('pk.')) {
    return 'VITE_MAPBOX_PUBLIC_TOKEN does not look like a Mapbox public token (expected it to start with "pk.").';
  }
  return null;
}

export function tailToGeoJSON(points: readonly TailPoint[]): Feature<LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      // A single-point LineString is invalid GeoJSON; duplicate it so the source
      // stays renderable from the very first fix.
      coordinates:
        points.length === 1
          ? [[points[0]!.lng, points[0]!.lat], [points[0]!.lng, points[0]!.lat]]
          : points.map((p) => [p.lng, p.lat]),
    },
  };
}

export function powerUpsToGeoJSON(powerUps: readonly PowerUp[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: powerUps.map((pu) => ({
      type: 'Feature',
      properties: { id: pu.id, collected: pu.collected },
      geometry: { type: 'Point', coordinates: [pu.lng, pu.lat] },
    })),
  };
}

/**
 * Wraps a zone ring as a GeoJSON Polygon.
 *
 * The ring is stored open — the closing vertex is implied — but GeoJSON
 * requires it explicitly, so it is added here rather than duplicated in state.
 */
export function geofenceToGeoJSON(ring: readonly LngLat[] | null): Feature<Polygon> {
  const coordinates = ring && ring.length >= 3 ? [[...ring, ring[0]!]] : [];
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: coordinates as LngLat[][] },
  };
}

export function pointToGeoJSON(lng: number, lat: number): Feature<Point> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [lng, lat] },
  };
}

/** Converts `#RRGGBB` to an `rgba()` string — needed for gradient stops. */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
