import { Router } from 'express';
import type { Tx } from '../../lib/db.js';
import { idParam } from '../../lib/validate.js';
import { auth, db, isStaff, requireRole } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { loadCourse } from '../courses/access.js';
import { runSnapshotsForTenant } from '../../jobs/analytics.js';
import { assessRisk, dailySeries, engagementHeatmap, riskInputs, safeTimeZone, scoreBuckets, streak } from './queries.js';

const tzOf = (q: unknown) => safeTimeZone((q as { tz?: unknown }).tz);

/** Courses an instructor teaches (admins: every course in the tenant). */
async function staffCourseIds(tx: Tx, role: string, userId: string) {
  const rows = await tx.course.findMany({ where: role === 'INSTRUCTOR' ? { instructorId: userId } : {}, select: { id: true } });
  return rows.map((r) => r.id);
}

export function analyticsRouter(): Router {
  const router = Router();

  // ─── Student ────────────────────────────────────────────────────────────────
  router.get('/dashboard/student', requireRole('STUDENT'), async (req, res) => {
    const a = auth(req);
    const tz = tzOf(req.query);
    const data = await db(req, async (tx) => {
      const enrollments = await tx.enrollment.findMany({
        where: { userId: a.userId, status: { not: 'DROPPED' } },
        include: { course: { select: { id: true, title: true, accent: true, _count: { select: { lessons: true } } } } },
        orderBy: { enrolledAt: 'desc' },
      });
      const courseIds = enrollments.map((e) => e.courseId);
      const [done, lastSeen, sessions, profile, badges, user, dueAssignments, series, streakInfo] = await Promise.all([
        tx.lessonProgress.groupBy({ by: ['courseId'], where: { userId: a.userId, status: 'COMPLETED' }, _count: { _all: true } }),
        tx.learningActivity.groupBy({ by: ['courseId'], where: { userId: a.userId }, _max: { occurredAt: true } }),
        tx.examSession.findMany({
          where: { userId: a.userId, status: { in: ['SUBMITTED', 'EXPIRED'] } },
          orderBy: { submittedAt: 'desc' },
          take: 10,
          select: { id: true, percent: true, submittedAt: true, topicScores: true, exam: { select: { title: true, passingScore: true } } },
        }),
        tx.cognitiveProfile.findUnique({ where: { userId: a.userId } }),
        tx.userBadge.findMany({ where: { userId: a.userId }, orderBy: { awardedAt: 'desc' } }),
        tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { xp: true } }),
        tx.assignment.findMany({
          where: { courseId: { in: courseIds }, published: true, dueAt: { gte: new Date() }, submissions: { none: { userId: a.userId } } },
          orderBy: { dueAt: 'asc' },
          take: 5,
          select: { id: true, title: true, dueAt: true, course: { select: { id: true, title: true } } },
        }),
        dailySeries(tx, tz, 28, { userId: a.userId }),
        streak(tx, a.userId, tz),
      ]);

      // Current mastery: exam evidence (recent, weighted 0.6) blended with the profile.
      const examTopics: Record<string, number[]> = {};
      for (const s of sessions.slice(0, 5)) {
        for (const [t, v] of Object.entries((s.topicScores ?? {}) as Record<string, number>)) (examTopics[t] ??= []).push(v);
      }
      const profileTopics = (profile?.topicMastery ?? {}) as Record<string, number>;
      const topics = new Set([...Object.keys(examTopics), ...Object.keys(profileTopics)]);
      const mastery = Object.fromEntries(
        [...topics].map((t) => {
          const e = examTopics[t];
          const exam = e ? e.reduce((x, y) => x + y, 0) / e.length : undefined;
          const p = profileTopics[t];
          const v = exam !== undefined && p !== undefined ? 0.6 * exam + 0.4 * p : (exam ?? p ?? 0);
          return [t, Math.round(v * 100) / 100];
        }),
      );

      return {
        xp: user.xp,
        streak: streakInfo,
        activity: series.map((d) => ({ day: d.day, xp: d.xp, completions: d.completions })),
        courses: enrollments.map((e) => ({
          id: e.course.id,
          title: e.course.title,
          accent: e.course.accent,
          status: e.status,
          totalLessons: e.course._count.lessons,
          completedLessons: done.find((d) => d.courseId === e.courseId)?._count._all ?? 0,
          lastActiveAt: lastSeen.find((l) => l.courseId === e.courseId)?._max.occurredAt ?? null,
        })),
        scores: sessions.reverse().map((s) => ({ id: s.id, exam: s.exam.title, percent: s.percent ?? 0, passingScore: s.exam.passingScore, at: s.submittedAt })),
        mastery,
        hasProfile: !!profile,
        badges: badges.map((b) => ({ badge: b.badge, awardedAt: b.awardedAt })),
        dueAssignments,
      };
    });
    res.json(data);
  });

  // ─── Instructor (and admin, scoped to all courses) ──────────────────────────
  router.get('/dashboard/instructor', requireRole('INSTRUCTOR', 'INSTITUTION_ADMIN'), async (req, res) => {
    const a = auth(req);
    const tz = tzOf(req.query);
    const data = await db(req, async (tx) => {
      const courseIds = await staffCourseIds(tx, a.role, a.userId);
      const weekAgo = new Date(Date.now() - 7 * 86_400_000);
      const [courses, activeUsers, sessions, pendingReviews, heatmap, series, risk] = await Promise.all([
        tx.course.findMany({
          where: { id: { in: courseIds } },
          select: { id: true, title: true, status: true, accent: true, _count: { select: { lessons: true, enrollments: true } } },
          orderBy: { title: 'asc' },
        }),
        tx.learningActivity.findMany({ where: { courseId: { in: courseIds }, occurredAt: { gte: weekAgo } }, distinct: ['userId'], select: { userId: true } }),
        tx.examSession.findMany({
          where: { exam: { courseId: { in: courseIds } }, status: { in: ['SUBMITTED', 'EXPIRED'] }, submittedAt: { gte: new Date(Date.now() - 90 * 86_400_000) } },
          select: { percent: true, exam: { select: { courseId: true } } },
        }),
        tx.examSession.count({ where: { exam: { courseId: { in: courseIds } }, reviewStatus: 'PENDING' } }),
        engagementHeatmap(tx, tz, courseIds),
        dailySeries(tx, tz, 30, { courseIds }),
        riskInputs(tx, courseIds).then((r) => assessRisk(r)),
      ]);
      const progress = await tx.lessonProgress.groupBy({ by: ['courseId'], where: { courseId: { in: courseIds }, status: 'COMPLETED' }, _count: { _all: true } });
      const students = await tx.enrollment.findMany({ where: { courseId: { in: courseIds }, status: { not: 'DROPPED' } }, distinct: ['userId'], select: { userId: true } });
      const percents = sessions.map((s) => s.percent ?? 0);

      return {
        stats: {
          students: students.length,
          activeThisWeek: activeUsers.length,
          avgScore: percents.length ? Math.round(percents.reduce((x, y) => x + y, 0) / percents.length) : null,
          pendingReviews,
          atRisk: risk.length,
        },
        activity: series.map((d) => ({ day: d.day, activeStudents: d.users, completions: d.completions })),
        heatmap,
        scoreDistribution: scoreBuckets(percents),
        atRisk: risk.slice(0, 10).map(({ enrolledAt: _e, scores: _s, ...r }) => r),
        courses: courses.map((c) => {
          const cs = sessions.filter((s) => s.exam.courseId === c.id).map((s) => s.percent ?? 0);
          const totalPossible = c._count.lessons * c._count.enrollments;
          return {
            ...c,
            avgProgress: totalPossible ? Math.round(((progress.find((p) => p.courseId === c.id)?._count._all ?? 0) / totalPossible) * 100) : 0,
            avgScore: cs.length ? Math.round(cs.reduce((x, y) => x + y, 0) / cs.length) : null,
          };
        }),
      };
    });
    res.json(data);
  });

  // ─── One course, for staff ──────────────────────────────────────────────────
  router.get('/courses/:id/insights', async (req, res) => {
    const courseId = idParam(req.params);
    if (!isStaff(auth(req).role)) throw new HttpError(403, 'Staff only', 'FORBIDDEN');
    const tz = tzOf(req.query);
    const data = await db(req, async (tx) => {
      await loadCourse(tx, req, courseId);
      const [lessons, enrolled, completions, sessions, heatmap, series, risk] = await Promise.all([
        tx.lesson.findMany({ where: { courseId }, orderBy: [{ module: { position: 'asc' } }, { position: 'asc' }], select: { id: true, title: true } }),
        tx.enrollment.count({ where: { courseId, status: { not: 'DROPPED' } } }),
        tx.lessonProgress.groupBy({ by: ['lessonId'], where: { courseId, status: 'COMPLETED' }, _count: { _all: true } }),
        tx.examSession.findMany({ where: { exam: { courseId }, status: { in: ['SUBMITTED', 'EXPIRED'] } }, select: { percent: true, topicScores: true } }),
        engagementHeatmap(tx, tz, [courseId]),
        dailySeries(tx, tz, 30, { courseIds: [courseId] }),
        riskInputs(tx, [courseId]).then((r) => assessRisk(r)),
      ]);
      const topicTotals: Record<string, number[]> = {};
      for (const s of sessions) for (const [t, v] of Object.entries((s.topicScores ?? {}) as Record<string, number>)) (topicTotals[t] ??= []).push(v);
      return {
        enrolled,
        funnel: lessons.map((l, i) => ({
          position: i + 1,
          lessonId: l.id,
          title: l.title,
          completed: completions.find((c) => c.lessonId === l.id)?._count._all ?? 0,
        })),
        topicPerformance: Object.fromEntries(Object.entries(topicTotals).map(([t, v]) => [t, Math.round((v.reduce((x, y) => x + y, 0) / v.length) * 100) / 100])),
        scoreDistribution: scoreBuckets(sessions.map((s) => s.percent ?? 0)),
        heatmap,
        activity: series.map((d) => ({ day: d.day, activeStudents: d.users, completions: d.completions })),
        atRisk: risk.map(({ enrolledAt: _e, scores: _s, ...r }) => r),
      };
    });
    res.json(data);
  });

  // ─── Institution admin ──────────────────────────────────────────────────────
  router.get('/dashboard/admin', requireRole('INSTITUTION_ADMIN'), async (req, res) => {
    const a = auth(req);
    const tz = tzOf(req.query);
    const data = await db(req, async (tx) => {
      const since7 = new Date(Date.now() - 7 * 86_400_000);
      const since30 = new Date(Date.now() - 30 * 86_400_000);
      const [roles, active7, active30, courseStatus, enrollments, completedEnrollments, sessions, reviews, snapshots, topCourses] = await Promise.all([
        tx.user.groupBy({ by: ['role'], where: { isActive: true }, _count: { _all: true } }),
        tx.learningActivity.findMany({ where: { occurredAt: { gte: since7 } }, distinct: ['userId'], select: { userId: true } }),
        tx.learningActivity.findMany({ where: { occurredAt: { gte: since30 } }, distinct: ['userId'], select: { userId: true } }),
        tx.course.groupBy({ by: ['status'], _count: { _all: true } }),
        tx.enrollment.count({ where: { status: { not: 'DROPPED' } } }),
        tx.enrollment.count({ where: { status: 'COMPLETED' } }),
        tx.examSession.findMany({ where: { status: { in: ['SUBMITTED', 'EXPIRED'] }, submittedAt: { gte: since30 } }, select: { percent: true } }),
        tx.examSession.groupBy({ by: ['reviewStatus'], where: { proctored: true }, _count: { _all: true } }),
        tx.analyticsSnapshot.findMany({ where: { scope: 'TENANT', scopeId: a.tenantId, date: { gte: since30 } }, orderBy: { date: 'asc' } }),
        tx.course.findMany({
          where: { status: 'PUBLISHED' },
          select: { id: true, title: true, _count: { select: { enrollments: true } }, enrollments: { where: { status: 'COMPLETED' }, select: { id: true } } },
          orderBy: { enrollments: { _count: 'desc' } },
          take: 6,
        }),
      ]);
      const totalUsers = roles.reduce((s, r) => s + r._count._all, 0);
      const percents = sessions.map((s) => s.percent ?? 0);
      return {
        stats: {
          totalUsers,
          active7d: active7.length,
          active30d: active30.length,
          engagementRate: totalUsers ? Math.round((active7.length / totalUsers) * 100) : 0,
          publishedCourses: courseStatus.find((c) => c.status === 'PUBLISHED')?._count._all ?? 0,
          draftCourses: courseStatus.find((c) => c.status === 'DRAFT')?._count._all ?? 0,
          enrollments,
          completionRate: enrollments ? Math.round((completedEnrollments / enrollments) * 100) : 0,
          avgScore30d: percents.length ? Math.round(percents.reduce((x, y) => x + y, 0) / percents.length) : null,
        },
        roles: Object.fromEntries(roles.map((r) => [r.role, r._count._all])),
        proctoring: Object.fromEntries(reviews.map((r) => [r.reviewStatus, r._count._all])),
        // Trend from the nightly snapshot job (see src/jobs/analytics.ts).
        trend: snapshots.map((s) => ({ day: s.date.toISOString().slice(0, 10), ...(s.metrics as Record<string, number>) })),
        today: (await dailySeries(tx, tz, 1))[0],
        topCourses: topCourses.map((c) => ({
          id: c.id,
          title: c.title,
          enrollments: c._count.enrollments,
          completionRate: c._count.enrollments ? Math.round((c.enrollments.length / c._count.enrollments) * 100) : 0,
        })),
      };
    });
    res.json(data);
  });

  /** Admin: recompute this tenant's snapshots now (normally nightly). */
  router.post('/dashboard/admin/snapshots', requireRole('INSTITUTION_ADMIN'), async (req, res) => {
    const written = await runSnapshotsForTenant(auth(req).tenantId, 30);
    res.json({ written });
  });

  return router;
}
