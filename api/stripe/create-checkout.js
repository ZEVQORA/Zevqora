import { json, methodNotAllowed, readJson, bearerToken } from '../_lib/http.js';
import { adminClient, verifyAccessToken } from '../_lib/supabase.js';
import { stripeClient, appUrl, priceForPlan, priceForCreditPack } from '../_lib/stripe.js';

async function ensureCustomer(admin, stripe, user) {
  const { data: subscription } = await admin
    .from('subscriptions')
    .select('stripe_customer_id,stripe_subscription_id,plan,status')
    .eq('user_id', user.id)
    .maybeSingle();

  let customerId = subscription?.stripe_customer_id || null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      ...(user.email ? { email: user.email } : {}),
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;

    const { error } = await admin.from('subscriptions').upsert(
      {
        user_id: user.id,
        plan: subscription?.plan || 'free',
        status: subscription?.status || 'active',
        stripe_customer_id: customerId,
      },
      { onConflict: 'user_id' },
    );
    if (error) throw error;
  }

  return { customerId, subscription };
}

export async function POST(request) {
  try {
    const token = bearerToken(request);
    if (!token) return json({ error: 'Sign in first.' }, 401);

    const user = await verifyAccessToken(token);
    if (!user) return json({ error: 'Your session expired. Sign in again.' }, 401);

    const body = await readJson(request);
    const stripe = stripeClient();
    const admin = adminClient();
    const base = appUrl();

    // One-time Zev credit checkout. Kept in this endpoint so Hobby deployments
    // stay within Vercel's Serverless Function count limit.
    const requestedPack = String(body?.pack || '');
    if (['10', '25', '50'].includes(requestedPack)) {
      const priceId = priceForCreditPack(requestedPack);
      if (!priceId) return json({ error: `$${requestedPack} credit checkout is not configured.` }, 503);

      const { customerId } = await ensureCustomer(admin, stripe, user);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        allow_promotion_codes: true,
        client_reference_id: user.id,
        metadata: {
          supabase_user_id: user.id,
          credit_pack_usd: requestedPack,
        },
        payment_intent_data: {
          metadata: {
            supabase_user_id: user.id,
            credit_pack_usd: requestedPack,
          },
        },
        success_url: `${base}/account?credits=success#credits`,
        cancel_url: `${base}/account?credits=cancelled#credits`,
      });

      if (!session.url) throw new Error('Stripe did not return a Checkout URL.');
      return json({ url: session.url });
    }

    // Subscription checkout.
    const plan = body?.plan === 'team' ? 'team' : body?.plan === 'pro' ? 'pro' : null;
    if (!plan) return json({ error: 'Invalid checkout request.' }, 400);

    const priceId = priceForPlan(plan);
    if (!priceId) return json({ error: `${plan} Stripe price is not configured.` }, 503);

    const { customerId, subscription } = await ensureCustomer(admin, stripe, user);
    const alreadyPaid = ['pro', 'team'].includes(subscription?.plan)
      && ['active', 'trialing', 'past_due'].includes(subscription?.status);

    if (alreadyPaid && customerId) {
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${base}/account`,
      });
      return json({ url: portal.url, portal: true });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      client_reference_id: user.id,
      metadata: { supabase_user_id: user.id, plan },
      subscription_data: { metadata: { supabase_user_id: user.id, plan } },
      success_url: `${base}/account?checkout=success`,
      cancel_url: `${base}/pricing?checkout=cancelled`,
    });

    if (!session.url) throw new Error('Stripe did not return a Checkout URL.');
    return json({ url: session.url });
  } catch (error) {
    console.error('[stripe/create-checkout]', error);
    return json({ error: error?.message || 'Checkout is unavailable.' }, 500);
  }
}

export function GET() {
  return methodNotAllowed();
}
