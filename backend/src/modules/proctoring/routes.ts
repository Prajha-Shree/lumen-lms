import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { logger } from '../../lib/logger.js';
import { mlPostBinary } from '../../lib/mlClient.js';
import { idParam, parse } from '../../lib/validate.js';
import { auth, db, requireRole } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { SUBMIT_GRACE_MS } from '../exams/grading.js';
import { trackerFor } from './sessions.js';

/**
 * PRIVACY (ADR-2): frames are held in memory only (multer memoryStorage), forwarded
 * to the ml-service, and dropped when the request ends. They are never written to
 * disk, stored in the database, or logged. Only derived events persist.
 */
const frameUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 300 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/webp', 'image/png'].includes(file.mimetype)) cb(null, true);
    else cb(new HttpError(415, 'Frames must be JPEG, WebP or PNG', 'UNSUPPORTED_TYPE'));
  },
});

const Analysis = z.object({
  faces: z.number().int(),
  lookingAway: z.boolean(),
  reason: z.string().nullable(),
  confidence: z.number(),
  brightness: z.number(),
});

const MIN_FRAME_INTERVAL_MS = 1000;
const MAX_BROWSER_EVENTS = 500;

const BrowserEvent = z.object({
  type: z.enum(['TAB_HIDDEN', 'WINDOW_BLUR', 'FULLSCREEN_EXIT', 'COPY_PASTE', 'CAMERA_UNAVAILABLE']),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable().optional(),
});

async function analyze(file: Express.Multer.File) {
  try {
    return { available: true as const, ...(await mlPostBinary('/proctoring/analyze', file.buffer, file.mimetype, Analysis)) };
  } catch (err) {
    if (err instanceof HttpError && (err.status === 503 || err.status === 502)) return { available: false as const };
    throw err;
  } finally {
    file.buffer = Buffer.alloc(0); // drop the frame reference promptly
  }
}

export function proctoringRouter(): Router {
  const router = Router();

  /** Pre-exam camera check: same analysis, no session, nothing recorded. */
  router.post('/proctoring/check', requireRole('STUDENT'), frameUpload.single('frame'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Attach a frame in the "frame" field', 'VALIDATION');
    const result = await analyze(req.file);
    res.json(result);
  });

  /** One sampled webcam frame during an attempt → live signal + event bookkeeping. */
  router.post('/exam-sessions/:id/frames', requireRole('STUDENT'), frameUpload.single('frame'), async (req, res) => {
    const id = idParam(req.params);
    const file = req.file;
    if (!file) throw new HttpError(400, 'Attach a frame in the "frame" field', 'VALIDATION');
    const a = auth(req);

    const session = await db(req, (tx) => tx.examSession.findFirst({ where: { id, userId: a.userId } }));
    if (!session) throw new HttpError(404, 'Session not found', 'NOT_FOUND');
    if (session.status !== 'IN_PROGRESS' || !session.proctored || Date.now() > session.expiresAt.getTime() + SUBMIT_GRACE_MS) {
      throw new HttpError(409, 'This attempt is not being proctored', 'SESSION_CLOSED');
    }

    const live = trackerFor(id);
    const now = Date.now();
    if (now - live.lastFrameAt < MIN_FRAME_INTERVAL_MS) {
      res.json({ skipped: true });
      return;
    }
    live.lastFrameAt = now;

    const result = await analyze(file);
    if (!result.available) {
      res.json({ available: false, activeSignals: [] });
      return;
    }

    const transitions = live.tracker.update(now, result);
    if (transitions.length) {
      await db(req, async (tx) => {
        for (const t of transitions) {
          if (t.kind === 'open') {
            const ev = await tx.proctoringEvent.create({
              data: { tenantId: a.tenantId, sessionId: id, type: t.type, source: 'CAMERA', startedAt: new Date(t.startedAt), confidence: t.confidence },
            });
            live.openEventIds[t.type] = ev.id;
          } else {
            const eventId = live.openEventIds[t.type];
            if (eventId) {
              await tx.proctoringEvent.update({
                where: { id: eventId },
                data: { endedAt: new Date(t.endedAt), durationMs: t.endedAt - t.startedAt, confidence: t.confidence },
              });
              delete live.openEventIds[t.type];
            }
          }
        }
      });
      logger.debug({ sessionId: id, transitions: transitions.map((t) => `${t.kind}:${t.type}`) }, 'proctoring transitions');
    }

    res.json({
      available: true,
      faces: result.faces,
      lookingAway: result.lookingAway,
      brightness: result.brightness,
      activeSignals: live.tracker.activeSignals(),
    });
  });

  /** Browser-side signals (tab hidden, focus lost, full screen exit, copy/paste). */
  router.post('/exam-sessions/:id/events', requireRole('STUDENT'), async (req, res) => {
    const id = idParam(req.params);
    const body = parse(BrowserEvent, req.body);
    const a = auth(req);
    await db(req, async (tx) => {
      const s = await tx.examSession.findFirst({ where: { id, userId: a.userId } });
      if (!s) throw new HttpError(404, 'Session not found', 'NOT_FOUND');
      if (!s.proctored) return;
      if ((await tx.proctoringEvent.count({ where: { sessionId: id } })) >= MAX_BROWSER_EVENTS) return;
      // Clamp client timestamps into the attempt window; clocks and tabs can lie.
      const lo = s.startedAt.getTime();
      const hi = Math.min(Date.now(), (s.submittedAt ?? s.expiresAt).getTime());
      const clamp = (t: number) => Math.min(hi, Math.max(lo, t));
      const start = clamp(new Date(body.startedAt).getTime());
      const end = body.endedAt ? clamp(new Date(body.endedAt).getTime()) : start;
      await tx.proctoringEvent.create({
        data: { tenantId: a.tenantId, sessionId: id, type: body.type, source: 'BROWSER', startedAt: new Date(start), endedAt: new Date(end), durationMs: Math.max(0, end - start) },
      });
    });
    res.status(202).json({ recorded: true });
  });

  return router;
}
