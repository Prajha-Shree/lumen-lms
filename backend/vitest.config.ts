import { defineConfig } from 'vitest/config';
import { TEST_ENV } from './tests/setup/test-env.js';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/setup/global-setup.ts'],
    env: TEST_ENV,
    // DB suites share one database; run files sequentially to keep them independent.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
