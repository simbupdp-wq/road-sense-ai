const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const ANALYSIS_STATUSES = new Set(['queued', 'processing', 'completed', 'failed']);

export class ApiContractPendingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ApiContractPendingError';
  }
}

async function requestJson(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, options);
  } catch (error) {
    throw new Error(`Network request failed. Check the API address and connection. ${error.message}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`The API returned an unreadable response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const detail = typeof payload?.detail === 'string' ? payload.detail : null;
    const message = typeof payload?.message === 'string' ? payload.message : null;
    throw new Error(detail || message || `Request failed with HTTP ${response.status}.`);
  }
  return payload;
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export async function analyzeVideo({ file }) {
  if (!(file instanceof Blob)) throw new Error('Select a video file before submitting.');
  const form = new FormData();
  form.append('file', file);
  const payload = await requestJson('/api/analyze', { method: 'POST', body: form });
  if (!isObject(payload) || typeof payload.analysis_id !== 'string' || !payload.analysis_id.trim()) {
    throw new Error('The API response did not include a valid analysis_id.');
  }
  if (!ANALYSIS_STATUSES.has(payload.status)) throw new Error('The API response did not include a supported analysis status.');
  return payload;
}

export async function getAnalysisStatus(analysisId, { signal } = {}) {
  if (typeof analysisId !== 'string' || !analysisId.trim()) throw new Error('A valid analysis_id is required.');
  const payload = await requestJson(`/api/analyses/${encodeURIComponent(analysisId)}`, { signal });
  if (!isObject(payload) || !ANALYSIS_STATUSES.has(payload.status)) {
    throw new Error('The API returned an unsupported analysis status.');
  }
  if (payload.analysis_id != null && payload.analysis_id !== analysisId) {
    throw new Error('The status response analysis_id did not match the active analysis.');
  }
  return payload;
}

export async function getCandidateEvents(analysisId, { signal } = {}) {
  if (typeof analysisId !== 'string' || !analysisId.trim()) throw new Error('A valid analysis_id is required.');
  const payload = await requestJson(`/api/analyses/${encodeURIComponent(analysisId)}/events`, { signal });
  if (!isObject(payload) || !Array.isArray(payload.events)) {
    throw new Error('The event response must include an events array.');
  }
  if (payload.events.some((event) => !isObject(event))) throw new Error('The events array contains invalid event data.');
  if (payload.analysis_id != null && payload.analysis_id !== analysisId) {
    throw new Error('The event response analysis_id did not match the active analysis.');
  }
  return {
    analysis_id: payload.analysis_id ?? analysisId,
    events_available: payload.events_available === true,
    events: payload.events,
    message: typeof payload.message === 'string' ? payload.message : null,
  };
}

export function getAnnotatedVideoUrl(statusData) {
  const value = statusData?.result?.annotated_video_url;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return new URL(value, API_BASE_URL || globalThis.location?.origin || 'http://localhost').toString();
  } catch {
    return null;
  }
}

export async function sendReviewDecision() {
  throw new ApiContractPendingError('Review decisions are local demo state only. The review endpoint contract is not available.');
}

export async function getConfirmedHotspots() {
  throw new ApiContractPendingError('Confirmed hotspots are unavailable until the API teammate provides the endpoint and response contract.');
}
