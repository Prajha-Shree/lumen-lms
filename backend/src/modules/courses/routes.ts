import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Tx } from '../../lib/db.js';
import { idParam, parse } from '../../lib/validate.js';
import { auth, db, isStaff, requireRole } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { applyOrder, assertCanLearn, canManage, loadCourse, progressByCourse } from './access.js';

const ACCENTS = ['indigo', 'emerald', 'rose', 'amber', 'sky', 'violet'] as const;

// Base fields carry no defaults: in Zod 4, `.partial()` still applies `.default()`,
// which would silently reset omitted fields on PATCH. Defaults belong to create only.
const CourseFields = z.object({
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().max(4000),
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10),
  accent: z.enum(ACCENTS),
});
const CourseBody = CourseFields.extend({
  description: CourseFields.shape.description.default(''),
  level: CourseFields.shape.level.default('BEGINNER'),
  tags: CourseFields.shape.tags.default([]),
  accent: CourseFields.shape.accent.default('indigo'),
});
const CoursePatch = CourseFields.partial().extend({ status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional() });

const ModuleFields = z.object({ title: z.string().trim().min(2).max(140), description: z.string().trim().max(2000) });
const ModuleBody = ModuleFields.extend({ description: ModuleFields.shape.description.default('') });
const ModulePatch = ModuleFields.partial();
const OrderBody = z.object({ ids: z.array(z.uuid()).min(1).max(500) });

const courseCard = {
  id: true,
  title: true,
  description: true,
  level: true,
  status: true,
  tags: true,
  accent: true,
  instructorId: true,
  publishedAt: true,
  updatedAt: true,
  instructor: { select: { id: true, name: true } },
  _count: { select: { modules: true, lessons: true, enrollments: true } },
} as const;

