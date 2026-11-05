import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('RoadSense API service', () => {
  it('uploads a video only as multipart field `file` and validates the queued response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ analysis_id: 'run-123', status: 'queued' }),
    }));
    const file = new File(['clip'], 'road.mp4', { type: 'video/mp4' });

    await expect(api.analyzeVideo({ file, token: 'authority-token' }))
      .resolves.toEqual({ analysis_id: 'run-123', status: 'queued' });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/analyze');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer authority-token');
    expect(options.body.get('file')).toBe(file);
    expect([...options.body.keys()]).toEqual(['file']);
  });

  it('sends optional location details without a camera ID or device selector', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ analysis_id: 'run-2', status: 'queued' }),
    }));
    await api.analyzeVideo({
      file: new File(['clip'], 'road.mp4'),
      token: 'authority-token',
      cameraLocation: { locationName: 'Main crossing', latitude: 13, longitude: 80, source: 'camera' },
    });
    const [, options] = fetch.mock.calls[0];
    expect([...options.body.keys()]).toEqual(['file', 'location_name', 'latitude', 'longitude', 'location_source']);
    expect(options.body.has('camera_id')).toBe(false);
    expect(options.body.has('device')).toBe(false);
  });

  it('rejects invalid upload responses and incomplete optional location', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ analysis_id: ' ', status: 'queued' }) }));
    await expect(api.analyzeVideo({ file: new File(['x'], 'clip.mp4'), token: 't' })).rejects.toThrow(/analysis_id/i);
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ analysis_id: 'run-1', status: 'running' }) });
    await expect(api.analyzeVideo({ file: new File(['x'], 'clip.mp4'), token: 't' })).rejects.toThrow(/status/i);
    await expect(api.analyzeVideo({
      file: new File(['x'], 'clip.mp4'), token: 't', cameraLocation: { locationName: 'Only name' },
    })).rejects.toThrow(/location details/i);
  });

  it('polls the documented status endpoint and validates terminal states', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      analysis_id: 'run/123', status: 'completed', result: { metadata: { fps: 25 } },
    }) }));
    await expect(api.getAnalysisStatus('run/123', { token: 'authority-token' }))
      .resolves.toMatchObject({ status: 'completed', result: { metadata: { fps: 25 } } });
    expect(fetch.mock.calls[0][0]).toBe('/api/analyses/run%2F123');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer authority-token');

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'almost_done' }) });
    await expect(api.getAnalysisStatus('run-123', { token: 'authority-token' }))
      .rejects.toThrow(/unsupported analysis status/i);
  });

  it('reads and validates the events response wrapper', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      analysis_id: 'run-123', events_available: true, events: [{ event_id: 'evt-1' }], message: null,
    }) }));
    await expect(api.getCandidateEvents('run-123', { token: 'authority-token' })).resolves.toEqual({
      analysis_id: 'run-123', events_available: true, events: [{ event_id: 'evt-1' }], message: null,
    });
    expect(fetch.mock.calls[0][0]).toBe('/api/analyses/run-123/events');
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ events_available: false, events: null, message: 'Unavailable' }) });
    await expect(api.getCandidateEvents('run-123', { token: 'authority-token' })).rejects.toThrow(/include an events array/i);
  });

  it('resolves authenticated video URLs and calls the implemented review and hotspot endpoints', async () => {
    expect(api.getAnnotatedVideoUrl({ result: { annotated_video_url: '/api/analyses/run-1/video' } }))
      .toBe(`${window.location.origin}/api/analyses/run-1/video`);
    expect(api.getAnnotatedVideoUrl({ annotated_video_url: '/wrong-location.mp4' })).toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ event: { review_status: 'confirmed' } }) }));
    await api.sendReviewDecision({
      analysisId: 'run-1', eventId: 'evt-1', decision: 'confirmed', note: 'Reviewed', token: 'authority-token',
    });
    const [reviewUrl, reviewOptions] = fetch.mock.calls[0];
    expect(reviewUrl).toBe('/api/analyses/run-1/events/evt-1/review');
    expect(JSON.parse(reviewOptions.body)).toEqual({ decision: 'confirmed', note: 'Reviewed' });

    fetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    await expect(api.getConfirmedHotspots()).resolves.toEqual([]);
    expect(fetch.mock.calls[1][0]).toBe('/api/hotspots');
  });
});
