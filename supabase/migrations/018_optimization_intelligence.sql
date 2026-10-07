-- vNext Part 2B: Optimization Intelligence Engine.
--
-- A plan search inside an Optimization Run generates bounded compositions of
-- optimization transformations (execution plans), calibrates the promising
-- ones on a deterministic sample, replays the best under the run's frozen
-- Evaluation Contract, computes the Pareto frontier of VERIFIED plans and
-- records which plan a stated decision policy selects. Bad-Day Replay results
-- are stored apart from the normal verdict.
--
-- No second execution or verdict system: executable plans are materialized as
-- engine_plans rows; calibration and full replay create engine_executions
-- (with a stage) and verdicts are engine_evaluations.
--
-- Additive. Requires 016 + 017. Server-only like engine_* / 017: RLS on,
-- member SELECT policies for defence in depth, no client grant, every hostile
-- default grant revoked explicitly.
--
-- Rollback: supabase/rollback/018_optimization_intelligence.rollback.sql.

-- ------------------------------------------------- 017 tables gain tenancy keys
create unique index if not exists engine_plans_id_workspace_key on public.engine_plans(id, workspace_id);
create unique index if not exists engine_executions_id_workspace_key on public.engine_executions(id, workspace_id);
create unique index if not exists engine_evaluations_id_workspace_key on public.engine_evaluations(id, workspace_id);

-- Two structural diagnosis families (only fire on Agent / ToolCall / Retrieval nodes).
alter table public.optimization_diagnoses drop constraint if exists optimization_diagnoses_family_check;
alter table public.optimization_diagnoses add constraint optimization_diagnoses_family_check
  check (family in ('redundant_call', 'retry_amplification', 'context_amplification', 'model_overprovisioning', 'latency_critical_path', 'agent_workflow', 'retrieval_redundancy'));

-- ------------------------------------------------------------------ searches
create table if not exists public.plan_searches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  run_id uuid not null,
  contract_id uuid not null,
  contract_hash text not null check (contract_hash ~ '^[0-9a-f]{64}$'),
  baseline_snapshot_id uuid not null,
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  search_version text not null,
  search_hash text not null check (search_hash ~ '^[0-9a-f]{64}$'),
  seed text not null check (char_length(seed) between 1 and 64),
  bounds jsonb not null check (jsonb_typeof(bounds) = 'object'),
  status text not null default 'generated' check (status in ('generated', 'calibrating', 'replaying', 'completed', 'budget_exhausted', 'cancelled', 'failed')),
  evaluation_set jsonb not null check (jsonb_typeof(evaluation_set) = 'object'),
  evaluation_set_hash text not null check (evaluation_set_hash ~ '^[0-9a-f]{64}$'),
  generation jsonb not null default '{}'::jsonb,
  spend jsonb not null default '{}'::jsonb,
  budget_report jsonb,
  frontier jsonb,
  frontier_hash text check (frontier_hash is null or frontier_hash ~ '^[0-9a-f]{64}$'),
  lock_token uuid,
  locked_until timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint plan_searches_run_fk foreign key (run_id, workspace_id) references public.optimization_runs(id, workspace_id) on delete cascade,
  constraint plan_searches_product_fk foreign key (product_id, workspace_id) references public.engine_products(id, workspace_id) on delete cascade,
  constraint plan_searches_contract_fk foreign key (contract_id, workspace_id) references public.evaluation_contracts(id, workspace_id),
  constraint plan_searches_snapshot_fk foreign key (baseline_snapshot_id, workspace_id) references public.performance_snapshots(id, workspace_id) on delete cascade,
  constraint plan_searches_cancel_stamp check (status <> 'cancelled' or cancelled_at is not null),
  unique (run_id, search_hash),
  unique (id, workspace_id)
);
create index if not exists plan_searches_run_idx on public.plan_searches(run_id, created_at desc);
create index if not exists plan_searches_workspace_idx on public.plan_searches(workspace_id);
create index if not exists plan_searches_product_idx on public.plan_searches(product_id, workspace_id);
create index if not exists plan_searches_contract_idx on public.plan_searches(contract_id, workspace_id);
create index if not exists plan_searches_snapshot_idx on public.plan_searches(baseline_snapshot_id, workspace_id);
create index if not exists plan_searches_created_by_idx on public.plan_searches(created_by);
create index if not exists plan_searches_cancelled_by_idx on public.plan_searches(cancelled_by);

