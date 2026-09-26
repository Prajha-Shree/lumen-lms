import { beforeAll, describe, expect, inject, it } from 'vitest';
import { purgeExpiredProctoringEvents, runSnapshotsForTenant } from '../src/jobs/analytics.js';
import { withSystem } from '../src/lib/db.js';
import { assessRisk, computeStreak, localDays, safeTimeZone, scoreBuckets, type RiskInput } from '../src/modules/analytics/queries.js';
import { createTenantFixture } from './helpers/factories.js';
import { as, login } from './helpers/http.js';

describe('analytics helpers', () => {
  it('streaks count consecutive days and survive until the end of today', () => {
    expect(computeStreak(['2026-09-20', '2026-09-21', '2026-09-22'], '2026-09-22')).toEqual({ current: 3, longest: 3, activeToday: true });
    expect(computeStreak(['2026-09-20', '2026-09-21'], '2026-09-22')).toEqual({ current: 2, longest: 2, activeToday: false });
    expect(computeStreak(['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-20'], '2026-09-25')).toEqual({ current: 0, longest: 3, activeToday: false });
    expect(computeStreak([], '2026-09-25')).toEqual({ current: 0, longest: 0, activeToday: false });
  });

  it('local days respect the timezone and step across month ends', () => {
    const now = new Date('2026-10-01T03:00:00Z');
    expect(localDays('UTC', 3, now)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
    expect(localDays('America/Los_Angeles', 1, now)).toEqual(['2026-09-30']); // still the 30th there
  });

  it('rejects invalid time zones', () => {
    expect(safeTimeZone('Europe/Paris')).toBe('Europe/Paris');
    expect(safeTimeZone("UTC'; DROP TABLE users;--")).toBe('UTC');
    expect(safeTimeZone(undefined)).toBe('UTC');
  });

  it('buckets scores including 100 into the top bucket', () => {
    const b = scoreBuckets([0, 9, 10, 55, 99, 100]);
    expect(b[0]!.count).toBe(2);
    expect(b[1]!.count).toBe(1);
    expect(b[5]!.count).toBe(1);
    expect(b[9]).toEqual({ range: '90–100', count: 2 });
  });

  it('at-risk rules explain themselves and ignore healthy learners', () => {
    const now = new Date('2026-09-26T12:00:00Z');
    const base = { courseId: 'c', courseTitle: 'C', enrolledAt: new Date('2026-08-01'), passingScore: 60 };
    const students: RiskInput[] = [
      { ...base, userId: 'ok', name: 'Healthy', progress: 0.7, lastActiveAt: new Date('2026-09-25'), scores: [85] },
      { ...base, userId: 'idle', name: 'Idle', progress: 0.6, lastActiveAt: new Date('2026-09-10'), scores: [] },
      { ...base, userId: 'struggling', name: 'Struggling', progress: 0.1, lastActiveAt: new Date('2026-09-17'), scores: [40, 70] },
    ];
    const risk = assessRisk(students, now);
    expect(risk.map((r) => r.userId)).toEqual(['struggling', 'idle']);
    expect(risk[0]!.level).toBe('high');
    expect(risk[0]!.reasons).toEqual(['No activity for 9 days', 'Behind the class: 10% vs median 60%', 'Latest exam 40% (pass 60%)', 'Scores dropped 30 points']);
    expect(risk[1]!.reasons).toEqual(['No activity for 16 days']);
  });
});

describe.skipIf(!inject('dbAvailable'))('dashboards', () => {
  let fx: Awaited<ReturnType<typeof createTenantFixture>>;
  let tokens: Record<'admin' | 'instructor' | 'student', string>;

  beforeAll(async () => {
    fx = await createTenantFixture();
    await withSystem(async (tx) => {
      const mod = await tx.module.create({ data: { tenantId: fx.tenant.id, courseId: fx.course.id, title: 'M', position: 0 } });
      const lesson = await tx.lesson.create({ data: { tenantId: fx.tenant.id, courseId: fx.course.id, moduleId: mod.id, title: 'L', position: 0 } });
      await tx.enrollment.create({ data: { tenantId: fx.tenant.id, courseId: fx.course.id, userId: fx.users.STUDENT.id } });
      await tx.lessonProgress.create({ data: { tenantId: fx.tenant.id, userId: fx.users.STUDENT.id, courseId: fx.course.id, lessonId: lesson.id, status: 'COMPLETED', completedAt: new Date() } });
      const day = (d: number) => new Date(Date.now() - d * 86_400_000);
      await tx.learningActivity.createMany({
        data: [0, 1, 2, 5].map((d) => ({ tenantId: fx.tenant.id, userId: fx.users.STUDENT.id, courseId: fx.course.id, type: 'LESSON_COMPLETE' as const, xp: 10, occurredAt: day(d) })),
      });
      // Another instructor's course in the same tenant must not appear on this instructor's dashboard.
      const other = await tx.user.create({ data: { tenantId: fx.tenant.id, email: 'other@x.test', name: 'Other', role: 'INSTRUCTOR', passwordHash: 'x' } });
      await tx.course.create({ data: { tenantId: fx.tenant.id, instructorId: other.id, title: 'Not mine', status: 'PUBLISHED' } });
    });
    tokens = {
      admin: (await login(fx.slug, fx.users.INSTITUTION_ADMIN.email)).token,
      instructor: (await login(fx.slug, fx.users.INSTRUCTOR.email)).token,
      student: (await login(fx.slug, fx.users.STUDENT.email)).token,
    };
  });

  it('student dashboard: progress, streak and a zero-filled activity series', async () => {
    const res = await as(tokens.student).get('/api/dashboard/student?tz=UTC');
    expect(res.status).toBe(200);
    expect(res.body.courses[0]).toMatchObject({ completedLessons: 1, totalLessons: 1 });
    expect(res.body.streak).toMatchObject({ current: 3, longest: 3 });
    expect(res.body.activity).toHaveLength(28);
    expect(res.body.activity.at(-1).completions).toBe(1);
  });

  it('instructor dashboard only covers their own courses', async () => {
    const res = await as(tokens.instructor).get('/api/dashboard/instructor?tz=UTC');
    expect(res.status).toBe(200);
    expect(res.body.courses.map((c: { title: string }) => c.title)).toEqual([fx.course.title]);
    expect(res.body.stats.students).toBe(1);
    expect(res.body.heatmap.length).toBeGreaterThan(0);
    expect(res.body.scoreDistribution).toHaveLength(10);
  });

  it('course insights give a per-lesson funnel', async () => {
    const res = await as(tokens.instructor).get(`/api/courses/${fx.course.id}/insights?tz=UTC`);
    expect(res.body).toMatchObject({ enrolled: 1, funnel: [{ position: 1, completed: 1 }] });
    expect((await as(tokens.student).get(`/api/courses/${fx.course.id}/insights`)).status).toBe(403);
  });

  it('role gates: students and instructors cannot see the admin dashboard', async () => {
    expect((await as(tokens.student).get('/api/dashboard/instructor')).status).toBe(403);
    expect((await as(tokens.instructor).get('/api/dashboard/admin')).status).toBe(403);
  });

  it('snapshot job backfills idempotently and feeds the admin trend', async () => {
    const first = await runSnapshotsForTenant(fx.tenant.id, 7);
    expect(first).toBe(7);
    expect(await runSnapshotsForTenant(fx.tenant.id, 7)).toBe(0);
    const res = await as(tokens.admin).get('/api/dashboard/admin?tz=UTC');
    expect(res.status).toBe(200);
    expect(res.body.trend.length).toBeGreaterThanOrEqual(7);
    expect(res.body.trend.some((d: { activeUsers: number }) => d.activeUsers === 1)).toBe(true);
    expect(res.body.stats).toMatchObject({ totalUsers: 4, enrollments: 1 });
  });

  it('proctoring retention purges only events past the tenant window', async () => {
    const ids = await withSystem(async (tx) => {
      await tx.tenant.update({ where: { id: fx.tenant.id }, data: { settings: { proctoringRetentionDays: 10 } } });
      const exam = await tx.exam.create({ data: { tenantId: fx.tenant.id, courseId: fx.course.id, title: 'E' } });
      const s = await tx.examSession.create({ data: { tenantId: fx.tenant.id, examId: exam.id, userId: fx.users.STUDENT.id, proctored: true, expiresAt: new Date() } });
      const old = await tx.proctoringEvent.create({ data: { tenantId: fx.tenant.id, sessionId: s.id, type: 'TAB_HIDDEN', source: 'BROWSER', startedAt: new Date(), createdAt: new Date(Date.now() - 11 * 86_400_000) } });
      const fresh = await tx.proctoringEvent.create({ data: { tenantId: fx.tenant.id, sessionId: s.id, type: 'TAB_HIDDEN', source: 'BROWSER', startedAt: new Date() } });
      return { old: old.id, fresh: fresh.id };
    });
    await purgeExpiredProctoringEvents();
    const left = await withSystem((tx) => tx.proctoringEvent.findMany({ where: { id: { in: [ids.old, ids.fresh] } }, select: { id: true } }));
    expect(left.map((e) => e.id)).toEqual([ids.fresh]);
  });
});
