/**
 * Staging guard. Every staging script and test imports this first.
 *
 * It refuses to run unless the target is clearly NOT production:
 *  - STAGING_SUPABASE_URL is set and is not the production project;
 *  - STAGING_APP_URL is set and is not the production domain;
 *  - STAGING_CONFIRM is exactly the confirmation phrase;
 *  - no production variable names are being reused for staging.
 *
 * Never put real secret values in this file or in the repository.
 */
export const PRODUCTION_PROJECT_REF = 'czhufhufvwvgyhjuaauo';
export const PRODUCTION_HOSTS = ['zevqora.vercel.app', 'zevqora.com', 'www.zevqora.com'];
export const CONFIRM_PHRASE = 'I_UNDERSTAND_THIS_IS_STAGING';

export const REQUIRED = ['STAGING_SUPABASE_URL', 'STAGING_SUPABASE_ANON_KEY', 'STAGING_SUPABASE_SERVICE_ROLE_KEY', 'STAGING_APP_URL', 'STAGING_CONFIRM'];

/** Returns { ok: true, env } or { ok: false, reason }. Never prints secret values. */
export function checkStaging(env = process.env) {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) return { ok: false, reason: `missing: ${missing.join(', ')}` };
  if (env.STAGING_CONFIRM !== CONFIRM_PHRASE) return { ok: false, reason: `STAGING_CONFIRM must be ${CONFIRM_PHRASE}` };
  let supa;
  let app;
  try {
    supa = new URL(env.STAGING_SUPABASE_URL);
    app = new URL(env.STAGING_APP_URL);
  } catch {
    return { ok: false, reason: 'STAGING_SUPABASE_URL and STAGING_APP_URL must be absolute URLs' };
  }
  if (supa.hostname.includes(PRODUCTION_PROJECT_REF)) return { ok: false, reason: 'STAGING_SUPABASE_URL points at the PRODUCTION project' };
  if (PRODUCTION_HOSTS.includes(app.hostname)) return { ok: false, reason: 'STAGING_APP_URL points at the PRODUCTION site' };
  for (const prodName of ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']) {
    if (env[prodName] && env[prodName] === env[`STAGING_${prodName}`]) return { ok: false, reason: `STAGING_${prodName} equals the production-named ${prodName}; use separate values` };
  }
  if (env.SUPABASE_URL && env.SUPABASE_URL.includes(PRODUCTION_PROJECT_REF) && env.STAGING_SUPABASE_SERVICE_ROLE_KEY === env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, reason: 'the production service-role key is loaded for staging' };
  return { ok: true, env: { supabaseUrl: supa.origin, appUrl: app.origin, anonKey: env.STAGING_SUPABASE_ANON_KEY, serviceKey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY } };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('guard.mjs')) {
  const r = checkStaging();
  console.log(r.ok ? `STAGING_GUARD PASS — Supabase ${new URL(r.env.supabaseUrl).hostname}, app ${new URL(r.env.appUrl).hostname}` : `STAGING_GUARD REFUSED — ${r.reason}`);
  process.exit(r.ok ? 0 : 1);
}
