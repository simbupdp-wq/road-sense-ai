"""Ultralytics YOLO + persistent ByteTrack adapter."""
import torch
from ultralytics import YOLO


def select_device(requested: str) -> str:
    if requested == "cpu":
        return "cpu"
    available = torch.cuda.is_available()
    if requested == "0" and not available:
        raise RuntimeError("CUDA device 0 was requested, but CUDA-enabled PyTorch is unavailable")
    return "0" if available else "cpu"


class RoadUserDetector:
    def __init__(self, model_path: str, device: str, confidence: float, image_size: int):
        self.model = YOLO(model_path)
        self.device = device
        self.confidence = confidence
        self.image_size = image_size

    def track(self, frame):
        return self.model.track(frame, persist=True, tracker="bytetrack.yaml",
                                conf=self.confidence, imgsz=self.image_size,
                                device=self.device, classes=[0, 1, 2, 3, 5, 7],
                                verbose=False)[0]
