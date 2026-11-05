import { beforeEach, describe, expect, it, vi } from 'vitest';
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

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('RoadSense role routes', () => {
  it('provides separate public and authority prototype login pages', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Welcome to RoadSense' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: /authority portal/i }));
    expect(screen.getByRole('heading', { name: 'Authority Portal' })).toBeInTheDocument();
    expect(screen.getByText('Authorized personnel only')).toBeInTheDocument();
  });

  it('shows validation feedback and supports password visibility on login', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/valid email/i);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'person@example.org' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'temporary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
  });

  it('requires login on direct workspace routes and enforces the selected role', () => {
    window.history.replaceState({}, '', '/authority');
    const { rerender, unmount } = render(<App />);
    expect(screen.getByRole('heading', { name: 'Authority Portal' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'reviewer@example.org' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'prototype-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(screen.getByRole('heading', { name: 'Review traffic video' })).toBeInTheDocument();
    expect(screen.getByText(/authority · prototype/i)).toBeInTheDocument();

    window.history.pushState({}, '', '/public');
    fireEvent.popState(window);
    rerender(<App />);
    expect(screen.getByRole('heading', { name: 'Review traffic video' })).toBeInTheDocument();

    unmount();
    window.history.pushState({}, '', '/authority/events');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Review traffic video' })).toBeInTheDocument();
  });

  it('blocks an Authority user from Public routes and returns to login after logout', () => {
    window.history.replaceState({}, '', '/authority/login');
    render(<App />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'staff@example.org' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'prototype-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    window.history.pushState({}, '', '/public');
    fireEvent.popState(window);
    expect(screen.getByRole('heading', { name: 'Review traffic video' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /log out/i }));
    expect(screen.getByRole('heading', { name: 'Authority Portal' })).toBeInTheDocument();
  });

  it('prevents a Public session from opening Authority routes directly', () => {
    window.history.replaceState({}, '', '/public/login');
    render(<App />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'visitor@example.org' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'prototype-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    window.history.pushState({}, '', '/authority/events');
    fireEvent.popState(window);
    expect(screen.getByRole('heading', { name: 'Confirmed hotspots' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Review traffic video' })).not.toBeInTheDocument();
  });

  it('keeps demo locations explicitly labeled in the public workspace', () => {
    window.history.replaceState({}, '', '/public/login');
    render(<App />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'visitor@example.org' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'prototype-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(screen.getByRole('heading', { name: 'Confirmed hotspots' })).toBeInTheDocument();
    expect(screen.getByText(/confirmed road-safety hotspots will appear here after authority review/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show demo hotspots' }));
    expect(screen.getByText('DEMO DATA · NOT REAL INCIDENTS')).toBeInTheDocument();
    expect(screen.getAllByText('Demo Route Suggestion').length).toBeGreaterThanOrEqual(1);
  });
});
