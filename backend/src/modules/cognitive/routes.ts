import type { CognitiveProfile, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { events } from '../../lib/events.js';
import { mlPost } from '../../lib/mlClient.js';
import { idParam, parse } from '../../lib/validate.js';
import { auth, db, isStaff, requireRole } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { recordActivity } from '../../services/activity.js';

const ResponseBody = z.object({
  itemId: z.string().min(1).max(64),
  answer: z.string().min(1).max(8),
  responseTimeMs: z.number().int().min(0).max(3_600_000),
  confidence: z.number().int().min(1).max(4).nullable().optional(),
});
type StoredResponse = z.infer<typeof ResponseBody>;

const MlItem = z.object({
  id: z.string(),
  kind: z.string(),
  prompt: z.string(),
  options: z.array(z.object({ id: z.string(), text: z.string() })),
  asksConfidence: z.boolean(),
});
const MlProfile = z.object({
  modality: z.record(z.string(), z.number()),
  pace: z.string(),
  processingSpeed: z.number(),
  calibration: z.number(),
  topicMastery: z.record(z.string(), z.number()),
  strengths: z.array(z.string()),
  growthAreas: z.array(z.string()),
  summary: z.string(),
  rapidGuesses: z.number(),
});
const MlNext = z.object({
  done: z.boolean(),
  answered: z.number(),
  total: z.number(),
  item: MlItem.nullable().optional(),
  profile: MlProfile.nullable().optional(),
});

const UNAVAILABLE = 'The learning-profile service is temporarily unavailable. Your answers so far are saved; please try again shortly.';

const nextStep = (responses: StoredResponse[]) => mlPost('/cognitive/next', { responses }, MlNext, { unavailableMessage: UNAVAILABLE });

export function publicProfile(p: CognitiveProfile) {
  return {
    id: p.id,
    userId: p.userId,
    version: p.version,
    modality: p.modality,
    pace: p.pace,
    processingSpeed: p.processingSpeed,
    calibration: p.calibration,
    topicMastery: p.topicMastery,
    strengths: p.strengths,
    growthAreas: p.growthAreas,
    summary: p.summary,
    updatedAt: p.updatedAt,
  };
}

export function cognitiveRouter(): Router {
  const router = Router();

  /** Starts an assessment, or resumes the one already in progress. */
  router.post('/assessments', requireRole('STUDENT'), async (req, res) => {
    const a = auth(req);
    const assessment = await db(req, async (tx) => {
      const current = await tx.cognitiveAssessment.findFirst({ where: { userId: a.userId, status: 'IN_PROGRESS' }, orderBy: { startedAt: 'desc' } });
      return current ?? tx.cognitiveAssessment.create({ data: { tenantId: a.tenantId, userId: a.userId } });
    });
    const step = await nextStep(assessment.responses as StoredResponse[]);
    res.status(201).json({ assessmentId: assessment.id, ...step });
  });

  router.get('/assessments/current', requireRole('STUDENT'), async (req, res) => {
    const a = auth(req);
    const assessment = await db(req, (tx) =>
      tx.cognitiveAssessment.findFirst({ where: { userId: a.userId, status: 'IN_PROGRESS' }, orderBy: { startedAt: 'desc' } }),
    );
    if (!assessment) {
      res.json({ assessmentId: null });
      return;
    }
    const step = await nextStep(assessment.responses as StoredResponse[]);
    res.json({ assessmentId: assessment.id, ...step });
  });

  /**
   * Records one answer. The ml-service re-validates the whole sequence, so answering
   * an item that wasn't asked (or answering twice) is rejected. On the final answer
   * the profile is stored and returned.
   */
  router.post('/assessments/:id/responses', requireRole('STUDENT'), async (req, res) => {
    const id = idParam(req.params);
    const body = parse(ResponseBody, req.body);
    const a = auth(req);

    const assessment = await db(req, (tx) => tx.cognitiveAssessment.findFirst({ where: { id, userId: a.userId } }));
    if (!assessment) throw new HttpError(404, 'Assessment not found', 'NOT_FOUND');
    if (assessment.status !== 'IN_PROGRESS') throw new HttpError(409, 'This assessment is already finished', 'ASSESSMENT_CLOSED');

    const responses = [...(assessment.responses as StoredResponse[]), { ...body, confidence: body.confidence ?? null }];
    const step = await nextStep(responses);

    if (!step.done) {
      await db(req, (tx) => tx.cognitiveAssessment.update({ where: { id }, data: { responses: responses as Prisma.InputJsonValue } }));
      res.json(step);
      return;
    }

    const p = step.profile!;
    const result = await db(req, async (tx) => {
      await tx.cognitiveAssessment.update({
        where: { id },
        data: { responses: responses as Prisma.InputJsonValue, status: 'COMPLETED', completedAt: new Date() },
      });
      const data = {
        assessmentId: id,
        modality: p.modality,
        pace: p.pace,
        processingSpeed: p.processingSpeed,
        calibration: p.calibration,
        topicMastery: p.topicMastery,
        strengths: p.strengths,
        growthAreas: p.growthAreas,
        summary: p.summary,
      };
      const profile = await tx.cognitiveProfile.upsert({
        where: { userId: a.userId },
        create: { tenantId: a.tenantId, userId: a.userId, ...data },
        update: { ...data, version: { increment: 1 } },
      });
      const activity = await recordActivity(tx, { tenantId: a.tenantId, userId: a.userId, type: 'ASSESSMENT_COMPLETE', metadata: { assessmentId: id } });
      return { profile, activity };
    });
    events.emit('activity', result.activity);
    res.json({ ...step, profile: publicProfile(result.profile), rapidGuesses: p.rapidGuesses });
  });

  router.get('/profile/me', async (req, res) => {
    const profile = await db(req, (tx) => tx.cognitiveProfile.findUnique({ where: { userId: auth(req).userId } }));
    res.json({ profile: profile ? publicProfile(profile) : null });
  });

  /** Staff view of a student's profile (to tailor support), tenant-scoped by RLS. */
  router.get('/profile/:id', async (req, res) => {
    const userId = idParam(req.params);
    if (!isStaff(auth(req).role)) throw new HttpError(403, 'Staff only', 'FORBIDDEN');
    const profile = await db(req, (tx) => tx.cognitiveProfile.findUnique({ where: { userId } }));
    res.json({ profile: profile ? publicProfile(profile) : null });
  });

  /** Right to reset: deletes the profile and every stored answer. */
  router.delete('/profile/me', async (req, res) => {
    const { userId } = auth(req);
    await db(req, async (tx) => {
      await tx.cognitiveProfile.deleteMany({ where: { userId } });
      await tx.cognitiveAssessment.deleteMany({ where: { userId } });
    });
    res.status(204).end();
  });

  return router;
}