export function coursesRouter(): Router {
  const router = Router();

  /** Role-scoped list: students get the catalog + their enrollment/progress. */
  router.get('/', async (req, res) => {
    const a = auth(req);
    const data = await db(req, async (tx) => {
      const where =
        a.role === 'STUDENT'
          ? { status: 'PUBLISHED' as const }
          : a.role === 'INSTRUCTOR'
            ? { OR: [{ instructorId: a.userId }, { status: 'PUBLISHED' as const }] }
            : {};
      const courses = await tx.course.findMany({ where, select: courseCard, orderBy: [{ status: 'asc' }, { title: 'asc' }] });
      if (a.role !== 'STUDENT') {
        return courses.map((c) => ({ ...c, canManage: canManage(a, c) }));
      }
      const enrollments = await tx.enrollment.findMany({ where: { userId: a.userId } });
      const progress = await progressByCourse(tx, a.userId, courses.map((c) => c.id));
      return courses.map((c) => ({
        ...c,
        canManage: false,
        enrollment: enrollments.find((e) => e.courseId === c.id && e.status !== 'DROPPED') ?? null,
        progress: progress[c.id],
      }));
    });
    res.json({ courses: data });
  });

  router.post('/', requireRole('INSTRUCTOR', 'INSTITUTION_ADMIN'), async (req, res) => {
    const body = parse(CourseBody, req.body);
    const a = auth(req);
    const course = await db(req, (tx) =>
      tx.course.create({ data: { ...body, tenantId: a.tenantId, instructorId: a.userId, status: 'DRAFT' }, select: courseCard }),
    );
    res.status(201).json({ course: { ...course, canManage: true } });
  });

  /** Full course outline with the caller's progress (students) or management flags (staff). */
  router.get('/:id', async (req, res) => {
    const id = idParam(req.params);
    const a = auth(req);
    const data = await db(req, async (tx) => {
      const base = await loadCourse(tx, req, id);
      const course = await tx.course.findUniqueOrThrow({
        where: { id },
        select: {
          ...courseCard,
          modules: {
            orderBy: { position: 'asc' },
            select: {
              id: true,
              title: true,
              description: true,
              position: true,
              lessons: {
                orderBy: { position: 'asc' },
                select: { id: true, title: true, summary: true, format: true, durationMinutes: true, difficulty: true, topics: true, position: true, _count: { select: { attachments: true } } },
              },
            },
          },
          exams: {
            where: a.role === 'STUDENT' ? { status: 'PUBLISHED' } : {},
            orderBy: { createdAt: 'asc' },
            select: { id: true, title: true, description: true, durationMinutes: true, proctored: true, status: true, passingScore: true, maxAttempts: true, _count: { select: { questions: true } } },
          },
        },
      });

      let enrollment = null;
      let lessonStatus: Record<string, string> = {};
      let attempts: Record<string, { count: number; best: number | null; inProgressId: string | null }> = {};
      if (a.role === 'STUDENT') {
        enrollment = await tx.enrollment.findUnique({ where: { courseId_userId: { courseId: id, userId: a.userId } } });
        const progress = await tx.lessonProgress.findMany({ where: { userId: a.userId, courseId: id }, select: { lessonId: true, status: true } });
        lessonStatus = Object.fromEntries(progress.map((p) => [p.lessonId, p.status]));
        const sessions = await tx.examSession.findMany({
          where: { userId: a.userId, exam: { courseId: id } },
          select: { id: true, examId: true, percent: true, status: true, expiresAt: true },
        });
        for (const s of sessions) {
          const entry = (attempts[s.examId] ??= { count: 0, best: null, inProgressId: null });
          entry.count++;
          if (s.percent != null) entry.best = Math.max(entry.best ?? 0, s.percent);
          if (s.status === 'IN_PROGRESS' && s.expiresAt > new Date()) entry.inProgressId = s.id;
        }
      }
      return { ...course, canManage: canManage(a, base), enrollment: enrollment?.status === 'DROPPED' ? null : enrollment, lessonStatus, attempts };
    });
    res.json({ course: data });
  });

  router.patch('/:id', async (req, res) => {
    const id = idParam(req.params);
    const course = await db(req, async (tx) => {
      // Authorize before validating, so error responses don't reveal hidden courses.
      const current = await loadCourse(tx, req, id, 'manage');
      const body = parse(CoursePatch, req.body);
      if (body.status === 'PUBLISHED' && current.status !== 'PUBLISHED') {
        const lessons = await tx.lesson.count({ where: { courseId: id } });
        if (!lessons) throw new HttpError(400, 'Add at least one lesson before publishing', 'EMPTY_COURSE');
      }
      return tx.course.update({
        where: { id },
        data: { ...body, ...(body.status === 'PUBLISHED' && !current.publishedAt && { publishedAt: new Date() }) },
        select: courseCard,
      });
    });
    res.json({ course: { ...course, canManage: true } });
  });

  router.delete('/:id', async (req, res) => {
    const id = idParam(req.params);
    await db(req, async (tx) => {
      await loadCourse(tx, req, id, 'manage');
      const enrolled = await tx.enrollment.count({ where: { courseId: id } });
      if (enrolled) throw new HttpError(409, 'Students are enrolled. Archive the course instead of deleting it.', 'HAS_ENROLLMENTS');
      await tx.course.delete({ where: { id } });
    });
    res.status(204).end();
  });

  // ─── Modules ──────────────────────────────────────────────────────────────
  router.post('/:id/modules', async (req, res) => {
    const courseId = idParam(req.params);
    const body = parse(ModuleBody, req.body);
    const mod = await db(req, async (tx) => {
      const course = await loadCourse(tx, req, courseId, 'manage');
      const last = await tx.module.aggregate({ where: { courseId }, _max: { position: true } });
      return tx.module.create({ data: { ...body, tenantId: course.tenantId, courseId, position: (last._max.position ?? -1) + 1 } });
    });
    res.status(201).json({ module: { ...mod, lessons: [] } });
  });

  router.put('/:id/modules/order', async (req, res) => {
    const courseId = idParam(req.params);
    const { ids } = parse(OrderBody, req.body);
    await db(req, async (tx) => {
      await loadCourse(tx, req, courseId, 'manage');
      await applyOrder(tx, 'module', ids, { courseId });
    });
    res.status(204).end();
  });

  // ─── Enrollment ───────────────────────────────────────────────────────────
  router.post('/:id/enroll', requireRole('STUDENT'), async (req, res) => {
    const courseId = idParam(req.params);
    const a = auth(req);
    const enrollment = await db(req, async (tx) => {
      const course = await loadCourse(tx, req, courseId);
      return tx.enrollment.upsert({
        where: { courseId_userId: { courseId, userId: a.userId } },
        create: { tenantId: course.tenantId, courseId, userId: a.userId },
        update: { status: 'ACTIVE', enrolledAt: new Date() },
      });
    });
    res.status(201).json({ enrollment });
  });

  router.delete('/:id/enroll', requireRole('STUDENT'), async (req, res) => {
    const courseId = idParam(req.params);
    const a = auth(req);
    await db(req, (tx) => tx.enrollment.updateMany({ where: { courseId, userId: a.userId }, data: { status: 'DROPPED' } }));
    res.status(204).end();
  });

  /** Staff roster: each enrolled student's progress, last activity and latest exam score. */
  router.get('/:id/students', async (req, res) => {
    const courseId = idParam(req.params);
    if (!isStaff(auth(req).role)) throw new HttpError(403, 'Staff only', 'FORBIDDEN');
    const students = await db(req, async (tx) => {
      await loadCourse(tx, req, courseId);
      const [enrollments, lessons, done, lastSeen, scores] = await Promise.all([
        tx.enrollment.findMany({
          where: { courseId, status: { not: 'DROPPED' } },
          include: { user: { select: { id: true, name: true, email: true, xp: true } } },
          orderBy: { user: { name: 'asc' } },
        }),
        tx.lesson.count({ where: { courseId } }),
        tx.lessonProgress.groupBy({ by: ['userId'], where: { courseId, status: 'COMPLETED' }, _count: { _all: true } }),
        tx.learningActivity.groupBy({ by: ['userId'], where: { courseId }, _max: { occurredAt: true } }),
        tx.examSession.findMany({
          where: { exam: { courseId }, status: 'SUBMITTED' },
          orderBy: { submittedAt: 'desc' },
          select: { userId: true, percent: true },
        }),
      ]);
      return enrollments.map((e) => ({
        ...e.user,
        enrollmentStatus: e.status,
        enrolledAt: e.enrolledAt,
        completedLessons: done.find((d) => d.userId === e.userId)?._count._all ?? 0,
        totalLessons: lessons,
        lastActiveAt: lastSeen.find((l) => l.userId === e.userId)?._max.occurredAt ?? null,
        latestScore: scores.find((s) => s.userId === e.userId)?.percent ?? null,
      }));
    });
    res.json({ students });
  });

  return router;
}

