import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import RoadMap from './RoadMap.jsx';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="leaflet-map">{children}</div>,
  TileLayer: ({ attribution }) => <div data-testid="osm-tiles" data-attribution={attribution} />,
  Marker: ({ position, children }) => <div data-testid="map-marker" data-position={position.join(',')}>{children}</div>,
  Popup: ({ children }) => <div>{children}</div>,
  Polyline: ({ positions }) => <div data-testid="demo-route-line" data-points={positions.length} />,
  useMap: () => ({ invalidateSize: vi.fn(), getContainer: () => null }),
}));

describe('RoadSense reusable hotspot map', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows an honest coordinate fallback when no valid markers exist', () => {
    render(<RoadMap locations={[{ id: 'missing', latitude: null, longitude: null }]} />);
    expect(screen.getByText('No map-ready location coordinates are available.')).toBeInTheDocument();
    expect(screen.queryByTestId('leaflet-map')).not.toBeInTheDocument();
  });

  it('renders valid markers, OpenStreetMap attribution, and an optional demo route', () => {
    render(<RoadMap
      locations={[{ id: 'one', locationName: 'Demo A', latitude: 13, longitude: 80 }]}
      routeCoordinates={[[13, 80], [13.1, 80.1]]}
      routeLabel="Demo route only"
    />);
    expect(screen.getByTestId('map-marker')).toHaveAttribute('data-position', '13,80');
    expect(screen.getByTestId('osm-tiles').getAttribute('data-attribution')).toMatch(/OpenStreetMap/);
    expect(screen.getByTestId('demo-route-line')).toHaveAttribute('data-points', '2');
  });
});
