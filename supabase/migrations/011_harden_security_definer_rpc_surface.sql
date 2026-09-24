-- Backfill: this migration was applied to the production project on
-- 2026-09-11 (version 20260911024539) but never committed. It is reproduced
-- here verbatim so the repository matches the live schema. Idempotent.

-- Harden SECURITY DEFINER helpers against direct RPC abuse while preserving RLS use.

-- Functions not required by RLS should not be callable directly by normal users.
revoke execute on function public.create_workspace(text,text) from authenticated;
revoke execute on function public.is_admin(uuid) from authenticated;
revoke execute on function public.project_workspace(uuid) from authenticated;
revoke execute on function public.workspace_plan(uuid) from authenticated;
revoke execute on function public.workspace_role_of(uuid,uuid) from authenticated;

-- RLS helper functions must remain executable by authenticated, but callers
-- may only ask about their own identity. service_role/postgres calls have no
-- end-user auth.uid() and retain their existing administrative behavior.
create or replace function public.is_workspace_member(ws uuid, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is not null and uid is distinct from auth.uid() then false
    else exists (
      select 1
      from public.workspace_members
      where workspace_id = ws and user_id = uid
    )
  end;
$$;

create or replace function public.has_workspace_role(ws uuid, min_role public.workspace_role, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is not null and uid is distinct from auth.uid() then false
    else coalesce(
      public.role_rank(public.workspace_role_of(ws, uid)) >= public.role_rank(min_role),
      false
    )
  end;
$$;

create or replace function public.shares_workspace_with(other uuid, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is not null and uid is distinct from auth.uid() then false
    else exists (
      select 1
      from public.workspace_members a
      join public.workspace_members b on a.workspace_id = b.workspace_id
      where a.user_id = uid and b.user_id = other
    )
  end;
$$;

-- Keep only the grants required by RLS helpers.
revoke all on function public.is_workspace_member(uuid,uuid) from public, anon;
revoke all on function public.has_workspace_role(uuid,public.workspace_role,uuid) from public, anon;
revoke all on function public.shares_workspace_with(uuid,uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid,uuid) to authenticated, service_role;
grant execute on function public.has_workspace_role(uuid,public.workspace_role,uuid) to authenticated, service_role;
grant execute on function public.shares_workspace_with(uuid,uuid) to authenticated, service_role;

-- Resolve mutable search_path warning on immutable helper.
alter function public.role_rank(public.workspace_role) set search_path = public;
