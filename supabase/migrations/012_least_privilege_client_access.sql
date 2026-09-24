-- Least-privilege browser access.
--
-- The browser (anon key + user JWT) only ever reads. Every write goes through
-- the server API with the service role, which re-checks workspace role, plan
-- limits and audit logging. Until now that was true by convention only:
-- Supabase's default privileges had granted anon/authenticated ALL on every
-- public table, and one write policy existed (profiles_update_own), which let
-- a suspended user clear profiles.suspended_at from supabase-js.
--
-- The client reads, directly, exactly these tables (src/app/data.ts,
-- src/lib/site.ts): projects, opportunities, experiments, evaluation_cases,
-- analysis_runs, connections, site_content, plans. Everything else is served
-- by the API. Own-row reads below are kept because they are harmless and
-- RLS-scoped; engine_* tables lose direct reads because they hold recorded
-- prompts (engine_traces) and generated code (engine_implementations) that
-- the API deliberately trims.
--
-- Idempotent. Safe to re-run.

-- 1. Remove every table privilege from the browser roles, then grant back
--    SELECT on what the client is meant to read.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.plans, public.site_content, public.model_pricing to anon, authenticated;

grant select on
  public.profiles, public.subscriptions, public.credit_balances, public.admin_roles,
  public.workspaces, public.workspace_members, public.workspace_invites,
  public.projects, public.connections, public.telemetry_events, public.analysis_runs,
  public.opportunities, public.experiments, public.evaluation_cases,
  public.usage_events, public.credit_ledger
to authenticated;

-- Server-only tables stay without any client grant (no policies by design):
-- admin_audit_log, connection_secrets, desktop_auth_handoffs, feature_flags,
-- engine_products, engine_ai_calls, engine_findings, engine_traces,
-- engine_plans, engine_executions, engine_evaluations, engine_implementations.

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- New tables created by migrations must not silently become client-writable.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

-- 2. Profiles are edited through PATCH /api/me only.
drop policy if exists profiles_update_own on public.profiles;

-- Teammate profiles are served by GET /api/workspaces/:id/members, which
-- returns only the fields a teammate needs. The direct policy exposed every
-- column (suspension reason, notification prefs, onboarding state).
drop policy if exists profiles_select_shared_workspace on public.profiles;

-- 3. Evaluate auth.uid() once per statement, not once per row.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid()) = id);

drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists credit_balances_select_own on public.credit_balances;
create policy credit_balances_select_own on public.credit_balances for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists admin_roles_select_self on public.admin_roles;
create policy admin_roles_select_self on public.admin_roles for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists usage_events_select_member on public.usage_events;
create policy usage_events_select_member on public.usage_events for select to authenticated
  using (user_id = (select auth.uid()) or (workspace_id is not null and public.is_workspace_member(workspace_id)));

drop policy if exists credit_ledger_select_own on public.credit_ledger;
create policy credit_ledger_select_own on public.credit_ledger for select to authenticated using (user_id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['engine_products','engine_ai_calls','engine_findings','engine_traces','engine_plans','engine_executions','engine_evaluations','engine_implementations'] loop
    execute format('drop policy if exists %I on public.%I', t || '_member_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id, (select auth.uid())))', t || '_member_select', t);
  end loop;
end $$;

-- 4. Covering indexes for foreign keys (advisor 0001).
create index if not exists admin_audit_log_admin_idx on public.admin_audit_log(admin_id);
create index if not exists admin_roles_granted_by_idx on public.admin_roles(granted_by);
create index if not exists analysis_runs_workspace_idx on public.analysis_runs(workspace_id, created_at desc);
create index if not exists analysis_runs_created_by_idx on public.analysis_runs(created_by);
create index if not exists connections_created_by_idx on public.connections(created_by);
create index if not exists connections_revoked_by_idx on public.connections(revoked_by);
create index if not exists credit_ledger_actor_idx on public.credit_ledger(actor_id);
create index if not exists credit_ledger_workspace_idx on public.credit_ledger(workspace_id);
create index if not exists desktop_auth_handoffs_user_idx on public.desktop_auth_handoffs(user_id);
create index if not exists engine_ai_calls_workspace_idx on public.engine_ai_calls(workspace_id);
create index if not exists engine_evaluations_workspace_idx on public.engine_evaluations(workspace_id);
create index if not exists engine_evaluations_candidate_execution_idx on public.engine_evaluations(candidate_execution_id);
create index if not exists engine_executions_workspace_idx on public.engine_executions(workspace_id);
create index if not exists engine_executions_candidate_plan_idx on public.engine_executions(candidate_plan_id);
create index if not exists engine_findings_workspace_idx on public.engine_findings(workspace_id);
create index if not exists engine_implementations_workspace_idx on public.engine_implementations(workspace_id);
create index if not exists engine_implementations_created_by_idx on public.engine_implementations(created_by);
create index if not exists engine_plans_workspace_idx on public.engine_plans(workspace_id);
create index if not exists engine_products_project_idx on public.engine_products(project_id);
create index if not exists engine_products_created_by_idx on public.engine_products(created_by);
create index if not exists engine_traces_workspace_idx on public.engine_traces(workspace_id);
create index if not exists evaluation_cases_telemetry_event_idx on public.evaluation_cases(telemetry_event_id);
create index if not exists experiments_created_by_idx on public.experiments(created_by);
create index if not exists feature_flags_updated_by_idx on public.feature_flags(updated_by);
create index if not exists model_pricing_updated_by_idx on public.model_pricing(updated_by);
create index if not exists opportunities_analysis_run_idx on public.opportunities(analysis_run_id);
create index if not exists plans_updated_by_idx on public.plans(updated_by);
create index if not exists projects_created_by_idx on public.projects(created_by);
create index if not exists site_content_updated_by_idx on public.site_content(updated_by);
create index if not exists telemetry_events_connection_idx on public.telemetry_events(connection_id);
create index if not exists usage_events_project_idx on public.usage_events(project_id);
create index if not exists workspace_invites_accepted_by_idx on public.workspace_invites(accepted_by);
create index if not exists workspace_invites_invited_by_idx on public.workspace_invites(invited_by);
create index if not exists workspace_invites_workspace_idx on public.workspace_invites(workspace_id);
create index if not exists workspace_members_invited_by_idx on public.workspace_members(invited_by);
