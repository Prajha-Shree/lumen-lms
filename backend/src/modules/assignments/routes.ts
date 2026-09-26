import type { Prisma } from '@prisma/client';
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Tx } from '../../lib/db.js';
import { events } from '../../lib/events.js';
import { idParam, parse } from '../../lib/validate.js';
import { auth, db, isStaff } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { recordActivity } from '../../services/activity.js';
import { notify } from '../../services/notifications.js';
import { assertCanLearn, loadCourse } from '../courses/access.js';

const Level = z.object({ points: z.number().int().min(0).max(100), label: z.string().trim().min(1).max(60), description: z.string().trim().max(500).default('') });
const Criterion = z.object({
  id: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  levels: z.array(Level).min(2).max(6),
});
const AssignmentBody = z
  .object({
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(10_000).default(''),
    dueAt: z.iso.datetime().nullable().optional(),
    rubric: z.array(Criterion).min(1).max(12),
  })
  .refine((a) => new Set(a.rubric.map((c) => c.id)).size === a.rubric.length, { path: ['rubric'], message: 'Criterion ids must be unique' });

type Rubric = z.infer<typeof Criterion>[];
const maxPoints = (rubric: Rubric) => rubric.reduce((s, c) => s + Math.max(...c.levels.map((l) => l.points)), 0);

async function loadAssignment(tx: Tx, req: Request, id: string) {
  const assignment = await tx.assignment.findUnique({ where: { id } });
  if (!assignment) throw new HttpError(404, 'Assignment not found', 'NOT_FOUND');
  const course = await loadCourse(tx, req, assignment.courseId);
  await assertCanLearn(tx, req, course);
  if (auth(req).role === 'STUDENT' && !assignment.published) throw new HttpError(404, 'Assignment not found', 'NOT_FOUND');
  return { assignment, course };
}

