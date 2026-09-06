import Stripe from 'stripe';

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured.');
  return new Stripe(key);
}

export function appUrl() {
  return (process.env.PUBLIC_APP_URL || 'https://zevqora.vercel.app').replace(/\/$/, '');
}

/** Stripe price for a plan. The plans table is the source of truth; env vars are a legacy fallback. */
export async function priceForPlan(admin, planId, interval = 'monthly') {
  const { data: plan } = await admin.from('plans').select('id,stripe_monthly_price_id,stripe_annual_price_id,contact_sales,visible').eq('id', planId).maybeSingle();
  if (!plan) return { plan: null, priceId: '' };
  const fromDb = interval === 'annual' ? plan.stripe_annual_price_id : plan.stripe_monthly_price_id;
  if (fromDb) return { plan, priceId: fromDb };
  if (interval === 'monthly') {
    if (planId === 'pro') return { plan, priceId: process.env.STRIPE_PRO_PRICE_ID || '' };
    if (planId === 'team') return { plan, priceId: process.env.STRIPE_TEAM_PRICE_ID || '' };
  }
  return { plan, priceId: '' };
}

export async function planFromPrice(admin, priceId) {
  if (!priceId) return null;
  const { data } = await admin.from('plans').select('id').or(`stripe_monthly_price_id.eq.${priceId},stripe_annual_price_id.eq.${priceId}`).limit(1);
  if (data?.[0]?.id) return data[0].id;
  if (priceId === process.env.STRIPE_PRO_PRICE_ID) return 'pro';
  if (priceId === process.env.STRIPE_TEAM_PRICE_ID) return 'team';
  return null;
}

export async function includedCreditsForPlan(admin, planId) {
  const { data } = await admin.from('plans').select('limits').eq('id', planId).maybeSingle();
  const value = Number(data?.limits?.credits_usd);
  return Number.isFinite(value) ? value : 5;
}
