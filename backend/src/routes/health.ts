import { Router } from 'express';
import { env } from '../config/env.js';
import { runProbe, type HealthProbes } from '../services/health.js';

const startedAt = Date.now();

export function healthRouter(probes: HealthProbes, probeTimeoutMs?: number): Router {
  const router = Router();

  // Liveness: the process is up. Never touches dependencies.
  router.get('/live', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness: all dependencies reachable. 503 if any is down.
  router.get('/', async (_req, res) => {
    const names = Object.keys(probes);
    const results = await Promise.all(names.map((name) => runProbe(probes[name]!, probeTimeoutMs)));
    const healthy = results.every((r) => r.status === 'up');

    // Error details can name internal hosts; only expose them outside production.
    const exposeDetail = env.NODE_ENV !== 'production';
    const checks = Object.fromEntries(
      names.map((name, i) => {
        const { detail, ...rest } = results[i]!;
        return [name, exposeDetail && detail ? { ...rest, detail } : rest];
      }),
    );

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      service: 'lms-backend',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      checks,
    });
  });

  return router;
}
