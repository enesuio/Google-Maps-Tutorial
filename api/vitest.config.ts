import { defineConfig } from 'vitest/config';

// Integration tests share one Postgres database, so files run one at a time.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
