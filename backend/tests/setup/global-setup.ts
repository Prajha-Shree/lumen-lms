import { execSync } from 'node:child_process';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { TEST_DB, TEST_ENV } from './test-env.js';

declare module 'vitest' {
  export interface ProvidedContext {
    dbAvailable: boolean;
  }
}

/**
 * Creates + migrates the `lms_test` database once per run. If Postgres isn't
 * reachable, DB-backed suites are skipped (reported as skipped, not passed).
 */
export default async function setup(project: TestProject) {
  const maintenance = new pg.Client({ connectionString: TEST_DB.maintenanceUrl, connectionTimeoutMillis: 3000 });
  try {
    await maintenance.connect();
  } catch {
    console.warn('\n[tests] Postgres not reachable on the test URL; skipping database suites. Run `docker compose up -d postgres`.\n');
    project.provide('dbAvailable', false);
    return;
  }
  try {
    const exists = await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB.name]);
    if (!exists.rowCount) await maintenance.query(`CREATE DATABASE ${TEST_DB.name}`);
  } finally {
    await maintenance.end();
  }

  execSync('npx prisma migrate deploy', { env: { ...process.env, ...TEST_ENV }, stdio: 'pipe' });

  // Start each run from an empty database (tenants cascade to everything).
  const owner = new pg.Client({ connectionString: TEST_DB.ownerUrl });
  await owner.connect();
  await owner.query('TRUNCATE tenants CASCADE');
  await owner.end();

  project.provide('dbAvailable', true);
}
