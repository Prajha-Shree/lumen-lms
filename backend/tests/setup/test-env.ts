// Shared by vitest.config.ts (worker env) and the global setup (main process).
// Integration tests use a dedicated `lms_test` database on the docker-compose Postgres.
const host = process.env.TEST_DB_HOST ?? 'localhost:5433';

export const TEST_DB = {
  name: 'lms_test',
  // Runtime role (RLS applies). One connection so "no leakage across pooled
  // transactions" tests actually reuse the same connection.
  appUrl: `postgresql://lms_app:lms_app_dev_password@${host}/lms_test?connection_limit=1`,
  ownerUrl: `postgresql://lms_owner:lms_owner_dev_password@${host}/lms_test`,
  maintenanceUrl: `postgresql://lms_owner:lms_owner_dev_password@${host}/postgres`,
};

export const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DB.appUrl,
  DIRECT_DATABASE_URL: TEST_DB.ownerUrl,
  ML_SERVICE_URL: 'http://localhost:8000',
  INTERNAL_SERVICE_TOKEN: 'test-internal-token',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
  LOG_LEVEL: 'silent',
};
