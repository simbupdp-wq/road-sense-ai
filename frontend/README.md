# RoadSense frontend

RoadSense is a road-safety video review prototype. The frontend has separate Public and Authority sign-in routes, protected workspaces, and an Authority upload/review flow. Login is prototype-only; it does not authenticate a real person. Backend authorization is still required before production use.

## Start locally

In PowerShell:

```powershell
cd .\frontend
npm install
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm run dev
```

Open the Vite URL (normally `http://127.0.0.1:5173`). The sign-in routes are `/public/login` and `/authority/login`. Any syntactically valid email and non-empty password enters the corresponding local prototype workspace. The mock session is stored in `sessionStorage`; it is not a security boundary.

Set `VITE_DEV_PROXY_TARGET` in `.env.local` if the API server is not at `http://127.0.0.1:8001`. Vite proxies both `/api` and `/results` to that target. `VITE_API_BASE_URL` can be set to a deployed API origin; leave it blank for the local same-origin proxy.

## Routes and role behavior

| Route | Purpose |
|---|---|
| `/public/login` | Public prototype login |
| `/authority/login` | Authority prototype login |
| `/public` | Public hotspot and route-demo workspace |
| `/authority` and nested paths | Authority video review workspace |

Unauthenticated visits to workspaces redirect to the matching login. A Public session cannot open Authority routes, and an Authority session cannot open Public routes. Logout clears the prototype session and returns to that role's login. These frontend guards do not replace server-side authorization.

## API contract used by the frontend

The Authority workspace follows the Praveen API contract supplied for this UI:

| Method | Endpoint | Frontend behavior |
|---|---|---|
| `POST` | `/api/analyze` | Sends multipart field `file` only; no Camera ID or device selector. Expects top-level `analysis_id` and `status` (normally `queued`). |
| `GET` | `/api/analyses/{analysis_id}` | Polls `queued`, `processing`, `completed`, or `failed`. On completion reads `result.annotated_video_url`, `result.metadata.fps`, optional metadata, and optional `result.events`. |
| `GET` | `/api/analyses/{analysis_id}/events` | Reads the wrapper object and validates `events` is an array. `events_available: false` and `message` are shown honestly. `result.events` is used as a fallback if provided by the completed status response. |

The listed event fields are displayed when present: `event_id`, `object_ids`, `classes`, `risk`, `minimum_distance_pixels`, `status`, `review_status`, `start_time_seconds`, `peak_time_seconds`, and `end_time_seconds`. Every record is labeled **Candidate near-miss — requires human review**. `risk` is shown as the API-provided label; it is not presented as accident probability or validated severity. Event selection seeks to `peak_time_seconds`; `peak_frame` is used only if `result.metadata.fps` is a valid positive number.

Relative `result.annotated_video_url` values resolve against the configured API origin. In local development, `/results/...` is proxied to the API server. The player shows an unavailable/error state if the API omits the URL or the media cannot play.

### Current backend compatibility note

The checked-in backend implementation inspected during this UI change currently exposes a different contract (`POST /api/analyses` with `video` and `config_json`, among other status/result shapes). This frontend intentionally does **not** change or adapt Praveen's contract. For end-to-end upload, run the API service that implements the Praveen contract above. No real-video API test was claimed against the mismatched checked-in service.

## Prototype-only features and unavailable data

- Public confirmed hotspots are unavailable because the API has no confirmed-hotspot endpoint. The workspace starts with the message: “Confirmed road-safety hotspots will appear here after authority review.” Sample locations and their route line appear only after the explicit **Show demo hotspots** action, and are labeled **Demo Data — not real incidents**.
- The Demo Route Suggestion is a visual/list illustration. It is not navigation, route optimization, live traffic, or a safety recommendation.
- Confirm and Dismiss actions are local demo state only. The UI says **Demo only — not saved to the API**; no review endpoint is called.
- A candidate event is not a confirmed accident or official incident decision. An empty list does not establish that the footage was risk-free.
- Authentication, detection, tracking, near-miss analysis, collision analysis, and camera-motion compensation are not implemented by the frontend.

## Design and mapping

The interface uses the RoadSense burgundy, beige, ivory, and sage-gray palette. Leaflet 1.9 and React Leaflet 4 are used with React 18. OpenStreetMap attribution is visible; the map uses real service coordinates only when an API contract supplies them, otherwise the explicit demo adapter or empty state is shown. Leaflet CSS is imported from `src/main.jsx`; marker icons use a bundled `divIcon`.

## Checks

From `frontend/`:

```powershell
npm test
npm run build
```

This package currently defines no lint or type-check scripts.
