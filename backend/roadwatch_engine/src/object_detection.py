from ultralytics import YOLO
import cv2

# Load pretrained YOLO model
model = YOLO("yolo11n.pt")

# Open traffic video
video = cv2.VideoCapture("data/videos/traffic.mp4")

success, frame = video.read()

if success:
    results = model(frame)

    # Display detected objects
    output = results[0].plot()

    cv2.imshow("RoadWatch AI - Object Detection", output)
    cv2.waitKey(0)

video.release()
cv2.destroyAllWindows()