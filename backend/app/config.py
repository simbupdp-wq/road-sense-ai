"""Validated configuration for local video tracking."""
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_MODEL = "yolo11n.pt"
DEFAULT_OUTPUT_DIR = Path("outputs")
SUPPORTED_CLASSES = (0, 1, 2, 3, 5, 7)


@dataclass(frozen=True)
class TrackingConfig:
    model: str = DEFAULT_MODEL
    output_dir: Path = DEFAULT_OUTPUT_DIR
    device: str = "auto"
    confidence: float = 0.25
    image_size: int = 640
    video_name: str = "annotated.mp4"
    records_name: str = "tracking.jsonl"
    road_zones: tuple[tuple[tuple[float, float], ...], ...] = field(default_factory=tuple)

    def __post_init__(self):
        if not self.model.strip():
            raise ValueError("Model name/path cannot be empty")
        if self.device not in {"auto", "cpu", "0"}:
            raise ValueError("device must be 'auto', 'cpu', or '0'")
        if not 0 < self.confidence <= 1:
            raise ValueError("confidence must be greater than 0 and at most 1")
        if self.image_size < 32:
            raise ValueError("image_size must be at least 32")
        if Path(self.video_name).name != self.video_name or Path(self.records_name).name != self.records_name:
            raise ValueError("Output filenames must not include directory components")
        for polygon in self.road_zones:
            if len(polygon) < 3 or any(len(point) != 2 for point in polygon):
                raise ValueError("Each road-zone polygon needs at least three (x, y) points")
            if any(not all(isinstance(v, (int, float)) for v in point) for point in polygon):
                raise ValueError("Road-zone coordinates must be numeric image-space (x, y) pairs")
