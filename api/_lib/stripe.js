import Stripe from 'stripe';
export function stripeClient() { const key = process.env.STRIPE_SECRET_KEY; if (!key) throw new Error('STRIPE_SECRET_KEY is not configured.'); return new Stripe(key); }
export function appUrl() { return (process.env.PUBLIC_APP_URL || 'https://zevqora.vercel.app').replace(/\/$/, ''); }
export function priceForPlan(plan) { if (plan === 'pro') return process.env.STRIPE_PRO_PRICE_ID || ''; if (plan === 'team') return process.env.STRIPE_TEAM_PRICE_ID || ''; return ''; }
export function planFromPrice(priceId) { if (priceId && priceId === process.env.STRIPE_PRO_PRICE_ID) return 'pro'; if (priceId && priceId === process.env.STRIPE_TEAM_PRICE_ID) return 'team'; return null; }
