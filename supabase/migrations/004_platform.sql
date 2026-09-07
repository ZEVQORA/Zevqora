-- ZEVQORA platform v2
-- Workspaces, projects, connections, telemetry, analysis, opportunities,
-- experiments, evidence, usage/credits, plans, site content, feature flags,
-- admin roles and admin audit log.
--
-- Additive only. Existing tables (profiles, subscriptions, credit_balances,
-- desktop_auth_handoffs) are kept and extended, never dropped or reset.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.workspace_role as enum ('owner', 'admin', 'member', 'viewer');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Profiles: extend, never replace
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists timezone text;
alter table public.profiles add column if not exists notification_prefs jsonb not null default '{"experiment_completed": true, "weekly_summary": true}'::jsonb;
alter table public.profiles add column if not exists onboarding jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists suspended_at timestamptz;
alter table public.profiles add column if not exists suspended_reason text;
alter table public.profiles add column if not exists last_active_at timestamptz;

-- ---------------------------------------------------------------------------
-- Admin roles + audit log (service role only; users may read their own row)
-- ---------------------------------------------------------------------------
create table if not exists public.admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'superadmin')),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log(created_at desc);
create index if not exists admin_audit_log_target_idx on public.admin_audit_log(target_type, target_id);

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_roles where user_id = uid);
$$;
revoke all on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Workspaces + membership
-- ---------------------------------------------------------------------------
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan_override public.billing_plan,
  data_retention_days integer not null default 90 check (data_retention_days between 7 and 730),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workspaces_owner_idx on public.workspaces(owner_id);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'member',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_active_at timestamptz,
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user_idx on public.workspace_members(user_id);

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role public.workspace_role not null default 'member' check (role <> 'owner'),
  token_hash text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists workspace_invites_pending_uidx
  on public.workspace_invites(workspace_id, lower(email)) where accepted_at is null;

-- Role helpers ---------------------------------------------------------------
create or replace function public.role_rank(r public.workspace_role)
returns integer
language sql
immutable
as $$
  select case r when 'owner' then 4 when 'admin' then 3 when 'member' then 2 when 'viewer' then 1 else 0 end;
$$;

create or replace function public.workspace_role_of(ws uuid, uid uuid default auth.uid())
returns public.workspace_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.workspace_members where workspace_id = ws and user_id = uid;
$$;
revoke all on function public.workspace_role_of(uuid, uuid) from public, anon;
grant execute on function public.workspace_role_of(uuid, uuid) to authenticated, service_role;

create or replace function public.has_workspace_role(ws uuid, min_role public.workspace_role, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.role_rank(public.workspace_role_of(ws, uid)) >= public.role_rank(min_role), false);
$$;
revoke all on function public.has_workspace_role(uuid, public.workspace_role, uuid) from public, anon;
grant execute on function public.has_workspace_role(uuid, public.workspace_role, uuid) to authenticated, service_role;

create or replace function public.is_workspace_member(ws uuid, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.workspace_members where workspace_id = ws and user_id = uid);
$$;
revoke all on function public.is_workspace_member(uuid, uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid, uuid) to authenticated, service_role;

create or replace function public.shares_workspace_with(other uuid, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members a
    join public.workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = uid and b.user_id = other
  );
$$;
revoke all on function public.shares_workspace_with(uuid, uuid) from public, anon;
grant execute on function public.shares_workspace_with(uuid, uuid) to authenticated, service_role;

-- Workspace creation always runs through this function so the owner row is
-- created atomically with the workspace. No direct insert policy exists.
create or replace function public.create_workspace(p_name text, p_slug text)
returns public.workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  ws public.workspaces;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  insert into public.workspaces(name, slug, owner_id) values (p_name, p_slug, uid) returning * into ws;
  insert into public.workspace_members(workspace_id, user_id, role) values (ws.id, uid, 'owner');
  return ws;