-- A search binds its run's frozen contract and baseline; its identity never
-- changes, and cancelled / completed / budget-exhausted searches stay that way.
create or replace function public.plan_searches_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare r record;
begin
  if tg_op = 'INSERT' then
    select contract_id, contract_hash, baseline_snapshot_id, product_id into r from public.optimization_runs where id = new.run_id;
    if not found or r.contract_id <> new.contract_id or r.contract_hash <> new.contract_hash or r.product_id <> new.product_id then
      raise exception 'SEARCH_CONTRACT_MISMATCH: a search uses its run''s frozen contract' using errcode = '23514';
    end if;
    if r.baseline_snapshot_id is distinct from new.baseline_snapshot_id then
      raise exception 'SEARCH_BASELINE_MISMATCH: a search uses its run''s baseline snapshot' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.run_id <> old.run_id or new.contract_id <> old.contract_id or new.contract_hash <> old.contract_hash
     or new.baseline_snapshot_id <> old.baseline_snapshot_id or new.snapshot_hash <> old.snapshot_hash
     or new.search_hash <> old.search_hash or new.seed <> old.seed or new.bounds <> old.bounds
     or new.evaluation_set_hash <> old.evaluation_set_hash or new.evaluation_set <> old.evaluation_set then
    raise exception 'SEARCH_IMMUTABLE: a search keeps its contract, baseline, bounds, seed and evaluation set' using errcode = '23514';
  end if;
  if old.status in ('cancelled', 'completed', 'budget_exhausted', 'failed') and new.status <> old.status then
    raise exception 'SEARCH_TERMINAL: search is % and cannot change status', old.status using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists plan_searches_guard on public.plan_searches;
create trigger plan_searches_guard before insert or update on public.plan_searches for each row execute function public.plan_searches_guard();

-- One stage at a time per search: an expiring lease, taken atomically.
create or replace function public.plan_search_lock(p_search_id uuid, p_token uuid, p_ttl_seconds integer)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare n integer;
begin
  if p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 900 then raise exception 'SEARCH_LOCK_TTL: between 1 and 900 seconds' using errcode = '22023'; end if;
  update public.plan_searches
     set lock_token = p_token, locked_until = now() + make_interval(secs => p_ttl_seconds)
   where id = p_search_id and (locked_until is null or locked_until < now() or lock_token = p_token);
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

create or replace function public.plan_search_unlock(p_search_id uuid, p_token uuid)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare n integer;
begin
  update public.plan_searches set lock_token = null, locked_until = null where id = p_search_id and lock_token = p_token;
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

