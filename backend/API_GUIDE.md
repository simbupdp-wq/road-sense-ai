# RoadSense API guide

The FastAPI service verifies users with Supabase Auth, reads their Public/Authority role from the RLS-protected `profiles` table, and runs video uploads through YOLO, ByteTrack, and the near-miss candidate logic.

## One-time Supabase setup

Follow **Connect Supabase** in the repository's root `README.md`:

1. Copy `.env.example` to `.env` and fill in `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
2. Run the current `supabase/schema.sql` in the Supabase SQL Editor. Re-run it after pulling this location/review feature so the `road_safety_events` table and policies are created.
3. Create a Public account, then promote the intended Authority account in the SQL Editor.

The API needs only the project URL, publishable key, and the user's Supabase access token. Do not put a Supabase secret/service-role key in this project.

## Start (PowerShell, repository root)

```powershell
py -3.12 -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
# Install the appropriate PyTorch build separately using pytorch.org's selector.
python -m pip install -r backend\requirements.txt
python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8001
```

Open `http://127.0.0.1:8001/docs`. The frontend runs at `http://127.0.0.1:5173` and proxies `/api` to port 8001.

## Routes

- `GET /api/health` — API availability.
- `POST /api/auth/register` — Public account signup; JSON: `name`, `email`, `password`.
- `POST /api/auth/login` — Supabase password sign-in; JSON: `email`, `password`, and requested `role` (`public` or `authority`).
- `GET /api/auth/me` — validate a Supabase bearer access token.
- `POST /api/auth/refresh` — exchange a Supabase refresh token for a new session.
- `POST /api/auth/logout` — sign out the current Supabase session.
- `POST /api/analyze` — Authority-only multipart upload named `file`; optional `device` is `auto`, `cpu`, or `0`. Optional location fields are `camera_id`, `location_name`, `latitude`, `longitude`, and `location_source` (`camera` or `demo`). Supply location name and both coordinates together; the completed result includes `camera_location` for the Authority map. These values are supplied by the user and are not inferred by YOLO/ByteTrack.
- `GET /api/analyses/{analysis_id}` — Authority-only job status and result.
- `GET /api/analyses/{analysis_id}/events` — Authority-only candidate event list.
- `POST /api/analyses/{analysis_id}/events/{event_id}/review` — Authority-only review body: `{"decision":"confirmed"}` or `{"decision":"dismissed"}`, optionally with a `note`.
- `GET /api/hotspots` — Public list of grouped locations with authority-confirmed candidates.
- `GET /api/analyses/{analysis_id}/video` — Authority-only annotated MP4 stream.
- `GET /api/analyses/{analysis_id}/tracking` — Authority-only tracking JSONL download.

The UI sends `Authorization: Bearer <Supabase access token>` to protected endpoints. Public users cannot upload or inspect analysis jobs. The server checks the account's role from Supabase on each protected request. Event review writes use the Authority user's token and RLS; the Public hotspot route can read only confirmed location columns.

Uploads are limited to 200 MB, stored under generated names, and removed after processing. Analysis job state is held in memory and cleared when the API restarts. Authority review decisions and confirmed event locations are stored in Supabase. Generated video and tracking files remain on the API machine.

## Event processing

The tracking pipeline writes one JSON object per detection to `tracking.jsonl`. The API converts records with assigned IDs into the near-miss function's input fields (`frame`, `object_id`, `class`, `x`, and `y`), runs the event analysis, and writes `backend/results/<analysis_id>/events.json`. Events preserve the teammate's fields and add an `event_id`, `review_status: "pending"`, and timestamps in seconds when FPS is available. Distances and risk labels are image-space heuristics, not verified physical distances or confirmed incidents.
