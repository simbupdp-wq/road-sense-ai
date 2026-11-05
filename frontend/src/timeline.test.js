import { describe, expect, it } from 'vitest';
import { getEventSeekSeconds } from './timeline.js';

describe('event-to-video seek mapping', () => {
  it('uses the exact API peak_time_seconds field', () => {
    expect(getEventSeekSeconds({ peak_time_seconds: 4.5 })).toBe(4.5);
    expect(getEventSeekSeconds({ start_time_seconds: 3, peak_time_seconds: 7 })).toBe(7);
    expect(getEventSeekSeconds({ peak_time_seconds: 'invalid' })).toBeNull();
  });

  it('uses peak_frame only when actual FPS metadata is supplied', () => {
    expect(getEventSeekSeconds({ peak_frame: 90 }, 30)).toBe(3);
    expect(getEventSeekSeconds({ peak_frame: 90 })).toBeNull();
    expect(getEventSeekSeconds({ peak_frame: 90 }, 0)).toBeNull();
  });
});