-- ------------------------------------------------------------- execution plans
create table if not exists public.execution_plans (
  id uuid primary key,
  workspace_id uuid not null,
  product_id uuid not null,
  search_id uuid not null,
  run_id uuid not null,
  contract_id uuid not null,
  contract_hash text not null check (contract_hash ~ '^[0-9a-f]{64}$'),
  baseline_snapshot_id uuid not null,
  plan_version text not null,
  plan_hash text not null check (plan_hash ~ '^[0-9a-f]{64}$'),
  name text not null check (char_length(name) between 1 and 300),
  source_diagnosis_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(source_diagnosis_ids) = 'array'),
  pass_instances jsonb not null check (jsonb_typeof(pass_instances) = 'array' and jsonb_array_length(pass_instances) between 1 and 3),
  status text not null check (status in ('PROPOSED', 'BLOCKED', 'NEEDS_EVIDENCE', 'CONFLICTED', 'PRUNED', 'CALIBRATION_READY', 'CALIBRATING', 'CALIBRATION_REJECTED', 'FULL_REPLAY_READY', 'REPLAYING', 'REJECTED', 'INCOMPLETE', 'VERIFIED', 'PARETO_FRONTIER', 'SELECTED')),
  executable_status text not null check (executable_status in ('EXECUTABLE', 'NOT_EXECUTABLE', 'NEEDS_IMPLEMENTATION')),
  priority double precision,
  estimated_effects jsonb not null default '{}'::jsonb,
  observed_calibration_effects jsonb,
  verified_effects jsonb,
  required_evidence jsonb not null default '[]'::jsonb,
  missing_evidence jsonb not null default '[]'::jsonb,
  risk_class text not null check (risk_class in ('low', 'medium', 'high')),
  implementation_complexity integer not null check (implementation_complexity between 1 and 15),
  rollback_complexity integer not null check (rollback_complexity between 1 and 5),
  compatibility_result jsonb not null check (jsonb_typeof(compatibility_result) = 'object'),
  conflict_reasons jsonb not null default '[]'::jsonb,
  replay_budget jsonb not null default '{}'::jsonb,
  replay_state jsonb not null default '{}'::jsonb,
  verdict text check (verdict is null or verdict in ('VERIFIED', 'REJECTED', 'INCOMPLETE')),
  evaluation_id uuid,
  engine_plan_id uuid,
  dominance_state jsonb,
  frontier_state text check (frontier_state is null or frontier_state in ('FRONTIER', 'DOMINATED', 'INCOMPARABLE')),
  materializer_hints jsonb not null default '[]'::jsonb,
  rollback jsonb not null default '[]'::jsonb,
  explanation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint execution_plans_search_fk foreign key (search_id, workspace_id) references public.plan_searches(id, workspace_id) on delete cascade,
  constraint execution_plans_evaluation_fk foreign key (evaluation_id, workspace_id) references public.engine_evaluations(id, workspace_id) on delete set null (evaluation_id),
  constraint execution_plans_engine_plan_fk foreign key (engine_plan_id, workspace_id) references public.engine_plans(id, workspace_id) on delete set null (engine_plan_id),
  -- A plan that cannot execute never enters calibration, replay or the frontier.
  constraint execution_plans_executable_stages check (executable_status = 'EXECUTABLE' or status in ('PROPOSED', 'BLOCKED', 'NEEDS_EVIDENCE', 'CONFLICTED', 'PRUNED')),
  -- VERIFIED (and anything built on it) needs a VERIFIED evaluation under the contract.
  constraint execution_plans_verified_evidence check (status not in ('VERIFIED', 'PARETO_FRONTIER', 'SELECTED') or (verdict = 'VERIFIED' and evaluation_id is not null)),
  constraint execution_plans_frontier_state check (status not in ('PARETO_FRONTIER', 'SELECTED') or frontier_state = 'FRONTIER'),
  constraint execution_plans_frontier_verified check (frontier_state is null or verdict = 'VERIFIED'),
  constraint execution_plans_conflicted check (status <> 'CONFLICTED' or compatibility_result ->> 'compatible' = 'false'),
  unique (search_id, plan_hash),
  unique (id, workspace_id)
);
create index if not exists execution_plans_search_idx on public.execution_plans(search_id, status);
create index if not exists execution_plans_workspace_idx on public.execution_plans(workspace_id);
create index if not exists execution_plans_evaluation_idx on public.execution_plans(evaluation_id, workspace_id);
create index if not exists execution_plans_engine_plan_idx on public.execution_plans(engine_plan_id, workspace_id);

