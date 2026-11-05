import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import App from './App.jsx';

vi.mock('./api.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loginUser: vi.fn(async ({ email, role }) => ({
      access_token: `${role}-access-token`,
      refresh_token: `${role}-refresh-token`,
      expires_in: 3600,
      user: { user_id: `${role}-user`, name: email.split('@')[0], email, role },
    })),
    getCurrentUser: vi.fn(async (token) => {
      const role = token.startsWith('authority-') ? 'authority' : 'public';
      return { user: { user_id: `${role}-user`, name: `${role} user`, email: `${role}@example.org`, role } };
    }),
    logoutUser: vi.fn().mockResolvedValue({ ok: true }),
    getConfirmedHotspots: vi.fn().mockResolvedValue([]),
  };
});

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

  it('requires login on direct workspace routes and enforces the selected role', async () => {
    window.history.replaceState({}, '', '/authority');
    const { rerender, unmount } = render(<App />);
    expect(screen.getByRole('heading', { name: 'Authority Portal' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'reviewer@example.org' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'prototype-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('heading', { name: 'Review traffic video' })).toBeInTheDocument();
    expect(screen.getByText('Authority account')).toBeInTheDocument();

    window.history.pushState({}, '', '/public');
    fireEvent.popState(window);
    rerender(<App />);
    expect(screen.getByRole('heading', { name: 'Review traffic video' })).toBeInTheDocument();

    unmount();
    window.history.pushState({}, '', '/authority/events');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Review traffic video' })).toBeInTheDocument();
  });

  it('blocks an Authority user from Public routes and returns to login after logout', async () => {
    window.history.replaceState({}, '', '/authority/login');
    render(<App />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'staff@example.org' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'prototype-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('heading', { name: 'Review traffic video' })).toBeInTheDocument();
    window.history.pushState({}, '', '/public');
    fireEvent.popState(window);
    expect(screen.getByRole('heading', { name: 'Review traffic video' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /log out/i }));
    expect(screen.getByRole('heading', { name: 'Authority Portal' })).toBeInTheDocument();
  });

  it('prevents a Public session from opening Authority routes directly', async () => {
    window.history.replaceState({}, '', '/public/login');
    render(<App />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'visitor@example.org' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'prototype-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('heading', { name: 'Confirmed hotspots' })).toBeInTheDocument();
    window.history.pushState({}, '', '/authority/events');
    fireEvent.popState(window);
    expect(screen.getByRole('heading', { name: 'Confirmed hotspots' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Review traffic video' })).not.toBeInTheDocument();
  });

  it('keeps demo locations explicitly labeled in the public workspace', async () => {
    window.history.replaceState({}, '', '/public/login');
    render(<App />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'visitor@example.org' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'prototype-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('heading', { name: 'Confirmed hotspots' })).toBeInTheDocument();
    expect(screen.getByText(/confirmed road-safety hotspots appear here after authority review/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show demo hotspots' }));
    expect(screen.getByText('DEMO COORDINATES · NOT VERIFIED LOCATIONS')).toBeInTheDocument();
    expect(screen.getAllByText('Demo Route Suggestion').length).toBeGreaterThanOrEqual(1);
  });
});
