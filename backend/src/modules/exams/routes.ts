import type { ExamQuestion, Prisma } from '@prisma/client';
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Tx } from '../../lib/db.js';
import { events } from '../../lib/events.js';
import { idParam, parse } from '../../lib/validate.js';
import { auth, db, isStaff, requireRole } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { notify } from '../../services/notifications.js';
import { assertCanLearn, canManage, loadCourse } from '../courses/access.js';
import { EVENT_LABEL, summarize } from '../proctoring/policy.js';
import { finalizeSession, grade, SUBMIT_GRACE_MS, type Answers } from './grading.js';

// Base fields carry no defaults: in Zod 4, `.partial()` still applies `.default()`,
// which would silently reset omitted fields on PATCH. Defaults belong to create only.
const ExamFields = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000),
  durationMinutes: z.number().int().min(1).max(600),
  passingScore: z.number().int().min(0).max(100),
  proctored: z.boolean(),
  maxAttempts: z.number().int().min(1).max(20),
});
const ExamBody = ExamFields.extend({
  description: ExamFields.shape.description.default(''),
  durationMinutes: ExamFields.shape.durationMinutes.default(30),
  passingScore: ExamFields.shape.passingScore.default(60),
  proctored: ExamFields.shape.proctored.default(true),
  maxAttempts: ExamFields.shape.maxAttempts.default(1),
});
const ExamPatch = ExamFields.partial().extend({ status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional() });

const QuestionBody = z
  .object({
    prompt: z.string().trim().min(3).max(2000),
    options: z.array(z.string().trim().min(1).max(500)).min(2).max(8),
    correct: z.array(z.number().int().min(0)).min(1),
    topic: z.string().trim().toLowerCase().min(1).max(40),
    difficulty: z.number().int().min(1).max(5).default(2),
    points: z.number().int().min(1).max(100).default(1),
    explanation: z.string().trim().max(2000).optional(),
  })
  .refine((q) => q.correct.every((i) => i < q.options.length), { path: ['correct'], message: 'Correct answer must be one of the options' });

const LETTERS = 'abcdefgh';
const questionData = (q: z.infer<typeof QuestionBody>) => ({
  prompt: q.prompt,
  options: q.options.map((text, i) => ({ id: LETTERS[i]!, text })),
  correctOptionIds: [...new Set(q.correct)].map((i) => LETTERS[i]!),
  type: q.correct.length > 1 ? ('MULTIPLE_CHOICE' as const) : ('SINGLE_CHOICE' as const),
  topic: q.topic,
  difficulty: q.difficulty,
  points: q.points,
  explanation: q.explanation ?? null,
});

/** What a test taker sees: never the answer key. */
const publicQuestion = (q: ExamQuestion) => ({ id: q.id, type: q.type, prompt: q.prompt, options: q.options, points: q.points, position: q.position });

async function loadExam(tx: Tx, req: Request, examId: string, mode: 'view' | 'manage' = 'view') {
  const exam = await tx.exam.findUnique({ where: { id: examId } });
  if (!exam) throw new HttpError(404, 'Exam not found', 'NOT_FOUND');
  const course = await loadCourse(tx, req, exam.courseId, mode);
  if (auth(req).role === 'STUDENT' && exam.status !== 'PUBLISHED') throw new HttpError(404, 'Exam not found', 'NOT_FOUND');
  return { exam, course };
}

/** Loads the caller's own session and finalizes it if its time ran out. */
async function loadOwnSession(tx: Tx, req: Request, sessionId: string) {
  const a = auth(req);
  const session = await tx.examSession.findFirst({ where: { id: sessionId, userId: a.userId } });
  if (!session) throw new HttpError(404, 'Session not found', 'NOT_FOUND');
  if (session.status === 'IN_PROGRESS' && Date.now() > session.expiresAt.getTime() + SUBMIT_GRACE_MS) {
    const { session: done, activity } = await finalizeSession(tx, session.id, { expired: true });
    if (activity) events.emit('activity', activity);
    return done;
  }
  return session;
}

async function sessionView(tx: Tx, sessionId: string) {
  const s = await tx.examSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { exam: { include: { questions: { orderBy: { position: 'asc' } }, course: { select: { id: true, title: true } } } } },
  });
  const base = {
    id: s.id,
    status: s.status,
    proctored: s.proctored,
    startedAt: s.startedAt,
    expiresAt: s.expiresAt,
    submittedAt: s.submittedAt,
    answers: s.answers as Answers,
    exam: {
      id: s.exam.id,
      title: s.exam.title,
      durationMinutes: s.exam.durationMinutes,
      passingScore: s.exam.passingScore,
      course: s.exam.course,
    },
  };
  if (s.status === 'IN_PROGRESS') return { ...base, questions: s.exam.questions.map(publicQuestion) };
  // After submission: results with the answer key and explanations for learning.
  const perQuestion = grade(s.exam.questions, s.answers as Answers).perQuestion;
  return {
    ...base,
    score: s.score,
    maxScore: s.maxScore,
    percent: s.percent,
    topicScores: s.topicScores,
    passed: (s.percent ?? 0) >= s.exam.passingScore,
    underReview: s.reviewStatus === 'PENDING',
    questions: s.exam.questions.map((q) => ({ ...publicQuestion(q), correctOptionIds: q.correctOptionIds, explanation: q.explanation, topic: q.topic, correct: perQuestion[q.id] })),
  };
}

