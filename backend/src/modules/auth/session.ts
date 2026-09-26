import { randomUUID } from 'node:crypto';
import type { Role, Tenant, User } from '@prisma/client';
import type { CookieOptions, Response } from 'express';
import { env } from '../../config/env.js';
import type { Tx } from '../../lib/db.js';
import { REFRESH_TTL_SECONDS, signAccessToken, signRefreshToken } from '../../lib/tokens.js';

export const REFRESH_COOKIE = 'lms_rt';

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict',
  // Only sent to the auth endpoints, never to the rest of the API.
  path: '/api/auth',
};

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, { ...cookieOptions, maxAge: REFRESH_TTL_SECONDS * 1000 });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
}

export function publicUser(u: Pick<User, 'id' | 'email' | 'name' | 'role' | 'xp' | 'createdAt'>) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, xp: u.xp, createdAt: u.createdAt };
}

export function publicTenant(t: Pick<Tenant, 'id' | 'name' | 'slug' | 'settings'>) {
  return { id: t.id, name: t.name, slug: t.slug, settings: t.settings };
}

/**
 * Issues an access token and a refresh token. The refresh token's row is written in
 * `tx`, which must be scoped to `user.tenantId`. Pass `familyId` when rotating.
 */
export async function issueSession(
  tx: Tx,
  user: { id: string; tenantId: string; role: Role; name: string },
  opts: { familyId?: string; userAgent?: string } = {},
) {
  const tokenId = randomUUID();
  const familyId = opts.familyId ?? randomUUID();
  await tx.refreshToken.create({
    data: {
      id: tokenId,
      tenantId: user.tenantId,
      userId: user.id,
      familyId,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
      userAgent: opts.userAgent?.slice(0, 255),
    },
  });
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({ userId: user.id, tenantId: user.tenantId, role: user.role, name: user.name }),
    signRefreshToken({ userId: user.id, tenantId: user.tenantId, tokenId, familyId }),
  ]);
  return { accessToken, refreshToken, tokenId };
}
