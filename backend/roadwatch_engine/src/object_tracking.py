"""Import-safe YOLO + ByteTrack pipeline used by the analysis API.

The original Vicky branch kept its tracker as a top-level script, which ran on
import and used hard-coded input/output paths. This module keeps the same
Ultralytics YOLO tracking and ByteTrack approach while exposing it as a callable
pipeline for the API.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

from backend.app.config import TrackingConfig
from backend.app.schemas import TrackingRecord
from backend.app.video_io import VideoInput, open_writer


def _names(result) -> dict:
    names = result.names
    return names if isinstance(names, dict) else dict(enumerate(names))


def _as_list(values):
    return values.cpu().tolist()


def _records(result, frame_index: int, fps: float) -> list[TrackingRecord]:
    boxes = getattr(result, "boxes", None)
    if boxes is None or len(boxes) == 0:
        return []

    coordinates = _as_list(boxes.xyxy)
    class_ids = _as_list(boxes.cls)
    confidences = _as_list(boxes.conf)
    ids = boxes.id.int().cpu().tolist() if boxes.id is not None else [None] * len(coordinates)
    names = _names(result)
    frame_rate = fps if fps > 0 else 25.0

    records = []
    for box, raw_class_id, confidence, track_id in zip(coordinates, class_ids, confidences, ids):
        x1, y1, x2, y2 = (float(value) for value in box)
        class_id = int(raw_class_id)
        records.append(TrackingRecord(
            frame=frame_index,
            timestamp_seconds=round(frame_index / frame_rate, 6),
            track_id=int(track_id) if track_id is not None else None,
            class_id=class_id,
            class_name=str(names.get(class_id, class_id)),
            confidence=float(confidence),
            bbox=(x1, y1, x2, y2),
            bottom_center=((x1 + x2) / 2.0, y2),
        ))
    return records


def _annotate(frame, records, zones):
    output = frame.copy()
    for polygon in zones:
        points = np.array(polygon, dtype=np.int32).reshape((-1, 1, 2))
        cv2.polylines(output, [points], True, (0, 220, 255), 2)
    for record in records:
        x1, y1, x2, y2 = (int(round(value)) for value in record.bbox)
        color = (54, 190, 84)
        cv2.rectangle(output, (x1, y1), (x2, y2), color, 2)
        cv2.circle(output, tuple(int(round(value)) for value in record.bottom_center), 4, (0, 0, 255), -1)
        track = f"id:{record.track_id}" if record.track_id is not None else "id:N/A"
        label = f"{record.class_name} {track} {record.confidence:.2f}"
        cv2.putText(output, label, (x1, max(18, y1 - 7)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
    return output


def run_tracking_video(
    video_path: str | Path,
    config: TrackingConfig,
    *,
    model_factory=None,
    progress_callback=None,
) -> dict:
    """Track one video and write annotated MP4, JSONL records, and metadata.

    ``model_factory`` is injectable for deterministic tests; production uses
    Ultralytics YOLO and the configured device. The output folder is expected
    to be unique for this analysis and existing files are never overwritten.
    """
    started = time.perf_counter()
    output_dir = Path(config.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    video_out = output_dir / config.video_name
    records_out = output_dir / config.records_name
    metadata_out = output_dir / "metadata.json"
    if any(path.exists() for path in (video_out, records_out, metadata_out)):
        raise FileExistsError(f"Tracking outputs already exist in {output_dir}; choose a new run directory.")

    from backend.app.detector import select_device

    selected_device = select_device(config.device)
    if model_factory is None:
        from ultralytics import YOLO
        model_factory = YOLO

    source = VideoInput(video_path)
    writer = None
    frames_processed = detection_count = missing_id_count = 0
    track_ids = set()
    try:
        try:
            writer = open_writer(video_out, source.fps, (source.width, source.height))
            model = model_factory(config.model)
            with records_out.open("w", encoding="utf-8", newline="\n") as output:
                while True:
                    ok, frame = source.read()
                    if not ok:
                        break
                    results = model.track(
                        frame,
                        persist=True,
                        tracker="bytetrack.yaml",
                        conf=config.confidence,
                        imgsz=config.image_size,
                        device=selected_device,
                        verbose=False,
                    )
                    result = results[0] if isinstance(results, (tuple, list)) else results
                    records = _records(result, frames_processed, source.fps)
                    for record in records:
                        output.write(record.to_json() + "\n")
                        detection_count += 1
                        if record.track_id is None:
                            missing_id_count += 1
                        else:
                            track_ids.add(record.track_id)
                    writer.write(_annotate(frame, records, config.road_zones))
                    frames_processed += 1
                    if progress_callback:
                        progress_callback(frames_processed, source.frame_count)
            if frames_processed == 0:
                raise ValueError(f"Video contains no decodable frames: {video_path}")
        finally:
            source.release()
            if writer is not None:
                writer.release()
    except Exception:
        records_out.unlink(missing_ok=True)
        video_out.unlink(missing_ok=True)
        raise

    check = cv2.VideoCapture(str(video_out))
    try:
        try:
            if not check.isOpened():
                raise ValueError(f"Generated tracking video cannot be reopened: {video_out}")
            output_frames = 0
            while True:
                readable, _ = check.read()
                if not readable:
                    break
                output_frames += 1
            if output_frames == 0:
                raise ValueError(f"Generated tracking video is empty or unreadable: {video_out}")
            if output_frames != frames_processed:
                raise ValueError(
                    f"Tracking video frame count mismatch: processed {frames_processed}, decoded {output_frames}."
                )
        finally:
            check.release()
    except Exception:
        video_out.unlink(missing_ok=True)
        records_out.unlink(missing_ok=True)
        raise

    metadata = {
        "input": str(video_path),
        "model": config.model,
        "device": selected_device,
        "resolution": [source.width, source.height],
        "width": source.width,
        "height": source.height,
        "fps": source.fps,
        "fps_metadata_valid": source.fps_valid,
        "reported_frame_count": source.frame_count,
        "frames_processed": frames_processed,
        "output_frames": output_frames,
        "detections": detection_count,
        "unique_track_ids": len(track_ids),
        "missing_id_records": missing_id_count,
        "processing_seconds": round(time.perf_counter() - started, 3),
        "video_output": str(video_out),
        "records_output": str(records_out),
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    metadata_out.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return metadata


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run YOLO and ByteTrack on one video.")
    parser.add_argument("--video", required=True)
    parser.add_argument("--output", default="outputs/tracking-run")
    parser.add_argument("--model", default="yolo11n.pt")
    parser.add_argument("--device", choices=("auto", "cpu", "0"), default="auto")
    args = parser.parse_args()
    metadata = run_tracking_video(args.video, TrackingConfig(model=args.model, output_dir=Path(args.output), device=args.device))
    print(json.dumps(metadata, indent=2))
