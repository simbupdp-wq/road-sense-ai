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

function bearerHeaders(token, headers = {}) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('Your sign-in session is missing. Please sign in again.');
  return { ...headers, Authorization: `Bearer ${token}` };
}

export async function registerPublicUser({ name, email, password }) {
  return requestJson('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
}

export async function loginUser({ email, password, role }) {
  return requestJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, role }),
  });
}

export async function getCurrentUser(token) {
  return requestJson('/api/auth/me', { headers: bearerHeaders(token) });
}

export async function refreshUserSession(refreshToken) {
  return requestJson('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

export async function logoutUser(token) {
  return requestJson('/api/auth/logout', { method: 'POST', headers: bearerHeaders(token) });
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export async function analyzeVideo({ file, token, cameraLocation }) {
  if (!(file instanceof Blob)) throw new Error('Select a video file before submitting.');
  const form = new FormData();
  form.append('file', file);
  if (cameraLocation) {
    form.append('camera_id', cameraLocation.cameraId || '');
    form.append('location_name', cameraLocation.locationName);
    form.append('latitude', String(cameraLocation.latitude));
    form.append('longitude', String(cameraLocation.longitude));
    form.append('location_source', cameraLocation.source);
  }
  const payload = await requestJson('/api/analyze', {
    method: 'POST',
    headers: bearerHeaders(token),
    body: form,
  });
  if (!isObject(payload) || typeof payload.analysis_id !== 'string' || !payload.analysis_id.trim()) {
    throw new Error('The API response did not include a valid analysis_id.');
  }
  if (!ANALYSIS_STATUSES.has(payload.status)) throw new Error('The API response did not include a supported analysis status.');
  return payload;
}

export async function getAnalysisStatus(analysisId, { signal, token } = {}) {
  if (typeof analysisId !== 'string' || !analysisId.trim()) throw new Error('A valid analysis_id is required.');
  const payload = await requestJson(`/api/analyses/${encodeURIComponent(analysisId)}`, {
    signal,
    headers: bearerHeaders(token),
  });
  if (!isObject(payload) || !ANALYSIS_STATUSES.has(payload.status)) {
    throw new Error('The API returned an unsupported analysis status.');
  }
  if (payload.analysis_id != null && payload.analysis_id !== analysisId) {
    throw new Error('The status response analysis_id did not match the active analysis.');
  }
  return payload;
}

export async function getCandidateEvents(analysisId, { signal, token } = {}) {
  if (typeof analysisId !== 'string' || !analysisId.trim()) throw new Error('A valid analysis_id is required.');
  const payload = await requestJson(`/api/analyses/${encodeURIComponent(analysisId)}/events`, {
    signal,
    headers: bearerHeaders(token),
  });
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

export async function loadAnnotatedVideo(statusData, token, { signal } = {}) {
  const path = statusData?.result?.annotated_video_url;
  if (typeof path !== 'string' || !path.trim()) return null;
  const url = new URL(path, API_BASE_URL || globalThis.location?.origin || 'http://localhost').toString();
  let response;
  try {
    response = await fetch(url, { signal, headers: bearerHeaders(token) });
  } catch (error) {
    throw new Error(`Could not load the annotated video. ${error.message}`);
  }
  if (!response.ok) {
    let message = `Video request failed with HTTP ${response.status}.`;
    try {
      const payload = await response.json();
      if (typeof payload?.detail === 'string') message = payload.detail;
    } catch { /* retain the HTTP message */ }
    throw new Error(message);
  }
  const video = await response.blob();
  return URL.createObjectURL(video);
}

export async function sendReviewDecision({ analysisId, eventId, decision, note = '', token }) {
  if (!analysisId || !eventId) throw new Error('An analysis and candidate event are required to save a review.');
  if (!['confirmed', 'dismissed'].includes(decision)) throw new Error('Choose confirmed or dismissed for the review decision.');
  return requestJson(`/api/analyses/${encodeURIComponent(analysisId)}/events/${encodeURIComponent(eventId)}/review`, {
    method: 'POST',
    headers: bearerHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ decision, note }),
  });
}

export async function getConfirmedHotspots() {
  return requestJson('/api/hotspots');
}
