import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { startAnalyticsJobs } from './jobs/analytics.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { startGamification } from './modules/gamification/service.js';
import { attachRealtime } from './realtime/socket.js';

const server = createServer(createApp());
const io = attachRealtime(server);
const stopJobs = startAnalyticsJobs();
startGamification();

server.listen(env.PORT, () => {
  logger.info(`lms-backend listening on http://localhost:${env.PORT}`);
});

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  stopJobs();
  await io.close();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
