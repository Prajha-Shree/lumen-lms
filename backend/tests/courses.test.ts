import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createTenantFixture } from './helpers/factories.js';
import { as, login } from './helpers/http.js';

describe.skipIf(!inject('dbAvailable'))('courses, lessons, enrollment, progress', () => {
  let fx: Awaited<ReturnType<typeof createTenantFixture>>;
  let instructor: string;
  let student: string;
  let courseId: string;
  let lessonIds: string[] = [];

  beforeAll(async () => {
    fx = await createTenantFixture();
    instructor = (await login(fx.slug, fx.users.INSTRUCTOR.email)).token;
    student = (await login(fx.slug, fx.users.STUDENT.email)).token;
  });

  it('instructor builds a draft course with a module and lessons', async () => {
    const c = await as(instructor).post('/api/courses').send({ title: 'Intro to Testing', level: 'BEGINNER' });
    expect(c.status).toBe(201);
    expect(c.body.course.status).toBe('DRAFT');
    courseId = c.body.course.id;

    const m = await as(instructor).post(`/api/courses/${courseId}/modules`).send({ title: 'Basics' });
    expect(m.status).toBe(201);
    for (const title of ['Why test?', 'Your first test']) {
      const l = await as(instructor).post(`/api/modules/${m.body.module.id}/lessons`).send({ title, content: '# Hi', topics: ['testing'] });
      expect(l.status).toBe(201);
      lessonIds.push(l.body.lesson.id);
    }
  });

  it('students cannot see drafts (404, not 403) or edit courses', async () => {
    expect((await as(student).get(`/api/courses/${courseId}`)).status).toBe(404);
    expect((await as(student).patch(`/api/courses/${courseId}`).send({ title: 'x' })).status).toBe(404);
    expect((await as(student).post('/api/courses').send({ title: 'Mine now' })).status).toBe(403);
  });

  it('publishing makes it visible; lessons require enrollment', async () => {
    expect((await as(instructor).patch(`/api/courses/${courseId}`).send({ status: 'PUBLISHED' })).status).toBe(200);
    const view = await as(student).get(`/api/courses/${courseId}`);
    expect(view.status).toBe(200);
    expect(view.body.course.enrollment).toBeNull();
    const lesson = await as(student).get(`/api/lessons/${lessonIds[0]}`);
    expect(lesson.status).toBe(403);
    expect(lesson.body.error.code).toBe('NOT_ENROLLED');
  });

  it('enrolled student progresses and completes the course', async () => {
    expect((await as(student).post(`/api/courses/${courseId}/enroll`)).status).toBe(201);
    const l0 = await as(student).get(`/api/lessons/${lessonIds[0]}`);
    expect(l0.status).toBe(200);
    expect(l0.body.next.id).toBe(lessonIds[1]);

    await as(student).post(`/api/lessons/${lessonIds[0]}/progress`).send({ event: 'view', secondsSpent: 30 });
    const c0 = await as(student).post(`/api/lessons/${lessonIds[0]}/progress`).send({ event: 'complete', secondsSpent: 60 });
    expect(c0.body.progress).toMatchObject({ status: 'COMPLETED', timeSpentSeconds: 90 });
    expect(c0.body.courseCompleted).toBe(false);

    const c1 = await as(student).post(`/api/lessons/${lessonIds[1]}/progress`).send({ event: 'complete' });
    expect(c1.body.courseCompleted).toBe(true);

    const list = await as(student).get('/api/courses');
    const mine = list.body.courses.find((c: { id: string }) => c.id === courseId);
    expect(mine.progress).toEqual({ total: 2, completed: 2 });
    expect(mine.enrollment.status).toBe('COMPLETED');
  });

  it('completing awards XP exactly once', async () => {
    const before = (await as(student).get('/api/auth/me')).body.user.xp;
    await as(student).post(`/api/lessons/${lessonIds[0]}/progress`).send({ event: 'complete' });
    const after = (await as(student).get('/api/auth/me')).body.user.xp;
    expect(after).toBe(before);
  });

  it('roster shows the student progress to staff only', async () => {
    const roster = await as(instructor).get(`/api/courses/${courseId}/students`);
    expect(roster.status).toBe(200);
    expect(roster.body.students[0]).toMatchObject({ completedLessons: 2, totalLessons: 2 });
    expect((await as(student).get(`/api/courses/${courseId}/students`)).status).toBe(403);
  });

  it('reordering must list every lesson exactly once', async () => {
    const detail = await as(instructor).get(`/api/courses/${courseId}`);
    const moduleId = detail.body.course.modules[0].id;
    expect((await as(instructor).put(`/api/modules/${moduleId}/lessons/order`).send({ ids: [lessonIds[1]] })).status).toBe(400);
    expect((await as(instructor).put(`/api/modules/${moduleId}/lessons/order`).send({ ids: [...lessonIds].reverse() })).status).toBe(204);
    const after = await as(instructor).get(`/api/courses/${courseId}`);
    expect(after.body.course.modules[0].lessons[0].id).toBe(lessonIds[1]);
  });

  it('uploads accept allowed types only and downloads require access', async () => {
    const ok = await as(instructor)
      .post(`/api/lessons/${lessonIds[0]}/attachments`)
      .attach('file', Buffer.from('notes'), { filename: 'notes.txt', contentType: 'text/plain' });
    expect(ok.status).toBe(201);
    const bad = await as(instructor)
      .post(`/api/lessons/${lessonIds[0]}/attachments`)
      .attach('file', Buffer.from('MZ'), { filename: 'evil.exe', contentType: 'application/x-msdownload' });
    expect(bad.status).toBe(415);

    const dl = await as(student).get(`/api/attachments/${ok.body.attachment.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toContain('notes.txt');

    const outsider = await createTenantFixture(['STUDENT']);
    const otherToken = (await login(outsider.slug, outsider.users.STUDENT.email)).token;
    expect((await as(otherToken).get(`/api/attachments/${ok.body.attachment.id}/download`)).status).toBe(404);
  });

  it('partial updates never reset omitted fields (Zod 4 .partial() + .default() regression)', async () => {
    await as(instructor).patch(`/api/courses/${courseId}`).send({ description: 'Keep me', tags: ['keep'], accent: 'rose' });
    await as(instructor).patch(`/api/courses/${courseId}`).send({ status: 'PUBLISHED' });
    const course = (await as(instructor).get(`/api/courses/${courseId}`)).body.course;
    expect(course).toMatchObject({ description: 'Keep me', tags: ['keep'], accent: 'rose' });

    await as(instructor).patch(`/api/lessons/${lessonIds[0]}`).send({ content: 'Important body', difficulty: 4 });
    await as(instructor).patch(`/api/lessons/${lessonIds[0]}`).send({ title: 'Renamed' });
    const lesson = (await as(instructor).get(`/api/lessons/${lessonIds[0]}`)).body.lesson;
    expect(lesson).toMatchObject({ title: 'Renamed', content: 'Important body', difficulty: 4 });

    const moduleId = course.modules[0].id;
    await as(instructor).patch(`/api/modules/${moduleId}`).send({ description: 'Module notes' });
    await as(instructor).patch(`/api/modules/${moduleId}`).send({ title: 'Basics 2' });
    const mod = (await as(instructor).get(`/api/courses/${courseId}`)).body.course.modules[0];
    expect(mod).toMatchObject({ title: 'Basics 2', description: 'Module notes' });
  });

  it('cannot delete a course with enrollments', async () => {
    const res = await as(instructor).delete(`/api/courses/${courseId}`);
    expect(res.status).toBe(409);
  });
});
