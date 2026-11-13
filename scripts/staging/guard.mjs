/**
 * Staging guard. Every staging script and test imports this first.
 *
 * It refuses to run unless the target is provably the staging project, and it
 * fails closed: anything it cannot positively identify is refused.
 *
 * Static checks (checkStaging):
 *  - every required variable is set and STAGING_CONFIRM is the exact phrase;
 *  - both URLs are https, except a loopback STAGING_APP_URL (127.0.0.1 /
 *    localhost): the API served locally by scripts/dev-api.mjs with staging
 *    variables, which avoids any Vercel deployment;
 *  - STAGING_SUPABASE_URL is exactly https://<STAGING_PROJECT_REF>.supabase.co
 *    (an allowlist, not a production denylist; STAGING_SUPABASE_REF may name a
 *    different staging project but never the production one);
 *  - STAGING_APP_URL is not a production domain or a production branch alias;
 *  - JWT-format keys must carry the staging ref and the expected role;
 *  - no staging value equals a production-named variable.
 *
 * Runtime check (preflightDeployment): before any write, the deployed app is
 * asked which project it uses (/api/health, /api/public-config). A remote
 * deployment that is not a preview (or a loopback server that is not local),
 * reports another project, or reports an isolation violation is refused.
 *
 * Never put real secret values in this file or in the repository.
 */
/** Current production project first, then the legacy production project (still holds real accounts). */
export const PRODUCTION_PROJECT_REFS = ['dhqagbcaqspdrxcsxgfb', 'czhufhufvwvgyhjuaauo'];
export const PRODUCTION_PROJECT_REF = PRODUCTION_PROJECT_REFS[0];
export const STAGING_PROJECT_REF = 'lxbcynzgeuqzmynkuzqg';
export const PRODUCTION_HOSTS = ['zevqora.vercel.app', 'zevqora-nero404.vercel.app', 'zevqora.com', 'www.zevqora.com'];
/** Vercel branch aliases of the branches that deploy to production. */
export const PRODUCTION_ALIAS = /^zevqora-git-(main|release-vnext-part3-production)-/;
export const CONFIRM_PHRASE = 'I_UNDERSTAND_THIS_IS_STAGING';

export const REQUIRED = ['STAGING_SUPABASE_URL', 'STAGING_SUPABASE_ANON_KEY', 'STAGING_SUPABASE_SERVICE_ROLE_KEY', 'STAGING_APP_URL', 'STAGING_CONFIRM'];

const REF = /^[a-z0-9]{20}$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

function jwtClaims(key) {
  const parts = String(key).split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Staging writes (disposable users and rows) need an explicit approval for the
 * current UTC day: STAGING_WRITES_APPROVED=<approver>@<YYYY-MM-DD>. A stale
 * value left in an env file does not authorize a later run.
 */
export function checkWriteApproval(env = process.env, now = new Date()) {
  const m = /^([a-z0-9._-]{2,40})@(\d{4}-\d{2}-\d{2})$/i.exec(env.STAGING_WRITES_APPROVED || '');
  if (!m) return { ok: false, reason: 'STAGING_WRITES_APPROVED must be <approver>@<YYYY-MM-DD> (explicit approval for disposable staging writes)' };
  if (m[2] !== now.toISOString().slice(0, 10)) return { ok: false, reason: `STAGING_WRITES_APPROVED is dated ${m[2]}; approval is valid for the current UTC day only` };
  return { ok: true, approver: m[1] };
}

/** Returns { ok: true, env } or { ok: false, reason }. Never prints secret values. */
export function checkStaging(env = process.env, { requireWriteApproval = true, now = new Date() } = {}) {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) return { ok: false, reason: `missing: ${missing.join(', ')}` };
  if (env.STAGING_CONFIRM !== CONFIRM_PHRASE) return { ok: false, reason: `STAGING_CONFIRM must be ${CONFIRM_PHRASE}` };
  if (requireWriteApproval) {
    const approval = checkWriteApproval(env, now);
    if (!approval.ok) return approval;
  }

  const expectedRef = env.STAGING_SUPABASE_REF || STAGING_PROJECT_REF;
  if (!REF.test(expectedRef)) return { ok: false, reason: 'STAGING_SUPABASE_REF is not a Supabase project ref' };
  if (PRODUCTION_PROJECT_REFS.includes(expectedRef)) return { ok: false, reason: 'STAGING_SUPABASE_REF is the PRODUCTION project' };

  let supa;
  let app;
  try {
    supa = new URL(env.STAGING_SUPABASE_URL);
    app = new URL(env.STAGING_APP_URL);
  } catch {
    return { ok: false, reason: 'STAGING_SUPABASE_URL and STAGING_APP_URL must be absolute URLs' };
  }
  if (PRODUCTION_PROJECT_REFS.some((ref) => supa.hostname.includes(ref))) return { ok: false, reason: 'STAGING_SUPABASE_URL points at the PRODUCTION project' };
  const local = LOOPBACK.has(app.hostname);
  if (supa.protocol !== 'https:' || (app.protocol !== 'https:' && !(local && app.protocol === 'http:'))) return { ok: false, reason: 'STAGING_SUPABASE_URL and STAGING_APP_URL must use https (plain http only for a loopback app URL)' };
  if (supa.hostname !== `${expectedRef}.supabase.co`) return { ok: false, reason: `STAGING_SUPABASE_URL must be https://${expectedRef}.supabase.co (allowlisted staging project)` };
  if (PRODUCTION_HOSTS.includes(app.hostname)) return { ok: false, reason: 'STAGING_APP_URL points at the PRODUCTION site' };
  if (PRODUCTION_ALIAS.test(app.hostname)) return { ok: false, reason: 'STAGING_APP_URL is a production branch alias' };

  for (const [name, role] of [['STAGING_SUPABASE_ANON_KEY', 'anon'], ['STAGING_SUPABASE_SERVICE_ROLE_KEY', 'service_role']]) {
    const claims = jwtClaims(env[name]);
    if (!claims) continue; // opaque sb_* keys carry no ref; the runtime preflight still applies
    if (PRODUCTION_PROJECT_REFS.includes(claims.ref)) return { ok: false, reason: `${name} is a PRODUCTION project key` };
    if (claims.ref !== expectedRef) return { ok: false, reason: `${name} belongs to another project` };
    if (claims.role !== role) return { ok: false, reason: `${name} has role ${claims.role}, expected ${role}` };
  }
  if (env.STAGING_SUPABASE_ANON_KEY === env.STAGING_SUPABASE_SERVICE_ROLE_KEY) return { ok: false, reason: 'anon and service-role keys are identical' };

  for (const prodName of ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']) {
    if (env[prodName] && env[prodName] === env[`STAGING_${prodName}`]) return { ok: false, reason: `STAGING_${prodName} equals the production-named ${prodName}; use separate values` };
  }
  if (env.SUPABASE_URL && PRODUCTION_PROJECT_REFS.some((ref) => env.SUPABASE_URL.includes(ref)) && env.STAGING_SUPABASE_SERVICE_ROLE_KEY === env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, reason: 'the production service-role key is loaded for staging' };
  return { ok: true, env: { supabaseUrl: supa.origin, supabaseRef: expectedRef, appUrl: app.origin, mode: local ? 'local' : 'preview', anonKey: env.STAGING_SUPABASE_ANON_KEY, serviceKey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY, bypass: env.STAGING_VERCEL_BYPASS || null } };
}

