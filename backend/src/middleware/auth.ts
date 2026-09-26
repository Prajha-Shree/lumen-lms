import type { Role } from '@prisma/client';
import type { Request, RequestHandler } from 'express';
import { withTenant, type Tx } from '../lib/db.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { HttpError } from './error.js';

/** Verifies the Bearer access token and attaches `req.auth`. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Authentication required', 'UNAUTHENTICATED');
  try {
    const claims = await verifyAccessToken(header.slice('Bearer '.length));
    req.auth = { userId: claims.sub, tenantId: claims.tid, role: claims.role, name: claims.name };
  } catch {
    throw new HttpError(401, 'Invalid or expired access token', 'TOKEN_INVALID');
  }
  next();
};

/** Allows the request only for the listed roles. Use after `authenticate`. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const { role } = auth(req);
    if (!roles.includes(role)) throw new HttpError(403, 'You do not have permission to do that', 'FORBIDDEN');
    next();
  };
}

export function auth(req: Request): NonNullable<Request['auth']> {
  if (!req.auth) throw new HttpError(401, 'Authentication required', 'UNAUTHENTICATED');
  return req.auth;
}

/** Runs `fn` scoped to the caller's tenant (Postgres RLS). */
export function db<T>(req: Request, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(auth(req).tenantId, fn);
}

export const STAFF_ROLES: Role[] = ['INSTITUTION_ADMIN', 'INSTRUCTOR'];
export const isStaff = (role: Role) => STAFF_ROLES.includes(role);
