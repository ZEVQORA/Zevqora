/** The local staging harness must never pass a production value to the API it starts. */
import { describe, expect, it } from 'vitest';
import { cleanBase, parseEnvFile, serverEnv } from '../scripts/staging/local-e2e.mjs';

describe('local staging E2E harness', () => {
  it('parses KEY=VALUE files, ignoring comments and quotes', () => {
    expect(parseEnvFile('# c\nSTAGING_SUPABASE_URL="https://x.supabase.co"\n\nSTAGING_CONFIRM=yes\n#STAGING_WRITES_APPROVED=a@b')).toEqual({ STAGING_SUPABASE_URL: 'https://x.supabase.co', STAGING_CONFIRM: 'yes' });
  });

  it('strips every inherited Supabase, OpenRouter, Stripe, Vercel and server secret variable', () => {
    const inherited = { PATH: '/bin', SUPABASE_URL: 'prod', SUPABASE_SERVICE_ROLE_KEY: 'prod', PUBLIC_SUPABASE_URL: 'prod', PUBLIC_SUPABASE_ANON_KEY: 'prod', OPENROUTER_API_KEY: 'paid', STRIPE_SECRET_KEY: 's', VERCEL_ENV: 'production', CRON_SECRET: 'c', DESKTOP_HANDOFF_SECRET: 'd', STAGING_APP_URL: 'old' };
    expect(cleanBase(inherited)).toEqual({ PATH: '/bin' });
  });

  it('derives the API environment only from STAGING_* values', () => {
    const env = serverEnv({ PATH: '/bin', SUPABASE_SERVICE_ROLE_KEY: 'prod-key', OPENROUTER_API_KEY: 'paid' }, { STAGING_SUPABASE_URL: 'https://lxbcynzgeuqzmynkuzqg.supabase.co', STAGING_SUPABASE_ANON_KEY: 'stg-anon', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'stg-service' }, 3000);
    expect(env).toEqual({ PATH: '/bin', PORT: '3000', SUPABASE_URL: 'https://lxbcynzgeuqzmynkuzqg.supabase.co', PUBLIC_SUPABASE_URL: 'https://lxbcynzgeuqzmynkuzqg.supabase.co', PUBLIC_SUPABASE_ANON_KEY: 'stg-anon', SUPABASE_SERVICE_ROLE_KEY: 'stg-service' });
  });
});
