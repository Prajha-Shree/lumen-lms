import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error.js';
import { analyticsRouter } from './modules/analytics/routes.js';
import { assignmentsRouter } from './modules/assignments/routes.js';
import { engagementRouter } from './modules/engagement/routes.js';
import { forumRouter } from './modules/forum/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { cognitiveRouter } from './modules/cognitive/routes.js';
import { recommendationsRouter } from './modules/recommendations/routes.js';
import { examsRouter } from './modules/exams/routes.js';
import { proctoringRouter } from './modules/proctoring/routes.js';
import { lessonsRouter } from './modules/courses/lessons.js';
import { coursesRouter, modulesRouter } from './modules/courses/routes.js';
import { platformRouter, tenantRouter } from './modules/tenants/routes.js';
import { usersRouter } from './modules/users/routes.js';
import { healthRouter } from './routes/health.js';
import { defaultHealthProbes, type HealthProbes } from './services/health.js';

export type AppDeps = {
  healthProbes?: HealthProbes;
  probeTimeoutMs?: number;
};

export function createApp(deps: AppDeps = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  // Behind a reverse proxy (Vite dev proxy, nginx, ALB) trust the loopback hop only.
  app.set('trust proxy', 'loopback');
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
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
  app.use('/api/auth', authRouter());

  // Everything below requires a valid access token.
  const api = Router();
  api.use(authenticate);
  api.use('/users', usersRouter());
  api.use('/tenant', tenantRouter());
  api.use('/platform', platformRouter());
  api.use('/courses', coursesRouter());
  api.use('/modules', modulesRouter());
  api.use(lessonsRouter());
  api.use('/cognitive', cognitiveRouter());
  api.use('/recommendations', recommendationsRouter());
  api.use(examsRouter());
  api.use(proctoringRouter());
  api.use(analyticsRouter());
  api.use(engagementRouter());
  api.use(forumRouter());
  api.use(assignmentsRouter());
  app.use('/api', api);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
