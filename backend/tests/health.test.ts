import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { HealthProbe } from '../src/services/health.js';

const up: HealthProbe = async () => {};
const down: HealthProbe = async () => {
  throw new Error('\nInvalid `prisma.$queryRaw()` invocation:\n\nconnection refused\n');
};
const hang: HealthProbe = () => new Promise(() => {});

describe('health endpoints', () => {
  it('liveness responds without touching dependencies', async () => {
    const res = await request(createApp({ healthProbes: { database: hang } })).get('/api/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('readiness is 200 when every dependency is up', async () => {
    const res = await request(createApp({ healthProbes: { database: up, mlService: up } })).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database.status).toBe('up');
  });

  it('readiness is 503 and gives a one-line reason for the failing dependency', async () => {
    const res = await request(createApp({ healthProbes: { database: up, mlService: down } })).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.mlService).toMatchObject({ status: 'down', detail: 'connection refused' });
  });

  it('a hanging dependency is marked down after the probe timeout', async () => {
    const app = createApp({ healthProbes: { database: hang, mlService: up }, probeTimeoutMs: 50 });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.checks.database).toMatchObject({ status: 'down', detail: 'Timed out after 50 ms' });
    expect(res.body.checks.mlService.status).toBe('up');
  });

  it('unknown routes return a structured 404', async () => {
    const res = await request(createApp({ healthProbes: {} })).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
