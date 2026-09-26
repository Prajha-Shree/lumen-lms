import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://lms_app:test@localhost:5432/lms_test',
      DIRECT_DATABASE_URL: 'postgresql://lms_owner:test@localhost:5432/lms_test',
      ML_SERVICE_URL: 'http://localhost:8000',
      INTERNAL_SERVICE_TOKEN: 'test-internal-token',
      JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
      JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
      LOG_LEVEL: 'silent',
    },
  },
});
