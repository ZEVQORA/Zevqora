/**
 * The browser connects to Supabase directly (Auth + PostgREST) with values
 * inlined at build time or served by /api/public-config. A preview must never
 * end up with a client for the production project, whichever path the values
 * take.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRODUCTION_SUPABASE_REF as SERVER_REF } from '../api/_lib/env-isolation.js';
import { browserIsolationViolation, keyRef, PRODUCTION_SUPABASE_REF, supabaseRef } from '../src/lib/isolation';
import { enforceIsolation, getConfigSync, loadConfig, resetConfigForTests, type PublicConfig } from '../src/lib/config';
import { usable } from '../src/lib/supabase';

const STAGING_REF = 'lxbcynzgeuqzmynkuzqg';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const anonKey = (ref: string) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', ref, role: 'anon' })}.signature-not-checked`;
const url = (ref: string) => `https://${ref}.supabase.co`;
const base: PublicConfig = { appUrl: 'https://x.test', desktopDownloadUrl: '', supabaseUrl: '', supabaseAnonKey: '', stripeConfigured: false, contactEmail: '', features: { cloudReplay: false, telemetry: true } };

describe('browser isolation helpers', () => {
  it('uses the same production ref as the server guard', () => {
    expect(PRODUCTION_SUPABASE_REF).toBe(SERVER_REF);
  });

  it('reads project refs from URLs and JWT anon keys', () => {
    expect(supabaseRef(url(STAGING_REF))).toBe(STAGING_REF);
    expect(supabaseRef('nonsense')).toBeNull();
    expect(keyRef(anonKey(PRODUCTION_SUPABASE_REF))).toBe(PRODUCTION_SUPABASE_REF);
    expect(keyRef('sb_publishable_opaque')).toBeNull();
  });

  it('flags only a preview that would use the production project (by URL or by key)', () => {
    expect(browserIsolationViolation('preview', url(PRODUCTION_SUPABASE_REF), anonKey(PRODUCTION_SUPABASE_REF))).toBe(true);
    expect(browserIsolationViolation('preview', url(STAGING_REF), anonKey(PRODUCTION_SUPABASE_REF))).toBe(true);
    expect(browserIsolationViolation('preview', url(PRODUCTION_SUPABASE_REF), 'sb_publishable_opaque')).toBe(true);
    expect(browserIsolationViolation('preview', url(STAGING_REF), anonKey(STAGING_REF))).toBe(false);
    expect(browserIsolationViolation('production', url(PRODUCTION_SUPABASE_REF), anonKey(PRODUCTION_SUPABASE_REF))).toBe(false);
    expect(browserIsolationViolation('local', url(PRODUCTION_SUPABASE_REF), anonKey(PRODUCTION_SUPABASE_REF))).toBe(false);
  });
});

describe('browser config (inlined and remote values)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetConfigForTests();
  });

  it('withholds production Supabase values in a preview build and keeps them in production', () => {
    const prod = { ...base, supabaseUrl: url(PRODUCTION_SUPABASE_REF), supabaseAnonKey: anonKey(PRODUCTION_SUPABASE_REF) };
    expect(enforceIsolation(prod, 'preview')).toMatchObject({ supabaseUrl: '', supabaseAnonKey: '', isolationBlocked: true });
    expect(enforceIsolation(prod, 'production')).toEqual(prod);
    const staging = { ...base, supabaseUrl: url(STAGING_REF), supabaseAnonKey: anonKey(STAGING_REF) };
    expect(enforceIsolation(staging, 'preview')).toEqual(staging);
  });

  it('never creates a browser Supabase client for the production project in a preview', () => {
    expect(usable(url(PRODUCTION_SUPABASE_REF), anonKey(PRODUCTION_SUPABASE_REF), 'preview')).toBe(false);
    expect(usable(url(STAGING_REF), anonKey(STAGING_REF), 'preview')).toBe(true);
    expect(usable(url(PRODUCTION_SUPABASE_REF), anonKey(PRODUCTION_SUPABASE_REF), 'production')).toBe(true);
  });

  it('an ENVIRONMENT_ISOLATION_VIOLATION from /api/public-config leaves Supabase unconfigured — no fallback to inlined values', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 'ENVIRONMENT_ISOLATION_VIOLATION', supabaseUrl: '', supabaseAnonKey: '' }), { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const cfg = await loadConfig();
    expect(fetchMock).toHaveBeenCalledWith('/api/public-config', { cache: 'no-store' });
    expect(cfg).toMatchObject({ supabaseUrl: '', supabaseAnonKey: '', isolationBlocked: true });
    expect(getConfigSync().isolationBlocked).toBe(true);
  });

  it('an ordinary config outage still falls back to the inlined values (unchanged behaviour)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 502 })));
    const cfg = await loadConfig();
    expect(cfg.isolationBlocked).toBeUndefined();
  });
});
