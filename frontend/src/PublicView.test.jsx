import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PublicView from './PublicView.jsx';
import { getConfirmedHotspots } from './api.js';

vi.mock('./api.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getConfirmedHotspots: vi.fn() };
});

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="leaflet-map">{children}</div>,
  TileLayer: () => <div data-testid="osm-tiles" />,
  Marker: ({ children }) => <div data-testid="map-marker">{children}</div>,
  Popup: ({ children }) => <div>{children}</div>,
  Polyline: () => <div data-testid="demo-route-line" />,
  useMap: () => ({ invalidateSize: vi.fn(), getContainer: () => null }),
}));

describe('Public View', () => {
  it('starts with no public hotspots while the confirmed endpoint contract is pending', () => {
    render(<PublicView active />);
    expect(screen.getByText(/confirmed road-safety hotspots appear here after authority review/i)).toBeInTheDocument();
    expect(screen.queryByText(/DEMO DATA/)).not.toBeInTheDocument();
  });

  it('does not replace a missing API response with demo hotspots unless requested', async () => {
    getConfirmedHotspots.mockRejectedValueOnce(new Error('Hotspots contract pending.'));
    render(<PublicView active />);
    fireEvent.click(screen.getByRole('button', { name: 'Check hotspot service' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/contract pending/i);
    expect(screen.queryByText(/Illustrative location/)).not.toBeInTheDocument();
  });

  it('shows only locations normalized as confirmed by the hotspot adapter', async () => {
    getConfirmedHotspots.mockResolvedValueOnce([
      { id: 'approved', reviewStatus: 'confirmed', locationName: 'Reviewed junction', latitude: 13, longitude: 80 },
      { id: 'pending', reviewStatus: 'candidate', locationName: 'Unreviewed junction', latitude: 13.1, longitude: 80.1 },
    ]);
    render(<PublicView active />);
    fireEvent.click(screen.getByRole('button', { name: 'Check hotspot service' }));
    expect((await screen.findAllByText('Reviewed junction')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Unreviewed junction')).not.toBeInTheDocument();
  });

  it('shows confirmed sample locations and a route only behind the demo action', () => {
    render(<PublicView active />);
    fireEvent.click(screen.getByRole('button', { name: 'Show demo hotspots' }));
    expect(screen.getByText('DEMO COORDINATES · NOT VERIFIED LOCATIONS')).toBeInTheDocument();
    expect(screen.getAllByText('Demo Route Suggestion').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/not navigation, route optimization, or a safety recommendation/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Illustrative location/).length).toBeGreaterThan(0);
  });
});
