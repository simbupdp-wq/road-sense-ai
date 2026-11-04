# RoadSense frontend

RoadSense is the name shown in this frontend. This React 18 + Vite app has two mock-role views: **Authority View** and **Public View**. The selector is for changing the prototype presentation only; it does not authenticate a person or enforce permissions.

## Run locally

In PowerShell:

```powershell
cd .\frontend
npm install
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm run dev
```

Open the address Vite prints (normally `http://127.0.0.1:5173`). The development proxy forwards `/api` to `http://127.0.0.1:8001` by default. Set `VITE_DEV_PROXY_TARGET` in `.env.local` to the API teammate’s local server address if it uses another port. `VITE_API_BASE_URL` can instead point directly at a reachable API origin.

The frontend can run without an API for visual review. The upload form will validate locally, but it will not send the video until the teammate confirms the upload multipart field names. Demo candidates and demo hotspot locations require an explicit button and are labeled as illustrative.

## Views

### Authority View

- Select a video file (`.mp4`, `.mov`, `.mkv`, `.avi`, `.webm`) and enter a camera ID. These suffixes match the checked-in analyzer's allowlist; the teammate endpoint must confirm the same accepted types and any size limit.
- The known endpoint is `POST /api/analyze`. No upload request is sent until `VITE_ANALYZE_VIDEO_FIELD` and `VITE_ANALYZE_CAMERA_ID_FIELD` are set to field names confirmed by the API teammate. Submitting before then displays a clear contract-pending error; the frontend does not guess the fields.
- A valid upload response must contain a non-empty string `analysis_id`.
- The frontend polls `GET /api/analyses/{analysis_id}` and recognizes `queued`, `processing`, `completed`, and `failed` statuses. Polling stops at a terminal status and is cancelled when the active view is left or reset.
- On `completed`, it requests `GET /api/analyses/{analysis_id}/events`. The current service adapter expects a JSON array of event objects. This shape must be confirmed with the API teammate before connection.
- Only fields present in event objects are displayed. Selecting an event seeks the video using a supplied timestamp; a frame reference can be converted only when the status response supplies FPS.
- The video player appears only when a documented status-response field path is configured in `VITE_ANNOTATED_VIDEO_URL_PATH`.
- Confirm/Dismiss actions are local demo review state. They are not sent to the server and do not constitute official incident verification.

### Public View

- Starts with an honest empty state because the confirmed-hotspots API is not available yet.
- `Check hotspot service` calls a placeholder that reports the missing contract; it does not fall back to sample data.
- `Show demo hotspots` explicitly loads labeled sample points and counts. They are illustrative and do not represent real cameras or incidents.
- The reusable Leaflet map uses OpenStreetMap tiles with visible attribution. Only locations with valid latitude/longitude are mapped. The list view remains available when there are no valid coordinates. Loading map tiles requires network access to OpenStreetMap.
- The **Demo Route Suggestion** is a simple illustrative line/list through demo points. It is not navigation, live traffic, route optimization, or a safety recommendation.

The frontend includes Leaflet 1.9 and React Leaflet 4, which supports React 18. The Leaflet CSS import is in `src/main.jsx`; the marker is a bundled `divIcon`, avoiding default image asset path issues in production builds.

## Environment variables

Copy `.env.example` to `.env.local` and set only values confirmed by the API teammate:

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Optional API origin. Leave empty to use the Vite `/api` proxy. |
| `VITE_DEV_PROXY_TARGET` | Local API origin for development proxy; defaults to `http://127.0.0.1:8001`. |
| `VITE_ANALYZE_VIDEO_FIELD` | Confirmed multipart field for the uploaded file. Blank means no upload request is sent. |
| `VITE_ANALYZE_CAMERA_ID_FIELD` | Confirmed multipart field for the camera ID. Blank means no upload request is sent. |
| `VITE_ANNOTATED_VIDEO_URL_PATH` | Confirmed dotted path to a video URL in the status response; blank hides the player artifact. |

Vite exposes `VITE_*` values to browser code. Do not place secrets in these variables.

## API boundary

The UI uses only the known paths below:

| Method | Endpoint | Current frontend behavior |
|---|---|---|
| `POST` | `/api/analyze` | Sends a `FormData` body only after both field names are configured; validates `analysis_id`. |
| `GET` | `/api/analyses/{analysis_id}` | Reads status and stops on `completed` or `failed`. |
| `GET` | `/api/analyses/{analysis_id}/events` | Reads event objects after completion; current adapter expects a JSON array. |

Review and confirmed-hotspot service functions are placeholders and make no HTTP request. Their API contracts are not known.

### Questions for the API teammate

1. For `POST /api/analyze`, what are the exact multipart field names for the video and camera ID? What file types/size limits are accepted, and what are the success and error response shapes?
2. Does the upload response contain `analysis_id` as a top-level non-empty string?
3. What is the exact status response shape, including where the `status`, FPS (if supplied), error detail, and annotated-video URL appear? Is the video URL relative or absolute, and does it require authorization?
4. Does the events endpoint return a bare JSON array or a wrapper object? What are the exact event field names, frame-number convention, timestamp units, and evidence-reference semantics?
5. What review endpoint should Confirm/Dismiss use: HTTP method, path, request/response fields, error behavior, and reviewer-note support?
6. What confirmed-hotspots endpoint and schema should the frontend use? Confirm filtering semantics, camera/location fields, latitude/longitude format, confirmed-event counts/reporting period, and public privacy constraints.

Do not fill the upload/video URL environment variables or replace the review/hotspot placeholders until the team has agreed on these answers. A backend contract change should be coordinated with the API owner.

## Test and build commands

Run these in `frontend/`:

```powershell
npm test
npm run build
```

The project currently does not define lint or type-check scripts; it is JavaScript/JSX rather than TypeScript. The test suite covers role switching, API request boundaries, upload validation, polling and cleanup, demo review behavior, event seeking, hotspot data handling, demo route labeling, and map fallbacks/attribution.

## Evidence and safety language

An analysis event shown by the API is a candidate for human review. A blank event list means no event was returned by that API response; it does not establish that a road was safe. The frontend does not implement detection, tracking, near-miss analysis, collision analysis, camera-motion compensation, risk scoring, or official review.
