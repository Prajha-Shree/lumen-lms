import type { ActivityType } from '@prisma/client';
import { withTenant, type Tx } from '../../lib/db.js';
import { events } from '../../lib/events.js';
import { logger } from '../../lib/logger.js';
import { notify } from '../../services/notifications.js';
import { streak } from '../analytics/queries.js';

/**
 * Badge rules. Keys must match the frontend catalog (features/gamification/badges.ts).
 * `on` lists the activity types that can unlock the badge, so each event only
 * evaluates relevant rules.
 */
type Rule = { name: string; on: ActivityType[]; check: (tx: Tx, userId: string) => Promise<boolean> };

const completedLessons = (tx: Tx, userId: string) => tx.lessonProgress.count({ where: { userId, status: 'COMPLETED' } });

export const BADGE_RULES: Record<string, Rule> = {
  'first-steps': { name: 'First Steps', on: ['LESSON_COMPLETE'], check: async (tx, u) => (await completedLessons(tx, u)) >= 1 },
  'five-lessons': { name: 'Momentum', on: ['LESSON_COMPLETE'], check: async (tx, u) => (await completedLessons(tx, u)) >= 5 },
  'ten-lessons': { name: 'Deep Diver', on: ['LESSON_COMPLETE'], check: async (tx, u) => (await completedLessons(tx, u)) >= 10 },
  'course-complete': { name: 'Finisher', on: ['LESSON_COMPLETE'], check: async (tx, u) => (await tx.enrollment.count({ where: { userId: u, status: 'COMPLETED' } })) >= 1 },
  'streak-3': { name: 'On a Roll', on: ['LESSON_COMPLETE', 'LESSON_VIEW', 'EXAM_SUBMIT'], check: async (tx, u) => (await streak(tx, u, 'UTC')).current >= 3 },
  'streak-7': { name: 'Week Warrior', on: ['LESSON_COMPLETE', 'LESSON_VIEW', 'EXAM_SUBMIT'], check: async (tx, u) => (await streak(tx, u, 'UTC')).current >= 7 },
  'know-thyself': { name: 'Know Thyself', on: ['ASSESSMENT_COMPLETE'], check: async (tx, u) => (await tx.cognitiveProfile.count({ where: { userId: u } })) >= 1 },
  'perfect-score': { name: 'Perfectionist', on: ['EXAM_SUBMIT'], check: async (tx, u) => (await tx.examSession.count({ where: { userId: u, percent: 100 } })) >= 1 },
  'exam-passed': {
    name: 'Checkpoint Cleared',
    on: ['EXAM_SUBMIT'],
    check: async (tx, u) => {
      const s = await tx.examSession.findMany({ where: { userId: u, status: { in: ['SUBMITTED', 'EXPIRED'] } }, select: { percent: true, exam: { select: { passingScore: true } } } });
      return s.some((x) => (x.percent ?? 0) >= x.exam.passingScore);
    },
  },
  helpful: { name: 'Helping Hand', on: ['FORUM_POST'], check: async (tx, u) => (await tx.forumPost.count({ where: { authorId: u, isAnswer: true } })) >= 1 },
};

/** Evaluates rules triggered by `type` and awards any newly earned badges. */
export async function evaluateBadges(tenantId: string, userId: string, type: ActivityType): Promise<string[]> {
  let push: (() => void) | undefined;
  const awarded = await withTenant(tenantId, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (user?.role !== 'STUDENT') return [];
    const have = new Set((await tx.userBadge.findMany({ where: { userId }, select: { badge: true } })).map((b) => b.badge));
    const earned: string[] = [];
    for (const [key, rule] of Object.entries(BADGE_RULES)) {
      if (have.has(key) || !rule.on.includes(type)) continue;
      if (await rule.check(tx, userId)) earned.push(key);
    }
    if (!earned.length) return [];
    await tx.userBadge.createMany({ data: earned.map((badge) => ({ tenantId, userId, badge })), skipDuplicates: true });
    push = await notify(
      tx,
      earned.map((b) => ({ tenantId, userId, type: 'badge', title: `Badge unlocked: ${BADGE_RULES[b]!.name}`, body: 'Nice work! See all your achievements.', link: '/achievements' })),
    );
    return earned;
  });
  push?.();
  return awarded;
}

/** Wires badge evaluation to the activity stream (called once at boot). */
export function startGamification() {
  events.on('activity', (a) => {
    evaluateBadges(a.tenantId, a.userId, a.type).catch((err) => logger.error({ err }, 'badge evaluation failed'));
  });
}
