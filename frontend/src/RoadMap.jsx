import React, { useEffect } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import { getMapReadyLocations } from './hotspotData.js';

const roadSenseMarker = L.divIcon({
  className: 'roadsense-marker-icon',
  html: '<span aria-hidden="true"></span>',
  iconSize: [24, 32],
  iconAnchor: [12, 29],
  popupAnchor: [0, -26],
});

function MapResizeObserver({ active }) {
  const map = useMap();

  useEffect(() => {
    if (!active) return undefined;
    const frame = window.requestAnimationFrame(() => map.invalidateSize({ animate: false }));
    const container = map.getContainer();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    observer?.observe(container);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [active, map]);

  return null;
}

function validRoute(coordinates) {
  return Array.isArray(coordinates) && coordinates.length >= 2
    && coordinates.every((point) => Array.isArray(point) && point.length === 2
      && Number.isFinite(point[0]) && Number.isFinite(point[1])
      && point[0] >= -90 && point[0] <= 90 && point[1] >= -180 && point[1] <= 180);
}

export default function RoadMap({ locations = [], routeCoordinates = [], routeLabel = '', active = true, onSelect }) {
  const mapped = getMapReadyLocations(locations);
  if (!mapped.length) {
    return <div className="map-empty" role="status">
      <span className="map-empty-icon" aria-hidden="true">⌖</span>
      <strong>No map-ready location coordinates are available.</strong>
      <span>Use the location list or wait for valid coordinates from the hotspot service.</span>
    </div>;
  }

  const center = [
    mapped.reduce((sum, item) => sum + item.latitude, 0) / mapped.length,
    mapped.reduce((sum, item) => sum + item.longitude, 0) / mapped.length,
  ];
  const routeIsValid = validRoute(routeCoordinates);

  return <div className="roadsense-map" role="region" aria-label="OpenStreetMap with confirmed hotspot locations">
    <MapContainer center={center} zoom={mapped.length === 1 ? 14 : 12} scrollWheelZoom={false}
      style={{ width: '100%', height: '100%' }}>
      <MapResizeObserver active={active} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {mapped.map((location) => <Marker
        key={location.id}
        position={[location.latitude, location.longitude]}
        icon={roadSenseMarker}
        eventHandlers={{ click: () => onSelect?.(location) }}
      >
        <Popup>
          <div className="map-popup">
            <strong>{location.locationName || 'Confirmed location'}</strong>
            {location.cameraId && <span>Camera {location.cameraId}</span>}
            {Number.isFinite(location.confirmedEventCount) && <span>{location.confirmedEventCount} confirmed events</span>}
            {location.source === 'demo' && <em>Demo data only</em>}
          </div>
        </Popup>
      </Marker>)}
      {routeIsValid && <Polyline positions={routeCoordinates} pathOptions={{ color: '#c87b25', weight: 4, dashArray: '8 7' }} />}
    </MapContainer>
    <span className="map-route-label">{routeIsValid ? routeLabel : 'OpenStreetMap'}</span>
  </div>;
}
