-- Role-switched check of the three SECURITY DEFINER RLS helpers the Supabase
-- advisor reports as callable by `authenticated` (lint 0029).
--
-- Safe on any project: the block ALWAYS ends in RAISE EXCEPTION, so nothing it
-- did persists. Read the verdict from the error message:
--   SD_CHECK PASS (n checks)
--   SD_CHECK FAIL (k of n checks): ...
--
-- Needs two distinct workspace members. Run in the SQL editor or via execute_sql.

do $$
declare
  me uuid; my_ws uuid; victim uuid; victim_ws uuid; b boolean; checks int := 0; fails text[] := array[]::text[];
begin
  select m.user_id, m.workspace_id into me, my_ws from public.workspace_members m order by m.created_at limit 1;
  select m.user_id, m.workspace_id into victim, victim_ws from public.workspace_members m where m.user_id <> me order by m.created_at limit 1;
  if me is null or victim is null then raise exception 'SD_CHECK SKIP: need two distinct workspace members'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', me, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  checks := checks + 1; select public.is_workspace_member(victim_ws, victim) into b; if b then fails := array_append(fails, 'is_workspace_member(victim_ws, victim) = true for another user'); end if;
  checks := checks + 1; select public.has_workspace_role(victim_ws, 'viewer', victim) into b; if b then fails := array_append(fails, 'has_workspace_role(victim_ws, viewer, victim) = true for another user'); end if;
  checks := checks + 1; select public.has_workspace_role(victim_ws, 'owner', victim) into b; if b then fails := array_append(fails, 'has_workspace_role(victim_ws, owner, victim) = true for another user'); end if;
  checks := checks + 1; select public.shares_workspace_with(me, victim) into b; if b then fails := array_append(fails, 'shares_workspace_with(me, victim) answered as victim'); end if;
  checks := checks + 1; select public.is_workspace_member(my_ws) into b; if not b then fails := array_append(fails, 'is_workspace_member(own ws) = false (RLS helper broken)'); end if;
  checks := checks + 1; select public.has_workspace_role(my_ws, 'viewer') into b; if not b then fails := array_append(fails, 'has_workspace_role(own ws, viewer) = false (RLS helper broken)'); end if;
  checks := checks + 1; begin perform public.workspace_role_of(victim_ws, victim); fails := array_append(fails, 'authenticated can execute workspace_role_of'); exception when insufficient_privilege then null; end;
  checks := checks + 1; begin perform public.is_admin(victim); fails := array_append(fails, 'authenticated can execute is_admin'); exception when insufficient_privilege then null; end;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
  checks := checks + 1; begin perform public.is_workspace_member(victim_ws, victim); fails := array_append(fails, 'anon can execute is_workspace_member (auth.uid() is null -> arbitrary uid oracle)'); exception when insufficient_privilege then null; end;
  checks := checks + 1; begin perform public.has_workspace_role(victim_ws, 'viewer', victim); fails := array_append(fails, 'anon can execute has_workspace_role'); exception when insufficient_privilege then null; end;
  checks := checks + 1; begin perform public.shares_workspace_with(me, victim); fails := array_append(fails, 'anon can execute shares_workspace_with'); exception when insufficient_privilege then null; end;

  perform set_config('role', 'postgres', true);
  if array_length(fails, 1) is null then raise exception 'SD_CHECK PASS (% checks)', checks;
  else raise exception 'SD_CHECK FAIL (% of % checks): %', array_length(fails, 1), checks, array_to_string(fails, ' | '); end if;
end $$;
