
from ultralytics import YOLO
import cv2
import json
from collections import defaultdict, deque, Counter

print("Starting RoadWatch AI video processing...")

model = YOLO("yolo11n.pt")

video_path = "data/videos/traffic.mp4"

with open("output/collision_events.json", "r") as file:
    collision_events = json.load(file)
with open("output/near_miss_events.json", "r") as file:
    near_miss_events = json.load(file)

cap = cv2.VideoCapture(video_path)

fps = cap.get(cv2.CAP_PROP_FPS)
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

cap.release()

writer = cv2.VideoWriter(
    "output/annotated_traffic.mp4",
    cv2.VideoWriter_fourcc(*"mp4v"),
    fps,
    (width, height)
)

# Store recent class predictions for each tracking ID
class_history = defaultdict(lambda: deque(maxlen=15))
stable_classes = {}

# Relevant road users
allowed_classes = [
    "person", "bicycle", "car",
    "motorcycle", "bus", "truck"
]

results = model.track(
    source=video_path,
    tracker="bytetrack.yaml",
    persist=True,
    stream=True,
    conf=0.35
)

frame_number = 0

for result in results:

    frame = result.orig_img.copy()

    if result.boxes.id is not None:

        boxes = result.boxes.xyxy.cpu().numpy()
        ids = result.boxes.id.int().cpu().numpy()
        classes = result.boxes.cls.int().cpu().numpy()
        confidences = result.boxes.conf.cpu().numpy()

        for box, track_id, class_id, confidence in zip(
            boxes, ids, classes, confidences
        ):

            raw_class = model.names[int(class_id)]

            if raw_class not in allowed_classes:
                continue

            class_history[int(track_id)].append(raw_class)

            counts = Counter(class_history[int(track_id)])
            best_class, votes = counts.most_common(1)[0]

            if votes >= 3:
                stable_classes[int(track_id)] = best_class

            display_class = stable_classes.get(
                int(track_id), raw_class
            )

            x1, y1, x2, y2 = map(int, box)

            color = (0, 255, 0)

            cv2.rectangle(
                frame, (x1, y1), (x2, y2), color, 2
            )

            label = (
                f"ID:{int(track_id)} "
                f"{display_class} {confidence:.2f}"
            )

            cv2.putText(
                frame,
                label,
                (x1, max(y1 - 10, 25)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                color,
                2
            )

    # Collision alerts
    for event in collision_events:

        start = event["start_frame"]
        end = event["end_frame"]

        if start <= frame_number <= end:

            cv2.rectangle(
                frame, (0, 0), (width, 65), (0, 0, 255), -1
            )

            cv2.putText(
                frame,
                "SUSPECTED COLLISION DETECTED",
                (30, 43),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.9,
                (255, 255, 255),
                2
            )
        # Near-miss alerts
    for event in near_miss_events:

        start = event["start_frame"]
        end = event["end_frame"]

        if start <= frame_number <= end:

            cv2.rectangle(
                frame, (0, 70), (width, 135), (0, 165, 255), -1
            )

            cv2.putText(
                frame,
                f"POTENTIAL NEAR-MISS - {event['risk']} RISK",
                (30, 115),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.9,
                (255, 255, 255),
                2
            )
    writer.write(frame)
    frame_number += 1

writer.release()

print("Annotated video created successfully!")
print("Saved: output/annotated_traffic.mp4")
