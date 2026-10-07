-- vNext Part 2A: Verified Optimization Run.
--
-- One Optimization Run = one product, one frozen Evaluation Contract, one
-- Verified Performance baseline, deterministic diagnoses, candidate plans
-- (engine_plans), replays (engine_executions) and verdicts (engine_evaluations).
--
-- Additive: four new server-only tables and nullable lineage columns on
-- engine_plans / engine_executions / engine_evaluations. Requires 016 (ZevIR).
-- Nothing in the existing proof loop reads these tables; existing VERIFIED /
-- REJECTED / INCOMPLETE semantics are unchanged.
--
-- Browser roles get nothing (same model as engine_*): RLS on, member SELECT
-- policies for defence in depth, but no client grant. Supabase's default
-- privileges grant new objects to anon/authenticated, so every grant is
-- revoked explicitly below.
--
-- Rollback: supabase/rollback/017_verified_optimization.rollback.sql.

-- Lets child tables prove a product belongs to their workspace.
create unique index if not exists engine_products_id_workspace_key on public.engine_products(id, workspace_id);

-- ------------------------------------------------------------ contracts
create table if not exists public.evaluation_contracts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  version integer not null check (version >= 1),
  status text not null check (status in ('draft', 'frozen', 'superseded')),
  requirements jsonb not null check (jsonb_typeof(requirements) = 'object'),
  contract_hash text not null check (contract_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  frozen_at timestamptz,
  frozen_by uuid references auth.users(id) on delete set null,
  superseded_at timestamptz,
  superseded_by uuid references public.evaluation_contracts(id) on delete set null,
  constraint evaluation_contracts_product_fk foreign key (product_id, workspace_id) references public.engine_products(id, workspace_id) on delete cascade,
  constraint evaluation_contracts_frozen_stamp check (status = 'draft' or (frozen_at is not null)),
  unique (product_id, version),
  unique (id, workspace_id)
);
create unique index if not exists evaluation_contracts_one_draft on public.evaluation_contracts(product_id) where status = 'draft';
create unique index if not exists evaluation_contracts_one_frozen on public.evaluation_contracts(product_id) where status = 'frozen';
create index if not exists evaluation_contracts_workspace_idx on public.evaluation_contracts(workspace_id);
create index if not exists evaluation_contracts_created_by_idx on public.evaluation_contracts(created_by);
create index if not exists evaluation_contracts_frozen_by_idx on public.evaluation_contracts(frozen_by);
create index if not exists evaluation_contracts_superseded_by_idx on public.evaluation_contracts(superseded_by);

-- A frozen contract never changes. The only allowed change is frozen → superseded.
create or replace function public.evaluation_contracts_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    -- pg_trigger_depth() > 1: the row is going away with its product or workspace (FK cascade).
    if old.status <> 'draft' and pg_trigger_depth() <= 1 then raise exception 'CONTRACT_IMMUTABLE: contract % v% is % and cannot be deleted', old.id, old.version, old.status using errcode = '23514'; end if;
    return old;
  end if;
  if old.status = 'draft' then
    if new.product_id <> old.product_id or new.workspace_id <> old.workspace_id or new.version <> old.version then
      raise exception 'CONTRACT_IMMUTABLE: a contract cannot move to another product, workspace or version' using errcode = '23514';
    end if;
    if new.status = 'superseded' then raise exception 'CONTRACT_IMMUTABLE: a draft cannot be superseded' using errcode = '23514'; end if;
    return new;
  end if;
  if old.status = 'frozen' and new.status = 'superseded'
     and new.requirements = old.requirements and new.contract_hash = old.contract_hash and new.version = old.version
     and new.product_id = old.product_id and new.workspace_id = old.workspace_id and new.frozen_at = old.frozen_at
     and new.frozen_by is not distinct from old.frozen_by then
    return new;
  end if;
  raise exception 'CONTRACT_IMMUTABLE: contract % v% is % and cannot change; create a new version', old.id, old.version, old.status using errcode = '23514';