/** Module-level routes (/api/modules/:id). */
export function modulesRouter(): Router {
  const router = Router();

  const loadModule = async (tx: Tx, req: Request, id: string) => {
    const mod = await tx.module.findUnique({ where: { id } });
    if (!mod) throw new HttpError(404, 'Module not found', 'NOT_FOUND');
    await loadCourse(tx, req, mod.courseId, 'manage');
    return mod;
  };

  router.patch('/:id', async (req, res) => {
    const id = idParam(req.params);
    const body = parse(ModulePatch, req.body);
    const mod = await db(req, async (tx) => {
      await loadModule(tx, req, id);
      return tx.module.update({ where: { id }, data: body });
    });
    res.json({ module: mod });
  });

  router.delete('/:id', async (req, res) => {
    const id = idParam(req.params);
    await db(req, async (tx) => {
      await loadModule(tx, req, id);
      await tx.module.delete({ where: { id } });
    });
    res.status(204).end();
  });

  router.put('/:id/lessons/order', async (req, res) => {
    const moduleId = idParam(req.params);
    const { ids } = parse(OrderBody, req.body);
    await db(req, async (tx) => {
      await loadModule(tx, req, moduleId);
      await applyOrder(tx, 'lesson', ids, { moduleId });
    });
    res.status(204).end();
  });

  return router;
}

export { assertCanLearn, loadCourse };
