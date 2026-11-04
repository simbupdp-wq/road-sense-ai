import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('RoadSense API service', () => {
  it('uses configured upload field names and validates the returned analysis ID', async () => {
    vi.stubEnv('VITE_ANALYZE_VIDEO_FIELD', 'sample_video_part');
    vi.stubEnv('VITE_ANALYZE_CAMERA_ID_FIELD', 'sample_camera_part');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ analysis_id: 'run-123' }),
    }));
    const file = new File(['clip'], 'road.mp4', { type: 'video/mp4' });

    await expect(api.analyzeVideo({ file, cameraId: 'cam-west' })).resolves.toEqual({ analysis_id: 'run-123' });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/analyze');
    expect(options.method).toBe('POST');
    expect(options.body.get('sample_video_part')).toBe(file);
    expect(options.body.get('sample_camera_part')).toBe('cam-west');
  });

  it('does not guess upload field names when the teammate contract is unset', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(api.analyzeVideo({
      file: new File(['clip'], 'road.mp4', { type: 'video/mp4' }),
      cameraId: 'cam-west',
    })).rejects.toBeInstanceOf(api.ApiContractPendingError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('polls the documented status route and accepts only documented statuses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'processing' }) }));
    await expect(api.getAnalysisStatus('run/123')).resolves.toEqual({ status: 'processing' });
    expect(fetch.mock.calls[0][0]).toBe('/api/analyses/run%2F123');

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'almost_done' }) });
    await expect(api.getAnalysisStatus('run-123')).rejects.toThrow(/unsupported analysis status/i);
  });

  it('loads events from the documented endpoint and rejects an unknown response shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ([{ event_id: 'evt-1' }]) }));
    await expect(api.getCandidateEvents('run-123')).resolves.toEqual([{ event_id: 'evt-1' }]);
    expect(fetch.mock.calls[0][0]).toBe('/api/analyses/run-123/events');

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });
    await expect(api.getCandidateEvents('run-123')).rejects.toThrow(/event response must be a JSON array/i);
  });

  it('keeps review and hotspot calls as explicit contract-pending placeholders', async () => {
    await expect(api.sendReviewDecision('evt-1', 'confirm')).rejects.toBeInstanceOf(api.ApiContractPendingError);
    await expect(api.getConfirmedHotspots()).rejects.toBeInstanceOf(api.ApiContractPendingError);
  });
});
