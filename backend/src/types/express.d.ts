import type { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate` from a verified access token. */
      auth?: {
        userId: string;
        tenantId: string;
        role: Role;
        name: string;
      };
    }
  }
}

export {};
