import { json, methodNotAllowed, bearerToken } from '../_lib/http.js';
import { adminClient, verifyAccessToken } from '../_lib/supabase.js';
import { stripeClient, appUrl } from '../_lib/stripe.js';
export async function POST(request) {
  try {
    const token = bearerToken(request); if (!token) return json({ error: 'Sign in first.' }, 401); const user = await verifyAccessToken(token); if (!user) return json({ error: 'Your session expired. Sign in again.' }, 401);
    const admin = adminClient(); const { data: sub } = await admin.from('subscriptions').select('stripe_customer_id').eq('user_id', user.id).maybeSingle(); if (!sub?.stripe_customer_id) return json({ error: 'No paid billing profile exists yet.' }, 409);
    const stripe = stripeClient(); const session = await stripe.billingPortal.sessions.create({ customer: sub.stripe_customer_id, return_url: `${appUrl()}/account` }); return json({ url: session.url });
  } catch (error) { console.error('[stripe/create-portal]', error); return json({ error: error?.message || 'Billing portal is unavailable.' }, 500); }
}
export function GET() { return methodNotAllowed(); }
