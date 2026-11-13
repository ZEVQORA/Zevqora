/**
 * 2026-11-13: Vercel Production was re-pointed at the new Supabase project
 * (dhqagbcaqspdrxcsxgfb) while the legacy project (czhufhufvwvgyhjuaauo) still
 * holds real accounts. Both are production data, so every guard (server,
 * browser, build, staging harness) must refuse a preview that reaches either,
 * including with opaque sb_* keys that carry no ref.
 */
import { describe, expect, it } from 'vitest';
import { assertBuildIsolation, isolationStatus, PRODUCTION_SUPABASE_REFS as SERVER_REFS } from '../api/_lib/env-isolation.js';
import { browserIsolationViolation, PRODUCTION_SUPABASE_REFS as BROWSER_REFS } from '../src/lib/isolation';
import { checkStaging, CONFIRM_PHRASE, PRODUCTION_PROJECT_REFS as GUARD_REFS } from '../scripts/staging/guard.mjs';

const CURRENT = 'dhqagbcaqspdrxcsxgfb';
const LEGACY = 'czhufhufvwvgyhjuaauo';
const STAGING = 'lxbcynzgeuqzmynkuzqg';
const url = (ref: string) => `https://${ref}.supabase.co`;

describe('production project refs', () => {
  it('server, browser and staging guard agree on the same list, current project first', () => {
    expect([...SERVER_REFS]).toEqual([CURRENT, LEGACY]);
    expect([...BROWSER_REFS]).toEqual([...SERVER_REFS]);
    expect([...GUARD_REFS]).toEqual([...SERVER_REFS]);
  });

  it.each([CURRENT, LEGACY])('server refuses a preview on %s, even with opaque keys', (ref) => {
    const env = { VERCEL_ENV: 'preview', SUPABASE_URL: url(ref), PUBLIC_SUPABASE_URL: url(ref), SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_opaque', PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_opaque' };
    expect(isolationStatus(env).violation).toBe('PREVIEW_USES_PRODUCTION_SUPABASE');
    expect(() => assertBuildIsolation(env)).toThrow(/refusing to build: PREVIEW_USES_PRODUCTION_SUPABASE/);
  });

  it.each([CURRENT, LEGACY])('server refuses a preview whose browser URL alone is %s', (ref) => {
    const env = { VERCEL_ENV: 'preview', SUPABASE_URL: url(STAGING), PUBLIC_SUPABASE_URL: url(ref), SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_opaque' };
    expect(isolationStatus(env).violation).toBe('PREVIEW_USES_PRODUCTION_SUPABASE');
  });

  it.each([CURRENT, LEGACY])('browser refuses a preview client for %s', (ref) => {
    expect(browserIsolationViolation('preview', url(ref), 'sb_publishable_opaque')).toBe(true);
    expect(browserIsolationViolation('production', url(ref), 'sb_publishable_opaque')).toBe(false);
  });

  it('an isolated staging preview still passes and production is unaffected', () => {
    expect(isolationStatus({ VERCEL_ENV: 'preview', SUPABASE_URL: url(STAGING), PUBLIC_SUPABASE_URL: url(STAGING), SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_opaque' }).violation).toBeNull();
    expect(isolationStatus({ VERCEL_ENV: 'production', SUPABASE_URL: url(CURRENT), PUBLIC_SUPABASE_URL: url(CURRENT), SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_opaque' }).violation).toBeNull();
  });

  it.each([CURRENT, LEGACY])('staging harness refuses %s as its target', (ref) => {
    const r = checkStaging({
      STAGING_SUPABASE_URL: url(ref),
      STAGING_SUPABASE_ANON_KEY: 'sb_publishable_opaque',
      STAGING_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_opaque',
      STAGING_APP_URL: 'http://127.0.0.1:3000',
      STAGING_CONFIRM: CONFIRM_PHRASE,
    }, { requireWriteApproval: false });
    expect(r.ok).toBe(false);
  });
});
