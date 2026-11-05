
import json
import math
from collections import defaultdict
from pathlib import Path


DISTANCE_THRESHOLD = 150
MIN_CONSECUTIVE_FRAMES = 3

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


def analyze_near_misses(tracked_objects):

    frames = defaultdict(list)

    for obj in tracked_objects:
        frames[obj["frame"]].append(obj)

    interactions = defaultdict(list)

    for frame_number, objects in frames.items():

        for i in range(len(objects)):
            for j in range(i + 1, len(objects)):

                a = objects[i]
                b = objects[j]

                pair_classes = (a["class"], b["class"])
                reverse_classes = (b["class"], a["class"])

                if (
                    pair_classes not in RELEVANT_CLASSES
                    and reverse_classes not in RELEVANT_CLASSES
                ):
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

    return events


# Optional standalone testing
if __name__ == "__main__":

    project_dir = Path(__file__).resolve().parents[1]
    input_path = project_dir / "output" / "tracked_objects.json"
    output_path = project_dir / "output" / "near_miss_events.json"

    with open(input_path, "r") as file:
        tracked_objects = json.load(file)

    events = analyze_near_misses(tracked_objects)

    with open(output_path, "w") as file:
        json.dump(events, file, indent=4)

    print("Near-miss analysis completed!")
    print("Candidate events:", len(events))
