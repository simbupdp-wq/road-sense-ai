import { describe, expect, it, vi } from 'vitest';
import { monitorAnalysis } from './analysisPolling.js';

describe('analysis status polling', () => {
  it('polls sequentially and fetches events once when a run completes', async () => {
    const statuses = [
      { analysis_id: 'run-1', status: 'queued' },
      { analysis_id: 'run-1', status: 'processing' },
      { analysis_id: 'run-1', status: 'completed' },
    ];
    const getStatus = vi.fn(async () => statuses.shift());
    const getEvents = vi.fn(async () => ({ events_available: true, events: [{ event_id: 'evt-1' }], message: null }));
    const onStatus = vi.fn();
    const onEvents = vi.fn();

    await monitorAnalysis({ analysisId: 'run-1', getStatus, getEvents, onStatus, onEvents, intervalMs: 0 });

    expect(getStatus).toHaveBeenCalledTimes(3);
    expect(getEvents).toHaveBeenCalledTimes(1);
    expect(onStatus.mock.calls.map(([status]) => status.status)).toEqual(['queued', 'processing', 'completed']);
    expect(onEvents).toHaveBeenCalledWith([{ event_id: 'evt-1' }], expect.objectContaining({ source: 'events-endpoint' }));
  });

  it('uses completed status result.events when the events endpoint says unavailable', async () => {
    const onEvents = vi.fn();
    await monitorAnalysis({
      analysisId: 'run-with-result-events',
      getStatus: async () => ({ status: 'completed', result: { events: [{ event_id: 'evt-result' }] } }),
      getEvents: async () => ({ events_available: false, events: [], message: 'Events unavailable' }),
      onEvents,
      intervalMs: 0,
    });
    expect(onEvents).toHaveBeenCalledWith([{ event_id: 'evt-result' }], expect.objectContaining({ source: 'status' }));
  });

  it('falls back to completed result.events if loading the events endpoint fails', async () => {
    const onEvents = vi.fn();
    const onEventsError = vi.fn();
    await monitorAnalysis({
      analysisId: 'run-fallback',
      getStatus: async () => ({ status: 'completed', result: { events: [{ event_id: 'evt-result' }] } }),
      getEvents: async () => { throw new Error('events request failed'); },
      onEvents,
      onEventsError,
      intervalMs: 0,
    });
    expect(onEvents).toHaveBeenCalledWith([{ event_id: 'evt-result' }], expect.objectContaining({ source: 'status' }));
    expect(onEventsError).not.toHaveBeenCalled();
  });

  it('stops on failed status without requesting candidate events', async () => {
    const getEvents = vi.fn();
    const result = await monitorAnalysis({
      analysisId: 'run-2', getStatus: async () => ({ status: 'failed' }), getEvents, intervalMs: 0,
    });
    expect(result.status).toBe('failed');
    expect(getEvents).not.toHaveBeenCalled();
  });

  it('recovers after a temporary status failure and reports later successful statuses', async () => {
    const responses = [new Error('temporary network error'), { status: 'queued' }, { status: 'completed' }];
    const getStatus = vi.fn(async () => {
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    });
    const onPollError = vi.fn();
    const onStatus = vi.fn();

    const result = await monitorAnalysis({
      analysisId: 'run-retry', getStatus, getEvents: async () => [], onPollError, onStatus, intervalMs: 0,
    });

    expect(result.status).toBe('completed');
    expect(getStatus).toHaveBeenCalledTimes(3);
    expect(onPollError).toHaveBeenCalledTimes(1);
    expect(onStatus.mock.calls.map(([status]) => status.status)).toEqual(['queued', 'completed']);
  });

  it('stops polling when the active view is left or reset aborts the signal', async () => {
    const controller = new AbortController();
    const getStatus = vi.fn(async () => ({ status: 'queued' }));
    const running = monitorAnalysis({
      analysisId: 'run-3', getStatus, getEvents: vi.fn(), signal: controller.signal,
      intervalMs: 20, onStatus: () => controller.abort(),
    });
    await running;
    expect(getStatus).toHaveBeenCalledTimes(1);
  });
});