-- --------------------------------------------------------------- calibration
create table if not exists public.plan_calibrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  search_id uuid not null,
  plan_id uuid not null,
  round integer not null check (round between 1 and 3),
  seed text not null,
  sample_ids jsonb not null check (jsonb_typeof(sample_ids) = 'array'),
  sample_hash text not null check (sample_hash ~ '^[0-9a-f]{64}$'),
  sample_size integer not null check (sample_size >= 0),
  outcome text not null check (outcome in ('PROMISING', 'UNPROMISING', 'INCOMPLETE', 'FAILED_HARD_GATE')),
  label text not null default 'CALIBRATION — NOT VERIFIED' check (label = 'CALIBRATION — NOT VERIFIED'),
  execution_id uuid,
  metrics jsonb not null default '{}'::jsonb,
  bounds_analysis jsonb not null default '{}'::jsonb,
  gates jsonb not null default '[]'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  decision jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint plan_calibrations_plan_fk foreign key (plan_id, workspace_id) references public.execution_plans(id, workspace_id) on delete cascade,
  constraint plan_calibrations_search_fk foreign key (search_id, workspace_id) references public.plan_searches(id, workspace_id) on delete cascade,
  constraint plan_calibrations_execution_fk foreign key (execution_id, workspace_id) references public.engine_executions(id, workspace_id) on delete set null (execution_id),
  unique (plan_id, round)
);
create index if not exists plan_calibrations_search_idx on public.plan_calibrations(search_id, workspace_id);
create index if not exists plan_calibrations_workspace_idx on public.plan_calibrations(workspace_id);
create index if not exists plan_calibrations_execution_idx on public.plan_calibrations(execution_id, workspace_id);

-- ------------------------------------------------------------------ decisions
create table if not exists public.plan_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  search_id uuid not null,
  policy text not null check (policy in ('BALANCED', 'MARGIN_FIRST', 'LATENCY_FIRST', 'RELIABILITY_FIRST', 'CUSTOM_CONSTRAINTS')),
  policy_params jsonb not null default '{}'::jsonb,
  frontier_hash text not null check (frontier_hash ~ '^[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('SELECTED', 'NO_ELIGIBLE_PLAN')),
  selected_plan_id uuid,
  explanation jsonb not null default '{}'::jsonb,
  decision_hash text not null check (decision_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint plan_decisions_search_fk foreign key (search_id, workspace_id) references public.plan_searches(id, workspace_id) on delete cascade,
  constraint plan_decisions_plan_fk foreign key (selected_plan_id, workspace_id) references public.execution_plans(id, workspace_id) on delete cascade,
  constraint plan_decisions_outcome check ((outcome = 'SELECTED') = (selected_plan_id is not null)),
  unique (search_id, decision_hash)
);
create index if not exists plan_decisions_search_idx on public.plan_decisions(search_id, workspace_id, created_at desc);
create index if not exists plan_decisions_workspace_idx on public.plan_decisions(workspace_id);
create index if not exists plan_decisions_plan_idx on public.plan_decisions(selected_plan_id, workspace_id);
create index if not exists plan_decisions_created_by_idx on public.plan_decisions(created_by);

-- A policy chooses from the VERIFIED Pareto frontier of the same search, never outside it.
create or replace function public.plan_decisions_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare p record;
begin
  if tg_op <> 'INSERT' then raise exception 'DECISION_IMMUTABLE: decisions are append-only' using errcode = '23514'; end if;
  if new.selected_plan_id is null then return new; end if;
  select search_id, verdict, frontier_state into p from public.execution_plans where id = new.selected_plan_id;
  if not found or p.search_id <> new.search_id then raise exception 'DECISION_PLAN_MISMATCH: the selected plan belongs to another search' using errcode = '23514'; end if;
  if p.verdict is distinct from 'VERIFIED' or p.frontier_state is distinct from 'FRONTIER' then
    raise exception 'DECISION_NOT_ON_FRONTIER: only a VERIFIED plan on the Pareto frontier can be selected' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists plan_decisions_guard on public.plan_decisions;
create trigger plan_decisions_guard before insert or update on public.plan_decisions for each row execute function public.plan_decisions_guard();

-- ------------------------------------------------------------ bad-day replay
create table if not exists public.bad_day_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  version text not null,
  scenario text not null check (scenario in ('PROVIDER_RATE_LIMIT', 'PROVIDER_TIMEOUT', 'MODEL_LATENCY_MULTIPLIER', 'CACHE_MISS', 'TOOL_TIMEOUT', 'TOOL_ERROR', 'RETRIEVAL_SLOWDOWN')),
  parameters jsonb not null check (jsonb_typeof(parameters) = 'object'),
  scope text not null default 'workload',
  seed text not null check (char_length(seed) between 1 and 64),
  profile_hash text not null check (profile_hash ~ '^[0-9a-f]{64}$'),
  required_capabilities jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint bad_day_profiles_product_fk foreign key (product_id, workspace_id) references public.engine_products(id, workspace_id) on delete cascade,
  unique (product_id, profile_hash),
  unique (id, workspace_id)
);
create index if not exists bad_day_profiles_workspace_idx on public.bad_day_profiles(workspace_id);
create index if not exists bad_day_profiles_product_idx on public.bad_day_profiles(product_id, workspace_id);
create index if not exists bad_day_profiles_created_by_idx on public.bad_day_profiles(created_by);

