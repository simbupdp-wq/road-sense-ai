"""CLI: python -m app.run_tracking --video ..."""
import argparse
import json
import sys
import time
from pathlib import Path

from .config import TrackingConfig
from .tracking_pipeline import run_tracking


def main(argv=None):
    parser = argparse.ArgumentParser(description="YOLO + ByteTrack video tracking")
    parser.add_argument("--video", required=True, help="Input traffic video path")
    parser.add_argument("--model", default="yolo11n.pt")
    parser.add_argument("--output-dir", default="outputs")
    parser.add_argument("--device", choices=("auto", "0", "cpu"), default="auto")
    parser.add_argument("--confidence", type=float, default=.25)
    parser.add_argument("--image-size", type=int, default=640)
    parser.add_argument("--video-name", default="annotated.mp4")
    parser.add_argument("--records-name", default="tracking.jsonl")
    args = parser.parse_args(argv)
    try:
        config = TrackingConfig(args.model, Path(args.output_dir), args.device, args.confidence,
                               args.image_size, args.video_name, args.records_name)
        print(f"Input: {args.video}\nModel: {config.model}\nRequested device: {config.device}")
        last = 0
        def progress(done, total):
            nonlocal last
            if done - last >= 30 or (total > 0 and done == total):
                print(f"Processed {done}/{total if total > 0 else '?'} frames", flush=True)
                last = done
        result = run_tracking(args.video, config, progress_callback=progress)
        print(json.dumps(result, indent=2))
        return 0
    except Exception as exc:
        print(f"Tracking failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
