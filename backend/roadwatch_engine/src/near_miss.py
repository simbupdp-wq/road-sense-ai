
import json
import math
from collections import defaultdict

# Load ByteTrack output
with open("output/tracked_objects.json", "r") as file:
    tracked_objects = json.load(file)

# Group objects by frame
frames = defaultdict(list)

for obj in tracked_objects:
    frames[obj["frame"]].append(obj)

# Detection settings
DISTANCE_THRESHOLD = 150
MIN_CONSECUTIVE_FRAMES = 3

# Relevant object pairs
RELEVANT_CLASSES = {
    ("car", "car"),
    ("car", "person"),
    ("bus", "person"),
    ("truck", "person"),
    ("motorcycle", "person"),
    ("car", "bicycle"),
    ("bus", "bicycle"),
    ("truck", "bicycle"),
    ("motorcycle", "bicycle")
}

interactions = defaultdict(list)

# Compare object pairs in every frame
for frame_number, objects in frames.items():

    for i in range(len(objects)):
        for j in range(i + 1, len(objects)):

            a = objects[i]
            b = objects[j]

            pair_classes = (a["class"], b["class"])
            reverse_classes = (b["class"], a["class"])

            if (pair_classes not in RELEVANT_CLASSES
                    and reverse_classes not in RELEVANT_CLASSES):
                continue

            distance = math.sqrt(
                (a["x"] - b["x"]) ** 2 +
                (a["y"] - b["y"]) ** 2
            )

            if distance <= DISTANCE_THRESHOLD:

                ids = tuple(sorted([
                    a["object_id"],
                    b["object_id"]
                ]))

                interactions[ids].append({
                    "frame": frame_number,
                    "distance": distance,
                    "classes": [a["class"], b["class"]]
                })

# Group consecutive close interactions
events = []

for ids, detections in interactions.items():

    detections.sort(key=lambda x: x["frame"])

    groups = []
    current_group = []

    for detection in detections:

        if not current_group:
            current_group.append(detection)

        elif detection["frame"] == current_group[-1]["frame"] + 1:
            current_group.append(detection)

        else:
            if len(current_group) >= MIN_CONSECUTIVE_FRAMES:
                groups.append(current_group)

            current_group = [detection]

    if len(current_group) >= MIN_CONSECUTIVE_FRAMES:
        groups.append(current_group)

    for group in groups:

        minimum_distance = min(
            item["distance"] for item in group
        )
                    # Check vehicle movement
        min_index = min(
            range(len(group)),
            key=lambda i: group[i]["distance"]
        )

        approach = group[0]["distance"] - minimum_distance
        separation = group[-1]["distance"] - minimum_distance

        if min_index == 0 or min_index == len(group) - 1:
            continue

        if approach < 10 or separation < 10:
            continue

        if minimum_distance <= 30:
            risk = "HIGH"
        elif minimum_distance <= 55:
            risk = "MEDIUM"
        else:
            risk = "LOW"
        

        events.append({
            "object_ids": list(ids),
            "classes": group[0]["classes"],
            "start_frame": group[0]["frame"],
            "peak_frame": min(
                group, key=lambda x: x["distance"]
            )["frame"],
            "end_frame": group[-1]["frame"],
            "minimum_distance_pixels": round(
                minimum_distance, 2
            ),
            "risk": risk,
            "status": "candidate_for_human_review"
        })

# Save candidate events
with open("output/near_miss_events.json", "w") as file:
    json.dump(events, file, indent=4)

print("Near-miss analysis completed!")
print("Candidate events:", len(events))
print("Saved to output/near_miss_events.json")
