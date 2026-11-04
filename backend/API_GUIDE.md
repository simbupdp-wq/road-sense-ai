# Local API guide

The API wraps the existing YOLO + ByteTrack pipeline. It accepts a video,
creates an asynchronous analysis job, and exposes its annotated video and
tracking output. Candidate near-miss events appear only after the event stage
writes `events.json` into that analysis result folder.

## Start (PowerShell, repository root)

```powershell
py -3.12 -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
# Install the correct PyTorch build separately using pytorch.org's selector.
python -m pip install -r backend\requirements.txt
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/docs`. The frontend can call the API from Vite at
`http://localhost:5173` or the configured local demo origin on port 9002.

## Routes

- `GET /api/health` — API availability.
- `POST /api/analyze` — multipart form upload named `file`; optional `device`
  value is `auto`, `cpu`, or `0`. Returns HTTP 202 and an `analysis_id`.
- `GET /api/analyses/{analysis_id}` — poll `queued`, `processing`, `completed`,
  or `failed` state. A completed response includes metadata and result URLs.
- `GET /api/analyses/{analysis_id}/events` — returns event list; until the
  event module is integrated it explicitly reports `events_available: false`.
- `/results/{analysis_id}/annotated.mp4` and
  `/results/{analysis_id}/tracking.jsonl` — generated result files.

Uploaded videos are limited to 200 MB, saved under generated names, and removed
after processing. Only generated results are exposed as static files. Analysis
state is held in memory for this local prototype and is cleared on API restart.

## Event integration handoff

The tracking pipeline writes one JSON object per detection to
`tracking.jsonl`. Each row has `frame`, `timestamp_seconds`, `track_id`,
`class_name`, `confidence`, `bbox`, and `bottom_center`. The event-analysis
stage should write its result as `backend/results/<analysis_id>/events.json`
with either a JSON array of events or an object containing an `events` array.
The API reads that file when returning completed analysis results.
