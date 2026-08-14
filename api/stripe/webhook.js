import { stripeClient, planFromPrice } from '../_lib/stripe.js';
import { adminClient } from '../_lib/supabase.js';

function response(text, status = 200) {
  return new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

async function findUserId(admin, stripe, customerId, metadataUserId) {
  if (metadataUserId) return metadataUserId;
  if (!customerId) return null;

  const { data: row } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (row?.user_id) return row.user_id;

  const customer = await stripe.customers.retrieve(customerId);
  if (!customer.deleted) return customer.metadata?.supabase_user_id || null;
  return null;
}

async function syncSubscription(admin, stripe, subscription) {
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id;
  const userId = await findUserId(
    admin,
    stripe,
    customerId,
    subscription.metadata?.supabase_user_id,
  );
  if (!userId) throw new Error(`No Supabase user is linked to Stripe customer ${customerId}.`);

  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id || null;
  const mappedPlan = planFromPrice(priceId);
  const entitled = ['active', 'trialing', 'past_due'].includes(subscription.status);
  const plan = entitled && mappedPlan ? mappedPlan : 'free';
  const includedUsd = plan === 'team' ? 75 : plan === 'pro' ? 20 : 5;
  const periodEndSeconds = item?.current_period_end || subscription.current_period_end || null;

  const { error: subError } = await admin.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      plan,
      status: subscription.status,
      price_id: priceId,
      current_period_end: periodEndSeconds
        ? new Date(periodEndSeconds * 1000).toISOString()
        : null,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (subError) throw subError;

  const { error: creditError } = await admin.from('credit_balances').upsert(
    {
      user_id: userId,
      included_usd: includedUsd,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (creditError) throw creditError;
}

export async function POST(request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return response('Stripe webhook is not configured.', 503);

  const signature = request.headers.get('stripe-signature');
  if (!signature) return response('Missing Stripe signature.', 400);

  const rawBody = await request.text();
  const stripe = stripeClient();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
  } catch (error) {
    console.error('[stripe/webhook] invalid signature', error);
    return response('Invalid signature.', 400);
  }

  const admin = adminClient();
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;
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
        const customerId =
          typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
        const userId = await findUserId(admin, stripe, customerId, null);
        if (userId) {
          await admin
            .from('credit_balances')
            .update({
              used_usd: 0,
              period_start: new Date().toISOString(),
              period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', userId);
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId =
          typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
        const userId = await findUserId(admin, stripe, customerId, null);
        if (userId) {
          await admin
            .from('subscriptions')
            .update({ status: 'past_due', updated_at: new Date().toISOString() })
            .eq('user_id', userId);
        }
        break;
      }
      default:
        break;
    }
  } catch (error) {
    console.error(`[stripe/webhook] ${event.type}`, error);
    return response('Webhook handling failed.', 500);
  }

  return response('ok');
}
