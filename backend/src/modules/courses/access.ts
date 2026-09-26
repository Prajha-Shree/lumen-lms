import type { Course } from '@prisma/client';
import type { Request } from 'express';
import type { Tx } from '../../lib/db.js';
import { auth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';

type Auth = NonNullable<Request['auth']>;

export const canManage = (a: Auth, course: Pick<Course, 'instructorId'>) =>
  a.role === 'INSTITUTION_ADMIN' || (a.role === 'INSTRUCTOR' && course.instructorId === a.userId);

/**
 * Loads a course the caller may see. Students only see published courses (drafts are
 * reported as not found, not forbidden, so their existence isn't leaked).
 * `manage` additionally requires the owner instructor or an admin.
 */
export async function loadCourse(tx: Tx, req: Request, courseId: string, mode: 'view' | 'manage' = 'view') {
  const a = auth(req);
  const course = await tx.course.findUnique({ where: { id: courseId } });
  if (!course) throw new HttpError(404, 'Course not found', 'NOT_FOUND');
  // Visibility first: a hidden course must look nonexistent even to a write attempt.
  if (a.role === 'STUDENT' && course.status !== 'PUBLISHED') throw new HttpError(404, 'Course not found', 'NOT_FOUND');
  if (mode === 'manage' && !canManage(a, course)) throw new HttpError(403, 'Only the course instructor or an admin can change this course', 'FORBIDDEN');
  return course;
}

/** Students must be enrolled to open lesson content; staff may always view. */
export async function assertCanLearn(tx: Tx, req: Request, course: Course) {
  const a = auth(req);
  if (a.role !== 'STUDENT') return null;
  const enrollment = await tx.enrollment.findUnique({ where: { courseId_userId: { courseId: course.id, userId: a.userId } } });
  if (!enrollment || enrollment.status === 'DROPPED') throw new HttpError(403, 'Enroll in this course to access its lessons', 'NOT_ENROLLED');
  return enrollment;
}

/** { courseId: { total, completed } } for one learner across several courses. */
export async function progressByCourse(tx: Tx, userId: string, courseIds: string[]) {
  if (!courseIds.length) return {} as Record<string, { total: number; completed: number }>;
  const [totals, done] = await Promise.all([
    tx.lesson.groupBy({ by: ['courseId'], where: { courseId: { in: courseIds } }, _count: { _all: true } }),
    tx.lessonProgress.groupBy({ by: ['courseId'], where: { userId, courseId: { in: courseIds }, status: 'COMPLETED' }, _count: { _all: true } }),
  ]);
  return Object.fromEntries(
    courseIds.map((id) => [
      id,
      { total: totals.find((t) => t.courseId === id)?._count._all ?? 0, completed: done.find((d) => d.courseId === id)?._count._all ?? 0 },
    ]),
  );
}

/** Renumbers `position` to match the given id order (all ids must belong to the parent). */
export async function applyOrder(tx: Tx, model: 'module' | 'lesson', ids: string[], parent: { courseId?: string; moduleId?: string }) {
  const existing =
    model === 'module'
      ? await tx.module.findMany({ where: { courseId: parent.courseId }, select: { id: true } })
      : await tx.lesson.findMany({ where: { moduleId: parent.moduleId }, select: { id: true } });
  const known = new Set(existing.map((e) => e.id));
  if (ids.length !== known.size || !ids.every((id) => known.has(id))) {
    throw new HttpError(400, 'Order must list every item exactly once', 'VALIDATION');
  }
  await Promise.all(
    ids.map((id, position) =>
      model === 'module' ? tx.module.update({ where: { id }, data: { position } }) : tx.lesson.update({ where: { id }, data: { position } }),
    ),
  );
}
