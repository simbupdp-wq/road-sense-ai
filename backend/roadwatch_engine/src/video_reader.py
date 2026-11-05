import cv2

video = cv2.VideoCapture("data/videos/traffic.mp4")

if not video.isOpened():
    print("Cannot open video")
    exit()

fps = video.get(cv2.CAP_PROP_FPS)
total_frames = int(video.get(cv2.CAP_PROP_FRAME_COUNT))

print("FPS:", fps)
print("Total frames:", total_frames)

count = 0
saved = 0

while True:
    success, frame = video.read()

    if not success:
        break

    # Save every 30th frame
    if count % 30 == 0:
        filename = f"data/frames/frame_{saved}.jpg"
        cv2.imwrite(filename, frame)
        saved += 1

    count += 1

video.release()

print("Frames extracted:", saved)