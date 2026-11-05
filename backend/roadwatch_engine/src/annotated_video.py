"""Render candidate review banners over an existing tracked video."""

from __future__ import annotations

from pathlib import Path

import cv2


def render_candidate_video(input_video: str | Path, output_video: str | Path, events: list[dict]) -> dict:
    """Copy a tracking video and mark only candidate event frame ranges.

    The renderer does not run detection or classify events. It consumes event
    frame ranges and writes clear review labels; the source video is unchanged.
    """
    source_path = Path(input_video).resolve()
    output_path = Path(output_video).resolve()
    if not source_path.is_file():
        raise FileNotFoundError(f"Tracking video does not exist: {source_path}")
    if source_path == output_path:
        raise ValueError("The final annotated video must not overwrite its tracking input.")
    if output_path.exists():
        raise FileExistsError(f"Final annotated video already exists: {output_path}")

    cap = cv2.VideoCapture(str(source_path))
    if not cap.isOpened():
        cap.release()
        raise ValueError(f"Cannot open tracking video: {source_path}")
    fps = float(cap.get(cv2.CAP_PROP_FPS))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if fps <= 0 or width <= 0 or height <= 0:
        cap.release()
        raise ValueError("Tracking video has invalid FPS or dimensions.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(
        str(output_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height)
    )
    if not writer.isOpened():
        cap.release()
        writer.release()
        raise ValueError(f"Cannot create final annotated video: {output_path}")

    normalized_events = []
    for event in events:
        try:
            start = int(event["start_frame"])
            end = int(event["end_frame"])
        except (KeyError, TypeError, ValueError) as exc:
            cap.release()
            writer.release()
            output_path.unlink(missing_ok=True)
            raise ValueError("Each candidate event needs integer start_frame and end_frame values.") from exc
        if start < 0 or end < start:
            cap.release()
            writer.release()
            output_path.unlink(missing_ok=True)
            raise ValueError("Candidate event frame range is invalid.")
        raw_ids = event.get("object_ids", [])
        actor_text = ", ".join(str(item) for item in raw_ids) if isinstance(raw_ids, list) else "unavailable"
        normalized_events.append((start, end, actor_text))

    frames_written = 0
    frames_with_candidate_overlay = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            active = [item for item in normalized_events if item[0] <= frames_written <= item[1]]
            if active:
                frames_with_candidate_overlay += 1
                overlay_height = min(70, height)
                cv2.rectangle(frame, (0, 0), (width, overlay_height), (0, 145, 225), -1)
                labels = [f"CANDIDATE - REVIEW | tracks: {actor_text}" for _, _, actor_text in active]
                label = "   |   ".join(labels)[:220]
                cv2.putText(
                    frame, label, (12, min(44, height - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2,
                )
            writer.write(frame)
            frames_written += 1
        if frames_written == 0:
            raise ValueError("Tracking video contains no decodable frames.")
    except Exception:
        output_path.unlink(missing_ok=True)
        raise
    finally:
        cap.release()
        writer.release()

    verification = cv2.VideoCapture(str(output_path))
    try:
        try:
            if not verification.isOpened():
                raise ValueError(f"Final annotated video cannot be reopened: {output_path}")
            output_frames = 0
            while verification.read()[0]:
                output_frames += 1
            if output_frames == 0:
                raise ValueError(f"Final annotated video is empty or unreadable: {output_path}")
        finally:
            verification.release()
    except Exception:
        output_path.unlink(missing_ok=True)
        raise
    if output_frames != frames_written:
        output_path.unlink(missing_ok=True)
        raise ValueError(
            f"Final video frame count mismatch: wrote {frames_written}, reopened {output_frames}."
        )
    return {
        "video_output": str(output_path),
        "frames_written": frames_written,
        "frames_with_candidate_overlay": frames_with_candidate_overlay,
        "fps": fps,
    }
