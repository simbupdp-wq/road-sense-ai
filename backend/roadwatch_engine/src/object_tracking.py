from ultralytics import YOLO
import cv2
import json

model = YOLO("yolo11n.pt")

video_path = "data/videos/traffic.mp4"

results = model.track(
    source=video_path,
    tracker="bytetrack.yaml",
    persist=True,
    stream=True
)

tracked_objects = []
frame_number = 0

for result in results:

    if result.boxes.id is not None:

        boxes = result.boxes.xyxy.cpu().numpy()
        ids = result.boxes.id.int().cpu().numpy()
        classes = result.boxes.cls.int().cpu().numpy()

        for box, track_id, class_id in zip(boxes, ids, classes):

            x1, y1, x2, y2 = box

            tracked_objects.append({
                "frame": frame_number,
                "object_id": int(track_id),
                "class": model.names[int(class_id)],
                "x": float((x1 + x2) / 2),
                "y": float((y1 + y2) / 2)
            })

    frame_number += 1

with open("output/tracked_objects.json", "w") as file:
    json.dump(tracked_objects, file, indent=2)

print("Tracking data saved!")
print("Total tracked detections:", len(tracked_objects))