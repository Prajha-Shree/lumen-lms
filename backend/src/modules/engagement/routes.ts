import { Router } from 'express';
import { z } from 'zod';
import { idParam, parse } from '../../lib/validate.js';
import { auth, db } from '../../middleware/auth.js';
import { BADGE_RULES } from '../gamification/service.js';

/** Notifications + badges for the signed-in user. */
export function engagementRouter(): Router {
  const router = Router();

  router.get('/notifications', async (req, res) => {
    const { userId } = auth(req);
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }), req.query);
    const data = await db(req, async (tx) => {
      const [items, unread] = await Promise.all([
        tx.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: q.limit }),
        tx.notification.count({ where: { userId, readAt: null } }),
      ]);
      return { items, unread };
    });
    res.json(data);
  });

  router.post('/notifications/:id/read', async (req, res) => {
    const id = idParam(req.params);
    await db(req, (tx) => tx.notification.updateMany({ where: { id, userId: auth(req).userId, readAt: null }, data: { readAt: new Date() } }));
    res.status(204).end();
  });

  router.post('/notifications/read-all', async (req, res) => {
    await db(req, (tx) => tx.notification.updateMany({ where: { userId: auth(req).userId, readAt: null }, data: { readAt: new Date() } }));
    res.status(204).end();
  });

  router.get('/badges/me', async (req, res) => {
    const { userId } = auth(req);
    const earned = await db(req, (tx) => tx.userBadge.findMany({ where: { userId }, orderBy: { awardedAt: 'asc' } }));
    const byKey = new Map(earned.map((b) => [b.badge, b.awardedAt]));
    res.json({
      badges: Object.entries(BADGE_RULES).map(([key, r]) => ({ key, name: r.name, earned: byKey.has(key), awardedAt: byKey.get(key) ?? null })),
    });
  });

  return router;
}
