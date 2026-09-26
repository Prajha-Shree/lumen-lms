import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../../config/env.js';
import type { Tx } from '../../lib/db.js';
import { events } from '../../lib/events.js';
import { storage, TEMP_UPLOAD_DIR } from '../../lib/storage.js';
import { idParam, parse } from '../../lib/validate.js';
import { auth, db } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { recordActivity } from '../../services/activity.js';
import { assertCanLearn, loadCourse } from './access.js';

// Base fields carry no defaults: in Zod 4, `.partial()` still applies `.default()`,
// which would silently wipe omitted fields (e.g. content) on PATCH.
const LessonFields = z.object({
  title: z.string().trim().min(2).max(160),
  summary: z.string().trim().max(500),
  format: z.enum(['READING', 'VIDEO', 'INTERACTIVE']),
  content: z.string().max(100_000),
  videoUrl: z.url({ protocol: /^https$/ }).nullable().optional(),
  durationMinutes: z.number().int().min(1).max(600),
  difficulty: z.number().int().min(1).max(5),
  topics: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(10),
});
const LessonBody = LessonFields.extend({
  summary: LessonFields.shape.summary.default(''),
  format: LessonFields.shape.format.default('READING'),
  content: LessonFields.shape.content.default(''),
  durationMinutes: LessonFields.shape.durationMinutes.default(10),
  difficulty: LessonFields.shape.difficulty.default(2),
  topics: LessonFields.shape.topics.default([]),
});
const LessonPatch = LessonFields.partial();

const ProgressBody = z.object({
  event: z.enum(['view', 'complete']),
  /** Active time since the last report, measured client-side while the tab is visible. */
  secondsSpent: z.number().int().min(0).max(4 * 3600).default(0),
});

// Allow-list: documents, slides, spreadsheets, images, plain text and archives.
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'text/plain',
  'text/markdown',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
const upload = multer({
  dest: TEMP_UPLOAD_DIR,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new HttpError(415, `File type not allowed: ${file.mimetype || 'unknown'}`, 'UNSUPPORTED_TYPE'));
  },
});

async function loadLesson(tx: Tx, req: Request, id: string, mode: 'view' | 'manage' = 'view') {
  const lesson = await tx.lesson.findUnique({ where: { id } });
  if (!lesson) throw new HttpError(404, 'Lesson not found', 'NOT_FOUND');
  const course = await loadCourse(tx, req, lesson.courseId, mode);
  return { lesson, course };
}

