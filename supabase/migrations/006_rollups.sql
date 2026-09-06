-- Aggregation helpers so dashboards never pull raw telemetry into the browser.
-- Service-role only: the API checks workspace membership before calling them.

alter table public.telemetry_events
  add column if not exists has_sample boolean generated always as (sample is not null) stored;

create or replace function public.telemetry_rollup(p_projects uuid[], p_since timestamptz)
returns table (
  project_id uuid,
  provider text,
  model text,
  requests bigint,
  errors bigint,
  cost_usd numeric,
  cost_known bigint,
  input_tokens bigint,
  output_tokens bigint,
  latency_p50_ms numeric,
  latency_p95_ms numeric,
  samples bigint,
  last_seen timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    project_id,
    provider,
    model,
    count(*) as requests,
    count(*) filter (where status <> 'ok') as errors,
    coalesce(sum(cost_usd), 0) as cost_usd,
    count(cost_usd) as cost_known,
    coalesce(sum(input_tokens), 0) as input_tokens,
    coalesce(sum(output_tokens), 0) as output_tokens,
    percentile_cont(0.5) within group (order by latency_ms) as latency_p50_ms,
    percentile_cont(0.95) within group (order by latency_ms) as latency_p95_ms,
    count(*) filter (where has_sample) as samples,
    max(occurred_at) as last_seen
  from public.telemetry_events
  where project_id = any(p_projects) and occurred_at >= p_since
  group by project_id, provider, model;
$$;
revoke all on function public.telemetry_rollup(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.telemetry_rollup(uuid[], timestamptz) to service_role;

create or replace function public.telemetry_daily(p_projects uuid[], p_since timestamptz)
returns table (day date, requests bigint, errors bigint, cost_usd numeric, input_tokens bigint, output_tokens bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    (occurred_at at time zone 'utc')::date as day,
    count(*) as requests,
    count(*) filter (where status <> 'ok') as errors,
    coalesce(sum(cost_usd), 0) as cost_usd,
    coalesce(sum(input_tokens), 0) as input_tokens,
    coalesce(sum(output_tokens), 0) as output_tokens
  from public.telemetry_events
  where project_id = any(p_projects) and occurred_at >= p_since
  group by 1
  order by 1;
$$;
revoke all on function public.telemetry_daily(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.telemetry_daily(uuid[], timestamptz) to service_role;

create or replace function public.telemetry_recent_rate(p_projects uuid[], p_window interval)
returns table (requests bigint, errors bigint, cost_usd numeric, latency_p50_ms numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) as requests,
    count(*) filter (where status <> 'ok') as errors,
    coalesce(sum(cost_usd), 0) as cost_usd,
    percentile_cont(0.5) within group (order by latency_ms) as latency_p50_ms
  from public.telemetry_events
  where project_id = any(p_projects) and occurred_at >= now() - p_window;
$$;
revoke all on function public.telemetry_recent_rate(uuid[], interval) from public, anon, authenticated;
grant execute on function public.telemetry_recent_rate(uuid[], interval) to service_role;

create or replace function public.usage_rollup(p_workspace uuid, p_since timestamptz)
returns table (project_id uuid, operation text, provider text, credits_usd numeric, events bigint)
language sql
stable
security definer
set search_path = public
as $$
  select project_id, operation, provider, coalesce(sum(credits_usd), 0) as credits_usd, count(*) as events
  from public.usage_events
  where workspace_id = p_workspace and created_at >= p_since
  group by project_id, operation, provider;
$$;
revoke all on function public.usage_rollup(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.usage_rollup(uuid, timestamptz) to service_role;

create or replace function public.admin_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'users', (select count(*) from auth.users),
    'active_users_7d', (select count(*) from auth.users where last_sign_in_at >= now() - interval '7 days'),
    'new_users_30d', (select count(*) from auth.users where created_at >= now() - interval '30 days'),
    'suspended_users', (select count(*) from public.profiles where suspended_at is not null),
    'workspaces', (select count(*) from public.workspaces),
    'projects', (select count(*) from public.projects where archived_at is null),
    'connections_active', (select count(*) from public.connections where status = 'active'),
    'connections_live', (select count(*) from public.connections where status = 'active' and last_seen_at >= now() - interval '24 hours'),
    'subscriptions_paid', (select count(*) from public.subscriptions where plan <> 'free' and status in ('active', 'trialing', 'past_due')),
    'subscriptions_stripe', (select count(*) from public.subscriptions where stripe_subscription_id is not null and status in ('active', 'trialing')),
    'mrr_cents', (select coalesce(sum(p.monthly_price_cents), 0) from public.subscriptions s join public.plans p on p.id = s.plan::text where s.stripe_subscription_id is not null and s.status in ('active', 'trialing')),
    'credits_included', (select coalesce(sum(included_usd), 0) from public.credit_balances),
    'credits_used', (select coalesce(sum(used_usd), 0) from public.credit_balances),
    'usage_30d', (select coalesce(sum(credits_usd), 0) from public.usage_events where created_at >= now() - interval '30 days'),
    'provider_cost_30d', (select coalesce(sum(provider_cost_usd), 0) from public.experiments where created_at >= now() - interval '30 days'),
    'analysis_runs', (select count(*) from public.analysis_runs),
    'analysis_runs_30d', (select count(*) from public.analysis_runs where created_at >= now() - interval '30 days'),
    'experiments', (select count(*) from public.experiments),
    'experiments_passed', (select count(*) from public.experiments where status = 'passed'),
    'experiments_failed', (select count(*) from public.experiments where status = 'failed'),
    'experiments_error', (select count(*) from public.experiments where status = 'error'),
    'telemetry_events_24h', (select count(*) from public.telemetry_events where received_at >= now() - interval '24 hours'),
    'opportunities_open', (select count(*) from public.opportunities where status = 'open')
  );
$$;
revoke all on function public.admin_counts() from public, anon, authenticated;
grant execute on function public.admin_counts() to service_role;
