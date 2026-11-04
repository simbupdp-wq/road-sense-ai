export function getMapReadyLocations(locations) {
  if (!Array.isArray(locations)) return [];
  return locations.filter((location) => {
    const latitude = location?.latitude;
    const longitude = location?.longitude;
    return Number.isFinite(latitude) && Number.isFinite(longitude)
      && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  });
}

export function makeRouteCoordinates(locations) {
  const mapped = getMapReadyLocations(locations);
  if (mapped.length < 2) return [];
  return mapped.map(({ latitude, longitude }) => [latitude, longitude]);
}
