import { beforeAll, describe, expect, inject, it } from 'vitest';
import { withSystem } from '../src/lib/db.js';
import { createTenantFixture } from './helpers/factories.js';
import { as, login } from './helpers/http.js';
import { stubMl } from './helpers/mlStub.js';

describe.skipIf(!inject('dbAvailable'))('recommendations orchestration', () => {
  let fx: Awaited<ReturnType<typeof createTenantFixture>>;
  let student: string;
  let lessons: string[];

  beforeAll(async () => {
    fx = await createTenantFixture();
    lessons = await withSystem(async (tx) => {
      const mod = await tx.module.create({ data: { tenantId: fx.tenant.id, courseId: fx.course.id, title: 'M', position: 0 } });
      const ids = [];
      for (const [i, topic] of ['statistics', 'probability', 'visualization'].entries()) {
        const l = await tx.lesson.create({
          data: { tenantId: fx.tenant.id, courseId: fx.course.id, moduleId: mod.id, title: `L${i}`, topics: [topic], position: i },
        });
        ids.push(l.id);
      }
      await tx.enrollment.create({ data: { tenantId: fx.tenant.id, courseId: fx.course.id, userId: fx.users.STUDENT.id } });
      await tx.lessonProgress.create({
        data: { tenantId: fx.tenant.id, userId: fx.users.STUDENT.id, courseId: fx.course.id, lessonId: ids[0]!, status: 'COMPLETED', completedAt: new Date() },
      });
      return ids;
    });
    student = (await login(fx.slug, fx.users.STUDENT.email)).token;
  });

  it('sends candidates with progress to the ranker and enriches the result', async () => {
    const calls = stubMl((_p, body) => {
      const b = body as { candidates: { lessonId: string; status: string; position: number }[] };
      const open = b.candidates.filter((c) => c.status !== 'COMPLETED');
      return { json: { recommendations: open.map((c) => ({ lessonId: c.lessonId, score: 0.5, reasons: ['Test reason'], strategy: 'sequential-fallback' })) } };
    });
    const res = await as(student).get(`/api/recommendations?courseId=${fx.course.id}`);
    expect(res.status).toBe(200);
    const sent = calls[0]!.body as { candidates: { lessonId: string; status: string; position: number }[]; profile: unknown };
    expect(sent.candidates.map((c) => c.status)).toEqual(['COMPLETED', 'NOT_STARTED', 'NOT_STARTED']);
    expect(sent.candidates.map((c) => c.position)).toEqual([0, 1, 2]);
    expect(sent.profile).toBeNull();
    expect(res.body.recommendations[0]).toMatchObject({ lessonId: lessons[1], title: 'L1', courseTitle: fx.course.title, reasons: ['Test reason'] });
    expect(res.body.personalized).toBe(false);
  });

  it('falls back to course order when the ml-service is down (no error for the learner)', async () => {
    stubMl(() => 'network-error');
    const res = await as(student).get(`/api/recommendations?courseId=${fx.course.id}`);
    expect(res.status).toBe(200);
    expect(res.body.degraded).toBe(true);
    expect(res.body.recommendations.map((r: { lessonId: string }) => r.lessonId)).toEqual([lessons[1], lessons[2]]);
  });

  it('logs recommendations without duplicating within 24h, and completion marks them followed', async () => {
    stubMl(() => 'network-error');
    await as(student).get(`/api/recommendations?courseId=${fx.course.id}`);
    const logged = await withSystem((tx) => tx.recommendation.findMany({ where: { userId: fx.users.STUDENT.id } }));
    expect(logged.filter((r) => r.lessonId === lessons[1]).length).toBe(1);

    await as(student).post(`/api/lessons/${lessons[1]}/progress`).send({ event: 'complete' });
    const followed = await withSystem((tx) => tx.recommendation.findFirst({ where: { userId: fx.users.STUDENT.id, lessonId: lessons[1] } }));
    expect(followed?.clickedAt).not.toBeNull();
  });

  it('requires enrollment for a course-scoped request', async () => {
    const other = await createTenantFixture(['STUDENT']);
    const token = (await login(other.slug, other.users.STUDENT.email)).token;
    expect((await as(token).get(`/api/recommendations?courseId=${other.course.id}`)).status).toBe(403);
  });
});
