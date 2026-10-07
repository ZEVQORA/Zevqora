-- Role-switched RLS / privilege regression check.
--
-- Safe to run against production: the block ALWAYS ends in RAISE EXCEPTION,
-- so every statement it ran (including any write that wrongly succeeded) is
-- rolled back. Read the verdict from the error message:
--   RLS_CHECK PASS (n checks) ...    everything held
--   RLS_CHECK FAIL (k of n) ...      lists each failed expectation
--
-- Needs at least one workspace member. Workspace isolation checks also need a
-- second workspace the chosen user does not belong to; they are skipped (and
-- reported as skipped) otherwise.
--
-- Run: paste into the Supabase SQL editor, or via the Supabase MCP execute_sql.

do $$
declare
  uid uuid;
  ws_own uuid;
  ws_other uuid;
  other_uid uuid;
  own_projects int;
  n int;
  ok boolean;
  checks int := 0;
  fails text[] := array[]::text[];
  notes text[] := array[]::text[];
begin
  select m.user_id, m.workspace_id into uid, ws_own from public.workspace_members m order by m.created_at limit 1;
  if uid is null then raise exception 'RLS_CHECK SKIP: no workspace members to test as'; end if;
  select w.id into ws_other from public.workspaces w where not exists (select 1 from public.workspace_members m where m.workspace_id = w.id and m.user_id = uid) limit 1;
  select m.user_id into other_uid from public.workspace_members m where m.user_id <> uid limit 1;
  select count(*) into own_projects from public.projects where workspace_id = ws_own;

  -- ---------------------------------------------------------------- authenticated
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- Server-controlled profile fields must not be writable by the user.
  checks := checks + 1;
  begin
    update public.profiles set suspended_at = null, suspended_reason = null where id = uid;
    get diagnostics n = row_count;
    if n > 0 then fails := array_append(fails, 'authenticated can UPDATE own profiles.suspended_at'); end if;
  exception when insufficient_privilege then null; end;

  checks := checks + 1;
  begin
    update public.profiles set email = 'spoof@example.invalid', username = 'spoofed' where id = uid;
    get diagnostics n = row_count;
    if n > 0 then fails := array_append(fails, 'authenticated can UPDATE own profiles.email/username'); end if;
  exception when insufficient_privilege then null; end;

  checks := checks + 1;
  begin
    update public.credit_balances set included_usd = 999999 where user_id = uid;
    get diagnostics n = row_count;
    if n > 0 then fails := array_append(fails, 'authenticated can UPDATE own credit_balances'); end if;
  exception when insufficient_privilege then null; end;

  checks := checks + 1;
  begin
    update public.subscriptions set plan = 'enterprise' where user_id = uid;
    get diagnostics n = row_count;
    if n > 0 then fails := array_append(fails, 'authenticated can UPDATE own subscription plan'); end if;
  exception when insufficient_privilege then null; end;

  if ws_other is not null then
    checks := checks + 1;
    begin
      insert into public.workspace_members(workspace_id, user_id, role) values (ws_other, uid, 'owner');
      fails := array_append(fails, 'authenticated can INSERT itself into another workspace');
    exception when insufficient_privilege or check_violation or others then
      if sqlstate not in ('42501') then notes := array_append(notes, ('workspace_members insert blocked by ' || sqlstate)); end if;
    end;
  end if;

  checks := checks + 1;
  begin
    insert into public.admin_roles(user_id, role) values (uid, 'superadmin');
    fails := array_append(fails, 'authenticated can INSERT into admin_roles');
  exception when others then
    if sqlstate not in ('42501') then notes := array_append(notes, ('admin_roles insert blocked by ' || sqlstate)); end if;
  end;

  -- Legitimate reads still work.
  checks := checks + 1;
  begin
    select count(*) into n from public.profiles where id = uid;
    if n <> 1 then fails := array_append(fails, ('own profile read returned ' || n || ' rows, expected 1')); end if;
  exception when insufficient_privilege then fails := array_append(fails, 'own profile read denied'); end;

  checks := checks + 1;
  begin
    select count(*) into n from public.projects where workspace_id = ws_own;
    if n <> own_projects then fails := array_append(fails, ('own workspace projects visible=' || n || ', expected ' || own_projects)); end if;
  exception when insufficient_privilege then fails := array_append(fails, 'own workspace projects read denied'); end;

  checks := checks + 1;
  begin
    select count(*) into n from public.workspaces where id = ws_own;
    if n <> 1 then fails := array_append(fails, 'own workspace not visible'); end if;
  exception when insufficient_privilege then fails := array_append(fails, 'own workspace read denied'); end;

  -- Workspace isolation.
  if ws_other is not null then
    checks := checks + 1;
    select count(*) into n from public.workspaces where id = ws_other;
    if n <> 0 then fails := array_append(fails, 'foreign workspace row visible'); end if;
    checks := checks + 1;
    select count(*) into n from public.projects where workspace_id = ws_other;
    if n <> 0 then fails := array_append(fails, 'foreign workspace projects visible'); end if;
    checks := checks + 1;
    select count(*) into n from public.experiments where workspace_id = ws_other;
    if n <> 0 then fails := array_append(fails, 'foreign workspace experiments visible'); end if;
  else
    notes := array_append(notes, 'isolation checks skipped: only one workspace');
  end if;

  if other_uid is not null then
    checks := checks + 1;
    select public.is_workspace_member(coalesce(ws_other, ws_own), other_uid) into ok;
    if ok then fails := array_append(fails, 'is_workspace_member answers about another user'); end if;
  end if;

  -- Server-only tables are unreadable from the browser role.
  checks := checks + 1;
  begin perform 1 from public.connection_secrets limit 1; get diagnostics n = row_count; if n > 0 then fails := array_append(fails, 'connection_secrets readable'); end if; exception when insufficient_privilege then null; end;
  checks := checks + 1;
  begin perform 1 from public.desktop_auth_handoffs limit 1; get diagnostics n = row_count; if n > 0 then fails := array_append(fails, 'desktop_auth_handoffs readable'); end if; exception when insufficient_privilege then null; end;
  checks := checks + 1;
  begin perform 1 from public.admin_audit_log limit 1; get diagnostics n = row_count; if n > 0 then fails := array_append(fails, 'admin_audit_log readable'); end if; exception when insufficient_privilege then null; end;
  checks := checks + 1;
  begin perform 1 from public.engine_traces limit 1; fails := array_append(fails, 'engine_traces directly readable (recorded prompts)'); exception when insufficient_privilege then null; end;

  -- ZevIR (016): members read their workspace's graph rows, write nothing,
  -- cannot see ingest runs or call the server functions. Dynamic SQL so this
  -- script still runs before 016 is applied.
  if to_regclass('public.zevir_graphs') is null then
    notes := array_append(notes, 'zevir checks skipped: migration 016 not applied');
  else
    checks := checks + 1;
    begin
      execute 'delete from public.zevir_nodes where workspace_id = $1' using ws_own;
      get diagnostics n = row_count;
      if n > 0 then fails := array_append(fails, 'authenticated can DELETE zevir_nodes'); end if;
    exception when insufficient_privilege then null; end;

    checks := checks + 1;
    begin
      execute 'insert into public.zevir_graphs(id, workspace_id, schema_version, adapter_version, source_kind, graph_key, status, node_count, edge_count, graph_hash) values (gen_random_uuid(), $1, ''zevir.v0.1'', ''x'', ''otel_genai'', ''rls-check'', ''complete'', 0, 0, repeat(''0'', 64))' using ws_own;
      fails := array_append(fails, 'authenticated can INSERT zevir_graphs');
    exception when insufficient_privilege then null; end;

    checks := checks + 1;
    begin
      execute 'select count(*) from public.zevir_ingest_runs' into n;
      fails := array_append(fails, 'zevir_ingest_runs directly readable');
    exception when insufficient_privilege then null; end;

    checks := checks + 1;
    begin
      execute 'select public.zevir_persist_graphs(''[]''::jsonb)';
      fails := array_append(fails, 'authenticated can execute zevir_persist_graphs');
    exception when insufficient_privilege then null; end;

    if ws_other is not null then
      checks := checks + 1;
      execute 'select count(*) from public.zevir_graphs where workspace_id = $1' into n using ws_other;
      if n <> 0 then fails := array_append(fails, 'foreign workspace zevir_graphs visible'); end if;
      checks := checks + 1;
      execute 'select count(*) from public.zevir_nodes where workspace_id = $1' into n using ws_other;
      if n <> 0 then fails := array_append(fails, 'foreign workspace zevir_nodes visible'); end if;
    end if;

    checks := checks + 1;
    begin
      execute 'select count(*) from public.zevir_graphs where workspace_id = $1' into n using ws_own;
    exception when insufficient_privilege then fails := array_append(fails, 'own workspace zevir_graphs read denied'); end;
  end if;

  -- Any remaining browser write privilege on any public table.
  checks := checks + 1;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r'
     and (has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE')
       or has_table_privilege('authenticated', c.oid, 'DELETE') or has_table_privilege('authenticated', c.oid, 'TRUNCATE')
       or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE')
       or has_table_privilege('anon', c.oid, 'DELETE') or has_table_privilege('anon', c.oid, 'TRUNCATE'));
  if n > 0 then fails := array_append(fails, (n || ' public tables still writable by anon/authenticated')); end if;

  -- ------------------------------------------------------------------------ anon
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);

  checks := checks + 1;
  begin select count(*) into n from public.plans; if n = 0 then fails := array_append(fails, 'anon sees no plans (pricing page would be empty)'); end if;
  exception when insufficient_privilege then fails := array_append(fails, 'anon cannot read plans'); end;
  checks := checks + 1;
  begin perform 1 from public.site_content limit 1;
  exception when insufficient_privilege then fails := array_append(fails, 'anon cannot read site_content'); end;
  checks := checks + 1;
  begin perform 1 from public.profiles limit 1; get diagnostics n = row_count; if n > 0 then fails := array_append(fails, 'anon can read profiles'); end if;
  exception when insufficient_privilege then null; end;

  -- ---------------------------------------------------------------- service_role
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);

  checks := checks + 1;
  begin
    update public.profiles set suspended_at = suspended_at where id = uid;
    get diagnostics n = row_count;
    if n <> 1 then fails := array_append(fails, 'service_role profile update touched ' || n || ' rows'); end if;
  exception when others then fails := array_append(fails, ('service_role cannot update profiles: ' || sqlstate)); end;
  checks := checks + 1;
  begin perform 1 from public.connection_secrets limit 1;
  exception when others then fails := array_append(fails, ('service_role cannot read connection_secrets: ' || sqlstate)); end;
  checks := checks + 1;
  begin perform 1 from public.engine_traces limit 1;
  exception when others then fails := array_append(fails, ('service_role cannot read engine_traces: ' || sqlstate)); end;
  if to_regclass('public.zevir_graphs') is not null then
    checks := checks + 1;
    begin execute 'select count(*) from public.zevir_ingest_runs' into n;
    exception when others then fails := array_append(fails, ('service_role cannot read zevir_ingest_runs: ' || sqlstate)); end;
    checks := checks + 1;
    begin execute 'select public.zevir_persist_graphs(''[]''::jsonb)';
    exception when others then fails := array_append(fails, ('service_role cannot execute zevir_persist_graphs: ' || sqlstate)); end;
  end if;

  perform set_config('role', 'postgres', true);

  if array_length(fails, 1) is null then
    raise exception 'RLS_CHECK PASS (% checks)%', checks, coalesce(' | notes: ' || nullif(array_to_string(notes, '; '), ''), '');
  else
    raise exception 'RLS_CHECK FAIL (% of % checks): % %', array_length(fails, 1), checks, array_to_string(fails, ' | '), coalesce(' | notes: ' || nullif(array_to_string(notes, '; '), ''), '');
  end if;
end $$;
