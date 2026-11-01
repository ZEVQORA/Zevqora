import { defineConfig } from 'vitest/config';

// Staging-only suite: real Supabase + a preview deployment. Never part of `npm test`.
// The guard in scripts/staging/guard.mjs skips every test unless staging is configured.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/staging/**/*.staging.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
