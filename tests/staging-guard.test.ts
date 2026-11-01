/** The staging guard must make it impossible to point staging tests at production by mistake. */
import { describe, expect, it } from 'vitest';
import { checkStaging, CONFIRM_PHRASE, PRODUCTION_PROJECT_REF } from '../scripts/staging/guard.mjs';

const ok = {
  STAGING_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  STAGING_SUPABASE_ANON_KEY: 'anon-test-value',
  STAGING_SUPABASE_SERVICE_ROLE_KEY: 'service-test-value',
  STAGING_APP_URL: 'https://zevqora-git-nero-vnext-part3.vercel.app',
  STAGING_CONFIRM: CONFIRM_PHRASE,
};

describe('staging guard', () => {
  it('accepts an isolated project and a preview URL', () => {
    expect(checkStaging(ok).ok).toBe(true);
  });

  it('refuses the production Supabase project', () => {
    const r = checkStaging({ ...ok, STAGING_SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co` });
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toMatch(/PRODUCTION project/);
  });

  it('refuses the production site', () => {
    expect(checkStaging({ ...ok, STAGING_APP_URL: 'https://zevqora.vercel.app' }).ok).toBe(false);
  });

  it('refuses without the explicit confirmation phrase or with missing variables', () => {
    expect(checkStaging({ ...ok, STAGING_CONFIRM: 'yes' }).ok).toBe(false);
    expect(checkStaging({ ...ok, STAGING_SUPABASE_SERVICE_ROLE_KEY: '' }).ok).toBe(false);
  });

  it('refuses when the production service-role key is reused for staging', () => {
    expect(checkStaging({ ...ok, SUPABASE_SERVICE_ROLE_KEY: 'service-test-value' }).ok).toBe(false);
  });
});