export function examsRouter(): Router {
  const router = Router();

  // ─── Authoring ──────────────────────────────────────────────────────────────
  router.post('/courses/:id/exams', async (req, res) => {
    const courseId = idParam(req.params);
    const exam = await db(req, async (tx) => {
      const course = await loadCourse(tx, req, courseId, 'manage');
      const body = parse(ExamBody, req.body);
      return tx.exam.create({ data: { ...body, tenantId: course.tenantId, courseId } });
    });
    res.status(201).json({ exam });
  });

  router.get('/exams/:id', async (req, res) => {
    const id = idParam(req.params);
    const a = auth(req);
    const data = await db(req, async (tx) => {
      const { exam, course } = await loadExam(tx, req, id);
      const questionCount = await tx.examQuestion.count({ where: { examId: id } });
      if (a.role === 'STUDENT') {
        const attempts = await tx.examSession.findMany({ where: { examId: id, userId: a.userId }, orderBy: { startedAt: 'desc' }, select: { id: true, status: true, percent: true, startedAt: true, expiresAt: true } });
        const enrollment = await tx.enrollment.findUnique({ where: { courseId_userId: { courseId: course.id, userId: a.userId } } });
        const retentionDays = ((await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId } })).settings as { proctoringRetentionDays?: number }).proctoringRetentionDays ?? 30;
        return { exam: { ...exam, questionCount, course: { id: course.id, title: course.title } }, attempts, enrolled: !!enrollment && enrollment.status !== 'DROPPED', retentionDays };
      }
      const questions = await tx.examQuestion.findMany({ where: { examId: id }, orderBy: { position: 'asc' } });
      return { exam: { ...exam, questionCount, course: { id: course.id, title: course.title } }, questions, canManage: canManage(a, course) };
    });
    res.json(data);
  });

  router.patch('/exams/:id', async (req, res) => {
    const id = idParam(req.params);
    const exam = await db(req, async (tx) => {
      await loadExam(tx, req, id, 'manage');
      const body = parse(ExamPatch, req.body);
      if (body.status === 'PUBLISHED' && !(await tx.examQuestion.count({ where: { examId: id } }))) {
        throw new HttpError(400, 'Add at least one question before publishing', 'EMPTY_EXAM');
      }
      return tx.exam.update({ where: { id }, data: body });
    });
    res.json({ exam });
  });

  router.delete('/exams/:id', async (req, res) => {
    const id = idParam(req.params);
    await db(req, async (tx) => {
      await loadExam(tx, req, id, 'manage');
      if (await tx.examSession.count({ where: { examId: id } })) throw new HttpError(409, 'Students have attempted this exam. Archive it instead.', 'HAS_ATTEMPTS');
      await tx.exam.delete({ where: { id } });
    });
    res.status(204).end();
  });

  router.post('/exams/:id/questions', async (req, res) => {
    const examId = idParam(req.params);
    const question = await db(req, async (tx) => {
      const { exam } = await loadExam(tx, req, examId, 'manage');
      const body = parse(QuestionBody, req.body);
      const last = await tx.examQuestion.aggregate({ where: { examId }, _max: { position: true } });
      return tx.examQuestion.create({ data: { ...questionData(body), tenantId: exam.tenantId, examId, position: (last._max.position ?? -1) + 1 } });
    });
    res.status(201).json({ question });
  });

  router.patch('/exam-questions/:id', async (req, res) => {
    const id = idParam(req.params);
    const question = await db(req, async (tx) => {
      const q = await tx.examQuestion.findUnique({ where: { id } });
      if (!q) throw new HttpError(404, 'Question not found', 'NOT_FOUND');
      await loadExam(tx, req, q.examId, 'manage');
      return tx.examQuestion.update({ where: { id }, data: questionData(parse(QuestionBody, req.body)) });
    });
    res.json({ question });
  });

  router.delete('/exam-questions/:id', async (req, res) => {
    const id = idParam(req.params);
    await db(req, async (tx) => {
      const q = await tx.examQuestion.findUnique({ where: { id } });
      if (!q) throw new HttpError(404, 'Question not found', 'NOT_FOUND');
      await loadExam(tx, req, q.examId, 'manage');
      await tx.examQuestion.delete({ where: { id } });
    });
    res.status(204).end();
  });

  // ─── Taking ─────────────────────────────────────────────────────────────────
  /** Starts (or resumes) an attempt. Proctored exams require explicit consent. */
  router.post('/exams/:id/sessions', requireRole('STUDENT'), async (req, res) => {
    const examId = idParam(req.params);
    const body = parse(z.object({ consent: z.boolean().default(false) }), req.body ?? {});
    const a = auth(req);
    const view = await db(req, async (tx) => {
      const { exam, course } = await loadExam(tx, req, examId);
      await assertCanLearn(tx, req, course);
      const existing = await tx.examSession.findFirst({ where: { examId, userId: a.userId, status: 'IN_PROGRESS' } });
      if (existing && existing.expiresAt.getTime() + SUBMIT_GRACE_MS > Date.now()) return sessionView(tx, existing.id);
      if (existing) {
        const { activity } = await finalizeSession(tx, existing.id, { expired: true });
        if (activity) events.emit('activity', activity);
      }
      const used = await tx.examSession.count({ where: { examId, userId: a.userId } });
      if (used >= exam.maxAttempts) throw new HttpError(409, 'You have used all attempts for this exam', 'NO_ATTEMPTS_LEFT');
      if (exam.proctored && !body.consent) {
        throw new HttpError(400, 'This exam is proctored. Please review and accept the monitoring notice to begin.', 'CONSENT_REQUIRED');
      }
      const now = new Date();
      const session = await tx.examSession.create({
        data: {
          tenantId: a.tenantId,
          examId,
          userId: a.userId,
          proctored: exam.proctored,
          consentGivenAt: exam.proctored ? now : null,
          startedAt: now,
          expiresAt: new Date(now.getTime() + exam.durationMinutes * 60_000),
        },
      });
      return sessionView(tx, session.id);
    });
    res.status(201).json({ session: view });
  });

  router.get('/exam-sessions/:id', requireRole('STUDENT'), async (req, res) => {
    const id = idParam(req.params);
    const view = await db(req, async (tx) => {
      const s = await loadOwnSession(tx, req, id);
      return sessionView(tx, s.id);
    });
    res.json({ session: view });
  });

  /** Autosave one answer. Idempotent; the client sends on every change. */
  router.put('/exam-sessions/:id/answers', requireRole('STUDENT'), async (req, res) => {
    const id = idParam(req.params);
    const body = parse(z.object({ questionId: z.uuid(), optionIds: z.array(z.string().max(4)).max(8) }), req.body);
    const saved = await db(req, async (tx) => {
      const s = await loadOwnSession(tx, req, id);
      if (s.status !== 'IN_PROGRESS') throw new HttpError(409, 'This attempt has already been submitted', 'SESSION_CLOSED');
      const q = await tx.examQuestion.findFirst({ where: { id: body.questionId, examId: s.examId } });
      if (!q) throw new HttpError(400, 'Question is not part of this exam', 'VALIDATION');
      const valid = new Set((q.options as { id: string }[]).map((o) => o.id));
      const optionIds = [...new Set(body.optionIds)].filter((o) => valid.has(o));
      const answers = { ...(s.answers as Answers), [q.id]: q.type === 'SINGLE_CHOICE' ? optionIds.slice(0, 1) : optionIds };
      await tx.examSession.update({ where: { id }, data: { answers: answers as Prisma.InputJsonValue } });
      return answers[q.id];
    });
    res.json({ questionId: body.questionId, optionIds: saved, savedAt: new Date() });
  });

  router.post('/exam-sessions/:id/submit', requireRole('STUDENT'), async (req, res) => {
    const id = idParam(req.params);
    const result = await db(req, async (tx) => {
      const s = await loadOwnSession(tx, req, id);
      if (s.status !== 'IN_PROGRESS') return { view: await sessionView(tx, id), activity: null, needsReview: false, exam: null, push: undefined };
      const out = await finalizeSession(tx, id, { expired: false });
      const exam = await tx.exam.findUniqueOrThrow({ where: { id: s.examId }, include: { course: { select: { id: true, instructorId: true } } } });
      // A persistent notification, so instructors who are offline still see it.
      const push = out.needsReview
        ? await notify(tx, [{ tenantId: s.tenantId, userId: exam.course.instructorId, type: 'review', title: `Proctoring review: ${auth(req).name}`, body: exam.title, link: `/exam-sessions/${id}/review` }])
        : undefined;
      return { view: await sessionView(tx, id), activity: out.activity, needsReview: out.needsReview ?? false, exam, push };
    });
    if (result.activity) events.emit('activity', result.activity);
    result.push?.();
    if (result.needsReview && result.exam) {
      events.emit('proctoringFlag', {
        tenantId: auth(req).tenantId,
        sessionId: id,
        examId: result.exam.id,
        courseId: result.exam.course.id,
        type: 'REVIEW_PENDING',
        studentName: auth(req).name,
      });
    }
    res.json({ session: result.view });
  });

  // ─── Review (staff) ─────────────────────────────────────────────────────────
  router.get('/exams/:id/sessions', async (req, res) => {
    const examId = idParam(req.params);
    if (!isStaff(auth(req).role)) throw new HttpError(403, 'Staff only', 'FORBIDDEN');
    const data = await db(req, async (tx) => {
      const { exam, course } = await loadExam(tx, req, examId);
      const sessions = await tx.examSession.findMany({
        where: { examId },
        orderBy: { startedAt: 'desc' },
        include: { user: { select: { id: true, name: true, email: true } }, events: { select: { type: true, durationMs: true } } },
      });
      return {
        exam: { id: exam.id, title: exam.title, proctored: exam.proctored, passingScore: exam.passingScore, course: { id: course.id, title: course.title } },
        sessions: sessions.map(({ events: evts, answers: _a, ...s }) => ({ ...s, proctoring: summarize(evts) })),
      };
    });
    res.json(data);
  });

  /** Timeline of events for one attempt, for human review. */
  router.get('/exam-sessions/:id/review', async (req, res) => {
    const id = idParam(req.params);
    if (!isStaff(auth(req).role)) throw new HttpError(403, 'Staff only', 'FORBIDDEN');
    const data = await db(req, async (tx) => {
      const s = await tx.examSession.findUnique({
        where: { id },
        include: {
          user: { select: { id: true, name: true, email: true } },
          reviewer: { select: { name: true } },
          exam: { select: { id: true, title: true, durationMinutes: true, courseId: true, passingScore: true } },
          events: { orderBy: { startedAt: 'asc' } },
        },
      });
      if (!s) throw new HttpError(404, 'Session not found', 'NOT_FOUND');
      await loadCourse(tx, req, s.exam.courseId);
      const { answers: _a, events: evts, ...rest } = s;
      return {
        session: rest,
        events: evts.map((e) => ({ ...e, label: EVENT_LABEL[e.type] })),
        summary: summarize(evts),
      };
    });
    res.json(data);
  });

  router.patch('/exam-sessions/:id/review', async (req, res) => {
    const id = idParam(req.params);
    const a = auth(req);
    if (!isStaff(a.role)) throw new HttpError(403, 'Staff only', 'FORBIDDEN');
    const body = parse(z.object({ decision: z.enum(['REVIEWED_NO_CONCERN', 'REVIEWED_CONCERN']), note: z.string().trim().max(2000).optional() }), req.body);
    const session = await db(req, async (tx) => {
      const s = await tx.examSession.findUnique({ where: { id }, include: { exam: { select: { courseId: true } } } });
      if (!s) throw new HttpError(404, 'Session not found', 'NOT_FOUND');
      await loadCourse(tx, req, s.exam.courseId, 'manage');
      if (!s.proctored) throw new HttpError(400, 'This attempt was not proctored', 'NOT_PROCTORED');
      return tx.examSession.update({ where: { id }, data: { reviewStatus: body.decision, reviewNote: body.note ?? null, reviewerId: a.userId, reviewedAt: new Date() } });
    });
    res.json({ session: { id: session.id, reviewStatus: session.reviewStatus, reviewNote: session.reviewNote, reviewedAt: session.reviewedAt } });
  });

  /** Review queue across the staff member's courses (all courses for admins). */
  router.get('/reviews', async (req, res) => {
    const a = auth(req);
    if (!isStaff(a.role)) throw new HttpError(403, 'Staff only', 'FORBIDDEN');
    const status = parse(z.object({ status: z.enum(['PENDING', 'REVIEWED']).default('PENDING') }), req.query).status;
    const sessions = await db(req, (tx) =>
      tx.examSession.findMany({
        where: {
          proctored: true,
          reviewStatus: status === 'PENDING' ? 'PENDING' : { in: ['REVIEWED_NO_CONCERN', 'REVIEWED_CONCERN'] },
          ...(a.role === 'INSTRUCTOR' && { exam: { course: { instructorId: a.userId } } }),
        },
        orderBy: { submittedAt: 'desc' },
        take: 100,
        include: {
          user: { select: { id: true, name: true } },
          exam: { select: { id: true, title: true, course: { select: { id: true, title: true } } } },
          events: { select: { type: true, durationMs: true } },
        },
      }),
    );
    res.json({
      reviews: sessions.map(({ events: evts, answers: _a, ...s }) => ({ ...s, proctoring: summarize(evts) })),
    });
  });

  return router;
}
