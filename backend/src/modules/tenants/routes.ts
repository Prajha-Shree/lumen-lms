import { Router } from 'express';
import { z } from 'zod';
import { withSystem } from '../../lib/db.js';
import { idParam, parse } from '../../lib/validate.js';
import { auth, db, requireRole } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { publicTenant } from '../auth/session.js';

const SettingsBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  settings: z
    .object({
      primaryColor: z.enum(['indigo', 'emerald', 'rose', 'amber', 'sky', 'violet']).optional(),
      proctoringRetentionDays: z.number().int().min(1).max(365).optional(),
    })
    .optional(),
});

/** The caller's own institution. */
export function tenantRouter(): Router {
  const router = Router();

  router.get('/current', async (req, res) => {
    const tenant = await db(req, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: auth(req).tenantId } }));
    res.json({ tenant: publicTenant(tenant) });
  });

  router.patch('/current', requireRole('INSTITUTION_ADMIN'), async (req, res) => {
    const body = parse(SettingsBody, req.body);
    const { tenantId } = auth(req);
    const tenant = await db(req, async (tx) => {
      const current = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      return tx.tenant.update({
        where: { id: tenantId },
        data: {
          name: body.name,
          settings: { ...(current.settings as object), ...body.settings },
        },
      });
    });
    res.json({ tenant: publicTenant(tenant) });
  });

  return router;
}

/** Super-admin only: cross-tenant management. Uses system (RLS-bypassing) context. */
export function platformRouter(): Router {
  const router = Router();
  router.use(requireRole('SUPER_ADMIN'));

  router.get('/tenants', async (_req, res) => {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const tenants = await withSystem(async (tx) => {
      const rows = await tx.tenant.findMany({
        where: { slug: { not: 'platform' } },
        orderBy: { createdAt: 'asc' },
        include: { _count: { select: { users: true, courses: true, enrollments: true } } },
      });
      const active = await tx.learningActivity.groupBy({
        by: ['tenantId'],
        where: { occurredAt: { gte: since } },
        _count: { _all: true },
      });
      const activeUsers = await tx.$queryRaw<{ tenant_id: string; n: bigint }[]>`
        SELECT tenant_id, COUNT(DISTINCT user_id) AS n FROM learning_activities
        WHERE occurred_at >= ${since} GROUP BY tenant_id`;
      return rows.map((t) => ({
        ...publicTenant(t),
        status: t.status,
        createdAt: t.createdAt,
        counts: t._count,
        activity7d: active.find((a) => a.tenantId === t.id)?._count._all ?? 0,
        activeUsers7d: Number(activeUsers.find((a) => a.tenant_id === t.id)?.n ?? 0),
      }));
    });
    res.json({ tenants });
  });

  router.patch('/tenants/:id', async (req, res) => {
    const id = idParam(req.params);
    const body = parse(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) }), req.body);
    const tenant = await withSystem(async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id } });
      if (t.slug === 'platform') throw new HttpError(400, 'The platform tenant cannot be suspended', 'PROTECTED');
      const updated = await tx.tenant.update({ where: { id }, data: { status: body.status } });
      // Suspension ends every session in that institution immediately.
      if (body.status === 'SUSPENDED') {
        await tx.refreshToken.updateMany({ where: { tenantId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      return updated;
    });
    res.json({ tenant: { ...publicTenant(tenant), status: tenant.status } });
  });

  return router;
}
