import { describe, expect, it } from 'vitest';
import { getEventSeekSeconds } from './timeline.js';

describe('event-to-video seek mapping', () => {
  it('uses only a timestamp value supplied in the event data', () => {
    expect(getEventSeekSeconds({ timestamp_seconds: 4.5 })).toBe(4.5);
    expect(getEventSeekSeconds({ start_timestamp_seconds: 3, peak_timestamp_seconds: 7 })).toBe(7);
    expect(getEventSeekSeconds({ timestamp: '00:04.500' })).toBeNull();
  });

  it('uses a frame only when a finite positive frame rate is also supplied', () => {
    expect(getEventSeekSeconds({ peak_frame: 90 }, 30)).toBe(3);
    expect(getEventSeekSeconds({ peak_frame: 90 })).toBeNull();
    expect(getEventSeekSeconds({ peak_frame: 90 }, 0)).toBeNull();
  });
});
