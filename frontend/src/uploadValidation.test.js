import { describe, expect, it } from 'vitest';
import { formatFileSize, validateAnalysisUpload } from './uploadValidation.js';

describe('video upload validation', () => {
  it('requires both a supported video and a camera ID', () => {
    expect(validateAnalysisUpload(null, 'cam-1')).toMatch(/select a video/i);
    expect(validateAnalysisUpload(new File(['x'], 'clip.mp4', { type: 'video/mp4' }), '  ')).toMatch(/camera id/i);
  });

  it('accepts documented video extensions and rejects unsupported files', () => {
    expect(validateAnalysisUpload(new File(['x'], 'street.MOV'), 'cam-1')).toBeNull();
    expect(validateAnalysisUpload(new File(['x'], 'notes.pdf', { type: 'application/pdf' }), 'cam-1')).toMatch(/mp4.*mov.*mkv.*avi.*webm/i);
  });

  it('formats file sizes without inventing missing values', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(null)).toBe('—');
  });
});