end;
$$;
drop trigger if exists evaluation_contracts_guard on public.evaluation_contracts;
create trigger evaluation_contracts_guard before update or delete on public.evaluation_contracts for each row execute function public.evaluation_contracts_guard();

-- Freezing is atomic: the product's current frozen contract becomes
-- superseded and the draft becomes frozen in one transaction. The caller
-- passes the hash it computed from the draft; a draft edited in between fails.
create or replace function public.evaluation_contract_freeze(p_contract_id uuid, p_frozen_by uuid, p_expected_hash text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare c record;
begin
  select * into c from public.evaluation_contracts where id = p_contract_id for update;
  if not found then raise exception 'CONTRACT_NOT_FOUND' using errcode = '02000'; end if;
  if c.status <> 'draft' then raise exception 'CONTRACT_IMMUTABLE: contract v% is already %', c.version, c.status using errcode = '23514'; end if;
  if c.contract_hash <> p_expected_hash then raise exception 'CONTRACT_HASH_MISMATCH: the draft changed; review it and freeze again' using errcode = '23514'; end if;
  update public.evaluation_contracts set status = 'superseded', superseded_at = now(), superseded_by = c.id
   where product_id = c.product_id and status = 'frozen';
  update public.evaluation_contracts set status = 'frozen', frozen_at = now(), frozen_by = p_frozen_by, updated_at = now()
   where id = c.id;
  return (select to_jsonb(x) from public.evaluation_contracts x where x.id = c.id);
end;
$$;

-- ------------------------------------------------------------------ runs
create table if not exists public.optimization_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  contract_id uuid not null,
  contract_hash text not null check (contract_hash ~ '^[0-9a-f]{64}$'),
  baseline_snapshot_id uuid,
  status text not null default 'open' check (status in ('open', 'evaluated', 'closed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint optimization_runs_product_fk foreign key (product_id, workspace_id) references public.engine_products(id, workspace_id) on delete cascade,
  constraint optimization_runs_contract_fk foreign key (contract_id, workspace_id) references public.evaluation_contracts(id, workspace_id),
  unique (id, workspace_id)
);
create index if not exists optimization_runs_product_idx on public.optimization_runs(product_id, created_at desc);
create index if not exists optimization_runs_workspace_idx on public.optimization_runs(workspace_id);
create index if not exists optimization_runs_contract_idx on public.optimization_runs(contract_id);
create index if not exists optimization_runs_created_by_idx on public.optimization_runs(created_by);

-- A run binds a FROZEN contract of the same product, by hash.
create or replace function public.optimization_runs_bind_contract()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare c record;
begin
  select product_id, status, contract_hash into c from public.evaluation_contracts where id = new.contract_id;
  if not found or c.product_id <> new.product_id then raise exception 'RUN_CONTRACT_MISMATCH: contract belongs to another product' using errcode = '23514'; end if;
  if tg_op = 'INSERT' and c.status <> 'frozen' then raise exception 'RUN_CONTRACT_NOT_FROZEN: freeze the contract before starting a run' using errcode = '23514'; end if;
  if c.contract_hash <> new.contract_hash then raise exception 'RUN_CONTRACT_HASH: run hash does not match the contract' using errcode = '23514'; end if;
  if tg_op = 'UPDATE' and (new.contract_id <> old.contract_id or new.contract_hash <> old.contract_hash or new.product_id <> old.product_id) then
    raise exception 'RUN_CONTRACT_IMMUTABLE: a run keeps the contract it started with' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists optimization_runs_bind_contract on public.optimization_runs;
create trigger optimization_runs_bind_contract before insert or update on public.optimization_runs for each row execute function public.optimization_runs_bind_contract();

-- ------------------------------------------------------------- snapshots
create table if not exists public.performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  run_id uuid not null,
  kind text not null default 'baseline' check (kind in ('baseline')),
  contract_hash text not null check (contract_hash ~ '^[0-9a-f]{64}$'),
  version text not null,
  metrics jsonb not null check (jsonb_typeof(metrics) = 'object'),
  latency_analysis jsonb not null default '{}'::jsonb,
  completeness text not null check (completeness in ('complete', 'incomplete')),
  trace_count integer not null check (trace_count >= 0),
  window_truncated boolean not null default false,
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint performance_snapshots_run_fk foreign key (run_id, workspace_id) references public.optimization_runs(id, workspace_id) on delete cascade,
  unique (run_id, kind),
  unique (id, workspace_id)
);
create index if not exists performance_snapshots_workspace_idx on public.performance_snapshots(workspace_id);
create index if not exists performance_snapshots_product_idx on public.performance_snapshots(product_id);

alter table public.optimization_runs
  drop constraint if exists optimization_runs_snapshot_fk,
  add constraint optimization_runs_snapshot_fk foreign key (baseline_snapshot_id) references public.performance_snapshots(id) on delete set null;
create index if not exists optimization_runs_snapshot_idx on public.optimization_runs(baseline_snapshot_id);

-- ------------------------------------------------------------- diagnoses
create table if not exists public.optimization_diagnoses (
  id uuid primary key,
  workspace_id uuid not null,
  product_id uuid not null,
  run_id uuid not null,
  snapshot_id uuid not null,
  family text not null check (family in ('redundant_call', 'retry_amplification', 'context_amplification', 'model_overprovisioning', 'latency_critical_path')),
  version text not null,
  scope text not null,
  symptom text not null,
  root_cause text not null,
  causal_path jsonb not null default '[]'::jsonb,
  affected_nodes jsonb not null default '[]'::jsonb,
  evidence_refs jsonb not null check (jsonb_typeof(evidence_refs) = 'array' and jsonb_array_length(evidence_refs) > 0),
  metrics jsonb not null default '{}'::jsonb,
  confidence double precision not null check (confidence between 0 and 1),
  severity text not null check (severity in ('low', 'medium', 'high')),
  required_additional_evidence jsonb not null default '[]'::jsonb,
  falsifier text not null check (char_length(falsifier) > 0),
  suggested_optimization_passes jsonb not null default '[]'::jsonb,
  risk_class text not null check (risk_class in ('low', 'medium', 'high')),
  diagnosis_hash text not null check (diagnosis_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint optimization_diagnoses_run_fk foreign key (run_id, workspace_id) references public.optimization_runs(id, workspace_id) on delete cascade,
  constraint optimization_diagnoses_snapshot_fk foreign key (snapshot_id, workspace_id) references public.performance_snapshots(id, workspace_id) on delete cascade,
  unique (run_id, diagnosis_hash)
);
create index if not exists optimization_diagnoses_workspace_idx on public.optimization_diagnoses(workspace_id);
create index if not exists optimization_diagnoses_snapshot_idx on public.optimization_diagnoses(snapshot_id, workspace_id);

-- ------------------------------------------------- engine lineage (nullable)
alter table public.engine_plans
  add column if not exists run_id uuid references public.optimization_runs(id) on delete set null,
  add column if not exists diagnosis_id uuid references public.optimization_diagnoses(id) on delete set null,
  add column if not exists optimization_pass text,
  add column if not exists pass_version text,
  add column if not exists contract_hash text,
  add column if not exists baseline_snapshot_id uuid references public.performance_snapshots(id) on delete set null,
  add column if not exists executable_status text check (executable_status is null or executable_status in ('EXECUTABLE', 'NOT_EXECUTABLE', 'NEEDS_IMPLEMENTATION')),
  add column if not exists candidate_config_hash text,
  add column if not exists lineage jsonb;
-- A candidate that cannot be executed is never READY.
alter table public.engine_plans drop constraint if exists engine_plans_not_executable_blocked;
alter table public.engine_plans add constraint engine_plans_not_executable_blocked check (executable_status is null or executable_status = 'EXECUTABLE' or status = 'BLOCKED');
create unique index if not exists engine_plans_run_candidate_key on public.engine_plans(run_id, candidate_config_hash) where run_id is not null;
create index if not exists engine_plans_diagnosis_idx on public.engine_plans(diagnosis_id);
create index if not exists engine_plans_snapshot_idx on public.engine_plans(baseline_snapshot_id);

alter table public.engine_executions
  add column if not exists run_id uuid references public.optimization_runs(id) on delete set null,
  add column if not exists contract_hash text;
create index if not exists engine_executions_run_idx on public.engine_executions(run_id);

alter table public.engine_evaluations
  add column if not exists run_id uuid references public.optimization_runs(id) on delete set null,
  add column if not exists contract_id uuid references public.evaluation_contracts(id) on delete set null,
  add column if not exists contract_hash text,
  add column if not exists performance_comparison jsonb;
create index if not exists engine_evaluations_run_idx on public.engine_evaluations(run_id);
create index if not exists engine_evaluations_contract_idx on public.engine_evaluations(contract_id);

-- ------------------------------------------- bounded ZevIR read per product
-- The latest p_max_graphs ZevIR graphs of one product with their nodes and
-- edges, in one call (no N+1). Server-only. Reports truncation explicitly.
create or replace function public.zevir_product_graph_set(p_workspace_id uuid, p_product_id uuid, p_max_graphs integer)
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
        'nodes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'stable_key', n.stable_key, 'kind', n.kind, 'name', n.name, 'operation', n.operation, 'started_at', n.started_at, 'ended_at', n.ended_at, 'duration_ms', n.duration_ms, 'latency_ms', n.latency_ms) order by n.stable_key) from public.zevir_nodes n where n.graph_id = g.id), '[]'::jsonb),
        'edges', coalesce((select jsonb_agg(jsonb_build_object('source_node_id', e.source_node_id, 'target_node_id', e.target_node_id, 'kind', e.kind) order by e.source_node_id, e.kind, e.target_node_id) from public.zevir_edges e where e.graph_id = g.id), '[]'::jsonb)
      ) order by g.updated_at desc, g.id)
      from (select * from public.zevir_graphs where workspace_id = p_workspace_id and product_id = p_product_id order by updated_at desc, id limit p_max_graphs) g
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------- access control
alter table public.evaluation_contracts enable row level security;
alter table public.optimization_runs enable row level security;
alter table public.performance_snapshots enable row level security;
alter table public.optimization_diagnoses enable row level security;

revoke all on public.evaluation_contracts, public.optimization_runs, public.performance_snapshots, public.optimization_diagnoses from anon, authenticated;
grant all on public.evaluation_contracts, public.optimization_runs, public.performance_snapshots, public.optimization_diagnoses to service_role;

do $$
declare t text;
begin
  foreach t in array array['evaluation_contracts', 'optimization_runs', 'performance_snapshots', 'optimization_diagnoses'] loop
    execute format('drop policy if exists %I on public.%I', t || '_member_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id, (select auth.uid())))', t || '_member_select', t);
  end loop;
end $$;

revoke all on function public.zevir_product_graph_set(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.evaluation_contracts_guard() from public, anon, authenticated;
revoke all on function public.evaluation_contract_freeze(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.evaluation_contract_freeze(uuid, uuid, text) to service_role;
revoke all on function public.optimization_runs_bind_contract() from public, anon, authenticated;
grant execute on function public.zevir_product_graph_set(uuid, uuid, integer) to service_role;

insert into public.feature_flags (key, description, enabled)
values ('verified_optimization_vnext', 'Verified Optimization Run (vNext Part 2A): evaluation contract, verified performance, deterministic diagnoses, candidates and replay under contract.', false)
on conflict (key) do nothing;
