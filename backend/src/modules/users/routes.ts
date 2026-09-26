import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { idParam, parse } from '../../lib/validate.js';
import { auth, db, requireRole } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { passwordSchema } from '../auth/routes.js';
import { publicUser } from '../auth/session.js';

const ManagedRole = z.enum(['INSTITUTION_ADMIN', 'INSTRUCTOR', 'STUDENT']);

const ListQuery = z.object({
  role: ManagedRole.optional(),
  q: z.string().trim().max(100).optional(),
});

const CreateBody = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().trim().toLowerCase(),
  role: ManagedRole,
  password: passwordSchema.optional(),
});

const UpdateBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: ManagedRole.optional(),
  isActive: z.boolean().optional(),
});

const userListSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  xp: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

/** Readable one-time password, e.g. "tulip-4821-orbit". */
function temporaryPassword() {
  const words = ['maple', 'orbit', 'tulip', 'cedar', 'harbor', 'violet', 'summit', 'meadow', 'comet', 'river'];
  const b = randomBytes(4);
  return `${words[b[0]! % words.length]}-${1000 + (b.readUInt16BE(1) % 9000)}-${words[b[3]! % words.length]}`;
}

export function usersRouter(): Router {
  const router = Router();

  router.get('/', requireRole('INSTITUTION_ADMIN', 'INSTRUCTOR'), async (req, res) => {
    const query = parse(ListQuery, req.query);
    const { role } = auth(req);
    // Instructors may browse students only; admins see everyone in the tenant.
    const roleFilter = role === 'INSTRUCTOR' ? 'STUDENT' : query.role;
    const users = await db(req, (tx) =>
      tx.user.findMany({
        where: {
          role: roleFilter ?? { not: 'SUPER_ADMIN' },
          ...(query.q && {
            OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { email: { contains: query.q, mode: 'insensitive' } }],
          }),
        },
        select: userListSelect,
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
      }),
    );
    res.json({ users });
  });

  router.post('/', requireRole('INSTITUTION_ADMIN'), async (req, res) => {
    const body = parse(CreateBody, req.body);
    const tempPassword = body.password ? undefined : temporaryPassword();
    const passwordHash = await hashPassword(body.password ?? tempPassword!);
    const { tenantId } = auth(req);
    const user = await db(req, async (tx) => {
      const exists = await tx.user.count({ where: { email: body.email } });
      if (exists) throw new HttpError(409, 'A user with this email already exists', 'EMAIL_TAKEN', { email: ['Already in use'] });
      const created = await tx.user.create({
        data: { tenantId, email: body.email, name: body.name, role: body.role, passwordHash },
        select: userListSelect,
      });
      await tx.notification.create({
        data: { tenantId, userId: created.id, type: 'welcome', title: 'Welcome aboard!', body: 'Your account is ready.', link: '/' },
      });
      return created;
    });
    // The temporary password is returned exactly once for the admin to hand over.
    res.status(201).json({ user, temporaryPassword: tempPassword });
  });

  router.patch('/me', async (req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(2).max(120) }), req.body);
    const user = await db(req, (tx) => tx.user.update({ where: { id: auth(req).userId }, data: { name: body.name } }));
    res.json({ user: publicUser(user) });
  });

  router.post('/me/password', async (req, res) => {
    const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }), req.body);
    const { userId } = auth(req);
    await db(req, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
        throw new HttpError(400, 'Current password is incorrect', 'VALIDATION', { currentPassword: ['Incorrect password'] });
      }
      await tx.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(body.newPassword) } });
      // Sign out every other session.
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    res.status(204).end();
  });

  router.patch('/:id', requireRole('INSTITUTION_ADMIN'), async (req, res) => {
    const id = idParam(req.params);
    const body = parse(UpdateBody, req.body);
    if (id === auth(req).userId && (body.role || body.isActive === false)) {
      throw new HttpError(400, 'You cannot change your own role or deactivate yourself', 'SELF_CHANGE');
    }
    const user = await db(req, async (tx) => {
      const updated = await tx.user.update({ where: { id }, data: body, select: userListSelect });
      if (body.isActive === false) {
        await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      return updated;
    });
    res.json({ user });
  });

  return router;
}
