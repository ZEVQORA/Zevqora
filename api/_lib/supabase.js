import { createClient } from '@supabase/supabase-js';

export function requireSupabaseEnv() {
  const url = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !service) throw new Error('Supabase server configuration is incomplete.');
  return { url, service, anon };
}

export function adminClient() {
  const { url, service } = requireSupabaseEnv();
  return createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function publicServerClient() {
  const { url, anon } = requireSupabaseEnv();
  if (!anon) throw new Error('PUBLIC_SUPABASE_ANON_KEY is missing.');
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function verifyAccessToken(token) {
  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export async function accountStateForUser(userId) {
  const admin = adminClient();
  const [{ data: sub }, { data: credit }] = await Promise.all([
    admin
      .from('subscriptions')
      .select('plan,status,current_period_end,cancel_at_period_end,stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle(),
    admin
      .from('credit_balances')
      .select('included_usd,used_usd,period_start,period_end')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  return {
    plan: sub?.plan || 'free',
    status: sub?.status || 'active',
    currentPeriodEnd: sub?.current_period_end || null,
    cancelAtPeriodEnd: Boolean(sub?.cancel_at_period_end),
    hasStripeCustomer: Boolean(sub?.stripe_customer_id),
    credit: {
      includedUsd: Number(credit?.included_usd ?? 5),
      usedUsd: Number(credit?.used_usd ?? 0),
      periodStart: credit?.period_start || null,
      periodEnd: credit?.period_end || null,
    },
  };
}
