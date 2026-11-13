/**
 * Browser-side environment isolation. The build already refuses a preview
 * configured with the production Supabase project (vite.config.ts); this is the
 * runtime backstop for values that arrive later (/api/public-config) or a
 * build made outside that check.
 */
declare const __ZEVQORA_DEPLOY_ENV__: string | undefined;

/** Same values as api/_lib/env-isolation.js (asserted by tests/browser-isolation.test.ts). */
/**
 * Every Supabase project that holds (or held) production data. The current
 * production project comes first; the legacy one keeps real accounts until it
 * is retired, so a preview must not reach either.
 */
export const PRODUCTION_SUPABASE_REFS: readonly string[] = ['dhqagbcaqspdrxcsxgfb', 'czhufhufvwvgyhjuaauo'];
export const PRODUCTION_SUPABASE_REF = PRODUCTION_SUPABASE_REFS[0];

/** Vercel environment the bundle was built for: production, preview, development or local. */
export const DEPLOY_ENV: string = typeof __ZEVQORA_DEPLOY_ENV__ === 'string' ? __ZEVQORA_DEPLOY_ENV__ : 'local';

const REF_HOST = /^([a-z0-9]{20})\.supabase\.co$/;

export function supabaseRef(url: string): string | null {
  try {
    return new URL(url).hostname.match(REF_HOST)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** `ref` claim of a legacy JWT-format key, decoded without verification. */
export function keyRef(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parts[1].length / 4) * 4, '='));
    const ref = (JSON.parse(json) as { ref?: unknown }).ref;
    return typeof ref === 'string' ? ref : null;
  } catch {
    return null;
  }
}

/** True when a preview build would hand the production project's URL or key to the browser. */
export function browserIsolationViolation(deployEnv: string, supabaseUrl: string, anonKey: string): boolean {
  if (deployEnv !== 'preview') return false;
  const refs = [supabaseRef(supabaseUrl), keyRef(anonKey)];
  return refs.some((ref) => ref !== null && PRODUCTION_SUPABASE_REFS.includes(ref));
}
