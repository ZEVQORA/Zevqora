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
