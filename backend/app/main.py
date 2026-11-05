"""FastAPI adapter for RoadWatch analysis and Supabase authentication.

Analysis job state is kept in memory, so restarting this API clears active job
status. Supabase stores user accounts, sessions, and role profiles.
"""

from __future__ import annotations

import json
import re
import shutil
import threading
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from .supabase_auth import (
    SupabaseAuthError,
    get_user,
    refresh_session,
    list_confirmed_event_locations,
    save_event_review,
    sign_in,
    sign_out,
    sign_up,
)
from .config import TrackingConfig
from .near_miss import analyze_near_misses
from backend.roadwatch_engine.src.annotated_video import render_candidate_video
from backend.roadwatch_engine.src.object_tracking import run_tracking_video

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")
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

analyses: dict[str, dict] = {}
analysis_lock = threading.Lock()
gpu_lock = threading.Lock()
bearer_scheme = HTTPBearer(auto_error=False)


class RegisterBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=128)


class LoginBody(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)
    role: Literal["public", "authority"]


class RefreshBody(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=4096)


class ReviewBody(BaseModel):
    decision: Literal["confirmed", "dismissed"]
    note: str = Field(default="", max_length=500)


def _auth_http_error(exc: SupabaseAuthError, *, login_error: bool = False) -> HTTPException:
    if exc.status_code == 503:
        return HTTPException(status_code=503, detail=str(exc))
    if login_error and exc.status_code in {400, 401}:
        provider_message = str(exc).lower()
        if "not confirmed" in provider_message or "not_confirmed" in provider_message or "email_not_confirmed" in provider_message:
            return HTTPException(
                status_code=401,
                detail="Confirm your email using the Supabase confirmation email, then sign in again.",
            )
        return HTTPException(status_code=401, detail="Email, password, or account type is incorrect.")
    if exc.status_code in {400, 422}:
        return HTTPException(status_code=400, detail=str(exc))
    if exc.status_code == 429:
        return HTTPException(status_code=429, detail="Too many sign-in attempts. Please wait and try again.")
    if exc.status_code in {401, 403, 404}:
        return HTTPException(status_code=exc.status_code, detail=str(exc))
    if exc.status_code >= 500:
        provider_message = str(exc).lower()
        if "database error saving new user" in provider_message or "database error" in provider_message:
            detail = (
                "Supabase could not finish signup because a database operation failed. "
                "Check the Supabase Auth and Postgres logs, then verify that supabase/schema.sql ran successfully."
            )
        else:
            detail = (
                f"Supabase returned an internal error (HTTP {exc.status_code}). "
                "Check the Supabase Auth and Postgres logs for the signup attempt."
            )
        return HTTPException(status_code=502, detail=detail)
    return HTTPException(
        status_code=502,
        detail=f"Supabase returned an unexpected authentication response (HTTP {exc.status_code}): {exc}",
    )


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Sign in to continue.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return get_user(credentials.credentials)
    except SupabaseAuthError as exc:
        raise _auth_http_error(exc, login_error=True) from exc