end;
$$;
revoke all on function public.create_workspace(text, text) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Plans (single trusted pricing source for website, app and admin)
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  id text primary key check (id ~ '^[a-z][a-z0-9_-]{1,30}$'),
  name text not null,
  tagline text not null default '',
  description text not null default '',
  monthly_price_cents integer not null default 0 check (monthly_price_cents >= 0),
  annual_discount_pct integer not null default 20 check (annual_discount_pct between 0 and 90),
  features jsonb not null default '[]'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  visible boolean not null default true,
  popular boolean not null default false,
  is_default boolean not null default false,
  contact_sales boolean not null default false,
  cta_label text not null default 'Start optimizing',
  cta_href text not null default '/signup',
  sort_order integer not null default 100,
  stripe_monthly_price_id text,
  stripe_annual_price_id text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.plans (id, name, tagline, description, monthly_price_cents, annual_discount_pct, features, limits, visible, popular, is_default, contact_sales, cta_label, cta_href, sort_order)
values
  ('free', 'Free', 'Evaluate on one workload.', 'Connect one project, see your AI spend map, and run a bounded first analysis.',
    0, 0,
    '["1 project", "Runtime telemetry (7-day retention)", "AI spend map and diagnosis", "$5 Zev credit / month", "Bounded replay (8 samples)"]'::jsonb,
    '{"projects": 1, "credits_usd": 5, "replay_samples": 8, "team_members": 1, "telemetry_retention_days": 7, "github": false, "pdf_export": false}'::jsonb,
    false, false, true, false, 'Start free', '/signup', 10),
  ('starter', 'Starter', 'One team. One expensive workload.', 'Everything needed to measure a workload, test a candidate and verify savings.',
    4900, 20,
    '["3 projects", "Runtime telemetry (30-day retention)", "Opportunities and experiments", "$25 Zev credit / month", "Replay up to 25 samples per experiment", "Evidence inspector and reports (JSON, CSV)"]'::jsonb,
    '{"projects": 3, "credits_usd": 25, "replay_samples": 25, "team_members": 3, "telemetry_retention_days": 30, "github": false, "pdf_export": true}'::jsonb,
    true, false, false, false, 'Start optimizing', '/signup?plan=starter', 20),
  ('pro', 'Pro', 'Several workloads. A team reviewing changes.', 'Higher limits, longer telemetry retention and deeper replay for teams that ship AI every week.',
    9900, 20,
    '["10 projects", "Runtime telemetry (90-day retention)", "Advanced replay (up to 60 samples)", "$75 Zev credit / month", "Team roles and shared evidence", "PDF, CSV and JSON reports", "Priority evaluation queue"]'::jsonb,
    '{"projects": 10, "credits_usd": 75, "replay_samples": 60, "team_members": 10, "telemetry_retention_days": 90, "github": true, "pdf_export": true}'::jsonb,
    true, true, false, false, 'Start optimizing', '/signup?plan=pro', 30),
  ('team', 'Team', 'Legacy plan.', 'Retained for existing subscriptions. Not offered to new workspaces.',
    19900, 20,
    '["Everything in Pro", "Pooled Zev credit"]'::jsonb,
    '{"projects": 10, "credits_usd": 75, "replay_samples": 60, "team_members": 10, "telemetry_retention_days": 90, "github": true, "pdf_export": true}'::jsonb,
    false, false, false, false, 'Contact us', 'mailto:zevqora.ai@gmail.com', 40),
  ('enterprise', 'Enterprise', 'Custom gates, retention and security review.', 'From $299/month. Custom quality gates, retention policy, security review and a support agreement.',
    29900, 20,
    '["Unlimited projects", "Custom telemetry retention", "Custom verification gates", "Dedicated Zev credit pool", "Security review and DPA", "SSO and admin controls (on request)", "Support agreement"]'::jsonb,
    '{"projects": null, "credits_usd": 300, "replay_samples": 200, "team_members": null, "telemetry_retention_days": 365, "github": true, "pdf_export": true}'::jsonb,
    true, false, false, true, 'Contact sales', 'mailto:zevqora.ai@gmail.com', 50)
on conflict (id) do nothing;

-- Effective plan of a workspace: admin override, else the owner's subscription.
create or replace function public.workspace_plan(ws uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select plan_override::text from public.workspaces where id = ws),
    (select s.plan::text from public.workspaces w join public.subscriptions s on s.user_id = w.owner_id where w.id = ws),
    'free'
  );
