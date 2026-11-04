"""Frame-by-frame detection and tracking export; no event classification."""
from datetime import datetime, timezone
import json
from pathlib import Path
import time
import cv2
import numpy as np

from .config import TrackingConfig
from .detector import RoadUserDetector, select_device
from .schemas import TrackingRecord
from .video_io import VideoInput, open_writer


def bottom_center(bbox):
    x1, y1, x2, y2 = bbox
    return ((x1 + x2) / 2.0, y2)


def timestamp_for_frame(frame: int, fps: float) -> float:
    return round(frame / (fps if fps > 0 else 25.0), 6)


def _names(result):
    names = result.names
    return names if isinstance(names, dict) else dict(enumerate(names))


def _records(result, frame_index, fps):
    boxes = result.boxes
    if boxes is None or len(boxes) == 0:
        return []
    coords = boxes.xyxy.cpu().tolist()
    classes = boxes.cls.cpu().tolist()
    confidences = boxes.conf.cpu().tolist()
    ids = boxes.id.int().cpu().tolist() if boxes.id is not None else [None] * len(coords)
    names = _names(result)
    records = []
    for box, cls_id, conf, track_id in zip(coords, classes, confidences, ids):
        bbox = tuple(float(v) for v in box)
        class_id = int(cls_id)
        records.append(TrackingRecord(frame_index, timestamp_for_frame(frame_index, fps),
                                      int(track_id) if track_id is not None else None,
                                      class_id, str(names.get(class_id, class_id)), float(conf),
                                      bbox, bottom_center(bbox)))
    return records


def _annotate(frame, records, zones):
    output = frame.copy()
    for poly in zones:
        points = np.array(poly, dtype=np.int32).reshape((-1, 1, 2))
        cv2.polylines(output, [points], True, (0, 220, 255), 2)
    for record in records:
        x1, y1, x2, y2 = (int(round(v)) for v in record.bbox)
        label = f"{record.class_name} id:{record.track_id if record.track_id is not None else 'N/A'} {record.confidence:.2f}"
        cv2.rectangle(output, (x1, y1), (x2, y2), (50, 220, 50), 2)
        cv2.circle(output, tuple(int(round(v)) for v in record.bottom_center), 4, (0, 0, 255), -1)
        cv2.putText(output, label, (x1, max(18, y1 - 7)), cv2.FONT_HERSHEY_SIMPLEX, .5, (50, 220, 50), 2)
    return output


def run_tracking(video_path: str | Path, config: TrackingConfig,
                 detector=None, progress_callback=None) -> dict:
    started = time.perf_counter()
    selected_device = select_device(config.device)
    source = VideoInput(video_path)
    output_dir = Path(config.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    video_out = output_dir / config.video_name
    records_out = output_dir / config.records_name
    writer = None
    records_count = missing_id_count = frame_index = 0
    unique_ids = set()
    try:
        writer = open_writer(video_out, source.fps, (source.width, source.height))
        detector = detector or RoadUserDetector(config.model, selected_device, config.confidence, config.image_size)
        with records_out.open("w", encoding="utf-8", newline="\n") as output:
            while True:
                ok, frame = source.read()
                if not ok:
                    break
                result = detector.track(frame)
                frame_records = _records(result, frame_index, source.fps)
                for record in frame_records:
                    output.write(record.to_json() + "\n")
                    records_count += 1
                    if record.track_id is None:
                        missing_id_count += 1
                    else:
                        unique_ids.add(record.track_id)
                writer.write(_annotate(frame, frame_records, config.road_zones))
                frame_index += 1
                if progress_callback:
                    progress_callback(frame_index, source.frame_count)
        if frame_index == 0:
            raise ValueError("Video contained no decodable frames")
    except Exception:
        records_out.unlink(missing_ok=True)
        video_out.unlink(missing_ok=True)
        raise
    finally:
        source.release()
        if writer is not None:
            writer.release()
    # Reopen output to catch codec/container failures and verify frames are present.
    check = cv2.VideoCapture(str(video_out))
    if not check.isOpened():
        raise ValueError(f"Generated output video cannot be reopened: {video_out}")
    output_frames = int(check.get(cv2.CAP_PROP_FRAME_COUNT))
    ok, _ = check.read()
    check.release()
    if not ok or output_frames <= 0:
        raise ValueError(f"Generated output video is empty or unreadable: {video_out}")
    metadata = {"input": str(video_path), "model": config.model, "device": selected_device,
                "resolution": [source.width, source.height], "fps": source.fps,
                "fps_metadata_valid": source.fps_valid, "reported_frame_count": source.frame_count,
                "frames_processed": frame_index, "output_frames": output_frames,
                "detections": records_count, "unique_track_ids": len(unique_ids),
                "missing_id_records": missing_id_count,
                "processing_seconds": round(time.perf_counter() - started, 3),
                "video_output": str(video_out), "records_output": str(records_out),
                "completed_at": datetime.now(timezone.utc).isoformat()}
    (output_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return metadata
