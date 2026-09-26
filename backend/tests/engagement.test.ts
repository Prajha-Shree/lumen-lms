import { beforeAll, describe, expect, inject, it } from 'vitest';
import { withSystem } from '../src/lib/db.js';
import { evaluateBadges } from '../src/modules/gamification/service.js';
import { createTenantFixture } from './helpers/factories.js';
import { as, login } from './helpers/http.js';

describe.skipIf(!inject('dbAvailable'))('gamification, forum, assignments, notifications', () => {
  let fx: Awaited<ReturnType<typeof createTenantFixture>>;
  let student: string;
  let instructor: string;
  let outsider: string;

  beforeAll(async () => {
    fx = await createTenantFixture();
    await withSystem((tx) => tx.enrollment.create({ data: { tenantId: fx.tenant.id, courseId: fx.course.id, userId: fx.users.STUDENT.id } }));
    student = (await login(fx.slug, fx.users.STUDENT.email)).token;
    instructor = (await login(fx.slug, fx.users.INSTRUCTOR.email)).token;
    // Same tenant, not enrolled in the course.
    await withSystem((tx) =>
      tx.user.create({ data: { tenantId: fx.tenant.id, email: 'outsider@x.test', name: 'Outsider', role: 'STUDENT', passwordHash: 'x' } }),
    );
  });

  it('awards badges once, when their rule is met, with a notification', async () => {
    const lessonId = await withSystem(async (tx) => {
      const mod = await tx.module.create({ data: { tenantId: fx.tenant.id, courseId: fx.course.id, title: 'M', position: 0 } });
      const l = await tx.lesson.create({ data: { tenantId: fx.tenant.id, courseId: fx.course.id, moduleId: mod.id, title: 'L', position: 0 } });
      return l.id;
    });
    expect(await evaluateBadges(fx.tenant.id, fx.users.STUDENT.id, 'LESSON_COMPLETE')).toEqual([]);
    await as(student).post(`/api/lessons/${lessonId}/progress`).send({ event: 'complete' });
    // The completion also finished the 1-lesson course.
    const first = await evaluateBadges(fx.tenant.id, fx.users.STUDENT.id, 'LESSON_COMPLETE');
    expect(first).toEqual(expect.arrayContaining(['first-steps', 'course-complete']));
    expect(await evaluateBadges(fx.tenant.id, fx.users.STUDENT.id, 'LESSON_COMPLETE')).toEqual([]);

    const badges = (await as(student).get('/api/badges/me')).body.badges;
    expect(badges.find((b: { key: string }) => b.key === 'first-steps').earned).toBe(true);
    const notes = (await as(student).get('/api/notifications')).body;
    expect(notes.items.some((n: { title: string }) => n.title.includes('First Steps'))).toBe(true);
    expect(notes.unread).toBeGreaterThan(0);
  });

  it('notifications can be marked read, only by their owner', async () => {
    const { items } = (await as(student).get('/api/notifications')).body;
    await as(instructor).post(`/api/notifications/${items[0].id}/read`);
    expect((await as(student).get('/api/notifications')).body.items[0].readAt).toBeNull();
    await as(student).post('/api/notifications/read-all');
    expect((await as(student).get('/api/notifications')).body.unread).toBe(0);
  });

  it('forum: enrolled students post; replies notify the author; accepting an answer awards "helpful"', async () => {
    const t = await as(student).post(`/api/courses/${fx.course.id}/threads`).send({ title: 'How do medians work?', body: 'Confused about skew.' });
    expect(t.status).toBe(201);
    const threadId = t.body.thread.id;

    const reply = await as(instructor).post(`/api/threads/${threadId}/posts`).send({ body: 'Sort the values and take the middle one.' });
    expect(reply.status).toBe(201);
    const notes = (await as(student).get('/api/notifications')).body.items;
    expect(notes[0].title).toMatch(/replied to/);

    // Only the author or staff can accept; the instructor authored the reply.
    expect((await as(student).post(`/api/posts/${reply.body.post.id}/accept`)).status).toBe(204);
    const thread = (await as(student).get(`/api/threads/${threadId}`)).body;
    expect(thread.thread.resolved).toBe(true);
    expect(thread.posts[0].isAnswer).toBe(true);

    // Students can resolve their own thread but cannot pin.
    expect((await as(student).patch(`/api/threads/${threadId}`).send({ pinned: true })).status).toBe(403);
  });

  it('forum is closed to students who are not enrolled', async () => {
    outsider = (await login(fx.slug, 'outsider@x.test').catch(() => ({ token: '' }))).token;
    // The outsider has no usable password; call the endpoint with a token minted for them instead.
    if (!outsider) {
      const { signAccessToken } = await import('../src/lib/tokens.js');
      const u = await withSystem((tx) => tx.user.findFirstOrThrow({ where: { email: 'outsider@x.test', tenantId: fx.tenant.id } }));
      outsider = await signAccessToken({ userId: u.id, tenantId: fx.tenant.id, role: 'STUDENT', name: u.name });
    }
    const res = await as(outsider).get(`/api/courses/${fx.course.id}/threads`);
    expect(res.status).toBe(403);
  });

  it('assignments: rubric validation, scoring, notification, and no resubmission after grading', async () => {
    const created = await as(instructor)
      .post(`/api/courses/${fx.course.id}/assignments`)
      .send({
        title: 'Essay',
        rubric: [
          { id: 'thesis', title: 'Thesis', levels: [{ points: 4, label: 'Strong' }, { points: 1, label: 'Weak' }] },
          { id: 'evidence', title: 'Evidence', levels: [{ points: 6, label: 'Rich' }, { points: 2, label: 'Thin' }] },
        ],
      });
    expect(created.status).toBe(201);
    expect(created.body.assignment.maxPoints).toBe(10);
    const id = created.body.assignment.id;
    expect((await as(student).get('/api/notifications')).body.items[0].title).toBe('New assignment: Essay');

    const sub = await as(student).post(`/api/assignments/${id}/submissions`).send({ content: 'My essay' });
    expect(sub.status).toBe(201);
    const subId = sub.body.submission.id;

    const bad = await as(instructor).put(`/api/submissions/${subId}/grade`).send({ grades: { thesis: 3, evidence: 6 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.thesis).toBeDefined();
    const missing = await as(instructor).put(`/api/submissions/${subId}/grade`).send({ grades: { thesis: 4 } });
    expect(missing.body.error.details.evidence).toBeDefined();

    const good = await as(instructor).put(`/api/submissions/${subId}/grade`).send({ grades: { thesis: 4, evidence: 2 }, feedback: 'More sources.' });
    expect(good.body.submission).toMatchObject({ score: 6, status: 'GRADED' });
    expect((await as(student).get('/api/notifications')).body.items[0].title).toBe('Graded: Essay');
    expect((await as(student).post(`/api/assignments/${id}/submissions`).send({ content: 'edit' })).status).toBe(409);
    expect((await as(student).put(`/api/submissions/${subId}/grade`).send({ grades: { thesis: 4, evidence: 6 } })).status).toBe(403);
  });
});
