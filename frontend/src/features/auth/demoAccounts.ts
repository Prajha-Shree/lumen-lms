// Development-only shortcuts for the seeded demo accounts (backend/prisma/seed.ts).
// Only rendered when import.meta.env.DEV is true, so production bundles drop them.
export const DEMO_PASSWORD = 'LumenDemo#2026';

export const DEMO_ACCOUNTS = [
  { label: 'Student', tenantSlug: 'riverside', email: 'student@riverside.test' },
  { label: 'Instructor', tenantSlug: 'riverside', email: 'instructor@riverside.test' },
  { label: 'Admin', tenantSlug: 'riverside', email: 'admin@riverside.test' },
  { label: 'Super admin', tenantSlug: 'platform', email: 'superadmin@lumen.test' },
] as const;
