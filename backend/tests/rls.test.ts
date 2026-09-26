import { beforeAll, describe, expect, inject, it } from 'vitest';
import { withSystem, withTenant } from '../src/lib/db.js';
import { prisma } from '../src/lib/prisma.js';
import { createTenantFixture } from './helpers/factories.js';

describe.skipIf(!inject('dbAvailable'))('tenant isolation (Postgres RLS, runtime role)', () => {
  let a: Awaited<ReturnType<typeof createTenantFixture>>;
  let b: Awaited<ReturnType<typeof createTenantFixture>>;

  beforeAll(async () => {
    a = await createTenantFixture();
    b = await createTenantFixture();
  });

  it('a tenant sees only its own rows, even with no WHERE clause', async () => {
    const courses = await withTenant(a.tenant.id, (tx) => tx.course.findMany());
    expect(courses.map((c) => c.id)).toEqual([a.course.id]);
    const users = await withTenant(a.tenant.id, (tx) => tx.user.findMany());
    expect(users.every((u) => u.tenantId === a.tenant.id)).toBe(true);
  });

  it('looking up another tenant row by primary key returns nothing', async () => {
    const found = await withTenant(a.tenant.id, (tx) => tx.course.findUnique({ where: { id: b.course.id } }));
    expect(found).toBeNull();
  });

  it('with no tenant context, tenant-owned tables appear empty', async () => {
    expect(await prisma.course.findMany()).toEqual([]);
    expect(await prisma.user.count()).toBe(0);
  });

  it('tenant context does not leak to the next transaction on a pooled connection', async () => {
    await withTenant(a.tenant.id, (tx) => tx.course.count());
    // Same single pooled connection (connection_limit=1), setting was transaction-local.
    expect(await prisma.course.count()).toBe(0);
  });

  it('cannot insert a row tagged with another tenant', async () => {
    await expect(
      withTenant(a.tenant.id, (tx) =>
        tx.course.create({ data: { tenantId: b.tenant.id, instructorId: b.users.INSTRUCTOR.id, title: 'Smuggled' } }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot update or delete another tenant rows', async () => {
    const updated = await withTenant(a.tenant.id, (tx) =>
      tx.course.updateMany({ where: { id: b.course.id }, data: { title: 'Hijacked' } }),
    );
    const deleted = await withTenant(a.tenant.id, (tx) => tx.course.deleteMany({ where: { id: b.course.id } }));
    expect(updated.count).toBe(0);
    expect(deleted.count).toBe(0);
    const still = await withTenant(b.tenant.id, (tx) => tx.course.findUnique({ where: { id: b.course.id } }));
    expect(still?.title).toBe(b.course.title);
  });

  it('cannot move an own row into another tenant', async () => {
    await expect(
      withTenant(a.tenant.id, (tx) => tx.course.update({ where: { id: a.course.id }, data: { tenantId: b.tenant.id } })),
    ).rejects.toThrow(/row-level security/i);
  });

  it('the tenant directory is readable, but only the own tenant row is writable', async () => {
    const visible = await withTenant(a.tenant.id, (tx) => tx.tenant.findUnique({ where: { id: b.tenant.id } }));
    expect(visible?.slug).toBe(b.slug);
    const renamed = await withTenant(a.tenant.id, (tx) =>
      tx.tenant.updateMany({ where: { id: b.tenant.id }, data: { name: 'Hijacked' } }),
    );
    expect(renamed.count).toBe(0);
    const own = await withTenant(a.tenant.id, (tx) =>
      tx.tenant.updateMany({ where: { id: a.tenant.id }, data: { name: 'Renamed' } }),
    );
    expect(own.count).toBe(1);
  });

  it('only system context can create tenants', async () => {
    await expect(
      withTenant(a.tenant.id, (tx) => tx.tenant.create({ data: { name: 'Rogue', slug: `rogue-${Date.now()}` } })),
    ).rejects.toThrow(/row-level security/i);
  });

  it('the runtime role cannot switch RLS off', async () => {
    await expect(
      withTenant(a.tenant.id, (tx) => tx.$executeRawUnsafe('ALTER TABLE courses DISABLE ROW LEVEL SECURITY')),
    ).rejects.toThrow(/must be owner/i);
  });

  it('system context sees across tenants (for vetted operations only)', async () => {
    const ids = await withSystem((tx) =>
      tx.course.findMany({ where: { id: { in: [a.course.id, b.course.id] } }, select: { id: true } }),
    );
    expect(ids).toHaveLength(2);
  });
});