create table if not exists public.bad_day_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  search_id uuid not null,
  plan_id uuid not null,
  profile_id uuid not null,
  profile_hash text not null check (profile_hash ~ '^[0-9a-f]{64}$'),
  normal_verdict text not null check (normal_verdict in ('VERIFIED', 'REJECTED', 'INCOMPLETE')),
  bad_day_verdict text not null check (bad_day_verdict in ('VERIFIED', 'REJECTED', 'INCOMPLETE', 'UNSUPPORTED')),
  label text not null default 'BAD-DAY REPLAY' check (label = 'BAD-DAY REPLAY'),
  source_execution_id uuid,
  metrics jsonb not null default '{}'::jsonb,
  gates jsonb not null default '[]'::jsonb,
  result_hash text not null check (result_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint bad_day_results_plan_fk foreign key (plan_id, workspace_id) references public.execution_plans(id, workspace_id) on delete cascade,
  constraint bad_day_results_search_fk foreign key (search_id, workspace_id) references public.plan_searches(id, workspace_id) on delete cascade,
  constraint bad_day_results_profile_fk foreign key (profile_id, workspace_id) references public.bad_day_profiles(id, workspace_id) on delete cascade,
  constraint bad_day_results_execution_fk foreign key (source_execution_id, workspace_id) references public.engine_executions(id, workspace_id) on delete set null (source_execution_id),
  unique (plan_id, profile_hash)
);
create index if not exists bad_day_results_search_idx on public.bad_day_results(search_id, workspace_id);
create index if not exists bad_day_results_workspace_idx on public.bad_day_results(workspace_id);
create index if not exists bad_day_results_profile_idx on public.bad_day_results(profile_id, workspace_id);
create index if not exists bad_day_results_execution_idx on public.bad_day_results(source_execution_id, workspace_id);
create index if not exists bad_day_results_created_by_idx on public.bad_day_results(created_by);

-- ------------------------------------------------- engine lineage (nullable)
alter table public.engine_executions
  add column if not exists execution_plan_id uuid references public.execution_plans(id) on delete set null,
  add column if not exists search_id uuid references public.plan_searches(id) on delete set null,
  add column if not exists stage text check (stage is null or stage in ('calibration', 'full_replay'));
create index if not exists engine_executions_execution_plan_idx on public.engine_executions(execution_plan_id);
create index if not exists engine_executions_search_idx on public.engine_executions(search_id);

alter table public.engine_evaluations
  add column if not exists execution_plan_id uuid references public.execution_plans(id) on delete set null,
  add column if not exists search_id uuid references public.plan_searches(id) on delete set null;
create index if not exists engine_evaluations_execution_plan_idx on public.engine_evaluations(execution_plan_id);
create index if not exists engine_evaluations_search_idx on public.engine_evaluations(search_id);

