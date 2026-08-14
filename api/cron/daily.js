import { adminClient } from '../_lib/supabase.js';

export async function GET(request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const admin = adminClient();
  const now = new Date();
  const next = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: freeUsers, error: freeError } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('plan', 'free');
  if (freeError) throw freeError;

  const ids = (freeUsers || []).map((row) => row.user_id);
  let reset = 0;
  if (ids.length) {
    const { data: expired, error: expiredError } = await admin
      .from('credit_balances')
      .select('user_id')
      .in('user_id', ids)
      .lte('period_end', now.toISOString());
    if (expiredError) throw expiredError;

    for (const row of expired || []) {
      const { error } = await admin
        .from('credit_balances')
        .update({
          included_usd: 5,
          used_usd: 0,
          period_start: now.toISOString(),
          period_end: next,
          updated_at: now.toISOString(),
        })
        .eq('user_id', row.user_id);
      if (!error) reset += 1;
    }
  }

  await admin
    .from('desktop_auth_handoffs')
    .delete()
    .lt('expires_at', new Date(now.getTime() - 10 * 60 * 1000).toISOString());

  return Response.json({ ok: true, freeCreditResets: reset });
}
