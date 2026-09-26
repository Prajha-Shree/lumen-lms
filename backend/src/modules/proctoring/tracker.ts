/**
 * Turns per-frame camera observations into durational proctoring events.
 *
 * A single frame proves nothing (people blink, glance at scratch paper, lean out of
 * frame for a second). A signal only becomes an event once it persists for
 * `openAfterMs`, and closes after `CLEAR_FRAMES_TO_CLOSE` consecutive clear frames.
 * Pure and clock-injected, so it is fully unit-testable.
 */

export type CameraSignal = 'NO_FACE' | 'MULTIPLE_FACES' | 'LOOKING_AWAY';

export const SIGNAL_RULES: Record<CameraSignal, { openAfterMs: number }> = {
  NO_FACE: { openAfterMs: 4_000 },
  LOOKING_AWAY: { openAfterMs: 5_000 },
  MULTIPLE_FACES: { openAfterMs: 2_000 },
};
export const CLEAR_FRAMES_TO_CLOSE = 2;
/** If frames stop arriving (network, sleep), a run doesn't silently span the gap. */
export const MAX_FRAME_GAP_MS = 10_000;

export type Observation = { faces: number; lookingAway: boolean; confidence: number };

export type Transition =
  | { kind: 'open'; type: CameraSignal; startedAt: number; confidence: number }
  | { kind: 'close'; type: CameraSignal; startedAt: number; endedAt: number; confidence: number };

type SignalState = {
  since: number | null; // first positive frame of the current run
  lastPositive: number;
  open: boolean;
  clear: number; // consecutive clear frames while open
  confidences: number[];
};

const fresh = (): SignalState => ({ since: null, lastPositive: 0, open: false, clear: 0, confidences: [] });
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : 0);

export function isPositive(type: CameraSignal, o: Observation): boolean {
  switch (type) {
    case 'NO_FACE':
      return o.faces === 0;
    case 'MULTIPLE_FACES':
      return o.faces >= 2;
    case 'LOOKING_AWAY':
      return o.faces >= 1 && o.lookingAway;
  }
}

export class SessionTracker {
  private state: Record<CameraSignal, SignalState> = { NO_FACE: fresh(), MULTIPLE_FACES: fresh(), LOOKING_AWAY: fresh() };
  private lastFrameAt: number | null = null;

  update(now: number, o: Observation): Transition[] {
    // After a gap, close anything open at its last known positive time and drop
    // unopened runs; the current frame then starts fresh.
    const gap = this.lastFrameAt !== null && now - this.lastFrameAt > MAX_FRAME_GAP_MS;
    const out: Transition[] = gap ? this.flush() : [];
    this.lastFrameAt = now;

    for (const type of Object.keys(SIGNAL_RULES) as CameraSignal[]) {
      const s = this.state[type];
      if (isPositive(type, o)) {
        s.since ??= now;
        s.lastPositive = now;
        s.clear = 0;
        s.confidences.push(o.confidence);
        if (!s.open && now - s.since >= SIGNAL_RULES[type].openAfterMs) {
          s.open = true;
          out.push({ kind: 'open', type, startedAt: s.since, confidence: mean(s.confidences) });
        }
      } else if (s.open) {
        s.clear += 1;
        if (s.clear >= CLEAR_FRAMES_TO_CLOSE) {
          out.push(this.close(type, s));
          this.state[type] = fresh();
        }
      } else {
        this.state[type] = fresh();
      }
    }
    return out;
  }

  /** Closes every open signal (end of exam). */
  flush(): Transition[] {
    const out: Transition[] = [];
    for (const type of Object.keys(this.state) as CameraSignal[]) {
      const s = this.state[type];
      if (s.open) out.push(this.close(type, s));
      this.state[type] = fresh();
    }
    return out;
  }

  activeSignals(): CameraSignal[] {
    return (Object.keys(this.state) as CameraSignal[]).filter((t) => this.state[t].open);
  }

  private close(type: CameraSignal, s: SignalState): Transition {
    return { kind: 'close', type, startedAt: s.since!, endedAt: s.lastPositive, confidence: mean(s.confidences) };
  }
}
