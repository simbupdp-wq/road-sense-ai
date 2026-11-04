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

function requireUploadFieldNames() {
  const videoField = String(import.meta.env.VITE_ANALYZE_VIDEO_FIELD || '').trim();
  const cameraIdField = String(import.meta.env.VITE_ANALYZE_CAMERA_ID_FIELD || '').trim();
  if (!videoField || !cameraIdField) {
    throw new ApiContractPendingError(
      'The API teammate has not confirmed the video and camera ID upload field names yet. No request was sent.',
    );
  }
  if (videoField === cameraIdField) {
    throw new ApiContractPendingError('The configured video and camera ID upload fields must be different.');
  }
  return { videoField, cameraIdField };
}

export async function analyzeVideo({ file, cameraId }) {
  const { videoField, cameraIdField } = requireUploadFieldNames();
  const form = new FormData();
  form.append(videoField, file);
  form.append(cameraIdField, cameraId);
  const payload = await requestJson('/api/analyze', { method: 'POST', body: form });
  if (!payload || typeof payload !== 'object' || typeof payload.analysis_id !== 'string' || !payload.analysis_id.trim()) {
    throw new Error('The API response did not include a valid analysis_id.');
  }
  return payload;
}

export async function getAnalysisStatus(analysisId, { signal } = {}) {
  if (typeof analysisId !== 'string' || !analysisId.trim()) throw new Error('A valid analysis_id is required.');
  const payload = await requestJson(`/api/analyses/${encodeURIComponent(analysisId)}`, { signal });
  if (!payload || typeof payload !== 'object' || !ANALYSIS_STATUSES.has(payload.status)) {
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
  if (!Array.isArray(payload) || payload.some((event) => !event || typeof event !== 'object' || Array.isArray(event))) {
    throw new Error('The event response must be a JSON array of event objects. Confirm the response shape with the API teammate.');
  }
  return payload;
}

export function getAnnotatedVideoUrl(analysisPayload) {
  const configuredPath = String(import.meta.env.VITE_ANNOTATED_VIDEO_URL_PATH || '').trim();
  if (!configuredPath || !analysisPayload || typeof analysisPayload !== 'object') return null;
  const value = configuredPath.split('.').reduce((current, key) => current?.[key], analysisPayload);
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return new URL(value, API_BASE_URL || globalThis.location?.origin || 'http://localhost').toString();
  } catch {
    return null;
  }
}

export async function sendReviewDecision() {
  throw new ApiContractPendingError(
    'Review decisions are local demo state only. The review endpoint contract is not available.',
  );
}

export async function getConfirmedHotspots() {
  throw new ApiContractPendingError(
    'Confirmed hotspots are unavailable until the API teammate provides the endpoint and response contract.',
  );
}
