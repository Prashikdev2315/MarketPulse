'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { COUNTRIES, CountryConfig } from '@/lib/countryConfig';

// Keep a module-level ref that always points to the latest onCountrySelect.
// This is the standard pattern to escape stale closure in useEffect([], []).
let _latestOnCountrySelect: ((c: CountryConfig) => void) | null = null;

// Fix Leaflet's broken default icon paths in Next.js / webpack
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Neutral style applied to all available (but not selected) countries
const AVAILABLE_STYLE: L.PathOptions = {
  fillColor:   '#2A3547',
  fillOpacity: 0.42,
  color:       '#3A4D63',
  weight:      1,
  opacity:     0.6,
};
const AVAILABLE_HOVER_STYLE: L.PathOptions = {
  fillColor:   '#2A3547',
  fillOpacity: 0.65,
  weight:      1.5,
  opacity:     0.85,
};
const SELECTED_STYLE: L.PathOptions = {
  fillColor:   '#3B9EFF',
  fillOpacity: 0.38,
  color:       '#3B9EFF',
  weight:      1.5,
  opacity:     0.9,
};

interface Props {
  onCountrySelect: (country: CountryConfig) => void;
  selectedCountry: CountryConfig | null;
}

export default function WorldMap({ onCountrySelect, selectedCountry }: Props) {
  const mapRef          = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  // Store each available country's Leaflet layer by country key (e.g. "India")
  const layersRef       = useRef<Record<string, L.Layer>>({});

  // Always keep the module-level ref in sync with the latest prop so
  // GeoJSON click handlers (bound once on mount) can call the current version.
  _latestOnCountrySelect = onCountrySelect;

  useEffect(() => {
    // Defer map init to the next animation frame so the container div has
    // real pixel dimensions. Without this, Leaflet crashes in Next.js with
    // "Cannot read properties of undefined (reading 'appendChild')" because
    // the element hasn't been painted yet when useEffect first fires.
    const rafId = requestAnimationFrame(() => {
      if (!mapContainerRef.current || mapRef.current) return;

      const map = L.map(mapContainerRef.current, {
        center: [20, 10],
        zoom: 2,
        minZoom: 2,
        maxZoom: 6,
        zoomControl: true,
        attributionControl: false,
      });

      L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        { maxZoom: 19 }
      ).addTo(map);

      mapRef.current = map;

      fetch('https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson')
        .then(r => r.json())
        .then((worldData) => {
          L.geoJSON(worldData as GeoJSON.GeoJsonObject, {
            style: (feature) => {
              const countryName =
                feature?.properties?.admin ||
                feature?.properties?.name ||
                '';
              const config = COUNTRIES[countryName];
              if (config?.available) {
                // All available countries start with the same neutral fill.
                // The selected-country highlight is applied separately in the
                // second useEffect below, so we always start neutral here.
                return { ...AVAILABLE_STYLE };
              }
              // Non-interactive countries: very dark, minimal stroke
              return {
                fillColor:   '#161E2B',
                fillOpacity: 0.55,
                color:       '#1E2B3C',
                weight:      0.4,
                opacity:     0.3,
              };
            },
            onEachFeature: (feature, layer) => {
              const countryName =
                feature?.properties?.admin ||
                feature?.properties?.name ||
                '';
              const config = COUNTRIES[countryName];

              if (config?.available) {
                // Store the layer so we can re-style it on selection change
                layersRef.current[countryName] = layer;

                layer.on({
                  mouseover: (e: L.LeafletEvent) => {
                    const target = e.target as L.Path;
                    // Don't override the selected style on hover
                    const isSelected = Object.keys(COUNTRIES).find(
                      k => COUNTRIES[k].code === selectedCountry?.code
                    ) === countryName;
                    if (!isSelected) {
                      target.setStyle(AVAILABLE_HOVER_STYLE);
                      target.bringToFront();
                    }
                  },
                  mouseout: (e: L.LeafletEvent) => {
                    const target = e.target as L.Path;
                    const isSelected = Object.keys(COUNTRIES).find(
                      k => COUNTRIES[k].code === selectedCountry?.code
                    ) === countryName;
                    if (!isSelected) {
                      target.setStyle(AVAILABLE_STYLE);
                    }
                  },
                  click: () => {
                    // Use the module-level ref so we always call the
                    // CURRENT onCountrySelect, not the stale mount-time version.
                    _latestOnCountrySelect?.(config);
                    map.flyTo(config.center, config.zoom, { duration: 0.8, easeLinearity: 0.25 });
                  },
                });

                // Tooltip uses the country's color only for the name text
                layer.bindTooltip(
                  `<div style="background:rgba(26,32,48,0.97);border:1px solid rgba(59,158,255,0.2);border-radius:10px;padding:10px 14px;backdrop-filter:blur(12px);">
                    <div style="color:${config.color};font-weight:700;font-size:13px;">${config.flag} ${config.name}</div>
                    <div style="color:#7A8BA6;font-size:11px;margin-top:4px;">${config.indices.length} indices tracked</div>
                    <div style="color:#3B9EFF;font-size:10px;margin-top:2px;">Click to explore →</div>
                  </div>`,
                  { permanent: false, sticky: true, opacity: 1, className: 'custom-tv-tooltip' }
                );
              }
            },
          }).addTo(map);
        })
        .catch(err => console.error('[WorldMap] Failed to load GeoJSON:', err));
    });

    return () => {
      cancelAnimationFrame(rafId);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-style layers when selectedCountry changes:
  // reset previous selection to neutral, apply accent to new selection.
  useEffect(() => {
    if (!mapRef.current) return;

    // Reset all available countries to neutral
    Object.keys(COUNTRIES).forEach(countryName => {
      const layer = layersRef.current[countryName];
      if (layer) {
        (layer as L.Path).setStyle(AVAILABLE_STYLE);
      }
    });

    // Apply accent style to the newly selected country
    if (selectedCountry) {
      const selectedName = Object.keys(COUNTRIES).find(
        k => COUNTRIES[k].code === selectedCountry.code
      );
      if (selectedName) {
        const layer = layersRef.current[selectedName];
        if (layer) {
          (layer as L.Path).setStyle(SELECTED_STYLE);
          (layer as L.Path).bringToFront();
        }
      }

      mapRef.current.flyTo(selectedCountry.center, selectedCountry.zoom, {
        duration: 0.8,
      });
    }
  }, [selectedCountry]);

  return (
    <div
      ref={mapContainerRef}
      style={{ height: '100%', width: '100%', background: '#0B0F17' }}
    />
  );
}
