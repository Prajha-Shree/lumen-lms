import { describe, expect, it } from 'vitest';
import { summarize } from '../src/modules/proctoring/policy.js';
import { SessionTracker, type Observation } from '../src/modules/proctoring/tracker.js';

const ok: Observation = { faces: 1, lookingAway: false, confidence: 0.9 };
const away: Observation = { faces: 1, lookingAway: true, confidence: 0.8 };
const none: Observation = { faces: 0, lookingAway: false, confidence: 0.7 };
const two: Observation = { faces: 2, lookingAway: false, confidence: 0.9 };

/** Feeds frames every `step` ms starting at t=0; returns all transitions. */
function feed(tracker: SessionTracker, frames: Observation[], step = 2000, start = 0) {
  return frames.flatMap((o, i) => tracker.update(start + i * step, o));
}

describe('SessionTracker', () => {
  it('ignores brief glances shorter than the threshold', () => {
    const t = new SessionTracker();
    expect(feed(t, [ok, away, away, ok, ok, ok])).toEqual([]); // 2s of looking away
  });

  it('opens LOOKING_AWAY after 5s and closes after two clear frames', () => {
    const t = new SessionTracker();
    const out = feed(t, [ok, away, away, away, away, ok, ok, ok]);
    expect(out).toEqual([
      { kind: 'open', type: 'LOOKING_AWAY', startedAt: 2000, confidence: 0.8 },
      { kind: 'close', type: 'LOOKING_AWAY', startedAt: 2000, endedAt: 8000, confidence: 0.8 },
    ]);
  });

  it('a single clear frame does not split one event into two', () => {
    const t = new SessionTracker();
    const out = feed(t, [away, away, away, away, ok, away, away, ok, ok]);
    expect(out.filter((x) => x.kind === 'open')).toHaveLength(1);
    expect(out.at(-1)).toMatchObject({ kind: 'close', startedAt: 0, endedAt: 12000 });
  });

  it('flags multiple faces faster than looking away', () => {
    const t = new SessionTracker();
    const out = feed(t, [two, two]);
    expect(out).toEqual([{ kind: 'open', type: 'MULTIPLE_FACES', startedAt: 0, confidence: 0.9 }]);
  });

  it('NO_FACE and LOOKING_AWAY are mutually exclusive per frame', () => {
    const t = new SessionTracker();
    const out = feed(t, [none, none, none, none]);
    expect(out.map((x) => x.type)).toEqual(['NO_FACE']);
  });

  it('a gap in frames closes open events at the last seen time and restarts runs', () => {
    const t = new SessionTracker();
    feed(t, [none, none, none]); // opens at 4000
    const out = t.update(4000 + 30_000, none);
    expect(out[0]).toMatchObject({ kind: 'close', type: 'NO_FACE', endedAt: 4000 });
    expect(t.activeSignals()).toEqual([]);
  });

  it('flush closes everything still open', () => {
    const t = new SessionTracker();
    feed(t, [two, two, two]);
    expect(t.activeSignals()).toEqual(['MULTIPLE_FACES']);
    expect(t.flush()).toEqual([{ kind: 'close', type: 'MULTIPLE_FACES', startedAt: 0, endedAt: 4000, confidence: 0.9 }]);
    expect(t.activeSignals()).toEqual([]);
  });
});

describe('review policy', () => {
  it('a quiet session does not need review', () => {
    const s = summarize([{ type: 'LOOKING_AWAY', durationMs: 6000 }, { type: 'WINDOW_BLUR', durationMs: 1000 }]);
    expect(s.needsReview).toBe(false);
    expect(s.totalEvents).toBe(2);
  });

  it('flags on another face, repeated tab switching, or long look-aways with neutral wording', () => {
    expect(summarize([{ type: 'MULTIPLE_FACES', durationMs: 3000 }]).reasons).toEqual(['More than one face visible: 1×, 3s total']);
    expect(summarize([{ type: 'TAB_HIDDEN', durationMs: 2000 }, { type: 'TAB_HIDDEN', durationMs: 2000 }]).needsReview).toBe(true);
    const long = summarize(Array.from({ length: 4 }, () => ({ type: 'LOOKING_AWAY' as const, durationMs: 9000 })));
    expect(long.needsReview).toBe(true);
    expect(long.reasons.join(' ')).not.toMatch(/cheat|suspic|violation/i);
  });
});
