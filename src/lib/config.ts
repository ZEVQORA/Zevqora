/**
 * Runtime configuration. Public values are inlined at build time from
 * PUBLIC_* environment variables; /api/public-config fills any gap at runtime
 * so a deployment without inlined values still works.
 */
export interface PublicConfig {
  appUrl: string;
  desktopDownloadUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  stripeConfigured: boolean;
  contactEmail: string;
  features: { cloudReplay: boolean; telemetry: boolean };
}

const env = import.meta.env as Record<string, string | undefined>;

const inlined: PublicConfig = {
  appUrl: env.PUBLIC_APP_URL || 'https://zevqora.vercel.app',
  desktopDownloadUrl: env.PUBLIC_DESKTOP_DOWNLOAD_URL || 'https://github.com/ZEVQORA/Zevqora/releases/latest/download/ZEVQORA-Setup.exe',
  supabaseUrl: env.PUBLIC_SUPABASE_URL || '',
  supabaseAnonKey: env.PUBLIC_SUPABASE_ANON_KEY || '',
  stripeConfigured: false,
  contactEmail: env.PUBLIC_CONTACT_EMAIL || 'zevqora.ai@gmail.com',
  features: { cloudReplay: false, telemetry: true },
};

let cached: PublicConfig = inlined;
let pending: Promise<PublicConfig> | null = null;

export function getConfigSync(): PublicConfig {
  return cached;
}

export function loadConfig(): Promise<PublicConfig> {
  if (pending) return pending;
  pending = fetch('/api/public-config', { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) throw new Error('config unavailable');
      const remote = (await res.json()) as Partial<PublicConfig>;
      cached = {
        ...inlined,
        ...remote,
        supabaseUrl: remote.supabaseUrl || inlined.supabaseUrl,
        supabaseAnonKey: remote.supabaseAnonKey || inlined.supabaseAnonKey,
        features: { ...inlined.features, ...(remote.features || {}) },
      };
      return cached;
    })
    .catch(() => cached);
  return pending;
}
