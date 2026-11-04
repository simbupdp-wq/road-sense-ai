export const DEMO_HOTSPOTS = Object.freeze([
  Object.freeze({
    id: 'demo-location-a',
    cameraId: 'DEMO-CAM-A',
    locationName: 'Illustrative location A',
    latitude: 13.0827,
    longitude: 80.2707,
    confirmedEventCount: 2,
    reviewStatus: 'confirmed',
    source: 'demo',
  }),
  Object.freeze({
    id: 'demo-location-b',
    cameraId: 'DEMO-CAM-B',
    locationName: 'Illustrative location B',
    latitude: 13.0873,
    longitude: 80.2781,
    confirmedEventCount: 1,
    reviewStatus: 'confirmed',
    source: 'demo',
  }),
  Object.freeze({
    id: 'demo-location-c',
    cameraId: 'DEMO-CAM-C',
    locationName: 'Illustrative location C',
    latitude: 13.0916,
    longitude: 80.2668,
    confirmedEventCount: 3,
    reviewStatus: 'confirmed',
    source: 'demo',
  }),
]);

export function getDemoHotspots() {
  return DEMO_HOTSPOTS.map((location) => ({ ...location }));
}
