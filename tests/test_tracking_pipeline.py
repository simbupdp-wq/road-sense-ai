import json
from pathlib import Path
import tempfile
import unittest
import cv2
import numpy as np

from backend.app.config import TrackingConfig
from backend.app.schemas import TrackingRecord
from backend.app.tracking_pipeline import bottom_center, run_tracking, timestamp_for_frame
from backend.app.video_io import VideoInput


class FakeTensor:
    def __init__(self, values): self.values = values
    def cpu(self): return self
    def tolist(self): return self.values
    def int(self): return self


class FakeBoxes:
    def __init__(self):
        self.xyxy = FakeTensor([[10, 5, 30, 25]])
        self.cls = FakeTensor([2])
        self.conf = FakeTensor([.9])
        self.id = None
    def __len__(self): return 1


class FakeResult:
    boxes = FakeBoxes()
    names = {2: "car"}


class FakeDetector:
    def track(self, frame): return FakeResult()


class TrackingPipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = Path(__file__).parents[1] / ".test-tmp"
        self.temp.mkdir(exist_ok=True)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.temp, ignore_errors=True)

    def test_bottom_center_uses_bbox_bottom_midpoint(self):
        self.assertEqual(bottom_center([10, 5, 30, 25]), (20.0, 25.0))

    def test_timestamp_uses_zero_based_frame_and_fallback_fps(self):
        self.assertEqual(timestamp_for_frame(10, 5), 2.0)
        self.assertEqual(timestamp_for_frame(25, 0), 1.0)

    def test_record_serializes_missing_id_as_null(self):
        record = TrackingRecord(0, 0.0, None, 2, "car", .9, (1., 2., 3., 4.), (2., 4.))
        data = json.loads(record.to_json())
        self.assertIsNone(data["track_id"])
        self.assertEqual(data["bottom_center"], [2.0, 4.0])

    def test_config_rejects_invalid_options_and_polygon(self):
        with self.assertRaises(ValueError): TrackingConfig(confidence=0)
        with self.assertRaises(ValueError): TrackingConfig(road_zones=(((1, 2), (3, 4)),))

    def test_video_path_validation(self):
        with self.assertRaises(FileNotFoundError): VideoInput("missing-road-video.mp4")

    def test_unreadable_video_is_rejected(self):
        with tempfile.TemporaryDirectory(dir=self.temp) as tmp:
            bad = Path(tmp) / "empty.mp4"
            bad.write_bytes(b"not a video")
            with self.assertRaises(ValueError): VideoInput(bad)

    def test_pipeline_creates_outputs_and_valid_jsonl(self):
        with tempfile.TemporaryDirectory(dir=self.temp) as tmp:
            root = Path(tmp)
            source = root / "input.mp4"
            writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*"mp4v"), 10, (64, 48))
            self.assertTrue(writer.isOpened())
            for _ in range(3): writer.write(np.zeros((48, 64, 3), dtype=np.uint8))
            writer.release()
            out = root / "nested" / "outputs"
            config = TrackingConfig(output_dir=out, device="cpu")
            result = run_tracking(source, config, detector=FakeDetector())
            self.assertEqual(result["frames_processed"], 3)
            lines = (out / "tracking.jsonl").read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), 3)
            record = json.loads(lines[0])
            self.assertIsNone(record["track_id"])
            self.assertEqual(record["bottom_center"], [20.0, 25.0])
            video = cv2.VideoCapture(str(out / "annotated.mp4"))
            self.assertTrue(video.isOpened())
            ok, _ = video.read()
            video.release()
            self.assertTrue(ok)
            self.assertTrue((out / "metadata.json").is_file())


if __name__ == "__main__": unittest.main()
