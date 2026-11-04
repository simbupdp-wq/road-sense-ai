"""FastAPI adapter for the RoadWatch video-tracking pipeline.

This API runs locally for the hackathon demo. Analysis state is kept in memory,
so restarting the server clears active job status (generated result files remain).
"""

from __future__ import annotations

import json
import shutil
import threading
from pathlib import Path
from uuid import uuid4

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import TrackingConfig
from .near_miss import analyze_near_misses
from .tracking_pipeline import run_tracking

ROOT = Path(__file__).resolve().parents[2]
UPLOADS = ROOT / "backend" / "uploads"
RESULTS = ROOT / "backend" / "results"
MAX_UPLOAD_BYTES = 200 * 1024 * 1024
ALLOWED_SUFFIXES = {".mp4", ".mov", ".avi", ".mkv"}

UPLOADS.mkdir(parents=True, exist_ok=True)
RESULTS.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="RoadWatch AI API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:9002",
        "http://127.0.0.1:9002",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# Only generated analysis outputs are public to the local frontend. Uploaded
# source videos stay in backend/uploads and are never mounted as static files.
app.mount("/results", StaticFiles(directory=RESULTS), name="results")

analyses: dict[str, dict] = {}
analysis_lock = threading.Lock()
gpu_lock = threading.Lock()


def _public_result(analysis_id: str, metadata: dict) -> dict:
    result_dir = RESULTS / analysis_id
    events_path = result_dir / "events.json"
    events = []
    events_available = events_path.is_file()
    if events_available:
        try:
            payload = json.loads(events_path.read_text(encoding="utf-8"))
            events = payload.get("events", payload) if isinstance(payload, dict) else payload
            if not isinstance(events, list):
                events = []
        except (OSError, json.JSONDecodeError):
            events_available = False
            events = []

    return {
        "analysis_id": analysis_id,
        "status": "completed",
        "video": {
            "name": metadata.get("input_name"),
            "fps": metadata.get("fps"),
            "duration_s": metadata.get("duration_seconds"),
            "frames_processed": metadata.get("frames_processed"),
        },
        "metadata": metadata,
        "annotated_video_url": f"/results/{analysis_id}/annotated.mp4",
        "tracking_url": f"/results/{analysis_id}/tracking.jsonl",
        "events_url": f"/results/{analysis_id}/events.json" if events_available else None,
        "events_available": events_available,
        "events": events,
        "limitations": (
            "Near-miss events are heuristic candidates based on image-space "
            "distances. They are not confirmed incidents and require human review."
        ),
    }


def _near_miss_records(tracking_path: Path) -> list[dict]:
    """Convert this API's JSONL records to the teammate's event input shape."""
    tracked_objects = []
    with tracking_path.open("r", encoding="utf-8") as tracking_file:
        for line in tracking_file:
            if not line.strip():
                continue
            record = json.loads(line)
            track_id = record.get("track_id")
            bbox = record.get("bbox")
            if track_id is None or not bbox or len(bbox) != 4:
                continue
            tracked_objects.append({
                "frame": int(record["frame"]),
                "object_id": int(track_id),
                "class": str(record["class_name"]),
                # Keep the same box-center distance convention as the
                # teammate's current tracked_objects.json input.
                "x": (float(bbox[0]) + float(bbox[2])) / 2,
                "y": (float(bbox[1]) + float(bbox[3])) / 2,
            })
    return tracked_objects


def _process_analysis(analysis_id: str, video_path: Path, original_name: str, device: str):
    result_dir = RESULTS / analysis_id
    result_dir.mkdir(parents=True, exist_ok=True)
    with analysis_lock:
        analyses[analysis_id]["status"] = "processing"
    try:
        config = TrackingConfig(output_dir=result_dir, device=device)
        # Serialize inference jobs so multiple uploads do not compete for GPU RAM.
        with gpu_lock:
            metadata = run_tracking(video_path, config)
        tracked_objects = _near_miss_records(Path(metadata["records_output"]))
        events = analyze_near_misses(tracked_objects)
        fps = metadata.get("fps")
        for index, event in enumerate(events, start=1):
            event["event_id"] = f"{analysis_id}-{index}"
            event["review_status"] = "pending"
            if fps:
                event["start_time_seconds"] = round(event["start_frame"] / fps, 3)
                event["peak_time_seconds"] = round(event["peak_frame"] / fps, 3)
                event["end_time_seconds"] = round(event["end_frame"] / fps, 3)
        (result_dir / "events.json").write_text(
            json.dumps(events, indent=2), encoding="utf-8"
        )
        metadata["input_name"] = original_name
        metadata["duration_seconds"] = round(
            metadata["frames_processed"] / metadata["fps"], 3
        ) if metadata.get("fps") else None
        public_result = _public_result(analysis_id, metadata)
        with analysis_lock:
            analyses[analysis_id].update(
                status="completed", result=public_result, error=None
            )
    except Exception as exc:  # surfaced through the status endpoint for the UI
        shutil.rmtree(result_dir, ignore_errors=True)
        with analysis_lock:
            analyses[analysis_id].update(
                status="failed", result=None, error=str(exc)
            )
    finally:
        video_path.unlink(missing_ok=True)


@app.get("/api/health")
def health():
    return {"ok": True, "service": "roadwatch-api"}


@app.post("/api/analyze", status_code=202)
async def analyze_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    device: str = "auto",
):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(400, "Upload an MP4, MOV, AVI, or MKV video.")
    if device not in {"auto", "cpu", "0"}:
        raise HTTPException(400, "device must be auto, cpu, or 0.")

    analysis_id = uuid4().hex[:12]
    video_path = UPLOADS / f"{analysis_id}{suffix}"
    total_bytes = 0
    try:
        with video_path.open("wb") as destination:
            while chunk := await file.read(1024 * 1024):
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "Video exceeds the 200 MB upload limit.")
                destination.write(chunk)
    except Exception:
        video_path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()

    if total_bytes == 0:
        video_path.unlink(missing_ok=True)
        raise HTTPException(400, "The uploaded video is empty.")

    analyses[analysis_id] = {
        "status": "queued",
        "result": None,
        "error": None,
    }
    background_tasks.add_task(
        _process_analysis, analysis_id, video_path,
        Path(file.filename or "video").name, device,
    )
    return {"analysis_id": analysis_id, "status": "queued"}


@app.get("/api/analyses/{analysis_id}")
def get_analysis(analysis_id: str):
    analysis = analyses.get(analysis_id)
    if analysis is None:
        raise HTTPException(404, "Analysis not found. It may have been cleared by a server restart.")
    response = {"analysis_id": analysis_id, "status": analysis["status"]}
    if analysis["status"] == "completed":
        response["result"] = analysis["result"]
    if analysis["status"] == "failed":
        response["error"] = analysis["error"]
    return response


@app.get("/api/analyses/{analysis_id}/events")
def get_analysis_events(analysis_id: str):
    analysis = analyses.get(analysis_id)
    if analysis is None:
        raise HTTPException(404, "Analysis not found.")
    if analysis["status"] != "completed":
        raise HTTPException(409, "Analysis has not completed yet.")
    result = analysis["result"]
    return {
        "analysis_id": analysis_id,
        "events_available": result["events_available"],
        "events": result["events"],
        "message": None if result["events_available"] else "Event output is unavailable for this analysis.",
    }
