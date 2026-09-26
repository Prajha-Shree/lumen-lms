import type { ProctoringEventType } from '@prisma/client';

/**
 * When does a session go to human review? Thresholds are intentionally tolerant,
 * because automated signals have false positives (lighting, glasses, disabilities,
 * shared spaces). A flag means "an instructor should look", never "the student cheated".
 */
export const REVIEW_RULES: Record<ProctoringEventType, { count?: number; totalMs?: number }> = {
  MULTIPLE_FACES: { count: 1 },
  NO_FACE: { totalMs: 20_000, count: 4 },
  LOOKING_AWAY: { totalMs: 30_000, count: 6 },
  TAB_HIDDEN: { count: 2, totalMs: 15_000 },
  WINDOW_BLUR: { count: 5 },
  FULLSCREEN_EXIT: { count: 3 },
  COPY_PASTE: { count: 1 },
  CAMERA_UNAVAILABLE: { totalMs: 60_000 },
};

/** Neutral, descriptive phrasing for review screens. */
export const EVENT_LABEL: Record<ProctoringEventType, string> = {
  NO_FACE: 'Face not visible',
  MULTIPLE_FACES: 'More than one face visible',
  LOOKING_AWAY: 'Looking away from screen',
  TAB_HIDDEN: 'Exam tab hidden',
  WINDOW_BLUR: 'Exam window lost focus',
  FULLSCREEN_EXIT: 'Left full screen',
  COPY_PASTE: 'Copy or paste used',
  CAMERA_UNAVAILABLE: 'Camera unavailable',
};

type EventLike = { type: ProctoringEventType; durationMs: number | null };

export type ProctoringSummary = {
  byType: Partial<Record<ProctoringEventType, { count: number; totalMs: number }>>;
  totalEvents: number;
  flaggedMs: number;
  needsReview: boolean;
  reasons: string[];
};

const seconds = (ms: number) => `${Math.round(ms / 1000)}s`;

export function summarize(events: EventLike[]): ProctoringSummary {
  const byType: ProctoringSummary['byType'] = {};
  for (const e of events) {
    const t = (byType[e.type] ??= { count: 0, totalMs: 0 });
    t.count += 1;
    t.totalMs += e.durationMs ?? 0;
  }
  const reasons: string[] = [];
  for (const [type, stats] of Object.entries(byType) as [ProctoringEventType, { count: number; totalMs: number }][]) {
    const rule = REVIEW_RULES[type];
    const byCount = rule.count !== undefined && stats.count >= rule.count;
    const byTime = rule.totalMs !== undefined && stats.totalMs >= rule.totalMs;
    if (byCount || byTime) {
      reasons.push(`${EVENT_LABEL[type]}: ${stats.count}×${stats.totalMs ? `, ${seconds(stats.totalMs)} total` : ''}`);
    }
  }
  return {
    byType,
    totalEvents: events.length,
    flaggedMs: Object.values(byType).reduce((s, t) => s + t!.totalMs, 0),
    needsReview: reasons.length > 0,
    reasons,
  };
}