def authority_user(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "authority":
        raise HTTPException(status_code=403, detail="Authority access is required.")
    return user


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
        "camera_location": metadata.get("camera_location"),
        "metadata": metadata,
        "annotated_video_url": f"/api/analyses/{analysis_id}/video",
        "tracking_url": f"/api/analyses/{analysis_id}/tracking",
        "events_url": f"/api/analyses/{analysis_id}/events" if events_available else None,
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


def _process_analysis(
    analysis_id: str,
    video_path: Path,
    original_name: str,
    device: str,
    camera_location: dict | None = None,
):
    result_dir = RESULTS / analysis_id
    result_dir.mkdir(parents=True, exist_ok=True)
    with analysis_lock:
        analyses[analysis_id]["status"] = "processing"
    try:
        config = TrackingConfig(
            output_dir=result_dir,
            device=device,
            video_name="annotated_tracking.mp4",
        )
        # Serialize inference jobs so multiple uploads do not compete for GPU RAM.
        with gpu_lock:
            metadata = run_tracking_video(video_path, config)
        tracked_objects = _near_miss_records(Path(metadata["records_output"]))
        events = analyze_near_misses(tracked_objects)
        fps = metadata.get("fps")
        for index, event in enumerate(events, start=1):
            event["event_id"] = f"{analysis_id}-{index}"
            event["review_status"] = "pending"
            if camera_location:
                event["camera_location"] = camera_location
            if fps:
                event["start_time_seconds"] = round(event["start_frame"] / fps, 3)
                event["peak_time_seconds"] = round(event["peak_frame"] / fps, 3)
                event["end_time_seconds"] = round(event["end_frame"] / fps, 3)
        tracking_video = Path(metadata["video_output"])
        final_video = result_dir / "annotated.mp4"
        render_candidate_video(tracking_video, final_video, events)
        metadata["tracking_video_output"] = str(tracking_video)
        metadata["video_output"] = str(final_video)
        (result_dir / "events.json").write_text(
            json.dumps(events, indent=2), encoding="utf-8"
        )
        metadata["input_name"] = original_name
        metadata["camera_location"] = camera_location
        metadata["duration_seconds"] = round(
            metadata["frames_processed"] / metadata["fps"], 3
        ) if metadata.get("fps") else None
        metadata["candidate_event_count"] = len(events)
        (result_dir / "metadata.json").write_text(
            json.dumps(metadata, indent=2), encoding="utf-8"
        )
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


@app.post("/api/auth/register", status_code=201)
def register_public_user(payload: RegisterBody):
    email = payload.email.strip()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    if not payload.name.strip():
        raise HTTPException(status_code=422, detail="Name cannot be empty.")
    try:
        return sign_up(email, payload.password, payload.name)
    except SupabaseAuthError as exc:
        raise _auth_http_error(exc) from exc


@app.post("/api/auth/login")
def login(payload: LoginBody):
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", payload.email.strip()):
        raise HTTPException(status_code=401, detail="Email, password, or account type is incorrect.")
    try:
        return sign_in(payload.email, payload.password, payload.role)
    except SupabaseAuthError as exc:
        raise _auth_http_error(exc, login_error=True) from exc


@app.get("/api/auth/me")
def who_am_i(user: dict = Depends(current_user)):
    return {"user": user}


@app.post("/api/auth/refresh")
def refresh_auth_session(payload: RefreshBody):
    try:
        return refresh_session(payload.refresh_token)
    except SupabaseAuthError as exc:
        raise _auth_http_error(exc, login_error=True) from exc


@app.post("/api/auth/logout")
def logout(credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)):
    if credentials is not None and credentials.scheme.lower() == "bearer":
        try:
            sign_out(credentials.credentials)
        except SupabaseAuthError:
            # Clear the browser session even when Supabase has already expired it.
            pass
    return {"ok": True}


@app.post("/api/analyze", status_code=202)
async def analyze_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    device: str = "auto",
    camera_id: str | None = Form(None, max_length=80),
    location_name: str | None = Form(None, max_length=120),
    latitude: float | None = Form(None),
    longitude: float | None = Form(None),
    location_source: Literal["camera", "demo"] = Form("demo"),
    _user: dict = Depends(authority_user),
):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(400, "Upload an MP4, MOV, AVI, or MKV video.")
    if device not in {"auto", "cpu", "0"}:
        raise HTTPException(400, "device must be auto, cpu, or 0.")

    location_values_supplied = any((camera_id, location_name, latitude is not None, longitude is not None))
    camera_location = None
    if location_values_supplied:
        if not location_name or not location_name.strip() or latitude is None or longitude is None:
            raise HTTPException(422, "Provide a location name, latitude, and longitude together.")
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            raise HTTPException(422, "Latitude must be between -90 and 90 and longitude between -180 and 180.")
        camera_location = {
            "camera_id": camera_id.strip() if camera_id else None,
            "location_name": location_name.strip(),
            "latitude": latitude,
            "longitude": longitude,
            "source": location_source,
        }

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
        Path(file.filename or "video").name, device, camera_location,
    )
    return {"analysis_id": analysis_id, "status": "queued"}


