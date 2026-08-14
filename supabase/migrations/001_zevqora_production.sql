-- ZEVQORA Production v1
-- Account, subscription, credit and short-lived desktop browser-auth handoff state.

create extension if not exists pgcrypto;

do $$
begin
  create type public.billing_plan as enum ('free', 'pro', 'team', 'enterprise');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan public.billing_plan not null default 'free',
  status text not null default 'active',
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_stripe_customer_idx
  on public.subscriptions(stripe_customer_id);

create table if not exists public.credit_balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  included_usd numeric(10,2) not null default 5,
  used_usd numeric(10,2) not null default 0,
  period_start timestamptz not null default now(),
  period_end timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_nonnegative check (included_usd >= 0 and used_usd >= 0)
);

-- Server-only, encrypted, 90-second browser -> desktop auth handoff rows.
create table if not exists public.desktop_auth_handoffs (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  state_hash text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  tag text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists desktop_auth_handoffs_expires_idx
  on public.desktop_auth_handoffs(expires_at);

alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.credit_balances enable row level security;
alter table public.desktop_auth_handoffs enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists credit_balances_select_own on public.credit_balances;
create policy credit_balances_select_own on public.credit_balances
  for select to authenticated using (auth.uid() = user_id);

-- Intentionally no client policy for desktop_auth_handoffs.
-- Only service_role/server code should read or write these rows.

grant select, update on public.profiles to authenticated;
grant select on public.subscriptions to authenticated;
grant select on public.credit_balances to authenticated;
grant all on public.profiles, public.subscriptions, public.credit_balances, public.desktop_auth_handoffs to service_role;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists credit_balances_set_updated_at on public.credit_balances;
create trigger credit_balances_set_updated_at
before update on public.credit_balances
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1)
    )
  )
  on conflict (id) do update set email = excluded.email;

  insert into public.subscriptions(user_id, plan, status)
  values (new.id, 'free', 'active')
  on conflict (user_id) do nothing;

  insert into public.credit_balances(user_id, included_usd, used_usd)
  values (new.id, 5, 0)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Optional cleanup helper for old, already-used handoff rows.
create or replace function public.cleanup_desktop_auth_handoffs()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.desktop_auth_handoffs
  where expires_at < now() - interval '10 minutes'
     or used_at < now() - interval '10 minutes';
$$;

revoke all on function public.cleanup_desktop_auth_handoffs() from public, anon, authenticated;
