import cv2
import numpy as np
import json
import os

VIDEO_PATH = "data/videos/traffic.mp4"

cap = cv2.VideoCapture(VIDEO_PATH)

if not cap.isOpened():
    print("Cannot open video")
    exit()

ret, previous = cap.read()

if not ret:
    print("Cannot read video")
    exit()

previous = cv2.resize(previous, (640, 360))
previous_gray = cv2.cvtColor(previous, cv2.COLOR_BGR2GRAY)

motion_values = []
alerts = []
frame_number = 1

print("Starting collision analysis...")

while True:
    ret, frame = cap.read()

    if not ret:
        break

    frame = cv2.resize(frame, (640, 360))
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    flow = cv2.calcOpticalFlowFarneback(
        previous_gray, gray, None,
        0.5, 3, 15, 3, 5, 1.2, 0
    )

    magnitude, _ = cv2.cartToPolar(
        flow[..., 0], flow[..., 1]
    )

    motion = float(np.percentile(magnitude, 95))

    if len(motion_values) >= 10:
        baseline = np.median(motion_values[-10:])

        if motion > max(8, baseline * 3):
            alerts.append({
                "frame": frame_number,
                "motion": round(motion, 2),
                "status": "suspected_impact"
            })

    motion_values.append(motion)
    previous_gray = gray
    frame_number += 1

cap.release()

# Group nearby alerts
events = []

for alert in alerts:
    if not events or alert["frame"] - events[-1]["end_frame"] > 5:
        events.append({
            "start_frame": alert["frame"],
            "end_frame": alert["frame"],
            "peak_motion": alert["motion"],
            "status": alert["status"]
        })
    else:
        events[-1]["end_frame"] = alert["frame"]
        events[-1]["peak_motion"] = max(
            events[-1]["peak_motion"],
            alert["motion"]
        )

os.makedirs("output", exist_ok=True)

with open("output/collision_events.json", "w") as file:
    json.dump(events, file, indent=4)

print("Analysis completed!")
print("Suspected impact events:", len(events))
print("Saved to output/collision_events.json")
print("Review events manually before confirming collisions.")