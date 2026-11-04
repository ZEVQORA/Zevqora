/**
 * Environment isolation: a Vercel preview must never reach the production
 * Supabase project.
 *
 * Several variables (including SUPABASE_SERVICE_ROLE_KEY and
 * PUBLIC_SUPABASE_URL) can be configured for both the production and preview
 * targets, and requireSupabaseEnv() falls back from SUPABASE_URL to
 * PUBLIC_SUPABASE_URL. Without this check any preview build would run with
 * service-role access to production data.
 *
 * Only project refs and booleans leave this module; key material never does.
 */
import { ApiError } from './http.js';

export const PRODUCTION_SUPABASE_REF = 'czhufhufvwvgyhjuaauo';

const REF_HOST = /^([a-z0-9]{20})\.supabase\.co$/;

/** Project ref of a Supabase URL (`https://<ref>.supabase.co`), or null for anything else. */
export function supabaseRef(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.match(REF_HOST)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Project ref and role carried by a legacy JWT-format Supabase key, decoded
 * without verification. Opaque keys (sb_secret_…, sb_publishable_…) carry
 * neither and return nulls.
 */
export function keyClaims(key) {
  const parts = typeof key === 'string' ? key.split('.') : [];
  if (parts.length !== 3) return { ref: null, role: null };
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return { ref: typeof payload.ref === 'string' ? payload.ref : null, role: typeof payload.role === 'string' ? payload.role : null };
  } catch {
    return { ref: null, role: null };
  }
}

/** Describes which Supabase project this deployment talks to and whether that is allowed. */
export function isolationStatus(env = process.env) {
  const environment = env.VERCEL_ENV || 'local';
  const serverRef = supabaseRef(env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL);
  const publicRef = supabaseRef(env.PUBLIC_SUPABASE_URL);
  const key = keyClaims(env.SUPABASE_SERVICE_ROLE_KEY);
  const serviceKeyProject = !env.SUPABASE_SERVICE_ROLE_KEY ? 'missing' : !key.ref ? 'unverifiable' : key.ref === serverRef ? 'matches_url' : 'mismatch';
  const usesProduction = [serverRef, publicRef, key.ref].includes(PRODUCTION_SUPABASE_REF);
  let violation = null;
  if (environment === 'preview' && usesProduction) violation = 'PREVIEW_USES_PRODUCTION_SUPABASE';
  else if (environment === 'preview' && serviceKeyProject === 'mismatch') violation = 'SERVICE_KEY_PROJECT_MISMATCH';
  return { environment, supabase_ref: serverRef, public_supabase_ref: publicRef, service_key_project: serviceKeyProject, uses_production_supabase: usesProduction, violation };
}

/** Throws 503 before any database client is created when a preview points at production. */
export function assertEnvironmentIsolation(env = process.env) {
  const status = isolationStatus(env);
  if (status.violation) {
    console.error(`[isolation] refused: ${status.violation} (environment=${status.environment})`);
    throw new ApiError(503, 'This deployment is not configured with an isolated database.', 'ENVIRONMENT_ISOLATION_VIOLATION');
  }
  return status;
}
