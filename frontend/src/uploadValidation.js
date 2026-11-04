const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm']);

export function validateAnalysisUpload(file, cameraId) {
  if (!file) return 'Select a video file.';
  const extension = file.name?.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!VIDEO_EXTENSIONS.has(extension)) return 'Choose MP4, MOV, MKV, AVI, or WebM video.';
  if (typeof cameraId !== 'string' || !cameraId.trim()) return 'Enter a camera ID.';
  return null;
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes % 1024 === 0 ? 0 : 1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
