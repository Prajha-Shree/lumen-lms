import type { ExamQuestion, Prisma } from '@prisma/client';
import type { Tx } from '../../lib/db.js';
import { summarize } from '../proctoring/policy.js';
import { closeTracker } from '../proctoring/sessions.js';
import { recordActivity } from '../../services/activity.js';

export type Answers = Record<string, string[]>;

/** Exact-set scoring: a multiple-choice question is right only if every correct option is chosen. */
export function grade(questions: Pick<ExamQuestion, 'id' | 'correctOptionIds' | 'points' | 'topic'>[], answers: Answers) {
  let score = 0;
  let maxScore = 0;
  const topics: Record<string, { earned: number; total: number }> = {};
  const perQuestion: Record<string, boolean> = {};
  for (const q of questions) {
    const given = [...(answers[q.id] ?? [])].sort();
    const correct = [...q.correctOptionIds].sort();
    const right = given.length === correct.length && given.every((v, i) => v === correct[i]);
    perQuestion[q.id] = right;
    maxScore += q.points;
    if (right) score += q.points;
    const t = (topics[q.topic] ??= { earned: 0, total: 0 });
    t.total += q.points;
    if (right) t.earned += q.points;
  }
  return {
    score,
    maxScore,
    percent: maxScore ? Math.round((score / maxScore) * 1000) / 10 : 0,
    topicScores: Object.fromEntries(Object.entries(topics).map(([k, v]) => [k, Math.round((v.earned / v.total) * 100) / 100])),
    perQuestion,
  };
}

/** Grace period after the deadline for in-flight saves/submits (network latency). */
export const SUBMIT_GRACE_MS = 60_000;

/**
 * Grades and closes a session: closes camera events still open in the tracker,
 * decides whether a human review is needed, and records the activity.
 * Returns the activity payload for events.emit after commit.
 */
export async function finalizeSession(tx: Tx, sessionId: string, opts: { expired: boolean }) {
  const session = await tx.examSession.findUniqueOrThrow({ where: { id: sessionId }, include: { exam: { include: { questions: true } } } });
  if (session.status !== 'IN_PROGRESS') return { session, activity: null };

  const now = new Date();
  // Open camera events end now (or at the deadline if the time ran out).
  const endedAt = opts.expired ? session.expiresAt : now;
  for (const t of closeTracker(sessionId)) {
    if (t.kind === 'close' && t.eventId) {
      await tx.proctoringEvent.update({
        where: { id: t.eventId },
        data: { endedAt: new Date(t.endedAt), durationMs: t.endedAt - t.startedAt, confidence: t.confidence },
      });
    }
  }
  await tx.proctoringEvent.updateMany({
    where: { sessionId, endedAt: null },
    data: { endedAt },
  });

  const result = grade(session.exam.questions, session.answers as Answers);
  const events = session.proctored ? await tx.proctoringEvent.findMany({ where: { sessionId }, select: { type: true, durationMs: true } }) : [];
  const summary = summarize(events);

  const updated = await tx.examSession.update({
    where: { id: sessionId },
    data: {
      status: opts.expired ? 'EXPIRED' : 'SUBMITTED',
      submittedAt: opts.expired ? session.expiresAt : now,
      score: result.score,
      maxScore: result.maxScore,
      percent: result.percent,
      topicScores: result.topicScores as Prisma.InputJsonValue,
      reviewStatus: session.proctored && summary.needsReview ? 'PENDING' : 'NOT_REQUIRED',
    },
    include: { exam: { include: { questions: true } } },
  });
  const activity = await recordActivity(tx, {
    tenantId: session.tenantId,
    userId: session.userId,
    courseId: session.exam.courseId,
    type: 'EXAM_SUBMIT',
    metadata: { examId: session.examId, sessionId, percent: result.percent },
  });
  return { session: updated, activity, needsReview: summary.needsReview };
}