$$;
revoke all on function public.workspace_plan(uuid) from public, anon;
grant execute on function public.workspace_plan(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Site content + feature flags (admin managed, structured, validated in API)
-- ---------------------------------------------------------------------------
create table if not exists public.site_content (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.site_content (key, value) values
  ('hero', '{"announcement": null, "headline": "Make AI lighter.", "subheadline": "Cut AI COGS without cutting product quality.", "supporting": "ZEVQORA finds expensive AI execution, tests cheaper alternatives, replays the same workload, verifies quality, and only recommends changes that earn trust.", "primary_cta": {"label": "Start optimizing", "href": "/signup"}, "secondary_cta": {"label": "See how it works", "href": "/#how-it-works"}, "trust_line": "Measure. Replay. Verify. Then optimize."}'::jsonb),
  ('proof', '{"kind": "Internal dogfooding benchmark", "cases": 50, "rejected": {"cost_reduction": "42.01%", "quality": "0.87", "quality_floor": "0.95", "reason": "quality_floor"}, "verified": {"cost_reduction": "12.32%", "quality": "0.97", "quality_floor": "0.95", "ci95": "[-11.01%, 34.64%]"}, "qualifier": "Internal 50-case dogfooding benchmark. Not customer evidence. The verified figure is a point estimate whose 95% confidence interval crosses zero."}'::jsonb),
  ('status', '{"banner": null, "public_status": "operational"}'::jsonb),
  ('contact', '{"email": "zevqora.ai@gmail.com"}'::jsonb)
on conflict (key) do nothing;

create table if not exists public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  description text not null default '',
  enabled boolean not null default false,
  plan_overrides jsonb not null default '{}'::jsonb,
  workspace_overrides jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.feature_flags (key, description, enabled) values
  ('runtime_telemetry', 'Accept signed runtime telemetry from connected servers.', true),
  ('cloud_replay', 'Run bounded replay experiments on the ZEVQORA platform provider credential.', true),
  ('github_integration', 'GitHub App connection for repository evidence and change handoff.', false),
  ('pdf_export', 'Print-ready PDF report export.', true),
  ('enterprise_sso', 'SSO for enterprise workspaces.', false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Model pricing snapshot (public list prices; estimates only)
-- ---------------------------------------------------------------------------
create table if not exists public.model_pricing (
  model text primary key,
  provider text not null,
  input_per_million numeric(12,4) not null check (input_per_million >= 0),
  output_per_million numeric(12,4) not null check (output_per_million >= 0),
  cached_input_per_million numeric(12,4),
  tier text not null default 'standard' check (tier in ('frontier', 'standard', 'small', 'embedding')),
  source text not null default 'public list price',
  retrieved_at timestamptz not null default now(),
  active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.model_pricing (model, provider, input_per_million, output_per_million, cached_input_per_million, tier, source, retrieved_at) values
  ('openai/gpt-4o', 'openai', 2.50, 10.00, 1.25, 'frontier', 'OpenAI public list price', '2026-09-01'),
  ('openai/gpt-4o-mini', 'openai', 0.15, 0.60, 0.075, 'small', 'OpenAI public list price', '2026-09-01'),
  ('openai/gpt-4.1', 'openai', 2.00, 8.00, 0.50, 'frontier', 'OpenAI public list price', '2026-09-01'),
  ('openai/gpt-4.1-mini', 'openai', 0.40, 1.60, 0.10, 'standard', 'OpenAI public list price', '2026-09-01'),
  ('openai/gpt-4.1-nano', 'openai', 0.10, 0.40, 0.025, 'small', 'OpenAI public list price', '2026-09-01'),
  ('openai/o3-mini', 'openai', 1.10, 4.40, 0.55, 'standard', 'OpenAI public list price', '2026-09-01'),
  ('openai/text-embedding-3-small', 'openai', 0.02, 0.00, null, 'embedding', 'OpenAI public list price', '2026-09-01'),
  ('anthropic/claude-sonnet-4', 'anthropic', 3.00, 15.00, 0.30, 'frontier', 'Anthropic public list price', '2026-09-01'),
  ('anthropic/claude-3.5-haiku', 'anthropic', 0.80, 4.00, 0.08, 'small', 'Anthropic public list price', '2026-09-01'),
  ('anthropic/claude-3.5-sonnet', 'anthropic', 3.00, 15.00, 0.30, 'frontier', 'Anthropic public list price', '2026-09-01'),
  ('google/gemini-2.5-pro', 'google', 1.25, 10.00, 0.31, 'frontier', 'Google public list price', '2026-09-01'),
  ('google/gemini-2.5-flash', 'google', 0.30, 2.50, 0.075, 'standard', 'Google public list price', '2026-09-01'),
  ('google/gemini-2.5-flash-lite', 'google', 0.10, 0.40, 0.025, 'small', 'Google public list price', '2026-09-01'),
  ('google/gemini-2.0-flash', 'google', 0.10, 0.40, 0.025, 'small', 'Google public list price', '2026-09-01'),
  ('meta-llama/llama-3.3-70b-instruct', 'meta', 0.12, 0.30, null, 'standard', 'OpenRouter median list price', '2026-09-01'),
  ('mistralai/mistral-small-3.1', 'mistral', 0.10, 0.30, null, 'small', 'OpenRouter median list price', '2026-09-01'),
  ('deepseek/deepseek-chat-v3', 'deepseek', 0.27, 1.10, 0.07, 'standard', 'OpenRouter median list price', '2026-09-01')
on conflict (model) do nothing;

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  slug text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$'),
  description text not null default '',
  source_kind text not null default 'runtime' check (source_kind in ('runtime', 'server', 'repository', 'github', 'manual')),
  repo_url text,
  settings jsonb not null default '{"quality_gate": 0.95, "max_latency_regression_pct": 50}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);
create index if not exists projects_workspace_idx on public.projects(workspace_id);

create or replace function public.project_workspace(pid uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select workspace_id from public.projects where id = pid;
$$;
revoke all on function public.project_workspace(uuid) from public, anon;
grant execute on function public.project_workspace(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Connections (secrets live in a separate service-only table)
-- ---------------------------------------------------------------------------
create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  kind text not null check (kind in ('server_telemetry', 'runtime_api', 'repository', 'github')),
  name text not null check (char_length(name) between 2 and 80),
  status text not null default 'active' check (status in ('active', 'revoked', 'pending')),
  token_prefix text,
  token_last4 text,
  scopes text[] not null default array['telemetry:write']::text[],
  permissions jsonb not null default '{"reads": ["AI call metadata", "token counts", "latency", "provider and model"], "never": ["source code", "environment variables", "raw secrets"], "samples": "opt-in, sanitized"}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null
);
create index if not exists connections_workspace_idx on public.connections(workspace_id);
create index if not exists connections_project_idx on public.connections(project_id);

create table if not exists public.connection_secrets (
  connection_id uuid primary key references public.connections(id) on delete cascade,
  token_hash text not null unique,
  rotated_at timestamptz not null default now()
);
create index if not exists connection_secrets_hash_idx on public.connection_secrets(token_hash);

-- ---------------------------------------------------------------------------
-- Telemetry
-- ---------------------------------------------------------------------------
create table if not exists public.telemetry_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  connection_id uuid references public.connections(id) on delete set null,
  event_key text,
  trace_id text,
  span_id text,
  parent_span_id text,
  occurred_at timestamptz not null default now(),
  provider text not null default 'unknown',
  model text not null default 'unknown',
  operation text not null default 'chat.completion',
  status text not null default 'ok' check (status in ('ok', 'error', 'timeout', 'cancelled')),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  cached_input_tokens integer check (cached_input_tokens >= 0),
  reasoning_tokens integer check (reasoning_tokens >= 0),
  latency_ms numeric(12,2) check (latency_ms >= 0),
  cost_usd numeric(14,8) check (cost_usd >= 0),
  cost_source text not null default 'unavailable' check (cost_source in ('provider_reported', 'pricing_snapshot_estimate', 'imported_external', 'unavailable')),
  pricing_version text,
  prompt_hash text,
  output_hash text,
  attempt integer,
  error_class text,
  sample jsonb,
  metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);
create unique index if not exists telemetry_events_key_uidx on public.telemetry_events(project_id, event_key) where event_key is not null;
create index if not exists telemetry_events_project_time_idx on public.telemetry_events(project_id, occurred_at desc);
create index if not exists telemetry_events_workspace_time_idx on public.telemetry_events(workspace_id, occurred_at desc);
create index if not exists telemetry_events_prompt_hash_idx on public.telemetry_events(project_id, prompt_hash) where prompt_hash is not null;
create index if not exists telemetry_events_model_idx on public.telemetry_events(project_id, provider, model);

-- ---------------------------------------------------------------------------
-- Analysis, opportunities, experiments, evaluation evidence
-- ---------------------------------------------------------------------------
create table if not exists public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  trigger text not null default 'manual',
  window_start timestamptz,
  window_end timestamptz,
  events_analyzed integer not null default 0,
  opportunities_found integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  error text,
  credits_usd numeric(12,6) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists analysis_runs_project_idx on public.analysis_runs(project_id, created_at desc);

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  analysis_run_id uuid references public.analysis_runs(id) on delete set null,
  origin text not null default 'runtime_telemetry' check (origin in ('runtime_telemetry', 'static_scan', 'manual', 'engine')),
  category text not null,
  title text not null,
  issue text not null default '',
  root_cause text not null default '',
  source_ref text,
  current_provider text,
  current_model text,
  cost_driver text,
  candidate_strategy text not null check (candidate_strategy in ('exact_reuse', 'model_substitution', 'bounded_routing', 'context_reduction', 'deterministic_replacement', 'retry_policy')),
  candidate_config jsonb not null default '{}'::jsonb,
  baseline_cost_usd numeric(14,6),
  estimated_savings_usd numeric(14,6),
  estimated_savings_pct numeric(6,2),
  confidence numeric(4,3) not null default 0.5 check (confidence between 0 and 1),
  risk text not null default 'medium' check (risk in ('low', 'medium', 'high')),
  evidence_completeness text not null default 'partial' check (evidence_completeness in ('complete', 'partial', 'missing')),
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'testing', 'verified', 'rejected', 'dismissed', 'needs_evidence')),
  fingerprint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, fingerprint)
);
create index if not exists opportunities_project_idx on public.opportunities(project_id, status);
create index if not exists opportunities_workspace_idx on public.opportunities(workspace_id);