@app.get("/api/hotspots")
def get_confirmed_hotspots():
    """Public map feed; only authority-confirmed candidate events are included."""
    try:
        rows = list_confirmed_event_locations()
    except SupabaseAuthError as exc:
        raise _auth_http_error(exc) from exc
    grouped: dict[tuple, dict] = {}
    for row in rows:
        latitude = row.get("latitude")
        longitude = row.get("longitude")
        if not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float)):
            continue
        key = (
            row.get("camera_id") or "",
            row.get("location_name") or "",
            round(float(latitude), 6),
            round(float(longitude), 6),
            row.get("location_source") or "demo",
        )
        hotspot = grouped.setdefault(key, {
            "id": f"{key[0]}:{key[2]}:{key[3]}",
            "cameraId": key[0] or None,
            "locationName": key[1],
            "latitude": key[2],
            "longitude": key[3],
            "source": key[4],
            "reviewStatus": "confirmed",
            "confirmedEventCount": 0,
        })
        hotspot["confirmedEventCount"] += 1
    return list(grouped.values())


@app.get("/api/analyses/{analysis_id}")
def get_analysis(analysis_id: str, _user: dict = Depends(authority_user)):
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
def get_analysis_events(analysis_id: str, _user: dict = Depends(authority_user)):
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


@app.post("/api/analyses/{analysis_id}/events/{event_id}/review")
def review_analysis_event(
    analysis_id: str,
    event_id: str,
    payload: ReviewBody,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    _user: dict = Depends(authority_user),
):
    if credentials is None:
        raise HTTPException(401, "Sign in again before saving this review.")
    with analysis_lock:
        analysis = analyses.get(analysis_id)
        if analysis is None:
            raise HTTPException(404, "Analysis not found. It may have been cleared by a server restart.")
        if analysis.get("status") != "completed" or not analysis.get("result"):
            raise HTTPException(409, "Wait until the analysis has completed before reviewing events.")
        events = analysis["result"].get("events", [])
        event = next((item for item in events if str(item.get("event_id")) == event_id), None)
        if event is None:
            raise HTTPException(404, "Candidate event not found.")
        if event.get("review_status") != "pending":
            raise HTTPException(409, "This candidate already has a review decision.")
        camera_location = analysis["result"].get("camera_location")
        if not isinstance(camera_location, dict):
            raise HTTPException(422, "This analysis has no supplied camera location to publish.")
        updated_event = {**event, "review_status": payload.decision, "review_note": payload.note.strip()}
        try:
            save_event_review(
                analysis_id,
                updated_event,
                camera_location,
                credentials.credentials,
            )
        except SupabaseAuthError as exc:
            raise _auth_http_error(exc) from exc
        event.update(updated_event)
        result_dir = RESULTS / analysis_id
        (result_dir / "events.json").write_text(json.dumps(events, indent=2), encoding="utf-8")
    return {"analysis_id": analysis_id, "event": event}


@app.get("/api/analyses/{analysis_id}/video")
def get_analysis_video(analysis_id: str, _user: dict = Depends(authority_user)):
    analysis = analyses.get(analysis_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    if analysis["status"] != "completed":
        raise HTTPException(status_code=409, detail="Analysis has not completed yet.")
    video_path = RESULTS / analysis_id / "annotated.mp4"
    if not video_path.is_file():
        raise HTTPException(status_code=404, detail="Annotated video is unavailable.")
    return FileResponse(video_path, media_type="video/mp4", filename="annotated.mp4")


@app.get("/api/analyses/{analysis_id}/tracking")
def get_analysis_tracking(analysis_id: str, _user: dict = Depends(authority_user)):
    analysis = analyses.get(analysis_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    if analysis["status"] != "completed":
        raise HTTPException(status_code=409, detail="Analysis has not completed yet.")
    tracking_path = RESULTS / analysis_id / "tracking.jsonl"
    if not tracking_path.is_file():
        raise HTTPException(status_code=404, detail="Tracking output is unavailable.")
    return FileResponse(
        tracking_path,
        media_type="application/x-ndjson",
        filename="tracking.jsonl",
    )
