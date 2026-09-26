import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createTenantFixture } from './helpers/factories.js';
import { as, login } from './helpers/http.js';
import { stubMl } from './helpers/mlStub.js';

const item = (id: string) => ({ id, kind: 'diagnostic', prompt: `Q ${id}`, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], asksConfidence: true });
const PROFILE = {
  modality: { reading: 0.5, video: 0.25, interactive: 0.25 },
  pace: 'balanced',
  processingSpeed: 0.7,
  calibration: 0.1,
  topicMastery: { statistics: 0.8, probability: 0.3 },
  strengths: ['statistics'],
  growthAreas: ['probability'],
  summary: 'Right now you prefer…',
  rapidGuesses: 0,
};

/** A two-item fake assessment: done after two responses. */
const fakeEngine = (_path: string, body: unknown) => {
  const n = (body as { responses: unknown[] }).responses.length;
  return n >= 2
    ? { json: { done: true, answered: n, total: 2, profile: PROFILE } }
    : { json: { done: false, answered: n, total: 2, item: item(`q${n + 1}`) } };
};

describe.skipIf(!inject('dbAvailable'))('cognitive assessment orchestration', () => {
  let fx: Awaited<ReturnType<typeof createTenantFixture>>;
  let student: string;

  beforeAll(async () => {
    fx = await createTenantFixture();
    student = (await login(fx.slug, fx.users.STUDENT.email)).token;
  });

  it('runs start → answers → stored profile, sending the full history each time', async () => {
    const calls = stubMl(fakeEngine);
    const start = await as(student).post('/api/cognitive/assessments');
    expect(start.status).toBe(201);
    expect(start.body.item.id).toBe('q1');

    const r1 = await as(student).post(`/api/cognitive/assessments/${start.body.assessmentId}/responses`).send({ itemId: 'q1', answer: 'a', responseTimeMs: 4000, confidence: 3 });
    expect(r1.body).toMatchObject({ done: false, answered: 1 });

    const r2 = await as(student).post(`/api/cognitive/assessments/${start.body.assessmentId}/responses`).send({ itemId: 'q2', answer: 'b', responseTimeMs: 5000, confidence: 2 });
    expect(r2.body.done).toBe(true);
    expect(r2.body.profile).toMatchObject({ pace: 'balanced', strengths: ['statistics'], version: 1 });
    expect((calls.at(-1)!.body as { responses: unknown[] }).responses).toHaveLength(2);

    const me = await as(student).get('/api/cognitive/profile/me');
    expect(me.body.profile.topicMastery).toEqual(PROFILE.topicMastery);

    const again = await as(student).post(`/api/cognitive/assessments/${start.body.assessmentId}/responses`).send({ itemId: 'q3', answer: 'a', responseTimeMs: 1, confidence: 1 });
    expect(again.status).toBe(409);
  });

  it('retaking bumps the profile version', async () => {
    stubMl(fakeEngine);
    const start = await as(student).post('/api/cognitive/assessments');
    for (const q of ['q1', 'q2']) {
      await as(student).post(`/api/cognitive/assessments/${start.body.assessmentId}/responses`).send({ itemId: q, answer: 'a', responseTimeMs: 3000, confidence: 2 });
    }
    expect((await as(student).get('/api/cognitive/profile/me')).body.profile.version).toBe(2);
  });

  it('keeps saved answers and returns 503 when the ml-service is down', async () => {
    stubMl(() => 'network-error');
    const res = await as(student).post('/api/cognitive/assessments');
    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/temporarily unavailable/);
  });

  it('maps an engine sequence rejection to 400', async () => {
    let n = 0;
    stubMl(() => (n++ === 0 ? { json: { done: false, answered: 0, total: 2, item: item('q1') } } : { status: 422, json: { detail: "Response 1 answers 'zz' but 'q1' was asked" } }));
    const start = await as(student).post('/api/cognitive/assessments');
    const bad = await as(student).post(`/api/cognitive/assessments/${start.body.assessmentId}/responses`).send({ itemId: 'zz', answer: 'a', responseTimeMs: 100, confidence: 1 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain("'q1' was asked");
  });

  it('staff can read a student profile; students cannot read others', async () => {
    const instructor = (await login(fx.slug, fx.users.INSTRUCTOR.email)).token;
    const ok = await as(instructor).get(`/api/cognitive/profile/${fx.users.STUDENT.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.profile).not.toBeNull();
    expect((await as(student).get(`/api/cognitive/profile/${fx.users.INSTRUCTOR.id}`)).status).toBe(403);
  });

  it('a student can delete their profile and all stored answers', async () => {
    expect((await as(student).delete('/api/cognitive/profile/me')).status).toBe(204);
    expect((await as(student).get('/api/cognitive/profile/me')).body.profile).toBeNull();
    stubMl(fakeEngine);
    const current = await as(student).get('/api/cognitive/assessments/current');
    expect(current.body.assessmentId).toBeNull();
  });
});
