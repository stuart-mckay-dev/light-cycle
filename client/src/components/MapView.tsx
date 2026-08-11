/**
 * The map, and everything drawn on it.
 *
 * mapbox-gl is imperative and owns its own canvas, so React's job here is
 * narrow: create the map once, then push new data into GeoJSON sources as state
 * changes. Re-rendering never recreates the map — doing so mid-ride would blank
 * the screen and refetch every tile.
 */

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

import { GAME_CONFIG } from '@/config/gameConfig';
import {
  MAPBOX_TOKEN,
  geofenceToGeoJSON,
  hasMapboxToken,
  pointToGeoJSON,
  powerUpsToGeoJSON,
  tailToGeoJSON,
  withAlpha,
} from '@/services/mapbox';
import { polygonBounds } from '@/utils/geo';
import type { Geofence, LngLat, PlayerColor, PositionFix, PowerUp, TailPoint } from '@shared/types';

const SRC_TAIL = 'tail';
const SRC_POWERUPS = 'powerups';
const SRC_PLAYER = 'player';
const SRC_ZONE = 'zone';

interface MapViewProps {
  position: PositionFix | null;
  tail: TailPoint[];
  powerUps: PowerUp[];
  color: PlayerColor;
  follow: boolean;
  geofence: Geofence | null;
  /** Show draggable corner handles. Only true on the setup screen. */
  geofenceEditable: boolean;
  onGeofenceChange?: (ring: Geofence) => void;
}

