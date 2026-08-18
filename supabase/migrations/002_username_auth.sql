-- Username support for ZEVQORA web sign-up and username-or-email sign-in.
-- Server-side username resolution stays behind the service-role API.

alter table public.profiles add column if not exists username text;

-- Give existing users deterministic, safe usernames. UUID suffixes avoid collisions.
with candidates as (
  select
    id,
    lower(
      regexp_replace(
        coalesce(nullif(display_name, ''), split_part(coalesce(email, ''), '@', 1), 'user'),
        '[^A-Za-z0-9._-]+', '-', 'g'
      )
    ) as base
  from public.profiles
  where username is null or btrim(username) = ''
), normalized as (
  select
    id,
    case
      when length(trim(both '-._' from base)) >= 3
        then left(trim(both '-._' from base), 22)
      else 'user'
    end as base
  from candidates
)
update public.profiles p
set username = n.base || '-' || left(replace(p.id::text, '-', ''), 6)
from normalized n
where p.id = n.id;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_username_format'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_username_format
      check (username is null or username ~ '^[A-Za-z0-9._-]{3,30}$') not valid;
  end if;
end $$;

alter table public.profiles validate constraint profiles_username_format;
create unique index if not exists profiles_username_lower_uidx on public.profiles (lower(username));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested text;
  fallback text;
  chosen text;
begin
  requested := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  requested := trim(both '-._' from regexp_replace(requested, '[^A-Za-z0-9._-]+', '-', 'g'));

  fallback := lower(split_part(coalesce(new.email, ''), '@', 1));
  fallback := trim(both '-._' from regexp_replace(fallback, '[^A-Za-z0-9._-]+', '-', 'g'));

  if requested ~ '^[A-Za-z0-9._-]{3,30}$' then
    chosen := requested;
  elsif fallback ~ '^[A-Za-z0-9._-]{3,22}$' then
    chosen := fallback;
  else
    chosen := 'user';
  end if;

  if exists (select 1 from public.profiles where lower(username) = lower(chosen)) then
    if requested ~ '^[A-Za-z0-9._-]{3,30}$' then
      raise exception 'Username is already taken' using errcode = '23505';
    end if;
    chosen := left(chosen, 22) || '-' || left(replace(new.id::text, '-', ''), 6);
  end if;

  insert into public.profiles(id, email, username, display_name)
  values (
    new.id,
    new.email,
    chosen,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', chosen)
  )
  on conflict (id) do update
  set email = excluded.email,
      username = coalesce(public.profiles.username, excluded.username),
      display_name = coalesce(public.profiles.display_name, excluded.display_name);

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
