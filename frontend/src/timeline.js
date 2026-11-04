export function getEventSeekSeconds(event, frameRate) {
  if (!event) return null;
  const value = event.peak_timestamp_seconds
    ?? event.start_timestamp_seconds
    ?? event.timestamp_seconds;
  if (value !== null && value !== undefined && Number.isFinite(Number(value))) {
    return Math.max(0, Number(value));
  }
  const frame = event.peak_frame ?? event.start_frame ?? event.frame;
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
