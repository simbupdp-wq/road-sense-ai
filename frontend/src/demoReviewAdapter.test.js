import { describe, expect, it } from 'vitest';
import { createDemoReviewAdapter } from './demoReviewAdapter.js';

describe('local demo review adapter', () => {
  it('stores a clearly local decision and note without calling a server', async () => {
    const review = createDemoReviewAdapter();
    const saved = await review.record({ eventId: 'evt-1', decision: 'confirm', note: 'Review sample' });
    expect(saved).toMatchObject({ eventId: 'evt-1', decision: 'confirm', note: 'Review sample', localOnly: true });
    expect(review.get('evt-1')).toEqual(saved);
  });

  it('rejects duplicate decisions for one event', async () => {
    const review = createDemoReviewAdapter();
    await review.record({ eventId: 'evt-1', decision: 'dismiss' });
    await expect(review.record({ eventId: 'evt-1', decision: 'confirm' })).rejects.toThrow(/already has a demo review/i);
  });
});
