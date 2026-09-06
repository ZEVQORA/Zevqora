import { on } from '../router.js';
import { ApiError } from '../http.js';
import { adminClient } from '../supabase.js';

/**
 * Daily maintenance:
 *  1. Reset credit periods that Stripe does not manage (free and admin-assigned plans).
 *  2. Purge telemetry beyond each workspace's retention (plan ceiling, workspace setting).
 *  3. Drop expired desktop handoffs and invites.
 */
on('GET', '/api/cron/daily', async ({ request }) => {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) throw new ApiError(401, 'Unauthorized.', 'UNAUTHORIZED');
  const admin = adminClient();
  const now = new Date();
  const next = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Credit resets.
  const { data: plans } = await admin.from('plans').select('id,limits');
  const creditsFor = (planId) => {
    const p = (plans || []).find((x) => x.id === planId);
    const v = Number(p?.limits?.credits_usd);
    return Number.isFinite(v) ? v : 5;
  };
  const { data: subs } = await admin.from('subscriptions').select('user_id,plan,stripe_subscription_id,status');
  const selfManaged = (subs || []).filter((s) => !s.stripe_subscription_id);
  let resets = 0;
  if (selfManaged.length) {
    const ids = selfManaged.map((s) => s.user_id);
    const { data: expired } = await admin.from('credit_balances').select('user_id,included_usd,used_usd').in('user_id', ids).lte('period_end', now.toISOString());
    for (const row of expired || []) {
      const sub = selfManaged.find((s) => s.user_id === row.user_id);
      const included = creditsFor(sub?.plan || 'free');
      const { error } = await admin
        .from('credit_balances')
        .update({ included_usd: included, used_usd: 0, period_start: now.toISOString(), period_end: next, updated_at: now.toISOString() })
        .eq('user_id', row.user_id);
      if (!error) {
        resets += 1;
        await admin.from('credit_ledger').insert({
          user_id: row.user_id,
          kind: 'reset',
          delta_usd: Number(row.used_usd || 0),
          included_before: row.included_usd,
          included_after: included,
          used_before: row.used_usd,
          used_after: 0,
          reason: `Monthly reset (${sub?.plan || 'free'} plan)`,
        });
      }
    }
  }

  // 2. Telemetry retention.
  const { data: workspaces } = await admin.from('workspaces').select('id,data_retention_days,plan_override,owner_id');
  let purged = 0;
  for (const ws of workspaces || []) {
    const { data: planId } = await admin.rpc('workspace_plan', { ws: ws.id });
    const plan = (plans || []).find((p) => p.id === planId);
    const planDays = Number(plan?.limits?.telemetry_retention_days) || 30;
    const days = Math.min(planDays, Number(ws.data_retention_days) || planDays);
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await admin.from('telemetry_events').delete({ count: 'exact' }).eq('workspace_id', ws.id).lt('occurred_at', cutoff);
    purged += count || 0;
  }

  // 3. Expired artefacts.
  await admin.from('desktop_auth_handoffs').delete().lt('expires_at', new Date(now.getTime() - 10 * 60 * 1000).toISOString());
  await admin.from('workspace_invites').delete().is('accepted_at', null).lt('expires_at', now.toISOString());

  return { ok: true, creditResets: resets, telemetryPurged: purged };
});
