/**
 * A Vercel preview must never reach the production Supabase project. On the
 * Vercel project, SUPABASE_SERVICE_ROLE_KEY and PUBLIC_SUPABASE_URL were found
 * configured as single records targeting both production and preview, so a
 * preview build would otherwise run with production service-role access.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertBuildIsolation, assertEnvironmentIsolation, isolationStatus, keyClaims, PRODUCTION_SUPABASE_REF, supabaseRef } from '../api/_lib/env-isolation.js';
import { PRODUCTION_PROJECT_REF } from '../scripts/staging/guard.mjs';

const STAGING_REF = 'lxbcynzgeuqzmynkuzqg';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeKey = (ref: string, role = 'service_role') => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', ref, role })}.signature-not-checked`;
const url = (ref: string) => `https://${ref}.supabase.co`;

describe('environment isolation helpers', () => {
  it('uses the same production ref as the staging guard', () => {
    expect(PRODUCTION_SUPABASE_REF).toBe(PRODUCTION_PROJECT_REF);
  });

  it('extracts project refs only from canonical Supabase URLs', () => {
    expect(supabaseRef(url(STAGING_REF))).toBe(STAGING_REF);
    expect(supabaseRef(`https://${PRODUCTION_SUPABASE_REF}.supabase.co/rest/v1`)).toBe(PRODUCTION_SUPABASE_REF);
    expect(supabaseRef('https://db.example.com')).toBeNull();
    expect(supabaseRef('not a url')).toBeNull();
    expect(supabaseRef(undefined)).toBeNull();
  });

  it('reads ref and role from legacy JWT keys and nothing from opaque keys', () => {
    expect(keyClaims(fakeKey(STAGING_REF))).toEqual({ ref: STAGING_REF, role: 'service_role' });
    expect(keyClaims('sb_secret_opaque-value')).toEqual({ ref: null, role: null });
    expect(keyClaims('a.%%%.c')).toEqual({ ref: null, role: null });
  });
});

describe('isolationStatus / assertEnvironmentIsolation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses a preview whose server URL falls back to the production PUBLIC_SUPABASE_URL', () => {
    const env = { VERCEL_ENV: 'preview', PUBLIC_SUPABASE_URL: url(PRODUCTION_SUPABASE_REF), SUPABASE_SERVICE_ROLE_KEY: fakeKey(PRODUCTION_SUPABASE_REF) };
    expect(isolationStatus(env)).toMatchObject({ environment: 'preview', supabase_ref: PRODUCTION_SUPABASE_REF, violation: 'PREVIEW_USES_PRODUCTION_SUPABASE' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => assertEnvironmentIsolation(env)).toThrow(expect.objectContaining({ status: 503, code: 'ENVIRONMENT_ISOLATION_VIOLATION' }));
  });

  it('refuses a preview pointed at staging but still holding the production service-role key', () => {
    const env = { VERCEL_ENV: 'preview', SUPABASE_URL: url(STAGING_REF), PUBLIC_SUPABASE_URL: url(STAGING_REF), SUPABASE_SERVICE_ROLE_KEY: fakeKey(PRODUCTION_SUPABASE_REF) };
    expect(isolationStatus(env)).toMatchObject({ supabase_ref: STAGING_REF, service_key_project: 'mismatch', uses_production_supabase: true, violation: 'PREVIEW_USES_PRODUCTION_SUPABASE' });
  });

  it('refuses a preview whose browser config still points at production', () => {
    const env = { VERCEL_ENV: 'preview', SUPABASE_URL: url(STAGING_REF), PUBLIC_SUPABASE_URL: url(PRODUCTION_SUPABASE_REF), SUPABASE_SERVICE_ROLE_KEY: fakeKey(STAGING_REF) };
    expect(isolationStatus(env).violation).toBe('PREVIEW_USES_PRODUCTION_SUPABASE');
  });

  it('refuses a preview whose service key belongs to a different project than its URL', () => {
    const env = { VERCEL_ENV: 'preview', SUPABASE_URL: url(STAGING_REF), PUBLIC_SUPABASE_URL: url(STAGING_REF), SUPABASE_SERVICE_ROLE_KEY: fakeKey('abcdefghijklmnopqrst') };
    expect(isolationStatus(env).violation).toBe('SERVICE_KEY_PROJECT_MISMATCH');
  });

  it('allows a fully isolated staging preview', () => {
    const env = { VERCEL_ENV: 'preview', SUPABASE_URL: url(STAGING_REF), PUBLIC_SUPABASE_URL: url(STAGING_REF), SUPABASE_SERVICE_ROLE_KEY: fakeKey(STAGING_REF) };
    expect(assertEnvironmentIsolation(env)).toMatchObject({ supabase_ref: STAGING_REF, service_key_project: 'matches_url', uses_production_supabase: false, violation: null });
  });

  it('reports an opaque staging key as unverifiable rather than guessing', () => {
    const env = { VERCEL_ENV: 'preview', SUPABASE_URL: url(STAGING_REF), PUBLIC_SUPABASE_URL: url(STAGING_REF), SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_opaque-value' };
    expect(isolationStatus(env)).toMatchObject({ service_key_project: 'unverifiable', violation: null });
  });

  it('refuses a preview whose browser anon key belongs to production even if every URL is staging', () => {
    const env = { VERCEL_ENV: 'preview', SUPABASE_URL: url(STAGING_REF), PUBLIC_SUPABASE_URL: url(STAGING_REF), PUBLIC_SUPABASE_ANON_KEY: fakeKey(PRODUCTION_SUPABASE_REF, 'anon'), SUPABASE_SERVICE_ROLE_KEY: fakeKey(STAGING_REF) };
    expect(isolationStatus(env).violation).toBe('PREVIEW_USES_PRODUCTION_SUPABASE');
  });

  it('build-time check: an unsafe preview build throws; production, local and an isolated preview build', () => {
    expect(() => assertBuildIsolation({ VERCEL_ENV: 'preview', PUBLIC_SUPABASE_URL: url(PRODUCTION_SUPABASE_REF), PUBLIC_SUPABASE_ANON_KEY: fakeKey(PRODUCTION_SUPABASE_REF, 'anon') })).toThrow(/refusing to build: PREVIEW_USES_PRODUCTION_SUPABASE/);
    expect(() => assertBuildIsolation({ VERCEL_ENV: 'preview', PUBLIC_SUPABASE_URL: url(STAGING_REF), PUBLIC_SUPABASE_ANON_KEY: fakeKey(PRODUCTION_SUPABASE_REF, 'anon') })).toThrow(/refusing to build/);
    expect(assertBuildIsolation({ VERCEL_ENV: 'production', PUBLIC_SUPABASE_URL: url(PRODUCTION_SUPABASE_REF), PUBLIC_SUPABASE_ANON_KEY: fakeKey(PRODUCTION_SUPABASE_REF, 'anon') }).violation).toBeNull();
    expect(assertBuildIsolation({}).violation).toBeNull();
    expect(assertBuildIsolation({ VERCEL_ENV: 'preview', PUBLIC_SUPABASE_URL: url(STAGING_REF), PUBLIC_SUPABASE_ANON_KEY: fakeKey(STAGING_REF, 'anon') }).violation).toBeNull();
  });

  it('never blocks production or local development', () => {
    const prod = { VERCEL_ENV: 'production', SUPABASE_URL: url(PRODUCTION_SUPABASE_REF), PUBLIC_SUPABASE_URL: url(PRODUCTION_SUPABASE_REF), SUPABASE_SERVICE_ROLE_KEY: fakeKey(PRODUCTION_SUPABASE_REF) };
    expect(assertEnvironmentIsolation(prod)).toMatchObject({ environment: 'production', violation: null });
    expect(assertEnvironmentIsolation({ PUBLIC_SUPABASE_URL: url(STAGING_REF) })).toMatchObject({ environment: 'local', violation: null });
  });
});

describe('the API fails closed in a preview pointed at production', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('refuses every database-backed route with 503 and reports the violation on /api/health', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.PUBLIC_SUPABASE_URL = url(PRODUCTION_SUPABASE_REF);
    process.env.PUBLIC_SUPABASE_ANON_KEY = fakeKey(PRODUCTION_SUPABASE_REF, 'anon');
    process.env.SUPABASE_SERVICE_ROLE_KEY = fakeKey(PRODUCTION_SUPABASE_REF);
    delete process.env.SUPABASE_URL;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.resetModules();
    const { dispatch, resetRoutesForTests } = await import('../api/_lib/router.js');
    resetRoutesForTests();
    await import('../api/_lib/handlers/public.js');
    await import('../api/_lib/handlers/me.js');

    const health = await dispatch(new Request('https://preview.test/api/health'));
    const h = await health.json();
    expect(health.status).toBe(200);
    expect(h).toMatchObject({ ok: false, environment: 'preview', isolation: { supabase_ref: PRODUCTION_SUPABASE_REF, violation: 'PREVIEW_USES_PRODUCTION_SUPABASE' } });
    expect(JSON.stringify(h)).not.toContain(process.env.SUPABASE_SERVICE_ROLE_KEY);

    const login = await dispatch(new Request('https://preview.test/api/auth/password-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: 'someone@example.com', password: 'long-enough-password' }) }));
    expect(login.status).toBe(503);
    expect((await login.json()).code).toBe('ENVIRONMENT_ISOLATION_VIOLATION');

    const me = await dispatch(new Request('https://preview.test/api/me', { headers: { authorization: 'Bearer anything' } }));
    expect(me.status).toBe(503);

    // The browser talks to Supabase directly: /api/public-config must not hand it the production project.
    const cfg = await dispatch(new Request('https://preview.test/api/public-config'));
    const text = await cfg.text();
    expect(cfg.status).toBe(503);
    expect(cfg.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(text)).toMatchObject({ code: 'ENVIRONMENT_ISOLATION_VIOLATION', supabaseUrl: '', supabaseAnonKey: '' });
    expect(text).not.toContain(PRODUCTION_SUPABASE_REF);
    expect(text).not.toContain(process.env.PUBLIC_SUPABASE_ANON_KEY);
  });

  it('keeps serving /api/public-config unchanged in production', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.PUBLIC_SUPABASE_URL = url(PRODUCTION_SUPABASE_REF);
    process.env.PUBLIC_SUPABASE_ANON_KEY = fakeKey(PRODUCTION_SUPABASE_REF, 'anon');
    process.env.SUPABASE_SERVICE_ROLE_KEY = fakeKey(PRODUCTION_SUPABASE_REF);
    vi.resetModules();
    const { dispatch, resetRoutesForTests } = await import('../api/_lib/router.js');
    resetRoutesForTests();
    await import('../api/_lib/handlers/public.js');
    const cfg = await dispatch(new Request('https://zevqora.test/api/public-config'));
    expect(cfg.status).toBe(200);
    expect(cfg.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await cfg.json()).toMatchObject({ supabaseUrl: url(PRODUCTION_SUPABASE_REF), supabaseAnonKey: process.env.PUBLIC_SUPABASE_ANON_KEY });
  });
});
