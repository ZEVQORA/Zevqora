import { defineConfig } from 'vitest/config';

// Fixture proof loop: two whole Observe → Human Review runs on in-process
// Postgres. Kept out of `npm test` so its CPU load cannot starve the
// timing-sensitive unit tests; CI runs it as its own step.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.proof.ts'],
    testTimeout: 300_000,
    fileParallelism: false,
  },
});
