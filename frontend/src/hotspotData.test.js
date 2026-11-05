import { describe, expect, it } from 'vitest';
import { getMapReadyLocations, makeRouteCoordinates } from './hotspotData.js';

describe('public hotspot map data', () => {
  it('uses only finite coordinates inside latitude and longitude bounds', () => {
    const locations = [
      { id: 'valid', latitude: 13.08, longitude: 80.27 },
      { id: 'missing', latitude: null, longitude: 80.28 },
      { id: 'outside', latitude: 100, longitude: 181 },
      { id: 'text', latitude: '13.08', longitude: '80.27' },
    ];
    expect(getMapReadyLocations(locations).map((item) => item.id)).toEqual(['valid']);
    expect(locations).toHaveLength(4);
  });

  it('creates a simple display path only when at least two valid locations exist', () => {
    expect(makeRouteCoordinates([{ latitude: 13, longitude: 80 }])).toEqual([]);
    expect(makeRouteCoordinates([
      { latitude: 13, longitude: 80 },
      { latitude: 14, longitude: 81 },
    ])).toEqual([[13, 80], [14, 81]]);
  });
});
