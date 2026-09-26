import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { events } from '../lib/events.js';
import { logger } from '../lib/logger.js';
import { verifyAccessToken } from '../lib/tokens.js';

const STAFF = new Set(['INSTITUTION_ADMIN', 'INSTRUCTOR']);

/**
 * Real-time channel. Clients authenticate with their access token and join:
 *   user:<id>             personal notifications and progress
 *   tenant:<id>:staff     live analytics + review queue updates (staff only)
 * Rooms are namespaced by tenant, so nothing crosses institutions.
 */
export function attachRealtime(server: HttpServer) {
  const io = new Server(server, { cors: { origin: env.CORS_ORIGIN.split(','), credentials: true }, serveClient: false });

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: unknown }).token;
      if (typeof token !== 'string') throw new Error('missing token');
      const claims = await verifyAccessToken(token);
      socket.data.userId = claims.sub;
      socket.data.tenantId = claims.tid;
      socket.data.role = claims.role;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    void socket.join(`user:${socket.data.userId}`);
    if (STAFF.has(socket.data.role)) void socket.join(`tenant:${socket.data.tenantId}:staff`);
  });

  // Coalesce bursts: at most one analytics ping per tenant every 3 seconds.
  const pending = new Map<string, Set<string>>();
  const flush = (tenantId: string) => {
    const courses = pending.get(tenantId);
    pending.delete(tenantId);
    io.to(`tenant:${tenantId}:staff`).emit('analytics:changed', { courseIds: [...(courses ?? [])] });
  };

  events.on('activity', (a) => {
    io.to(`user:${a.userId}`).emit('progress:changed', { type: a.type, xp: a.xp });
    if (!pending.has(a.tenantId)) {
      pending.set(a.tenantId, new Set());
      setTimeout(() => flush(a.tenantId), 3000);
    }
    if (a.courseId) pending.get(a.tenantId)!.add(a.courseId);
  });

  events.on('notification', (n) => {
    io.to(`user:${n.userId}`).emit('notification', { id: n.id, title: n.title, body: n.body, link: n.link, type: n.type });
  });

  events.on('proctoringFlag', (f) => {
    io.to(`tenant:${f.tenantId}:staff`).emit('review:pending', { sessionId: f.sessionId, examId: f.examId, courseId: f.courseId, studentName: f.studentName });
  });

  logger.info('realtime channel attached');
  return io;
}