create table if not exists public.experiments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  request_id text unique,
  status text not null default 'queued' check (status in ('queued', 'running', 'passed', 'failed', 'error', 'needs_evidence')),
  strategy text not null,
  baseline jsonb not null default '{}'::jsonb,
  candidate jsonb not null default '{}'::jsonb,
  quality_gate numeric(4,3) not null default 0.95 check (quality_gate > 0 and quality_gate <= 1),
  quality_score numeric(5,4),
  gates jsonb not null default '[]'::jsonb,
  sample_size integer not null default 0,
  verified_savings_usd numeric(14,6),
  verified_savings_pct numeric(6,2),
  projected_monthly_savings_usd numeric(14,4),
  provider_cost_usd numeric(14,8) not null default 0,
  credits_usd numeric(12,6) not null default 0,
  error text,
  evidence jsonb not null default '{}'::jsonb,
  evidence_hash text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index if not exists experiments_project_idx on public.experiments(project_id, created_at desc);
create index if not exists experiments_workspace_idx on public.experiments(workspace_id, created_at desc);
create index if not exists experiments_opportunity_idx on public.experiments(opportunity_id);

create table if not exists public.evaluation_cases (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  case_index integer not null,
  telemetry_event_id uuid references public.telemetry_events(id) on delete set null,
  grader text not null,
  score numeric(5,4),
  passed boolean not null default false,
  baseline_model text,
  candidate_model text,
  baseline_output_hash text,
  candidate_output_hash text,
  baseline_cost_usd numeric(14,8),
  candidate_cost_usd numeric(14,8),
  baseline_latency_ms numeric(12,2),
  candidate_latency_ms numeric(12,2),
  details jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  unique (experiment_id, case_index)
);

