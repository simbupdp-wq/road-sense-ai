const TERMINAL_STATUSES = new Set(['completed', 'failed']);
const SUPPORTED_STATUSES = new Set(['queued', 'processing', ...TERMINAL_STATUSES]);

function wait(milliseconds, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, milliseconds);
    function done() {
      signal?.removeEventListener('abort', abort);
      resolve();
    }
    function abort() {
      window.clearTimeout(timer);
      done();
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function monitorAnalysis({
  analysisId,
  getStatus,
  getEvents,
  onStatus = () => {},
  onEvents = () => {},
  onEventsLoading = () => {},
  onEventsError = () => {},
  onPollError = () => {},
  signal,
  intervalMs = 1200,
  maxConsecutiveErrors = 3,
}) {
  if (!analysisId) throw new Error('A valid analysis_id is required.');
  let consecutiveErrors = 0;

  while (!signal?.aborted) {
    try {
      const status = await getStatus(analysisId, { signal });
      if (!SUPPORTED_STATUSES.has(status?.status)) throw new Error('The API returned an unsupported analysis status.');
      onStatus(status);
      consecutiveErrors = 0;

      if (status.status === 'completed') {
        onEventsLoading(true);
        const resultEvents = Array.isArray(status?.result?.events)
          && status.result.events.every((event) => event && typeof event === 'object' && !Array.isArray(event))
          ? status.result.events : null;
        try {
          const payload = await getEvents(analysisId, { signal });
          if (!payload || !Array.isArray(payload.events)) throw new Error('The API event response did not include an events array.');
          const useStatusEvents = payload.events_available === false && resultEvents !== null;
          const events = useStatusEvents ? resultEvents : payload.events;
          if (!signal?.aborted) onEvents(events, {
            source: useStatusEvents ? 'status' : 'events-endpoint',
            message: payload.message || null,
            eventsAvailable: payload.events_available === true || (useStatusEvents && events.length > 0),
          });
        } catch (error) {
          if (!signal?.aborted && resultEvents !== null) {
            onEvents(resultEvents, { source: 'status', message: error.message, eventsAvailable: resultEvents.length > 0 });
          } else if (!signal?.aborted) onEventsError(error);
        } finally {
          if (!signal?.aborted) onEventsLoading(false);
        }
        return status;
      }
      if (TERMINAL_STATUSES.has(status.status)) return status;
    } catch (error) {
      if (signal?.aborted) return { aborted: true };
      consecutiveErrors += 1;
      onPollError(error, consecutiveErrors);
      if (consecutiveErrors >= maxConsecutiveErrors) return { paused: true, error };
    }

    await wait(intervalMs, signal);
  }
  return { aborted: true };
}
