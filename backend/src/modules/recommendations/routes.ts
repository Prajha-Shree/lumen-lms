import { Router } from 'express';
import { z } from 'zod';
import type { Tx } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { mlPost } from '../../lib/mlClient.js';
import { parse } from '../../lib/validate.js';
import { auth, db, requireRole } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';

const Query = z.object({
  courseId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(10).default(3),
});

const MlResponse = z.object({
  recommendations: z.array(z.object({ lessonId: z.string(), score: z.number(), reasons: z.array(z.string()), strategy: z.string() })),
});

type Candidate = {
  lessonId: string;
  courseId: string;
  title: string;
  topics: string[];
  difficulty: number;
  format: 'READING' | 'VIDEO' | 'INTERACTIVE';
  durationMinutes: number;
  position: number;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
};

/** Everything the ranker needs about one learner, gathered in one tenant-scoped transaction. */
async function gatherInputs(tx: Tx, userId: string, courseId?: string) {
  const enrollments = await tx.enrollment.findMany({
    where: { userId, status: { in: ['ACTIVE', 'COMPLETED'] }, ...(courseId && { courseId }), course: { status: 'PUBLISHED' } },
    select: { courseId: true },
  });
  const courseIds = enrollments.map((e) => e.courseId);
  if (!courseIds.length) return null;

  const [lessons, progress, profile, sessions, recent] = await Promise.all([
    tx.lesson.findMany({
      where: { courseId: { in: courseIds } },
      orderBy: [{ courseId: 'asc' }, { module: { position: 'asc' } }, { position: 'asc' }],
      select: { id: true, courseId: true, title: true, topics: true, difficulty: true, format: true, durationMinutes: true, course: { select: { title: true, accent: true } } },
    }),
    tx.lessonProgress.findMany({ where: { userId, courseId: { in: courseIds } }, select: { lessonId: true, status: true } }),
    tx.cognitiveProfile.findUnique({ where: { userId } }),
    tx.examSession.findMany({
      where: { userId, status: 'SUBMITTED' },
      orderBy: { submittedAt: 'desc' },
      take: 5,
      select: { topicScores: true },
    }),
    tx.recommendation.findMany({
      where: { userId, clickedAt: null, createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
      select: { lessonId: true, createdAt: true },
    }),
  ]);

  const status = new Map(progress.map((p) => [p.lessonId, p.status]));
  const positions = new Map<string, number>();
  const candidates: Candidate[] = lessons.map((l) => {
    const position = positions.get(l.courseId) ?? 0;
    positions.set(l.courseId, position + 1);
    return {
      lessonId: l.id,
      courseId: l.courseId,
      title: l.title,
      topics: l.topics,
      difficulty: l.difficulty,
      format: l.format,
      durationMinutes: l.durationMinutes,
      position,
      status: status.get(l.id) ?? 'NOT_STARTED',
    };
  });

  // Average per-topic correctness over the latest exam attempts (most recent evidence).
  const totals: Record<string, { sum: number; n: number }> = {};
  for (const s of sessions) {
    for (const [topic, v] of Object.entries((s.topicScores ?? {}) as Record<string, number>)) {
      const t = (totals[topic] ??= { sum: 0, n: 0 });
      t.sum += v;
      t.n += 1;
    }
  }
  const performance = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round((v.sum / v.n) * 100) / 100]));

  // "Shown but not followed" only counts once it has had a few hours to be acted on.
  const recentlyShown = [...new Set(recent.filter((r) => Date.now() - r.createdAt.getTime() > 3 * 3600 * 1000).map((r) => r.lessonId))];
  const lessonInfo = new Map(lessons.map((l) => [l.id, l]));
  return { candidates, profile, performance, recentlyShown, lessonInfo, recentIds: new Set(recent.map((r) => r.lessonId)) };
}

/** Local fallback when the ml-service is unreachable: resume, then course order. */
function sequentialFallback(candidates: Candidate[], limit: number) {
  const open = candidates.filter((c) => c.status !== 'COMPLETED');
  const ordered = [...open.filter((c) => c.status === 'IN_PROGRESS'), ...open.filter((c) => c.status === 'NOT_STARTED')];
  return ordered.slice(0, limit).map((c) => ({
    lessonId: c.lessonId,
    score: 0,
    reasons: [c.status === 'IN_PROGRESS' ? 'Pick up where you left off' : 'Next in your course'],
    strategy: 'local-fallback',
  }));
}

export function recommendationsRouter(): Router {
  const router = Router();

  router.get('/', requireRole('STUDENT'), async (req, res) => {
    const q = parse(Query, req.query);
    const a = auth(req);
    const inputs = await db(req, (tx) => gatherInputs(tx, a.userId, q.courseId));
    if (!inputs) {
      if (q.courseId) throw new HttpError(403, 'Enroll in this course to get recommendations', 'NOT_ENROLLED');
      res.json({ recommendations: [], personalized: false });
      return;
    }

    let ranked;
    let degraded = false;
    try {
      const p = inputs.profile;
      ranked = (
        await mlPost(
          '/recommendations',
          {
            candidates: inputs.candidates,
            profile: p ? { modality: p.modality, pace: p.pace, topicMastery: p.topicMastery, growthAreas: p.growthAreas } : null,
            performance: inputs.performance,
            recentlyShown: inputs.recentlyShown,
            limit: q.limit,
          },
          MlResponse,
          { timeoutMs: 4000 },
        )
      ).recommendations;
    } catch (err) {
      // Recommendations are an enhancement: degrade to course order, never block learning.
      logger.warn({ err }, 'recommender unavailable, using local fallback');
      ranked = sequentialFallback(inputs.candidates, q.limit);
      degraded = true;
    }

    // Log what was shown (training data for a learned ranker); skip repeats within 24h.
    const toLog = ranked.filter((r) => !inputs.recentIds.has(r.lessonId));
    if (toLog.length) {
      await db(req, (tx) =>
        tx.recommendation.createMany({
          data: toLog.map((r) => ({
            tenantId: a.tenantId,
            userId: a.userId,
            lessonId: r.lessonId,
            courseId: inputs.lessonInfo.get(r.lessonId)!.courseId,
            score: r.score,
            reasons: r.reasons,
            strategy: r.strategy,
          })),
        }),
      );
    }

    res.json({
      personalized: !!inputs.profile && !degraded,
      degraded,
      recommendations: ranked.map((r) => {
        const l = inputs.lessonInfo.get(r.lessonId)!;
        const c = inputs.candidates.find((x) => x.lessonId === r.lessonId)!;
        return {
          lessonId: r.lessonId,
          courseId: l.courseId,
          courseTitle: l.course.title,
          accent: l.course.accent,
          title: l.title,
          format: l.format,
          durationMinutes: l.durationMinutes,
          difficulty: l.difficulty,
          topics: l.topics,
          status: c.status,
          score: r.score,
          reasons: r.reasons,
          strategy: r.strategy,
        };
      }),
    });
  });

  return router;
}
