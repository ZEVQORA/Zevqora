-- Product engine on the platform.
--
-- ZEVQORA runs the same product loop in the browser and on the desktop:
-- repository → AI usage detection → traces → opportunities → candidate plan →
-- bounded execution → deterministic evaluation → evidence → reviewed patch.
-- The desktop engine keeps this state in its local SQLite; on the web the same
-- records live here, scoped to a workspace. Writes go through the service role
-- API; members can read their workspace's rows.

create table if not exists public.engine_products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  name text not null,
  root_path text not null,
  source text not null default 'browser' check (source in ('browser', 'desktop')),
  monitoring_enabled boolean not null default false,
  files_scanned integer not null default 0,
  skipped_sensitive_paths integer not null default 0,
  detected_stack jsonb not null default '[]'::jsonb,
  last_scan_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists engine_products_workspace_idx on public.engine_products(workspace_id, created_at desc);

create table if not exists public.engine_ai_calls (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.engine_products(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  file_path text not null,
  line integer not null,
  provider text not null,
  symbol text,
  excerpt text not null default ''
);
create index if not exists engine_ai_calls_product_idx on public.engine_ai_calls(product_id);

create table if not exists public.engine_findings (
  id uuid primary key,
  product_id uuid not null references public.engine_products(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  origin text not null default 'static_scan',
  category text not null,
  title text not null,
  root_cause text not null,
  file_path text not null,
  line integer not null default 0,
  symbol text,
  confidence double precision not null default 0.5,
  risk text not null default 'medium',
  evidence_status text not null default 'needs_evidence',
  created_at timestamptz not null default now()
);
create index if not exists engine_findings_product_idx on public.engine_findings(product_id);

create table if not exists public.engine_traces (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.engine_products(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  request_id text not null,
  "timestamp" timestamptz,
  symbol text,
  workflow text,
  provider text,
  model text,
  requested_model text,
  response_model text,
  provider_request_id text,
  input_text text,
  output_text text,
  expected_output text,
  candidate_output text,
  input_tokens integer,
  output_tokens integer,
  cached_input_tokens integer,
  reasoning_tokens integer,
  latency_ms double precision,
  ttft_ms double precision,
  candidate_latency_ms double precision,
  cost_usd double precision,
  cost_source text,
  pricing_version text,
  candidate_cost_usd double precision,
  attempt integer,
  retry_reason text,
  input_hash text,
  output_hash text,
  protected boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (product_id, request_id)
);
create index if not exists engine_traces_product_idx on public.engine_traces(product_id);

create table if not exists public.engine_plans (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.engine_products(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  finding_id uuid,
  strategy text not null,
  status text not null,
  reason text not null default '',
  expected_mechanism text not null default '',
  risk text not null default 'medium',
  fallback text not null default '',
  max_budget_usd double precision not null default 0,
  sample_scope jsonb not null default '[]'::jsonb,
  baseline_config jsonb not null default '{}'::jsonb,
  candidate_config jsonb not null default '{}'::jsonb,
  required_evidence jsonb not null default '[]'::jsonb,
  plan_version text not null default 'plan_v1',
  config_hash text not null default '',
  blocked_reason text,
  created_at timestamptz not null default now()
);
create index if not exists engine_plans_product_idx on public.engine_plans(product_id, created_at desc);

create table if not exists public.engine_executions (
  id uuid primary key default gen_random_uuid(),
  candidate_plan_id uuid not null references public.engine_plans(id) on delete cascade,
  product_id uuid not null references public.engine_products(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  status text not null,
  execution_key text not null,
  attempt integer not null default 1,
  parent_execution_id uuid,
  provider text,
  requested_model text,
  resolved_model text,
  started_at timestamptz,
  completed_at timestamptz,
  baseline_trace_ids jsonb not null default '[]'::jsonb,
  sample_results jsonb not null default '[]'::jsonb,
  input_tokens integer,
  output_tokens integer,
  cached_input_tokens integer,
  cost_usd double precision,
  cost_source text,
  pricing_version text,
  latency_ms double precision,
  provider_request_id text,
  provider_call_count integer not null default 0,
  candidate_cost_delta_usd double precision,
  error_category text,
  error_detail text,
  fallback_used boolean not null default false,
  provenance_hash text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists engine_executions_product_idx on public.engine_executions(product_id, created_at desc);
create index if not exists engine_executions_key_idx on public.engine_executions(execution_key);

create table if not exists public.engine_evaluations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.engine_products(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_plan_id uuid,
  candidate_execution_id uuid not null references public.engine_executions(id) on delete cascade,
  finding_id uuid,
  status text not null,
  evaluation_version text not null default 'evals_v1',
  sample_count integer not null default 0,
  protected_sample_count integer not null default 0,
  baseline_quality double precision,
  candidate_quality double precision,
  quality_delta double precision,
  baseline_cost_usd double precision,
  candidate_cost_usd double precision,
  raw_cost_delta_usd double precision,
  raw_cost_delta_percent double precision,
  baseline_latency_ms double precision,
  candidate_latency_ms double precision,
  evidence_completeness boolean not null default false,
  verification_source text not null default 'EXECUTION_EVALUATION',
  execution_proven boolean not null default false,
  evidence_version text not null default '',
  gates jsonb not null default '[]'::jsonb,
  cases jsonb not null default '[]'::jsonb,
  rejection_reason text,
  grader_config_hash text not null default '',
  gate_config_hash text not null default '',
  gate_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists engine_evaluations_product_idx on public.engine_evaluations(product_id, created_at desc);

create table if not exists public.engine_implementations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.engine_products(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  experiment_id uuid not null,
  finding_id uuid,
  status text not null,
  branch_name text not null,
  worktree_path text not null default 'browser',
  target_file text not null,
  summary text not null default '',
  diff_text text not null default '',
  replacement_text text,
  test_command text,
  test_exit_code integer,
  test_output text,
  model text not null default '',
  review_note text,
  reviewed_at timestamptz,
  pushed_at timestamptz,
  remote_url text,
  pr_url text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists engine_implementations_product_idx on public.engine_implementations(product_id, created_at desc);

-- Members read; every write goes through the service-role API.
do $$
declare t text;
begin
  foreach t in array array['engine_products','engine_ai_calls','engine_findings','engine_traces','engine_plans','engine_executions','engine_evaluations','engine_implementations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id, auth.uid()))', t || '_member_select', t);
  end loop;
end $$;
