import { on } from '../router.js';
import { ApiError, readJson } from '../http.js';
import { adminClient } from '../supabase.js';
import { requireUser } from '../auth.js';
import { stripeClient, stripeConfigured, appUrl, priceForPlan, planFromPrice, includedCreditsForPlan } from '../stripe.js';

async function ensureCustomer(admin, stripe, user) {
  const { data: subscription } = await admin.from('subscriptions').select('stripe_customer_id,stripe_subscription_id,plan,status').eq('user_id', user.id).maybeSingle();
  let customerId = subscription?.stripe_customer_id || null;
  if (!customerId) {
    const customer = await stripe.customers.create({ ...(user.email ? { email: user.email } : {}), metadata: { supabase_user_id: user.id } });
    customerId = customer.id;
    const { error } = await admin.from('subscriptions').upsert(
      { user_id: user.id, plan: subscription?.plan || 'free', status: subscription?.status || 'active', stripe_customer_id: customerId },
      { onConflict: 'user_id' },
    );
    if (error) throw error;
  }
  return { customerId, subscription };
}

on('POST', '/api/stripe/create-checkout', async ({ request }) => {
  const { user, admin } = await requireUser(request);
  if (!stripeConfigured()) throw new ApiError(503, 'Self-serve checkout is not enabled on this deployment yet. Contact us to start a plan.', 'BILLING_NOT_CONFIGURED');
  const body = await readJson(request);
  const planId = typeof body?.plan === 'string' ? body.plan.toLowerCase() : '';
  const interval = body?.interval === 'annual' ? 'annual' : 'monthly';
  const { plan, priceId } = await priceForPlan(admin, planId, interval);
  if (!plan || !plan.visible || plan.contact_sales) throw new ApiError(400, 'That plan is not available for self-serve checkout.', 'PLAN_UNAVAILABLE');
  if (!priceId) throw new ApiError(503, `${plan.id} ${interval} pricing is not configured for checkout yet.`, 'PRICE_NOT_CONFIGURED');

  const stripe = stripeClient();
  const base = appUrl();
  const { customerId, subscription } = await ensureCustomer(admin, stripe, user);
  const alreadyPaid = subscription?.plan && subscription.plan !== 'free' && ['active', 'trialing', 'past_due'].includes(subscription?.status);
  if (alreadyPaid && subscription?.stripe_subscription_id && customerId) {
    const portal = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${base}/app/usage` });
    return { url: portal.url, portal: true };
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    client_reference_id: user.id,
    metadata: { supabase_user_id: user.id, plan: plan.id },
    subscription_data: { metadata: { supabase_user_id: user.id, plan: plan.id } },
    success_url: `${base}/app/usage?checkout=success`,
    cancel_url: `${base}/pricing?checkout=cancelled`,
  });
  if (!session.url) throw new Error('Stripe did not return a Checkout URL.');
  return { url: session.url };
});

on('POST', '/api/stripe/create-portal', async ({ request }) => {
  const { user, admin } = await requireUser(request);
  if (!stripeConfigured()) throw new ApiError(503, 'Billing portal is not enabled on this deployment yet.', 'BILLING_NOT_CONFIGURED');
  const { data: sub } = await admin.from('subscriptions').select('stripe_customer_id').eq('user_id', user.id).maybeSingle();
  if (!sub?.stripe_customer_id) throw new ApiError(409, 'No paid billing profile exists yet.', 'NO_BILLING_PROFILE');
  const stripe = stripeClient();
  const session = await stripe.billingPortal.sessions.create({ customer: sub.stripe_customer_id, return_url: `${appUrl()}/app/usage` });
  return { url: session.url };
});

function text(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

async function findUserId(admin, stripe, customerId, metadataUserId) {
  if (metadataUserId) return metadataUserId;
  if (!customerId) return null;
  const { data: row } = await admin.from('subscriptions').select('user_id').eq('stripe_customer_id', customerId).maybeSingle();
  if (row?.user_id) return row.user_id;
  const customer = await stripe.customers.retrieve(customerId);
  if (!customer.deleted) return customer.metadata?.supabase_user_id || null;
  return null;
}

async function syncSubscription(admin, stripe, subscription) {
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
  const userId = await findUserId(admin, stripe, customerId, subscription.metadata?.supabase_user_id);
  if (!userId) throw new Error(`No Supabase user is linked to Stripe customer ${customerId}.`);
  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id || null;
  const mappedPlan = await planFromPrice(admin, priceId);
  const entitled = ['active', 'trialing', 'past_due'].includes(subscription.status);
  const plan = entitled && mappedPlan ? mappedPlan : 'free';
  const includedUsd = await includedCreditsForPlan(admin, plan);
  const periodEndSeconds = item?.current_period_end || subscription.current_period_end || null;
  const { data: before } = await admin.from('credit_balances').select('included_usd,used_usd').eq('user_id', userId).maybeSingle();
  const { error: subError } = await admin.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      plan,
      status: subscription.status,
      price_id: priceId,
      current_period_end: periodEndSeconds ? new Date(periodEndSeconds * 1000).toISOString() : null,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (subError) throw subError;
  const { error: creditError } = await admin.from('credit_balances').upsert({ user_id: userId, included_usd: includedUsd, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (creditError) throw creditError;
  await admin.from('credit_ledger').insert({
    user_id: userId,
    kind: 'plan_change',
    delta_usd: includedUsd - Number(before?.included_usd ?? 0),
    included_before: before?.included_usd ?? null,
    included_after: includedUsd,
    used_before: before?.used_usd ?? null,
    used_after: before?.used_usd ?? null,
    reason: `Stripe subscription ${subscription.status} → ${plan}`,
    metadata: { stripe_subscription_id: subscription.id, price_id: priceId },
  });
}

on('POST', '/api/stripe/webhook', async ({ request }) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return text('Stripe webhook is not configured.', 503);
  const signature = request.headers.get('stripe-signature');
  if (!signature) return text('Missing Stripe signature.', 400);
  const rawBody = await request.text();
  const stripe = stripeClient();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
  } catch (error) {
    console.error('[stripe/webhook] invalid signature', error?.message);
    return text('Invalid signature.', 400);
  }
  const admin = adminClient();
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          await syncSubscription(admin, stripe, subscription);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(admin, stripe, event.data.object);
        break;
      case 'invoice.paid': {
        const invoice = event.data.object;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
        const userId = await findUserId(admin, stripe, customerId, null);
        if (userId) {
          const { data: before } = await admin.from('credit_balances').select('included_usd,used_usd').eq('user_id', userId).maybeSingle();
          await admin
            .from('credit_balances')
            .update({ used_usd: 0, period_start: new Date().toISOString(), period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), updated_at: new Date().toISOString() })
            .eq('user_id', userId);
          await admin.from('credit_ledger').insert({
            user_id: userId,
            kind: 'reset',
            delta_usd: Number(before?.used_usd ?? 0),
            included_before: before?.included_usd ?? null,
            included_after: before?.included_usd ?? null,
            used_before: before?.used_usd ?? null,
            used_after: 0,
            reason: 'Billing period renewed (Stripe invoice paid)',
            metadata: { invoice_id: invoice.id },
          });
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
        const userId = await findUserId(admin, stripe, customerId, null);
        if (userId) await admin.from('subscriptions').update({ status: 'past_due', updated_at: new Date().toISOString() }).eq('user_id', userId);
        break;
      }
      default:
        break;
    }
  } catch (error) {
    console.error(`[stripe/webhook] ${event.type}`, error?.message);
    return text('Webhook handling failed.', 500);
  }
  return text('ok');
});