-- ---------------------------------------------------------------------------
-- Usage + credit ledger (server-side accounting only)
-- ---------------------------------------------------------------------------
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  operation text not null,
  credits_usd numeric(12,6) not null default 0 check (credits_usd >= 0),
  request_id text unique,
  provider text,
  model text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists usage_events_workspace_idx on public.usage_events(workspace_id, created_at desc);
create index if not exists usage_events_user_idx on public.usage_events(user_id, created_at desc);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  kind text not null check (kind in ('grant', 'consume', 'correction', 'reset', 'purchase', 'plan_change')),
  delta_usd numeric(12,6) not null,
  included_before numeric(12,2),
  included_after numeric(12,2),
  used_before numeric(12,2),
  used_after numeric(12,2),
  reason text not null default '',
  actor_id uuid references auth.users(id) on delete set null,
  request_id text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_user_idx on public.credit_ledger(user_id, created_at desc);

-- Atomic, idempotent credit consumption. Returns the remaining balance.
create or replace function public.consume_credits(
  p_user uuid,
  p_workspace uuid,
  p_project uuid,
  p_operation text,
  p_amount numeric,
  p_request_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  bal public.credit_balances%rowtype;
  remaining numeric;
begin
  if p_amount < 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  -- Idempotency: a retried request must never charge twice.
  if p_request_id is not null and exists (select 1 from public.usage_events where request_id = p_request_id) then
    select included_usd - used_usd into remaining from public.credit_balances where user_id = p_user;
    return coalesce(remaining, 0);
  end if;

  select * into bal from public.credit_balances where user_id = p_user for update;
  if not found then
    insert into public.credit_balances(user_id, included_usd, used_usd) values (p_user, 5, 0) returning * into bal;
  end if;

  if bal.included_usd - bal.used_usd < p_amount then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
  end if;

  update public.credit_balances set used_usd = used_usd + p_amount, updated_at = now() where user_id = p_user;

  insert into public.usage_events(workspace_id, project_id, user_id, operation, credits_usd, request_id, provider, model, metadata)
  values (p_workspace, p_project, p_user, p_operation, p_amount, p_request_id,
          nullif(p_metadata->>'provider', ''), nullif(p_metadata->>'model', ''), coalesce(p_metadata, '{}'::jsonb));

  insert into public.credit_ledger(user_id, workspace_id, kind, delta_usd, included_before, included_after, used_before, used_after, reason, actor_id, request_id, metadata)
  values (p_user, p_workspace, 'consume', -p_amount, bal.included_usd, bal.included_usd, bal.used_usd, bal.used_usd + p_amount, p_operation, p_user,
          case when p_request_id is null then null else 'ledger:' || p_request_id end, coalesce(p_metadata, '{}'::jsonb));

  return bal.included_usd - bal.used_usd - p_amount;
end;
$$;
revoke all on function public.consume_credits(uuid, uuid, uuid, text, numeric, text, jsonb) from public, anon, authenticated;
grant execute on function public.consume_credits(uuid, uuid, uuid, text, numeric, text, jsonb) to service_role;

-- Admin-only manual adjustment with before/after audit trail.
create or replace function public.adjust_credits(
  p_user uuid,
  p_delta_included numeric,
  p_delta_used numeric,
  p_kind text,
  p_reason text,
  p_actor uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns public.credit_balances
language plpgsql
security definer
set search_path = public
as $$
declare
  bal public.credit_balances%rowtype;
  after_row public.credit_balances%rowtype;
begin
  select * into bal from public.credit_balances where user_id = p_user for update;
  if not found then
    insert into public.credit_balances(user_id, included_usd, used_usd) values (p_user, 5, 0) returning * into bal;
  end if;
  update public.credit_balances
    set included_usd = greatest(0, included_usd + coalesce(p_delta_included, 0)),
        used_usd = greatest(0, used_usd + coalesce(p_delta_used, 0)),
        updated_at = now()
    where user_id = p_user
    returning * into after_row;
  insert into public.credit_ledger(user_id, kind, delta_usd, included_before, included_after, used_before, used_after, reason, actor_id, metadata)
  values (p_user, p_kind, coalesce(p_delta_included, 0) - coalesce(p_delta_used, 0), bal.included_usd, after_row.included_usd, bal.used_usd, after_row.used_usd, p_reason, p_actor, coalesce(p_metadata, '{}'::jsonb));
  return after_row;
end;
$$;
revoke all on function public.adjust_credits(uuid, numeric, numeric, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.adjust_credits(uuid, numeric, numeric, text, text, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['workspaces', 'projects', 'opportunities'] loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.admin_roles enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.plans enable row level security;
alter table public.site_content enable row level security;
alter table public.feature_flags enable row level security;
alter table public.model_pricing enable row level security;
alter table public.projects enable row level security;
alter table public.connections enable row level security;
alter table public.connection_secrets enable row level security;
alter table public.telemetry_events enable row level security;
alter table public.analysis_runs enable row level security;
alter table public.opportunities enable row level security;
alter table public.experiments enable row level security;
alter table public.evaluation_cases enable row level security;
alter table public.usage_events enable row level security;
alter table public.credit_ledger enable row level security;

-- Reads are allowed to members through RLS. Every write to platform tables goes
-- through the server API (service role), which performs role checks, plan
-- checks and audit logging. Authenticated users therefore hold SELECT only.

drop policy if exists admin_roles_select_self on public.admin_roles;
create policy admin_roles_select_self on public.admin_roles for select to authenticated using (user_id = auth.uid());

drop policy if exists workspaces_select_member on public.workspaces;
create policy workspaces_select_member on public.workspaces for select to authenticated using (public.is_workspace_member(id));

drop policy if exists workspace_members_select_member on public.workspace_members;
create policy workspace_members_select_member on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_invites_select_admin on public.workspace_invites;
create policy workspace_invites_select_admin on public.workspace_invites for select to authenticated using (public.has_workspace_role(workspace_id, 'admin'));

drop policy if exists plans_select_all on public.plans;
create policy plans_select_all on public.plans for select to anon, authenticated using (true);

drop policy if exists site_content_select_all on public.site_content;
create policy site_content_select_all on public.site_content for select to anon, authenticated using (true);

drop policy if exists model_pricing_select_all on public.model_pricing;
create policy model_pricing_select_all on public.model_pricing for select to anon, authenticated using (active);

drop policy if exists projects_select_member on public.projects;
create policy projects_select_member on public.projects for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists connections_select_member on public.connections;
create policy connections_select_member on public.connections for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists telemetry_select_member on public.telemetry_events;
create policy telemetry_select_member on public.telemetry_events for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists analysis_runs_select_member on public.analysis_runs;
create policy analysis_runs_select_member on public.analysis_runs for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists opportunities_select_member on public.opportunities;
create policy opportunities_select_member on public.opportunities for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists experiments_select_member on public.experiments;
create policy experiments_select_member on public.experiments for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists evaluation_cases_select_member on public.evaluation_cases;
create policy evaluation_cases_select_member on public.evaluation_cases for select to authenticated
  using (exists (select 1 from public.experiments e where e.id = experiment_id and public.is_workspace_member(e.workspace_id)));

drop policy if exists usage_events_select_member on public.usage_events;
create policy usage_events_select_member on public.usage_events for select to authenticated
  using (user_id = auth.uid() or (workspace_id is not null and public.is_workspace_member(workspace_id)));

drop policy if exists credit_ledger_select_own on public.credit_ledger;
create policy credit_ledger_select_own on public.credit_ledger for select to authenticated using (user_id = auth.uid());

-- Team members can see each other's basic profile.
drop policy if exists profiles_select_shared_workspace on public.profiles;
create policy profiles_select_shared_workspace on public.profiles for select to authenticated using (public.shares_workspace_with(id));

-- Grants -------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select on public.admin_roles, public.workspaces, public.workspace_members, public.workspace_invites,
  public.projects, public.connections, public.telemetry_events, public.analysis_runs, public.opportunities,
  public.experiments, public.evaluation_cases, public.usage_events, public.credit_ledger to authenticated;
grant select on public.plans, public.site_content, public.model_pricing to anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
