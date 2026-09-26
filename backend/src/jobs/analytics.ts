import type { Prisma } from '@prisma/client';
import { withSystem, withTenant } from '../lib/db.js';
import { logger } from '../lib/logger.js';

/**
 * Daily per-tenant snapshots (UTC days) power the admin trend charts without
 * scanning the raw activity table. Idempotent upsert per (tenant, day), so the
 * job can run on every boot and hourly; it only fills missing complete days.
 */
export async function runSnapshotsForTenant(tenantId: string, backfillDays: number): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const existing = await tx.analyticsSnapshot.findMany({
      where: { scope: 'TENANT', scopeId: tenantId, date: { gte: new Date(Date.now() - (backfillDays + 1) * 86_400_000) } },
      select: { date: true },
    });
    const have = new Set(existing.map((e) => e.date.toISOString().slice(0, 10)));
    let written = 0;
    for (let i = backfillDays; i >= 1; i--) {
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() - i);
      const key = start.toISOString().slice(0, 10);
      if (have.has(key)) continue;
      const end = new Date(start.getTime() + 86_400_000);
      const [active, completions, exams, enrollments] = await Promise.all([
        tx.learningActivity.findMany({ where: { occurredAt: { gte: start, lt: end } }, distinct: ['userId'], select: { userId: true } }),
        tx.learningActivity.count({ where: { occurredAt: { gte: start, lt: end }, type: 'LESSON_COMPLETE' } }),
        tx.examSession.aggregate({ where: { submittedAt: { gte: start, lt: end } }, _count: { _all: true }, _avg: { percent: true } }),
        tx.enrollment.count({ where: { enrolledAt: { gte: start, lt: end } } }),
      ]);
      const metrics: Prisma.InputJsonValue = {
        activeUsers: active.length,
        lessonsCompleted: completions,
        examsSubmitted: exams._count._all,
        avgScore: exams._avg.percent !== null ? Math.round(exams._avg.percent) : null,
        newEnrollments: enrollments,
      };
      await tx.analyticsSnapshot.upsert({
        where: { tenantId_scope_scopeId_date: { tenantId, scope: 'TENANT', scopeId: tenantId, date: start } },
        create: { tenantId, scope: 'TENANT', scopeId: tenantId, date: start, metrics },
        update: { metrics },
      });
      written++;
    }
    return written;
  });
}

/**
 * Proctoring retention: deletes event notes older than each institution's
 * `proctoringRetentionDays` setting (default 30). Data minimization per ADR-2.
 */
export async function purgeExpiredProctoringEvents(): Promise<number> {
  const tenants = await withSystem((tx) => tx.tenant.findMany({ select: { id: true, settings: true } }));
  let deleted = 0;
  for (const t of tenants) {
    const days = (t.settings as { proctoringRetentionDays?: number }).proctoringRetentionDays ?? 30;
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const res = await withTenant(t.id, (tx) => tx.proctoringEvent.deleteMany({ where: { createdAt: { lt: cutoff } } }));
    deleted += res.count;
  }
  return deleted;
}

async function runAll() {
  try {
    const tenants = await withSystem((tx) => tx.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } }));
    let written = 0;
    for (const t of tenants) written += await runSnapshotsForTenant(t.id, 30);
    const purged = await purgeExpiredProctoringEvents();
    if (written || purged) logger.info({ snapshots: written, purgedProctoringEvents: purged }, 'analytics jobs ran');
  } catch (err) {
    logger.error({ err }, 'analytics jobs failed');
  }
}

/** In-process scheduler. With multiple replicas, run this in exactly one (or use a cron worker). */
export function startAnalyticsJobs(): () => void {
  const initial = setTimeout(() => void runAll(), 5_000);
  const hourly = setInterval(() => void runAll(), 60 * 60 * 1000);
  return () => {
    clearTimeout(initial);
    clearInterval(hourly);
  };
}
