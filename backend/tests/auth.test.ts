import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createTenantFixture } from './helpers/factories.js';
import { app, as, login } from './helpers/http.js';

const cookieValue = (cookies: string[]) => cookies.find((c) => c.startsWith('lms_rt='))!.split(';')[0]!;

describe.skipIf(!inject('dbAvailable'))('auth', () => {
  let fx: Awaited<ReturnType<typeof createTenantFixture>>;

  beforeAll(async () => {
    fx = await createTenantFixture();
  });

  describe('institution onboarding', () => {
    it('creates a tenant + admin and signs the admin in', async () => {
      const slug = `acme-${randomUUID().slice(0, 6)}`;
      const res = await request(app).post('/api/auth/register-institution').send({
        institutionName: 'Acme College',
        slug,
        adminName: 'Ada Admin',
        email: 'Ada@Acme.test',
        password: 'a-long-enough-password',
      });
      expect(res.status).toBe(201);
      expect(res.body.tenant.slug).toBe(slug);
      expect(res.body.user).toMatchObject({ role: 'INSTITUTION_ADMIN', email: 'ada@acme.test' });
      expect(res.body.user.passwordHash).toBeUndefined();
      const me = await as(res.body.accessToken).get('/api/auth/me');
      expect(me.body.tenant.slug).toBe(slug);
    });

    it('rejects a taken or reserved slug', async () => {
      const taken = await request(app).post('/api/auth/register-institution').send({
        institutionName: 'Dup', slug: fx.slug, adminName: 'X Y', email: 'x@y.test', password: 'a-long-enough-password',
      });
      expect(taken.status).toBe(409);
      const reserved = await request(app).get('/api/auth/slug-available/platform');
      expect(reserved.body.available).toBe(false);
    });
  });

  describe('login', () => {
    it('succeeds with the right institution, email and password', async () => {
      const { body } = await login(fx.slug, fx.users.STUDENT.email);
      expect(body.user.role).toBe('STUDENT');
      expect(body.tenant.id).toBe(fx.tenant.id);
    });

    it('fails with a generic message for wrong password, unknown email or unknown institution', async () => {
      for (const creds of [
        { tenantSlug: fx.slug, email: fx.users.STUDENT.email, password: 'wrong-password' },
        { tenantSlug: fx.slug, email: 'nobody@nowhere.test', password: 'whatever-123' },
        { tenantSlug: 'no-such-school', email: fx.users.STUDENT.email, password: 'whatever-123' },
      ]) {
        const res = await request(app).post('/api/auth/login').send(creds);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      }
    });

    it("cannot use one institution's slug to sign into another's account", async () => {
      const other = await createTenantFixture(['STUDENT']);
      const res = await request(app)
        .post('/api/auth/login')
        .send({ tenantSlug: other.slug, email: fx.users.STUDENT.email, password: 'correct-horse-battery-staple' });
      expect(res.status).toBe(401);
    });
  });

  describe('refresh token rotation', () => {
    it('rotates on refresh and detects reuse of an old token', async () => {
      const { cookie } = await login(fx.slug, fx.users.STUDENT.email);
      const first = cookieValue(cookie);

      const r1 = await request(app).post('/api/auth/refresh').set('Cookie', first);
      expect(r1.status).toBe(200);
      const second = cookieValue(r1.headers['set-cookie'] as unknown as string[]);
      expect(second).not.toBe(first);

      // Replaying the first (already-rotated) token: treated as theft.
      const replay = await request(app).post('/api/auth/refresh').set('Cookie', first);
      expect(replay.status).toBe(401);

      // ...and the whole family is revoked, including the legitimately rotated token.
      const afterTheft = await request(app).post('/api/auth/refresh').set('Cookie', second);
      expect(afterTheft.status).toBe(401);
    });

    it('logout revokes the session', async () => {
      const { cookie } = await login(fx.slug, fx.users.STUDENT.email);
      const rt = cookieValue(cookie);
      expect((await request(app).post('/api/auth/logout').set('Cookie', rt)).status).toBe(204);
      expect((await request(app).post('/api/auth/refresh').set('Cookie', rt)).status).toBe(401);
    });
  });

  describe('RBAC', () => {
    it('students cannot list or create users', async () => {
      const { token } = await login(fx.slug, fx.users.STUDENT.email);
      expect((await as(token).get('/api/users')).status).toBe(403);
      expect((await as(token).post('/api/users').send({ name: 'Eve', email: 'eve@x.test', role: 'INSTITUTION_ADMIN' })).status).toBe(403);
    });

    it('instructors see only students', async () => {
      const { token } = await login(fx.slug, fx.users.INSTRUCTOR.email);
      const res = await as(token).get('/api/users');
      expect(res.status).toBe(200);
      expect(res.body.users.every((u: { role: string }) => u.role === 'STUDENT')).toBe(true);
    });

    it('admins create users and receive a one-time temporary password', async () => {
      const { token } = await login(fx.slug, fx.users.INSTITUTION_ADMIN.email);
      const res = await as(token).post('/api/users').send({ name: 'New Teacher', email: 'teach@x.test', role: 'INSTRUCTOR' });
      expect(res.status).toBe(201);
      expect(res.body.temporaryPassword).toMatch(/^[a-z]+-\d{4}-[a-z]+$/);
      const signIn = await request(app).post('/api/auth/login').send({ tenantSlug: fx.slug, email: 'teach@x.test', password: res.body.temporaryPassword });
      expect(signIn.status).toBe(200);
    });

    it('only super admins reach platform endpoints', async () => {
      const { token } = await login(fx.slug, fx.users.INSTITUTION_ADMIN.email);
      expect((await as(token).get('/api/platform/tenants')).status).toBe(403);
    });

    it("an admin cannot modify another tenant's user (RLS makes it not found)", async () => {
      const other = await createTenantFixture(['STUDENT']);
      const { token } = await login(fx.slug, fx.users.INSTITUTION_ADMIN.email);
      const res = await as(token).patch(`/api/users/${other.users.STUDENT.id}`).send({ isActive: false });
      expect(res.status).toBe(404);
    });

    it('rejects tampered or missing tokens', async () => {
      const { token } = await login(fx.slug, fx.users.STUDENT.email);
      const tampered = token.slice(0, -4) + 'AAAA';
      expect((await as(tampered).get('/api/auth/me')).status).toBe(401);
      expect((await request(app).get('/api/auth/me')).status).toBe(401);
    });
  });
});
