import importlib
import json
import shutil
import tempfile
from pathlib import Path
from uuid import uuid4

import cv2
import numpy as np
import pytest
import ultralytics

from backend.app.config import TrackingConfig
from backend.roadwatch_engine.src.annotated_video import render_candidate_video
from backend.roadwatch_engine.src.object_tracking import run_tracking_video


@pytest.fixture
def tmp_path():
    """Use a unique disposable folder under this checkout (sandbox writable)."""
    path = Path(__file__).parent / f".integration-test-{uuid4().hex}"
    path.mkdir()
    try:
        yield path
    finally:
        shutil.rmtree(path)


class FakeTensor:
    def __init__(self, values):
        self.values = values

    def cpu(self):
        return self

    def tolist(self):
        return self.values

    def int(self):
        return self


class FakeBoxes:
    def __init__(self, frame_index):
        self.xyxy = FakeTensor([[5 + frame_index, 5, 25 + frame_index, 25]])
        self.cls = FakeTensor([2])
        self.conf = FakeTensor([0.9])
        self.id = FakeTensor([14])

    def __len__(self):
        return 1


class FakeResult:
    names = {2: "car"}

    def __init__(self, frame_index, frame):
        self.boxes = FakeBoxes(frame_index)
        self.orig_img = frame


class FakeModel:
    def __init__(self, _weights):
        self.calls = 0

    def track(self, frame, **kwargs):
        assert kwargs["persist"] is True
        assert kwargs["tracker"] == "bytetrack.yaml"
        result = FakeResult(self.calls, frame)
        self.calls += 1
        return [result]


class MissingIdModel(FakeModel):
    def track(self, frame, **kwargs):
        results = super().track(frame, **kwargs)
        results[0].boxes.id = None
        return results

def test_importing_selected_tracker_has_no_video_or_file_side_effects(monkeypatch):
    module_name = "backend.roadwatch_engine.src.object_tracking"

    class FakeModel:
        def __init__(self, _weights):
            pass

        def track(self, **_kwargs):
            return iter(())

    monkeypatch.setattr(ultralytics, "YOLO", FakeModel)
    with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as temporary_dir:
        tmp_path = Path(temporary_dir)
        monkeypatch.chdir(tmp_path)
        (tmp_path / "data" / "videos").mkdir(parents=True)
        (tmp_path / "output").mkdir()
        module = importlib.import_module(module_name)
        importlib.reload(module)
        monkeypatch.chdir(Path(__file__).parents[1])

        assert not (tmp_path / "output" / "tracked_objects.json").exists()


def test_api_uses_selected_vicky_tracker_and_near_miss_analyzer():
    from backend.app import main

    assert main.run_tracking_video.__module__ == "backend.roadwatch_engine.src.object_tracking"
    assert main.analyze_near_misses.__module__ == "backend.roadwatch_engine.src.near_miss"


def test_selected_tracker_runs_byte_track_and_writes_actual_schema(tmp_path):
    source = tmp_path / "source.mp4"
    writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*"mp4v"), 10, (64, 48))
    assert writer.isOpened()
    for _ in range(3):
        writer.write(np.zeros((48, 64, 3), dtype=np.uint8))
    writer.release()

    metadata = run_tracking_video(
        source,
        TrackingConfig(output_dir=tmp_path / "run", device="cpu", video_name="annotated_tracking.mp4"),
        model_factory=FakeModel,
    )
    records = [json.loads(line) for line in Path(metadata["records_output"]).read_text().splitlines()]
    assert metadata["frames_processed"] == metadata["output_frames"] == 3
    assert metadata["detections"] == 3
    assert [record["track_id"] for record in records] == [14, 14, 14]
    assert records[1]["frame"] == 1
    assert records[1]["timestamp_seconds"] == 0.1
    assert records[1]["bottom_center"] == [16.0, 25.0]
    assert Path(metadata["video_output"]).is_file()


def test_selected_tracker_keeps_missing_track_ids_null(tmp_path):
    source = tmp_path / "missing-id.mp4"
    writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*"mp4v"), 10, (64, 48))
    assert writer.isOpened()
    for _ in range(3):
        writer.write(np.zeros((48, 64, 3), dtype=np.uint8))
    writer.release()

    metadata = run_tracking_video(
        source,
        TrackingConfig(output_dir=tmp_path / "run-missing", device="cpu"),
        model_factory=MissingIdModel,
    )
    record = json.loads(Path(metadata["records_output"]).read_text().splitlines()[0])
    assert record["track_id"] is None
    assert metadata["missing_id_records"] == 3
    assert metadata["unique_track_ids"] == 0


