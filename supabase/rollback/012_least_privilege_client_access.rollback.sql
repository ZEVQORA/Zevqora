-- Rollback for 012_least_privilege_client_access.sql.
--
-- Restores the exact pre-012 privilege and policy state captured from
-- production on 2026-09-24 (every public table granted ALL to anon and
-- authenticated through default privileges; profiles_update_own and
-- profiles_select_shared_workspace present; policies using bare auth.uid()).
--
-- WARNING: this reopens the self-unsuspend hole (users can write
-- profiles.suspended_at). Use only if 012 breaks a legitimate workflow, and
-- re-apply a fixed 012 as soon as possible.
--
-- The covering indexes added by 012 are harmless and are kept; the DROP
-- statements at the bottom are commented out.

begin;

-- 1. Table and sequence privileges as they were.
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated;

-- 2. Dropped policies.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists profiles_select_shared_workspace on public.profiles;
create policy profiles_select_shared_workspace on public.profiles for select to authenticated
  using (public.shares_workspace_with(id));

-- 3. Original policy expressions (bare auth.uid()).
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using (auth.uid() = id);
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions for select to authenticated using (auth.uid() = user_id);
drop policy if exists credit_balances_select_own on public.credit_balances;
create policy credit_balances_select_own on public.credit_balances for select to authenticated using (auth.uid() = user_id);
drop policy if exists admin_roles_select_self on public.admin_roles;
create policy admin_roles_select_self on public.admin_roles for select to authenticated using (user_id = auth.uid());
drop policy if exists usage_events_select_member on public.usage_events;
create policy usage_events_select_member on public.usage_events for select to authenticated
  using (user_id = auth.uid() or (workspace_id is not null and public.is_workspace_member(workspace_id)));
drop policy if exists credit_ledger_select_own on public.credit_ledger;
create policy credit_ledger_select_own on public.credit_ledger for select to authenticated using (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['engine_products','engine_ai_calls','engine_findings','engine_traces','engine_plans','engine_executions','engine_evaluations','engine_implementations'] loop
    execute format('drop policy if exists %I on public.%I', t || '_member_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id, auth.uid()))', t || '_member_select', t);
  end loop;
end $$;

commit;

-- Optional: drop the indexes 012 added.
-- drop index if exists public.admin_audit_log_admin_idx, public.admin_roles_granted_by_idx,
--   public.analysis_runs_workspace_idx, public.analysis_runs_created_by_idx, public.connections_created_by_idx,
--   public.connections_revoked_by_idx, public.credit_ledger_actor_idx, public.credit_ledger_workspace_idx,
--   public.desktop_auth_handoffs_user_idx, public.engine_ai_calls_workspace_idx, public.engine_evaluations_workspace_idx,
--   public.engine_evaluations_candidate_execution_idx, public.engine_executions_workspace_idx,
--   public.engine_executions_candidate_plan_idx, public.engine_findings_workspace_idx,
--   public.engine_implementations_workspace_idx, public.engine_implementations_created_by_idx,
--   public.engine_plans_workspace_idx, public.engine_products_project_idx, public.engine_products_created_by_idx,
--   public.engine_traces_workspace_idx, public.evaluation_cases_telemetry_event_idx, public.experiments_created_by_idx,
--   public.feature_flags_updated_by_idx, public.model_pricing_updated_by_idx, public.opportunities_analysis_run_idx,
--   public.plans_updated_by_idx, public.projects_created_by_idx, public.site_content_updated_by_idx,
--   public.telemetry_events_connection_idx, public.usage_events_project_idx, public.workspace_invites_accepted_by_idx,
--   public.workspace_invites_invited_by_idx, public.workspace_invites_workspace_idx, public.workspace_members_invited_by_idx;
