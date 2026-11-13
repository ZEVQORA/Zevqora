/**
 * Runtime configuration. Public values are inlined at build time from
 * PUBLIC_* environment variables; /api/public-config fills any gap at runtime
 * so a deployment without inlined values still works.
 *
 * Environment isolation: a preview never hands the production Supabase project
 * to the browser. Such values are dropped (Supabase stays unconfigured) and an
 * ENVIRONMENT_ISOLATION_VIOLATION from the API is never papered over with the
 * inlined values.
 */
import { browserIsolationViolation, DEPLOY_ENV } from './isolation';

export interface PublicConfig {
  appUrl: string;
  desktopDownloadUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  stripeConfigured: boolean;
  contactEmail: string;
  features: { cloudReplay: boolean; telemetry: boolean };
  /** Set when Supabase values were withheld because this deployment is not isolated. */
  isolationBlocked?: boolean;
}

/** Drops Supabase values a preview must not use. Pure; exported for tests. */
export function enforceIsolation(cfg: PublicConfig, deployEnv: string = DEPLOY_ENV): PublicConfig {
  if (!browserIsolationViolation(deployEnv, cfg.supabaseUrl, cfg.supabaseAnonKey)) return cfg;
  return { ...cfg, supabaseUrl: '', supabaseAnonKey: '', isolationBlocked: true };
}

const env = import.meta.env as Record<string, string | undefined>;

const inlined: PublicConfig = enforceIsolation({
  appUrl: env.PUBLIC_APP_URL || 'https://zevqora.vercel.app',
  desktopDownloadUrl: env.PUBLIC_DESKTOP_DOWNLOAD_URL || 'https://github.com/ZEVQORA/Zevqora/releases/latest/download/ZEVQORA-Setup.exe',
  supabaseUrl: env.PUBLIC_SUPABASE_URL || '',
  supabaseAnonKey: env.PUBLIC_SUPABASE_ANON_KEY || '',
  stripeConfigured: false,
  contactEmail: env.PUBLIC_CONTACT_EMAIL || 'zevqora.ai@gmail.com',
  features: { cloudReplay: false, telemetry: true },
});

let cached: PublicConfig = inlined;
let pending: Promise<PublicConfig> | null = null;

export function getConfigSync(): PublicConfig {
  return cached;
}

export function loadConfig(): Promise<PublicConfig> {
  // The separately published design preview has no API or production session.
  // Ordinary builds retain the existing authenticated runtime configuration.
  if (import.meta.env.VITE_DESIGN_PREVIEW === 'true') return Promise.resolve(cached);
  if (pending) return pending;
  pending = fetch('/api/public-config', { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'ENVIRONMENT_ISOLATION_VIOLATION') {
          cached = { ...inlined, supabaseUrl: '', supabaseAnonKey: '', isolationBlocked: true };
          return cached;
        }
        throw new Error('config unavailable');
      }
      const remote = (await res.json()) as Partial<PublicConfig>;
      cached = enforceIsolation({
        ...inlined,
        ...remote,
        supabaseUrl: remote.supabaseUrl || inlined.supabaseUrl,
        supabaseAnonKey: remote.supabaseAnonKey || inlined.supabaseAnonKey,
        features: { ...inlined.features, ...(remote.features || {}) },
      });
      return cached;
    })
    .catch(() => cached);
  return pending;
}

/** Test hook: forget the cached remote configuration. */
export function resetConfigForTests() {
  cached = inlined;
  pending = null;
}