/** Headers for requests to the preview (Vercel deployment protection bypass, when configured). */
export function appHeaders(env) {
  return env.bypass ? { 'x-vercel-protection-bypass': env.bypass } : {};
}

/**
 * Asks the deployed app which Supabase project it talks to. Refuses unless it
 * is a preview reporting the staging project and no isolation violation.
 */
export async function preflightDeployment(env, fetchImpl = fetch) {
  const get = async (path) => {
    const res = await fetchImpl(`${env.appUrl}${path}`, { headers: appHeaders(env), redirect: 'manual' });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: res.status, body };
  };
  let health;
  let config;
  try {
    [health, config] = await Promise.all([get('/api/health'), get('/api/public-config')]);
  } catch (error) {
    return { ok: false, reason: `deployment unreachable: ${error?.message || error}` };
  }
  if (health.status !== 200 || !health.body) return { ok: false, reason: `/api/health returned ${health.status}${health.status === 401 || health.status === 403 ? ' (deployment protection: set STAGING_VERCEL_BYPASS)' : ''}` };
  const iso = health.body.isolation;
  if (!iso) return { ok: false, reason: 'deployment does not report isolation status (it predates the isolation guard)' };
  const expectedEnv = env.mode === 'local' ? 'local' : 'preview';
  if (health.body.environment !== expectedEnv) return { ok: false, reason: `deployment environment is ${health.body.environment}, expected ${expectedEnv}` };
  if (iso.violation) return { ok: false, reason: `deployment reports ${iso.violation}` };
  if (iso.supabase_ref !== env.supabaseRef) return { ok: false, reason: `deployment server uses project ${iso.supabase_ref}, expected ${env.supabaseRef}` };
  if (iso.public_supabase_ref !== env.supabaseRef) return { ok: false, reason: `deployment browser config uses project ${iso.public_supabase_ref}, expected ${env.supabaseRef}` };
  if (iso.service_key_project === 'mismatch' || iso.service_key_project === 'missing') return { ok: false, reason: `deployment service key: ${iso.service_key_project}` };
  let configHost = null;
  try {
    configHost = new URL(config.body?.supabaseUrl || '').hostname;
  } catch {
    configHost = null;
  }
  if (configHost !== `${env.supabaseRef}.supabase.co`) return { ok: false, reason: `/api/public-config serves ${configHost || 'no Supabase URL'}` };
  return { ok: true, report: { environment: health.body.environment, supabase_ref: iso.supabase_ref, service_key_project: iso.service_key_project } };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('guard.mjs')) {
  // --preflight-only: read-only checks (no write approval needed); test:staging runs without it.
  const r = checkStaging(process.env, { requireWriteApproval: !process.argv.includes('--preflight-only') });
  if (!r.ok) {
    console.log(`STAGING_GUARD REFUSED — ${r.reason}`);
    process.exit(1);
  }
  const p = await preflightDeployment(r.env);
  if (!p.ok) {
    console.log(`STAGING_GUARD REFUSED — ${p.reason}`);
    process.exit(1);
  }
  console.log(`STAGING_GUARD PASS — Supabase ${new URL(r.env.supabaseUrl).hostname}, app ${new URL(r.env.appUrl).hostname}, server project ${p.report.supabase_ref} (key ${p.report.service_key_project})`);
  process.exit(0);
}
