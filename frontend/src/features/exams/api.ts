export type ExamOption = { id: string; text: string };

export type SessionQuestion = {
  id: string;
  type: 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE';
  prompt: string;
  options: ExamOption[];
  points: number;
  position: number;
  // Present only after submission:
  correctOptionIds?: string[];
  explanation?: string | null;
  topic?: string;
  correct?: boolean;
};

export type ExamSession = {
  id: string;
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED';
  proctored: boolean;
  startedAt: string;
  expiresAt: string;
  submittedAt: string | null;
  answers: Record<string, string[]>;
  exam: { id: string; title: string; durationMinutes: number; passingScore: number; course: { id: string; title: string } };
  questions: SessionQuestion[];
  score?: number;
  maxScore?: number;
  percent?: number;
  topicScores?: Record<string, number>;
  passed?: boolean;
  underReview?: boolean;
};

export type ExamInfo = {
  exam: {
    id: string;
    title: string;
    description: string;
    durationMinutes: number;
    passingScore: number;
    proctored: boolean;
    maxAttempts: number;
    status: string;
    questionCount: number;
    course: { id: string; title: string };
  };
  attempts?: { id: string; status: string; percent: number | null; startedAt: string; expiresAt: string }[];
  enrolled?: boolean;
  retentionDays?: number;
  questions?: {
    id: string;
    type: string;
    prompt: string;
    options: ExamOption[];
    correctOptionIds: string[];
    topic: string;
    difficulty: number;
    points: number;
    explanation: string | null;
    position: number;
  }[];
  canManage?: boolean;
};

export type EventType = 'NO_FACE' | 'MULTIPLE_FACES' | 'LOOKING_AWAY' | 'TAB_HIDDEN' | 'WINDOW_BLUR' | 'FULLSCREEN_EXIT' | 'COPY_PASTE' | 'CAMERA_UNAVAILABLE';

export type ProctoringSummary = {
  byType: Partial<Record<EventType, { count: number; totalMs: number }>>;
  totalEvents: number;
  flaggedMs: number;
  needsReview: boolean;
  reasons: string[];
};

export type ReviewStatus = 'NOT_REQUIRED' | 'PENDING' | 'REVIEWED_NO_CONCERN' | 'REVIEWED_CONCERN';

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  NOT_REQUIRED: 'No review needed',
  PENDING: 'Needs review',
  REVIEWED_NO_CONCERN: 'Reviewed: no concern',
  REVIEWED_CONCERN: 'Reviewed: follow-up',
};
export const REVIEW_TONE = { NOT_REQUIRED: 'neutral', PENDING: 'warning', REVIEWED_NO_CONCERN: 'success', REVIEWED_CONCERN: 'info' } as const;

/** Neutral wording + a fixed categorical slot per event type (never cycled). */
export const EVENT_META: Record<EventType, { label: string; color: string }> = {
  NO_FACE: { label: 'Face not visible', color: 'var(--series-1)' },
  LOOKING_AWAY: { label: 'Looking away', color: 'var(--series-2)' },
  MULTIPLE_FACES: { label: 'Another face visible', color: 'var(--series-3)' },
  TAB_HIDDEN: { label: 'Tab hidden', color: 'var(--series-4)' },
  WINDOW_BLUR: { label: 'Window lost focus', color: 'var(--series-5)' },
  FULLSCREEN_EXIT: { label: 'Left full screen', color: 'var(--series-6)' },
  COPY_PASTE: { label: 'Copy / paste', color: 'var(--series-7)' },
  CAMERA_UNAVAILABLE: { label: 'Camera unavailable', color: 'var(--series-8)' },
};

export const formatDuration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};
