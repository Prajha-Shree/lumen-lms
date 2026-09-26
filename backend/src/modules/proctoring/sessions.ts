import { SessionTracker, type CameraSignal, type Transition } from './tracker.js';

/**
 * Live per-session tracking state, kept in process memory. It's rebuilt naturally
 * from the next frames after a restart (open events are closed at submit). To run
 * several backend replicas, move this map to Redis keyed by session id.
 */
type Live = { tracker: SessionTracker; openEventIds: Partial<Record<CameraSignal, string>>; lastFrameAt: number };

const live = new Map<string, Live>();

export function trackerFor(sessionId: string): Live {
  let entry = live.get(sessionId);
  if (!entry) {
    entry = { tracker: new SessionTracker(), openEventIds: {}, lastFrameAt: 0 };
    live.set(sessionId, entry);
  }
  return entry;
}

/** Flushes and forgets a session's tracker; returns closing transitions tagged with their event ids. */
export function closeTracker(sessionId: string): (Transition & { eventId?: string })[] {
  const entry = live.get(sessionId);
  if (!entry) return [];
  live.delete(sessionId);
  return entry.tracker.flush().map((t) => ({ ...t, eventId: entry.openEventIds[t.type] }));
}
