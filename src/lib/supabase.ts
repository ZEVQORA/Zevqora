import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfigSync, loadConfig } from './config';

let client: SupabaseClient | null = null;
let ready: Promise<SupabaseClient | null> | null = null;

function usable(url: string, key: string) {
  return /^https?:\/\/[^\s"']+$/.test(url) && key.length > 20 && !key.includes('[');
}

function build(url: string, key: string) {
  return createClient(url, key, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'zevqora.auth',
    },
  });
}

/** Resolves the browser Supabase client, or null when auth is not configured. */
export function getSupabase(): Promise<SupabaseClient | null> {
  if (client) return Promise.resolve(client);
  if (ready) return ready;
  const sync = getConfigSync();
  if (usable(sync.supabaseUrl, sync.supabaseAnonKey)) {
    client = build(sync.supabaseUrl, sync.supabaseAnonKey);
    ready = Promise.resolve(client);
    return ready;
  }
  ready = loadConfig().then((cfg) => {
    if (!usable(cfg.supabaseUrl, cfg.supabaseAnonKey)) return null;
    client = build(cfg.supabaseUrl, cfg.supabaseAnonKey);
    return client;
  });
  return ready;
}

export function supabaseSync(): SupabaseClient | null {
  return client;
}

export async function accessToken(): Promise<string | null> {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || null;
}

export type OAuthProvider = 'google' | 'github';
let providers: Promise<OAuthProvider[]> | null = null;

/**
 * The social providers this Supabase project has enabled, read from its public
 * Auth settings. Empty when Auth is unconfigured or the settings cannot be read,
 * so a button is never shown for a provider that would fail.
 */
export function getEnabledOAuthProviders(): Promise<OAuthProvider[]> {
  if (providers) return providers;
  providers = loadConfig()
    .then(async (cfg) => {
      if (!usable(cfg.supabaseUrl, cfg.supabaseAnonKey)) return [];
      const res = await fetch(`${cfg.supabaseUrl.replace(/\/$/, '')}/auth/v1/settings`, { headers: { apikey: cfg.supabaseAnonKey } });
      if (!res.ok) return [];
      const external = ((await res.json()) as { external?: Record<string, boolean> }).external || {};
      return (['google', 'github'] as const).filter((p) => external[p] === true);
    })
    .catch(() => []);
  return providers;
}

/** Test hook: forget the cached provider list. */
export function resetOAuthProvidersForTests() {
  providers = null;
}