export function assignmentsRouter(): Router {
  const router = Router();

  router.get('/courses/:id/assignments', async (req, res) => {
    const courseId = idParam(req.params);
    const a = auth(req);
    const assignments = await db(req, async (tx) => {
      const course = await loadCourse(tx, req, courseId);
      await assertCanLearn(tx, req, course);
      const staff = isStaff(a.role);
      const list = await tx.assignment.findMany({
        where: { courseId, ...(!staff && { published: true }) },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
        include: {
          _count: { select: { submissions: true } },
          submissions: staff ? { where: { status: 'SUBMITTED' }, select: { id: true } } : { where: { userId: a.userId } },
        },
      });
      return list.map(({ submissions, ...x }) =>
        staff ? { ...x, toGrade: submissions.length } : { ...x, mySubmission: submissions[0] ?? null },
      );
    });
    res.json({ assignments });
  });

  router.post('/courses/:id/assignments', async (req, res) => {
    const courseId = idParam(req.params);
    const a = auth(req);
    const { assignment, push } = await db(req, async (tx) => {
      await loadCourse(tx, req, courseId, 'manage');
      const body = parse(AssignmentBody, req.body);
      const assignment = await tx.assignment.create({
        data: { ...body, dueAt: body.dueAt ? new Date(body.dueAt) : null, tenantId: a.tenantId, courseId, maxPoints: maxPoints(body.rubric) },
      });
      // Everyone still in the course, including those who already finished its lessons.
      const students = await tx.enrollment.findMany({ where: { courseId, status: { not: 'DROPPED' } }, select: { userId: true } });
      const push = await notify(
        tx,
        students.map((s) => ({ tenantId: a.tenantId, userId: s.userId, type: 'assignment', title: `New assignment: ${assignment.title}`, body: assignment.dueAt ? `Due ${assignment.dueAt.toDateString()}` : '', link: `/courses/${courseId}?tab=assignments` })),
      );
      return { assignment, push };
    });
    push();
    res.status(201).json({ assignment });
  });

  /** Staff: assignment with every submission. Student: assignment with their own. */
  router.get('/assignments/:id', async (req, res) => {
    const id = idParam(req.params);
    const a = auth(req);
    const data = await db(req, async (tx) => {
      const { assignment } = await loadAssignment(tx, req, id);
      const submissions = await tx.submission.findMany({
        where: { assignmentId: id, ...(!isStaff(a.role) && { userId: a.userId }) },
        orderBy: { submittedAt: 'asc' },
        include: { user: { select: { id: true, name: true } }, gradedBy: { select: { name: true } } },
      });
      return { assignment, submissions };
    });
    res.json(data);
  });

  /** Submit or resubmit (until graded). */
  router.post('/assignments/:id/submissions', async (req, res) => {
    const id = idParam(req.params);
    const body = parse(z.object({ content: z.string().trim().min(1).max(50_000) }), req.body);
    const a = auth(req);
    if (a.role !== 'STUDENT') throw new HttpError(403, 'Only students submit work', 'FORBIDDEN');
    const out = await db(req, async (tx) => {
      const { assignment } = await loadAssignment(tx, req, id);
      const existing = await tx.submission.findUnique({ where: { assignmentId_userId: { assignmentId: id, userId: a.userId } } });
      if (existing?.status === 'GRADED') throw new HttpError(409, 'This submission has already been graded', 'ALREADY_GRADED');
      const submission = await tx.submission.upsert({
        where: { assignmentId_userId: { assignmentId: id, userId: a.userId } },
        create: { tenantId: a.tenantId, assignmentId: id, userId: a.userId, content: body.content },
        update: { content: body.content, submittedAt: new Date() },
      });
      const activity = existing ? null : await recordActivity(tx, { tenantId: a.tenantId, userId: a.userId, courseId: assignment.courseId, type: 'ASSIGNMENT_SUBMIT', metadata: { assignmentId: id } });
      return { submission, activity };
    });
    if (out.activity) events.emit('activity', out.activity);
    res.status(201).json({ submission: out.submission });
  });

  /** Rubric grading: one chosen level per criterion; score is their sum. */
  router.put('/submissions/:id/grade', async (req, res) => {
    const id = idParam(req.params);
    const body = parse(z.object({ grades: z.record(z.string(), z.number().int().min(0)), feedback: z.string().trim().max(10_000).optional() }), req.body);
    const a = auth(req);
    const out = await db(req, async (tx) => {
      const sub = await tx.submission.findUnique({ where: { id }, include: { assignment: true } });
      if (!sub) throw new HttpError(404, 'Submission not found', 'NOT_FOUND');
      await loadCourse(tx, req, sub.assignment.courseId, 'manage');
      const rubric = sub.assignment.rubric as Rubric;
      const errors: Record<string, string[]> = {};
      for (const c of rubric) {
        const pts = body.grades[c.id];
        if (pts === undefined) errors[c.id] = ['Choose a level'];
        else if (!c.levels.some((l) => l.points === pts)) errors[c.id] = ['Points must match one of the rubric levels'];
      }
      const unknown = Object.keys(body.grades).filter((k) => !rubric.some((c) => c.id === k));
      if (unknown.length) errors.grades = [`Unknown criteria: ${unknown.join(', ')}`];
      if (Object.keys(errors).length) throw new HttpError(400, 'Grades don’t match the rubric', 'VALIDATION', errors);

      const score = rubric.reduce((s, c) => s + body.grades[c.id]!, 0);
      const graded = await tx.submission.update({
        where: { id },
        data: { grades: body.grades as Prisma.InputJsonValue, score, feedback: body.feedback ?? null, status: 'GRADED', gradedById: a.userId, gradedAt: new Date() },
      });
      const push = await notify(tx, [
        { tenantId: a.tenantId, userId: sub.userId, type: 'grade', title: `Graded: ${sub.assignment.title}`, body: `${score}/${sub.assignment.maxPoints} points`, link: `/courses/${sub.assignment.courseId}?tab=assignments` },
      ]);
      return { graded, push };
    });
    out.push();
    res.json({ submission: out.graded });
  });

  return router;
}
