import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { withSystem, withTenant } from '../../lib/db.js';
import { events } from '../../lib/events.js';
import { hashPassword, PASSWORD_RULES, verifyPassword } from '../../lib/password.js';
import { verifyRefreshToken } from '../../lib/tokens.js';
import { parse } from '../../lib/validate.js';
import { auth, authenticate, db } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { recordActivity } from '../../services/activity.js';
import { clearRefreshCookie, issueSession, publicTenant, publicUser, REFRESH_COOKIE, setRefreshCookie } from './session.js';

const RESERVED_SLUGS = new Set(['platform', 'admin', 'api', 'www', 'app', 'auth', 'status', 'help', 'support']);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, '3–40 characters: lowercase letters, numbers and hyphens')
  .refine((s) => !RESERVED_SLUGS.has(s), 'This name is reserved');

export const passwordSchema = z.string().min(PASSWORD_RULES.minLength, `At least ${PASSWORD_RULES.minLength} characters`).max(200);
const emailSchema = z.email().trim().toLowerCase().max(254);

const RegisterBody = z.object({
  institutionName: z.string().trim().min(2).max(120),
  slug: slugSchema,
  adminName: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
});

const LoginBody = z.object({ tenantSlug: z.string().trim().toLowerCase().min(1), email: emailSchema, password: z.string().min(1).max(200) });

// Throttle credential endpoints. Generous enough for classrooms behind one NAT.
const credentialLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a minute and try again.' } },
});

// Computed once; used to spend the same hashing time when the email is unknown so
// response timing doesn't reveal which accounts exist.
let dummyHash: Promise<string> | undefined;

