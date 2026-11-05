export function createDemoReviewAdapter() {
  const decisions = new Map();

  return {
    async record({ eventId, decision, note = '' }) {
      if (!eventId || !['confirm', 'dismiss'].includes(decision)) {
        throw new Error('Choose an event and a valid demo review action.');
      }
      if (decisions.has(eventId)) throw new Error('This event already has a demo review decision.');
      const result = { eventId, decision, note: String(note), localOnly: true };
      decisions.set(eventId, result);
      return result;
    },
    get(eventId) {
      return decisions.get(eventId) || null;
    },
  };
}
