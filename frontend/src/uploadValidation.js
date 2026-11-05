const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi']);
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export function validateAnalysisUpload(file) {
  if (!file) return 'Select a video file.';
  const extension = file.name?.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!VIDEO_EXTENSIONS.has(extension)) return 'Choose an MP4, MOV, MKV, or AVI video.';
  if (!Number.isFinite(file.size) || file.size <= 0) return 'Choose a non-empty video file.';
  if (file.size > MAX_UPLOAD_BYTES) return 'Choose a video that is 200 MB or smaller.';
  return null;
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes % 1024 === 0 ? 0 : 1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
