import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import App from './App.jsx';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="leaflet-map">{children}</div>,
  TileLayer: () => <div data-testid="osm-tiles" />,
  Marker: ({ children }) => <div data-testid="map-marker">{children}</div>,
  Popup: ({ children }) => <div>{children}</div>,
  Polyline: () => <div data-testid="demo-route-line" />,
  useMap: () => ({ invalidateSize: vi.fn(), getContainer: () => null }),
}));

describe('RoadSense role views', () => {
  it('starts in Authority View and switches to the Public View without adding more primary views', () => {
    render(<App />);

    expect(screen.getByRole('link', { name: 'RoadSense home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Authority View' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Public View' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/RoadWatch AI/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Public View' }));
    expect(screen.getByRole('heading', { name: 'Confirmed hotspots' })).toBeInTheDocument();
    expect(screen.getByText('Hotspots API integration is pending.')).toBeInTheDocument();
  });

  it('labels local hotspot samples and the route as demo-only', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Public View' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show demo hotspots' }));

    expect(screen.getByText('DEMO DATA · NOT REAL INCIDENTS')).toBeInTheDocument();
    expect(screen.getAllByText('Demo Route Suggestion').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/not navigation|not a navigation/i).length).toBeGreaterThanOrEqual(1);
  });
});