def test_final_video_overlays_candidate_only_within_event_frames(tmp_path):
    source = tmp_path / "tracking.mp4"
    writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*"mp4v"), 10, (96, 64))
    assert writer.isOpened()
    for _ in range(5):
        writer.write(np.zeros((64, 96, 3), dtype=np.uint8))
    writer.release()

    result = render_candidate_video(
        source,
        tmp_path / "final.mp4",
        [{"start_frame": 1, "end_frame": 2, "object_ids": [4, 9]}],
    )
    assert result["frames_written"] == 5
    assert result["frames_with_candidate_overlay"] == 2
    assert Path(result["video_output"]).is_file()


def test_analysis_pipeline_uses_selected_analyzer_and_preserves_api_artifacts(monkeypatch, tmp_path):
    from backend.app import main

    run_id = "synthetic-analysis"
    result_root = tmp_path / "results"
    source = tmp_path / "upload.mp4"
    source.write_bytes(b"synthetic placeholder consumed by mocked tracker")
    result_dir = result_root / run_id

    def fake_tracking(video_path, config):
        config.output_dir.mkdir(parents=True, exist_ok=True)
        records_path = config.output_dir / config.records_name
        video_path_out = config.output_dir / config.video_name
        video_path_out.write_bytes(b"mock tracking video")
        with records_path.open("w", encoding="utf-8") as output:
            for frame, distance in enumerate((60, 40, 20, 40, 60)):
                car_x = 100
                person_x = car_x + distance
                for track_id, class_id, class_name, center_x in (
                    (1, 2, "car", car_x), (2, 0, "person", person_x)
                ):
                    record = {
                        "frame": frame,
                        "timestamp_seconds": frame / 10,
                        "track_id": track_id,
                        "class_id": class_id,
                        "class_name": class_name,
                        "confidence": 0.9,
                        "bbox": [center_x - 5, 10, center_x + 5, 30],
                        "bottom_center": [center_x, 30],
                    }
                    output.write(json.dumps(record) + "\n")
        return {
            "fps": 10.0,
            "frames_processed": 5,
            "resolution": [320, 240],
            "records_output": str(records_path),
            "video_output": str(video_path_out),
        }

    def fake_render(_source, output_path, _events):
        output_path.write_bytes(b"mock final video")
        return {"video_output": str(output_path), "frames_written": 5}

    monkeypatch.setattr(main, "RESULTS", result_root)
    monkeypatch.setattr(main, "run_tracking_video", fake_tracking)
    monkeypatch.setattr(main, "render_candidate_video", fake_render)
    main.analyses[run_id] = {"status": "queued", "result": None, "error": None}

    main._process_analysis(run_id, source, "short.mp4", "cpu")

    state = main.analyses.pop(run_id)
    assert state["status"] == "completed"
    event = state["result"]["events"][0]
    assert event["status"] == "candidate_for_human_review"
    assert event["object_ids"] == [1, 2]
    assert event["peak_time_seconds"] == 0.2
    assert (result_dir / "annotated.mp4").is_file()
    assert (result_dir / "annotated_tracking.mp4").is_file()
    persisted = json.loads((result_dir / "metadata.json").read_text())
    assert persisted["candidate_event_count"] == 1
    assert persisted["tracking_video_output"].endswith("annotated_tracking.mp4")


def test_api_exposes_exact_file_upload_and_event_response_contract():
    import inspect
    from backend.app import main

    signature = inspect.signature(main.analyze_video)
    assert signature.parameters["file"].default.alias == "file"
    assert signature.parameters["camera_id"].default.default is None
    route_contract = main.app.openapi()["paths"]["/api/analyze"]["post"]
    request_schema = route_contract["requestBody"]["content"]["multipart/form-data"]["schema"]
    schema_ref = request_schema.get("$ref", "").rsplit("/", 1)[-1]
    multipart_schema = main.app.openapi()["components"]["schemas"][schema_ref]
    assert multipart_schema["required"] == ["file"]
    assert any(
        parameter["name"] == "device" for parameter in route_contract.get("parameters", [])
    )
    assert "/api/analyses/{analysis_id}" in main.app.openapi()["paths"]
    assert "/api/analyses/{analysis_id}/events" in main.app.openapi()["paths"]

    event = {"event_id": "event-1", "status": "candidate_for_human_review"}
    main.analyses["completed-contract"] = {
        "status": "completed",
        "error": None,
        "result": {"events_available": True, "events": [event], "metadata": {"fps": 25}},
    }
    try:
        status = main.get_analysis("completed-contract", _user={"role": "authority"})
        assert status["result"]["metadata"]["fps"] == 25
        events = main.get_analysis_events("completed-contract", _user={"role": "authority"})
        assert events == {
            "analysis_id": "completed-contract",
            "events_available": True,
            "events": [event],
            "message": None,
        }
    finally:
        main.analyses.pop("completed-contract", None)

