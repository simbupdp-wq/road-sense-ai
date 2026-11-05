export function getEventSeekSeconds(event, frameRate) {
  if (!event) return null;
  const peakTime = event.peak_time_seconds;
  if (peakTime !== null && peakTime !== undefined && Number.isFinite(Number(peakTime))) {
    return Math.max(0, Number(peakTime));
  }
  const frame = event.peak_frame;
  const fps = Number(frameRate);
  if (frame !== null && frame !== undefined && Number.isFinite(Number(frame)) && fps > 0 && Number.isFinite(fps)) {
    return Math.max(0, Number(frame) / fps);
  }
  return null;
}

export function isFrameInEventRange(event, frame) {
  if (!event || !Number.isInteger(Number(frame))) return false;
  return Number(frame) >= Number(event.start_frame) && Number(frame) <= Number(event.end_frame);
}
