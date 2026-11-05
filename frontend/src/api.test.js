import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('RoadSense API service', () => {
  it('uploads only the video under multipart field `file` and validates analysis_id/status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ analysis_id: 'run-123', status: 'queued' }),
    }));
    const file = new File(['clip'], 'road.mp4', { type: 'video/mp4' });

    await expect(api.analyzeVideo({ file, token: 'test-token' })).resolves.toEqual({ analysis_id: 'run-123', status: 'queued' });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/analyze');
    expect(options.method).toBe('POST');
    expect(options.body.get('file')).toBe(file);
    expect([...options.body.keys()]).toEqual(['file']);
  });

  it('rejects upload responses without a valid analysis ID or supported status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ analysis_id: ' ' , status: 'queued' }) }));
    await expect(api.analyzeVideo({ file: new File(['x'], 'clip.mp4'), token: 'test-token' })).rejects.toThrow(/analysis_id/i);
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ analysis_id: 'run-1', status: 'running' }) });
    await expect(api.analyzeVideo({ file: new File(['x'], 'clip.mp4'), token: 'test-token' })).rejects.toThrow(/status/i);
  });

  it('polls documented status and validates exact states and result data defensively', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      analysis_id: 'run/123', status: 'completed', result: { metadata: { fps: 25 } },
    }) }));
    await expect(api.getAnalysisStatus('run/123', { token: 'test-token' })).resolves.toMatchObject({ status: 'completed', result: { metadata: { fps: 25 } } });
    expect(fetch.mock.calls[0][0]).toBe('/api/analyses/run%2F123');

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'almost_done' }) });
    await expect(api.getAnalysisStatus('run-123', { token: 'test-token' })).rejects.toThrow(/unsupported analysis status/i);
  });

  it('reads the events wrapper and rejects malformed events safely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      analysis_id: 'run-123', events_available: true, events: [{ event_id: 'evt-1' }], message: null,
    }) }));
    await expect(api.getCandidateEvents('run-123', { token: 'test-token' })).resolves.toEqual({
      analysis_id: 'run-123', events_available: true, events: [{ event_id: 'evt-1' }], message: null,
    });
    expect(fetch.mock.calls[0][0]).toBe('/api/analyses/run-123/events');

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ events_available: false, events: null, message: 'Unavailable' }) });
    await expect(api.getCandidateEvents('run-123', { token: 'test-token' })).rejects.toThrow(/include an events array/i);
  });

  it('resolves the exact result.annotated_video_url and keeps unsupported API features unavailable', async () => {
    expect(api.getAnnotatedVideoUrl({ result: { annotated_video_url: '/results/run-1/annotated.mp4' } }))
      .toBe(`${window.location.origin}/results/run-1/annotated.mp4`);
    expect(api.getAnnotatedVideoUrl({ annotated_video_url: '/wrong-location.mp4' })).toBeNull();
    const savedReview = { analysis_id: 'run-1', event: { event_id: 'evt-1', review_status: 'confirmed' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => savedReview }));
    await expect(api.sendReviewDecision({
      analysisId: 'run-1', eventId: 'evt-1', decision: 'confirmed', note: 'Reviewed', token: 'test-token',
    })).resolves.toEqual(savedReview);
    expect(fetch.mock.calls[0][0]).toBe('/api/analyses/run-1/events/evt-1/review');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ decision: 'confirmed', note: 'Reviewed' });

    fetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    await expect(api.getConfirmedHotspots()).resolves.toEqual([]);
    expect(fetch.mock.calls[1][0]).toBe('/api/hotspots');
  });
});
