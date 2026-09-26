import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFound } from './middleware/error.js';
import { healthRouter } from './routes/health.js';
import { defaultHealthProbes, type HealthProbes } from './services/health.js';

export type AppDeps = {
  healthProbes?: HealthProbes;
  probeTimeoutMs?: number;
};

export function createApp(deps: AppDeps = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
      // One compact line per request; full headers are noise and risk leaking tokens.
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use('/api/health', healthRouter(deps.healthProbes ?? defaultHealthProbes, deps.probeTimeoutMs));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