export function authRouter(): Router {
  const router = Router();

  router.get('/tenants/:slug', async (req, res) => {
    const slug = z.string().toLowerCase().parse(req.params.slug);
    const tenant = await withSystem((tx) =>
      tx.tenant.findUnique({ where: { slug }, select: { name: true, slug: true, status: true } }),
    );
    if (!tenant || tenant.status !== 'ACTIVE') throw new HttpError(404, 'Institution not found', 'TENANT_NOT_FOUND');
    res.json({ name: tenant.name, slug: tenant.slug });
  });

  router.get('/slug-available/:slug', async (req, res) => {
    const result = slugSchema.safeParse(req.params.slug);
    if (!result.success) {
      res.json({ available: false, reason: result.error.issues[0]?.message });
      return;
    }
    const taken = await withSystem((tx) => tx.tenant.count({ where: { slug: result.data } }));
    res.json({ available: taken === 0, reason: taken ? 'Already taken' : undefined });
  });

  /** Institution onboarding: creates the tenant and its first admin, then signs in. */
  router.post('/register-institution', credentialLimiter, async (req, res) => {
    const body = parse(RegisterBody, req.body);
    const passwordHash = await hashPassword(body.password);

    const { tenant, admin } = await withSystem(async (tx) => {
      if (await tx.tenant.count({ where: { slug: body.slug } })) {
        throw new HttpError(409, 'That institution URL is already taken', 'SLUG_TAKEN', { slug: ['Already taken'] });
      }
      const tenant = await tx.tenant.create({ data: { name: body.institutionName, slug: body.slug } });
      const admin = await tx.user.create({
        data: { tenantId: tenant.id, email: body.email, name: body.adminName, role: 'INSTITUTION_ADMIN', passwordHash, lastLoginAt: new Date() },
      });
      await tx.notification.create({
        data: {
          tenantId: tenant.id,
          userId: admin.id,
          type: 'welcome',
          title: `Welcome to ${tenant.name}`,
          body: 'Start by inviting instructors and creating your first course.',
          link: '/admin/users',
        },
      });
      return { tenant, admin };
    });

    const session = await withTenant(tenant.id, (tx) => issueSession(tx, admin, { userAgent: req.get('user-agent') }));
    setRefreshCookie(res, session.refreshToken);
    res.status(201).json({ accessToken: session.accessToken, user: publicUser(admin), tenant: publicTenant(tenant) });
  });

  router.post('/login', credentialLimiter, async (req, res) => {
    const body = parse(LoginBody, req.body);
    const invalid = new HttpError(401, 'Incorrect institution, email or password', 'INVALID_CREDENTIALS');

    const tenant = await withSystem((tx) => tx.tenant.findUnique({ where: { slug: body.tenantSlug } }));
    if (!tenant) {
      await verifyPassword(body.password, await (dummyHash ??= hashPassword('dummy-password-for-timing')));
      throw invalid;
    }
    if (tenant.status !== 'ACTIVE') throw new HttpError(403, 'This institution is suspended', 'TENANT_SUSPENDED');

    const result = await withTenant(tenant.id, async (tx) => {
      const user = await tx.user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email: body.email } } });
      const ok = await verifyPassword(body.password, user?.passwordHash ?? (await (dummyHash ??= hashPassword('dummy-password-for-timing'))));
      if (!user || !ok) throw invalid;
      if (!user.isActive) throw new HttpError(403, 'This account has been deactivated', 'USER_INACTIVE');
      const updated = await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      const activity = await recordActivity(tx, { tenantId: tenant.id, userId: user.id, type: 'LOGIN' });
      const session = await issueSession(tx, user, { userAgent: req.get('user-agent') });
      return { user: updated, session, activity };
    });

    events.emit('activity', result.activity);
    setRefreshCookie(res, result.session.refreshToken);
    res.json({ accessToken: result.session.accessToken, user: publicUser(result.user), tenant: publicTenant(tenant) });
  });

  /**
   * Rotates the refresh token. Presenting an already-rotated token means it was
   * copied: the entire token family is revoked and the user must sign in again.
   */
  router.post('/refresh', async (req, res) => {
    const raw: unknown = req.cookies?.[REFRESH_COOKIE];
    const unauthorized = (msg = 'Session expired. Please sign in again.') => {
      clearRefreshCookie(res);
      return new HttpError(401, msg, 'SESSION_EXPIRED');
    };
    if (typeof raw !== 'string') throw unauthorized('No active session');

    let claims;
    try {
      claims = await verifyRefreshToken(raw);
    } catch {
      throw unauthorized();
    }

    const outcome = await withTenant(claims.tid, async (tx) => {
      const row = await tx.refreshToken.findUnique({ where: { id: claims.jti } });
      if (!row || row.userId !== claims.sub) return { kind: 'invalid' as const };
      if (row.revokedAt) {
        await tx.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
        return { kind: 'reused' as const };
      }
      if (row.expiresAt < new Date()) return { kind: 'invalid' as const };

      const [user, tenant] = await Promise.all([
        tx.user.findUnique({ where: { id: row.userId } }),
        tx.tenant.findUnique({ where: { id: claims.tid } }),
      ]);
      if (!user?.isActive || tenant?.status !== 'ACTIVE') return { kind: 'invalid' as const };

      const session = await issueSession(tx, user, { familyId: row.familyId, userAgent: req.get('user-agent') });
      await tx.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date(), replacedById: session.tokenId } });
      return { kind: 'ok' as const, session, user, tenant };
    });

    if (outcome.kind === 'reused') throw unauthorized('This session was used from another location and has been ended for your security.');
    if (outcome.kind !== 'ok') throw unauthorized();
    setRefreshCookie(res, outcome.session.refreshToken);
    res.json({ accessToken: outcome.session.accessToken, user: publicUser(outcome.user), tenant: publicTenant(outcome.tenant) });
  });

  router.post('/logout', async (req, res) => {
    const raw: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof raw === 'string') {
      try {
        const claims = await verifyRefreshToken(raw);
        await withTenant(claims.tid, (tx) =>
          tx.refreshToken.updateMany({ where: { familyId: claims.fam, revokedAt: null }, data: { revokedAt: new Date() } }),
        );
      } catch {
        /* already invalid: nothing to revoke */
      }
    }
    clearRefreshCookie(res);
    res.status(204).end();
  });

  router.get('/me', authenticate, async (req, res) => {
    const { userId, tenantId } = auth(req);
    const data = await db(req, async (tx) => {
      const [user, tenant] = await Promise.all([
        tx.user.findUnique({ where: { id: userId } }),
        tx.tenant.findUnique({ where: { id: tenantId } }),
      ]);
      return { user, tenant };
    });
    if (!data.user || !data.tenant) throw new HttpError(401, 'Account no longer exists', 'UNAUTHENTICATED');
    res.json({ user: publicUser(data.user), tenant: publicTenant(data.tenant) });
  });

  return router;
}
