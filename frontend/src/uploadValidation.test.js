import { describe, expect, it } from 'vitest';
import { formatFileSize, validateAnalysisUpload } from './uploadValidation.js';

describe('video upload validation', () => {
  it('requires a supported video file without requiring camera metadata', () => {
    expect(validateAnalysisUpload(null)).toMatch(/select a video/i);
    expect(validateAnalysisUpload(new File(['x'], 'street.txt'))).toMatch(/choose mp4/i);
    expect(validateAnalysisUpload(new File(['x'], 'street.mp4'))).toBeNull();
  });

  it('formats local file size for display', () => {
    expect(formatFileSize(4)).toBe('4 B');
    expect(formatFileSize(1024)).toBe('1 KB');
  });
});
