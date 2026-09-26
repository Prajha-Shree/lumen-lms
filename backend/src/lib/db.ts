import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

/** Transaction-scoped client handed to every data-access callback. */
export type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

/**
 * Runs `fn` in a transaction where Postgres RLS only exposes `tenantId`'s rows.
 * This is the ONLY way request handlers should touch tenant data.
 *
 * Isolation is enforced by the database, not by remembering `where: { tenantId }`:
 * a query that forgets the filter still cannot see another tenant's rows.
 */
export function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }, TX_OPTIONS);
}

/**
 * Runs `fn` with RLS bypassed. Reserved for vetted cross-tenant operations:
 * institution signup, super-admin views, scheduled jobs, seeding. Never call it
 * with anything derived from an unauthenticated request beyond those flows.
 */
export function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    return fn(tx);
  }, TX_OPTIONS);
}
