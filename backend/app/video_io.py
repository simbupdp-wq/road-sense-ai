"""OpenCV video input/output helpers."""
from pathlib import Path
import cv2


class VideoInput:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        if not self.path.is_file():
            raise FileNotFoundError(f"Video file does not exist: {self.path}")
        self.capture = cv2.VideoCapture(str(self.path))
        if not self.capture.isOpened():
            self.capture.release()
            raise ValueError(f"Cannot open video: {self.path}")
        self.fps = float(self.capture.get(cv2.CAP_PROP_FPS))
        self.frame_count = int(self.capture.get(cv2.CAP_PROP_FRAME_COUNT))
        self.width = int(self.capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(self.capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.fps_valid = self.fps > 0
        if not self.fps_valid:
            self.fps = 25.0
        ok, first = self.capture.read()
        if not ok or first is None:
            self.capture.release()
            raise ValueError(f"Video contains no decodable frames: {self.path}")
        self.capture.set(cv2.CAP_PROP_POS_FRAMES, 0)

    def read(self):
        return self.capture.read()

    def release(self):
        self.capture.release()


def open_writer(path: str | Path, fps: float, size: tuple[int, int]):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # MP4V is broadly supported by OpenCV on Windows and produces an MP4 container.
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    if not writer.isOpened():
        writer.release()
        raise ValueError(f"Cannot create output video: {path}")
    return writer
