import type { Role } from '@prisma/client';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { env } from '../config/env.js';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

const ISSUER = 'lumen-lms';
const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

const AccessClaims = z.object({
  sub: z.uuid(),
  tid: z.uuid(),
  role: z.enum(['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'INSTRUCTOR', 'STUDENT']),
  name: z.string(),
});
export type AccessClaims = z.infer<typeof AccessClaims>;

const RefreshClaims = z.object({ sub: z.uuid(), tid: z.uuid(), jti: z.uuid(), fam: z.uuid() });
export type RefreshClaims = z.infer<typeof RefreshClaims>;

export function signAccessToken(c: { userId: string; tenantId: string; role: Role; name: string }) {
  return new SignJWT({ tid: c.tenantId, role: c.role, name: c.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(c.userId)
    .setIssuer(ISSUER)
    .setAudience(`${ISSUER}:api`)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(accessKey);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, accessKey, { issuer: ISSUER, audience: `${ISSUER}:api`, algorithms: ['HS256'] });
  return AccessClaims.parse(payload);
}

export function signRefreshToken(c: { userId: string; tenantId: string; tokenId: string; familyId: string }) {
  return new SignJWT({ tid: c.tenantId, fam: c.familyId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(c.userId)
    .setJti(c.tokenId)
    .setIssuer(ISSUER)
    .setAudience(`${ISSUER}:refresh`)
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TTL_SECONDS}s`)
    .sign(refreshKey);
}

export async function verifyRefreshToken(token: string): Promise<RefreshClaims> {
  const { payload } = await jwtVerify(token, refreshKey, { issuer: ISSUER, audience: `${ISSUER}:refresh`, algorithms: ['HS256'] });
  return RefreshClaims.parse(payload);
}
