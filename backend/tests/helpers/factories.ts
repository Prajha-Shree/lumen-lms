import { randomUUID } from 'node:crypto';
import type { Role } from '@prisma/client';
import { withSystem } from '../../src/lib/db.js';
import { hashPassword } from '../../src/lib/password.js';

export const TEST_PASSWORD = 'correct-horse-battery-staple';
let cachedHash: Promise<string> | undefined;
const passwordHash = () => (cachedHash ??= hashPassword(TEST_PASSWORD));

/** Creates an isolated tenant with one user per requested role and one published course. */
export async function createTenantFixture(roles: Role[] = ['INSTITUTION_ADMIN', 'INSTRUCTOR', 'STUDENT']) {
  const slug = `t-${randomUUID().slice(0, 8)}`;
  const hash = await passwordHash();
  return withSystem(async (tx) => {
    const tenant = await tx.tenant.create({ data: { name: `Tenant ${slug}`, slug } });
    const users = {} as Record<Role, { id: string; email: string }>;
    for (const role of roles) {
      const email = `${role.toLowerCase()}@${slug}.test`;
      users[role] = await tx.user.create({
        data: { tenantId: tenant.id, email, name: `${role} ${slug}`, role, passwordHash: hash },
        select: { id: true, email: true },
      });
    }
    const instructorId = (users.INSTRUCTOR ?? users.INSTITUTION_ADMIN ?? Object.values(users)[0])!.id;
    const course = await tx.course.create({
      data: { tenantId: tenant.id, instructorId, title: `Course of ${slug}`, status: 'PUBLISHED' },
    });
    return { tenant, users, course, slug };
  });
}