export function MapView({
  position,
  tail,
  powerUps,
  color,
  follow,
  geofence,
  geofenceEditable,
  onGeofenceChange,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);

  // Corner handles are imperative Mapbox markers, so they live in refs. The
  // latest ring is mirrored into a ref too: a drag handler is created once but
  // must always emit against current state, not the ring captured at creation.
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const geofenceRef = useRef<Geofence | null>(geofence);
  geofenceRef.current = geofence;
  const onChangeRef = useRef(onGeofenceChange);
  onChangeRef.current = onGeofenceChange;
  const draggingRef = useRef(false);
  const fittedRef = useRef(false);

  // --- create the map once -------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || !hasMapboxToken || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: GAME_CONFIG.map.style,
      center: [GAME_CONFIG.map.fallbackCenter.lng, GAME_CONFIG.map.fallbackCenter.lat],
      zoom: 13,
      attributionControl: false,
      // Riding one-handed: no rotation or pitch gestures to fight with.
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
    });

    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');

    // `style.load`, not `load`. `load` additionally waits for the first render
    // to complete, and if that never happens — an offscreen or throttled tab, a
    // backgrounded PWA, a slow device — the basemap still draws but none of the
    // game layers are ever added, leaving a map with no tail, nodes, zone or
    // player on it. The style being parsed is the only precondition for adding
    // sources, so that is what we wait for.
    const addGameLayers = () => {
      if (map.getSource(SRC_TAIL)) return; // style reload: already added

      // `lineMetrics` is what makes the age gradient along the tail possible.
      map.addSource(SRC_TAIL, { type: 'geojson', lineMetrics: true, data: tailToGeoJSON([]) });
      map.addSource(SRC_POWERUPS, { type: 'geojson', data: powerUpsToGeoJSON([]) });
      map.addSource(SRC_PLAYER, { type: 'geojson', data: pointToGeoJSON(0, 0) });
      map.addSource(SRC_ZONE, { type: 'geojson', data: geofenceToGeoJSON(null) });

      // Zone sits at the bottom of the stack so the tail and nodes stay legible
      // on top of it.
      map.addLayer({
        id: 'zone-fill',
        type: 'fill',
        source: SRC_ZONE,
        paint: { 'fill-color': '#00E5FF', 'fill-opacity': 0.06 },
      });

      map.addLayer({
        id: 'zone-line',
        type: 'line',
        source: SRC_ZONE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#00E5FF',
          'line-width': 2.5,
          'line-opacity': 0.7,
          'line-dasharray': [2, 2],
        },
      });

      // Wide blurred pass under the core line — reads as neon bloom.
      map.addLayer({
        id: 'tail-glow',
        type: 'line',
        source: SRC_TAIL,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': color,
          'line-width': 18,
          'line-blur': 14,
          'line-opacity': 0.35,
        },
      });

      map.addLayer({
        id: 'tail-core',
        type: 'line',
        source: SRC_TAIL,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': 4,
          // Oldest end dim, newest end bright — you can see the TTL burning down.
          'line-gradient': [
            'interpolate',
            ['linear'],
            ['line-progress'],
            0,
            withAlpha(color, 0.15),
            0.35,
            withAlpha(color, 0.6),
            1,
            color,
          ],
        },
      });

      map.addLayer({
        id: 'powerup-glow',
        type: 'circle',
        source: SRC_POWERUPS,
        filter: ['!', ['get', 'collected']],
        paint: {
          'circle-radius': 18,
          'circle-color': '#FFE600',
          'circle-blur': 1,
          'circle-opacity': 0.4,
        },
      });

      map.addLayer({
        id: 'powerup-core',
        type: 'circle',
        source: SRC_POWERUPS,
        filter: ['!', ['get', 'collected']],
        paint: {
          'circle-radius': 6,
          'circle-color': '#FFE600',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#FFFFFF',
        },
      });

      // Collected pickups stay on the map, dimmed, as a record of the route.
      map.addLayer({
        id: 'powerup-spent',
        type: 'circle',
        source: SRC_POWERUPS,
        filter: ['get', 'collected'],
        paint: {
          'circle-radius': 4,
          'circle-color': '#3a4150',
          'circle-opacity': 0.8,
        },
      });

      map.addLayer({
        id: 'player-halo',
        type: 'circle',
        source: SRC_PLAYER,
        paint: {
          'circle-radius': 20,
          'circle-color': color,
          'circle-blur': 1,
          'circle-opacity': 0.35,
        },
      });

      map.addLayer({
        id: 'player-dot',
        type: 'circle',
        source: SRC_PLAYER,
        paint: {
          'circle-radius': 7,
          'circle-color': '#FFFFFF',
          'circle-stroke-width': 3,
          'circle-stroke-color': color,
        },
      });

      setReady(true);
    };

    // The style may already be parsed by the time this effect runs, in which
    // case the event has been and gone and waiting for it would hang forever.
    if (map.isStyleLoaded()) addGameLayers();
    else map.on('style.load', addGameLayers);

    // Surfaces style/tile/token failures, which otherwise fail silently and
    // leave a blank grey canvas with nothing in the console.
    map.on('error', (e) => console.error('[mapbox]', e.error?.message ?? e));

    mapRef.current = map;

    // If the container is resized while the map is still starting up — a phone
    // rotating, or the browser chrome settling on first paint — mapbox-gl can
    // hold a stale viewport and then never request a single tile, leaving a
    // blank canvas with no error anywhere. Observing the container ourselves
    // and calling resize() is the cheap insurance against that.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    // Also available in production behind `?debug`, because the failures worth
    // inspecting (blank map, no tiles) happen on a phone in the field where
    // attaching DevTools is not practical.
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
      (window as unknown as Record<string, unknown>).__map = map;
    }

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // Colour is captured at creation and updated by the effect below; it must
    // not be a dependency or changing it would tear the whole map down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- push state into sources --------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource(SRC_TAIL) as mapboxgl.GeoJSONSource | undefined)?.setData(tailToGeoJSON(tail));
  }, [tail, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource(SRC_POWERUPS) as mapboxgl.GeoJSONSource | undefined)?.setData(
      powerUpsToGeoJSON(powerUps),
    );
  }, [powerUps, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !position) return;
    (map.getSource(SRC_PLAYER) as mapboxgl.GeoJSONSource | undefined)?.setData(
      pointToGeoJSON(position.lng, position.lat),
    );
  }, [position, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource(SRC_ZONE) as mapboxgl.GeoJSONSource | undefined)?.setData(
      geofenceToGeoJSON(geofence),
    );
  }, [geofence, ready]);

  // --- draggable corner handles -------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (!geofenceEditable || !geofence) {
      fittedRef.current = false;
      return;
    }

    const emit = (index: number, lngLat: mapboxgl.LngLat) => {
      const current = geofenceRef.current;
      if (!current) return;
      const next = current.map((corner, i) =>
        i === index ? ([lngLat.lng, lngLat.lat] as LngLat) : corner,
      );
      onChangeRef.current?.(next);
    };

    geofence.forEach((corner, index) => {
      const el = document.createElement('div');
      el.className = 'zone-handle';
      el.setAttribute('aria-label', `Zone corner ${index + 1}`);

      const marker = new mapboxgl.Marker({ element: el, draggable: true })
        .setLngLat(corner)
        .addTo(map);

      marker.on('dragstart', () => {
        draggingRef.current = true;
        el.classList.add('zone-handle--active');
      });
      marker.on('drag', () => emit(index, marker.getLngLat()));
      marker.on('dragend', () => {
        draggingRef.current = false;
        el.classList.remove('zone-handle--active');
        emit(index, marker.getLngLat());
      });

      markersRef.current.push(marker);
    });

    // Frame the whole zone once when editing opens, so the rider can see what
    // they are dragging instead of a corner off-screen.
    if (!fittedRef.current) {
      const [minLng, minLat, maxLng, maxLat] = polygonBounds(geofence);
      // The setup sheet covers the lower half of the screen, so the zone has to
      // be framed into the strip above it or the bottom corners sit under the
      // panel and cannot be grabbed.
      const height = map.getContainer().clientHeight;
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        {
          padding: {
            top: 100,
            bottom: Math.min(Math.round(height * 0.58), height - 200),
            left: 56,
            right: 56,
          },
          duration: 700,
        },
      );
      fittedRef.current = true;
    }

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
    // Recreated only when editing toggles or the corner count changes — the
    // handlers read live state through refs, so ring edits must not re-run this
    // or a drag would tear down the marker being dragged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geofenceEditable, ready, geofence?.length]);

  // Keep handles in step with rings changed from outside (the Reset button),
  // but never fight the marker the rider is currently holding.
  useEffect(() => {
    if (!geofence || draggingRef.current) return;
    markersRef.current.forEach((marker, i) => {
      const corner = geofence[i];
      if (!corner) return;
      const at = marker.getLngLat();
      if (Math.abs(at.lng - corner[0]) > 1e-9 || Math.abs(at.lat - corner[1]) > 1e-9) {
        marker.setLngLat(corner);
      }
    });
  }, [geofence]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setPaintProperty('tail-glow', 'line-color', color);
    map.setPaintProperty('tail-core', 'line-gradient', [
      'interpolate',
      ['linear'],
      ['line-progress'],
      0,
      withAlpha(color, 0.15),
      0.35,
      withAlpha(color, 0.6),
      1,
      color,
    ]);
    map.setPaintProperty('player-halo', 'circle-color', color);
    map.setPaintProperty('player-dot', 'circle-stroke-color', color);
  }, [color, ready]);

  // --- camera --------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !position || !follow) return;

    map.easeTo({
      center: [position.lng, position.lat],
      zoom: Math.max(map.getZoom(), GAME_CONFIG.map.followZoom),
      duration: 900,
      essential: true,
    });
  }, [position, follow, ready]);

  if (!hasMapboxToken) {
    // The game logic runs fine without tiles — only the backdrop is missing.
    return <div className="map map--tokenless" aria-hidden="true" />;
  }

  // `data-map-ready` is deliberately shipped in production: a blank map with no
  // console error is otherwise impossible to triage on a phone at the roadside.
  return <div ref={containerRef} className="map" data-map-ready={ready} />;
}