export function lessonsRouter(): Router {
  const router = Router();

  router.post('/modules/:id/lessons', async (req, res) => {
    const moduleId = idParam(req.params);
    const body = parse(LessonBody, req.body);
    const lesson = await db(req, async (tx) => {
      const mod = await tx.module.findUnique({ where: { id: moduleId } });
      if (!mod) throw new HttpError(404, 'Module not found', 'NOT_FOUND');
      await loadCourse(tx, req, mod.courseId, 'manage');
      const last = await tx.lesson.aggregate({ where: { moduleId }, _max: { position: true } });
      return tx.lesson.create({
        data: { ...body, tenantId: mod.tenantId, courseId: mod.courseId, moduleId, position: (last._max.position ?? -1) + 1 },
      });
    });
    res.status(201).json({ lesson });
  });

  /** Lesson content + attachments + prev/next navigation + the learner's progress. */
  router.get('/lessons/:id', async (req, res) => {
    const id = idParam(req.params);
    const a = auth(req);
    const data = await db(req, async (tx) => {
      const { lesson, course } = await loadLesson(tx, req, id);
      await assertCanLearn(tx, req, course);
      const [attachments, ordered, progress] = await Promise.all([
        tx.lessonAttachment.findMany({ where: { lessonId: id }, orderBy: { createdAt: 'asc' }, select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true } }),
        tx.lesson.findMany({
          where: { courseId: course.id },
          orderBy: [{ module: { position: 'asc' } }, { position: 'asc' }],
          select: { id: true, title: true },
        }),
        a.role === 'STUDENT' ? tx.lessonProgress.findUnique({ where: { userId_lessonId: { userId: a.userId, lessonId: id } } }) : null,
      ]);
      const idx = ordered.findIndex((l) => l.id === id);
      return {
        lesson: { ...lesson, attachments },
        course: { id: course.id, title: course.title, accent: course.accent },
        prev: ordered[idx - 1] ?? null,
        next: ordered[idx + 1] ?? null,
        index: idx,
        total: ordered.length,
        progress,
      };
    });
    res.json(data);
  });

  router.patch('/lessons/:id', async (req, res) => {
    const id = idParam(req.params);
    const body = parse(LessonPatch, req.body);
    const lesson = await db(req, async (tx) => {
      await loadLesson(tx, req, id, 'manage');
      return tx.lesson.update({ where: { id }, data: body });
    });
    res.json({ lesson });
  });

  router.delete('/lessons/:id', async (req, res) => {
    const id = idParam(req.params);
    const keys = await db(req, async (tx) => {
      await loadLesson(tx, req, id, 'manage');
      const files = await tx.lessonAttachment.findMany({ where: { lessonId: id }, select: { storageKey: true } });
      await tx.lesson.delete({ where: { id } });
      return files.map((f) => f.storageKey);
    });
    await Promise.all(keys.map((k) => storage.remove(k)));
    res.status(204).end();
  });

  /**
   * Learner progress. `view` upserts IN_PROGRESS and accumulates time; `complete` marks
   * it done (idempotent) and completes the enrollment when every lesson is done.
   */
  router.post('/lessons/:id/progress', async (req, res) => {
    const id = idParam(req.params);
    const body = parse(ProgressBody, req.body);
    const a = auth(req);
    if (a.role !== 'STUDENT') {
      res.json({ progress: null });
      return;
    }
    const result = await db(req, async (tx) => {
      const { lesson, course } = await loadLesson(tx, req, id);
      await assertCanLearn(tx, req, course);
      const existing = await tx.lessonProgress.findUnique({ where: { userId_lessonId: { userId: a.userId, lessonId: id } } });
      const now = new Date();
      const emitted = [];

      const progress = await tx.lessonProgress.upsert({
        where: { userId_lessonId: { userId: a.userId, lessonId: id } },
        create: {
          tenantId: a.tenantId,
          userId: a.userId,
          lessonId: id,
          courseId: course.id,
          status: body.event === 'complete' ? 'COMPLETED' : 'IN_PROGRESS',
          timeSpentSeconds: body.secondsSpent,
          completedAt: body.event === 'complete' ? now : null,
        },
        update: {
          lastViewedAt: now,
          timeSpentSeconds: { increment: body.secondsSpent },
          ...(body.event === 'complete' && existing?.status !== 'COMPLETED' && { status: 'COMPLETED', completedAt: now }),
        },
      });

      // Throttle view events: one per lesson per 30 minutes keeps the stream meaningful.
      if (body.event === 'view' && (!existing || now.getTime() - existing.lastViewedAt.getTime() > 30 * 60_000)) {
        emitted.push(await recordActivity(tx, { tenantId: a.tenantId, userId: a.userId, courseId: course.id, type: 'LESSON_VIEW', metadata: { lessonId: id } }));
      }

      let courseCompleted = false;
      if (body.event === 'complete' && existing?.status !== 'COMPLETED') {
        emitted.push(await recordActivity(tx, { tenantId: a.tenantId, userId: a.userId, courseId: course.id, type: 'LESSON_COMPLETE', metadata: { lessonId: id } }));
        // Mark a clicked recommendation as followed (feedback for the recommender).
        await tx.recommendation.updateMany({ where: { userId: a.userId, lessonId: id, clickedAt: null }, data: { clickedAt: now } });
        const [total, done] = await Promise.all([
          tx.lesson.count({ where: { courseId: course.id } }),
          tx.lessonProgress.count({ where: { userId: a.userId, courseId: course.id, status: 'COMPLETED' } }),
        ]);
        if (total > 0 && done >= total) {
          await tx.enrollment.updateMany({ where: { courseId: course.id, userId: a.userId, status: 'ACTIVE' }, data: { status: 'COMPLETED', completedAt: now } });
          courseCompleted = true;
        }
      }
      return { progress, emitted, courseCompleted, lessonTitle: lesson.title };
    });
    for (const e of result.emitted) events.emit('activity', e);
    res.json({ progress: result.progress, courseCompleted: result.courseCompleted });
  });

  // ─── Attachments ──────────────────────────────────────────────────────────
  router.post('/lessons/:id/attachments', upload.single('file'), async (req, res) => {
    const id = idParam(req.params);
    const file = req.file;
    if (!file) throw new HttpError(400, 'Attach a file in the "file" field', 'VALIDATION');
    const a = auth(req);
    try {
      const attachment = await db(req, async (tx) => {
        const { lesson } = await loadLesson(tx, req, id, 'manage');
        const key = await storage.put(a.tenantId, file.path, file.originalname);
        return tx.lessonAttachment.create({
          data: {
            tenantId: a.tenantId,
            lessonId: lesson.id,
            uploadedById: a.userId,
            fileName: file.originalname.slice(0, 200),
            mimeType: file.mimetype,
            sizeBytes: file.size,
            storageKey: key,
          },
          select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
        });
      });
      res.status(201).json({ attachment });
    } finally {
      // No-op if storage.put already moved it; cleans up on permission/validation failure.
      await unlink(file.path).catch(() => undefined);
    }
  });

  router.get('/attachments/:id/download', async (req, res) => {
    const id = idParam(req.params);
    const attachment = await db(req, async (tx) => {
      const att = await tx.lessonAttachment.findUnique({ where: { id } });
      if (!att) throw new HttpError(404, 'File not found', 'NOT_FOUND');
      const { course } = await loadLesson(tx, req, att.lessonId);
      await assertCanLearn(tx, req, course);
      return att;
    });
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Length', attachment.sizeBytes);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
    // Never let the browser sniff an uploaded file into something executable.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const stream = storage.read(attachment.storageKey);
    stream.on('error', () => {
      if (!res.headersSent) res.status(404).end();
      else res.destroy();
    });
    stream.pipe(res);
  });

  router.delete('/attachments/:id', async (req, res) => {
    const id = idParam(req.params);
    const key = await db(req, async (tx) => {
      const att = await tx.lessonAttachment.findUnique({ where: { id } });
      if (!att) throw new HttpError(404, 'File not found', 'NOT_FOUND');
      await loadLesson(tx, req, att.lessonId, 'manage');
      await tx.lessonAttachment.delete({ where: { id } });
      return att.storageKey;
    });
    await storage.remove(key);
    res.status(204).end();
  });

  return router;
}
