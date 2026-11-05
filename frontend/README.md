# RoadSense frontend

RoadSense is a road-safety video review prototype with separate Public and Authority workspaces. The UI uses the FastAPI authentication API; it no longer accepts arbitrary email/password values as a local-only sign-in.

## Start locally

Start the API from the repository root first. In a second PowerShell window:

```powershell
cd .\frontend
npm ci
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm run dev
```

Open the Vite URL (normally `http://127.0.0.1:5173`). The local Vite server proxies `/api` to the API target in `.env.local`.

## Accounts and sign-in

- A visitor can create a **Public** account from `/public/login`. Public registration never accepts an Authority role.
- **Authority** accounts are promoted by the project administrator in Supabase SQL Editor after signup. Authority users then sign in at `/authority/login`.
- The UI stores Supabase access and refresh tokens in the current browser tab's `sessionStorage`, asks the API to validate them when the page is reopened, refreshes short-lived access tokens, and signs out when the user logs out.
- The API, rather than the UI route guard, enforces which role may upload videos and read analysis results.

## API contract used by this frontend

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/auth/register` | Creates a Public account through Supabase Auth. JSON: `name`, `email`, `password`. Email confirmation may be required before sign-in. |
| `POST` | `/api/auth/login` | Signs in an existing Public or Authority account. JSON: `email`, `password`, `role`. |
| `GET` | `/api/auth/me` | Validates the bearer token and returns the signed-in user. |
| `POST` | `/api/auth/refresh` | Exchanges the refresh token and returns a new Supabase session. |
| `POST` | `/api/auth/logout` | Revokes the current bearer session. |
| `POST` | `/api/analyze` | Authority-only. Sends multipart field `file`; returns `analysis_id` and `status`. |
| `GET` | `/api/analyses/{analysis_id}` | Authority-only. Polls `queued`, `processing`, `completed`, or `failed`. |
| `GET` | `/api/analyses/{analysis_id}/events` | Authority-only. Returns the candidate event list. |
| `GET` | `/api/analyses/{analysis_id}/video` | Authority-only. Streams the annotated video after the frontend sends its bearer token. |
| `GET` | `/api/analyses/{analysis_id}/tracking` | Authority-only. Downloads the tracking JSONL output. |

On completion, the status response contains `result.annotated_video_url`, `result.metadata`, and `result.events`. Event rows are **candidate near-misses requiring human review**, not confirmed accidents or official decisions.

## Current prototype boundaries

- The Public map loads only authority-confirmed locations from the API. Demo coordinates remain visibly labeled; route optimization is still a demonstration only.
- Authority review decisions and confirmed hotspot locations persist in Supabase. Analysis job status is still temporary API memory and disappears when the API restarts.
- Analysis job status is held in API memory, so a backend restart clears that status. Supabase owns account credentials, profiles, and sessions; generated video files remain on the API machine.

## Frontend checks

```powershell
npm test
npm run build
```

The login-related checks must use database accounts from the running API; valid-looking text alone does not authenticate.
