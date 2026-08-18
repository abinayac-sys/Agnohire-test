import { defineConfig } from 'vitest/config';

/**
 * Integration tests run black-box against a *running* server (default
 * http://localhost:4000), mirroring the project's established smoke-test
 * approach. This avoids re-bootstrapping the app (which would fight over the
 * port, Redis, queues, and Socket.IO) and exercises the real wired stack.
 *
 * Prerequisite: `npm run dev` (server + DB + Redis) must be up.
 * Override the target with TEST_BASE_URL.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Run files sequentially: tests share one live DB and some mutate state.
    fileParallelism: false,
    reporters: 'verbose',
  },
});
