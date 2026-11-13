/** The staging guard must make it impossible to point staging tests at production by mistake. */
import { describe, expect, it } from 'vitest';
import { checkStaging, checkWriteApproval, CONFIRM_PHRASE, preflightDeployment, PRODUCTION_PROJECT_REF, STAGING_PROJECT_REF } from '../scripts/staging/guard.mjs';

const today = new Date().toISOString().slice(0, 10);

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (ref: string, role: string) => `${b64({ alg: 'HS256' })}.${b64({ iss: 'supabase', ref, role })}.sig`;

const ok = {
  STAGING_SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co`,
  STAGING_SUPABASE_ANON_KEY: 'anon-test-value',
  STAGING_SUPABASE_SERVICE_ROLE_KEY: 'service-test-value',
  STAGING_APP_URL: 'https://zevqora-git-staging-nero404.vercel.app',
  STAGING_CONFIRM: CONFIRM_PHRASE,
  STAGING_WRITES_APPROVED: `khuslen@${today}`,
};
const reason = (r: unknown) => (r as { reason: string }).reason;

describe('staging guard (write approval)', () => {
  it('requires an explicit approval for disposable staging writes, valid for the current UTC day only', () => {
    const { STAGING_WRITES_APPROVED, ...noApproval } = ok;
    void STAGING_WRITES_APPROVED;
    expect(reason(checkStaging(noApproval))).toMatch(/STAGING_WRITES_APPROVED must be/);
    expect(reason(checkStaging({ ...ok, STAGING_WRITES_APPROVED: 'yes' }))).toMatch(/STAGING_WRITES_APPROVED must be/);
    expect(reason(checkStaging({ ...ok, STAGING_WRITES_APPROVED: 'khuslen@2026-01-01' }, { now: new Date('2026-11-04T10:00:00Z') }))).toMatch(/current UTC day only/);
    expect(checkWriteApproval({ STAGING_WRITES_APPROVED: 'khuslen@2026-11-04' }, new Date('2026-11-04T23:59:00Z'))).toMatchObject({ ok: true, approver: 'khuslen' });
  });

  it('read-only preflight mode does not need the write approval', () => {
    const { STAGING_WRITES_APPROVED, ...noApproval } = ok;
    void STAGING_WRITES_APPROVED;
    expect(checkStaging(noApproval, { requireWriteApproval: false }).ok).toBe(true);
  });
});

describe('staging guard (static checks)', () => {
  it('accepts the allowlisted staging project and a preview URL', () => {
    expect(checkStaging(ok).ok).toBe(true);
  });

  it('refuses the production Supabase project', () => {
    const r = checkStaging({ ...ok, STAGING_SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co` });
    expect(r).toMatchObject({ ok: false });
    expect(reason(r)).toMatch(/PRODUCTION project/);
  });

  it('refuses any project that is not the allowlisted staging ref (fail closed, not a denylist)', () => {
    expect(reason(checkStaging({ ...ok, STAGING_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' }))).toMatch(/allowlisted staging project/);
    expect(reason(checkStaging({ ...ok, STAGING_SUPABASE_URL: 'https://db.example.com' }))).toMatch(/allowlisted staging project/);
  });

  it('accepts another staging project only when named explicitly, and never the production ref', () => {
    expect(checkStaging({ ...ok, STAGING_SUPABASE_REF: 'abcdefghijklmnopqrst', STAGING_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' }).ok).toBe(true);
    expect(reason(checkStaging({ ...ok, STAGING_SUPABASE_REF: PRODUCTION_PROJECT_REF }))).toMatch(/PRODUCTION project/);
  });

  it('refuses plain http except for a loopback API served locally against staging', () => {
    expect(reason(checkStaging({ ...ok, STAGING_APP_URL: 'http://zevqora-git-staging-nero404.vercel.app' }))).toMatch(/https/);
    expect(reason(checkStaging({ ...ok, STAGING_APP_URL: 'http://192.168.1.20:3000' }))).toMatch(/https/);
    expect(reason(checkStaging({ ...ok, STAGING_SUPABASE_URL: `http://${STAGING_PROJECT_REF}.supabase.co` }))).toMatch(/https/);
    expect(checkStaging({ ...ok, STAGING_APP_URL: 'http://127.0.0.1:3000' })).toMatchObject({ ok: true, env: { mode: 'local' } });
    expect(checkStaging(ok)).toMatchObject({ ok: true, env: { mode: 'preview' } });
  });

  it('refuses the production site and production branch aliases', () => {
    expect(checkStaging({ ...ok, STAGING_APP_URL: 'https://zevqora.vercel.app' }).ok).toBe(false);
    expect(reason(checkStaging({ ...ok, STAGING_APP_URL: 'https://zevqora-nero404.vercel.app' }))).toMatch(/PRODUCTION site/);
    expect(reason(checkStaging({ ...ok, STAGING_APP_URL: 'https://zevqora-git-main-nero404.vercel.app' }))).toMatch(/production branch alias/);
    expect(reason(checkStaging({ ...ok, STAGING_APP_URL: 'https://zevqora-git-release-vnext-part3-production-nero404.vercel.app' }))).toMatch(/production branch alias/);
  });

  it('refuses without the explicit confirmation phrase or with missing variables', () => {
    expect(checkStaging({ ...ok, STAGING_CONFIRM: 'yes' }).ok).toBe(false);
    expect(checkStaging({ ...ok, STAGING_SUPABASE_SERVICE_ROLE_KEY: '' }).ok).toBe(false);
  });

  it('refuses when the production service-role key is reused for staging', () => {
    expect(checkStaging({ ...ok, SUPABASE_SERVICE_ROLE_KEY: 'service-test-value' }).ok).toBe(false);
  });

  it('refuses JWT keys that belong to production or another project, or carry the wrong role', () => {
    expect(reason(checkStaging({ ...ok, STAGING_SUPABASE_SERVICE_ROLE_KEY: jwt(PRODUCTION_PROJECT_REF, 'service_role') }))).toMatch(/PRODUCTION project key/);
    expect(reason(checkStaging({ ...ok, STAGING_SUPABASE_SERVICE_ROLE_KEY: jwt('abcdefghijklmnopqrst', 'service_role') }))).toMatch(/another project/);
    expect(reason(checkStaging({ ...ok, STAGING_SUPABASE_SERVICE_ROLE_KEY: jwt(STAGING_PROJECT_REF, 'anon') }))).toMatch(/expected service_role/);
    expect(checkStaging({ ...ok, STAGING_SUPABASE_ANON_KEY: jwt(STAGING_PROJECT_REF, 'anon'), STAGING_SUPABASE_SERVICE_ROLE_KEY: jwt(STAGING_PROJECT_REF, 'service_role') }).ok).toBe(true);
  });

  it('refuses identical anon and service-role keys', () => {
    expect(reason(checkStaging({ ...ok, STAGING_SUPABASE_ANON_KEY: 'same', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'same' }))).toMatch(/identical/);
  });
});

describe('staging guard (deployment preflight)', () => {
  const env = (checkStaging({ ...ok, STAGING_VERCEL_BYPASS: 'bypass-test' }) as { env: Record<string, string> }).env;
  const health = (over: Record<string, unknown> = {}, iso: Record<string, unknown> = {}) => ({ ok: true, environment: 'preview', isolation: { supabase_ref: STAGING_PROJECT_REF, public_supabase_ref: STAGING_PROJECT_REF, service_key_project: 'matches_url', violation: null, ...iso }, ...over });
  const fake = (h: unknown, cfg: unknown = { supabaseUrl: `https://${STAGING_PROJECT_REF}.supabase.co` }, status = 200) => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const impl = async (url: string, init: { headers: Record<string, string> }) => {
      seen.push({ url, headers: init.headers });
      const body = url.endsWith('/api/health') ? h : cfg;
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    };
    return { impl: impl as unknown as typeof fetch, seen };
  };

  it('passes only for a preview that reports the staging project on both server and browser config', async () => {
    const f = fake(health());
    expect(await preflightDeployment(env, f.impl)).toMatchObject({ ok: true, report: { environment: 'preview', supabase_ref: STAGING_PROJECT_REF } });
    expect(f.seen.every((s) => s.headers['x-vercel-protection-bypass'] === 'bypass-test')).toBe(true);
  });

  it('refuses a production deployment even on a non-production URL', async () => {
    expect(reason(await preflightDeployment(env, fake(health({ environment: 'production' })).impl))).toMatch(/expected preview/);
  });

  it('accepts a loopback server only when it reports a local environment on the staging project', async () => {
    const local = (checkStaging({ ...ok, STAGING_APP_URL: 'http://127.0.0.1:3000' }) as { env: Record<string, string> }).env;
    expect(await preflightDeployment(local, fake(health({ environment: 'local' })).impl)).toMatchObject({ ok: true });
    expect(reason(await preflightDeployment(local, fake(health({ environment: 'production' })).impl))).toMatch(/expected local/);
    expect(reason(await preflightDeployment(local, fake(health({ environment: 'local' }, { supabase_ref: PRODUCTION_PROJECT_REF })).impl))).toMatch(/expected lxbcynzgeuqzmynkuzqg/);
  });

  it('refuses a preview that reports an isolation violation or another project', async () => {
    expect(reason(await preflightDeployment(env, fake(health({}, { violation: 'PREVIEW_USES_PRODUCTION_SUPABASE', supabase_ref: PRODUCTION_PROJECT_REF })).impl))).toMatch(/PREVIEW_USES_PRODUCTION_SUPABASE/);
    expect(reason(await preflightDeployment(env, fake(health({}, { supabase_ref: 'abcdefghijklmnopqrst' })).impl))).toMatch(/expected lxbcynzgeuqzmynkuzqg/);
    expect(reason(await preflightDeployment(env, fake(health({}, { public_supabase_ref: PRODUCTION_PROJECT_REF })).impl))).toMatch(/browser config/);
    expect(reason(await preflightDeployment(env, fake(health({}, { service_key_project: 'mismatch' })).impl))).toMatch(/mismatch/);
  });

  it('refuses when /api/public-config serves another Supabase URL', async () => {
    expect(reason(await preflightDeployment(env, fake(health(), { supabaseUrl: `https://${PRODUCTION_PROJECT_REF}.supabase.co` }).impl))).toMatch(/public-config serves/);
  });

  it('refuses a deployment that predates the isolation guard, is protected, or is unreachable', async () => {
    expect(reason(await preflightDeployment(env, fake({ ok: true, version: '2.0.0' }).impl))).toMatch(/predates the isolation guard/);
    expect(reason(await preflightDeployment(env, fake('<html>login</html>', '<html/>', 401).impl))).toMatch(/STAGING_VERCEL_BYPASS/);
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(reason(await preflightDeployment(env, down))).toMatch(/unreachable/);
  });
});
