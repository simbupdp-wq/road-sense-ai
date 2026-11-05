import { makeRouteCoordinates } from '../hotspotData.js';

export function makeDemoRouteSuggestion(locations) {
  const coordinates = makeRouteCoordinates(locations);
  return {
    label: 'Demo Route Suggestion',
    coordinates,
    locations: locations.map((location) => location.locationName || location.cameraId || 'Demo location'),
    available: coordinates.length >= 2,
    description: 'Illustrative connection between demo points. It is not navigation, route optimization, or a safety recommendation.',
  };
}
