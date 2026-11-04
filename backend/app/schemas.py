"""Tracking output schema and JSONL serialization."""
from dataclasses import asdict, dataclass
import json


@dataclass(frozen=True)
class TrackingRecord:
    frame: int
    timestamp_seconds: float
    track_id: int | None
    class_id: int
    class_name: str
    confidence: float
    bbox: tuple[float, float, float, float]
    bottom_center: tuple[float, float]

    def to_dict(self) -> dict:
        data = asdict(self)
        data["bbox"] = list(self.bbox)
        data["bottom_center"] = list(self.bottom_center)
        return data

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), allow_nan=False)
