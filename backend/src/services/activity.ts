import type { ActivityType, Prisma } from '@prisma/client';
import type { Tx } from '../lib/db.js';

export const XP: Record<ActivityType, number> = {
  LOGIN: 0,
  LESSON_VIEW: 2,
  LESSON_COMPLETE: 10,
  EXAM_SUBMIT: 25,
  ASSESSMENT_COMPLETE: 20,
  FORUM_POST: 5,
  ASSIGNMENT_SUBMIT: 15,
};

export type ActivityInput = {
  tenantId: string;
  userId: string;
  type: ActivityType;
  courseId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

/**
 * Appends to the activity stream and credits XP in the same transaction. Returns the
 * payload for `events.emit('activity', ...)`, which callers fire after commit.
 */
export async function recordActivity(tx: Tx, a: ActivityInput) {
  const xp = XP[a.type];
  await tx.learningActivity.create({
    data: { tenantId: a.tenantId, userId: a.userId, courseId: a.courseId ?? null, type: a.type, xp, metadata: a.metadata },
  });
  if (xp) await tx.user.update({ where: { id: a.userId }, data: { xp: { increment: xp } } });
  return { tenantId: a.tenantId, userId: a.userId, courseId: a.courseId ?? null, type: a.type, xp };
}
