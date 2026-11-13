-- 022: durable spend budgets for paid model calls (Engineering Zev on Claude).
--
-- A request count is not a money limit. Each paid call reserves its worst-case
-- cost in micro-USD before it is sent and is reconciled to the measured cost
-- afterwards. Counters are shared by every serverless instance, keyed by opaque
-- bucket names built on the server (e.g. `engzev:usd:ws:<uuid>:<day>`,
-- `engzev:usd:platform:<day>`), and hold only a number and a window start.
--
-- usage_budget_reserve(bucket, amount, limit, window):
--   amount > 0  → adds it only if the window total stays within the limit;
--                 returns false (and adds nothing) otherwise.
--   amount <= 0 → a reconciliation refund; always applied, floored at 0.
-- The row is locked for the read-modify-write, so concurrent reservations
-- cannot both pass the same remaining budget.
--
-- Access: RLS on with no policies; only service_role may read, write or call.
-- Without this migration the server makes no paid Claude call (fails closed).
--
-- Idempotent. Rollback: supabase/rollback/022_usage_budget_counters.rollback.sql.

create table if not exists public.usage_budget_counters (
  bucket text primary key check (length(bucket) between 1 and 128),
  window_start timestamptz not null default now(),
  spent_micro_usd bigint not null default 0 check (spent_micro_usd >= 0)
);

alter table public.usage_budget_counters enable row level security;
revoke all on table public.usage_budget_counters from public, anon, authenticated;
grant select, insert, update, delete on table public.usage_budget_counters to service_role;

create or replace function public.usage_budget_reserve(p_bucket text, p_amount_micro_usd bigint, p_limit_micro_usd bigint, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_spent bigint;
  v_start timestamptz;
begin
  if p_bucket is null or length(p_bucket) < 1 or length(p_bucket) > 128
     or p_amount_micro_usd is null or abs(p_amount_micro_usd) > 1000000000000
     or p_limit_micro_usd is null or p_limit_micro_usd < 0
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 2678400 then
    raise exception 'BUDGET_ARGS: invalid budget arguments' using errcode = '22023';
  end if;

  insert into public.usage_budget_counters (bucket) values (p_bucket) on conflict (bucket) do nothing;
  select spent_micro_usd, window_start into v_spent, v_start
    from public.usage_budget_counters where bucket = p_bucket for update;

  if v_start <= now() - make_interval(secs => p_window_seconds) then
    v_spent := 0;
    v_start := now();
  end if;

  if p_amount_micro_usd > 0 and v_spent + p_amount_micro_usd > p_limit_micro_usd then
    update public.usage_budget_counters set spent_micro_usd = v_spent, window_start = v_start where bucket = p_bucket;
    return false;
  end if;

  update public.usage_budget_counters
     set spent_micro_usd = greatest(0, v_spent + p_amount_micro_usd), window_start = v_start
   where bucket = p_bucket;

  if random() < 0.02 then
    delete from public.usage_budget_counters where window_start < now() - interval '40 days';
  end if;
  return true;
end;
$$;

revoke all on function public.usage_budget_reserve(text, bigint, bigint, integer) from public, anon, authenticated;
grant execute on function public.usage_budget_reserve(text, bigint, bigint, integer) to service_role;
