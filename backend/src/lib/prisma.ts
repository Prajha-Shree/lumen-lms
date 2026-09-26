import { PrismaClient } from '@prisma/client';

// Single shared client. Phase 2 wraps this with a tenant-scoped extension that
// sets `app.tenant_id` per transaction so Postgres RLS policies can enforce isolation.
export const prisma = new PrismaClient();
