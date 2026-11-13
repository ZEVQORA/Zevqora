-- 021: durable, cross-instance rate limits for public (signed-out) endpoints.
--
-- The homepage Ask Zev composer (POST /api/support/message) is public. An
-- in-memory counter only protects one warm serverless instance, so the route
-- also counts hits here, shared by every instance.
--
-- Privacy: a bucket key is an opaque string built by the server, e.g.
-- `support:ip:<hmac>:m`. The server hashes the client address with a secret
-- before it gets here; no raw IP, prompt, message or user id is stored. Rows
-- hold only a counter and the start of its window, and stale rows are pruned.
--
-- Access: the table has RLS on and no policies, and only service_role may run
-- the function. anon and authenticated cannot read, write or call anything.
--
-- When this migration is not applied the route keeps working: FAQ answers are
-- served behind the in-memory limit, and generative answers stay off (the
-- route fails closed on cost).
--
-- Idempotent. Rollback: supabase/rollback/021_public_support_rate_limits.rollback.sql.

create table if not exists public.public_rate_limits (
  bucket text primary key check (length(bucket) between 1 and 128),
  window_start timestamptz not null default now(),
  hits integer not null default 0 check (hits >= 0)
);

alter table public.public_rate_limits enable row level security;
revoke all on table public.public_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.public_rate_limits to service_role;

create index if not exists public_rate_limits_window_idx on public.public_rate_limits (window_start);

-- Counts one hit in a fixed window and says whether it is within the limit.
-- The upsert is a single statement, so concurrent instances cannot both read
-- a stale count.
create or replace function public.public_rate_limit_hit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hits integer;
begin
  if p_bucket is null or length(p_bucket) < 1 or length(p_bucket) > 128
     or p_limit is null or p_limit < 1
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 604800 then
    raise exception 'RATE_LIMIT_ARGS: invalid rate limit arguments' using errcode = '22023';
  end if;

  insert into public.public_rate_limits as r (bucket, window_start, hits)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update set
    hits = case when r.window_start <= now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start <= now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;

  -- Occasional pruning keeps the table small without a cron job.
  if random() < 0.02 then
    delete from public.public_rate_limits where window_start < now() - interval '8 days';
  end if;

  return v_hits <= p_limit;
end;
$$;

revoke all on function public.public_rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.public_rate_limit_hit(text, integer, integer) to service_role;