-- ------------------------------------- bounded ZevIR read with safe attributes
-- As zevir_product_graph_set (017), plus node status, tokens and the node
-- attributes ZevIR already stores content-free (digests, document ids, tool
-- names) and edge ordinals, so agent loops and retrieval reuse can be
-- diagnosed from structure. One call, no N+1, explicit truncation.
create or replace function public.zevir_product_graph_set_v2(p_workspace_id uuid, p_product_id uuid, p_max_graphs integer)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare v_total integer;
begin
  if p_max_graphs is null or p_max_graphs < 1 or p_max_graphs > 500 then raise exception 'ZEVIR_GRAPH_LIMIT: p_max_graphs must be between 1 and 500' using errcode = '22023'; end if;
  select count(*) into v_total from public.zevir_graphs where workspace_id = p_workspace_id and product_id = p_product_id;
  return jsonb_build_object(
    'total', v_total,
    'truncated', v_total > p_max_graphs,
    'graphs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'graph_hash', g.graph_hash, 'source_kind', g.source_kind, 'source_trace_id', g.source_trace_id, 'root_node_id', g.root_node_id, 'status', g.status,
        'nodes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'stable_key', n.stable_key, 'kind', n.kind, 'name', n.name, 'operation', n.operation, 'started_at', n.started_at, 'ended_at', n.ended_at, 'duration_ms', n.duration_ms, 'latency_ms', n.latency_ms, 'status', n.status, 'input_tokens', n.input_tokens, 'output_tokens', n.output_tokens, 'cost_usd', n.cost_usd, 'attributes', n.attributes) order by n.stable_key) from public.zevir_nodes n where n.graph_id = g.id), '[]'::jsonb),
        'edges', coalesce((select jsonb_agg(jsonb_build_object('source_node_id', e.source_node_id, 'target_node_id', e.target_node_id, 'kind', e.kind, 'ordinal', e.ordinal) order by e.source_node_id, e.kind, e.target_node_id) from public.zevir_edges e where e.graph_id = g.id), '[]'::jsonb)
      ) order by g.updated_at desc, g.id)
      from (select * from public.zevir_graphs where workspace_id = p_workspace_id and product_id = p_product_id order by updated_at desc, id limit p_max_graphs) g
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------- access control
alter table public.plan_searches enable row level security;
alter table public.execution_plans enable row level security;
alter table public.plan_calibrations enable row level security;
alter table public.plan_decisions enable row level security;
alter table public.bad_day_profiles enable row level security;
alter table public.bad_day_results enable row level security;

revoke all on public.plan_searches, public.execution_plans, public.plan_calibrations, public.plan_decisions, public.bad_day_profiles, public.bad_day_results from anon, authenticated;
grant all on public.plan_searches, public.execution_plans, public.plan_calibrations, public.plan_decisions, public.bad_day_profiles, public.bad_day_results to service_role;

do $$
declare t text;
begin
  foreach t in array array['plan_searches', 'execution_plans', 'plan_calibrations', 'plan_decisions', 'bad_day_profiles', 'bad_day_results'] loop
    execute format('drop policy if exists %I on public.%I', t || '_member_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id, (select auth.uid())))', t || '_member_select', t);
  end loop;
end $$;

revoke all on function public.plan_searches_guard() from public, anon, authenticated;
revoke all on function public.plan_decisions_guard() from public, anon, authenticated;
revoke all on function public.plan_search_lock(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.plan_search_unlock(uuid, uuid) from public, anon, authenticated;
revoke all on function public.zevir_product_graph_set_v2(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.plan_search_lock(uuid, uuid, integer) to service_role;
grant execute on function public.plan_search_unlock(uuid, uuid) to service_role;
grant execute on function public.zevir_product_graph_set_v2(uuid, uuid, integer) to service_role;

insert into public.feature_flags (key, description, enabled)
values ('optimization_intelligence_vnext', 'Optimization Intelligence (vNext Part 2B): plan search, calibration, Pareto frontier, decision policy and Bad-Day Replay. Requires verified_optimization_vnext.', false)
on conflict (key) do nothing;
