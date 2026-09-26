import { beforeAll, describe, expect, inject, it } from 'vitest';
import { withSystem } from '../src/lib/db.js';
import { createTenantFixture } from './helpers/factories.js';
import { as, login } from './helpers/http.js';
import { stubMl } from './helpers/mlStub.js';

const FRAME = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]); // bytes are opaque to the backend

describe.skipIf(!inject('dbAvailable'))('exams and proctoring', () => {
  let fx: Awaited<ReturnType<typeof createTenantFixture>>;
  let instructor: string;
  let student: string;
  let examId: string;
  let questionIds: string[] = [];

  beforeAll(async () => {
    fx = await createTenantFixture();
    await withSystem((tx) => tx.enrollment.create({ data: { tenantId: fx.tenant.id, courseId: fx.course.id, userId: fx.users.STUDENT.id } }));
    instructor = (await login(fx.slug, fx.users.INSTRUCTOR.email)).token;
    student = (await login(fx.slug, fx.users.STUDENT.email)).token;
  });

  it('instructor authors a proctored exam; publishing needs questions', async () => {
    const e = await as(instructor).post(`/api/courses/${fx.course.id}/exams`).send({ title: 'Checkpoint', durationMinutes: 10, proctored: true, maxAttempts: 2 });
    expect(e.status).toBe(201);
    examId = e.body.exam.id;
    expect((await as(instructor).patch(`/api/exams/${examId}`).send({ status: 'PUBLISHED' })).status).toBe(400);

    const q1 = await as(instructor).post(`/api/exams/${examId}/questions`).send({ prompt: 'Median of 1,2,9?', options: ['2', '4'], correct: [0], topic: 'statistics' });
    const q2 = await as(instructor).post(`/api/exams/${examId}/questions`).send({ prompt: 'Pick primes', options: ['2', '3', '4'], correct: [0, 1], topic: 'math' });
    expect(q2.body.question.type).toBe('MULTIPLE_CHOICE');
    questionIds = [q1.body.question.id, q2.body.question.id];
    const bad = await as(instructor).post(`/api/exams/${examId}/questions`).send({ prompt: 'Broken', options: ['a', 'b'], correct: [5], topic: 'x' });
    expect(bad.status).toBe(400);
    expect((await as(instructor).patch(`/api/exams/${examId}`).send({ status: 'PUBLISHED' })).status).toBe(200);
  });

  it('a proctored attempt requires explicit consent', async () => {
    const res = await as(student).post(`/api/exams/${examId}/sessions`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CONSENT_REQUIRED');
  });

  let sessionId: string;
  it('starting returns questions without the answer key; resuming returns the same session', async () => {
    const res = await as(student).post(`/api/exams/${examId}/sessions`).send({ consent: true });
    expect(res.status).toBe(201);
    sessionId = res.body.session.id;
    expect(res.body.session.questions).toHaveLength(2);
    expect(JSON.stringify(res.body.session.questions)).not.toMatch(/correctOptionIds|explanation/);
    const again = await as(student).post(`/api/exams/${examId}/sessions`).send({ consent: true });
    expect(again.body.session.id).toBe(sessionId);
  });

  it('autosaves answers, keeping single-choice to one option and dropping unknown options', async () => {
    const r = await as(student).put(`/api/exam-sessions/${sessionId}/answers`).send({ questionId: questionIds[0], optionIds: ['a', 'b'] });
    expect(r.body.optionIds).toEqual(['a']);
    const r2 = await as(student).put(`/api/exam-sessions/${sessionId}/answers`).send({ questionId: questionIds[1], optionIds: ['a', 'b', 'zz'] });
    expect(r2.body.optionIds).toEqual(['a', 'b']);
  });

  it('camera frames become durational events only after a signal persists', async () => {
    const calls = stubMl(() => ({ json: { faces: 2, lookingAway: false, reason: null, confidence: 0.9, brightness: 0.5 } }));
    const first = await as(student).post(`/api/exam-sessions/${sessionId}/frames`).attach('frame', FRAME, { filename: 'f.jpg', contentType: 'image/jpeg' });
    expect(first.body).toMatchObject({ available: true, faces: 2, activeSignals: [] });
    // Too soon: throttled, not analyzed.
    const throttled = await as(student).post(`/api/exam-sessions/${sessionId}/frames`).attach('frame', FRAME, { filename: 'f.jpg', contentType: 'image/jpeg' });
    expect(throttled.body.skipped).toBe(true);
    expect(calls).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 2100));
    const second = await as(student).post(`/api/exam-sessions/${sessionId}/frames`).attach('frame', FRAME, { filename: 'f.jpg', contentType: 'image/jpeg' });
    expect(second.body.activeSignals).toEqual(['MULTIPLE_FACES']);
    const events = await withSystem((tx) => tx.proctoringEvent.findMany({ where: { sessionId } }));
    expect(events).toMatchObject([{ type: 'MULTIPLE_FACES', source: 'CAMERA', endedAt: null }]);
  });

  it('degrades gracefully when face analysis is unavailable', async () => {
    stubMl(() => ({ status: 503, json: { detail: 'Model file not found' } }));
    await new Promise((r) => setTimeout(r, 1100));
    const res = await as(student).post(`/api/exam-sessions/${sessionId}/frames`).attach('frame', FRAME, { filename: 'f.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
  });

  it('records browser signals with timestamps clamped to the attempt window', async () => {
    const res = await as(student).post(`/api/exam-sessions/${sessionId}/events`).send({ type: 'TAB_HIDDEN', startedAt: '2000-01-01T00:00:00Z', endedAt: new Date().toISOString() });
    expect(res.status).toBe(202);
    const ev = await withSystem((tx) => tx.proctoringEvent.findFirst({ where: { sessionId, type: 'TAB_HIDDEN' }, include: { session: true } }));
    expect(ev!.startedAt.getTime()).toBeGreaterThanOrEqual(ev!.session.startedAt.getTime());
  });

  it('another student cannot touch this session', async () => {
    const other = await createTenantFixture(['STUDENT']);
    const token = (await login(other.slug, other.users.STUDENT.email)).token;
    expect((await as(token).get(`/api/exam-sessions/${sessionId}`)).status).toBe(404);
    expect((await as(token).post(`/api/exam-sessions/${sessionId}/submit`)).status).toBe(404);
  });

  it('submit grades, closes open events, reveals the key, and queues human review', async () => {
    const res = await as(student).post(`/api/exam-sessions/${sessionId}/submit`);
    expect(res.status).toBe(200);
    const s = res.body.session;
    expect(s).toMatchObject({ status: 'SUBMITTED', score: 2, maxScore: 2, percent: 100, passed: true, underReview: true });
    expect(s.topicScores).toEqual({ statistics: 1, math: 1 });
    expect(s.questions[0].correctOptionIds).toEqual(['a']);
    const open = await withSystem((tx) => tx.proctoringEvent.count({ where: { sessionId, endedAt: null } }));
    expect(open).toBe(0);
    // Closed attempts reject further answers and frames.
    expect((await as(student).put(`/api/exam-sessions/${sessionId}/answers`).send({ questionId: questionIds[0], optionIds: ['b'] })).status).toBe(409);
    expect((await as(student).post(`/api/exam-sessions/${sessionId}/frames`).attach('frame', FRAME, { filename: 'f.jpg', contentType: 'image/jpeg' })).status).toBe(409);
  });

  it('instructor sees the session in the review queue with a neutral summary and records a decision', async () => {
    const queue = await as(instructor).get('/api/reviews');
    const item = queue.body.reviews.find((r: { id: string }) => r.id === sessionId);
    expect(item.proctoring.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/^More than one face visible: 1×/)]));
    const detail = await as(instructor).get(`/api/exam-sessions/${sessionId}/review`);
    expect(detail.body.events.map((e: { label: string }) => e.label)).toEqual(expect.arrayContaining(['More than one face visible', 'Exam tab hidden']));
    expect(detail.body.session.answers).toBeUndefined();

    expect((await as(student).get(`/api/exam-sessions/${sessionId}/review`)).status).toBe(403);
    const decide = await as(instructor).patch(`/api/exam-sessions/${sessionId}/review`).send({ decision: 'REVIEWED_NO_CONCERN', note: 'Sibling walked past.' });
    expect(decide.body.session.reviewStatus).toBe('REVIEWED_NO_CONCERN');
    expect((await as(instructor).get('/api/reviews')).body.reviews.find((r: { id: string }) => r.id === sessionId)).toBeUndefined();
  });

  it('attempt limits are enforced', async () => {
    const second = await as(student).post(`/api/exams/${examId}/sessions`).send({ consent: true });
    expect(second.status).toBe(201);
    await as(student).post(`/api/exam-sessions/${second.body.session.id}/submit`);
    const third = await as(student).post(`/api/exams/${examId}/sessions`).send({ consent: true });
    expect(third.status).toBe(409);
  });
});
